/**
 * Pure (DOM/THREE-free) column generator so the exact same code runs in a Web Worker or on the main thread.
 * Terrain fill works on the vanilla 4x8x4 cell grid: cells whose 8 corner densities are all <= 0 (air) or all > 0 (solid)
 * are skipped / filled in bulk; only the mixed cells around the surface are interpolated per block.
 */
import { VoxelType } from '../types/physics';
import { DensityFunctionCompiler, ChunkDensitySampler, type Density } from './density';
import { MultiNoiseBiomeSource } from './biome/MultiNoiseBiomeSource';
import { BiomeManager, obfuscateSeed } from './biome/BiomeManager';
import { SurfaceSystem, type SurfaceChunk } from './material/SurfaceSystem';
import { vanillaBlockToVoxel } from './blocks';
import { DECORATION_BIOME_LIST } from './decoration.data';

const BIOME_ID = new Map<string, number>(DECORATION_BIOME_LIST.map((n, i) => [n, i]));

export const GEN_MIN_Y = -64;
export const GEN_MAX_Y = 320; // exclusive
export const GEN_HEIGHT = GEN_MAX_Y - GEN_MIN_Y;
const SEA_LEVEL = 63;
const CELLS_Y = GEN_HEIGHT / 8;

export interface GeneratedChunk {
  /** Column blocks, layout [y][z][x] (same as ChunkColumn). */
  blocks: Uint8Array;
  /** Tree/feature writes that landed outside this column, as flat [x, y, z, type] quadruples. */
  writes: Int32Array;
  /** Biome ids (index into DECORATION_BIOME_LIST) on a 4x4 quart grid at the surface, [qz*4+qx]. */
  biomes: Uint8Array;
}

const idx = (lx: number, wy: number, lz: number): number => (((wy - GEN_MIN_Y) << 4 | lz) << 4) | lx;
export class ChunkGenerator {
  private readonly compiler: DensityFunctionCompiler;
  private readonly finalDensity: Density;
  private readonly surfaceSystem: SurfaceSystem;
  private readonly biomeManager: BiomeManager;
  private readonly top = new Int16Array(256);
  private readonly worldSurface = new Int16Array(256);

  constructor(readonly seed: number) {
    this.compiler = new DensityFunctionCompiler(seed);
    this.finalDensity = this.compiler.compileRoot();
    const biomeManager = this.biomeManager = new BiomeManager(new MultiNoiseBiomeSource(this.compiler), obfuscateSeed(BigInt(seed)));
    this.surfaceSystem = new SurfaceSystem(this.compiler, biomeManager, { minY: GEN_MIN_Y, height: GEN_HEIGHT });
  }

  /** Vanilla NoiseSpawnFinder search, using overworld spawn-target climate intervals. */
  findSpawnPosition(): { x: number; z: number } {
    const targets = [
      { continents: [-0.11, 1], erosion: [-1, 1], ridges: [-1, -0.16] },
      { continents: [-0.11, 1], erosion: [-1, 1], ridges: [0.16, 1] },
    ];
    const sample = {
      continents: this.compiler.compileRef('minecraft:overworld/continents'),
      erosion: this.compiler.compileRef('minecraft:overworld/erosion'),
      ridges: this.compiler.compileRef('minecraft:overworld/ridges'),
    };
    const sampleCache = new Map<string, { continents: number; erosion: number; ridges: number }>();
    const fitnessAt = (x: number, z: number): number => {
      const qx = Math.floor(x / 4) * 4, qz = Math.floor(z / 4) * 4;
      const key = `${qx},${qz}`;
      let values = sampleCache.get(key);
      if (!values) {
        const p = { x: qx, y: 0, z: qz };
        values = {
          continents: Math.trunc(sample.continents(p) * 10000),
          erosion: Math.trunc(sample.erosion(p) * 10000),
          ridges: Math.trunc(sample.ridges(p) * 10000),
        };
        sampleCache.set(key, values);
      }
      let minFitness = Number.POSITIVE_INFINITY;
      for (const target of targets) {
        const dist = (v: number, range: number[]) => Math.max(range[0] * 10000 - v, 0, v - range[1] * 10000);
        const dc = dist(values.continents, target.continents);
        const de = dist(values.erosion, target.erosion);
        const dr = dist(values.ridges, target.ridges);
        minFitness = Math.min(minFitness, dc * dc + de * de + dr * dr);
      }
      return minFitness * 2048 * 2048 + x * x + z * z;
    };

    let bestX = 0, bestZ = 0, bestFitness = fitnessAt(0, 0);
    const radialSearch = (maxRadius: number, increment: number) => {
      let angle = 0, radius = increment;
      const originX = bestX, originZ = bestZ;
      while (radius <= maxRadius) {
        const x = originX + Math.trunc(Math.sin(angle) * radius);
        const z = originZ + Math.trunc(Math.cos(angle) * radius);
        const fitness = fitnessAt(x, z);
        if (fitness < bestFitness) { bestX = x; bestZ = z; bestFitness = fitness; }
        angle += increment / radius;
        if (angle > Math.PI * 2) { angle = 0; radius += increment; }
      }
    };
    radialSearch(2048, 512);
    radialSearch(512, 32);
    return { x: bestX, z: bestZ };
  }

