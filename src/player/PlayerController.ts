import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PlayerModel } from './PlayerModel';
import { VoxelWorld } from '../rendering/VoxelWorld';
import { CameraViewMode, VoxelType } from '../types/physics';
import { soundManager } from '../audio/SoundEffects';

export interface PlayerInput {
  moveForward: number; // -1 to 1
  moveRight: number;   // -1 to 1
  jump: boolean;
  sprint: boolean;
  descend?: boolean; // fly down (only used while flying)
}

export class PlayerController {
  public body!: RAPIER.RigidBody;
  public collider: RAPIER.Collider | null = null;
  public model: PlayerModel;
  public camera: THREE.PerspectiveCamera;
  public world: RAPIER.World;
  public voxelWorld: VoxelWorld;

  // Camera Orientation
  public yaw: number = 0;
  public pitch: number = 0;
  public viewMode: CameraViewMode = 'first_person';

  // Movement parameters
  public isGrounded: boolean = false;
  public currentSpeed: number = 0;
  // Player velocity is stored here rather than in the Rapier body. The body is
  // kinematicPositionBased, and Rapier discards setLinvel() on such bodies (linvel()
  // always reads back 0), which reset the velocity to zero every frame and made
  // walking, jumping and flying far slower than intended (and frame-rate dependent).
  private velX: number = 0;
  private velY: number = 0;
  private velZ: number = 0;
  // Minecraft-style movement uses 20 simulation ticks/sec. Vanilla player speed is
  // about 4.317 blocks/s walking and 5.612 blocks/s sprinting. We keep the same
  // acceleration/friction model, then apply a game-feel multiplier for Physicscraft.
  public readonly walkSpeed: number = 7.55;
  public readonly sprintSpeed: number = 9.82;
  private readonly movementSpeedMultiplier: number = 1.75;
  private readonly mcGroundAcceleration: number = 0.098;
  private readonly mcSprintAcceleration: number = 0.1274;
  private readonly mcGroundFriction: number = 0.546;
  private readonly mcAirFriction: number = 0.91;

  // Vanilla jump is 0.42 blocks/tick; Physicscraft gives it a modest boost.
  private readonly jumpStrengthMultiplier: number = 1.15;
  public readonly jumpVelocity: number = 8.4 * this.jumpStrengthMultiplier;
  public readonly gravityAcceleration: number = 32.0;
  private readonly verticalDragPerTick: number = 0.98;
  private readonly terminalVelocity: number = 78.4;

  // Creative-style flight (toggle by double-tapping jump)
  public isFlying: boolean = false;
  public onFlyingChange?: (flying: boolean) => void;
  public readonly flySpeed: number = 10.5;
  public readonly flyVerticalSpeed: number = 7.5;
  private prevJump: boolean = false;
  private lastJumpPressTime: number = -10000;

  // Selected voxel for building
  public selectedVoxel: VoxelType = VoxelType.STONE;

  // Minecraft-style wireframe block highlight outline
  public targetHighlightMesh: THREE.LineSegments;
  public currentTargetedBlock: any = null;
  public activeTouchCoords: { x: number; y: number } | null = null;

  public setAimTouchCoords(coords: { x: number; y: number } | null) {
    this.activeTouchCoords = coords;
  }

  // Scratch objects for zero allocations
  private static scratchVec = new THREE.Vector3();
  private static scratchForward = new THREE.Vector3();
  private static scratchRight = new THREE.Vector3();

