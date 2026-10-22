/**
 * Port of Minecraft's TreeFeature: trunk placers, foliage placers and feature sizes, consuming random numbers in the
 * same order as vanilla so shapes (and the stream seen by later features) match.
 *
 * Differences from the game, all cosmetic: log axis, leaf distance/persistence, vines, cocoa, bee nests and leaf litter
 * are not modelled (this engine has no such blocks); only their random draws that precede other placements are kept.
 */
import { VoxelType } from '../types/physics';
import type { Xoroshiro128PlusPlus } from './random';

type Rng = Xoroshiro128PlusPlus;
export type SampleInt = (spec: any, r: Rng) => number;

export interface TreeWorld {
  block(x: number, y: number, z: number): number;
  /** Raw write (the tree code has already checked the cell may be replaced). */
  set(x: number, y: number, z: number, type: VoxelType): void;
  readonly minY: number;
  /** Exclusive build limit. */
  readonly maxY: number;
}

const fr = Math.fround;

// ---------------------------------------------------------------------------------------------------------------------
// Block classes
// ---------------------------------------------------------------------------------------------------------------------
const LOG_TYPES: Record<string, VoxelType> = {
  oak_log: VoxelType.OAK_LOG, spruce_log: VoxelType.SPRUCE_LOG, birch_log: VoxelType.BIRCH_LOG, jungle_log: VoxelType.JUNGLE_LOG,
  acacia_log: VoxelType.ACACIA_LOG, dark_oak_log: VoxelType.DARK_OAK_LOG, cherry_log: VoxelType.CHERRY_LOG, pale_oak_log: VoxelType.PALE_OAK_LOG,
  poplar_log: VoxelType.BIRCH_LOG, // no poplar blocks in this engine yet: closest look
};
const LEAF_TYPES: Record<string, VoxelType> = {
  oak_leaves: VoxelType.OAK_LEAVES, spruce_leaves: VoxelType.SPRUCE_LEAVES, birch_leaves: VoxelType.BIRCH_LEAVES, jungle_leaves: VoxelType.JUNGLE_LEAVES,
  acacia_leaves: VoxelType.ACACIA_LEAVES, dark_oak_leaves: VoxelType.DARK_OAK_LEAVES, cherry_leaves: VoxelType.CHERRY_LEAVES, pale_oak_leaves: VoxelType.PALE_OAK_LEAVES,
  red_poplar_leaves: VoxelType.BIRCH_LEAVES, orange_poplar_leaves: VoxelType.BIRCH_LEAVES, yellow_poplar_leaves: VoxelType.BIRCH_LEAVES,
};
/** minecraft:replaceable_by_trees (the plant half; leaves are tested separately). */
const REPLACEABLE_PLANTS = new Set<number>([
  VoxelType.SHORT_GRASS, VoxelType.TALL_GRASS, VoxelType.FERN, VoxelType.LARGE_FERN, VoxelType.DEAD_BUSH, VoxelType.BUSH,
  VoxelType.DANDELION, VoxelType.POPPY, VoxelType.BLUE_ORCHID, VoxelType.ALLIUM, VoxelType.AZURE_BLUET, VoxelType.RED_TULIP,
  VoxelType.ORANGE_TULIP, VoxelType.WHITE_TULIP, VoxelType.PINK_TULIP, VoxelType.OXEYE_DAISY, VoxelType.CORNFLOWER,
  VoxelType.LILY_OF_THE_VALLEY, VoxelType.SUNFLOWER, VoxelType.LILAC, VoxelType.ROSE_BUSH, VoxelType.PEONY, VoxelType.VINE,
]);

export const isLogBlock = (t: number) => t === VoxelType.WOOD || (t >= VoxelType.OAK_LOG && t <= VoxelType.PALE_OAK_LOG);
export const isLeafBlock = (t: number) => t === VoxelType.LEAVES || (t >= VoxelType.OAK_LEAVES && t <= VoxelType.PALE_OAK_LEAVES);

/** Blocks a tree may overwrite: air, leaves and replaceable plants. */
const validTreePos = (t: number) => t === VoxelType.AIR || isLeafBlock(t) || REPLACEABLE_PLANTS.has(t);
const isFree = (t: number) => validTreePos(t) || isLogBlock(t);

// ---------------------------------------------------------------------------------------------------------------------
// Directions (Direction.Plane.HORIZONTAL order: NORTH, EAST, SOUTH, WEST)
// ---------------------------------------------------------------------------------------------------------------------
const DX = [0, 1, 0, -1];
const DZ = [-1, 0, 1, 0];
const randomDirection = (r: Rng) => r.nextIntBounded(4);
const clockWise = (d: number) => (d + 1) & 3;
const opposite = (d: number) => (d + 2) & 3;

