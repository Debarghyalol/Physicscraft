import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  BlockMaterial,
  BlockShape,
  PhysicsBlockData,
  StructurePreset,
  VisualTheme,
  VoxelType,
  PhysicsContraption,
  ContraptionBlockInfo,
  PhysicsJointInfo,
  JointType,
} from '../types/physics';
import { MATERIAL_CONFIGS, getThreeMaterial } from './materials';
import { soundManager } from '../audio/SoundEffects';
import { SoftBody } from './SoftBody';
import { VoxelWorld } from '../rendering/VoxelWorld';
import { PlayerController, PlayerInput } from '../player/PlayerController';
import { SelectionBoxRenderer } from '../rendering/SelectionBoxRenderer';

export interface PhysicsEntity {
  id: string;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  mesh: THREE.Mesh;
  data: PhysicsBlockData;
}

export interface ParticleEffect {
  mesh: THREE.Points | THREE.Mesh;
  velocities?: THREE.Vector3[];
  life: number;
  maxLife: number;
  update: (delta: number) => boolean;
}

export class PhysicsEngine {
  public world!: RAPIER.World;
  public RAPIER_INSTANCE!: typeof RAPIER;
  public isReady: boolean = false;

  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public voxelWorld!: VoxelWorld;
  public player!: PlayerController;
  public selectionRenderer: SelectionBoxRenderer;

  private entities: Map<string, PhysicsEntity> = new Map();
  private colliderToEntity: Map<number, PhysicsEntity> = new Map();
  public softBodies: Map<string, SoftBody> = new Map();
  public contraptions: Map<string, PhysicsContraption> = new Map();
  public joints: Map<string, PhysicsJointInfo> = new Map();
  private colliderToContraption: Map<number, PhysicsContraption> = new Map();
  private eventQueue!: RAPIER.EventQueue;

  // Static ground colliders
  private floorBody!: RAPIER.RigidBody;
  private floorCollider!: RAPIER.Collider;
  public hasWalls: boolean = false;

  // Grab & Drag state
  public grabbedEntity: PhysicsEntity | null = null;
  public grabbedSoftBody: { body: SoftBody; nodeIndex: number } | null = null;
  public grabbedContraption: PhysicsContraption | null = null;
  private grabOffset: THREE.Vector3 = new THREE.Vector3();
  private dragPlane: THREE.Plane = new THREE.Plane();
  private dragTargetPos: THREE.Vector3 = new THREE.Vector3();
  private dragVelocityHistory: { pos: THREE.Vector3; time: number }[] = [];

  // Active particles & animations
  private activeParticles: ParticleEffect[] = [];

  // Global settings
  public timeScale: number = 1.0;
  public baseGravityMagnitude: number = 9.81;
  public currentGravityVector: THREE.Vector3 = new THREE.Vector3(0, -9.81, 0);
  public currentTheme: VisualTheme = 'realistic';

  // Soft-body collision debouncing
  private softBodyContactCooldowns: Map<string, number> = new Map();

