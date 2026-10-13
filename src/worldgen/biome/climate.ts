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

/** Climate.ParameterList.findValue: first entry with the smallest fitness wins. */
export class ParameterList<T> {
  constructor(readonly values: Array<[ParameterPoint, T]>) {}
  findValue(q: TargetPoint): T {
    let best = this.values[0][1], bestFit = fitness(this.values[0][0], q);
    for (let i = 1; i < this.values.length; i++) {
      const f = fitness(this.values[i][0], q);
      if (f < bestFit) { bestFit = f; best = this.values[i][1]; }
    }
    return best;
  }
}