// Mth.sin / Mth.cos use a 65536-entry float table
const SIN_TABLE = new Float32Array(65536);
for (let i = 0; i < 65536; i++) SIN_TABLE[i] = Math.sin(i / 10430.378350470453);
const mthSin = (a: number) => SIN_TABLE[Math.trunc(a * 10430.378350470453) & 65535];
const mthCos = (a: number) => SIN_TABLE[Math.trunc(a * 10430.378350470453 + 16384) & 65535];

interface Pos { x: number; y: number; z: number }
interface Attachment { x: number; y: number; z: number; radiusOffset: number; double: boolean }

// ---------------------------------------------------------------------------------------------------------------------
// Placement context
// ---------------------------------------------------------------------------------------------------------------------
class Ctx {
  readonly trunks: Pos[] = [];
  readonly foliage = new Set<string>();
  readonly trunkType: VoxelType;
  readonly leafType: VoxelType;
  constructor(readonly w: TreeWorld, readonly r: Rng, readonly cfg: any, readonly sample: SampleInt) {
    this.trunkType = LOG_TYPES[cfg.trunk];
    this.leafType = LEAF_TYPES[cfg.foliage];
  }
  s(spec: any): number { return this.sample(spec, this.r); }

  placeBelowTrunk(x: number, y: number, z: number) {
    const t = this.w.block(x, y, z);
    if (t === VoxelType.GRASS || t === VoxelType.DIRT || t === VoxelType.COARSE_DIRT || t === VoxelType.PODZOL || t === VoxelType.MYCELIUM) {
      this.w.set(x, y, z, VoxelType.DIRT);
      this.trunks.push({ x, y, z });
    }
  }
  placeLog(x: number, y: number, z: number): boolean {
    if (y < this.w.minY || y >= this.w.maxY || !validTreePos(this.w.block(x, y, z))) return false;
    this.w.set(x, y, z, this.trunkType);
    this.trunks.push({ x, y, z });
    return true;
  }
  placeLogIfFree(x: number, y: number, z: number) {
    if (y >= this.w.minY && y < this.w.maxY && isFree(this.w.block(x, y, z))) this.placeLog(x, y, z);
  }
  tryPlaceLeaf(x: number, y: number, z: number): boolean {
    if (y < this.w.minY || y >= this.w.maxY || !validTreePos(this.w.block(x, y, z))) return false;
    this.w.set(x, y, z, this.leafType);
    this.foliage.add(`${x},${y},${z}`);
    return true;
  }
  isSet(x: number, y: number, z: number) { return this.foliage.has(`${x},${y},${z}`); }
}

// ---------------------------------------------------------------------------------------------------------------------
// Feature size
// ---------------------------------------------------------------------------------------------------------------------
function sizeAtHeight(size: any, treeHeight: number, yo: number): number {
  if (size.type === 'three_layers_feature_size') {
    const limit = size.limit ?? 1, upperLimit = size.upper_limit ?? 1;
    if (yo < limit) return size.lower_size ?? 0;
    return yo >= treeHeight - upperLimit ? (size.upper_size ?? 1) : (size.middle_size ?? 1);
  }
  return yo < (size.limit ?? 1) ? (size.lower_size ?? 0) : (size.upper_size ?? 1);
}

// ---------------------------------------------------------------------------------------------------------------------
// Trunk placers
// ---------------------------------------------------------------------------------------------------------------------
function treeHeight(tp: any, r: Rng): number {
  return tp.base_height + r.nextIntBounded(tp.height_rand_a + 1) + r.nextIntBounded(tp.height_rand_b + 1);
}