  generate(cx: number, cz: number): GeneratedChunk {
    const blocks = new Uint8Array(256 * GEN_HEIGHT);
    const top = this.top, worldSurface = this.worldSurface;
    top.fill(GEN_MIN_Y - 1);
    const STONE = VoxelType.STONE;

    // Pass 1: noise fill. The lowest layer is always stone; solid where interpolated density > 0.
    blocks.fill(STONE, 0, 256);
    const sampler = new ChunkDensitySampler(this.finalDensity, cx * 16, cz * 16, GEN_MIN_Y);
    for (let ix = 0; ix < 4; ix++) {
      for (let iz = 0; iz < 4; iz++) {
        let a000 = sampler.corner(ix, 0, iz), a100 = sampler.corner(ix + 1, 0, iz), a001 = sampler.corner(ix, 0, iz + 1), a101 = sampler.corner(ix + 1, 0, iz + 1);
        let b000 = 0, b100 = 0, b001 = 0, b101 = 0;
        for (let iy = 0; iy < CELLS_Y; iy++, a000 = b000, a100 = b100, a001 = b001, a101 = b101) {
          b000 = sampler.corner(ix, iy + 1, iz); b100 = sampler.corner(ix + 1, iy + 1, iz);
          b001 = sampler.corner(ix, iy + 1, iz + 1); b101 = sampler.corner(ix + 1, iy + 1, iz + 1);
          const mx = Math.max(a000, a100, a001, a101, b000, b100, b001, b101);
          if (mx <= 0) continue; // air cell: no interpolated value can exceed 0
          const mn = Math.min(a000, a100, a001, a101, b000, b100, b001, b101);
          const y0 = iy * 8, bx = ix * 4, bz = iz * 4;
          if (mn > 0) { // solid cell
            for (let k = 0; k < 8; k++) {
              for (let j = 0; j < 4; j++) {
                const base = ((y0 + k) * 16 + bz + j) * 16 + bx;
                blocks[base] = STONE; blocks[base + 1] = STONE; blocks[base + 2] = STONE; blocks[base + 3] = STONE;
              }
            }
            const ty = GEN_MIN_Y + y0 + 7;
            for (let j = 0; j < 4; j++) { const r = (bz + j) * 16 + bx; top[r] = ty; top[r + 1] = ty; top[r + 2] = ty; top[r + 3] = ty; }
            continue;
          }
          // Mixed cell: same trilinear arithmetic (and operation order) as ChunkDensitySampler.sample.
          for (let i = 0; i < 4; i++) {
            const tx = i / 4;
            const a = a000 + (a100 - a000) * tx, b = a001 + (a101 - a001) * tx, c = b000 + (b100 - b000) * tx, d = b001 + (b101 - b001) * tx;
            for (let j = 0; j < 4; j++) {
              const tz = j / 4, e = a + (b - a) * tz, f = c + (d - c) * tz, col = (bz + j) * 16 + bx + i;
              for (let k = 0; k < 8; k++) {
                if (e + (f - e) * (k / 8) > 0) {
                  const ly = y0 + k;
                  blocks[(ly * 16 + bz + j) * 16 + bx + i] = STONE;
                  top[col] = GEN_MIN_Y + ly;
                }
              }
            }
          }
        }
      }
    }

    // Open space under sea level becomes water; WORLD_SURFACE_WG heightmap for the surface system.
    for (let col = 0; col < 256; col++) {
      const t = top[col], lx = col & 15, lz = col >> 4;
      if (t < SEA_LEVEL) {
        for (let y = Math.max(GEN_MIN_Y + 1, t + 1); y <= SEA_LEVEL; y++) {
          const i = idx(lx, y, lz);
          if (blocks[i] === VoxelType.AIR) blocks[i] = VoxelType.WATER;
        }
        worldSurface[col] = SEA_LEVEL;
      } else worldSurface[col] = t;
    }

    // Pass 2: vanilla surface rules (biomes, grass/dirt/sand/terracotta/snow, deepslate, bedrock).
    const chunk: SurfaceChunk = {
      minBlockX: cx * 16, minBlockZ: cz * 16, minY: GEN_MIN_Y, maxY: GEN_MAX_Y - 1,
      height: (lx, lz) => worldSurface[lz * 16 + lx],
      kind: (lx, lz, y) => {
        if (y < GEN_MIN_Y || y >= GEN_MAX_Y) return 0;
        const t = blocks[idx(lx, y, lz)];
        return t === VoxelType.AIR ? 0 : t === VoxelType.WATER ? 1 : 2;
      },
      isWater: (lx, lz, y) => y >= GEN_MIN_Y && y < GEN_MAX_Y && blocks[idx(lx, y, lz)] === VoxelType.WATER,
      isDefaultBlock: (lx, lz, y) => y >= GEN_MIN_Y && y < GEN_MAX_Y && blocks[idx(lx, y, lz)] === STONE,
      set: (lx, lz, y, name) => {
        if (y < GEN_MIN_Y || y >= GEN_MAX_Y) return;
        const t = vanillaBlockToVoxel(name);
        blocks[idx(lx, y, lz)] = t;
        const h = lz * 16 + lx;
        if (t !== VoxelType.AIR && y > worldSurface[h]) worldSurface[h] = y;
      },
    };
    this.surfaceSystem.buildSurface(chunk);

    // Surface biome per quart column, used by the decoration pass (possible-biome set and BiomeFilter).
    const biomes = new Uint8Array(16);
    for (let qz = 0; qz < 4; qz++) {
      for (let qx = 0; qx < 4; qx++) {
        const lx = qx * 4 + 2, lz = qz * 4 + 2;
        const y = Math.max(GEN_MIN_Y, Math.min(GEN_MAX_Y - 1, worldSurface[lz * 16 + lx]));
        biomes[qz * 4 + qx] = BIOME_ID.get(this.biomeManager.getBiome(cx * 16 + lx, y, cz * 16 + lz).replace(/^minecraft:/, '')) ?? 0;
      }
    }
    return { blocks, writes: new Int32Array(0), biomes };
  }
}
