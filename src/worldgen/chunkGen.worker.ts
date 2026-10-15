import { ChunkGenerator } from './ChunkGenerator';

let gen: ChunkGenerator | null = null;
const ctx = self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null };

ctx.onmessage = (e: MessageEvent) => {
  const { seed, epoch, cx, cz } = e.data as { seed: number; epoch: number; cx: number; cz: number };
  if (!gen || gen.seed !== seed) gen = new ChunkGenerator(seed);
  const r = gen.generate(cx, cz);
  ctx.postMessage({ seed, epoch, cx, cz, blocks: r.blocks, writes: r.writes, biomes: r.biomes }, [r.blocks.buffer, r.writes.buffer, r.biomes.buffer]);
};
