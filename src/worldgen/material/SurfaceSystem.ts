/**
 * Port of net.minecraft.world.level.levelgen.material.MaterialSystem / MaterialRuleContext:
 * walks every column top-down, tracks stone/water depth and runs the vanilla surface rules.
 * Block identities are vanilla names without namespace (e.g. "grass_block"); the caller maps them.
 */
import { OVERWORLD_SETTINGS } from '../data.generated';
import type { DensityFunctionCompiler } from '../density';
import type { BiomeManager } from '../biome/BiomeManager';
import type { PositionalRandomFactory, Xoroshiro128PlusPlus } from '../random';
import { MaterialRuleCompiler, NO_WATER, type RuleContext } from './MaterialRules';

/** The chunk-side view the surface builder needs (ChunkAccess + heightmap). */
export interface SurfaceChunk {
  minBlockX: number; minBlockZ: number;
  minY: number;          // lowest block y
  maxY: number;          // highest block y (inclusive)
  /** Heightmap.WORLD_SURFACE_WG: y of the highest non-air block (minY - 1 when the column is empty). Must reflect set(). */
  height(lx: number, lz: number): number;
  /** 0 = air, 1 = fluid, 2 = solid. y outside [minY, maxY] must read as air. */
  kind(lx: number, lz: number, y: number): 0 | 1 | 2;
  isWater(lx: number, lz: number, y: number): boolean;
  isDefaultBlock(lx: number, lz: number, y: number): boolean;
  set(lx: number, lz: number, y: number, block: string): void;
}

const WAY_BELOW_MIN_Y = -4064;
const T = 'terracotta', O = 'orange_terracotta', Y = 'yellow_terracotta', B = 'brown_terracotta', R = 'red_terracotta', W = 'white_terracotta', G = 'light_gray_terracotta';

function makeBands(random: Xoroshiro128PlusPlus, bands: string[], baseWidth: number, state: string) {
  const count = random.nextIntBetweenInclusive(6, 15);
  for (let i = 0; i < count; i++) {
    const width = baseWidth + random.nextIntBounded(3), start = random.nextIntBounded(bands.length);
    for (let p = 0; start + p < bands.length && p < width; p++) bands[start + p] = state;
  }
}
/** MaterialSystem.generateBands */
function generateBands(random: Xoroshiro128PlusPlus): string[] {
  const bands = new Array<string>(192).fill(T);
  for (let i = 0; i < bands.length; i++) { i += random.nextIntBounded(5) + 1; if (i < bands.length) bands[i] = O; }
  makeBands(random, bands, 1, Y); makeBands(random, bands, 2, B); makeBands(random, bands, 1, R);
  const whiteCount = random.nextIntBetweenInclusive(9, 15);
  for (let i = 0, start = 0; i < whiteCount && start < bands.length; start += random.nextIntBounded(16) + 4, i++) {
    bands[start] = W;
    if (start - 1 > 0 && random.nextBoolean()) bands[start - 1] = G;
    if (start + 1 < bands.length && random.nextBoolean()) bands[start + 1] = G;
  }
  return bands;
}

