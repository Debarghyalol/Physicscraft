import * as THREE from 'three';
import { VoxelWorld } from '../rendering/VoxelWorld';
import { VoxelType } from '../types/physics';
import { Pig } from './Pig';
import { loadPigTexture } from './PigModel';
import { resourcePacks } from '../resourcepack/ResourcePackManager';

const MAX_PIGS = 10;
const SPAWN_MIN = 14;
const SPAWN_MAX = 30;
const DESPAWN_DIST = 72;

/** Owns every mob: spawning around the player, updating, hit testing and rendering. */
export class MobManager {
  public readonly pigs: Pig[] = [];
  private texture: THREE.Texture | null = null;
  private spawnTimer = 0;
  private ready = false;
  private scratch = new THREE.Box3();
  private hitPoint = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private world: VoxelWorld) {
    const load = async () => {
      const old = this.texture;
      this.texture = await loadPigTexture();
      this.ready = true;
      // re-skin existing pigs when the pack changes
      for (const p of this.pigs) {
        p.rig.materials.forEach((m) => {
          m.map = this.texture;
          m.needsUpdate = true;
        });
      }
      old?.dispose();
    };
    void load();
    resourcePacks.subscribe(() => void load());
  }

  public update(dt: number, player: THREE.Vector3) {
    if (!this.ready) return;
    for (let i = this.pigs.length - 1; i >= 0; i--) {
      const pig = this.pigs[i];
      const far = pig.position.distanceTo(player) > DESPAWN_DIST;
      if (far || !pig.update(dt, player)) {
        pig.dispose();
        this.pigs.splice(i, 1);
      }
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = this.pigs.length < 4 ? 0.5 : 4;
      if (this.pigs.length < MAX_PIGS) this.trySpawnGroup(player);
    }
  }

  /** Dev/testing helper: spawn one pig at world (x, z). */
  public debugSpawn(x: number, z: number) {
    const pig = new Pig(this.world, this.texture, x, this.world.getElevationAt(x, z) + 0.02, z);
    this.scene.add(pig.rig.root);
    this.pigs.push(pig);
  }

  private trySpawnGroup(player: THREE.Vector3) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
      const x = player.x + Math.sin(a) * r, z = player.z + Math.cos(a) * r;
      if (!this.world.hasColumnAt(x, z)) continue;
      const y = this.world.getElevationAt(x, z);
      if (this.world.getVoxel(Math.floor(x), Math.floor(y) - 1, Math.floor(z)) !== VoxelType.GRASS) continue;
      const count = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count && this.pigs.length < MAX_PIGS; i++) {
        const px = x + (Math.random() - 0.5) * 4, pz = z + (Math.random() - 0.5) * 4;
        if (!this.world.hasColumnAt(px, pz)) continue;
        const py = this.world.getElevationAt(px, pz);
        if (!this.world.isSolidAt(Math.floor(px), Math.floor(py) - 1, Math.floor(pz))) continue;
        const pig = new Pig(this.world, this.texture, px, py + 0.02, pz);
        this.scene.add(pig.rig.root);
        this.pigs.push(pig);
      }
      return;
    }
  }

  /** Closest living mob hit by the ray within maxDist. */
  public raycast(ray: THREE.Ray, maxDist: number): { pig: Pig; dist: number } | null {
    let best: { pig: Pig; dist: number } | null = null;
    for (const pig of this.pigs) {
      if (!pig.alive) continue;
      if (ray.intersectBox(pig.getBox(this.scratch), this.hitPoint)) {
        const d = this.hitPoint.distanceTo(ray.origin);
        if (d <= maxDist && (!best || d < best.dist)) best = { pig, dist: d };
      }
    }
    return best;
  }

  /** Per-mob light from the voxel light field (same as the player model). */
  public applyLighting(skyDim: number, warm: THREE.Color) {
    const c = new THREE.Color();
    for (const pig of this.pigs) {
      this.world.getLightColorAt(pig.position.x, pig.position.y + 0.6, pig.position.z, skyDim, c);
      c.multiply(warm);
      pig.setLightTint(c);
    }
  }

  public dispose() {
    this.pigs.forEach((p) => p.dispose());
    this.pigs.length = 0;
    this.texture?.dispose();
  }
}
