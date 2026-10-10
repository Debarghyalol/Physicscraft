import * as THREE from 'three';
import { VoxelWorld } from '../rendering/VoxelWorld';
import { VoxelType } from '../types/physics';
import { soundManager } from '../audio/SoundEffects';
import { createPigRig, PigRig } from './PigModel';
import { WaterSample, makeWaterSample, sampleWater } from '../fluid/fluidPhysics';

/**
 * A pig. Behaviour mirrors vanilla's goal list (Panic 1.25x, WaterAvoidingRandomStroll 1.0x every
 * ~120 ticks within 10 blocks, LookAtPlayer 6, RandomLookAround) at 20 AI ticks per second, with
 * simple steering instead of A* pathfinding. Health 10, 0.9 x 0.9 hitbox.
 */
const WIDTH = 0.9;
const HEIGHT = 0.9;
const GRAVITY = 32;
const JUMP_V = 9.6; // ~1.44 block apex (vanilla ~1.25): clears a full block with margin
const WALK_SPEED = 2.4; // blocks/s
const PANIC_MULT = 1.25;
const MAX_HEALTH = 10;
const TICK = 1 / 20;
const D2R = Math.PI / 180;

const angleDiff = (a: number, b: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export class Pig {
  public readonly rig: PigRig;
  public readonly position = new THREE.Vector3();
  private vx = 0;
  private vy = 0;
  private vz = 0;
  private onGround = false;
  private inWater = false;
  private waterSample: WaterSample = makeWaterSample();

  public health = MAX_HEALTH;
  public hurtTime = 0; // seconds of red flash left
  public deathTime = 0; // seconds since death (0 = alive)
  private panicTicks = 0;
  private panicFrom = new THREE.Vector3();

  private yaw = Math.random() * Math.PI * 2; // body heading (forward = +sin, +cos)
  private headYaw = 0; // relative to body
  private headPitch = 0;
  private lookTicks = 0;
  private lookTargetYaw = 0;
  private lookTargetPitch = 0;
  private lookAtPlayer = false;

  private target: THREE.Vector3 | null = null;
  private stuckTime = 0;
  private tickAcc = 0;
  private walkPos = 0;
  private walkSpeed = 0;
  private stepTimer = 0;

  constructor(private world: VoxelWorld, texture: THREE.Texture | null, x: number, y: number, z: number) {
    this.rig = createPigRig(texture);
    this.position.set(x, y, z);
    this.syncModel();
  }

  get alive() {
    return this.health > 0;
  }

  /** Axis-aligned box for hit testing. */
  public getBox(out = new THREE.Box3()) {
    return out.set(
      new THREE.Vector3(this.position.x - WIDTH / 2, this.position.y, this.position.z - WIDTH / 2),
      new THREE.Vector3(this.position.x + WIDTH / 2, this.position.y + HEIGHT, this.position.z + WIDTH / 2)
    );
  }

  public hurt(amount: number, from: THREE.Vector3) {
    if (!this.alive || this.hurtTime > 0.35) return false;
    this.health -= amount;
    this.hurtTime = 0.5;
    const dx = this.position.x - from.x, dz = this.position.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    this.vx = (dx / len) * 5;
    this.vz = (dz / len) * 5;
    this.vy = 6.5;
    this.onGround = false;
    this.panicFrom.copy(from);
    this.panicTicks = 80;
    this.target = null;
    this.playSound(this.alive ? 'say' : 'death', 1);
    return true;
  }

  private volumeFor(listener: THREE.Vector3) {
    return Math.max(0, 1 - this.position.distanceTo(listener) / 16);
  }
  private lastListener = new THREE.Vector3();
  private playSound(kind: 'say' | 'death' | 'step', mul: number) {
    soundManager.playPigSound(kind, this.volumeFor(this.lastListener) * mul);
  }

  /** Returns false when the pig should be removed. */
  public update(dt: number, player: THREE.Vector3): boolean {
    this.lastListener.copy(player);
    this.hurtTime = Math.max(0, this.hurtTime - dt);

    if (!this.alive) {
      this.deathTime += dt;
      this.vx = this.vz = 0;
      this.physics(dt);
      this.syncModel();
      return this.deathTime < 1.0;
    }

    // Unloaded chunk underneath: stand still instead of falling into the void.
    if (!this.world.hasColumnAt(this.position.x, this.position.z)) return true;

    this.tickAcc += dt;
    while (this.tickAcc >= TICK) {
      this.tickAcc -= TICK;
      this.aiTick(player);
    }
    this.steer(dt);
    const before = this.position.clone();
    this.physics(dt);
    const moved = Math.hypot(this.position.x - before.x, this.position.z - before.z);

    // vanilla-like limb animation (speed in blocks/tick * 4, smoothed)
    const target = Math.min((moved / dt / 20) * 4, 1);
    this.walkSpeed += (target - this.walkSpeed) * Math.min(1, 0.4 * dt * 20);
    this.walkPos += this.walkSpeed * dt * 20;

    if (moved / dt > 0.8 && this.onGround) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.stepTimer = 0.4;
        this.playSound('step', 0.15);
      }
    }
    this.syncModel();
    return true;
  }

  // ------------------------------------------------------------------ AI

  private aiTick(player: THREE.Vector3) {
    const panicking = this.panicTicks > 0;
    if (panicking) {
      this.panicTicks--;
      if (!this.target || this.reached()) this.pickPanicTarget();
    } else if (!this.target && Math.random() * 120 < 1) {
      this.pickStrollTarget();
    } else if (this.target && this.reached()) {
      this.target = null;
    }

    // ambient sound (~every 12 s)
    if (Math.random() < 1 / 240) this.playSound('say', 1);

    // looking: LookAtPlayerGoal (range 6) / RandomLookAroundGoal
    if (this.lookTicks > 0) {
      this.lookTicks--;
      if (this.lookAtPlayer) {
        const dx = player.x - this.position.x, dz = player.z - this.position.z;
        const dy = player.y + 1.6 - (this.position.y + 0.6);
        this.lookTargetYaw = angleDiff(this.yaw, Math.atan2(dx, dz));
        this.lookTargetPitch = -Math.atan2(dy, Math.hypot(dx, dz));
      }
    } else if (!panicking) {
      if (this.position.distanceTo(player) < 6 && Math.random() < 0.02) {
        this.lookAtPlayer = true;
        this.lookTicks = 40 + Math.floor(Math.random() * 40);
      } else if (Math.random() < 0.02) {
        this.lookAtPlayer = false;
        this.lookTicks = 20 + Math.floor(Math.random() * 20);
        this.lookTargetYaw = (Math.random() - 0.5) * 2 * 60 * D2R;
        this.lookTargetPitch = (Math.random() - 0.3) * 30 * D2R;
      }
    }
    if (this.lookTicks <= 0) {
      this.lookTargetYaw = 0;
      this.lookTargetPitch = 0;
    }
    // Like vanilla's body-rotation control: once the head is turned far, the body follows it.
    if (!this.target && Math.abs(this.headYaw) > 50 * D2R) {
      const d = Math.sign(this.headYaw) * Math.min(Math.abs(this.headYaw) - 50 * D2R, 10 * D2R);
      this.yaw += d;
      this.headYaw -= d;
      this.lookTargetYaw -= d;
    }
    // head turn rate: 30deg per tick toward the goal, clamped to +-75deg
    const maxStep = 30 * D2R;
    const want = Math.max(-75 * D2R, Math.min(75 * D2R, this.lookTargetYaw));
    this.headYaw += Math.max(-maxStep, Math.min(maxStep, want - this.headYaw)) * 0.5;
    this.headPitch += (Math.max(-40 * D2R, Math.min(40 * D2R, this.lookTargetPitch)) - this.headPitch) * 0.4;
  }

  private reached() {
    return !!this.target && Math.hypot(this.target.x - this.position.x, this.target.z - this.position.z) < 0.5;
  }

  /** Random land position within 10 blocks horizontally / 7 vertically (LandRandomPos). */
  private findGround(x: number, z: number): number | null {
    const by = Math.floor(this.position.y);
    for (let y = by + 7; y >= by - 7; y--) {
      const here = this.world.getVoxel(Math.floor(x), y, Math.floor(z));
      if (here === VoxelType.AIR) continue;
      if (here === VoxelType.WATER) return null; // WaterAvoidingRandomStroll: never pick water
      const a1 = this.world.getVoxel(Math.floor(x), y + 1, Math.floor(z));
      const a2 = this.world.getVoxel(Math.floor(x), y + 2, Math.floor(z));
      return a1 === VoxelType.AIR && a2 === VoxelType.AIR ? y + 1 : null;
    }
    return null;
  }

  private pickStrollTarget() {
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 7;
      const x = this.position.x + Math.sin(a) * r, z = this.position.z + Math.cos(a) * r;
      if (!this.world.hasColumnAt(x, z)) continue;
      const y = this.findGround(x, z);
      if (y !== null) {
        this.target = new THREE.Vector3(x, y, z);
        return;
      }
    }
  }

  private pickPanicTarget() {
    const base = Math.atan2(this.position.x - this.panicFrom.x, this.position.z - this.panicFrom.z);
    for (let i = 0; i < 8; i++) {
      const a = base + (Math.random() - 0.5) * 1.6, r = 5 + Math.random() * 3;
      const x = this.position.x + Math.sin(a) * r, z = this.position.z + Math.cos(a) * r;
      if (!this.world.hasColumnAt(x, z)) continue;
      const y = this.findGround(x, z);
      if (y !== null) {
        this.target = new THREE.Vector3(x, y, z);
        return;
      }
    }
  }

  // ------------------------------------------------------------ movement

  private steer(dt: number) {
    const panicking = this.panicTicks > 0;
    if (!this.target) {
      this.vx *= Math.max(0, 1 - dt * 12);
      this.vz *= Math.max(0, 1 - dt * 12);
      this.stuckTime = 0;
      return;
    }
    const dx = this.target.x - this.position.x, dz = this.target.z - this.position.z;
    const want = Math.atan2(dx, dz);
    const diff = angleDiff(this.yaw, want);
    this.yaw += Math.sign(diff) * Math.min(Math.abs(diff), 10 * D2R * dt * 20);

    const speed = WALK_SPEED * (panicking ? PANIC_MULT : 1) * (Math.abs(diff) > 1.2 ? 0.3 : 1) * (this.inWater ? 0.55 : 1);
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);

    // Don't walk off cliffs (vanilla paths avoid drops > 3) unless fleeing.
    if (!panicking) {
      const ax = this.position.x + fx * 0.8, az = this.position.z + fz * 0.8;
      let ground = false;
      for (let d = 0; d <= 3 && !ground; d++) {
        ground = this.world.isSolidAt(Math.floor(ax), Math.floor(this.position.y) - 1 - d, Math.floor(az));
      }
      if (!ground) {
        this.target = null;
        return;
      }
    }

    // Step up one-block ledges.
    if (this.onGround || this.inWater) {
      const ax = this.position.x + fx * 0.65, az = this.position.z + fz * 0.65;
      const fy = Math.floor(this.position.y + 0.05);
      const blocked = this.world.isSolidAt(Math.floor(ax), fy, Math.floor(az));
      const clear =
        !this.world.isSolidAt(Math.floor(ax), fy + 1, Math.floor(az)) &&
        !this.world.isSolidAt(Math.floor(ax), fy + 2, Math.floor(az));
      if (blocked && clear) this.vy = this.inWater && !this.onGround ? 6.0 : JUMP_V; // jumpOutOfFluid / step up
    }

    this.vx += (fx * speed - this.vx) * Math.min(1, dt * 10);
    this.vz += (fz * speed - this.vz) * Math.min(1, dt * 10);

    // Give up when pinned against something for a while.
    if (Math.hypot(this.vx, this.vz) < speed * 0.2) {
      this.stuckTime += dt;
      if (this.stuckTime > 1.0) {
        this.target = null;
        this.stuckTime = 0;
      }
    } else this.stuckTime = 0;
  }

  private solidAt(x: number, y: number, z: number) {
    return this.world.isSolidAt(Math.floor(x), Math.floor(y), Math.floor(z));
  }

  private intersects(): boolean {
    const hw = WIDTH / 2, e = 1e-4;
    const x0 = Math.floor(this.position.x - hw), x1 = Math.floor(this.position.x + hw - e);
    const y0 = Math.floor(this.position.y), y1 = Math.floor(this.position.y + HEIGHT - e);
    const z0 = Math.floor(this.position.z - hw), z1 = Math.floor(this.position.z + hw - e);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) if (this.solidAt(x, y, z)) return true;
    return false;
  }

  private physics(dt: number) {
    dt = Math.min(dt, 0.05);
    const hw = WIDTH / 2;
    const ws = sampleWater(this.world, this.position.x - hw, this.position.x + hw, this.position.y, this.position.y + HEIGHT, this.position.z - hw, this.position.z + hw, this.waterSample);
    this.inWater = ws.count > 0;
    if (this.inWater) {
      // travelInWater: 0.8 drag, gravity/16 sink, and FloatGoal's 0.04/tick jumps (80% of ticks)
      // while deeper than 0.4, so pigs bob at the surface and get carried by currents.
      const lam = 4.463;
      const e = Math.exp(-lam * dt);
      let acc = -2;
      if (ws.height > 0.4) acc += 12.8;
      this.vx = this.vx * e + ws.flowX * 5.6 * dt;
      this.vz = this.vz * e + ws.flowZ * 5.6 * dt;
      this.vy = this.vy * e + (acc / lam) * (1 - e);
    } else {
      this.vy -= GRAVITY * dt;
    }
    if (this.vy < -40) this.vy = -40;

    this.position.x += this.vx * dt;
    if (this.intersects()) {
      this.position.x = this.vx > 0 ? Math.floor(this.position.x + hw) - hw - 1e-3 : Math.floor(this.position.x - hw) + 1 + hw + 1e-3;
      this.vx = 0;
    }
    this.position.z += this.vz * dt;
    if (this.intersects()) {
      this.position.z = this.vz > 0 ? Math.floor(this.position.z + hw) - hw - 1e-3 : Math.floor(this.position.z - hw) + 1 + hw + 1e-3;
      this.vz = 0;
    }
    this.position.y += this.vy * dt;
    this.onGround = false;
    if (this.intersects()) {
      if (this.vy < 0) {
        this.position.y = Math.floor(this.position.y) + 1;
        this.onGround = true;
      } else {
        this.position.y = Math.floor(this.position.y + HEIGHT) - HEIGHT - 1e-3;
      }
      this.vy = 0;
    }
    if (this.onGround && !this.target && this.alive) {
      this.vx *= Math.max(0, 1 - dt * 12);
      this.vz *= Math.max(0, 1 - dt * 12);
    }
  }

  // ------------------------------------------------------------- render

  private syncModel() {
    const { root, rig, head, legs, materials } = this.rig;
    root.position.copy(this.position);
    root.rotation.y = this.yaw;
    head.rotation.order = 'YXZ'; // yaw first, then pitch about the turned axis
    head.rotation.set(this.headPitch, this.headYaw, 0);
    const p = this.walkPos * 0.6662, s = this.walkSpeed * 1.4;
    legs.rh.rotation.x = Math.cos(p) * s;
    legs.lh.rotation.x = Math.cos(p + Math.PI) * s;
    legs.rf.rotation.x = Math.cos(p + Math.PI) * s;
    legs.lf.rotation.x = Math.cos(p) * s;
    // death: tip over onto its side (vanilla: sqrt(t*1.6) * 90deg)
    const f = this.alive ? 0 : Math.min(1, Math.sqrt((this.deathTime / 1.0) * 1.6));
    rig.rotation.z = f * (Math.PI / 2);
    const red = this.hurtTime > 0 || !this.alive;
    for (const m of materials) m.userData.red = red;
    this.applyTint();
  }

  private lightTint = new THREE.Color(1, 1, 1);
  public setLightTint(c: THREE.Color) {
    this.lightTint.copy(c);
    this.applyTint();
  }
  private applyTint() {
    for (const m of this.rig.materials) {
      m.color.copy(this.lightTint);
      if (m.userData.red) m.color.multiply(new THREE.Color(1, 0.4, 0.4));
    }
  }

  public dispose() {
    this.rig.root.removeFromParent();
    this.rig.materials.forEach((m) => m.dispose());
    this.rig.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}