class Context implements RuleContext {
  blockX = 0; blockY = 0; blockZ = 0;
  surfaceGradientX = 0; surfaceGradientZ = 0; surfaceDepth = 0;
  stoneDepthAbove = 0; stoneDepthBelow = 0; waterHeight = NO_WATER;
  xzVersion = 0; yVersion = 0;
  private biomeY = -1; private biomeName = ''; private secVer = -1; private sec = 0; private minLevelVer = -1; private minLevel = 0;
  private noiseCache = new Map<string, { ver: number; v: number }>();
  private factories = new Map<string, PositionalRandomFactory>();
  constructor(private sys: SurfaceSystem, readonly minY: number, readonly height: number) {}
  updateXZ(x: number, z: number, gx: number, gz: number) {
    this.xzVersion++; this.yVersion++; this.blockX = x; this.blockZ = z; this.surfaceGradientX = gx; this.surfaceGradientZ = gz;
    this.surfaceDepth = this.sys.getSurfaceDepth(x, z);
  }
  updateY(above: number, below: number, water: number, y: number) {
    this.yVersion++; this.blockY = y; this.waterHeight = water; this.stoneDepthBelow = below; this.stoneDepthAbove = above;
  }
  biome(): string {
    if (this.biomeY !== this.yVersion) { this.biomeY = this.yVersion; this.biomeName = this.sys.biomeManager.getBiome(this.blockX, this.blockY, this.blockZ); }
    return this.biomeName;
  }
  surfaceSecondary(): number {
    if (this.secVer !== this.xzVersion) { this.secVer = this.xzVersion; this.sec = this.sys.getSurfaceSecondary(this.blockX, this.blockZ); }
    return this.sec;
  }
  minSurfaceLevel(): number {
    if (this.minLevelVer !== this.xzVersion) {
      this.minLevelVer = this.xzVersion;
      this.minLevel = Math.floor(this.sys.preliminarySurface(this.blockX, this.blockZ)) + this.surfaceDepth - 8;
    }
    return this.minLevel;
  }
  noise(name: string, is3d: boolean): number {
    const key = (is3d ? '3:' : '2:') + name, ver = is3d ? this.yVersion : this.xzVersion, hit = this.noiseCache.get(key);
    if (hit && hit.ver === ver) return hit.v;
    const v = this.sys.compiler.getNoise(name).sample(this.blockX, is3d ? this.blockY : 0, this.blockZ);
    this.noiseCache.set(key, { ver, v });
    return v;
  }
  randomFactory(name: string): PositionalRandomFactory {
    let f = this.factories.get(name);
    if (!f) { f = this.sys.compiler.randomFactoryFor(name); this.factories.set(name, f); }
    return f;
  }
  band(x: number, y: number, z: number): string { return this.sys.getBand(x, y, z); }
}

export interface SurfaceSystemOptions { minY: number; height: number; }

export class SurfaceSystem {
  readonly seaLevel: number = OVERWORLD_SETTINGS.sea_level;
  private readonly clayBands: string[];
  private readonly noiseRandom: PositionalRandomFactory;
  private readonly rule: (x: number, y: number, z: number) => string | null;
  private readonly ctx: Context;
  private readonly prelim: (p: { x: number; y: number; z: number }) => number;
  private readonly minY: number; private readonly maxY: number;

  constructor(readonly compiler: DensityFunctionCompiler, readonly biomeManager: BiomeManager, opts: SurfaceSystemOptions = { minY: -64, height: 384 }) {
    this.minY = opts.minY; this.maxY = opts.minY + opts.height - 1;
    this.noiseRandom = compiler.rootFactory;
    this.clayBands = generateBands(this.noiseRandom.fromHashOf('minecraft:clay_bands'));
    this.prelim = compiler.compileRef('minecraft:overworld/chunk_surface_level');
    this.ctx = new Context(this, opts.minY, opts.height);
    this.rule = new MaterialRuleCompiler(this.ctx).compileRule(OVERWORLD_SETTINGS.material_rule);
  }

  preliminarySurface(x: number, z: number): number { return this.prelim({ x, y: 0, z }); }
  /** MaterialSystem.getSurfaceDepth */
  getSurfaceDepth(x: number, z: number): number {
    const n = this.compiler.getNoise('surface').sample(x, 0, z);
    return Math.trunc(n * 2.75 + 3.0 + this.noiseRandom.at(x, 0, z).nextDouble() * 0.25);
  }
  getSurfaceSecondary(x: number, z: number): number { return this.compiler.getNoise('surface_secondary').sample(x, 0, z); }
  /** MaterialSystem.getBand */
  getBand(x: number, y: number, z: number): string {
    const offset = Math.round(this.compiler.getNoise('clay_bands_offset').sample(x, 0, z) * 4);
    return this.clayBands[(y + offset + this.clayBands.length) % this.clayBands.length];
  }

