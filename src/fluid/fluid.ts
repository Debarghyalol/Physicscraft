import { VoxelType } from '../types/physics';

/**
 * Water state helpers, ported from Minecraft's FlowingFluid / WaterFluid / FluidState.
 *
 * A water cell stores Minecraft's legacy LiquidBlock level (0..15) in `ChunkColumn.fluid`:
 *   0      = source block
 *   1..7   = flowing, amount = 8 - level (7 = thickest, 1 = thinnest)
 *   8..15  = "falling" water (column pouring down), amount 8
 */
export const WATER = VoxelType.WATER;
export const FULL_HEIGHT = 8 / 9; // MAX_FLUID_HEIGHT 0.8888889

export const levelAmount = (level: number) => (level === 0 || level >= 8 ? 8 : 8 - level);
export const levelIsSource = (level: number) => level === 0;
export const levelIsFalling = (level: number) => level >= 8;
/** FluidState.getOwnHeight(): amount / 9 */
export const ownHeight = (level: number) => levelAmount(level) / 9;
/** FlowingFluid.getLegacyLevel for a flowing state. */
export const flowingLevel = (amount: number, falling: boolean) => 8 - Math.min(amount, 8) + (falling ? 8 : 0);

/** Blocks that stop water (full collision cubes). Air and water are the only non-solid voxels. */
export const isSolidType = (t: number) => t !== VoxelType.AIR && t !== WATER;

/** Horizontal directions in vanilla's Direction.Plane.HORIZONTAL order: N(-z), E(+x), S(+z), W(-x). */
export const HDX = [0, 1, 0, -1];
export const HDZ = [-1, 0, 1, 0];

export interface FluidAccess {
  type(x: number, y: number, z: number): number;
  level(x: number, y: number, z: number): number;
}

/** FlowingFluid.getFlow, horizontal part only. Writes the normalised flow into `out`. */
export function getFlow(a: FluidAccess, x: number, y: number, z: number, out: { x: number; z: number }) {
  const self = ownHeight(a.level(x, y, z));
  let fx = 0;
  let fz = 0;
  for (let d = 0; d < 4; d++) {
    const nx = x + HDX[d];
    const nz = z + HDZ[d];
    const t = a.type(nx, y, nz);
    let nh = t === WATER ? ownHeight(a.level(nx, y, nz)) : 0;
    let dist = 0;
    if (nh === 0) {
      if (!isSolidType(t) && a.type(nx, y - 1, nz) === WATER) {
        nh = ownHeight(a.level(nx, y - 1, nz));
        if (nh > 0) dist = self - (nh - FULL_HEIGHT);
      }
    } else {
      dist = self - nh;
    }
    if (dist !== 0) {
      fx += HDX[d] * dist;
      fz += HDZ[d] * dist;
    }
  }
  const len = Math.hypot(fx, fz);
  out.x = len > 0 ? fx / len : 0;
  out.z = len > 0 ? fz / len : 0;
}
