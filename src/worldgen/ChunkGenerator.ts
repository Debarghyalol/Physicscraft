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
import { chooseTreeKind, placeTreeFeature } from './trees';

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
}

const idx = (lx: number, wy: number, lz: number): number => (((wy - GEN_MIN_Y) << 4 | lz) << 4) | lx;
const hash3 = (x: number, y: number, z: number): number => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};

export class ChunkGenerator {
  private readonly compiler: DensityFunctionCompiler;
  private readonly finalDensity: Density;
  private readonly surfaceSystem: SurfaceSystem;
  private readonly temperatureFn: Density;
  private readonly vegetationFn: Density;
  private readonly top = new Int16Array(256);
  private readonly worldSurface = new Int16Array(256);

  constructor(readonly seed: number) {
    this.compiler = new DensityFunctionCompiler(seed);
    this.finalDensity = this.compiler.compileRoot();
    const biomeManager = new BiomeManager(new MultiNoiseBiomeSource(this.compiler), obfuscateSeed(BigInt(seed)));
    this.surfaceSystem = new SurfaceSystem(this.compiler, biomeManager, { minY: GEN_MIN_Y, height: GEN_HEIGHT });
    this.temperatureFn = this.compiler.compileRef('minecraft:overworld/temperature');
    this.vegetationFn = this.compiler.compileRef('minecraft:overworld/vegetation');
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

    // Pass 3: provisional temperature/vegetation-routed trees. Writes inside this column are applied to air only;
    // the rest are returned so the owner can place them into neighbouring columns (or queue them until they load).
    const outside: number[] = [];
    const write = (x: number, y: number, z: number, type: VoxelType) => {
      if (y < GEN_MIN_Y || y >= GEN_MAX_Y) return;
      if ((x >> 4) === cx && (z >> 4) === cz) {
        const i = idx(x & 15, y, z & 15);
        if (blocks[i] === VoxelType.AIR) blocks[i] = type;
      } else outside.push(x, y, z, type);
    };
    const env = { x: 0, y: 0, z: 0 };
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const wx = cx * 16 + lx, wz = cz * 16 + lz, t = top[lz * 16 + lx];
        if (t < 1 || t >= 250 || blocks[idx(lx, t, lz)] !== VoxelType.GRASS) continue;
        const roll = hash3(wx, 0, wz) / 0xffffffff;
        if (roll > 0.018) continue;
        env.x = wx; env.y = t; env.z = wz;
        const kind = chooseTreeKind({ temperature: this.temperatureFn(env), vegetation: this.vegetationFn(env) }, roll);
        placeTreeFeature(kind, this.seed, wx, t + 1, wz, write);
      }
    }
    return { blocks, writes: Int32Array.from(outside) };
  }
}
