import * as THREE from 'three';
import { soundManager } from '../audio/SoundEffects';

export interface SoftBodySpring {
  p1: number;
  p2: number;
  restLength: number;
  stiffness: number;
}

export interface SoftBodyConfig {
  id: string;
  size: [number, number, number];
  position: [number, number, number];
  stiffness: number;
  damping: number;
  color: string;
}

/**
 * 3D Deformable Soft-Body Jelly Cube
 * Calibrated mass-spring lattice that falls with identical gravity acceleration
 * as rigid blocks and interacts naturally with cannonballs and explosions.
 */
export class SoftBody {
  public id: string;
  public mesh!: THREE.Mesh;
  public material!: THREE.Material;

  public readonly nodeCount = 27; // 3x3x3 lattice
  public positions: Float32Array;
  public prevPositions: Float32Array;
  public initialLocalPositions: Float32Array;
  public invMasses: Float32Array;

  public springs: SoftBodySpring[] = [];

  private baseGeometryVertices!: Float32Array;
  private vertexWeights: { indices: number[]; weights: number[] }[] = [];

  public stiffness: number;
  public damping: number;

  public grabbedNodeIndex: number | null = null;
  public grabTarget: THREE.Vector3 = new THREE.Vector3();

  // Scratch vectors
  private static vA = new THREE.Vector3();
  private static vB = new THREE.Vector3();

  constructor(config: SoftBodyConfig, scene: THREE.Scene) {
    this.id = config.id;
    this.stiffness = config.stiffness ?? 0.85;
    this.damping = config.damping ?? 0.985;

    this.positions = new Float32Array(this.nodeCount * 3);
    this.prevPositions = new Float32Array(this.nodeCount * 3);
    this.initialLocalPositions = new Float32Array(this.nodeCount * 3);
    this.invMasses = new Float32Array(this.nodeCount);

    this.setupLattice(config.size, config.position);
    this.setupSprings();
    this.createMesh(config.size, config.color, scene);
  }

  private getNodeIndex(x: number, y: number, z: number): number {
    return x * 9 + y * 3 + z;
  }

  private setupLattice(size: [number, number, number], center: [number, number, number]) {
    const halfX = size[0] / 2;
    const halfY = size[1] / 2;
    const halfZ = size[2] / 2;

    for (let x = 0; x < 3; x++) {
      const u = (x / 2) * 2 - 1;
      for (let y = 0; y < 3; y++) {
        const v = (y / 2) * 2 - 1;
        for (let z = 0; z < 3; z++) {
          const w = (z / 2) * 2 - 1;
          const idx = this.getNodeIndex(x, y, z);

          const lx = u * halfX;
          const ly = v * halfY;
          const lz = w * halfZ;

          this.initialLocalPositions[idx * 3] = lx;
          this.initialLocalPositions[idx * 3 + 1] = ly;
          this.initialLocalPositions[idx * 3 + 2] = lz;

          const wx = center[0] + lx;
          const wy = center[1] + ly;
          const wz = center[2] + lz;

          this.positions[idx * 3] = wx;
          this.positions[idx * 3 + 1] = wy;
          this.positions[idx * 3 + 2] = wz;

          this.prevPositions[idx * 3] = wx;
          this.prevPositions[idx * 3 + 1] = wy;
          this.prevPositions[idx * 3 + 2] = wz;

          this.invMasses[idx] = 1.0;
        }
      }
    }
  }

  private addSpring(p1: number, p2: number, stiffnessFactor: number = 1.0) {
    SoftBody.vA.set(this.positions[p1 * 3], this.positions[p1 * 3 + 1], this.positions[p1 * 3 + 2]);
    SoftBody.vB.set(this.positions[p2 * 3], this.positions[p2 * 3 + 1], this.positions[p2 * 3 + 2]);
    const restLength = SoftBody.vA.distanceTo(SoftBody.vB);

    this.springs.push({
      p1,
      p2,
      restLength,
      stiffness: this.stiffness * stiffnessFactor,
    });
  }

