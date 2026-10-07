import * as THREE from 'three';
import { VoxelType } from '../types/physics';
import { VoxelWorld } from './VoxelWorld';
import { SpriteNodeMaterial } from 'three/webgpu';
import { instancedBufferAttribute, texture, uniformTexture, uv, vec2 } from 'three/tsl';

/**
 * Minecraft-style block break particles.
 *
 * Each particle is a small camera-facing square showing a random 1/4 x 1/4 patch of the
 * broken block's own texture (read from the live voxel atlas, so resource packs just work),
 * tinted by the light around the block and the day/night tint.
 *
 * Built to be cheap on mobile: one pooled THREE.Points object (a single draw call that is
 * skipped entirely while no particle is alive), no per-spawn allocations, fixed memory.
 */

const MAX_PARTICLES = 256;
const GRAVITY = 20;
const DRAG_PER_SEC = 1.6;
const MIN_LIFE = 0.45;
const MAX_LIFE = 1.0;
const SHRINK_TIME = 0.25;

export class BlockParticles {
  private readonly points: THREE.Sprite;
  private readonly material: SpriteNodeMaterial;
  private readonly positionAttribute: THREE.InstancedBufferAttribute;
  private readonly rectAttribute: THREE.InstancedBufferAttribute;
  private readonly colorAttribute: THREE.InstancedBufferAttribute;
  private readonly sizeAttribute: THREE.InstancedBufferAttribute;
  private readonly mapNode: ReturnType<typeof uniformTexture>;
  private readonly pos = new Float32Array(MAX_PARTICLES * 3);
  private readonly rect = new Float32Array(MAX_PARTICLES * 4);
  private readonly color = new Float32Array(MAX_PARTICLES * 3);
  private readonly size = new Float32Array(MAX_PARTICLES);
  private readonly vel = new Float32Array(MAX_PARTICLES * 3);
  private readonly age = new Float32Array(MAX_PARTICLES);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly baseSize = new Float32Array(MAX_PARTICLES);
  private readonly alive = new Uint8Array(MAX_PARTICLES);

  private next = 0;
  private aliveCount = 0;
  private readonly light = new THREE.Color();
  private readonly bufferSize = new THREE.Vector2();

