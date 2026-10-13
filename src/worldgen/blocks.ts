/** Maps vanilla block names (as emitted by the surface rules, no namespace) to the game's VoxelType. */
import { VoxelType } from '../types/physics';

const MAP: Record<string, VoxelType> = {
  air: VoxelType.AIR, stone: VoxelType.STONE, deepslate: VoxelType.DEEPSLATE, bedrock: VoxelType.BEDROCK,
  grass_block: VoxelType.GRASS, dirt: VoxelType.DIRT, coarse_dirt: VoxelType.COARSE_DIRT, podzol: VoxelType.PODZOL, mycelium: VoxelType.MYCELIUM,
  sand: VoxelType.SAND, sandstone: VoxelType.SANDSTONE, red_sand: VoxelType.RED_SAND, red_sandstone: VoxelType.RED_SANDSTONE,
  gravel: VoxelType.GRAVEL, clay: VoxelType.CLAY, mud: VoxelType.MUD, water: VoxelType.WATER,
  snow_block: VoxelType.SNOW_BLOCK, ice: VoxelType.ICE, packed_ice: VoxelType.PACKED_ICE, calcite: VoxelType.CALCITE,
  terracotta: VoxelType.TERRACOTTA, white_terracotta: VoxelType.WHITE_TERRACOTTA, orange_terracotta: VoxelType.ORANGE_TERRACOTTA,
  yellow_terracotta: VoxelType.YELLOW_TERRACOTTA, brown_terracotta: VoxelType.BROWN_TERRACOTTA, red_terracotta: VoxelType.RED_TERRACOTTA,
  light_gray_terracotta: VoxelType.LIGHT_GRAY_TERRACOTTA,
  netherrack: VoxelType.NETHERRACK, soul_sand: VoxelType.SOUL_SAND, soul_soil: VoxelType.SOUL_SOIL, basalt: VoxelType.BASALT, blackstone: VoxelType.BLACKSTONE,
  // No in-game equivalent yet: nearest solid stand-ins so rules never leave holes.
  powder_snow: VoxelType.SNOW_BLOCK,   // not walkable-through yet
  sulfur: VoxelType.STONE, cinnabar: VoxelType.STONE,
  lava: VoxelType.STONE, end_stone: VoxelType.STONE, crimson_nylium: VoxelType.NETHERRACK, warped_nylium: VoxelType.NETHERRACK,
  nether_wart_block: VoxelType.NETHERRACK, warped_wart_block: VoxelType.NETHERRACK,
};
const warned = new Set<string>();
export function vanillaBlockToVoxel(name: string): VoxelType {
  const t = MAP[name];
  if (t !== undefined) return t;
  if (!warned.has(name)) { warned.add(name); console.warn(`[worldgen] no VoxelType for vanilla block "${name}", using stone`); }
  return VoxelType.STONE;
}