  private setupSprings() {
    this.springs = [];
    for (let x = 0; x < 3; x++) {
      for (let y = 0; y < 3; y++) {
        for (let z = 0; z < 3; z++) {
          const i1 = this.getNodeIndex(x, y, z);

          // Structural
          if (x + 1 < 3) this.addSpring(i1, this.getNodeIndex(x + 1, y, z), 1.0);
          if (y + 1 < 3) this.addSpring(i1, this.getNodeIndex(x, y + 1, z), 1.0);
          if (z + 1 < 3) this.addSpring(i1, this.getNodeIndex(x, y, z + 1), 1.0);

          // Shear
          if (x + 1 < 3 && y + 1 < 3) this.addSpring(i1, this.getNodeIndex(x + 1, y + 1, z), 0.9);
          if (x + 1 < 3 && y - 1 >= 0) this.addSpring(i1, this.getNodeIndex(x + 1, y - 1, z), 0.9);
          if (x + 1 < 3 && z + 1 < 3) this.addSpring(i1, this.getNodeIndex(x + 1, y, z + 1), 0.9);
          if (x + 1 < 3 && z - 1 >= 0) this.addSpring(i1, this.getNodeIndex(x + 1, y, z - 1), 0.9);
          if (y + 1 < 3 && z + 1 < 3) this.addSpring(i1, this.getNodeIndex(x, y + 1, z + 1), 0.9);
          if (y + 1 < 3 && z - 1 >= 0) this.addSpring(i1, this.getNodeIndex(x, y + 1, z - 1), 0.9);

          // Internal cross bracing
          if (x + 1 < 3 && y + 1 < 3 && z + 1 < 3) {
            this.addSpring(i1, this.getNodeIndex(x + 1, y + 1, z + 1), 0.8);
          }
          if (x + 1 < 3 && y + 1 < 3 && z - 1 >= 0) {
            this.addSpring(i1, this.getNodeIndex(x + 1, y + 1, z - 1), 0.8);
          }
        }
      }
    }
  }

  private createMesh(
    size: [number, number, number],
    color: string,
    scene: THREE.Scene
  ) {
    const geo = new THREE.BoxGeometry(size[0], size[1], size[2], 5, 5, 5);
    const posAttr = geo.attributes.position;
    const vertexCount = posAttr.count;

    this.baseGeometryVertices = new Float32Array(vertexCount * 3);
    this.vertexWeights = [];

    const halfX = size[0] / 2;
    const halfY = size[1] / 2;
    const halfZ = size[2] / 2;

    for (let i = 0; i < vertexCount; i++) {
      const vx = posAttr.getX(i);
      const vy = posAttr.getY(i);
      const vz = posAttr.getZ(i);

      this.baseGeometryVertices[i * 3] = vx;
      this.baseGeometryVertices[i * 3 + 1] = vy;
      this.baseGeometryVertices[i * 3 + 2] = vz;

      const nx = (vx / halfX + 1) / 2;
      const ny = (vy / halfY + 1) / 2;
      const nz = (vz / halfZ + 1) / 2;

      const x0 = nx < 0.5 ? 0 : 1;
      const x1 = x0 + 1;
      const tx = (nx - x0 * 0.5) / 0.5;

      const y0 = ny < 0.5 ? 0 : 1;
      const y1 = y0 + 1;
      const ty = (ny - y0 * 0.5) / 0.5;

      const z0 = nz < 0.5 ? 0 : 1;
      const z1 = z0 + 1;
      const tz = (nz - z0 * 0.5) / 0.5;

      const indices = [
        this.getNodeIndex(x0, y0, z0),
        this.getNodeIndex(x1, y0, z0),
        this.getNodeIndex(x0, y1, z0),
        this.getNodeIndex(x1, y1, z0),
        this.getNodeIndex(x0, y0, z1),
        this.getNodeIndex(x1, y0, z1),
        this.getNodeIndex(x0, y1, z1),
        this.getNodeIndex(x1, y1, z1),
      ];

      const weights = [
        (1 - tx) * (1 - ty) * (1 - tz),
        tx * (1 - ty) * (1 - tz),
        (1 - tx) * ty * (1 - tz),
        tx * ty * (1 - tz),
        (1 - tx) * (1 - ty) * tz,
        tx * (1 - ty) * tz,
        (1 - tx) * ty * tz,
        tx * ty * tz,
      ];

      this.vertexWeights.push({ indices, weights });
    }

    this.material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(color),
      roughness: 0.15,
      metalness: 0.05,
      transmission: 0.7,
      ior: 1.33,
      transparent: true,
      opacity: 0.92,
      clearcoat: 0.9,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.userData = { id: this.id, isSoftBody: true, softBody: this };

    scene.add(this.mesh);
    this.updateMeshGeometry();
  }

