/**
 * Port of net.minecraft.world.level.biome.Climate (Parameter, ParameterPoint, TargetPoint, fitness).
 * Parameters are quantized to integers (x10000) exactly like vanilla. The vanilla R-tree is only a
 * search accelerator, so lookups here use a linear scan with the same distance metric.
 */
export const quantizeCoord = (f: number): number => Math.trunc(Math.fround(Math.fround(f) * 10000));
export const unquantizeCoord = (l: number): number => Math.fround(l / 10000);

export class Param {
  constructor(readonly min: number, readonly max: number) {}
  distance(target: number): number {
    const above = target - this.max, below = this.min - target;
    return above > 0 ? above : Math.max(below, 0);
  }
}
/** Climate.Parameter.span(float,float) and span(Parameter,Parameter). */
export function span(a: number | Param, b: number | Param): Param {
  if (typeof a === 'number' && typeof b === 'number') {
    if (a > b) throw new Error(`min > max: ${a} ${b}`);
    return new Param(quantizeCoord(a), quantizeCoord(b));
  }
  const pa = a as Param, pb = b as Param;
  if (pa.min > pb.max) throw new Error('min > max');
  return new Param(pa.min, pb.max);
}
export const point = (v: number): Param => span(v, v);

export interface ParameterPoint { t: Param; h: Param; c: Param; e: Param; d: Param; w: Param; offset: number; }
export function parameters(t: Param, h: Param, c: Param, e: Param, d: Param, w: Param, offset: number): ParameterPoint {
  return { t, h, c, e, d, w, offset: quantizeCoord(offset) };
}
export interface TargetPoint { t: number; h: number; c: number; e: number; d: number; w: number; }
export const target = (t: number, h: number, c: number, e: number, d: number, w: number): TargetPoint =>
  ({ t: quantizeCoord(t), h: quantizeCoord(h), c: quantizeCoord(c), e: quantizeCoord(e), d: quantizeCoord(d), w: quantizeCoord(w) });

const sq = (x: number) => x * x;
export const fitness = (p: ParameterPoint, q: TargetPoint): number =>
  sq(p.t.distance(q.t)) + sq(p.h.distance(q.h)) + sq(p.c.distance(q.c)) + sq(p.e.distance(q.e)) + sq(p.d.distance(q.d)) + sq(p.w.distance(q.w)) + sq(p.offset);

const axisDist = (lo: number, hi: number, t: number): number => { const a = t - hi; if (a > 0) return a; const b = lo - t; return b > 0 ? b : 0; };

/**
 * Climate.ParameterList.findValue: smallest fitness wins, lowest index on ties.
 * Parameter boxes (7 axes incl. offset, whose target is 0) are stored in a bounding-box tree like vanilla's RTree.
 * A subtree is skipped when its box is farther than the best match so far (a parent box is never farther than any
 * child box), so the answer is identical to a plain linear scan but visits only a few dozen nodes.
 */
const D = 7, LEAF = 8;
export class ParameterList<T> {
  private readonly lo: Int32Array; private readonly hi: Int32Array;   // per point, axes: c,e,w,d,t,h,offset
  private nLo!: Int32Array; private nHi!: Int32Array;                  // per node
  private nLeft!: Int32Array; private nRight!: Int32Array; private nStart!: Int32Array; private nEnd!: Int32Array; private nMinIdx!: Int32Array;
  private order: Int32Array;
  private nodeCount = 0;
  private hint = 0;
  private readonly q = new Float64Array(D);
  private bestIdx = 0; private bestFit = 0;

  constructor(readonly values: Array<[ParameterPoint, T]>) {
    const n = values.length;
    this.lo = new Int32Array(n * D); this.hi = new Int32Array(n * D);
    for (let i = 0; i < n; i++) {
      const p = values[i][0], o = i * D;
      this.lo[o] = p.c.min; this.hi[o] = p.c.max; this.lo[o + 1] = p.e.min; this.hi[o + 1] = p.e.max; this.lo[o + 2] = p.w.min; this.hi[o + 2] = p.w.max;
      this.lo[o + 3] = p.d.min; this.hi[o + 3] = p.d.max; this.lo[o + 4] = p.t.min; this.hi[o + 4] = p.t.max; this.lo[o + 5] = p.h.min; this.hi[o + 5] = p.h.max;
      this.lo[o + 6] = p.offset; this.hi[o + 6] = p.offset;
    }
    const cap = Math.max(1, Math.ceil(n / (LEAF / 2)) * 2);
    this.nLo = new Int32Array(cap * D); this.nHi = new Int32Array(cap * D);
    this.nLeft = new Int32Array(cap).fill(-1); this.nRight = new Int32Array(cap).fill(-1);
    this.nStart = new Int32Array(cap); this.nEnd = new Int32Array(cap); this.nMinIdx = new Int32Array(cap);
    const idxs: number[] = []; for (let i = 0; i < n; i++) idxs.push(i);
    this.order = new Int32Array(n);
    this.build(idxs, 0);
  }

