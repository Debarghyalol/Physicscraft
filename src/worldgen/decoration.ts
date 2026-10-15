/**
 * Ground-cover decoration (grass, tall grass, ferns, flowers) following Minecraft's ChunkGenerator.applyBiomeDecoration:
 * per-chunk decoration seed, a per-feature seed derived from the feature's step/index, and the placement-modifier chain
 * (count -> in_square -> heightmap -> biome -> rarity_filter -> noise_threshold_count -> offset -> block_predicate_filter)
 * evaluated depth-first so random numbers are consumed in vanilla order.
 *
 * Pure logic: the world is reached through `DecorationWorld`, so this runs against any column storage.
 */
import { VoxelType } from '../types/physics';
import { Xoroshiro128PlusPlus } from './random';
import { NormalNoise } from './noise';
import { DECORATION_BIOME_FEATURES, DECORATION_BIOME_LIST, DECORATION_FEATURES } from './decoration.data';

export interface DecorationWorld {
  /** Block id at a world cell (AIR when unloaded). */
  block(x: number, y: number, z: number): number;
  /** Place a plant in an air cell. */
  place(x: number, y: number, z: number, type: VoxelType): void;
  /** Vanilla getHeight(): highest solid-or-fluid cell + 1 (plants ignored); `minY` when the column is empty or missing. */
  height(x: number, z: number, kind: HeightmapKind): number;
  /** Biome id (index into DECORATION_BIOME_LIST) at a world column, or -1 when unknown. */
  biome(x: number, z: number): number;
  readonly minY: number;
}
export type HeightmapKind = 'surface' | 'motion';

const STEP = 9; // GenerationStep.Decoration.VEGETAL_DECORATION

const BLOCKS: Record<string, VoxelType> = {
  short_grass: VoxelType.SHORT_GRASS, tall_grass: VoxelType.TALL_GRASS, fern: VoxelType.FERN, large_fern: VoxelType.LARGE_FERN,
  dandelion: VoxelType.DANDELION, poppy: VoxelType.POPPY, blue_orchid: VoxelType.BLUE_ORCHID, allium: VoxelType.ALLIUM,
  azure_bluet: VoxelType.AZURE_BLUET, red_tulip: VoxelType.RED_TULIP, orange_tulip: VoxelType.ORANGE_TULIP,
  white_tulip: VoxelType.WHITE_TULIP, pink_tulip: VoxelType.PINK_TULIP, oxeye_daisy: VoxelType.OXEYE_DAISY,
  cornflower: VoxelType.CORNFLOWER, lily_of_the_valley: VoxelType.LILY_OF_THE_VALLEY, sunflower: VoxelType.SUNFLOWER,
  lilac: VoxelType.LILAC, rose_bush: VoxelType.ROSE_BUSH, peony: VoxelType.PEONY,
};
/** Two-block-tall plants: the cell above must be free (the game draws them as one tall voxel). */
const DOUBLE = new Set<VoxelType>([VoxelType.TALL_GRASS, VoxelType.LARGE_FERN, VoxelType.SUNFLOWER, VoxelType.LILAC, VoxelType.ROSE_BUSH, VoxelType.PEONY]);
/** minecraft:dirt tag + moss/mud, i.e. BushBlock.mayPlaceOn. */
const SOIL = new Set<number>([VoxelType.GRASS, VoxelType.DIRT, VoxelType.COARSE_DIRT, VoxelType.PODZOL, VoxelType.MYCELIUM, VoxelType.MUD, VoxelType.MOSS_BLOCK]);

const biomeIndex = new Map<string, number>(DECORATION_BIOME_LIST.map((n, i) => [n, i]));
const strip = (s: string) => s.replace(/^minecraft:/, '');

