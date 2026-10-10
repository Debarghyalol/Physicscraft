import { VoxelType } from '../types/physics';
import { VoxelWorld, WORLD_MAX_Y, WORLD_MIN_Y } from '../rendering/VoxelWorld';
import { HDX, HDZ, WATER, flowingLevel, isSolidType, levelAmount, levelIsFalling, levelIsSource } from './fluid';

/** WaterFluid: getTickDelay 5, getDropOff 1, getSlopeFindDistance 4. */
const TICK_DELAY = 5;
const DROP_OFF = 1;
const SLOPE_FIND_DISTANCE = 4;
const TICK_SECONDS = 1 / 20;
const MAX_TICKS_PER_UPDATE = 3500;

const opposite = (d: number) => (d + 2) & 3;

/**
 * Water spreading, a port of Minecraft's FlowingFluid + WaterFluid logic.
 *
 * Water cells are scheduled (5 game ticks later) whenever they or a neighbour change. A tick
 * recomputes the cell's level from its neighbours (getNewLiquid), then spreads down first and
 * sideways towards the nearest drop (getSpread / getSlopeDistance), exactly like Java.
 */
export class FluidSimulator {
  private scheduled = new Set<number>();
  private queue: number[] = []; // x, y, z, due
  private head = 0;
  private tickNow = 0;
  private acc = 0;
  /** Water is only simulated while true (paused games / menus can switch it off). */
  public enabled = true;

  constructor(private world: VoxelWorld) {
    world.blockListeners.push((x, y, z) => this.blockChanged(x, y, z));
  }

  // ---------------------------------------------------------------- scheduling

  private key(x: number, y: number, z: number) {
    return ((x + 2097152) * 4194304 + (z + 2097152)) * 512 + (y - WORLD_MIN_Y);
  }

  public schedule(x: number, y: number, z: number, delay = TICK_DELAY) {
    if (y < WORLD_MIN_Y || y >= WORLD_MAX_Y) return;
    const k = this.key(x, y, z);
    if (this.scheduled.has(k)) return;
    this.scheduled.add(k);
    this.queue.push(x, y, z, this.tickNow + delay);
  }

  private blockChanged(x: number, y: number, z: number) {
    const w = this.world;
    if (w.getVoxel(x, y, z) === WATER) this.schedule(x, y, z);
    if (w.getVoxel(x + 1, y, z) === WATER) this.schedule(x + 1, y, z);
    if (w.getVoxel(x - 1, y, z) === WATER) this.schedule(x - 1, y, z);
    if (w.getVoxel(x, y + 1, z) === WATER) this.schedule(x, y + 1, z);
    if (w.getVoxel(x, y - 1, z) === WATER) this.schedule(x, y - 1, z);
    if (w.getVoxel(x, y, z + 1) === WATER) this.schedule(x, y, z + 1);
    if (w.getVoxel(x, y, z - 1) === WATER) this.schedule(x, y, z - 1);
  }

  public get pending() {
    return (this.queue.length - this.head) / 4;
  }

  /** Advance the simulation by dt seconds (20 game ticks per second). */
  public update(dt: number) {
    if (!this.enabled) return;
    this.acc = Math.min(this.acc + dt, 0.5);
    if (this.acc < TICK_SECONDS) return;
    let budget = MAX_TICKS_PER_UPDATE;
    const w = this.world;
    w.beginBatch();
    try {
      while (this.acc >= TICK_SECONDS) {
        this.acc -= TICK_SECONDS;
        this.tickNow++;
        while (this.head < this.queue.length && this.queue[this.head + 3] <= this.tickNow) {
          const x = this.queue[this.head];
          const y = this.queue[this.head + 1];
          const z = this.queue[this.head + 2];
          this.head += 4;
          this.scheduled.delete(this.key(x, y, z));
          this.tickAt(x, y, z);
          if (--budget <= 0) {
            this.acc = 0;
            break;
          }
        }
        if (budget <= 0) break;
      }
    } finally {
      w.endBatch();
    }
    if (this.head > 8192 && this.head * 2 > this.queue.length) {
      this.queue = this.queue.slice(this.head);
      this.head = 0;
    }
    if (this.head >= this.queue.length) {
      this.queue.length = 0;
      this.head = 0;
    }
  }

  // ------------------------------------------------------------- world access

  /** Unloaded chunks behave as solid so water never spills into (and never generates) them. */
  private type(x: number, y: number, z: number): number {
    if (y < WORLD_MIN_Y) return VoxelType.BEDROCK;
    if (y >= WORLD_MAX_Y) return VoxelType.AIR;
    if (!this.world.hasColumnAt(x, z)) return VoxelType.STONE;
    return this.world.getVoxel(x, y, z);
  }

  private level(x: number, y: number, z: number): number {
    return this.world.getFluidLevel(x, y, z);
  }

  private isSourceCell(x: number, y: number, z: number, t = this.type(x, y, z)) {
    return t === WATER && levelIsSource(this.level(x, y, z));
  }

  // ------------------------------------------------------------ FlowingFluid

  /** canPassThroughWall: every voxel here is a full cube or empty, so a wall only exists around solids. */
  private passWall(src: number, dst: number) {
    return !isSolidType(src) && !isSolidType(dst);
  }