  // Scratch objects for zero GC allocation in 60fps loop
  private static scratchVec3 = new THREE.Vector3();
  private static scratchCamDir = new THREE.Vector3();

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
    this.voxelWorld = new VoxelWorld(scene);
    this.selectionRenderer = new SelectionBoxRenderer(scene);
  }

  public async initialize(): Promise<void> {
    await RAPIER.init();
    this.RAPIER_INSTANCE = RAPIER;

    const gravity = new RAPIER.Vector3(0.0, -this.baseGravityMagnitude, 0.0);
    this.world = new RAPIER.World(gravity);
    this.eventQueue = new RAPIER.EventQueue(true);

    this.voxelWorld.setRapierWorld(this.world);

    // Create Rapier-powered Player Character (Steve) standing safely on grass outside structure zone
    const spawnX = 0;
    const spawnZ = 6.0;
    const groundY = this.voxelWorld.getElevationAt(spawnX, spawnZ);
    this.player = new PlayerController(this.world, this.scene, this.camera, this.voxelWorld, [spawnX, groundY + 1.25, spawnZ]);
    this.player.yaw = 0;
    this.player.pitch = -0.05;

    this.isReady = true;
  }

  /**
   * Bedrock bottom fallback collider (y=0) to prevent falling through bottom of world
   */
  public setWallsEnabled(enabled: boolean) {
    this.hasWalls = enabled;
  }

  public setVisualTheme(theme: VisualTheme) {
    this.currentTheme = theme;
    for (const entity of this.entities.values()) {
      entity.mesh.material = getThreeMaterial(entity.data.material, theme);
    }
  }

  /**
   * Spawn a Deformable Soft-Body Jelly Block
   */
  public spawnSoftBody(
    position: [number, number, number] = [0, 4, 0],
    size: [number, number, number] = [1.8, 1.8, 1.8],
    color?: string,
    stiffness: number = 0.85
  ): SoftBody {
    const id = `soft_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const jellyColors = ['#ec4899', '#06b6d4', '#10b981', '#f59e0b', '#8b5cf6'];
    const pickedColor = color || jellyColors[this.softBodies.size % jellyColors.length];

    const softBody = new SoftBody(
      {
        id,
        size,
        position,
        stiffness,
        damping: 0.985,
        color: pickedColor,
      },
      this.scene
    );

    this.softBodies.set(id, softBody);
    return softBody;
  }

  public removeSoftBody(id: string) {
    const sb = this.softBodies.get(id);
    if (!sb) return;

    if (this.grabbedSoftBody?.body.id === id) {
      this.releaseGrab();
    }

    sb.dispose(this.scene);
    this.softBodies.delete(id);
  }

  /**
   * Spawns a standard rigid physics block
   */
  public spawnBlock(
    shape: BlockShape,
    materialType: BlockMaterial,
    position: [number, number, number] = [0, 4, 0],
    customSize?: [number, number, number],
    rotationEuler: [number, number, number] = [0, 0, 0],
    initialLinvel: [number, number, number] = [0, 0, 0]
  ): PhysicsEntity | SoftBody {
    if (shape === 'softbody') {
      return this.spawnSoftBody(position, customSize || [1.8, 1.8, 1.8]);
    }

    const id = `block_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const matConfig = MATERIAL_CONFIGS[materialType];

    let defaultSize: [number, number, number] = [1.2, 1.2, 1.2];
    if (shape === 'plank') {
      defaultSize = [3.6, 0.6, 1.2];
    } else if (shape === 'domino') {
      defaultSize = [0.4, 1.6, 0.8];
    } else if (shape === 'cylinder') {
      defaultSize = [0.6, 2.0, 0.6];
    } else if (shape === 'sphere') {
      defaultSize = [0.8, 0.8, 0.8];
    } else if (shape === 'pyramid') {
      defaultSize = [1.4, 1.2, 1.4];
    }

    const size = customSize || defaultSize;

    // Create Rapier RigidBody
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotationEuler));
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position[0], position[1], position[2])
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinvel(initialLinvel[0], initialLinvel[1], initialLinvel[2])
      .setLinearDamping(0.04)
      .setAngularDamping(0.08)
      .setCanSleep(true);

    const body = this.world.createRigidBody(bodyDesc);

    // Create Rapier Collider with active collision events
    let colliderDesc: RAPIER.ColliderDesc;
    if (shape === 'sphere') {
      colliderDesc = RAPIER.ColliderDesc.ball(size[0]);
    } else if (shape === 'cylinder') {
      colliderDesc = RAPIER.ColliderDesc.cylinder(size[1] / 2, size[0]);
    } else if (shape === 'pyramid') {
      colliderDesc = RAPIER.ColliderDesc.cone(size[1] / 2, size[0]);
    } else {
      colliderDesc = RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2);
    }

    colliderDesc
      .setDensity(matConfig.density)
      .setFriction(matConfig.friction)
      .setRestitution(matConfig.restitution)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

    const collider = this.world.createCollider(colliderDesc, body);

    // Create Three.js Mesh
    let geo: THREE.BufferGeometry;
    if (shape === 'sphere') {
      geo = new THREE.SphereGeometry(size[0], 28, 28);
    } else if (shape === 'cylinder') {
      geo = new THREE.CylinderGeometry(size[0], size[0], size[1], 24);
    } else if (shape === 'pyramid') {
      geo = new THREE.ConeGeometry(size[0], size[1], 4);
      geo.rotateY(Math.PI / 4);
    } else {
      geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
    }

    const mat = getThreeMaterial(materialType, this.currentTheme);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(position[0], position[1], position[2]);
    mesh.quaternion.copy(q);

    mesh.userData = { id, shape, material: materialType };
    this.scene.add(mesh);

    const entity: PhysicsEntity = {
      id,
      body,
      collider,
      mesh,
      data: {
        id,
        shape,
        material: materialType,
        size,
        createdAt: Date.now(),
        isTNT: materialType === 'tnt',
      },
    };

    this.entities.set(id, entity);
    this.colliderToEntity.set(collider.handle, entity);
    return entity;
  }

  public removeBlock(id: string) {
    if (this.softBodies.has(id)) {
      this.removeSoftBody(id);
      return;
    }

    const entity = this.entities.get(id);
    if (!entity) return;

    if (this.grabbedEntity?.id === id) {
      this.releaseGrab();
    }

    this.colliderToEntity.delete(entity.collider.handle);
    this.world.removeCollider(entity.collider, false);
    this.world.removeRigidBody(entity.body);
    this.scene.remove(entity.mesh);
    entity.mesh.geometry.dispose();
    this.entities.delete(id);
  }

  public clearAllBlocks() {
    this.releaseGrab();
    for (const id of Array.from(this.entities.keys())) {
      this.removeBlock(id);
    }
    for (const id of Array.from(this.softBodies.keys())) {
      this.removeSoftBody(id);
    }
    for (const id of Array.from(this.contraptions.keys())) {
      this.removeContraption(id);
    }
    this.clearAllJoints();
    this.colliderToEntity.clear();
    this.colliderToContraption.clear();
  }

  public getBlockCount(): number {
    let contraptionBlockCount = 0;
    for (const c of this.contraptions.values()) {
      contraptionBlockCount += c.blocks.length;
    }
    return this.entities.size + this.softBodies.size + contraptionBlockCount;
  }

  public getAllMeshes(): THREE.Mesh[] {
    const list: THREE.Mesh[] = [];
    for (const e of this.entities.values()) list.push(e.mesh);
    for (const sb of this.softBodies.values()) list.push(sb.mesh);
    for (const c of this.contraptions.values()) {
      c.group.traverse((child: any) => {
        if (child.isMesh) list.push(child);
      });
    }
    return list;
  }

  public pickBlock(normalizedRay: THREE.Ray): {
    entity?: PhysicsEntity;
    softBody?: SoftBody;
    contraption?: PhysicsContraption;
    hitPoint: THREE.Vector3;
  } | null {
    const meshes = this.getAllMeshes();
    const raycaster = new THREE.Raycaster();
    raycaster.ray.copy(normalizedRay);

    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      const topHit = hits[0];
      const mesh = topHit.object as THREE.Mesh;

      if (mesh.userData?.isSoftBody && mesh.userData?.softBody) {
        return {
          softBody: mesh.userData.softBody as SoftBody,
          hitPoint: topHit.point,
        };
      }

      // Check if child of a contraption
      let cur: THREE.Object3D | null = mesh;
      while (cur) {
        if (cur.userData?.isContraption && cur.userData?.id) {
          const contraption = this.contraptions.get(cur.userData.id);
          if (contraption) {
            return {
              contraption,
              hitPoint: topHit.point,
            };
          }
        }
        cur = cur.parent;
      }

      const entityId = mesh.userData?.id;
      if (entityId && this.entities.has(entityId)) {
        return {
          entity: this.entities.get(entityId)!,
          hitPoint: topHit.point,
        };
      }
    }
    return null;
  }

  public startGrab(
    target: { entity?: PhysicsEntity; softBody?: SoftBody; contraption?: PhysicsContraption },
    hitPoint: THREE.Vector3
  ) {
    this.camera.getWorldDirection(PhysicsEngine.scratchCamDir);
    this.dragPlane.setFromNormalAndCoplanarPoint(PhysicsEngine.scratchCamDir.negate(), hitPoint);

    this.dragTargetPos.copy(hitPoint);
    this.dragVelocityHistory = [{ pos: hitPoint.clone(), time: performance.now() }];

    if (target.softBody) {
      this.grabbedSoftBody = {
        body: target.softBody,
        nodeIndex: target.softBody.findClosestNode(hitPoint),
      };
      target.softBody.grabbedNodeIndex = this.grabbedSoftBody.nodeIndex;
      target.softBody.grabTarget.copy(hitPoint);
    } else if (target.contraption) {
      this.grabbedContraption = target.contraption;
      this.grabbedContraption.body.wakeUp();
      const p = target.contraption.body.translation();
      this.grabOffset.copy(new THREE.Vector3(p.x, p.y, p.z)).sub(hitPoint);
    } else if (target.entity) {
      this.grabbedEntity = target.entity;
      this.grabbedEntity.body.wakeUp();
      this.grabOffset.copy(target.entity.mesh.position).sub(hitPoint);
    }

    soundManager.playPop(true);
  }

  public updateGrab(ray: THREE.Ray) {
    const intersection = PhysicsEngine.scratchVec3;
    if (ray.intersectPlane(this.dragPlane, intersection)) {
      this.dragTargetPos.copy(intersection);

      const now = performance.now();
      this.dragVelocityHistory.push({ pos: intersection.clone(), time: now });
      while (this.dragVelocityHistory.length > 0 && now - this.dragVelocityHistory[0].time > 120) {
        this.dragVelocityHistory.shift();
      }

      if (this.grabbedSoftBody) {
        this.grabbedSoftBody.body.grabTarget.copy(intersection);
      } else if (this.grabbedContraption) {
        const targetPos = this.dragTargetPos.clone().add(this.grabOffset);
        const currentPos = this.grabbedContraption.body.translation();
        const dir = targetPos.sub(new THREE.Vector3(currentPos.x, currentPos.y, currentPos.z));
        this.grabbedContraption.body.setLinvel(
          { x: dir.x * 12, y: dir.y * 12, z: dir.z * 12 },
          true
        );
      }
    }
  }

  public releaseGrab() {
    if (this.grabbedSoftBody) {
      this.grabbedSoftBody.body.grabbedNodeIndex = null;
      this.grabbedSoftBody = null;
    }

    if (this.grabbedContraption) {
      if (this.dragVelocityHistory.length >= 2) {
        const oldest = this.dragVelocityHistory[0];
        const newest = this.dragVelocityHistory[this.dragVelocityHistory.length - 1];
        const dt = (newest.time - oldest.time) / 1000;

        if (dt > 0.015) {
          const vel = newest.pos.clone().sub(oldest.pos).divideScalar(dt);
          vel.clampLength(0, 35);
          this.grabbedContraption.body.setLinvel(
            { x: vel.x * 0.9, y: vel.y * 0.9, z: vel.z * 0.9 },
            true
          );
        }
      }
      this.grabbedContraption = null;
    }

    if (this.grabbedEntity) {
      if (this.dragVelocityHistory.length >= 2) {
        const oldest = this.dragVelocityHistory[0];
        const newest = this.dragVelocityHistory[this.dragVelocityHistory.length - 1];
        const dt = (newest.time - oldest.time) / 1000;

        if (dt > 0.015) {
          const vel = newest.pos.clone().sub(oldest.pos).divideScalar(dt);
          vel.clampLength(0, 35);
          this.grabbedEntity.body.setLinvel({ x: vel.x * 0.9, y: vel.y * 0.9, z: vel.z * 0.9 }, true);
        }
      }
      this.grabbedEntity = null;
    }

    soundManager.playPop(false);
    this.dragVelocityHistory = [];
  }

  public shootCannonball(ray: THREE.Ray, power: number = 42) {
    soundManager.playCannonShoot();

    // Spawn 1.2m ahead along aim ray to avoid intersecting player
    const spawnPos = ray.origin.clone().add(ray.direction.clone().multiplyScalar(1.2));
    const ball = this.spawnBlock('sphere', 'metal', [spawnPos.x, spawnPos.y, spawnPos.z], [0.65, 0.65, 0.65]) as PhysicsEntity;

    const shootVel = ray.direction.clone().multiplyScalar(power);
    ball.body.setLinvel({ x: shootVel.x, y: shootVel.y, z: shootVel.z }, true);

    this.createMuzzleFlash(spawnPos, ray.direction);
  }

  public triggerExplosion(epicenter: THREE.Vector3, radius: number = 9.5, strength: number = 70.0) {
    soundManager.playExplosion();
    this.createExplosionVisual(epicenter);

    // Blast player knockback
    if (this.player && this.player.body) {
      const pPos = this.player.body.translation();
      const pVec = new THREE.Vector3(pPos.x, pPos.y, pPos.z);
      const pDist = pVec.distanceTo(epicenter);
      if (pDist < radius && pDist > 0.05) {
        const pDir = pVec.clone().sub(epicenter).normalize();
        pDir.y = Math.max(pDir.y + 0.45, 0.3);
        const impulse = (strength * 0.4) * Math.pow(1 - pDist / radius, 1.2);
        this.player.applyImpulse({ x: pDir.x * impulse, y: pDir.y * impulse + 3.5, z: pDir.z * impulse });
      }
    }

    // Minecraft Destructible Voxel Terrain crater
    const ex = Math.floor(epicenter.x);
    const ey = Math.floor(epicenter.y);
    const ez = Math.floor(epicenter.z);
    const rBlocks = Math.ceil(radius * 0.42);
    this.voxelWorld.beginBatch();
    for (let bx = ex - rBlocks; bx <= ex + rBlocks; bx++) {
      for (let by = ey - rBlocks; by <= ey + rBlocks; by++) {
        for (let bz = ez - rBlocks; bz <= ez + rBlocks; bz++) {
          if (Math.hypot(bx - ex, by - ey, bz - ez) < radius * 0.36) {
            const v = this.voxelWorld.getVoxel(bx, by, bz);
            if (v !== VoxelType.AIR && v !== VoxelType.BEDROCK) {
              this.voxelWorld.setVoxel(bx, by, bz, VoxelType.AIR);
            }
          }
        }
      }
    }
    this.voxelWorld.endBatch();

    for (const entity of this.entities.values()) {
      const bodyPos = entity.body.translation();
      const currentPos = new THREE.Vector3(bodyPos.x, bodyPos.y, bodyPos.z);
      const dist = currentPos.distanceTo(epicenter);

      if (dist < radius && dist > 0.001) {
        entity.body.wakeUp();
        const dir = currentPos.clone().sub(epicenter).normalize();
        dir.y = Math.max(dir.y + 0.45, 0.2);
        dir.normalize();

        const falloff = Math.pow(1 - dist / radius, 1.5);
        const impulseMagnitude = strength * falloff * entity.body.mass();

        entity.body.applyImpulse(
          {
            x: dir.x * impulseMagnitude,
            y: dir.y * impulseMagnitude,
            z: dir.z * impulseMagnitude,
          },
          true
        );

        if (entity.data.isTNT && dist < radius * 0.65) {
          setTimeout(() => {
            if (this.entities.has(entity.id)) {
              this.detonateTNT(entity);
            }
          }, 120 + Math.random() * 150);
        }
      }
    }

    for (const sb of this.softBodies.values()) {
      sb.applyImpulse(epicenter, strength * 0.8, radius);
    }
  }

  public detonateTNT(entity: PhysicsEntity) {
    const pos = entity.mesh.position.clone();
    this.removeBlock(entity.id);
    this.triggerExplosion(pos, 10.0, 85.0);
  }

  public triggerVortex(center: THREE.Vector3, strength: number = 38.0) {
    soundManager.triggerHaptic([20, 20, 30]);

    for (const entity of this.entities.values()) {
      const bodyPos = entity.body.translation();
      const currentPos = new THREE.Vector3(bodyPos.x, bodyPos.y, bodyPos.z);
      const dir = center.clone().sub(currentPos);
      const dist = dir.length();

      if (dist > 0.2 && dist < 25) {
        entity.body.wakeUp();
        dir.normalize();
        const pull = (strength * entity.body.mass()) / Math.max(dist, 1.2);
        entity.body.applyImpulse({ x: dir.x * pull, y: (dir.y + 0.3) * pull, z: dir.z * pull }, true);
      }
    }

    for (const sb of this.softBodies.values()) {
      sb.applyImpulse(center, -strength * 0.5, 22);
    }
  }

  public setGravityVector(x: number, y: number, z: number) {
    this.currentGravityVector.set(x, y, z);
    if (this.world) {
      this.world.gravity = new this.RAPIER_INSTANCE.Vector3(x, y, z);
      for (const e of this.entities.values()) {
        e.body.wakeUp();
      }
    }
  }

  public applyAndroidGyroTilt(beta: number, gamma: number) {
    const pitchOffset = 45;
    const radBeta = THREE.MathUtils.degToRad(beta - pitchOffset);
    const radGamma = THREE.MathUtils.degToRad(gamma);

    const gx = Math.sin(radGamma) * this.baseGravityMagnitude;
    const gz = Math.sin(radBeta) * this.baseGravityMagnitude;
    const gy = -Math.cos(radGamma) * Math.cos(radBeta) * this.baseGravityMagnitude;

    this.setGravityVector(gx, gy, gz);
  }

  public loadPreset(preset: StructurePreset) {
    this.clearAllBlocks();

    // Position player cleanly outside any preset structure area so player never clips inside blocks
    if (this.player) {
      const spawnX = 0;
      const spawnZ = 6.0;
      const groundY = this.voxelWorld.getElevationAt(spawnX, spawnZ);
      this.player.teleport(spawnX, groundY + 1.25, spawnZ);
      this.player.yaw = 0;
      this.player.pitch = -0.05;
    }

    switch (preset) {
      case 'contraption':
        this.buildContraptionShowcase();
        break;
      case 'articulated_arm':
        this.buildArticulatedArm();
        break;
      case 'bridge':
        this.buildSuspensionBridge();
        break;
      case 'softbody':
        this.buildSoftBodyShowcase();
        break;
      case 'jenga':
        this.buildJengaTower();
        break;
      case 'dominoes':
        this.buildDominoRun();
        break;
      case 'castle':
        this.buildCastle();
        break;
      case 'pyramid':
        this.buildPyramid();
        break;
      case 'cradle':
        this.buildWreckingBallScene();
        break;
      case 'empty':
      default:
        // Empty world: no starter physics objects
        break;
    }
  }

  // --------------------------------------------------------------------------
  // CONTRAPTION / PHYSICS MAKER SYSTEM (Create / Aeronautics / Valkyrien Skies)
  // --------------------------------------------------------------------------

  public assembleContraptionFromSelection(): PhysicsContraption | null {
    const bounds = this.selectionRenderer.getBounds();
    if (!bounds) return null;
    return this.assembleContraption(bounds.min, bounds.max);
  }

  public assembleContraption(min: THREE.Vector3, max: THREE.Vector3): PhysicsContraption | null {
    const minX = Math.floor(Math.min(min.x, max.x));
    const maxX = Math.floor(Math.max(min.x, max.x));
    const minY = Math.floor(Math.min(min.y, max.y));
    const maxY = Math.floor(Math.max(min.y, max.y));
    const minZ = Math.floor(Math.min(min.z, max.z));
    const maxZ = Math.floor(Math.max(min.z, max.z));

    const blocks: { x: number; y: number; z: number; type: VoxelType }[] = [];
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const v = this.voxelWorld.getVoxel(x, y, z);
          if (v !== VoxelType.AIR && v !== VoxelType.BEDROCK) {
            blocks.push({ x, y, z, type: v });
            sumX += x + 0.5;
            sumY += y + 0.5;
            sumZ += z + 0.5;
          }
        }
      }
    }

    if (blocks.length === 0) {
      return null;
    }

    // 1. Center of Mass
    const com = new THREE.Vector3(
      sumX / blocks.length,
      sumY / blocks.length,
      sumZ / blocks.length
    );

    // 2. Remove all selected blocks from static VoxelWorld (chunk meshes & colliders update!)
    for (const b of blocks) {
      this.voxelWorld.setVoxel(b.x, b.y, b.z, VoxelType.AIR);
    }

    // 3. Create ONE Dynamic Rapier RigidBody at COM
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(com.x, com.y, com.z)
      .setLinearDamping(0.04)
      .setAngularDamping(0.08)
      .setCanSleep(true);
    const body = this.world.createRigidBody(bodyDesc);

    const colliders: RAPIER.Collider[] = [];
    const contraptionBlocks: ContraptionBlockInfo[] = [];

    // 4. Create Three.js Group
    const group = new THREE.Group();
    group.position.copy(com);

    const id = `contraption_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    group.userData = { id, isContraption: true };

    let totalMass = 0;

    // 5. Build compound colliders & block meshes
    for (const b of blocks) {
      const relX = b.x + 0.5 - com.x;
      const relY = b.y + 0.5 - com.y;
      const relZ = b.z + 0.5 - com.z;

      contraptionBlocks.push({
        relX,
        relY,
        relZ,
        type: b.type,
      });

      // Density calculation
      let density = 1.0;
      if (b.type === VoxelType.STONE || b.type === VoxelType.COBBLESTONE) density = 2.4;
      else if (b.type === VoxelType.GOLD) density = 5.0;
      else if (b.type === VoxelType.WOOD) density = 0.8;
      else if (b.type === VoxelType.GLASS) density = 1.2;

      totalMass += density;

      // Compound collider
      const colDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
        .setTranslation(relX, relY, relZ)
        .setDensity(density)
        .setFriction(0.45)
        .setRestitution(0.12)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

      const col = this.world.createCollider(colDesc, body);
      colliders.push(col);

      // Block Mesh
      const mesh = this.createContraptionBlockMesh(b.type);
      mesh.position.set(relX, relY, relZ);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    this.scene.add(group);

    const contraption: PhysicsContraption = {
      id,
      body,
      colliders,
      group,
      blocks: contraptionBlocks,
      centerOfMass: { x: com.x, y: com.y, z: com.z },
      mass: totalMass,
    };

    this.contraptions.set(id, contraption);
    for (const col of colliders) {
      this.colliderToContraption.set(col.handle, contraption);
    }

    // Audio & particles
    soundManager.playAssemble();
    this.createAssembleSparks(com, Math.max(2, Math.sqrt(blocks.length)));

    // Clear selection
    this.selectionRenderer.clear();

    return contraption;
  }

  public disassembleContraption(id: string): boolean {
    const c = this.contraptions.get(id);
    if (!c) return false;

    // Remove any connected joints
    for (const [jid, j] of this.joints.entries()) {
      if (j.bodyAId === id || j.bodyBId === id) {
        this.removeJoint(jid);
      }
    }

    // Unfuse blocks back into static voxel world at current world positions
    const pos = c.body.translation();
    const rot = c.body.rotation();
    const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const basePos = new THREE.Vector3(pos.x, pos.y, pos.z);

    for (const b of c.blocks) {
      const worldPos = new THREE.Vector3(b.relX, b.relY, b.relZ).applyQuaternion(q).add(basePos);
      const bx = Math.round(worldPos.x - 0.5);
      const by = Math.round(worldPos.y - 0.5);
      const bz = Math.round(worldPos.z - 0.5);

      if (by >= 1 && by < 28) {
        this.voxelWorld.setVoxel(bx, by, bz, b.type);
      }
    }

    // Remove physics body and group
    for (const col of c.colliders) {
      this.colliderToContraption.delete(col.handle);
      this.world.removeCollider(col, false);
    }
    this.world.removeRigidBody(c.body);
    this.scene.remove(c.group);

    c.group.traverse((obj: any) => {
      if (obj.geometry) obj.geometry.dispose();
    });

    this.contraptions.delete(id);
    soundManager.playPop(false);
    return true;
  }

  public removeContraption(id: string) {
    const c = this.contraptions.get(id);
    if (!c) return;

    if (this.grabbedContraption?.id === id) {
      this.releaseGrab();
    }

    for (const [jid, j] of this.joints.entries()) {
      if (j.bodyAId === id || j.bodyBId === id) {
        this.removeJoint(jid);
      }
    }

    for (const col of c.colliders) {
      this.colliderToContraption.delete(col.handle);
      this.world.removeCollider(col, false);
    }
    this.world.removeRigidBody(c.body);
    this.scene.remove(c.group);
    c.group.traverse((obj: any) => {
      if (obj.geometry) obj.geometry.dispose();
    });
    this.contraptions.delete(id);
  }

  public createContraptionBlockMesh(voxelType: VoxelType): THREE.Mesh {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const tileW = 1.0 / 16.0;

    const uvs: number[] = [];
    const colors: number[] = [];
    const faceLights = [0.68, 0.68, 1.0, 0.52, 0.82, 0.82];

    for (let face = 0; face < 6; face++) {
      const [tileCol, tileRow] = (this.voxelWorld as any).getVoxelFaceTile(voxelType, face);
      const u0 = tileCol * tileW;
      const u1 = u0 + tileW;
      const v0 = 1.0 - (tileRow + 1) * tileW;
      const v1 = 1.0 - tileRow * tileW;

      uvs.push(
        u0, v1,
        u1, v1,
        u0, v0,
        u1, v0
      );

      const light = faceLights[face];
      for (let i = 0; i < 4; i++) {
        colors.push(light, light, light);
      }
    }

    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mat = voxelType === VoxelType.GLASS ? this.voxelWorld.transparentMaterial : this.voxelWorld.material;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { isContraptionBlock: true, voxelType };
    return mesh;
  }

  private createAssembleSparks(center: THREE.Vector3, radius: number = 3.0) {
    const count = 32;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const vels: THREE.Vector3[] = [];

    for (let i = 0; i < count; i++) {
      pos[i * 3] = center.x + (Math.random() - 0.5) * radius;
      pos[i * 3 + 1] = center.y + (Math.random() - 0.5) * radius;
      pos[i * 3 + 2] = center.z + (Math.random() - 0.5) * radius;

      vels.push(
        new THREE.Vector3(
          (Math.random() - 0.5) * 5,
          Math.random() * 4 + 2,
          (Math.random() - 0.5) * 5
        )
      );
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x38bdf8,
      size: 0.32,
      transparent: true,
      opacity: 1.0,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);

    this.activeParticles.push({
      mesh: points,
      life: 0,
      maxLife: 0.6,
      update: (dt) => {
        const arr = (geo.attributes.position as THREE.BufferAttribute).array as Float32Array;
        for (let i = 0; i < count; i++) {
          vels[i].y -= 9.8 * dt;
          arr[i * 3] += vels[i].x * dt;
          arr[i * 3 + 1] += vels[i].y * dt;
          arr[i * 3 + 2] += vels[i].z * dt;
        }
        geo.attributes.position.needsUpdate = true;
        mat.opacity = Math.max(0, 1 - points.userData.life / 0.6);
        return true;
      },
    });
  }

  // --------------------------------------------------------------------------
  // JOINT CONSTRAINTS (Hinge, Distance / Spring, Fixed Weld)
  // --------------------------------------------------------------------------

  public getBodyById(id: string): RAPIER.RigidBody | null {
    if (this.entities.has(id)) return this.entities.get(id)!.body;
    if (this.contraptions.has(id)) return this.contraptions.get(id)!.body;
    return null;
  }

  public createHingeJoint(
    bodyAId: string,
    bodyBId: string,
    anchorA: THREE.Vector3,
    anchorB: THREE.Vector3,
    axis: THREE.Vector3 = new THREE.Vector3(0, 1, 0)
  ): PhysicsJointInfo | null {
    const bodyA = this.getBodyById(bodyAId);
    const bodyB = this.getBodyById(bodyBId);
    if (!bodyA || !bodyB) return null;

    const rAnchorA = new RAPIER.Vector3(anchorA.x, anchorA.y, anchorA.z);
    const rAnchorB = new RAPIER.Vector3(anchorB.x, anchorB.y, anchorB.z);
    const rAxis = new RAPIER.Vector3(axis.x, axis.y, axis.z);

    const jointData = RAPIER.JointData.revolute(rAnchorA, rAnchorB, rAxis);
    const joint = this.world.createImpulseJoint(jointData, bodyA, bodyB, true);

    const id = `joint_hinge_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // Visual Hinge Axle Pin (metallic brass cylinder)
    const pinGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.8, 16);
    const pinMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      metalness: 0.85,
      roughness: 0.25,
    });
    const visualMesh = new THREE.Mesh(pinGeo, pinMat);
    this.scene.add(visualMesh);

    const jointInfo: PhysicsJointInfo = {
      id,
      type: 'revolute',
      joint,
      bodyAId,
      bodyBId,
      anchorA: { x: anchorA.x, y: anchorA.y, z: anchorA.z },
      anchorB: { x: anchorB.x, y: anchorB.y, z: anchorB.z },
      visualMesh,
    };

    this.joints.set(id, jointInfo);
    soundManager.playJointConnect();
    return jointInfo;
  }

  public createDistanceJoint(
    bodyAId: string,
    bodyBId: string,
    anchorA: THREE.Vector3,
    anchorB: THREE.Vector3,
    distance?: number,
    stiffness: number = 600,
    damping: number = 15
  ): PhysicsJointInfo | null {
    const bodyA = this.getBodyById(bodyAId);
    const bodyB = this.getBodyById(bodyBId);
    if (!bodyA || !bodyB) return null;

    const rAnchorA = new RAPIER.Vector3(anchorA.x, anchorA.y, anchorA.z);
    const rAnchorB = new RAPIER.Vector3(anchorB.x, anchorB.y, anchorB.z);

    const restDist = distance !== undefined ? distance : anchorA.distanceTo(anchorB);
    const jointData = RAPIER.JointData.spring(restDist, stiffness, damping, rAnchorA, rAnchorB);
    const joint = this.world.createImpulseJoint(jointData, bodyA, bodyB, true);

    const id = `joint_dist_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // Visual Rope / Cable
    const cableGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 8);
    const cableMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      metalness: 0.6,
      roughness: 0.4,
    });
    const visualMesh = new THREE.Mesh(cableGeo, cableMat);
    this.scene.add(visualMesh);

    const jointInfo: PhysicsJointInfo = {
      id,
      type: 'spring',
      joint,
      bodyAId,
      bodyBId,
      anchorA: { x: anchorA.x, y: anchorA.y, z: anchorA.z },
      anchorB: { x: anchorB.x, y: anchorB.y, z: anchorB.z },
      visualMesh,
    };

    this.joints.set(id, jointInfo);
    soundManager.playJointConnect();
    return jointInfo;
  }

  public createFixedJoint(
    bodyAId: string,
    bodyBId: string,
    anchorA: THREE.Vector3,
    anchorB: THREE.Vector3
  ): PhysicsJointInfo | null {
    const bodyA = this.getBodyById(bodyAId);
    const bodyB = this.getBodyById(bodyBId);
    if (!bodyA || !bodyB) return null;

    const rAnchorA = new RAPIER.Vector3(anchorA.x, anchorA.y, anchorA.z);
    const rAnchorB = new RAPIER.Vector3(anchorB.x, anchorB.y, anchorB.z);
    const rot = new RAPIER.Quaternion(0, 0, 0, 1);

    const jointData = RAPIER.JointData.fixed(rAnchorA, rot, rAnchorB, rot);
    const joint = this.world.createImpulseJoint(jointData, bodyA, bodyB, true);

    const id = `joint_fixed_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const weldGeo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
    const weldMat = new THREE.MeshStandardMaterial({ color: 0x0284c7 });
    const visualMesh = new THREE.Mesh(weldGeo, weldMat);
    this.scene.add(visualMesh);

    const jointInfo: PhysicsJointInfo = {
      id,
      type: 'fixed',
      joint,
      bodyAId,
      bodyBId,
      anchorA: { x: anchorA.x, y: anchorA.y, z: anchorA.z },
      anchorB: { x: anchorB.x, y: anchorB.y, z: anchorB.z },
      visualMesh,
    };

    this.joints.set(id, jointInfo);
    soundManager.playJointConnect();
    return jointInfo;
  }

  public removeJoint(jointId: string) {
    const j = this.joints.get(jointId);
    if (!j) return;
    this.world.removeImpulseJoint(j.joint, true);
    if (j.visualMesh) {
      this.scene.remove(j.visualMesh);
      if (j.visualMesh.geometry) j.visualMesh.geometry.dispose();
    }
    this.joints.delete(jointId);
  }

  public clearAllJoints() {
    for (const j of this.joints.values()) {
      this.world.removeImpulseJoint(j.joint, true);
      if (j.visualMesh) {
        this.scene.remove(j.visualMesh);
        if (j.visualMesh.geometry) j.visualMesh.geometry.dispose();
      }
    }
    this.joints.clear();
  }

  private updateJointVisuals() {
    for (const j of this.joints.values()) {
      if (!j.visualMesh) continue;

      const bodyA = this.getBodyById(j.bodyAId);
      const bodyB = this.getBodyById(j.bodyBId);
      if (!bodyA || !bodyB) continue;

      const tA = bodyA.translation();
      const rA = bodyA.rotation();
      const qA = new THREE.Quaternion(rA.x, rA.y, rA.z, rA.w);
      const worldA = new THREE.Vector3(j.anchorA.x, j.anchorA.y, j.anchorA.z).applyQuaternion(qA).add(new THREE.Vector3(tA.x, tA.y, tA.z));

      const tB = bodyB.translation();
      const rB = bodyB.rotation();
      const qB = new THREE.Quaternion(rB.x, rB.y, rB.z, rB.w);
      const worldB = new THREE.Vector3(j.anchorB.x, j.anchorB.y, j.anchorB.z).applyQuaternion(qB).add(new THREE.Vector3(tB.x, tB.y, tB.z));

      if (j.type === 'spring' || j.type === 'distance') {
        const dist = worldA.distanceTo(worldB);
        j.visualMesh.position.copy(worldA).add(worldB).multiplyScalar(0.5);
        j.visualMesh.scale.set(1, Math.max(0.01, dist), 1);
        if (dist > 0.001) {
          j.visualMesh.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            worldB.clone().sub(worldA).normalize()
          );
        }
      } else if (j.type === 'revolute') {
        j.visualMesh.position.copy(worldA);
        j.visualMesh.quaternion.copy(qA);
      }
    }
  }

  // --------------------------------------------------------------------------
  // PRESET SCENES
  // --------------------------------------------------------------------------

  private buildContraptionShowcase() {
    const baseY = 9;
    // Build a block vehicle in world, then assemble it into physics
    for (let x = -2; x <= 2; x++) {
      for (let z = -1; z <= 1; z++) {
        this.voxelWorld.setVoxel(x, baseY, z, VoxelType.WOOD);
      }
    }
    // Cabin with glass and gold engine
    this.voxelWorld.setVoxel(0, baseY + 1, 0, VoxelType.GOLD);
    this.voxelWorld.setVoxel(-1, baseY + 1, 0, VoxelType.GLASS);
    this.voxelWorld.setVoxel(1, baseY + 1, 0, VoxelType.GLASS);
    this.voxelWorld.setVoxel(0, baseY + 1, -1, VoxelType.GLASS);
    this.voxelWorld.setVoxel(0, baseY + 1, 1, VoxelType.GLASS);

    // Bumpers
    this.voxelWorld.setVoxel(-2, baseY + 1, 0, VoxelType.COBBLESTONE);
    this.voxelWorld.setVoxel(2, baseY + 1, 0, VoxelType.COBBLESTONE);

    // Assemble it into ONE physics contraption!
    this.assembleContraption(new THREE.Vector3(-2, baseY, -1), new THREE.Vector3(2, baseY + 1, 1));
  }

  private buildArticulatedArm() {
    const baseY = 9;
    // Fixed base pillar
    const base = this.spawnBlock('cylinder', 'metal', [0, baseY + 1, 0], [0.8, 2.0, 0.8]) as PhysicsEntity;
    base.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);

    // Arm 1 (plank)
    const arm1 = this.spawnBlock('plank', 'wood', [1.8, baseY + 2.0, 0], [3.2, 0.5, 0.8]) as PhysicsEntity;

    // Arm 2 (plank)
    const arm2 = this.spawnBlock('plank', 'metal', [4.8, baseY + 2.0, 0], [3.0, 0.4, 0.6]) as PhysicsEntity;

    // Weight at tip
    const ball = this.spawnBlock('sphere', 'metal', [6.5, baseY + 2.0, 0], [0.8, 0.8, 0.8]) as PhysicsEntity;

    // Hinge 1: Base to Arm1
    this.createHingeJoint(base.id, arm1.id, new THREE.Vector3(0, 0.9, 0), new THREE.Vector3(-1.5, 0, 0), new THREE.Vector3(0, 0, 1));

    // Hinge 2: Arm1 to Arm2
    this.createHingeJoint(arm1.id, arm2.id, new THREE.Vector3(1.5, 0, 0), new THREE.Vector3(-1.4, 0, 0), new THREE.Vector3(0, 0, 1));

    // Fixed: Arm2 to Weight
    this.createFixedJoint(arm2.id, ball.id, new THREE.Vector3(1.4, 0, 0), new THREE.Vector3(0, 0, 0));

    // Give it an initial swing impulse
    ball.body.setLinvel({ x: 0, y: -4, z: 2 }, true);
  }

  private buildSuspensionBridge() {
    const baseY = 9;
    // Tower 1 (Fixed)
    const tower1 = this.spawnBlock('cube', 'stone', [-6, baseY + 2, 0], [1.5, 4.0, 2.0]) as PhysicsEntity;
    tower1.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);

    // Tower 2 (Fixed)
    const tower2 = this.spawnBlock('cube', 'stone', [6, baseY + 2, 0], [1.5, 4.0, 2.0]) as PhysicsEntity;
    tower2.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);

    // 4 Bridge deck planks
    const deckCount = 4;
    const decks: PhysicsEntity[] = [];
    for (let i = 0; i < deckCount; i++) {
      const x = -3.75 + i * 2.5;
      const deck = this.spawnBlock('plank', 'wood', [x, baseY + 1, 0], [2.2, 0.35, 1.8]) as PhysicsEntity;
      decks.push(deck);
    }

    // Link Tower1 to Deck0 with spring joint
    this.createDistanceJoint(tower1.id, decks[0].id, new THREE.Vector3(0.75, 1.8, 0), new THREE.Vector3(-1.0, 0.1, 0), 2.2, 800, 20);

    // Link Decks together with spring/distance joints
    for (let i = 0; i < deckCount - 1; i++) {
      this.createDistanceJoint(decks[i].id, decks[i + 1].id, new THREE.Vector3(1.0, 0, 0), new THREE.Vector3(-1.0, 0, 0), 0.6, 1200, 25);
    }

    // Link Deck[last] to Tower2
    this.createDistanceJoint(decks[deckCount - 1].id, tower2.id, new THREE.Vector3(1.0, 0.1, 0), new THREE.Vector3(-0.75, 1.8, 0), 2.2, 800, 20);

    // Drop a test rubber ball onto the bridge
    const ball = this.spawnBlock('sphere', 'rubber', [0, baseY + 7, 0], [0.9, 0.9, 0.9]) as PhysicsEntity;
    ball.body.setLinvel({ x: 0.5, y: -2, z: 0 }, true);
  }

  public setWorldSeed(seed: number) {
    this.voxelWorld.setSeed(seed);
    if (this.player) {
      const groundY = this.voxelWorld.getElevationAt(0, 6.0);
      this.player.teleport(0, groundY + 1.25, 6.0);
      this.player.yaw = 0;
      this.player.pitch = -0.05;
    }
  }

  private buildSoftBodyShowcase() {
    const colors = ['#f43f5e', '#06b6d4', '#10b981'];
    const baseY = 8.5;
    for (let i = 0; i < 3; i++) {
      this.spawnSoftBody([0, baseY + 1.2 + i * 2.2, 0], [2.0, 2.0, 2.0], colors[i % colors.length], 0.85);
    }

    // Heavy steel bowling ball dropping from sky
    const ball = this.spawnBlock('sphere', 'metal', [0.1, baseY + 12.5, 0.1], [1.0, 1.0, 1.0]) as PhysicsEntity;
    ball.body.setLinvel({ x: 0, y: -2, z: 0 }, true);

    this.spawnSoftBody([-4, baseY + 1.5, 0], [1.6, 1.6, 1.6], '#8b5cf6', 0.9);
    this.spawnSoftBody([4, baseY + 1.5, 0], [1.6, 1.6, 1.6], '#ec4899', 0.8);
  }

  private buildJengaTower() {
    const floors = 14;
    const plankWidth = 1.0;
    const plankHeight = 0.55;
    const plankLength = 3.0;
    const baseY = 8.5 + plankHeight / 2;

    for (let f = 0; f < floors; f++) {
      const y = baseY + f * (plankHeight + 0.005);
      const isEven = f % 2 === 0;

      for (let i = -1; i <= 1; i++) {
        const offset = i * (plankWidth + 0.015);
        if (isEven) {
          this.spawnBlock(
            'plank',
            'wood',
            [0, y, offset],
            [plankLength, plankHeight, plankWidth],
            [0, 0, 0]
          );
        } else {
          this.spawnBlock(
            'plank',
            'wood',
            [offset, y, 0],
            [plankLength, plankHeight, plankWidth],
            [0, Math.PI / 2, 0]
          );
        }
      }
    }
  }

  private buildDominoRun() {
    const dominoCount = 38;
    const width = 0.25;
    const height = 1.5;
    const length = 0.7;
    const baseY = 8.5;

    for (let i = 0; i < dominoCount; i++) {
      const t = i * 0.21;
      const r = 3.0 + t * 0.3;
      const x = Math.cos(t) * r;
      const z = Math.sin(t) * r;
      const angle = t + Math.PI / 2;

      const mat: BlockMaterial = i === dominoCount - 1 ? 'tnt' : i % 5 === 0 ? 'stone' : 'wood';
      this.spawnBlock('domino', mat, [x, baseY + height / 2 + 0.01, z], [width, height, length], [0, -angle, 0]);
    }

    const firstX = Math.cos(0) * 3.0 - 0.7;
    const firstZ = Math.sin(0) * 3.0;
    const ball = this.spawnBlock('sphere', 'metal', [firstX, baseY + 1.6, firstZ], [0.45, 0.45, 0.45]) as PhysicsEntity;
    ball.body.setLinvel({ x: 3.5, y: 0, z: 0 }, true);
  }

  private buildCastle() {
    const towerHeight = 5;
    const wallLength = 7;
    const wallHeight = 3;
    const baseY = 8.5;

    for (let h = 0; h < towerHeight; h++) {
      const y = baseY + 0.6 + h * 1.2;
      this.spawnBlock('cylinder', 'stone', [-wallLength / 2, y, 0], [0.8, 1.2, 0.8]);
      this.spawnBlock('cylinder', 'stone', [wallLength / 2, y, 0], [0.8, 1.2, 0.8]);
    }

    for (let h = 0; h < wallHeight; h++) {
      const y = baseY + 0.5 + h * 1.0;
      for (let x = -2; x <= 2; x++) {
        if (h === 0 && x === 0) continue;
        this.spawnBlock('cube', 'stone', [x * 1.05, y, 0], [1.0, 1.0, 1.0]);
      }
    }

    this.spawnBlock('plank', 'stone', [0, baseY + 1.8, 0], [3.2, 0.5, 1.0]);
    this.spawnBlock('cube', 'tnt', [0, baseY + 2.8, 0], [1.1, 1.1, 1.1]);
    this.spawnBlock('cube', 'stone', [-1.8, baseY + 3.6, 0], [0.6, 0.6, 1.0]);
    this.spawnBlock('cube', 'stone', [0, baseY + 3.6, 0], [0.6, 0.6, 1.0]);
    this.spawnBlock('cube', 'stone', [1.8, baseY + 3.6, 0], [0.6, 0.6, 1.0]);
  }

  private buildPyramid() {
    const levels = 6;
    const blockSize = 1.0;
    const baseY = 8.5;

    for (let l = 0; l < levels; l++) {
      const count = levels - l;
      const y = baseY + blockSize / 2 + l * (blockSize + 0.005);
      const startX = -((count - 1) * blockSize) / 2;

      for (let i = 0; i < count; i++) {
        const x = startX + i * blockSize;
        const isTop = l === levels - 1;
        const mat: BlockMaterial = isTop ? 'tnt' : l % 2 === 0 ? 'wood' : 'stone';
        this.spawnBlock('cube', mat, [x, y, 0], [blockSize * 0.98, blockSize * 0.98, blockSize * 0.98]);
      }
    }
  }

  private buildWreckingBallScene() {
    const towerH = 7;
    const baseY = 8.5;
    for (let h = 0; h < towerH; h++) {
      const y = baseY + 0.6 + h * 1.2;
      this.spawnBlock('cube', 'wood', [0, y, 0], [1.2, 1.2, 1.2]);
      this.spawnBlock('cube', 'stone', [1.25, y, 0], [1.2, 1.2, 1.2]);
    }
    this.spawnBlock('cube', 'tnt', [0.6, baseY + (towerH + 0.5) * 1.2, 0], [1.2, 1.2, 1.2]);

    const wreckingBall = this.spawnBlock('sphere', 'metal', [-8.0, baseY + 7.5, 0], [1.3, 1.3, 1.3]) as PhysicsEntity;
    wreckingBall.body.setLinvel({ x: 13.0, y: -2.0, z: 0 }, true);
  }

  /**
   * Main Simulation Step
   */
  public step(deltaTime: number, playerInput?: PlayerInput) {
    if (!this.isReady || !this.world) return;

    const scaledDt = Math.min(deltaTime * this.timeScale, 0.05);

    // Update Player character controller & infinite procedural chunk streaming
    if (this.player && playerInput) {
      this.player.update(scaledDt, playerInput);
      const pos = this.player.getPosition();
      this.voxelWorld.updatePlayerPosition(pos.x, pos.z);
      this.voxelWorld.update();
    }

    // Apply drag spring force if a rigid body is grabbed
    if (this.grabbedEntity) {
      const body = this.grabbedEntity.body;
      const currentPos = body.translation();
      const targetPos = this.dragTargetPos.clone().add(this.grabOffset);

      const springK = 18.0;
      const damping = 0.75;
      const vx = (targetPos.x - currentPos.x) * springK;
      const vy = (targetPos.y - currentPos.y) * springK;
      const vz = (targetPos.z - currentPos.z) * springK;

      const currentVel = body.linvel();
      body.setLinvel(
        {
          x: currentVel.x * damping + vx * (1 - damping),
          y: currentVel.y * damping + vy * (1 - damping),
          z: currentVel.z * damping + vz * (1 - damping),
        },
        true
      );
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    // Step Rapier rigid bodies
    if (scaledDt > 0) {
      const substeps = 2;
      this.world.timestep = scaledDt / substeps;
      for (let s = 0; s < substeps; s++) {
        this.world.step(this.eventQueue);
      }
    }

    // Step Soft Bodies
    if (scaledDt > 0) {
      const now = performance.now();
      for (const sb of this.softBodies.values()) {
        sb.update(scaledDt, this.currentGravityVector, (x, z) => this.voxelWorld.getElevationAt(x, z));

        // Realistic momentum transfer when cannonball or rigid blocks hit a soft body
        const sbCenter = sb.getCenter();
        const sbRadius = sb.getBoundingRadius();

        for (const entity of this.entities.values()) {
          const bPos = entity.body.translation();
          const rbCenter = new THREE.Vector3(bPos.x, bPos.y, bPos.z);
          const dist = sbCenter.distanceTo(rbCenter);
          const contactThreshold = sbRadius + 0.8;

          if (dist < contactThreshold) {
            const cooldownKey = `${sb.id}_${entity.id}`;
            const lastContact = this.softBodyContactCooldowns.get(cooldownKey) || 0;

            if (now - lastContact > 180) {
              this.softBodyContactCooldowns.set(cooldownKey, now);

              const rbVel = entity.body.linvel();
              const vVec = new THREE.Vector3(rbVel.x, rbVel.y, rbVel.z);
              const impactSpeed = vVec.length();

              if (impactSpeed > 0.4) {
                const normal = sbCenter.clone().sub(rbCenter).normalize();

                // Transfer velocity smoothly without teleportation
                const transferSpeed = Math.min(impactSpeed * 0.4, 15);
                sb.addVelocity(normal.clone().multiplyScalar(transferSpeed), scaledDt);

                // Deflect the rigid body back naturally
                entity.body.setLinvel(
                  {
                    x: -rbVel.x * 0.35 + normal.x * 1.5,
                    y: -rbVel.y * 0.35 + Math.abs(normal.y) * 2.0,
                    z: -rbVel.z * 0.35 + normal.z * 1.5,
                  },
                  true
                );

                soundManager.playImpact('rubber', Math.min(impactSpeed / 10, 0.9));
              }
            }
          }
        }
      }
    }

    // Process all rigid-body collision events
    this.processCollisions();

    // Sync Three.js meshes with Rapier rigid bodies
    const toRemove: string[] = [];
    for (const [id, entity] of this.entities.entries()) {
      const pos = entity.body.translation();
      const rot = entity.body.rotation();

      entity.mesh.position.set(pos.x, pos.y, pos.z);
      entity.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);

      if (pos.y < -80) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      this.removeBlock(id);
    }

    // Sync contraptions with Rapier rigid bodies
    const contraptionsToRemove: string[] = [];
    for (const [id, contraption] of this.contraptions.entries()) {
      const pos = contraption.body.translation();
      const rot = contraption.body.rotation();

      contraption.group.position.set(pos.x, pos.y, pos.z);
      contraption.group.quaternion.set(rot.x, rot.y, rot.z, rot.w);

      if (pos.y < -80) {
        contraptionsToRemove.push(id);
      }
    }

    for (const id of contraptionsToRemove) {
      this.removeContraption(id);
    }

    // Sync Joint Visual Connectors (lines & hinge pins)
    this.updateJointVisuals();

    // Update 3D Selection Box Hologram
    if (this.selectionRenderer) {
      this.selectionRenderer.update(scaledDt);
    }

    this.updateParticles(scaledDt);
  }

  /**
   * Process Rapier collision events with real impact velocity calculation & sound
   */
  private processCollisions() {
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;

      const e1 = this.colliderToEntity.get(h1);
      const e2 = this.colliderToEntity.get(h2);

      let impactSpeed = 0;
      let primaryMaterial: BlockMaterial = 'wood';

      if (e1 && e2) {
        // Block-on-Block collision
        const v1 = e1.body.linvel();
        const v2 = e2.body.linvel();
        const dvx = v1.x - v2.x;
        const dvy = v1.y - v2.y;
        const dvz = v1.z - v2.z;
        impactSpeed = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz);
        primaryMaterial = e1.data.material;

        // TNT impact detonation if hit with high velocity
        if ((e1.data.isTNT || e2.data.isTNT) && impactSpeed > 6.5) {
          const tnt = e1.data.isTNT ? e1 : e2;
          this.detonateTNT(tnt);
          return;
        }
      } else if (e1 || e2) {
        // Block-on-Floor collision
        const entity = (e1 || e2)!;
        const v = entity.body.linvel();
        impactSpeed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
        primaryMaterial = entity.data.material;

        if (entity.data.isTNT && impactSpeed > 7.0) {
          this.detonateTNT(entity);
          return;
        }
      }

      // Play audio scaled by collision speed
      if (impactSpeed > 0.4) {
        const volume = Math.min(1.0, Math.max(0.12, (impactSpeed - 0.3) / 4.0));
        soundManager.playImpact(primaryMaterial, volume);
      }
    });
  }

  private createExplosionVisual(pos: THREE.Vector3) {
    const ringGeo = new THREE.RingGeometry(0.1, 0.6, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.copy(pos);
    ringMesh.position.y += 0.05;
    this.scene.add(ringMesh);

    const particleCount = 45;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities: THREE.Vector3[] = [];

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = pos.x;
      positions[i * 3 + 1] = pos.y;
      positions[i * 3 + 2] = pos.z;

      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 14,
        Math.random() * 12 + 2,
        (Math.random() - 0.5) * 14
      );
      velocities.push(vel);
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const pMat = new THREE.PointsMaterial({
      color: 0xef4444,
      size: 0.35,
      transparent: true,
      opacity: 1.0,
    });

    const points = new THREE.Points(geometry, pMat);
    this.scene.add(points);

    this.activeParticles.push({
      mesh: ringMesh,
      life: 0,
      maxLife: 0.4,
      update: (delta) => {
        ringMesh.scale.addScalar(delta * 28);
        (ringMat as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - ringMesh.scale.x / 12);
        return ringMesh.scale.x < 12;
      },
    });

    this.activeParticles.push({
      mesh: points,
      velocities,
      life: 0,
      maxLife: 0.8,
      update: (delta) => {
        const posAttr = geometry.attributes.position as THREE.BufferAttribute;
        const posArray = posAttr.array as Float32Array;

        for (let i = 0; i < velocities.length; i++) {
          velocities[i].y -= 18 * delta;
          posArray[i * 3] += velocities[i].x * delta;
          posArray[i * 3 + 1] += velocities[i].y * delta;
          posArray[i * 3 + 2] += velocities[i].z * delta;
        }
        posAttr.needsUpdate = true;
        pMat.opacity = Math.max(0, 1 - points.userData.life / 0.8);
        return true;
      },
    });
  }

  private createMuzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3) {
    const flashGeo = new THREE.SphereGeometry(0.5, 12, 12);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.9 });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.copy(pos).add(dir.clone().multiplyScalar(0.4));
    this.scene.add(flash);

    this.activeParticles.push({
      mesh: flash,
      life: 0,
      maxLife: 0.1,
      update: (delta) => {
        flash.scale.addScalar(delta * 8);
        flashMat.opacity -= delta * 9;
        return flashMat.opacity > 0;
      },
    });
  }

  private updateParticles(delta: number) {
    for (let i = this.activeParticles.length - 1; i >= 0; i--) {
      const p = this.activeParticles[i];
      p.life += delta;
      if (!p.mesh.userData.life) p.mesh.userData.life = 0;
      p.mesh.userData.life += delta;

      const alive = p.update(delta) && p.life < p.maxLife;
      if (!alive) {
        this.scene.remove(p.mesh);
        if ('geometry' in p.mesh) p.mesh.geometry.dispose();
        this.activeParticles.splice(i, 1);
      }
    }
  }

  public dispose() {
    this.clearAllBlocks();
    this.clearAllJoints();
    this.selectionRenderer.dispose();
    this.voxelWorld.dispose();
    if (this.player) {
      this.player.dispose(this.scene);
    }
    if (this.world) {
      this.world.free();
    }
  }
}