  private build(idxs: number[], base: number): number {
    const node = this.nodeCount++, D_ = D, lo = this.lo, hi = this.hi;
    const nlo = node * D_;
    for (let d = 0; d < D_; d++) { this.nLo[nlo + d] = 2147483647; this.nHi[nlo + d] = -2147483648; }
    let minIdx = 2147483647;
    for (const i of idxs) {
      const o = i * D_;
      for (let d = 0; d < D_; d++) { if (lo[o + d] < this.nLo[nlo + d]) this.nLo[nlo + d] = lo[o + d]; if (hi[o + d] > this.nHi[nlo + d]) this.nHi[nlo + d] = hi[o + d]; }
      if (i < minIdx) minIdx = i;
    }
    this.nMinIdx[node] = minIdx;
    if (idxs.length <= LEAF) {
      for (let k = 0; k < idxs.length; k++) this.order[base + k] = idxs[k];
      this.nStart[node] = base; this.nEnd[node] = base + idxs.length;
      return node;
    }
    // Split on the axis where the box centres are most spread out, at the median.
    let axis = 0, best = -1;
    for (let d = 0; d < D_; d++) {
      let mn = 2147483647, mx = -2147483648;
      for (const i of idxs) { const c = lo[i * D_ + d] + hi[i * D_ + d]; if (c < mn) mn = c; if (c > mx) mx = c; }
      if (mx - mn > best) { best = mx - mn; axis = d; }
    }
    idxs.sort((a, b) => (lo[a * D_ + axis] + hi[a * D_ + axis]) - (lo[b * D_ + axis] + hi[b * D_ + axis]) || a - b);
    const mid = idxs.length >> 1;
    const left = this.build(idxs.slice(0, mid), base), right = this.build(idxs.slice(mid), base + mid);
    this.nLeft[node] = left; this.nRight[node] = right;
    return node;
  }

  private nodeDist(node: number): number {
    const o = node * D, lo = this.nLo, hi = this.nHi, q = this.q;
    let s = 0;
    for (let d = 0; d < D; d++) { const x = axisDist(lo[o + d], hi[o + d], q[d]); s += x * x; }
    return s;
  }

  private visit(node: number, dist: number) {
    if (dist > this.bestFit || (dist === this.bestFit && this.nMinIdx[node] > this.bestIdx)) return;
    const l = this.nLeft[node];
    if (l < 0) {
      const lo = this.lo, hi = this.hi, q = this.q, order = this.order;
      for (let k = this.nStart[node], e = this.nEnd[node]; k < e; k++) {
        const i = order[k], o = i * D;
        let s = 0;
        for (let d = 0; d < D; d++) { const x = axisDist(lo[o + d], hi[o + d], q[d]); s += x * x; }
        if (s < this.bestFit || (s === this.bestFit && i < this.bestIdx)) { this.bestFit = s; this.bestIdx = i; }
      }
      return;
    }
    const r = this.nRight[node], dl = this.nodeDist(l), dr = this.nodeDist(r);
    if (dl <= dr) { this.visit(l, dl); this.visit(r, dr); } else { this.visit(r, dr); this.visit(l, dl); }
  }

  findValue(t: TargetPoint): T {
    const q = this.q;
    q[0] = t.c; q[1] = t.e; q[2] = t.w; q[3] = t.d; q[4] = t.t; q[5] = t.h; q[6] = 0;
    const h = this.hint < this.values.length ? this.hint : 0;
    this.bestIdx = h; this.bestFit = fitness(this.values[h][0], t);
    this.visit(0, this.nodeDist(0));
    this.hint = this.bestIdx;
    return this.values[this.bestIdx][1];
  }
}
