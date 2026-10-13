/** Port of MultiNoiseBiomeSource + Climate.Sampler for the overworld preset. */
import type { DensityFunctionCompiler } from '../density';
import { ParameterList, target } from './climate';
import { overworldBiomeParameters } from './OverworldBiomeBuilder';
import type { BiomeResolver } from './BiomeManager';

export class MultiNoiseBiomeSource implements BiomeResolver {
  private readonly list = new ParameterList(overworldBiomeParameters());
  private readonly fns: Array<(p: { x: number; y: number; z: number }) => number>;
  private readonly cache = new Map<string, string>();
  constructor(compiler: DensityFunctionCompiler) {
    // Climate.Sampler order: temperature, humidity (vegetation), continentalness, erosion, depth, weirdness (ridges).
    this.fns = ['temperature', 'vegetation', 'continents', 'erosion', 'depth', 'ridges'].map((n) => compiler.compileRef('minecraft:overworld/' + n));
  }
  /** Climate.Sampler.sample: noises are evaluated at the quart's minimum block corner. */
  getNoiseBiome(qx: number, qy: number, qz: number): string {
    const key = qx + ',' + qy + ',' + qz, hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const p = { x: qx << 2, y: qy << 2, z: qz << 2 };
    const [t, h, c, e, d, w] = this.fns.map((f) => f(p));
    const biome = this.list.findValue(target(t, h, c, e, d, w));
    if (this.cache.size > 400000) this.cache.clear();
    this.cache.set(key, biome);
    return biome;
  }
}