function placeTrunk(c: Ctx, tp: any, height: number, ox: number, oy: number, oz: number): Attachment[] {
  const r = c.r;
  switch (tp.type) {
    case 'straight_trunk_placer': {
      c.placeBelowTrunk(ox, oy - 1, oz);
      for (let y = 0; y < height; y++) c.placeLog(ox, oy + y, oz);
      return [{ x: ox, y: oy + height, z: oz, radiusOffset: 0, double: false }];
    }
    case 'giant_trunk_placer':
    case 'mega_jungle_trunk_placer': return giantTrunk(c, tp, height, ox, oy, oz);
    case 'bending_trunk_placer': {
      const dir = randomDirection(r);
      const logHeight = height - 1;
      let x = ox, y = oy, z = oz;
      c.placeBelowTrunk(x, y - 1, z);
      const out: Attachment[] = [];
      for (let i = 0; i <= logHeight; i++) {
        if (i + 1 >= logHeight + r.nextIntBounded(2)) { x += DX[dir]; z += DZ[dir]; }
        if (validTreePos(c.w.block(x, y, z))) c.placeLog(x, y, z);
        if (i >= tp.min_height_for_leaves) out.push({ x, y, z, radiusOffset: 0, double: false });
        y++;
      }
      const len = c.s(tp.bend_length);
      for (let i = 0; i <= len; i++) {
        if (validTreePos(c.w.block(x, y, z))) c.placeLog(x, y, z);
        out.push({ x, y, z, radiusOffset: 0, double: false });
        x += DX[dir]; z += DZ[dir];
      }
      return out;
    }
    case 'forking_trunk_placer': {
      c.placeBelowTrunk(ox, oy - 1, oz);
      const out: Attachment[] = [];
      const lean = randomDirection(r);
      const leanHeight = height - r.nextIntBounded(4) - 1;
      let leanSteps = 3 - r.nextIntBounded(3);
      let tx = ox, tz = oz, ey: number | null = null;
      for (let yo = 0; yo < height; yo++) {
        const yy = oy + yo;
        if (yo >= leanHeight && leanSteps > 0) { tx += DX[lean]; tz += DZ[lean]; leanSteps--; }
        if (c.placeLog(tx, yy, tz)) ey = yy + 1;
      }
      if (ey !== null) out.push({ x: tx, y: ey, z: tz, radiusOffset: 1, double: false });
      tx = ox; tz = oz;
      const branch = randomDirection(r);
      if (branch !== lean) {
        const branchPos = leanHeight - r.nextIntBounded(2) - 1;
        let steps = 1 + r.nextIntBounded(3);
        ey = null;
        for (let yo = branchPos; yo < height && steps > 0; steps--) {
          if (yo >= 1) {
            const yy = oy + yo;
            tx += DX[branch]; tz += DZ[branch];
            if (c.placeLog(tx, yy, tz)) ey = yy + 1;
          }
          yo++;
        }
        if (ey !== null) out.push({ x: tx, y: ey, z: tz, radiusOffset: 0, double: false });
      }
      return out;
    }
    case 'dark_oak_trunk_placer': {
      const out: Attachment[] = [];
      c.placeBelowTrunk(ox, oy - 1, oz);
      c.placeBelowTrunk(ox + 1, oy - 1, oz);
      c.placeBelowTrunk(ox, oy - 1, oz + 1);
      c.placeBelowTrunk(ox + 1, oy - 1, oz + 1);
      const lean = randomDirection(r);
      const leanHeight = height - r.nextIntBounded(4);
      let leanSteps = 2 - r.nextIntBounded(3);
      let tx = ox, tz = oz;
      const ey = oy + height - 1;
      for (let dy = 0; dy < height; dy++) {
        if (dy >= leanHeight && leanSteps > 0) { tx += DX[lean]; tz += DZ[lean]; leanSteps--; }
        const yy = oy + dy;
        const t = c.w.block(tx, yy, tz);
        if (t === VoxelType.AIR || isLeafBlock(t)) {
          c.placeLog(tx, yy, tz);
          c.placeLog(tx + 1, yy, tz);
          c.placeLog(tx, yy, tz + 1);
          c.placeLog(tx + 1, yy, tz + 1);
        }
      }
      out.push({ x: tx, y: ey, z: tz, radiusOffset: 0, double: true });
      for (let dx = -1; dx <= 2; dx++) {
        for (let dz = -1; dz <= 2; dz++) {
          if ((dx < 0 || dx > 1 || dz < 0 || dz > 1) && r.nextIntBounded(3) <= 0) {
            const length = r.nextIntBounded(3) + 2;
            for (let by = 0; by < length; by++) c.placeLog(ox + dx, ey - by - 1, oz + dz);
            out.push({ x: ox + dx, y: ey, z: oz + dz, radiusOffset: 0, double: false });
          }
        }
      }
      return out;
    }
    case 'fancy_trunk_placer': return fancyTrunk(c, height, ox, oy, oz);
    case 'cherry_trunk_placer': return cherryTrunk(c, tp, height, ox, oy, oz);
    case 'poplar_trunk_placer': {
      c.placeBelowTrunk(ox, oy - 1, oz);
      const upTo = height - c.s(tp.trunk_height_above_branches);
      for (let y = 0; y < height; y++) {
        c.placeLog(ox, oy + y, oz);
        // Direction.allShuffled(random) filtered to the horizontal ones: shuffle [DOWN, UP, NORTH, SOUTH, WEST, EAST]
        const dirs = [-1, -1, 0, 2, 3, 1]; // horizontal ids (N=0, E=1, S=2, W=3); -1 = vertical
        for (let i = dirs.length; i > 1; i--) {
          const j = r.nextIntBounded(i);
          const tmp = dirs[i - 1]; dirs[i - 1] = dirs[j]; dirs[j] = tmp;
        }
        const horizontal = dirs.filter((d) => d >= 0);
        if (upTo - 1 === y) {
          const branches = c.s(tp.branch_amount);
          for (let k = 0; k < branches; k++) c.placeLog(ox + DX[horizontal[k]], oy + y, oz + DZ[horizontal[k]]);
        }
      }
      return [{ x: ox, y: oy + upTo, z: oz, radiusOffset: 0, double: false }];
    }
    default: throw new Error('unsupported trunk placer ' + tp.type);
  }
}