// ---------------------------------------------------------------------------------------------------------------------
// java.util.Random (LegacyRandomSource) and the 2D SimplexNoise behind Biome.BIOME_INFO_NOISE
// ---------------------------------------------------------------------------------------------------------------------
class LegacyRandom {
  private sh: number;
  private sl: number;
  constructor(seed: number) {
    const s = (BigInt(seed) ^ 0x5deece66dn) & 0xffffffffffffn;
    this.sh = Number(s >> 24n);
    this.sl = Number(s & 0xffffffn);
  }
  next(bits: number): number {
    const p = this.sl * 0xece66d + 0xb;
    const nsl = p % 16777216;
    const nsh = (Math.floor(p / 16777216) + this.sh * 0xece66d + this.sl * 0x5de) % 16777216;
    this.sh = nsh;
    this.sl = nsl;
    const v = Math.floor((nsh * 16777216 + nsl) / 2 ** (48 - bits));
    return bits === 32 ? v | 0 : v;
  }
  nextInt(bound: number): number {
    if ((bound & (bound - 1)) === 0) return Math.floor((bound * this.next(31)) / 2147483648);
    for (;;) {
      const sample = this.next(31), modulo = sample % bound;
      if (sample - modulo + (bound - 1) < 2147483648) return modulo;
    }
  }
  nextDouble(): number {
    return (this.next(26) * 134217728 + this.next(27)) * 1.1102230246251565e-16;
  }
}

const GRAD: ReadonlyArray<readonly [number, number]> = [
  [1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0, 1], [0, -1], [1, 1], [0, -1], [-1, 1], [0, -1],
]; // x/y components of the vanilla gradient table (z is 0 for the 2D lookups)
class Simplex2D {
  private perm = new Uint8Array(256);
  constructor(random: LegacyRandom) {
    random.nextDouble(); random.nextDouble(); random.nextDouble(); // offsets are discarded but still consume the stream
    for (let i = 0; i < 256; i++) this.perm[i] = i;
    for (let i = 0; i < 256; i++) {
      const o = random.nextInt(256 - i), t = this.perm[i];
      this.perm[i] = this.perm[o + i];
      this.perm[o + i] = t;
    }
  }
  private p(x: number): number { return this.perm[x & 255]; }
  private corner(gi: number, x: number, y: number): number {
    let t = 0.5 - x * x - y * y;
    if (t < 0) return 0;
    t *= t;
    const g = GRAD[gi & 15];
    return t * t * (g[0] * x + g[1] * y);
  }
  get(xin: number, yin: number): number {
    const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    const gi0 = this.p(ii + this.p(jj)) % 12, gi1 = this.p(ii + i1 + this.p(jj + j1)) % 12, gi2 = this.p(ii + 1 + this.p(jj + 1)) % 12;
    return Math.fround(70 * (this.corner(gi0, x0, y0) + this.corner(gi1, x1, y1) + this.corner(gi2, x2, y2)));
  }
}
let biomeInfoNoise: Simplex2D | null = null;
const getBiomeInfoNoise = () => (biomeInfoNoise ??= new Simplex2D(new LegacyRandom(2345)));

// ---------------------------------------------------------------------------------------------------------------------
// Int providers / state providers
// ---------------------------------------------------------------------------------------------------------------------
type Rng = Xoroshiro128PlusPlus;

function sampleInt(p: any, r: Rng): number {
  if (typeof p === 'number') return p;
  switch (strip(p.type)) {
    case 'constant': return p.value;
    case 'uniform': return r.nextIntBounded(p.max_inclusive - p.min_inclusive + 1) + p.min_inclusive;
    case 'clamped': return Math.min(p.max_inclusive, Math.max(p.min_inclusive, sampleInt(p.source, r)));
    case 'trapezoid': {
      const { min, max, plateau } = p;
      if (plateau === 0 && max === -min) return r.nextIntBounded(max + 1) - r.nextIntBounded(max + 1);
      const range = max - min, plateauStart = (range - plateau) >> 1, plateauEnd = range - plateauStart;
      return min + r.nextIntBounded(plateauEnd + 1) + r.nextIntBounded(plateauStart + 1);
    }
    default: throw new Error('unsupported int provider ' + p.type);
  }
}

