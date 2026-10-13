import type { GeneratedChunk } from './ChunkGenerator';

export interface PoolResult extends GeneratedChunk { seed: number; epoch: number; cx: number; cz: number; }

/** Small pool of terrain workers. Each worker holds at most PER_WORKER requests so the nearest-first queue stays fresh. */
export class ChunkGenPool {
  private static readonly PER_WORKER = 2;
  private workers: Worker[] = [];
  private load: number[] = [];
  private dead = false;

  /** Worker count from the device's logical cores, leaving room for the render + physics main thread. */
  static defaultSize(): number {
    const hc = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
    return Math.max(1, Math.min(4, hc - 2));
  }

  constructor(size: number, private onResult: (r: PoolResult) => void, private onFail: () => void) {
    try {
      for (let i = 0; i < size; i++) {
        const w = new Worker(new URL('./chunkGen.worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent) => { this.load[i]--; this.onResult(e.data as PoolResult); };
        w.onerror = () => this.fail();
        this.workers.push(w);
        this.load.push(0);
      }
    } catch {
      this.fail();
    }
  }

  get alive(): boolean { return !this.dead; }

  get hasCapacity(): boolean {
    if (this.dead) return false;
    let total = 0;
    for (const l of this.load) total += l;
    return total < this.workers.length * ChunkGenPool.PER_WORKER;
  }

  request(seed: number, epoch: number, cx: number, cz: number) {
    let best = 0;
    for (let i = 1; i < this.load.length; i++) if (this.load[i] < this.load[best]) best = i;
    this.load[best]++;
    this.workers[best].postMessage({ seed, epoch, cx, cz });
  }

  private fail() {
    if (this.dead) return;
    this.dead = true;
    this.dispose();
    this.onFail();
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.load = [];
  }
}
