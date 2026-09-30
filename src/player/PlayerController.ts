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
}

export class PlayerController {
  public body!: RAPIER.RigidBody;
  public collider!: RAPIER.Collider;
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
  public readonly walkSpeed: number = 5.2;
  public readonly sprintSpeed: number = 8.8;
  public readonly jumpVelocity: number = 7.6;

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
    // Dynamic capsule body with locked rotations (pure translation controller)
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawnPos[0], spawnPos[1], spawnPos[2])
      .lockRotations()
      .setLinearDamping(0.05)
      .setCanSleep(false);

    this.body = this.world.createRigidBody(bodyDesc);

    // Player capsule: radius = 0.34m, halfHeight = 0.55m (Total height ~ 1.78m)
    // Zero friction + Min combine rule prevents capsule from ever sticking/climbing against walls
    const colliderDesc = RAPIER.ColliderDesc.capsule(0.55, 0.34)
      .setFriction(0.0)
      .setRestitution(0.0)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

    this.collider = this.world.createCollider(colliderDesc, this.body);
  }

  public setViewMode(mode: CameraViewMode) {
    this.viewMode = mode;
    this.model.setFirstPersonMode(mode === 'first_person');
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

    const pos = this.body.translation();
    const linvel = this.body.linvel();

    // 1. Ground detection via downward raycast from capsule base
    const rayOrigin = new RAPIER.Vector3(pos.x, pos.y - 0.75, pos.z);
    const rayDir = new RAPIER.Vector3(0, -1, 0);
    const ray = new RAPIER.Ray(rayOrigin, rayDir);
    const hit = this.world.castRay(ray, 0.35, true, undefined, undefined, this.collider);

    this.isGrounded = hit !== null && hit.timeOfImpact < 0.28;

    // 2. Horizontal Movement & Anti-Wall-Stick Sliding
    const speed = input.sprint ? this.sprintSpeed : this.walkSpeed;

    // Camera horizontal forward and strafe directions
    PlayerController.scratchForward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    PlayerController.scratchRight.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();

    let targetVelX =
      (PlayerController.scratchForward.x * input.moveForward +
        PlayerController.scratchRight.x * input.moveRight) *
      speed;
    let targetVelZ =
      (PlayerController.scratchForward.z * input.moveForward +
        PlayerController.scratchRight.z * input.moveRight) *
      speed;

    // Smooth Wall-Sliding: If moving toward a wall, project velocity onto wall surface
    // This stops horizontal velocity from fighting contact constraints and sticking in air!
    const moveMag = Math.hypot(targetVelX, targetVelZ);
    if (moveMag > 0.05) {
      const dirX = targetVelX / moveMag;
      const dirZ = targetVelZ / moveMag;
      const rayDist = 0.45; // capsule radius (0.34) + margin

      for (const yOffset of [-0.4, 0.0, 0.4]) {
        const rayStart = new RAPIER.Vector3(pos.x, pos.y + yOffset, pos.z);
        const rayDir = new RAPIER.Vector3(dirX, 0, dirZ);
        const wallHit = this.world.castRayAndGetNormal(
          new RAPIER.Ray(rayStart, rayDir),
          rayDist,
          true,
          undefined,
          undefined,
          this.collider
        );

        if (wallHit && Math.abs(wallHit.normal.y) < 0.5) {
          const normalDot = targetVelX * wallHit.normal.x + targetVelZ * wallHit.normal.z;
          if (normalDot < 0) {
            targetVelX -= normalDot * wallHit.normal.x;
            targetVelZ -= normalDot * wallHit.normal.z;

            // In air: gently push capsule away from wall surface to prevent trimesh edge snags
            if (!this.isGrounded && wallHit.timeOfImpact < 0.36) {
              const nudgeX = wallHit.normal.x * 0.008;
              const nudgeZ = wallHit.normal.z * 0.008;
              this.body.setTranslation({ x: pos.x + nudgeX, y: pos.y, z: pos.z + nudgeZ }, true);
            }
          }
          break;
        }
      }
    }

    const accel = this.isGrounded ? 18 : 8;

    const newVx = THREE.MathUtils.lerp(linvel.x, targetVelX, delta * accel);
    const newVz = THREE.MathUtils.lerp(linvel.z, targetVelZ, delta * accel);
    let newVy = linvel.y;

    // 3. Jump & In-Air Gravity (Prevents sticking to wall when jumping into corners)
    if (input.jump && this.isGrounded && linvel.y < 2.0) {
      newVy = this.jumpVelocity;
      soundManager.playJump();
    } else if (!this.isGrounded) {
      // Apply clean downward acceleration so player always slides down walls
      newVy = Math.max(-28, linvel.y - 24.0 * delta);
    }

    this.body.setLinvel({ x: newVx, y: newVy, z: newVz }, true);

    this.currentSpeed = Math.hypot(newVx, newVz);

    // Footsteps sound
    if (this.currentSpeed > 1.2 && this.isGrounded) {
      soundManager.playFootstep('grass');
    }

    // 4. Sync 3D Player Model
    this.model.root.position.set(pos.x, pos.y - 0.9, pos.z);
    this.model.update(delta, this.currentSpeed, this.isGrounded, this.pitch, this.yaw);

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
      // Third person: over-the-shoulder chase camera with anti-block clipping
      const targetPos = PlayerController.scratchVec.set(pos.x, pos.y + 0.72, pos.z);
      const maxDist = 3.5;

      const camDir = new THREE.Vector3(
        Math.sin(this.yaw) * Math.cos(this.pitch),
        Math.max(0.08, -Math.sin(this.pitch) + 0.15),
        Math.cos(this.yaw) * Math.cos(this.pitch)
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
      this.world.removeCollider(this.collider, false);
      this.world.removeRigidBody(this.body);
    }
  }
}
