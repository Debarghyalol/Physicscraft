/** Vanilla biome colours: Biome.getGrassColor / getFoliageColor / getWaterColor (colour maps resolved by the generator script). */
import { LegacyRandom, SimplexNoise } from './vanillaNoise';
import { BIOME_FOLIAGE_COLOR, BIOME_GRASS_COLOR, BIOME_GRASS_MODIFIER, BIOME_WATER_COLOR } from './biomeColors.data';

let infoNoise: SimplexNoise | null = null;
/** Biome.BIOME_INFO_NOISE (also used by the decoration pass), seeded with LegacyRandomSource(2345). */
const getInfoNoise = () => (infoNoise ??= new SimplexNoise(new LegacyRandom(2345n)));

/** 0xRRGGBB grass colour of a biome at a block column, including the swamp / dark-forest modifiers. */
export function biomeGrassColor(biome: number, x: number, z: number): number {
  const base = BIOME_GRASS_COLOR[biome] ?? 0x91bd59;
  switch (BIOME_GRASS_MODIFIER[biome]) {
    case 1: return (((base & 0xfefefe) + 0x28340a) >> 1);
    case 2: return getInfoNoise().get(x * 0.0225, z * 0.0225) < -0.1 ? 0x4c763c : 0x6a7039;
    default: return base;
  }
}
export const biomeFoliageColor = (biome: number): number => BIOME_FOLIAGE_COLOR[biome] ?? 0x77ab2f;
export const biomeWaterColor = (biome: number): number => BIOME_WATER_COLOR[biome] ?? 0x3f76e4;