  /** canMaybePassThrough: target is not a source, can hold fluid (air / water) and nothing walls it off. */
  private canMaybePass(srcType: number, tx: number, ty: number, tz: number): boolean {
    const t = this.type(tx, ty, tz);
    if (t === WATER && levelIsSource(this.level(tx, ty, tz))) return false;
    if (t !== VoxelType.AIR && t !== WATER) return false;
    return this.passWall(srcType, t);
  }

  /** isWaterHole: water can fall into the cell below. */
  private isHole(x: number, y: number, z: number): boolean {
    const here = this.type(x, y, z);
    const below = this.type(x, y - 1, z);
    if (!this.passWall(here, below)) return false;
    return below === WATER || below === VoxelType.AIR;
  }

  /** getNewLiquid: the level this cell should have, or -1 for empty. */
  private newLiquid(x: number, y: number, z: number): number {
    const here = this.type(x, y, z);
    let highest = 0;
    let sources = 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + HDX[d];
      const nz = z + HDZ[d];
      const t = this.type(nx, y, nz);
      if (t === WATER && this.passWall(here, t)) {
        const l = this.level(nx, y, nz);
        if (levelIsSource(l)) sources++;
        highest = Math.max(highest, levelAmount(l));
      }
    }
    if (sources >= 2) {
      const below = this.type(x, y - 1, z);
      if (isSolidType(below) || (below === WATER && this.level(x, y - 1, z) === 0)) return 0;
    }
    if (this.type(x, y + 1, z) === WATER && this.passWall(here, WATER)) return flowingLevel(8, true);
    const amount = highest - DROP_OFF;
    return amount <= 0 ? -1 : flowingLevel(amount, false);
  }

  private sourceNeighbours(x: number, y: number, z: number): number {
    let n = 0;
    for (let d = 0; d < 4; d++) if (this.isSourceCell(x + HDX[d], y, z + HDZ[d])) n++;
    return n;
  }

  /** getSlopeDistance: how far (in steps) the nearest drop is, searching up to 4 cells out. */
  private slopeDistance(x: number, y: number, z: number, pass: number, from: number): number {
    let lowest = 1000;
    const here = this.type(x, y, z);
    for (let d = 0; d < 4; d++) {
      if (d === from) continue;
      const tx = x + HDX[d];
      const tz = z + HDZ[d];
      if (!this.canMaybePass(here, tx, y, tz)) continue;
      if (this.isHole(tx, y, tz)) return pass;
      if (pass < SLOPE_FIND_DISTANCE) {
        const v = this.slopeDistance(tx, y, tz, pass + 1, opposite(d));
        if (v < lowest) lowest = v;
      }
    }
    return lowest;
  }

  /** getSpread: which sides to flow into (only the ones leading to the nearest drop). */
  private getSpread(x: number, y: number, z: number, out: number[]) {
    out.length = 0; // pairs of (direction, new level)
    let lowest = 1000;
    const here = this.type(x, y, z);
    for (let d = 0; d < 4; d++) {
      const tx = x + HDX[d];
      const tz = z + HDZ[d];
      if (!this.canMaybePass(here, tx, y, tz)) continue;
      const newL = this.newLiquid(tx, y, tz);
      const distance = this.isHole(tx, y, tz) ? 0 : this.slopeDistance(tx, y, tz, 1, opposite(d));
      if (distance < lowest) out.length = 0;
      if (distance <= lowest) {
        // WaterFluid.canBeReplacedWith: existing water is never replaced sideways, only air.
        if (this.type(tx, y, tz) !== WATER && newL >= 0) out.push(d, newL);
        lowest = distance;
      }
    }
  }

  private spreadScratch: number[] = [];

  private spreadToSides(x: number, y: number, z: number, level: number) {
    let neighbour = levelAmount(level) - DROP_OFF;
    if (levelIsFalling(level)) neighbour = 7;
    if (neighbour <= 0) return;
    const out = this.spreadScratch;
    this.getSpread(x, y, z, out);
    for (let i = 0; i < out.length; i += 2) {
      this.world.setWater(x + HDX[out[i]], y, z + HDZ[out[i]], out[i + 1]);
    }
  }

  private spread(x: number, y: number, z: number, level: number) {
    const here = this.type(x, y, z);
    const belowType = this.type(x, y - 1, z);
    if (this.canMaybePass(here, x, y - 1, z) && belowType === VoxelType.AIR) {
      // The cell below is air: pour straight down (a falling column) and stop.
      this.world.setWater(x, y - 1, z, this.newLiquid(x, y - 1, z));
      if (this.sourceNeighbours(x, y, z) >= 3) this.spreadToSides(x, y, z, level);
      return;
    }
    if (levelIsSource(level) || !this.isHole(x, y, z)) this.spreadToSides(x, y, z, level);
  }

  /** FlowingFluid.tick */
  private tickAt(x: number, y: number, z: number) {
    if (!this.world.hasColumnAt(x, z)) return;
    if (this.world.getVoxel(x, y, z) !== WATER) return;
    let level = this.level(x, y, z);
    if (!levelIsSource(level)) {
      const next = this.newLiquid(x, y, z);
      if (next < 0) {
        this.world.setVoxel(x, y, z, VoxelType.AIR);
        return;
      }
      if (next !== level) {
        level = next;
        this.world.setWater(x, y, z, next);
        this.schedule(x, y, z);
      }
    }
    this.spread(x, y, z, level);
  }
}
