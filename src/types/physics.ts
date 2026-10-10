export type BlockShape = 'cube' | 'plank' | 'domino' | 'cylinder' | 'sphere' | 'pyramid' | 'softbody';

export type BlockMaterial = 'wood' | 'stone' | 'rubber' | 'ice' | 'metal' | 'tnt';

export type ActiveTool =
  | 'interact'
  | 'cannon'
  | 'spawn'
  | 'explode'
  | 'vortex'
  | 'mine'
  | 'build'
  | 'physics_maker';

export type JointType = 'revolute' | 'distance' | 'fixed' | 'spring' | 'prismatic';

export interface ContraptionBlockInfo {
  relX: number;
  relY: number;
  relZ: number;
  type: VoxelType;
}

export interface PhysicsContraption {
  id: string;
  body: any; // RAPIER.RigidBody
  colliders: any[]; // RAPIER.Collider[]
  group: any; // THREE.Group
  blocks: ContraptionBlockInfo[];
  centerOfMass: { x: number; y: number; z: number };
  mass: number;
}

export interface PhysicsJointInfo {
  id: string;
  type: JointType;
  joint: any; // RAPIER.ImpulseJoint
  bodyAId: string;
  bodyBId: string;
  anchorA: { x: number; y: number; z: number };
  anchorB: { x: number; y: number; z: number };
  visualMesh?: any;
}

export interface PhysicsMakerSelection {
  cornerA: { x: number; y: number; z: number } | null;
  cornerB: { x: number; y: number; z: number } | null;
}

export type CameraViewMode = 'first_person' | 'third_person' | 'front';

export enum VoxelType {
  AIR = 0,
  GRASS = 1,
  DIRT = 2,
  STONE = 3,
  BEDROCK = 4,
  WOOD = 5,
  LEAVES = 6,
  SAND = 7,
  GLASS = 8,
  COBBLESTONE = 9,
  TNT = 10,
  GOLD = 11,
  GLOWSTONE = 12,
  JUKEBOX = 13,
  WATER = 14,
}

export type StructurePreset =
  | 'jenga'
  | 'dominoes'
  | 'castle'
  | 'pyramid'
  | 'cradle'
  | 'softbody'
  | 'contraption'
  | 'articulated_arm'
  | 'bridge'
  | 'empty';

export type VisualTheme = 'realistic' | 'candy' | 'ceramic' | 'neon';

export interface MaterialProperties {
  name: string;
  density: number;      // kg/m^3
  friction: number;     // 0.0 to 1.0+
  restitution: number;  // 0.0 to 1.0 (bounciness)
  color: string;
  roughness: number;
  metalness: number;
  description: string;
}

export interface PhysicsBlockData {
  id: string;
  shape: BlockShape;
  material: BlockMaterial;
  size: [number, number, number]; // width, height, depth or radius
  createdAt: number;
  isTNT?: boolean;
}

export interface SimulationStats {
  bodyCount: number;
  fps: number;
  stepTimeMs: number;
  isGyroActive: boolean;
}

export interface GyroState {
  enabled: boolean;
  supported: boolean;
  beta: number;  // front-to-back tilt in degrees [-180, 180]
  gamma: number; // left-to-right tilt in degrees [-90, 90]
}