  constructor(
    world: RAPIER.World,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    voxelWorld: VoxelWorld,
    spawnPos: [number, number, number] = [0, 10.5, 0]
  ) {
    this.world = world;
    this.camera = camera;
    this.voxelWorld = voxelWorld;
    this.model = new PlayerModel(scene);
    // Camera must live in the scene so the first-person arm (a camera child) renders
    if (!camera.parent) scene.add(camera);
    this.model.attachFirstPersonRig(camera);

    // Create Minecraft black wireframe cube for block selection highlight
    const wireGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.005, 1.005, 1.005));
    const wireMat = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 });
    this.targetHighlightMesh = new THREE.LineSegments(wireGeo, wireMat);
    this.targetHighlightMesh.visible = false;
    scene.add(this.targetHighlightMesh);

    this.createPhysicsBody(spawnPos);
    // Start game in FIRST PERSON as requested
    this.setViewMode('first_person');
  }

  private createPhysicsBody(spawnPos: [number, number, number]) {
    // Keep the Rapier body as a lightweight position container so the rest of the
    // engine can continue to use player.translation(). Velocity is NOT stored on it
    // (see velX/velY/velZ). It has NO collider: voxel terrain collision is handled
    // by custom AABB tests.
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(spawnPos[0], spawnPos[1], spawnPos[2])
      .lockRotations()
      .setGravityScale(0)
      .setLinearDamping(0)
      .setCanSleep(false);

    this.body = this.world.createRigidBody(bodyDesc);
    this.collider = null;
  }

  public setViewMode(mode: CameraViewMode) {
    this.viewMode = mode;
    this.model.setFirstPersonMode(mode === 'first_person');
    this.model.setFrontViewMode(mode === 'front');
  }

  public setFlying(flying: boolean) {
    if (this.isFlying === flying) return;
    this.isFlying = flying;
    this.onFlyingChange?.(flying);
  }

  public toggleViewMode() {
    if (this.viewMode === 'first_person') {
      this.setViewMode('third_person');
    } else {
      this.setViewMode('first_person');
    }
  }

  public addLookInput(deltaYaw: number, deltaPitch: number) {
    this.yaw -= deltaYaw;
    this.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.pitch - deltaPitch));
  }

  public update(delta: number, input: PlayerInput) {
    if (!this.body) return;

    let pos = this.body.translation();

    // Terrain collision is voxel-native: no Rapier raycasts or terrain trimeshes.
    this.isGrounded = this.checkGrounded(pos.x, pos.y, pos.z);

    // Double-tap jump (within 320ms) toggles flight
    const nowMs = performance.now();
    if (input.jump && !this.prevJump) {
      if (nowMs - this.lastJumpPressTime < 320) {
        this.setFlying(!this.isFlying);
        this.lastJumpPressTime = -10000;
      } else {
        this.lastJumpPressTime = nowMs;
      }
    }
    this.prevJump = input.jump;

    // 2. Horizontal movement + voxel AABB collision.
    const speed = this.isFlying ? this.flySpeed : input.sprint ? this.sprintSpeed : this.walkSpeed;

    PlayerController.scratchForward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    PlayerController.scratchRight.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();

    const targetVelX =
      (PlayerController.scratchForward.x * input.moveForward +
        PlayerController.scratchRight.x * input.moveRight) * speed;
    const targetVelZ =
      (PlayerController.scratchForward.z * input.moveForward +
        PlayerController.scratchRight.z * input.moveRight) * speed;

    const accel = this.isFlying ? 10 : this.isGrounded ? 18 : 8;
    let newVx = THREE.MathUtils.lerp(this.velX, targetVelX, Math.min(1, delta * accel));
    let newVz = THREE.MathUtils.lerp(this.velZ, targetVelZ, Math.min(1, delta * accel));
    let newVy = this.velY;

    // Gravity / jump is integrated manually because the player has no Rapier collider.
    if (this.isFlying) {
      const dir = (input.jump ? 1 : 0) - (input.descend ? 1 : 0);
      newVy = THREE.MathUtils.lerp(this.velY, dir * this.flyVerticalSpeed, Math.min(1, delta * 12));
    } else if (input.jump && this.isGrounded && this.velY < 2.0) {
      newVy = this.jumpVelocity;
      this.isGrounded = false;
      soundManager.playJump();
    } else if (!this.isGrounded) {
      newVy = Math.max(-60, this.velY - this.gravityAcceleration * delta);
    } else if (newVy < 0) {
      newVy = 0;
    }

    // Move each axis independently. This gives stable block-face sliding and avoids
    // Rapier terrain collision entirely.
    let nextX = pos.x;
    let nextY = pos.y;
    let nextZ = pos.z;

    const xResult = this.moveAlongAxis(nextX, nextY, nextZ, newVx * delta, 0);
    nextX = xResult.position;
    if (xResult.collided) newVx = 0;

    const zResult = this.moveAlongAxis(nextX, nextY, nextZ, newVz * delta, 2);
    nextZ = zResult.position;
    if (zResult.collided) newVz = 0;

    const yResult = this.moveAlongAxis(nextX, nextY, nextZ, newVy * delta, 1);
    nextY = yResult.position;
    if (yResult.collided) {
      if (newVy < 0) this.isGrounded = true;
      newVy = 0;
    } else if (!this.isFlying) {
      this.isGrounded = this.checkGrounded(nextX, nextY, nextZ);
    }

    // Commit the collision-resolved position (walking, falling and flying alike) and
    // keep the velocity for the next frame.
    this.body.setTranslation({ x: nextX, y: nextY, z: nextZ }, true);
    this.velX = newVx;
    this.velY = newVy;
    this.velZ = newVz;
    pos = this.body.translation();

    this.currentSpeed = Math.hypot(newVx, newVz);

    // Footsteps sound
    if (this.currentSpeed > 1.2 && this.isGrounded && !this.isFlying) {
      soundManager.playFootstep('grass');
    }

    // 4. Sync 3D Player Model
    this.model.root.position.set(pos.x, pos.y - 0.9, pos.z);
    this.model.update(delta, this.currentSpeed, this.isGrounded && !this.isFlying, this.pitch, this.yaw);

    // 5. Update Camera Position & Orientation
    this.updateCamera(pos);

    // 6. Update targeted block wireframe outline highlight
    // MCPE & Mobile Rule:
    // Only show block outline when player is actively touching/holding a block on screen,
    // or when in PC desktop pointer lock mode. Never show a floating center outline when moving on mobile!
    const isMobile = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
    const isPointerLocked = typeof document !== 'undefined' && document.pointerLockElement !== null;

    let voxelHit = null;

    if (this.activeTouchCoords) {
      // Finger is touching/holding a block on screen: highlight THAT exact block
      const touchRay = this.getRayFromScreen(this.activeTouchCoords.x, this.activeTouchCoords.y);
      voxelHit = this.voxelWorld.raycastVoxel(touchRay, 7.5);
    } else if (!isMobile && isPointerLocked) {
      // PC pointer locked: highlight crosshair target block
      const aimRay = this.getAimRay();
      voxelHit = this.voxelWorld.raycastVoxel(aimRay, 7.5);
    }

    this.currentTargetedBlock = voxelHit;
    if (voxelHit) {
      this.targetHighlightMesh.position.set(voxelHit.blockX + 0.5, voxelHit.blockY + 0.5, voxelHit.blockZ + 0.5);
      this.targetHighlightMesh.visible = true;
    } else {
      this.targetHighlightMesh.visible = false;
    }
  }

  private static readonly PLAYER_HALF_WIDTH = 0.34;
  private static readonly PLAYER_HALF_HEIGHT = 0.89;
  private static readonly COLLISION_EPSILON = 0.0001;

  private isSolidBlock(x: number, y: number, z: number): boolean {
    return this.voxelWorld.getVoxel(x, y, z) !== VoxelType.AIR;
  }

  private moveAlongAxis(
    x: number,
    y: number,
    z: number,
    delta: number,
    axis: 0 | 1 | 2
  ): { position: number; collided: boolean } {
    if (delta === 0) return { position: axis === 0 ? x : axis === 1 ? y : z, collided: false };

    const hw = PlayerController.PLAYER_HALF_WIDTH;
    const hh = PlayerController.PLAYER_HALF_HEIGHT;
    const eps = PlayerController.COLLISION_EPSILON;

    let nx = x;
    let ny = y;
    let nz = z;
    if (axis === 0) nx += delta;
    else if (axis === 1) ny += delta;
    else nz += delta;

    const minX = Math.floor(Math.min(x - hw, nx - hw));
    const maxX = Math.floor(Math.max(x + hw, nx + hw));
    const minY = Math.floor(Math.min(y - hh, ny - hh));
    const maxY = Math.floor(Math.max(y + hh, ny + hh));
    const minZ = Math.floor(Math.min(z - hw, nz - hw));
    const maxZ = Math.floor(Math.max(z + hw, nz + hw));

    let resolved = axis === 0 ? nx : axis === 1 ? ny : nz;
    let collided = false;

    if (axis === 0) {
      const minPY = ny - hh + eps;
      const maxPY = ny + hh - eps;
      const minPZ = nz - hw + eps;
      const maxPZ = nz + hw - eps;
      for (let by = minY; by <= maxY; by++) {
        for (let bz = minZ; bz <= maxZ; bz++) {
          if (maxPY <= by || minPY >= by + 1 || maxPZ <= bz || minPZ >= bz + 1) continue;
          for (let bx = minX; bx <= maxX; bx++) {
            if (!this.isSolidBlock(bx, by, bz)) continue;
            if (delta > 0 && x + hw <= bx && nx + hw > bx) {
              resolved = bx - hw - eps;
              collided = true;
            } else if (delta < 0 && x - hw >= bx + 1 && nx - hw < bx + 1) {
              resolved = bx + 1 + hw + eps;
              collided = true;
            }
          }
        }
      }
    } else if (axis === 2) {
      const minPY = ny - hh + eps;
      const maxPY = ny + hh - eps;
      const minPX = nx - hw + eps;
      const maxPX = nx + hw - eps;
      for (let by = minY; by <= maxY; by++) {
        for (let bx = minX; bx <= maxX; bx++) {
          if (maxPY <= by || minPY >= by + 1 || maxPX <= bx || minPX >= bx + 1) continue;
          for (let bz = minZ; bz <= maxZ; bz++) {
            if (!this.isSolidBlock(bx, by, bz)) continue;
            if (delta > 0 && z + hw <= bz && nz + hw > bz) {
              resolved = bz - hw - eps;
              collided = true;
            } else if (delta < 0 && z - hw >= bz + 1 && nz - hw < bz + 1) {
              resolved = bz + 1 + hw + eps;
              collided = true;
            }
          }
        }
      }
    } else {
      const minPX = nx - hw + eps;
      const maxPX = nx + hw - eps;
      const minPZ = nz - hw + eps;
      const maxPZ = nz + hw - eps;
      for (let bx = minX; bx <= maxX; bx++) {
        for (let bz = minZ; bz <= maxZ; bz++) {
          if (maxPX <= bx || minPX >= bx + 1 || maxPZ <= bz || minPZ >= bz + 1) continue;
          for (let by = minY; by <= maxY; by++) {
            if (!this.isSolidBlock(bx, by, bz)) continue;
            if (delta > 0 && y + hh <= by && ny + hh > by) {
              resolved = by - hh - eps;
              collided = true;
            } else if (delta < 0 && y - hh >= by + 1 && ny - hh < by + 1) {
              resolved = by + 1 + hh + eps;
              collided = true;
            }
          }
        }
      }
    }

    return { position: resolved, collided };
  }

  private checkGrounded(x: number, y: number, z: number): boolean {
    const hw = PlayerController.PLAYER_HALF_WIDTH - 0.03;
    const minX = Math.floor(x - hw);
    const maxX = Math.floor(x + hw);
    const minZ = Math.floor(z - hw);
    const maxZ = Math.floor(z + hw);
    const footY = y - PlayerController.PLAYER_HALF_HEIGHT;
    const by = Math.floor(footY - 0.01);
    for (let bx = minX; bx <= maxX; bx++) {
      for (let bz = minZ; bz <= maxZ; bz++) {
        // Block `by` spans [by, by + 1], so compare against its TOP face (by + 1).
        if (this.isSolidBlock(bx, by, bz) && footY <= by + 1 + 0.08) return true;
      }
    }
    return false;
  }

  public applyImpulse(impulse: { x: number; y: number; z: number }) {
    const v = this.body.linvel();
    this.body.setLinvel({
      x: v.x + impulse.x,
      y: v.y + impulse.y,
      z: v.z + impulse.z,
    }, true);
  }

  private updateCamera(pos: RAPIER.Vector3) {
    if (this.viewMode === 'first_person') {
      // First person: at Steve's eye height
      this.camera.position.set(pos.x, pos.y + 0.68, pos.z);
      // Clean Euler YXZ rotation eliminates gimbal lock and glitchy jumps
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.y = this.yaw;
      this.camera.rotation.x = this.pitch;
      this.camera.rotation.z = 0;
    } else {
      // Third person: chase camera behind the player. Front view places the camera in front,
      // looking back at the player's face.
      const targetPos = PlayerController.scratchVec.set(pos.x, pos.y + 0.72, pos.z);
      const maxDist = 3.5;
      const frontView = this.viewMode === 'front';
      const distanceSign = frontView ? -1 : 1;

      const camDir = new THREE.Vector3(
        Math.sin(this.yaw) * Math.cos(this.pitch) * distanceSign,
        -Math.sin(this.pitch),
        Math.cos(this.yaw) * Math.cos(this.pitch) * distanceSign
      ).normalize();

      // Check if any block blocks the camera line of sight
      const camRay = new THREE.Ray(targetPos, camDir);
      const hit = this.voxelWorld.raycastVoxel(camRay, maxDist);
      const actualDist = hit ? Math.max(0.4, hit.point.distanceTo(targetPos) - 0.25) : maxDist;

      this.camera.position.copy(targetPos).addScaledVector(camDir, actualDist);
      this.camera.lookAt(targetPos);
    }
  }

  public getAimRay(): THREE.Ray {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    return new THREE.Ray(this.camera.position.clone(), dir);
  }

  /**
   * Raycast from exact screen coordinates where the finger/cursor clicked
   */
  public getRayFromScreen(clientX: number, clientY: number): THREE.Ray {
    const ndcX = (clientX / window.innerWidth) * 2 - 1;
    const ndcY = -(clientY / window.innerHeight) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    return raycaster.ray;
  }

  /**
   * Check if placing a block at (bx, by, bz) overlaps Steve's physics capsule
   */
  public canPlaceAt(bx: number, by: number, bz: number): boolean {
    const playerPos = this.body.translation();
    const pMinX = playerPos.x - 0.55;
    const pMaxX = playerPos.x + 0.55;
    const pMinY = playerPos.y - 1.05;
    const pMaxY = playerPos.y + 1.05;
    const pMinZ = playerPos.z - 0.55;
    const pMaxZ = playerPos.z + 0.55;

    const bMinX = bx;
    const bMaxX = bx + 1.0;
    const bMinY = by;
    const bMaxY = by + 1.0;
    const bMinZ = bz;
    const bMaxZ = bz + 1.0;

    // Overlapping AABB test
    if (
      bMinX < pMaxX &&
      bMaxX > pMinX &&
      bMinY < pMaxY &&
      bMaxY > pMinY &&
      bMinZ < pMaxZ &&
      bMaxZ > pMinZ
    ) {
      return false;
    }
    return true;
  }

  /**
   * Mine / Break targeted voxel block using either aim ray or exact screen touch coords
   */
  public breakTargetedBlock(input?: THREE.Ray | { x: number; y: number }): boolean {
    this.model.triggerSwing();
    let ray: THREE.Ray;
    if (input instanceof THREE.Ray) {
      ray = input;
    } else if (input && typeof input.x === 'number' && typeof input.y === 'number') {
      ray = this.getRayFromScreen(input.x, input.y);
    } else {
      ray = this.getAimRay();
    }

    const hit = this.voxelWorld.raycastVoxel(ray, 7.0);

    if (hit && hit.voxelType !== VoxelType.BEDROCK) {
      this.voxelWorld.setVoxel(hit.blockX, hit.blockY, hit.blockZ, VoxelType.AIR);
      soundManager.playBlockBreak(hit.voxelType === VoxelType.GRASS ? 'grass' : 'stone');
      return true;
    }
    return false;
  }

  /**
   * Raycast targeted voxel coordinates
   */
  public getTargetedVoxel(input?: THREE.Ray | { x: number; y: number }): { x: number; y: number; z: number } | null {
    let ray: THREE.Ray;
    if (input instanceof THREE.Ray) {
      ray = input;
    } else if (input && typeof input.x === 'number' && typeof input.y === 'number') {
      ray = this.getRayFromScreen(input.x, input.y);
    } else {
      ray = this.getAimRay();
    }
    const hit = this.voxelWorld.raycastVoxel(ray, 18.0);
    if (hit) {
      return { x: hit.blockX, y: hit.blockY, z: hit.blockZ };
    }
    return null;
  }

  /**
   * Place selected voxel block using either aim ray or exact screen touch coords
   */
  public placeBlock(input?: THREE.Ray | { x: number; y: number }): boolean {
    this.model.triggerSwing();
    let ray: THREE.Ray;
    if (input instanceof THREE.Ray) {
      ray = input;
    } else if (input && typeof input.x === 'number' && typeof input.y === 'number') {
      ray = this.getRayFromScreen(input.x, input.y);
    } else {
      ray = this.getAimRay();
    }

    const hit = this.voxelWorld.raycastVoxel(ray, 7.0);

    if (hit) {
      const placeX = hit.blockX + hit.normal.x;
      const placeY = hit.blockY + hit.normal.y;
      const placeZ = hit.blockZ + hit.normal.z;

      // STRICT PROTECTION: Never place block inside player
      if (!this.canPlaceAt(placeX, placeY, placeZ)) {
        return false;
      }

      this.voxelWorld.setVoxel(placeX, placeY, placeZ, this.selectedVoxel);
      soundManager.playBlockPlace(this.selectedVoxel === VoxelType.GRASS ? 'grass' : 'stone');
      return true;
    }
    return false;
  }

  public teleport(x: number, y: number, z: number) {
    if (this.body) {
      this.body.setTranslation({ x, y, z }, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.velX = 0;
      this.velY = 0;
      this.velZ = 0;
      this.model.root.position.set(x, y - 0.9, z);
      this.camera.position.set(x, y + 0.68, z);
    }
  }

  public getPosition(): THREE.Vector3 {
    if (this.body) {
      const p = this.body.translation();
      return new THREE.Vector3(p.x, p.y, p.z);
    }
    return new THREE.Vector3(0, 10, 0);
  }

  public dispose(scene: THREE.Scene) {
    scene.remove(this.model.root);
    scene.remove(this.targetHighlightMesh);
    this.targetHighlightMesh.geometry.dispose();
    this.model.dispose();
    if (this.world && this.body) {
      if (this.collider) this.world.removeCollider(this.collider, false);
      this.world.removeRigidBody(this.body);
    }
  }
}