function giantTrunk(c: Ctx, tp: any, height: number, ox: number, oy: number, oz: number): Attachment[] {
  const r = c.r;
  c.placeBelowTrunk(ox, oy - 1, oz);
  c.placeBelowTrunk(ox + 1, oy - 1, oz);
  c.placeBelowTrunk(ox, oy - 1, oz + 1);
  c.placeBelowTrunk(ox + 1, oy - 1, oz + 1);
  for (let hh = 0; hh < height; hh++) {
    c.placeLogIfFree(ox, oy + hh, oz);
    if (hh < height - 1) {
      c.placeLogIfFree(ox + 1, oy + hh, oz);
      c.placeLogIfFree(ox + 1, oy + hh, oz + 1);
      c.placeLogIfFree(ox, oy + hh, oz + 1);
    }
  }
  const out: Attachment[] = [{ x: ox, y: oy + height, z: oz, radiusOffset: 0, double: true }];
  if (tp.type !== 'mega_jungle_trunk_placer') return out;
  for (let branchHeight = height - 2 - r.nextIntBounded(4); branchHeight > (height >> 1); branchHeight -= 2 + r.nextIntBounded(4)) {
    const angle = fr(fr(r.nextFloat()) * fr(Math.PI * 2));
    let bx = 0, bz = 0;
    for (let b = 0; b < 5; b++) {
      bx = Math.trunc(fr(1.5 + fr(mthCos(angle) * b)));
      bz = Math.trunc(fr(1.5 + fr(mthSin(angle) * b)));
      c.placeLog(ox + bx, oy + branchHeight - 3 + (b >> 1), oz + bz);
    }
    out.push({ x: ox + bx, y: oy + branchHeight, z: oz + bz, radiusOffset: -2, double: false });
  }
  return out;
}

function fancyTrunk(c: Ctx, treeH: number, ox: number, oy: number, oz: number): Attachment[] {
  const r = c.r;
  const height = treeH + 2;
  const trunkHeight = Math.floor(height * 0.618);
  c.placeBelowTrunk(ox, oy - 1, oz);
  const clustersPerY = Math.min(1, Math.floor(1.382 + Math.pow(height / 13, 2)));
  const trunkTop = oy + trunkHeight;
  let relativeY = height - 5;
  const coords: Array<{ x: number; y: number; z: number; base: number }> = [{ x: ox, y: oy + relativeY, z: oz, base: trunkTop }];

  const getSteps = (dx: number, dy: number, dz: number) => Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
  /** Walks a straight limb; with `place` it writes logs, otherwise it only checks the path is free. */
  const makeLimb = (sx: number, sy: number, sz: number, ex: number, ey: number, ez: number, place: boolean): boolean => {
    if (!place && sx === ex && sy === ey && sz === ez) return true;
    const dx = ex - sx, dy = ey - sy, dz = ez - sz;
    const steps = getSteps(dx, dy, dz);
    const fx = fr(dx / steps), fy = fr(dy / steps), fz = fr(dz / steps);
    for (let i = 0; i <= steps; i++) {
      const x = sx + Math.floor(fr(0.5 + fr(i * fx))), y = sy + Math.floor(fr(0.5 + fr(i * fy))), z = sz + Math.floor(fr(0.5 + fr(i * fz)));
      if (place) c.placeLog(x, y, z);
      else if (y < c.w.minY || y >= c.w.maxY || !isFree(c.w.block(x, y, z))) return false;
    }
    return true;
  };
  const treeShape = (h: number, y: number): number => {
    if (y < fr(fr(h) * fr(0.3))) return -1;
    const radius = fr(h / 2);
    const adjacent = fr(radius - y);
    let distance = fr(Math.sqrt(fr(fr(radius * radius) - fr(adjacent * adjacent))));
    if (adjacent === 0) distance = radius;
    else if (Math.abs(adjacent) >= radius) return 0;
    return fr(distance * 0.5);
  };

  for (; relativeY >= 0; relativeY--) {
    const shape = treeShape(height, relativeY);
    if (shape < 0) continue;
    for (let i = 0; i < clustersPerY; i++) {
      const radius = shape * (r.nextFloat() + 0.328);
      const angle = fr(r.nextFloat() * 2) * Math.PI;
      const x = radius * Math.sin(angle) + 0.5;
      const z = radius * Math.cos(angle) + 0.5;
      const sx = ox + Math.floor(x), sy = oy + relativeY - 1, sz = oz + Math.floor(z);
      if (makeLimb(sx, sy, sz, sx, sy + 5, sz, false)) {
        const ddx = ox - sx, ddz = oz - sz;
        const branchHeight = sy - Math.sqrt(ddx * ddx + ddz * ddz) * 0.381;
        const branchTop = branchHeight > trunkTop ? trunkTop : Math.trunc(branchHeight);
        if (makeLimb(ox, branchTop, oz, sx, sy, sz, false)) coords.push({ x: sx, y: sy, z: sz, base: branchTop });
      }
    }
  }
  makeLimb(ox, oy, oz, ox, oy + trunkHeight, oz, true);
  const trim = (localY: number) => localY >= height * 0.2;
  for (const e of coords) {
    if (!(e.x === ox && e.base === e.y && e.z === oz) && trim(e.base - oy)) makeLimb(ox, e.base, oz, e.x, e.y, e.z, true);
  }
  const out: Attachment[] = [];
  for (const e of coords) if (trim(e.base - oy)) out.push({ x: e.x, y: e.y, z: e.z, radiusOffset: 0, double: false });
  return out;
}