  /**
   * Physics Integration Step
   * Calibrated so soft bodies fall at identical gravitational acceleration as Rapier rigid bodies.
   */
  public update(
    dt: number,
    gravity: THREE.Vector3,
    floorY: number | ((x: number, z: number) => number) = 0.35
  ) {
    const subSteps = 3;
    const sdt = dt / subSteps;
    // Minimal air drag so it falls as fast as rigid blocks
    const airDrag = 0.9992;

    for (let s = 0; s < subSteps; s++) {
      // 1. Verlet Integration with exact gravity acceleration
      for (let i = 0; i < this.nodeCount; i++) {
        if (i === this.grabbedNodeIndex) {
          this.positions[i * 3] = this.grabTarget.x;
          this.positions[i * 3 + 1] = this.grabTarget.y;
          this.positions[i * 3 + 2] = this.grabTarget.z;
          this.prevPositions[i * 3] = this.grabTarget.x;
          this.prevPositions[i * 3 + 1] = this.grabTarget.y;
          this.prevPositions[i * 3 + 2] = this.grabTarget.z;
          continue;
        }

        const x = this.positions[i * 3];
        const y = this.positions[i * 3 + 1];
        const z = this.positions[i * 3 + 2];

        const px = this.prevPositions[i * 3];
        const py = this.prevPositions[i * 3 + 1];
        const pz = this.prevPositions[i * 3 + 2];

        // Velocity = position - prevPosition
        const vx = (x - px) * airDrag;
        const vy = (y - py) * airDrag;
        const vz = (z - pz) * airDrag;

        this.prevPositions[i * 3] = x;
        this.prevPositions[i * 3 + 1] = y;
        this.prevPositions[i * 3 + 2] = z;

        // Apply gravitational displacement matching rigid body acceleration:
        this.positions[i * 3] = x + vx + gravity.x * sdt * sdt;
        this.positions[i * 3 + 1] = y + vy + gravity.y * sdt * sdt;
        this.positions[i * 3 + 2] = z + vz + gravity.z * sdt * sdt;
      }

      // 2. Spring Relaxation
      for (let j = 0; j < this.springs.length; j++) {
        const spring = this.springs[j];
        const p1 = spring.p1;
        const p2 = spring.p2;

        const x1 = this.positions[p1 * 3];
        const y1 = this.positions[p1 * 3 + 1];
        const z1 = this.positions[p1 * 3 + 2];

        const x2 = this.positions[p2 * 3];
        const y2 = this.positions[p2 * 3 + 1];
        const z2 = this.positions[p2 * 3 + 2];

        const dx = x2 - x1;
        const dy = y2 - y1;
        const dz = z2 - z1;

        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
        const diff = (dist - spring.restLength) / dist;

        const w1 = p1 === this.grabbedNodeIndex ? 0 : this.invMasses[p1];
        const w2 = p2 === this.grabbedNodeIndex ? 0 : this.invMasses[p2];
        const wSum = w1 + w2;

        if (wSum > 0.0001) {
          const factor = diff * spring.stiffness * 0.5;

          const offsetX = dx * factor;
          const offsetY = dy * factor;
          const offsetZ = dz * factor;

          this.positions[p1 * 3] += (offsetX * w1) / wSum;
          this.positions[p1 * 3 + 1] += (offsetY * w1) / wSum;
          this.positions[p1 * 3 + 2] += (offsetZ * w1) / wSum;

          this.positions[p2 * 3] -= (offsetX * w2) / wSum;
          this.positions[p2 * 3 + 1] -= (offsetY * w2) / wSum;
          this.positions[p2 * 3 + 2] -= (offsetZ * w2) / wSum;
        }
      }

      // 3. Collision with Ground / Voxel Surface
      for (let i = 0; i < this.nodeCount; i++) {
        const nx = this.positions[i * 3];
        const nz = this.positions[i * 3 + 2];
        const targetFloor = typeof floorY === 'function' ? floorY(nx, nz) : floorY;

        if (this.positions[i * 3 + 1] < targetFloor) {
          const pen = targetFloor - this.positions[i * 3 + 1];
          this.positions[i * 3 + 1] = targetFloor;

          const vx = this.positions[i * 3] - this.prevPositions[i * 3];
          const vz = this.positions[i * 3 + 2] - this.prevPositions[i * 3 + 2];

          this.prevPositions[i * 3] = this.positions[i * 3] - vx * 0.35;
          this.prevPositions[i * 3 + 2] = this.positions[i * 3 + 2] - vz * 0.35;
          this.prevPositions[i * 3 + 1] = targetFloor + pen * 0.3;

          if (pen > 0.15 && s === 0) {
            soundManager.playImpact('rubber', Math.min(pen * 2.0, 0.7));
          }
        }
      }
    }

    this.updateMeshGeometry();
  }

