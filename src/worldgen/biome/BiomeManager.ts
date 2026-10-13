/**
 * Port of net.minecraft.world.level.biome.BiomeManager: the "voronoi zoom" that turns the 4x4x4
 * quart-resolution noise biomes into per-block biomes with seeded, jittered borders.
 */
import { sha256 } from './sha256';

export interface BiomeResolver { getNoiseBiome(quartX: number, quartY: number, quartZ: number): string; }

/** BiomeManager.obfuscateSeed: Guava sha256().hashLong(seed).asLong() (little-endian in, first 8 bytes little-endian out). */
export function obfuscateSeed(seed: bigint): bigint {
  const inb = new Uint8Array(8), dv = new DataView(inb.buffer);
  dv.setBigInt64(0, BigInt.asIntN(64, seed), true);
  return new DataView(sha256(inb).buffer).getBigInt64(0, true);
}

const MUL = 6364136223846793005n, INC = 1442695040888963407n;
const lcg = (rval: bigint, c: bigint): bigint => BigInt.asIntN(64, BigInt.asIntN(64, rval * BigInt.asIntN(64, rval * MUL + INC)) + c);
const fiddle = (rval: bigint): number => {
  const v = (((rval >> 24n) % 1024n) + 1024n) % 1024n;       // Math.floorMod(rval >> 24, 1024)
  return (Number(v) / 1024 - 0.5) * 0.9;
};

export class BiomeManager {
  private fiddles = new Map<number, [number, number, number]>();
  constructor(private readonly source: BiomeResolver, private readonly zoomSeed: bigint) {}

  private cornerFiddle(x: number, y: number, z: number): [number, number, number] {
    const cacheable = x > -2097152 && x < 2097152 && z > -2097152 && z < 2097152 && y >= -16 && y < 112;
    const key = cacheable ? ((x + 2097152) * 4194304 + (z + 2097152)) * 128 + (y + 16) : 0;
    if (cacheable) { const hit = this.fiddles.get(key); if (hit) return hit; }
    const bx = BigInt(x), by = BigInt(y), bz = BigInt(z), seed = this.zoomSeed;
    let r = lcg(seed, bx); r = lcg(r, by); r = lcg(r, bz); r = lcg(r, bx); r = lcg(r, by); r = lcg(r, bz);
    const fx = fiddle(r); r = lcg(r, seed); const fy = fiddle(r); r = lcg(r, seed); const fz = fiddle(r);
    const v: [number, number, number] = [fx, fy, fz];
    if (cacheable) { if (this.fiddles.size > 100000) this.fiddles.clear(); this.fiddles.set(key, v); }
    return v;
  }

  /** Per quart cell: the single biome when all 8 surrounding noise biomes agree (then jitter cannot change the answer), else null. */
  private uniform = new Map<number, string | null>();

  getBiome(x: number, y: number, z: number): string {
    const ax = x - 2, ay = y - 2, az = z - 2, px = ax >> 2, py = ay >> 2, pz = az >> 2;
    if (px > -2097152 && px < 2097151 && pz > -2097152 && pz < 2097151 && py >= -16 && py < 111) {
      const ukey = ((px + 2097152) * 4194304 + (pz + 2097152)) * 128 + (py + 16);
      let u = this.uniform.get(ukey);
      if (u === undefined) {
        const src = this.source, b0 = src.getNoiseBiome(px, py, pz);
        u = b0;
        for (let i = 1; i < 8 && u !== null; i++) if (src.getNoiseBiome(px + (i >> 2), py + ((i >> 1) & 1), pz + (i & 1)) !== b0) u = null;
        if (this.uniform.size > 100000) this.uniform.clear();
        this.uniform.set(ukey, u);
      }
      if (u !== null) return u;
    }
    const fx = (ax & 3) / 4, fy = (ay & 3) / 4, fz = (az & 3) / 4;
    let minI = 0, minD = Infinity;
    for (let i = 0; i < 8; i++) {
      const xe = (i & 4) === 0, ye = (i & 2) === 0, ze = (i & 1) === 0;
      const cx = xe ? px : px + 1, cy = ye ? py : py + 1, cz = ze ? pz : pz + 1;
      const dx = xe ? fx : fx - 1, dy = ye ? fy : fy - 1, dz = ze ? fz : fz - 1;
      const [jx, jy, jz] = this.cornerFiddle(cx, cy, cz);
      const d = (dz + jz) * (dz + jz) + (dy + jy) * (dy + jy) + (dx + jx) * (dx + jx);
      if (minD > d) { minI = i; minD = d; }
    }
    return this.source.getNoiseBiome((minI & 4) === 0 ? px : px + 1, (minI & 2) === 0 ? py : py + 1, (minI & 1) === 0 ? pz : pz + 1);
  }
}
