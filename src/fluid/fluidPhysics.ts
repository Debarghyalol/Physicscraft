import type { VoxelWorld } from '../rendering/VoxelWorld';
import { WATER, getFlow, ownHeight } from './fluid';

export interface WaterSample {
  /** Depth of water above the box's bottom (blocks), 0 when dry. Vanilla getFluidHeight. */
  height: number;
  /** Average current pushing on the box, horizontal (unit-ish, already scaled by depth when shallow). */
  flowX: number;
  flowZ: number;
  /** Number of water cells touching the box. */
  count: number;
}

export const makeWaterSample = (): WaterSample => ({ height: 0, flowX: 0, flowZ: 0, count: 0 });

const flowScratch = { x: 0, z: 0 };

/**
 * Vanilla EntityFluidInteraction: for the (slightly deflated) box, find the water depth and the
 * averaged current of every water cell it touches.
 */
export function sampleWater(
  world: VoxelWorld,
  minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number,
  out: WaterSample
): WaterSample {
  const e = 0.001;
  minX += e; minY += e; minZ += e; maxX -= e; maxY -= e; maxZ -= e;
  const x0 = Math.floor(minX), x1 = Math.ceil(maxX);
  const y0 = Math.floor(minY), y1 = Math.ceil(maxY);
  const z0 = Math.floor(minZ), z1 = Math.ceil(maxZ);
  let height = 0;
  let fx = 0;
  let fz = 0;
  let count = 0;
  const access = {
    type: (x: number, y: number, z: number) => world.getVoxel(x, y, z),
    level: (x: number, y: number, z: number) => world.getFluidLevel(x, y, z),
  };
  for (let x = x0; x < x1; x++) {
    for (let y = y0; y < y1; y++) {
      for (let z = z0; z < z1; z++) {
        if (world.getVoxel(x, y, z) !== WATER) continue;
        const surface = y + (world.getVoxel(x, y + 1, z) === WATER ? 1 : ownHeight(world.getFluidLevel(x, y, z)));
        if (surface < minY) continue;
        height = Math.max(height, surface - minY);
        getFlow(access, x, y, z, flowScratch);
        const s = height < 0.4 ? height : 1;
        fx += flowScratch.x * s;
        fz += flowScratch.z * s;
        count++;
      }
    }
  }
  out.height = height;
  out.count = count;
  out.flowX = count > 0 ? fx / count : 0;
  out.flowZ = count > 0 ? fz / count : 0;
  return out;
}

/** True when the water cell at (x,y,z) contains the point's height (surface above y). */
export function isPointInWater(world: VoxelWorld, px: number, py: number, pz: number): boolean {
  const x = Math.floor(px), y = Math.floor(py), z = Math.floor(pz);
  if (world.getVoxel(x, y, z) !== WATER) return false;
  const top = y + (world.getVoxel(x, y + 1, z) === WATER ? 1 : ownHeight(world.getFluidLevel(x, y, z)));
  return py < top;
}