const noiseCache = new Map<string, NormalNoise>();
function providerNoise(spec: any, seed: number): NormalNoise {
  const key = `${seed}:${spec.base_octave}:${spec.base_amplitude}`;
  let n = noiseCache.get(key);
  if (!n) {
    n = new NormalNoise(Xoroshiro128PlusPlus.fromSeed(BigInt(seed)), { base_octave: spec.base_octave, octave_count: 1, base_amplitude: spec.base_amplitude });
    noiseCache.set(key, n);
  }
  return n;
}

function stateOf(name: string): VoxelType { return BLOCKS[name]; }

function sampleState(p: any, r: Rng, x: number, y: number, z: number): VoxelType {
  switch (p.type) {
    case 'constant': return stateOf(p.state);
    case 'weighted': {
      let total = 0;
      for (const e of p.entries) total += e.weight;
      let roll = r.nextIntBounded(total);
      for (const e of p.entries) { roll -= e.weight; if (roll < 0) return stateOf(e.state); }
      return stateOf(p.entries[p.entries.length - 1].state);
    }
    case 'noise_threshold': {
      const v = providerNoise(p.noise, p.seed).sample(x * p.scale, y * p.scale, z * p.scale);
      if (v < p.threshold) return stateOf(p.low_states[r.nextIntBounded(p.low_states.length)]);
      return r.nextFloat() < p.high_chance ? stateOf(p.high_states[r.nextIntBounded(p.high_states.length)]) : stateOf(p.default_state);
    }
    case 'noise': {
      const v = providerNoise(p.noise, p.seed).sample(x * p.scale, y * p.scale, z * p.scale);
      const n = p.states.length;
      return stateOf(p.states[Math.min(n - 1, Math.max(0, Math.floor(((1 + v) / 2) * n)))]);
    }
    case 'dual_noise': {
      // Patchwork meadow: the slow noise decides how many kinds are in play around here, the fast noise picks among them.
      const slow = providerNoise(p.slow_noise, p.seed).sample(x * p.slow_scale, y * p.slow_scale, z * p.slow_scale);
      const fast = providerNoise(p.noise, p.seed).sample(x * p.scale, y * p.scale, z * p.scale);
      const n = p.states.length, [vmin, vmax] = p.variety as [number, number];
      const count = Math.min(vmax, Math.max(vmin, Math.floor(vmin + ((slow + 1) / 2) * (vmax + 1 - vmin))));
      const start = Math.min(n - 1, Math.max(0, Math.floor(((slow * 7.3 + 1) / 2 + 1) * n) % n));
      const pick = Math.min(count - 1, Math.max(0, Math.floor(((1 + fast) / 2) * count)));
      return stateOf(p.states[(start + pick * 3) % n]);
    }
    default: throw new Error('unsupported state provider ' + p.type);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------------------------------------------------
type Emit = (x: number, y: number, z: number) => void;

export class Decorator {
  private readonly seed: bigint;
  constructor(seed: number) {
    this.seed = BigInt(seed);
  }

  /** Vanilla WorldgenRandom.setDecorationSeed(worldSeed, minBlockX, minBlockZ). */
  private decorationSeed(minX: number, minZ: number): bigint {
    const r = Xoroshiro128PlusPlus.fromSeed(this.seed);
    const xs = r.nextLong() | 1n, zs = r.nextLong() | 1n;
    return BigInt.asIntN(64, BigInt.asIntN(64, BigInt(minX) * xs + BigInt(minZ) * zs) ^ this.seed);
  }

  /**
   * Decorate chunk (cx, cz). `biomeGrids` are the per-column biome grids of the 3x3 neighbourhood (for the possible-biome set).
   * `only`, when given, restricts placement to cells accepted by it (used to patch a freshly regenerated neighbour).
   */
  decorate(cx: number, cz: number, world: DecorationWorld, biomeGrids: Array<Uint8Array | null>, accept?: (x: number, z: number) => boolean) {
    const possible = new Set<string>();
    for (const g of biomeGrids) {
      if (!g) continue;
      for (let i = 0; i < 16; i++) {
        const name = DECORATION_BIOME_LIST[g[i]];
        const feats = name && DECORATION_BIOME_FEATURES[name];
        if (feats) for (const f of feats) possible.add(f);
      }
    }
    if (!possible.size) return;
    const names = [...possible].sort((a, b) => DECORATION_FEATURES[a].index - DECORATION_FEATURES[b].index);
    const minX = cx * 16, minZ = cz * 16;
    const decSeed = this.decorationSeed(minX, minZ);
    for (const name of names) {
      const data = DECORATION_FEATURES[name];
      const rng = Xoroshiro128PlusPlus.fromSeed(BigInt.asIntN(64, decSeed + BigInt(data.index) + BigInt(10000 * STEP)));
      this.placeFeature(name, data.feature, data.placement, rng, minX, world.minY, minZ, world, accept);
    }
  }

  private placeFeature(topName: string, feature: any, mods: any[], r: Rng, ox: number, oy: number, oz: number, world: DecorationWorld, accept?: (x: number, z: number) => boolean) {
    const run = (i: number, x: number, y: number, z: number): void => {
      if (i === mods.length) {
        this.place(topName, feature, r, x, y, z, world, accept);
        return;
      }
      const m = mods[i];
      const next: Emit = (nx, ny, nz) => run(i + 1, nx, ny, nz);
      switch (m.type) {
        case 'count': {
          const n = sampleInt(m.count, r);
          for (let k = 0; k < n; k++) next(x, y, z);
          break;
        }
        case 'in_square': {
          const dx = r.nextIntBounded(16), dz = r.nextIntBounded(16);
          next(x + dx, y, z + dz);
          break;
        }
        case 'heightmap': {
          const h = world.height(x, z, m.heightmap === 'WORLD_SURFACE_WG' || m.heightmap === 'WORLD_SURFACE' ? 'surface' : 'motion');
          if (h > world.minY) next(x, h, z);
          break;
        }
        case 'biome': {
          const id = world.biome(x, z);
          const list = id >= 0 ? DECORATION_BIOME_FEATURES[DECORATION_BIOME_LIST[id]] : undefined;
          if (list && list.includes(topName)) next(x, y, z);
          break;
        }
        case 'rarity_filter':
          if (r.nextFloat() < 1 / m.chance) next(x, y, z);
          break;
        case 'noise_threshold_count': {
          const n = getBiomeInfoNoise().get(x / 200, z / 200) < m.noise_level ? m.below_noise : m.above_noise;
          for (let k = 0; k < n; k++) next(x, y, z);
          break;
        }
        case 'offset': {
          const dx = sampleInt(m.x ?? 0, r), dy = sampleInt(m.y ?? 0, r), dz = sampleInt(m.z ?? 0, r);
          next(x + dx, y + dy, z + dz);
          break;
        }
        case 'block_predicate_filter': {
          if (world.block(x, y, z) !== VoxelType.AIR) break;
          if (JSON.stringify(m.predicate).includes('podzol') && world.block(x, y - 1, z) === VoxelType.PODZOL) break;
          next(x, y, z);
          break;
        }
        default: throw new Error('unsupported placement modifier ' + m.type);
      }
    };
    run(0, ox, oy, oz);
  }

  private place(topName: string, feature: any, r: Rng, x: number, y: number, z: number, world: DecorationWorld, accept?: (x: number, z: number) => boolean) {
    if (feature.type === 'simple_random_selector') {
      const pick = feature.features[r.nextIntBounded(feature.features.length)];
      this.placeFeature(topName, pick.feature, pick.placement, r, x, y, z, world, accept);
      return;
    }
    // simple_block
    const type = sampleState(feature.to_place, r, x, y, z);
    if (type === undefined) return;
    if (accept && !accept(x, z)) return;
    if (!SOIL.has(world.block(x, y - 1, z)) || world.block(x, y, z) !== VoxelType.AIR) return;
    if (DOUBLE.has(type) && world.block(x, y + 1, z) !== VoxelType.AIR) return;
    world.place(x, y, z, type);
  }
}
