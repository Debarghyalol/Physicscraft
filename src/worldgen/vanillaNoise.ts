/**
 * Exact ports of the Minecraft 26.3 classes behind block state providers and Biome.BIOME_INFO_NOISE:
 * LegacyRandomSource (java.util.Random), float-precision PerlinNoise / NoiseStack, NormalNoise.create(), 2D SimplexNoise.
 * Every `float` in the Java source is rounded with Math.fround so results match bit for bit.
 */
const f = Math.fround;
const MASK48 = 0xffffffffffffn;

/** java.util.Random as used by LegacyRandomSource (48-bit LCG, kept as two 24-bit halves so doubles stay exact). */
export class LegacyRandom {
  private sh = 0;
  private sl = 0;
  constructor(seed: bigint) {
    const s = (seed ^ 0x5deece66dn) & MASK48;
    this.sh = Number(s >> 24n);
    this.sl = Number(s & 0xffffffn);
  }
  next(bits: number): number {
    const p = this.sl * 0xece66d + 0xb;
    const nsl = p % 16777216;
    this.sh = (Math.floor(p / 16777216) + this.sh * 0xece66d + this.sl * 0x5de) % 16777216;
    this.sl = nsl;
    const v = Math.floor((this.sh * 16777216 + this.sl) / 2 ** (48 - bits));
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
  nextLong(): bigint {
    const hi = this.next(32), lo = this.next(32);
    return BigInt.asIntN(64, (BigInt(hi) << 32n) + BigInt(lo));
  }
  /** LegacyRandomSource.forkPositional(): the factory is seeded with one nextLong(). */
  forkPositional(): { fromHashOf(name: string): LegacyRandom } {
    const seed = this.nextLong();
    return { fromHashOf: (name) => new LegacyRandom(BigInt.asIntN(64, BigInt(javaHash(name)) ^ seed)) };
  }
}
function javaHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

const GX = [1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0, 1, 0, -1, 0];
const GY = [1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 1, -1];
const GZ = [0, 0, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1, 0, 1, 0, -1];
const HALF_ROUND_OFF = 16777215.999999998; // Math.nextDown(1.6777216E7F)
const wrap = (x: number) => (x >= -HALF_ROUND_OFF && x < HALF_ROUND_OFF ? x : x - Math.floor(x / 33554432 + 0.5) * 33554432);
const smooth = (x: number) => f(f(f(f(x * x) * x) * f(f(x * f(f(x * 6) - 15)) + 10)));
const lerpF = (a: number, p0: number, p1: number) => f(p0 + f(a * f(p1 - p0)));
const gradDot = (h: number, x: number, y: number, z: number) => { h &= 15; return f(f(f(GX[h] * x) + f(GY[h] * y)) + f(GZ[h] * z)); };

/** GradientNoise permutation/offset setup shared by Perlin and Simplex. */
abstract class Gradient {
  protected perms = new Uint8Array(256);
  protected ox: number;
  protected oy: number;
  protected oz: number;
  constructor(random: LegacyRandom, offsetScale: number) {
    this.ox = random.nextDouble() * offsetScale;
    this.oy = random.nextDouble() * offsetScale;
    this.oz = random.nextDouble() * offsetScale;
    for (let i = 0; i < 256; i++) this.perms[i] = i;
    for (let i = 0; i < 256; i++) {
      const o = random.nextInt(256 - i), t = this.perms[i];
      this.perms[i] = this.perms[o + i];
      this.perms[o + i] = t;
    }
  }
  protected permute(x: number): number { return this.perms[x & 255]; }
}

export class PerlinNoise extends Gradient {
  constructor(random: LegacyRandom) { super(random, 256); }
  get(_x: number, _y: number, _z: number): number {
    const x = wrap(_x) + this.ox, y = wrap(_y) + this.oy, z = wrap(_z) + this.oz;
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const rx = f(x - ix), ry = f(y - iy), rz = f(z - iz);
    const x0 = this.permute(ix), x1 = this.permute(ix + 1);
    const xy00 = this.permute(x0 + iy), xy01 = this.permute(x0 + iy + 1), xy10 = this.permute(x1 + iy), xy11 = this.permute(x1 + iy + 1);
    const d000 = gradDot(this.permute(xy00 + iz), rx, ry, rz);
    const d100 = gradDot(this.permute(xy10 + iz), f(rx - 1), ry, rz);
    const d010 = gradDot(this.permute(xy01 + iz), rx, f(ry - 1), rz);
    const d110 = gradDot(this.permute(xy11 + iz), f(rx - 1), f(ry - 1), rz);
    const d001 = gradDot(this.permute(xy00 + iz + 1), rx, ry, f(rz - 1));
    const d101 = gradDot(this.permute(xy10 + iz + 1), f(rx - 1), ry, f(rz - 1));
    const d011 = gradDot(this.permute(xy01 + iz + 1), rx, f(ry - 1), f(rz - 1));
    const d111 = gradDot(this.permute(xy11 + iz + 1), f(rx - 1), f(ry - 1), f(rz - 1));
    const ax = smooth(rx), ay = smooth(ry), az = smooth(rz);
    const l2a = lerpF(ay, lerpF(ax, d000, d100), lerpF(ax, d010, d110));
    const l2b = lerpF(ay, lerpF(ax, d001, d101), lerpF(ax, d011, d111));
    return lerpF(az, l2a, l2b);
  }
}

export interface NormalNoiseParams { base_octave: number; base_amplitude?: number; octave_count?: number; amplitude_modifiers?: number[]; }

/** NormalNoise.create(random): a NoiseStack.Perlin of two Perlin layers per octave. */
export class NormalNoise {
  private layers: Array<{ noise: PerlinNoise; frequency: number; amplitude: number }> = [];
  constructor(random: LegacyRandom, p: NormalNoiseParams) {
    const count = p.octave_count ?? 1, mods = p.amplitude_modifiers ?? [], base = p.base_amplitude ?? 1;
    let frequency = Math.pow(2, p.base_octave);
    let amplitude = base * (Math.pow(0.5, -(count - 1)) / (Math.pow(0.5, -count) - 1));
    const octaves: Array<{ index: number; frequency: number; amplitude: number }> = [];
    for (let i = 0; i < count; i++) {
      const m = mods.length ? mods[i] : 1;
      if (m !== 0) octaves.push({ index: p.base_octave + i, frequency, amplitude: amplitude * m });
      frequency *= 2;
      amplitude *= 0.5;
    }
    let target = 0, variance = 0;
    for (const o of octaves) { target += Math.abs(o.amplitude); variance += (0.2702247831245211 * Math.abs(o.amplitude)) ** 2; }
    const dev = Math.sqrt(variance);
    const norm = dev === 0 ? 0 : (target * 0.3333333333333333) / (dev * Math.sqrt(2));
    const first = random.forkPositional(), second = random.forkPositional();
    for (const o of octaves) {
      const name = 'octave_' + o.index, vf = f(norm * o.amplitude);
      this.layers.push({ noise: new PerlinNoise(first.fromHashOf(name)), frequency: o.frequency, amplitude: vf });
      this.layers.push({ noise: new PerlinNoise(second.fromHashOf(name)), frequency: o.frequency * 1.0181268882175227, amplitude: vf });
    }
  }
  get(x: number, y: number, z: number): number {
    let v = 0;
    for (const l of this.layers) v = f(v + f(l.amplitude * l.noise.get(x * l.frequency, y * l.frequency, z * l.frequency)));
    return v;
  }
}

/** SimplexNoise(random, discardNoiseOffset = true), 2D lookup. */
export class SimplexNoise extends Gradient {
  constructor(random: LegacyRandom) { super(random, 0); }
  private corner(gi: number, x: number, y: number): number {
    let t = 0.5 - x * x - y * y - 0 * 0;
    if (t < 0) return 0;
    t *= t;
    return t * t * (GX[gi & 15] * x + GY[gi & 15] * y + GZ[gi & 15] * 0);
  }
  get(xin: number, yin: number): number {
    const SQRT_3 = Math.sqrt(3), F2 = 0.5 * (SQRT_3 - 1), G2 = (3 - SQRT_3) / 6;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    const gi0 = this.permute(ii + this.permute(jj)) % 12;
    const gi1 = this.permute(ii + i1 + this.permute(jj + j1)) % 12;
    const gi2 = this.permute(ii + 1 + this.permute(jj + 1)) % 12;
    return f(70 * (this.corner(gi0, x0, y0) + this.corner(gi1, x1, y1) + this.corner(gi2, x2, y2)));
  }
}