  buildSurface(chunk: SurfaceChunk) {
    const ctx = this.ctx;
    for (let lx = 0; lx < 16; lx++) {
      for (let lz = 0; lz < 16; lz++) {
        const bx = chunk.minBlockX + lx, bz = chunk.minBlockZ + lz;
        const startingHeight = chunk.height(lx, lz) + 1;
        const surfaceBiome = this.biomeManager.getBiome(bx, startingHeight, bz);
        if (surfaceBiome === 'eroded_badlands') this.erodedBadlandsExtension(chunk, lx, lz, bx, bz, startingHeight);
        const height = chunk.height(lx, lz) + 1;
        const gx = chunk.height(Math.min(lx + 1, 15), lz) - chunk.height(Math.max(lx - 1, 0), lz);
        const gz = chunk.height(lx, Math.min(lz + 1, 15)) - chunk.height(lx, Math.max(lz - 1, 0));
        ctx.updateXZ(bx, bz, gx, gz);
        let stoneAbove = 0, waterHeight = NO_WATER, nextCeilingStoneY = 2147483647;
        const endY = chunk.minY;
        for (let y = height; y >= endY; y--) {
          const k = chunk.kind(lx, lz, y);
          if (k === 0) { stoneAbove = 0; waterHeight = NO_WATER; }
          else if (k === 1) { if (waterHeight === NO_WATER) waterHeight = y + 1; }
          else {
            if (nextCeilingStoneY >= y) {
              nextCeilingStoneY = WAY_BELOW_MIN_Y;
              for (let la = y - 1; la >= endY - 1; la--) if (chunk.kind(lx, lz, la) !== 2) { nextCeilingStoneY = la + 1; break; }
            }
            stoneAbove++;
            ctx.updateY(stoneAbove, y - nextCeilingStoneY + 1, waterHeight, y);
            if (y >= this.minY && y <= this.maxY) { const s = this.rule(bx, y, bz); if (s !== null) chunk.set(lx, lz, y, s); }
          }
        }
        if (surfaceBiome === 'frozen_ocean' || surfaceBiome === 'deep_frozen_ocean') this.frozenOceanExtension(chunk, ctx.minSurfaceLevel(), lx, lz, bx, bz, startingHeight);
      }
    }
  }

  /** MaterialSystem.erodedBadlandsExtension: the freestanding terracotta pillars. */
  private erodedBadlandsExtension(chunk: SurfaceChunk, lx: number, lz: number, bx: number, bz: number, height: number) {
    const c = this.compiler;
    const buffer = Math.min(Math.abs(c.getNoise('badlands_surface').sample(bx, 0, bz) * 8.25), c.getNoise('badlands_pillar').sample(bx * 0.2, 0, bz * 0.2) * 15);
    if (buffer <= 0) return;
    const floor = Math.abs(c.getNoise('badlands_pillar_roof').sample(bx * 0.75, 0, bz * 0.75) * 1.5);
    const startY = Math.floor(64 + Math.min(buffer * buffer * 2.5, Math.ceil(floor * 50) + 24));
    if (height > startY) return;
    for (let y = startY; y >= chunk.minY; y--) { if (chunk.isDefaultBlock(lx, lz, y)) break; if (chunk.isWater(lx, lz, y)) return; }
    for (let y = startY; y >= chunk.minY && chunk.kind(lx, lz, y) === 0; y--) chunk.set(lx, lz, y, 'stone');
  }

  /**
   * MaterialSystem.frozenOceanExtension: icebergs. Biome.shouldMeltFrozenOceanIcebergSlightly needs the
   * simplex temperature noise (not ported), so icebergs are never melted here.
   */
  private frozenOceanExtension(chunk: SurfaceChunk, minSurfaceLevel: number, lx: number, lz: number, bx: number, bz: number, height: number) {
    const c = this.compiler, sea = this.seaLevel;
    const iceberg = Math.min(Math.abs(c.getNoise('iceberg_surface').sample(bx, 0, bz) * 8.25), c.getNoise('iceberg_pillar').sample(bx * 1.28, 0, bz * 1.28) * 15);
    if (iceberg <= 1.8) return;
    const roof = Math.abs(c.getNoise('iceberg_pillar_roof').sample(bx * 1.17, 0, bz * 1.17) * 1.5);
    let top = Math.min(iceberg * iceberg * 1.2, Math.ceil(roof * 40) + 14);
    if (top <= 2) return;
    const bottom = sea - top - 7;
    top += sea;
    const extensionTop = top;
    const random = this.noiseRandom.at(bx, 0, bz);
    const maxSnowDepth = 2 + random.nextIntBounded(4), minSnowHeight = sea + 18 + random.nextIntBounded(10);
    let snowDepth = 0;
    for (let y = Math.max(height, Math.trunc(top) + 1); y >= minSurfaceLevel; y--) {
      const k = chunk.kind(lx, lz, y);
      if ((k === 0 && y < Math.trunc(extensionTop) && random.nextDouble() > 0.01) || (chunk.isWater(lx, lz, y) && y > Math.trunc(bottom) && y < sea && random.nextDouble() > 0.15)) {
        if (snowDepth <= maxSnowDepth && y > minSnowHeight) { chunk.set(lx, lz, y, 'snow_block'); snowDepth++; }
        else chunk.set(lx, lz, y, 'packed_ice');
      }
    }
  }
}
