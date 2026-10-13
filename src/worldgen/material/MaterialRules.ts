/**
 * Data-driven material (surface) rules: a port of net.minecraft.world.level.levelgen.material.
 * Rules and conditions are the vanilla JSON from data/minecraft/worldgen/material_{rule,condition}.
 * Rules evaluate to a vanilla block name (without namespace) or null.
 */
import { MATERIAL_CONDITIONS, MATERIAL_RULES } from '../data.generated';
import type { PositionalRandomFactory } from '../random';

export const NO_WATER = -2147483648; // Integer.MIN_VALUE: "no water above this block"

/** Per-column / per-block state the rules read (MaterialRuleContext). */
export interface RuleContext {
  blockX: number; blockY: number; blockZ: number;
  surfaceGradientX: number; surfaceGradientZ: number; surfaceDepth: number;
  stoneDepthAbove: number; stoneDepthBelow: number; waterHeight: number;
  minY: number; height: number;
  /** Bumped by updateXZ / updateY; used to cache lazily computed conditions like vanilla's LazyXZ/LazyYCondition. */
  xzVersion: number; yVersion: number;
  biome(): string;
  surfaceSecondary(): number;
  minSurfaceLevel(): number;
  noise(name: string, is3d: boolean): number;
  randomFactory(name: string): PositionalRandomFactory;
  band(x: number, y: number, z: number): string;
}
export type Rule = (x: number, y: number, z: number) => string | null;
export type Condition = () => boolean;

const strip = (s: string) => s.replace(/^minecraft:/, '');
const map = (v: number, a: number, b: number, c: number, d: number) => c + ((v - a) / (b - a)) * (d - c);

/** VerticalAnchor: {absolute}, {above_bottom}, {below_top}. */
export function resolveAnchor(a: any, ctx: RuleContext): number {
  if (a.absolute !== undefined) return a.absolute;
  if (a.above_bottom !== undefined) return ctx.minY + a.above_bottom;
  if (a.below_top !== undefined) return ctx.minY + ctx.height - 1 - a.below_top;
  throw new Error('Unknown vertical anchor ' + JSON.stringify(a));
}

export class MaterialRuleCompiler {
  private readonly namedRules = new Map<string, Rule>();
  private readonly namedConditions = new Map<string, Condition>();
  constructor(private readonly ctx: RuleContext) {}

  private lazyXZ(fn: Condition): Condition { let last = -1, res = false; return () => { if (this.ctx.xzVersion !== last) { last = this.ctx.xzVersion; res = fn(); } return res; }; }
  private lazyY(fn: Condition): Condition { let last = -1, res = false; return () => { if (this.ctx.yVersion !== last) { last = this.ctx.yVersion; res = fn(); } return res; }; }

  compileRule(json: any): Rule {
    if (typeof json === 'string') {
      const name = strip(json), hit = this.namedRules.get(name);
      if (hit) return hit;
      const src = MATERIAL_RULES[name];
      if (!src) throw new Error('Unknown material rule ' + json);
      // Register a forwarding stub first so (theoretically) recursive references terminate.
      let compiled: Rule | undefined;
      const stub: Rule = (x, y, z) => compiled!(x, y, z);
      this.namedRules.set(name, stub);
      compiled = this.compileRule(src);
      this.namedRules.set(name, compiled);
      return compiled;
    }
    const ctx = this.ctx;
    switch (strip(json.type)) {
      case 'sequence': {
        const rules = (json.sequence as any[]).map((r) => this.compileRule(r));
        if (rules.length === 1) return rules[0];
        return (x, y, z) => { for (const r of rules) { const s = r(x, y, z); if (s !== null) return s; } return null; };
      }
      case 'condition': {
        const cond = this.compileCondition(json.if_true), then = this.compileRule(json.then_run);
        return (x, y, z) => (cond() ? then(x, y, z) : null);
      }
      case 'block': { const name = strip(typeof json.result_state === 'string' ? json.result_state : json.result_state.Name); return () => name; }
      case 'bandlands': return (x, y, z) => ctx.band(x, y, z);
      // Ore veins need the vein density functions + ore palettes; not ported yet, so they never place anything.
      case 'ore_vein': return () => null;
      default: throw new Error('Unsupported material rule type ' + json.type);
    }
  }

  compileCondition(json: any): Condition {
    if (typeof json === 'string') {
      const name = strip(json), hit = this.namedConditions.get(name);
      if (hit) return hit;
      const src = MATERIAL_CONDITIONS[name];
      if (!src) throw new Error('Unknown material condition ' + json);
      const c = this.compileCondition(src);
      this.namedConditions.set(name, c);
      return c;
    }
    const ctx = this.ctx;
    switch (strip(json.type)) {
      case 'not': { const inner = this.compileCondition(json.invert); return () => !inner(); }
      case 'biome': {
        const set = new Set<string>((Array.isArray(json.biome_is) ? json.biome_is : [json.biome_is]).map((b: string) => strip(b)));
        return this.lazyY(() => set.has(ctx.biome()));
      }
      case 'above_preliminary_surface': return () => ctx.blockY >= ctx.minSurfaceLevel();
      case 'hole': return this.lazyXZ(() => ctx.surfaceDepth <= 0);
      case 'steep': return this.lazyXZ(() => ctx.surfaceGradientX <= -4 || ctx.surfaceGradientZ >= 4);
      case 'noise_threshold': {
        const name = strip(json.noise), is3d = !!json.is_3d, lo = Number(json.min_threshold), hi = Number(json.max_threshold);
        return () => { const v = ctx.noise(name, is3d); return v >= lo && v <= hi; };
      }
      case 'stone_depth': {
        const ceiling = json.surface_type === 'ceiling', offset = Number(json.offset ?? 0), addSurface = !!json.add_surface_depth, range = Number(json.secondary_depth_range ?? 0);
        return this.lazyY(() => {
          const stoneDepth = ceiling ? ctx.stoneDepthBelow : ctx.stoneDepthAbove;
          const surfaceDepth = addSurface ? ctx.surfaceDepth : 0;
          const secondary = range === 0 ? 0 : Math.trunc(map(ctx.surfaceSecondary(), -1, 1, 0, range));
          return stoneDepth <= 1 + offset + surfaceDepth + secondary;
        });
      }
      case 'vertical_gradient': {
        const trueAt = resolveAnchor(json.true_at_and_below, ctx), falseAt = resolveAnchor(json.false_at_and_above, ctx);
        const factory = ctx.randomFactory(json.random_name);
        return this.lazyY(() => {
          const y = ctx.blockY;
          if (y <= trueAt) return true;
          if (y >= falseAt) return false;
          const probability = map(y, trueAt, falseAt, 1, 0);
          return factory.at(ctx.blockX, y, ctx.blockZ).nextFloat() < probability;
        });
      }
      case 'water': {
        const offset = Number(json.offset ?? 0), mult = Number(json.surface_depth_multiplier ?? 0), addStone = !!json.add_stone_depth;
        return this.lazyY(() => ctx.waterHeight === NO_WATER || ctx.blockY + (addStone ? ctx.stoneDepthAbove : 0) >= ctx.waterHeight + offset + ctx.surfaceDepth * mult);
      }
      case 'y_above': {
        const mult = Number(json.surface_depth_multiplier ?? 0), addStone = !!json.add_stone_depth, anchor = json.anchor;
        return this.lazyY(() => ctx.blockY + (addStone ? ctx.stoneDepthAbove : 0) >= resolveAnchor(anchor, ctx) + ctx.surfaceDepth * mult);
      }
      default: throw new Error('Unsupported material condition type ' + json.type);
    }
  }
}