  constructor(private readonly scene: THREE.Scene, private readonly voxelWorld: VoxelWorld) {
    // WebGPU does not support variable-size point primitives. Use Three.js'
    // instanced SpriteNodeMaterial instead; Sprite handles camera-facing quads
    // while the instanced attributes keep this at one draw call.
    this.positionAttribute = new THREE.InstancedBufferAttribute(this.pos, 3);
    this.rectAttribute = new THREE.InstancedBufferAttribute(this.rect, 4);
    this.colorAttribute = new THREE.InstancedBufferAttribute(this.color, 3);
    this.sizeAttribute = new THREE.InstancedBufferAttribute(this.size, 1);

    const positionNode = instancedBufferAttribute(this.positionAttribute, 'vec3');
    const rectNode = instancedBufferAttribute(this.rectAttribute, 'vec4');
    const colorNode = instancedBufferAttribute(this.colorAttribute, 'vec3');
    const sizeNode = instancedBufferAttribute(this.sizeAttribute, 'float');

    // Instanced attributes are vertex-stage inputs. Pass the per-particle
    // texture rectangle and tint through varyings before sampling in the
    // fragment stage; otherwise WebGPU can produce white/undefined particles.
    const rectVarying = rectNode.toVarying('vParticleRect');
    const colorVarying = colorNode.toVarying('vParticleColor');

    this.mapNode = uniformTexture(this.voxelWorld.material.map);
    const particleUV = uv().mul(rectVarying.zw).add(rectVarying.xy);
    const sampled = this.mapNode.sample(particleUV);

    this.material = new SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
      alphaTest: 0.5,
      sizeAttenuation: true,
    });
    this.material.positionNode = positionNode;
    this.material.scaleNode = vec2(sizeNode);
    this.material.colorNode = sampled.rgb.mul(colorVarying);
    this.material.opacityNode = sampled.a;
    this.material.toneMapped = false;

    this.points = new THREE.Sprite(this.material);
    this.points.count = MAX_PARTICLES;
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.renderOrder = 2;

    this.scene.add(this.points);
  }

  /** Spawn the burst for a block that was just broken at integer cell (bx, by, bz). */
  public spawn(bx: number, by: number, bz: number, voxel: VoxelType, count = 24) {
    const rects = this.voxelWorld.getBlockTileRects(voxel);
    if (rects.length === 0) return;
    this.voxelWorld.getBlockSurroundLight(bx, by, bz, this.light);

    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX_PARTICLES;
      if (!this.alive[i]) this.aliveCount++;
      this.alive[i] = 1;

      // Start somewhere inside the block and burst outward from its centre.
      const rx = 0.1 + Math.random() * 0.8;
      const ry = 0.1 + Math.random() * 0.8;
      const rz = 0.1 + Math.random() * 0.8;
      this.pos[i * 3] = bx + rx;
      this.pos[i * 3 + 1] = by + ry;
      this.pos[i * 3 + 2] = bz + rz;
      const speed = 1.5 + Math.random() * 2.5;
      this.vel[i * 3] = (rx - 0.5) * 2 * speed + (Math.random() - 0.5);
      this.vel[i * 3 + 1] = (ry - 0.5) * 2 * speed + 1.5 + Math.random() * 1.5;
      this.vel[i * 3 + 2] = (rz - 0.5) * 2 * speed + (Math.random() - 0.5);

      this.age[i] = 0;
      this.life[i] = MIN_LIFE + Math.random() * (MAX_LIFE - MIN_LIFE);
      this.baseSize[i] = 0.09 + Math.random() * 0.07;
      this.size[i] = this.baseSize[i];

      // A random 4x4 patch of one of the block's textures.
      const r = rects[(Math.random() * rects.length) | 0];
      const du = (r[2] - r[0]) / 4;
      const dv = (r[3] - r[1]) / 4;
      this.rect[i * 4] = r[0] + ((Math.random() * 4) | 0) * du;
      this.rect[i * 4 + 1] = r[1] + ((Math.random() * 4) | 0) * dv;
      this.rect[i * 4 + 2] = du;
      this.rect[i * 4 + 3] = dv;

      const jitter = 0.75 + Math.random() * 0.25;
      this.color[i * 3] = this.light.r * jitter;
      this.color[i * 3 + 1] = this.light.g * jitter;
      this.color[i * 3 + 2] = this.light.b * jitter;
    }

    this.rectAttribute.needsUpdate = true;
    this.colorAttribute.needsUpdate = true;
    this.positionAttribute.needsUpdate = true;
    this.sizeAttribute.needsUpdate = true;
    this.mapNode.value = this.voxelWorld.material.map;
    this.points.visible = true;
  }

  private solidAt(x: number, y: number, z: number): boolean {
    return this.voxelWorld.getVoxel(Math.floor(x), Math.floor(y), Math.floor(z)) !== VoxelType.AIR;
  }

  public update(delta: number) {
    if (this.aliveCount === 0 || delta <= 0) return;
    const drag = Math.max(0, 1 - DRAG_PER_SEC * delta);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!this.alive[i]) continue;

      this.age[i] += delta;
      const remaining = this.life[i] - this.age[i];
      if (remaining <= 0) {
        this.alive[i] = 0;
        this.aliveCount--;
        this.size[i] = 0;
        continue;
      }

      const p = i * 3;
      let vx = this.vel[p] * drag;
      let vy = (this.vel[p + 1] - GRAVITY * delta) * drag;
      let vz = this.vel[p + 2] * drag;
      let x = this.pos[p];
      let y = this.pos[p + 1];
      let z = this.pos[p + 2];

      const nx = x + vx * delta;
      if (this.solidAt(nx, y, z)) vx *= -0.3;
      else x = nx;

      const nz = z + vz * delta;
      if (this.solidAt(x, y, nz)) vz *= -0.3;
      else z = nz;

      const ny = y + vy * delta;
      if (this.solidAt(x, ny, z)) {
        if (vy < 0) {
          y = Math.floor(ny) + 1.0005; // rest on top of the block below
          vx *= 0.6;
          vz *= 0.6;
        }
        vy = 0;
      } else {
        y = ny;
      }

      this.pos[p] = x;
      this.pos[p + 1] = y;
      this.pos[p + 2] = z;
      this.vel[p] = vx;
      this.vel[p + 1] = vy;
      this.vel[p + 2] = vz;
      this.size[i] = this.baseSize[i] * Math.min(1, remaining / SHRINK_TIME);
    }

    this.positionAttribute.needsUpdate = true;
    this.sizeAttribute.needsUpdate = true;
    if (this.aliveCount === 0) this.points.visible = false; // skip the draw call while idle
  }

  public dispose() {
    this.scene.remove(this.points);
    this.material.dispose();
  }
}