function cherryTrunk(c: Ctx, tp: any, height: number, ox: number, oy: number, oz: number): Attachment[] {
  const r = c.r;
  c.placeBelowTrunk(ox, oy - 1, oz);
  const start = tp.branch_start_offset_from_top;
  const first0 = Math.max(0, height - 1 + c.s(start));
  let second0 = Math.max(0, height - 1 + c.s({ type: 'uniform', min_inclusive: start.min_inclusive, max_inclusive: start.max_inclusive - 1 }));
  if (second0 >= first0) second0++;
  const branchCount = c.s(tp.branch_count);
  const hasMiddle = branchCount === 3, hasBoth = branchCount >= 2;
  const trunkHeight = hasMiddle ? height : hasBoth ? Math.max(first0, second0) + 1 : first0 + 1;
  for (let y = 0; y < trunkHeight; y++) c.placeLog(ox, oy + y, oz);
  const out: Attachment[] = [];
  if (hasMiddle) out.push({ x: ox, y: oy + trunkHeight, z: oz, radiusOffset: 0, double: false });
  const dir = randomDirection(r);
  const branch = (d: number, offset: number, middleContinues: boolean): Attachment => {
    let lx = ox, ly = oy + offset, lz = oz;
    const endOff = height - 1 + c.s(tp.branch_end_offset_from_top);
    const extend = middleContinues || endOff < offset;
    const dist = c.s(tp.branch_horizontal_length) + (extend ? 1 : 0);
    const ex = ox + DX[d] * dist, ey = oy + endOff, ez = oz + DZ[d] * dist;
    for (let i = 0, n = extend ? 2 : 1; i < n; i++) { lx += DX[d]; lz += DZ[d]; c.placeLog(lx, ly, lz); }
    const vertical = ey > ly ? 1 : -1;
    for (;;) {
      const distance = Math.abs(lx - ex) + Math.abs(ly - ey) + Math.abs(lz - ez);
      if (distance === 0) return { x: ex, y: ey + 1, z: ez, radiusOffset: 0, double: false };
      const chance = fr(Math.abs(ey - ly) / distance);
      const growV = r.nextFloat() < chance;
      if (growV) ly += vertical; else { lx += DX[d]; lz += DZ[d]; }
      c.placeLog(lx, ly, lz);
    }
  };
  out.push(branch(dir, first0, first0 < trunkHeight - 1));
  if (hasBoth) out.push(branch(opposite(dir), second0, second0 < trunkHeight - 1));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Foliage placers
// ---------------------------------------------------------------------------------------------------------------------
function foliageHeight(c: Ctx, fp: any, height: number): number {
  switch (fp.type) {
    case 'blob_foliage_placer': case 'fancy_foliage_placer': case 'bush_foliage_placer': case 'jungle_foliage_placer': return fp.height;
    case 'acacia_foliage_placer': return 0;
    case 'pine_foliage_placer': return c.s(fp.height);
    case 'spruce_foliage_placer': return Math.max(4, height - c.s(fp.trunk_height));
    case 'dark_oak_foliage_placer': return 4;
    case 'mega_pine_foliage_placer': return c.s(fp.crown_height);
    case 'cherry_foliage_placer': return c.s(fp.height);
    case 'poplar_foliage_placer': return c.s(fp.height);
    default: throw new Error('unsupported foliage placer ' + fp.type);
  }
}

function foliageRadius(c: Ctx, fp: any, trunkHeight: number): number {
  const base = c.s(fp.radius);
  return fp.type === 'pine_foliage_placer' ? base + c.r.nextIntBounded(Math.max(trunkHeight + 1, 1)) : base;
}

/** FoliagePlacer.shouldSkipLocation for each placer type. */
function shouldSkip(c: Ctx, fp: any, dx: number, y: number, dz: number, R: number, dbl: boolean): boolean {
  const r = c.r;
  switch (fp.type) {
    case 'blob_foliage_placer': return dx === R && dz === R && (r.nextIntBounded(2) === 0 || y === 0);
    case 'fancy_foliage_placer': return fr(fr(dx + 0.5) * fr(dx + 0.5)) + fr(fr(dz + 0.5) * fr(dz + 0.5)) > R * R;
    case 'bush_foliage_placer': return dx === R && dz === R && r.nextIntBounded(2) === 0;
    case 'acacia_foliage_placer':
      if (y === 0) return (dx > 1 || dz > 1) && dx !== 0 && dz !== 0;
      return dx === R && dz === R && R > 0;
    case 'jungle_foliage_placer': case 'mega_pine_foliage_placer':
      return dx + dz >= 7 || dx * dx + dz * dz > R * R;
    case 'pine_foliage_placer': case 'spruce_foliage_placer': return dx === R && dz === R && R > 0;
    case 'dark_oak_foliage_placer':
      if (y === -1 && !dbl) return dx === R && dz === R;
      if (y === 1) return dx + dz > R * 2 - 2;
      return false;
    case 'cherry_foliage_placer': {
      if (y === -1 && (dx === R || dz === R) && r.nextFloat() < fr(fp.wide_bottom_layer_hole_chance)) return true;
      const corner = dx === R && dz === R;
      if (R > 2) return corner || (dx + dz > R * 2 - 2 && r.nextFloat() < fr(fp.corner_hole_chance));
      return corner && r.nextFloat() < fr(fp.corner_hole_chance);
    }
    default: return false;
  }
}

function shouldSkipSigned(c: Ctx, fp: any, dx: number, y: number, dz: number, R: number, dbl: boolean): boolean {
  if (fp.type === 'dark_oak_foliage_placer' && y === 0 && dbl && (dx === -R || dx >= R) && (dz === -R || dz >= R)) return true;
  let mx: number, mz: number;
  if (dbl) { mx = Math.min(Math.abs(dx), Math.abs(dx - 1)); mz = Math.min(Math.abs(dz), Math.abs(dz - 1)); }
  else { mx = Math.abs(dx); mz = Math.abs(dz); }
  return shouldSkip(c, fp, mx, y, mz, R, dbl);
}

function leavesRow(c: Ctx, fp: any, ox: number, oy: number, oz: number, R: number, y: number, dbl: boolean) {
  const off = dbl ? 1 : 0;
  for (let dx = -R; dx <= R + off; dx++) {
    for (let dz = -R; dz <= R + off; dz++) {
      if (!shouldSkipSigned(c, fp, dx, y, dz, R, dbl)) c.tryPlaceLeaf(ox + dx, oy + y, oz + dz);
    }
  }
}

function leavesRowHanging(c: Ctx, fp: any, ox: number, oy: number, oz: number, R: number, y: number, dbl: boolean) {
  leavesRow(c, fp, ox, oy, oz, R, y, dbl);
  const chance = fr(fp.hanging_leaves_chance), extChance = fr(fp.hanging_leaves_extension_chance);
  const off = dbl ? 1 : 0;
  const lx = ox, ly = oy - 1, lz = oz; // logPos = origin.below()
  const tryExt = (px: number, py: number, pz: number, ch: number): boolean => {
    if (Math.abs(px - lx) + Math.abs(py - ly) + Math.abs(pz - lz) >= 7) return false;
    return c.r.nextFloat() > ch ? false : c.tryPlaceLeaf(px, py, pz);
  };
  for (let along = 0; along < 4; along++) {
    const to = clockWise(along);
    const toOff = DX[to] + DZ[to] > 0 ? R + off : R;
    let px = ox + DX[to] * toOff - DX[along] * R, py = oy + y - 1, pz = oz + DZ[to] * toOff - DZ[along] * R;
    for (let k = -R; k < R + off; k++) {
      const above = c.isSet(px, py + 1, pz);
      if (above && tryExt(px, py, pz, chance)) tryExt(px, py - 1, pz, extChance);
      px += DX[along]; pz += DZ[along];
    }
  }
}

function createFoliage(c: Ctx, fp: any, a: Attachment, height: number, fHeight: number, R: number) {
  const r = c.r;
  const offset = c.s(fp.offset);
  const dbl = a.double;
  const fh = fHeight;
  switch (fp.type) {
    case 'blob_foliage_placer':
      for (let yo = offset; yo >= offset - fh; yo--) {
        leavesRow(c, fp, a.x, a.y, a.z, Math.max(R + a.radiusOffset - 1 - Math.trunc(yo / 2), 0), yo, dbl);
      }
      break;
    case 'fancy_foliage_placer':
      for (let yo = offset; yo >= offset - fh; yo--) {
        leavesRow(c, fp, a.x, a.y, a.z, R + (yo !== offset && yo !== offset - fh ? 1 : 0), yo, dbl);
      }
      break;
    case 'bush_foliage_placer':
      for (let yo = offset; yo >= offset - fh; yo--) leavesRow(c, fp, a.x, a.y, a.z, R + a.radiusOffset - 1 - yo, yo, dbl);
      break;
    case 'acacia_foliage_placer': {
      const py = a.y + offset;
      leavesRow(c, fp, a.x, py, a.z, R + a.radiusOffset, -1 - fh, dbl);
      leavesRow(c, fp, a.x, py, a.z, R - 1, -fh, dbl);
      leavesRow(c, fp, a.x, py, a.z, R + a.radiusOffset - 1, 0, dbl);
      break;
    }
    case 'jungle_foliage_placer': {
      const leafHeight = dbl ? fh : 1 + r.nextIntBounded(2);
      for (let yo = offset; yo >= offset - leafHeight; yo--) leavesRow(c, fp, a.x, a.y, a.z, R + a.radiusOffset + 1 - yo, yo, dbl);
      break;
    }
    case 'pine_foliage_placer': {
      let cur = 0;
      for (let yo = offset; yo >= offset - fh; yo--) {
        leavesRow(c, fp, a.x, a.y, a.z, cur, yo, dbl);
        if (cur >= 1 && yo === offset - fh + 1) cur--;
        else if (cur < R + a.radiusOffset) cur++;
      }
      break;
    }
    case 'spruce_foliage_placer': {
      let cur = r.nextIntBounded(2), maxR = 1, minR = 0;
      for (let yo = offset; yo >= -fh; yo--) {
        leavesRow(c, fp, a.x, a.y, a.z, cur, yo, dbl);
        if (cur >= maxR) { cur = minR; minR = 1; maxR = Math.min(maxR + 1, R + a.radiusOffset); }
        else cur++;
      }
      break;
    }
    case 'dark_oak_foliage_placer': {
      const py = a.y + offset;
      if (dbl) {
        leavesRow(c, fp, a.x, py, a.z, R + 2, -1, dbl);
        leavesRow(c, fp, a.x, py, a.z, R + 3, 0, dbl);
        leavesRow(c, fp, a.x, py, a.z, R + 2, 1, dbl);
        if (r.nextBoolean()) leavesRow(c, fp, a.x, py, a.z, R, 2, dbl);
      } else {
        leavesRow(c, fp, a.x, py, a.z, R + 2, -1, dbl);
        leavesRow(c, fp, a.x, py, a.z, R + 1, 0, dbl);
      }
      break;
    }
    case 'mega_pine_foliage_placer': {
      let prev = 0;
      for (let yy = a.y - fh + offset; yy <= a.y + offset; yy++) {
        const yo = a.y - yy;
        const smooth = R + a.radiusOffset + Math.floor(fr(fr(yo / fh) * 3.5));
        const jagged = yo > 0 && smooth === prev && (yy & 1) === 0 ? smooth + 1 : smooth;
        leavesRow(c, fp, a.x, yy, a.z, jagged, 0, dbl);
        prev = smooth;
      }
      break;
    }
    case 'cherry_foliage_placer': {
      const py = a.y + offset;
      const cur = R + a.radiusOffset - 1;
      leavesRow(c, fp, a.x, py, a.z, cur - 2, fh - 3, dbl);
      leavesRow(c, fp, a.x, py, a.z, cur - 1, fh - 4, dbl);
      for (let y = fh - 5; y >= 0; y--) leavesRow(c, fp, a.x, py, a.z, cur, y, dbl);
      leavesRowHanging(c, fp, a.x, py, a.z, cur, -1, dbl);
      leavesRowHanging(c, fp, a.x, py, a.z, cur - 1, -2, dbl);
      break;
    }
    case 'poplar_foliage_placer': poplarFoliage(c, fp, a, offset, fh, R); break;
    default: throw new Error('unsupported foliage placer ' + fp.type);
  }
  void height;
}

/** PoplarFoliagePlacer: rhombus-shaped rows, with a few leaf cells at the widest row turned into log. */
function poplarFoliage(c: Ctx, fp: any, a: Attachment, offset: number, fh: number, R: number) {
  const r = c.r, dbl = a.double;
  const py = a.y + offset;
  const cur = R + a.radiusOffset - 1;
  const flip = r.nextBoolean();
  const partial = (y: number) => fh - 1 === y || fh - 2 === y;
  const cornerCut = (dx: number, dz: number, rad: number, part: boolean) => {
    const small = flip ? ((dx > 0 && dz > 0) || (dz < 0 && dx < 0)) : ((dx > 0 && dz < 0) || (dz > 0 && dx < 0));
    return small ? rad - 1 : part ? rad + 1 : rad;
  };
  const inRhombus = (rad: number, adx: number, adz: number, cut: number, extra: number) => adx + adz <= rad * 2 - (cut + extra);
  const row = (rad: number, y: number) => {
    const off = dbl ? 1 : 0;
    for (let dx = -rad; dx <= rad + off; dx++) {
      for (let dz = -rad; dz <= rad + off; dz++) {
        const part = partial(y);
        const cut = cornerCut(dx, dz, rad, part);
        const adx = Math.abs(dx), adz = Math.abs(dz);
        let skip: boolean;
        if (part && (adx === rad || adz === rad)) skip = true;
        else {
          const extra = r.nextFloat() <= fr(fp.side_hole_chance) ? 1 : 0;
          skip = !inRhombus(rad, adx, adz, cut, extra);
        }
        if (!skip) c.tryPlaceLeaf(a.x + dx, py + y, a.z + dz);
      }
    }
  };
  row(cur - 2, fh - 1);
  row(cur - 1, fh - 2);
  row(cur - 1, fh - 3);
  for (let y = fh - 4; y >= 1; y--) row(cur, y);
  // replaceLeavesWithLog at the widest row
  {
    const y = fh - 4, off = dbl ? 1 : 0;
    for (let dx = -cur; dx <= cur + off; dx++) {
      for (let dz = -cur; dz <= cur + off; dz++) {
        const adx = Math.abs(dx), adz = Math.abs(dz);
        if (inRhombus(cur, adx, adz, cornerCut(dx, dz, cur, partial(y)), 2) && ((adz === 0 && cur - adx >= 4) || (adx === 0 && cur - adz >= 4))) {
          const x = a.x + dx, yy = py + y, z = a.z + dz;
          if (c.w.block(x, yy, z) === c.leafType) { c.w.set(x, yy, z, c.trunkType); c.foliage.add(`${x},${yy},${z}`); }
        }
      }
    }
  }
  row(cur - 1, 0);
  row(Math.min(2, Math.max(1, cur - 2)), -1);
}

// ---------------------------------------------------------------------------------------------------------------------
// Decorators (only the ones whose effect on random numbers or on terrain matters here)
// ---------------------------------------------------------------------------------------------------------------------
/** minecraft:beneath_tree_podzol_replaceable */
const PODZOL_REPLACEABLE = new Set<number>([VoxelType.GRASS, VoxelType.DIRT, VoxelType.COARSE_DIRT, VoxelType.MYCELIUM, VoxelType.PODZOL]);

function alterGround(c: Ctx) {
  if (!c.trunks.length) return;
  let minY = Infinity;
  for (const p of c.trunks) if (p.y < minY) minY = p.y;
  const circle = (px: number, py: number, pz: number) => {
    for (let xx = -2; xx <= 2; xx++) {
      for (let zz = -2; zz <= 2; zz++) {
        if (Math.abs(xx) === 2 && Math.abs(zz) === 2) continue;
        const x = px + xx, z = pz + zz;
        for (let dy = 2; dy >= -3; dy--) {
          const y = py + dy;
          const t = c.w.block(x, y, z);
          if (PODZOL_REPLACEABLE.has(t)) { c.w.set(x, y, z, VoxelType.PODZOL); break; }
          if (t !== VoxelType.AIR && dy < 0) break;
        }
      }
    }
  };
  for (const p of c.trunks.filter((q) => q.y === minY)) {
    circle(p.x - 1, p.y, p.z - 1); circle(p.x - 1, p.y, p.z - 1);
    circle(p.x + 2, p.y, p.z - 1); circle(p.x + 2, p.y, p.z - 1);
    circle(p.x - 1, p.y, p.z + 2); circle(p.x - 1, p.y, p.z + 2);
    circle(p.x + 2, p.y, p.z + 2); circle(p.x + 2, p.y, p.z + 2);
    for (let i = 0; i < 5; i++) {
      const placement = c.r.nextIntBounded(64);
      const xx = placement % 8, zz = Math.floor(placement / 8);
      if (xx === 0 || xx === 7 || zz === 0 || zz === 7) circle(p.x - 3 + xx, p.y, p.z - 3 + zz);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// TreeFeature.place
// ---------------------------------------------------------------------------------------------------------------------
/** Places one tree whose trunk origin (first log cell) is (ox, oy, oz). Returns false when vanilla would fail. */
export function placeTree(cfg: any, r: Rng, ox: number, oy: number, oz: number, world: TreeWorld, sample: SampleInt): boolean {
  const c = new Ctx(world, r, cfg, sample);
  const tp = cfg.trunk_placer, fp = cfg.foliage_placer;
  const height = treeHeight(tp, r);
  const fHeight = foliageHeight(c, fp, height);
  const trunkHeight = height - fHeight;
  const leafRadius = foliageRadius(c, fp, trunkHeight);
  const minY = oy, maxY = oy + height + 1;
  if (!(minY >= world.minY + 1 && maxY <= world.maxY)) return false;

  // getMaxFreeTreeHeight
  let clipped = height;
  scan:
  for (let y = 0; y <= height + 1; y++) {
    const rad = sizeAtHeight(cfg.size, height, y);
    for (let x = -rad; x <= rad; x++) {
      for (let z = -rad; z <= rad; z++) {
        const yy = oy + y;
        if (yy >= world.maxY || yy < world.minY || !isFree(world.block(ox + x, yy, oz + z)) || (!cfg.ignore_vines && world.block(ox + x, yy, oz + z) === VoxelType.VINE)) {
          clipped = y - 2;
          break scan;
        }
      }
    }
  }
  const minClipped = cfg.size.min_clipped_height;
  if (!(clipped >= height || (minClipped !== undefined && clipped >= minClipped))) return false;

  const attachments = placeTrunk(c, tp, clipped, ox, oy, oz);
  for (const a of attachments) createFoliage(c, fp, a, clipped, fHeight, leafRadius);
  if (!c.trunks.length && !c.foliage.size) return false;
  for (const d of cfg.decorators ?? []) {
    if (d.type === 'beehive') r.nextFloat();
    else if (d.type === 'alter_ground') alterGround(c);
  }
  return true;
}
