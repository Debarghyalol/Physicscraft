/** Port of MultiNoiseBiomeSource + Climate.Sampler for the overworld preset. */
import type { DensityFunctionCompiler } from '../density';
import { ParameterList, target } from './climate';
import { overworldBiomeParameters } from './OverworldBiomeBuilder';
import type { BiomeResolver } from './BiomeManager';

type Fn = (p: { x: number; y: number; z: number }) => number;
const XZ_LIM = 2097152; // quarts (~8.3M blocks); beyond this the numeric cache key is skipped

export class MultiNoiseBiomeSource implements BiomeResolver {
  private readonly list = new ParameterList(overworldBiomeParameters());
  private readonly fT: Fn; private readonly fH: Fn; private readonly fC: Fn; private readonly fE: Fn; private readonly fD: Fn; private readonly fW: Fn;
  private readonly cache = new Map<number, string>();
  private readonly pt = { x: 0, y: 0, z: 0 };
  constructor(compiler: DensityFunctionCompiler) {
    // Climate.Sampler order: temperature, humidity (vegetation), continentalness, erosion, depth, weirdness (ridges).
    const c = (n: string) => compiler.compileRef('minecraft:overworld/' + n);
    this.fT = c('temperature'); this.fH = c('vegetation'); this.fC = c('continents'); this.fE = c('erosion'); this.fD = c('depth'); this.fW = c('ridges');
  }
  /** Climate.Sampler.sample: noises are evaluated at the quart's minimum block corner. */
  getNoiseBiome(qx: number, qy: number, qz: number): string {
    const cacheable = qx > -XZ_LIM && qx < XZ_LIM && qz > -XZ_LIM && qz < XZ_LIM && qy >= -16 && qy < 112;
    let key = 0;
    if (cacheable) {
      key = ((qx + XZ_LIM) * 4194304 + (qz + XZ_LIM)) * 128 + (qy + 16);
      const hit = this.cache.get(key);
      if (hit !== undefined) return hit;
    }
    const p = this.pt;
    p.x = qx << 2; p.y = qy << 2; p.z = qz << 2;
    const t = this.fT(p), h = this.fH(p), c = this.fC(p), e = this.fE(p), d = this.fD(p), w = this.fW(p);
    const biome = this.list.findValue(target(t, h, c, e, d, w));
    if (cacheable) {
      if (this.cache.size > 150000) this.cache.clear();
      this.cache.set(key, biome);
    }
    return biome;
  }
}
