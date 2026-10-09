import { VoxelType } from '../types/physics';
import { MUSIC_DISCS, MusicDiscId } from '../audio/MusicEngine';

export interface ItemDef {
  id: string;
  name: string;
  maxStack: number;
  voxel?: VoxelType;
  disc?: MusicDiscId;
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

/** Every item the game knows about, in creative-menu order. */
export const ITEM_DEFS: ItemDef[] = [
  ...BLOCKS.map((b) => ({ id: `block:${b.voxel}`, name: b.name, maxStack: 64, voxel: b.voxel })),
  ...MUSIC_DISCS.map((d) => ({ id: `disc:${d.id}`, name: `Music Disc - ${d.title}`, maxStack: 1, disc: d.id })),
];

const BY_ID = new Map(ITEM_DEFS.map((d) => [d.id, d]));
export const getItemDef = (id: string): ItemDef | undefined => BY_ID.get(id);
export const blockItemId = (v: VoxelType) => `block:${v}`;
