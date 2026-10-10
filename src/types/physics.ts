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

  // Keep existing IDs stable: append new voxel types rather than renumbering.
  // Wood families
  OAK_PLANKS = 15,
  SPRUCE_PLANKS = 16,
  BIRCH_PLANKS = 17,
  JUNGLE_PLANKS = 18,
  ACACIA_PLANKS = 19,
  DARK_OAK_PLANKS = 20,
  MANGROVE_PLANKS = 21,
  CHERRY_PLANKS = 22,
  BAMBOO_PLANKS = 23,
  PALE_OAK_PLANKS = 24,
  OAK_LOG = 25,
  SPRUCE_LOG = 26,
  BIRCH_LOG = 27,
  JUNGLE_LOG = 28,
  ACACIA_LOG = 29,
  DARK_OAK_LOG = 30,
  MANGROVE_LOG = 31,
  CHERRY_LOG = 32,
  PALE_OAK_LOG = 33,
  OAK_LEAVES = 34,
  SPRUCE_LEAVES = 35,
  BIRCH_LEAVES = 36,
  JUNGLE_LEAVES = 37,
  ACACIA_LEAVES = 38,
  DARK_OAK_LEAVES = 39,
  MANGROVE_LEAVES = 40,
  CHERRY_LEAVES = 41,
  PALE_OAK_LEAVES = 42,

  // Cross-model vegetation and flowers
  SHORT_GRASS = 43,
  TALL_GRASS = 44,
  FERN = 45,
  LARGE_FERN = 46,
  DEAD_BUSH = 47,
  BUSH = 48,
  DANDELION = 49,
  POPPY = 50,
  BLUE_ORCHID = 51,
  ALLIUM = 52,
  AZURE_BLUET = 53,
  RED_TULIP = 54,
  ORANGE_TULIP = 55,
  WHITE_TULIP = 56,
  PINK_TULIP = 57,
  OXEYE_DAISY = 58,
  CORNFLOWER = 59,
  LILY_OF_THE_VALLEY = 60,
  SUNFLOWER = 61,
  LILAC = 62,
  ROSE_BUSH = 63,
  PEONY = 64,
  LILY_PAD = 65,
  SUGAR_CANE = 66,
  CACTUS = 67,
  VINE = 68,

  // Terrain and stone variants
  GRAVEL = 69,
  CLAY = 70,
  MOSS_BLOCK = 71,
  MUD = 72,
  SNOW_BLOCK = 73,
  ICE = 74,
  PACKED_ICE = 75,
  BLUE_ICE = 76,
  GRANITE = 77,
  POLISHED_GRANITE = 78,
  DIORITE = 79,
  POLISHED_DIORITE = 80,
  ANDESITE = 81,
  POLISHED_ANDESITE = 82,
  DEEPSLATE = 83,
  COBBLED_DEEPSLATE = 84,
  DEEPSLATE_BRICKS = 85,
  BRICKS = 86,
  STONE_BRICKS = 87,
  CRACKED_STONE_BRICKS = 88,
  MOSSY_STONE_BRICKS = 89,

  // Nether and volcanic blocks
  NETHERRACK = 90,
  SOUL_SAND = 91,
  SOUL_SOIL = 92,
  BASALT = 93,
  BLACKSTONE = 94,
  OBSIDIAN = 95,
  CRYING_OBSIDIAN = 96,

  // Utility, decorative, and resource blocks
  PUMPKIN = 97,
  CARVED_PUMPKIN = 98,
  MELON = 99,
  TORCH = 100,
  LANTERN = 101,
  COAL_ORE = 102,
  IRON_ORE = 103,
  COPPER_ORE = 104,
  GOLD_ORE = 105,
  DIAMOND_ORE = 106,
  REDSTONE_ORE = 107,
  LAPIS_ORE = 108,
  EMERALD_ORE = 109,
  IRON_BLOCK = 110,
  COPPER_BLOCK = 111,
  DIAMOND_BLOCK = 112,
  EMERALD_BLOCK = 113,
  COAL_BLOCK = 114,
  REDSTONE_BLOCK = 115,
  LAPIS_BLOCK = 116,
  HAY_BALE = 117,
  BOOKSHELF = 118,
  CRAFTING_TABLE = 119,
  FURNACE = 120,
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