  /**
   * Safe physical momentum transfer (for cannonball & blast impacts without teleporting)
   */
  public addVelocity(velocityDelta: THREE.Vector3, dt: number = 0.016) {
    const substepScale = dt / 3;
    for (let i = 0; i < this.nodeCount; i++) {
      this.prevPositions[i * 3] -= velocityDelta.x * substepScale;
      this.prevPositions[i * 3 + 1] -= velocityDelta.y * substepScale;
      this.prevPositions[i * 3 + 2] -= velocityDelta.z * substepScale;
    }
  }

  public applyImpulse(epicenter: THREE.Vector3, strength: number, radius: number = 8.0) {
    for (let i = 0; i < this.nodeCount; i++) {
      SoftBody.vA.set(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]);
      const dist = SoftBody.vA.distanceTo(epicenter);

      if (dist < radius && dist > 0.001) {
        const dir = SoftBody.vA.clone().sub(epicenter).normalize();
        dir.y = Math.max(dir.y + 0.3, 0.2); // lift

        const force = Math.min(strength * Math.pow(1 - dist / radius, 1.5) * 0.004, 0.5);
        this.prevPositions[i * 3] -= dir.x * force;
        this.prevPositions[i * 3 + 1] -= dir.y * force;
        this.prevPositions[i * 3 + 2] -= dir.z * force;
      }
    }
  }

  public findClosestNode(point: THREE.Vector3): number {
    let closestIdx = 0;
    let minDist = Infinity;

    for (let i = 0; i < this.nodeCount; i++) {
      SoftBody.vA.set(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]);
      const dist = SoftBody.vA.distanceTo(point);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = i;
      }
    }
    return closestIdx;
  }

  public getCenter(): THREE.Vector3 {
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < this.nodeCount; i++) {
      cx += this.positions[i * 3];
      cy += this.positions[i * 3 + 1];
      cz += this.positions[i * 3 + 2];
    }
    return new THREE.Vector3(cx / this.nodeCount, cy / this.nodeCount, cz / this.nodeCount);
  }

  public getBoundingRadius(): number {
    const center = this.getCenter();
    let maxR = 0;
    for (let i = 0; i < this.nodeCount; i++) {
      SoftBody.vA.set(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]);
      const d = SoftBody.vA.distanceTo(center);
      if (d > maxR) maxR = d;
    }
    return maxR;
  }

  private updateMeshGeometry() {
    const geo = this.mesh.geometry as THREE.BufferGeometry;
    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const array = posAttr.array as Float32Array;

    for (let i = 0; i < this.vertexWeights.length; i++) {
      const { indices, weights } = this.vertexWeights[i];
      let x = 0, y = 0, z = 0;

      for (let k = 0; k < 8; k++) {
        const nodeIdx = indices[k];
        const w = weights[k];
        x += this.positions[nodeIdx * 3] * w;
        y += this.positions[nodeIdx * 3 + 1] * w;
        z += this.positions[nodeIdx * 3 + 2] * w;
      }

      array[i * 3] = x;
      array[i * 3 + 1] = y;
      array[i * 3 + 2] = z;
    }

    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  }

  public dispose(scene: THREE.Scene) {
    if (this.mesh) {
      scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      if (Array.isArray(this.mesh.material)) {
        this.mesh.material.forEach((m) => m.dispose());
      } else {
        this.mesh.material.dispose();
      }
    }
  }
}
