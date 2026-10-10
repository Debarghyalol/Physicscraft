import { VoxelType } from '../types/physics';
import { MUSIC_DISCS, MusicDiscId } from '../audio/MusicEngine';

export interface ItemDef {
  id: string;
  name: string;
  maxStack: number;
  voxel?: VoxelType;
  disc?: MusicDiscId;
  /** Flat item sprite (textures/<texture>.png) for non-block items. */
  texture?: string;
  tool?: 'flint_and_steel';
  /** Melee damage in half-hearts when used as a weapon (hand = 1). */
  damage?: number;
  toolKind?: 'sword' | 'pickaxe' | 'axe' | 'shovel' | 'hoe';
}

export interface ItemStack {
  id: string;
  count: number;
}

const BLOCKS: { voxel: VoxelType; name: string }[] = [
  { voxel: VoxelType.GRASS, name: 'Grass Block' },
  { voxel: VoxelType.DIRT, name: 'Dirt' },
  { voxel: VoxelType.STONE, name: 'Stone' },
  { voxel: VoxelType.COBBLESTONE, name: 'Cobblestone' },
  { voxel: VoxelType.BEDROCK, name: 'Bedrock' },
  { voxel: VoxelType.WOOD, name: 'Oak Log' },
  { voxel: VoxelType.LEAVES, name: 'Oak Leaves' },
  { voxel: VoxelType.SAND, name: 'Sand' },
  { voxel: VoxelType.GLASS, name: 'Glass' },
  { voxel: VoxelType.TNT, name: 'TNT' },
  { voxel: VoxelType.GOLD, name: 'Block of Gold' },
  { voxel: VoxelType.GLOWSTONE, name: 'Glowstone' },
  { voxel: VoxelType.JUKEBOX, name: 'Jukebox' },
];

// Java 1.21 attack damage per tier: [sword, pickaxe, axe, shovel, hoe]
const TIERS: { id: string; name: string; damage: number[] }[] = [
  { id: 'wooden', name: 'Wooden', damage: [4, 2, 7, 2.5, 1] },
  { id: 'stone', name: 'Stone', damage: [5, 3, 9, 3.5, 1] },
  { id: 'iron', name: 'Iron', damage: [6, 4, 9, 4.5, 1] },
  { id: 'golden', name: 'Golden', damage: [4, 2, 7, 2.5, 1] },
  { id: 'diamond', name: 'Diamond', damage: [7, 5, 9, 5.5, 1] },
  { id: 'netherite', name: 'Netherite', damage: [8, 6, 10, 6.5, 1] },
];
const TOOL_KINDS: { kind: NonNullable<ItemDef['toolKind']>; name: string }[] = [
  { kind: 'sword', name: 'Sword' },
  { kind: 'pickaxe', name: 'Pickaxe' },
  { kind: 'axe', name: 'Axe' },
  { kind: 'shovel', name: 'Shovel' },
  { kind: 'hoe', name: 'Hoe' },
];
const TOOLS: ItemDef[] = TOOL_KINDS.flatMap((k, ki) =>
  TIERS.map((t) => ({
    id: `tool:${t.id}_${k.kind}`,
    name: `${t.name} ${k.name}`,
    maxStack: 1,
    texture: `item/${t.id}_${k.kind}`,
    toolKind: k.kind,
    damage: t.damage[ki],
  }))
);

/** Every item the game knows about, in creative-menu order. */
export const ITEM_DEFS: ItemDef[] = [
  ...BLOCKS.map((b) => ({ id: `block:${b.voxel}`, name: b.name, maxStack: 64, voxel: b.voxel })),
  { id: 'tool:flint_and_steel', name: 'Flint and Steel', maxStack: 1, texture: 'item/flint_and_steel', tool: 'flint_and_steel' },
  ...TOOLS,
  ...MUSIC_DISCS.map((d) => ({ id: `disc:${d.id}`, name: `Music Disc - ${d.title}`, maxStack: 1, disc: d.id })),
];

const BY_ID = new Map(ITEM_DEFS.map((d) => [d.id, d]));
export const getItemDef = (id: string): ItemDef | undefined => BY_ID.get(id);
export const blockItemId = (v: VoxelType) => `block:${v}`;
