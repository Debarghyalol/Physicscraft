import React from 'react';

export interface DebugFrameSample {
  frameMs: number;
  fps: number;
  physicsMs: number;
  renderMs: number;
  streamingMs: number;
  generationMs: number;
  chunks: number;
  meshes: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  jsHeapMb: number | null;
}

export interface DebugOverlayProps {
  enabled: boolean;
  sample: DebugFrameSample;
  history: DebugFrameSample[];
}

const fmt = (n: number, digits = 1) => Number.isFinite(n) ? n.toFixed(digits) : '—';

const MiniGraph: React.FC<{ values: number[]; label: string; unit?: string; max?: number }> = ({
  values, label, unit = '', max,
}) => {
  if (!values.length) return null;
  const width = 300;
  const height = 52;
  const hi = max ?? Math.max(...values, 1);
  const points = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * width;
    const y = height - Math.min(1, Math.max(0, v / hi)) * (height - 8) - 4;
    return x + ',' + y;
  }).join(' ');
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-[10px] text-zinc-300">
        <span>{label}</span>
        <span>{fmt(values[values.length - 1])}{unit}</span>
      </div>
      <svg viewBox={'0 0 ' + width + ' ' + height} className="w-full h-[52px] bg-black/35 border border-white/10">
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.6" />
        <line x1="0" x2={width} y1={height - 5} y2={height - 5} stroke="currentColor" opacity="0.15" />
      </svg>
    </div>
  );
};

export const DebugOverlay: React.FC<DebugOverlayProps> = ({ enabled, sample, history }) => {
  if (!enabled) return null;
  const frameValues = history.map((s) => s.frameMs);
  const renderValues = history.map((s) => s.renderMs);
  const generationValues = history.map((s) => s.generationMs);
  const memoryValues = history.map((s) => s.jsHeapMb ?? 0);

  return (
    <div className="absolute top-3 right-3 z-40 w-[320px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-24px)] overflow-y-auto rounded-md border border-white/15 bg-black/80 backdrop-blur-sm shadow-2xl text-white font-mono text-[11px] pointer-events-none">
      <div className="px-3 py-2 border-b border-white/10">
        <div className="font-bold text-xs tracking-wide">PHYSICSCRAFT DEBUG MODE</div>
        <div className="text-[10px] text-zinc-400">Live performance + world telemetry</div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 px-3 py-2 border-b border-white/10">
        <span>FPS</span><b>{sample.fps}</b>
        <span>Frame</span><b>{fmt(sample.frameMs, 2)} ms</b>
        <span>Physics</span><b>{fmt(sample.physicsMs, 2)} ms</b>
        <span>Render</span><b>{fmt(sample.renderMs, 2)} ms</b>
        <span>Streaming</span><b>{fmt(sample.streamingMs, 2)} ms</b>
        <span>Generation</span><b>{fmt(sample.generationMs, 2)} ms</b>
        <span>Chunks</span><b>{sample.chunks}</b>
        <span>Meshes</span><b>{sample.meshes}</b>
        <span>Draw calls</span><b>{sample.drawCalls}</b>
        <span>Triangles</span><b>{sample.triangles.toLocaleString()}</b>
        <span>Geometries</span><b>{sample.geometries}</b>
        <span>Textures</span><b>{sample.textures}</b>
        <span>JS heap</span><b>{sample.jsHeapMb == null ? 'n/a' : fmt(sample.jsHeapMb) + ' MB'}</b>
      </div>
      <div className="px-3 py-2 space-y-2">
        <MiniGraph label="Frame time" values={frameValues} unit=" ms" max={33.3} />
        <MiniGraph label="Render time" values={renderValues} unit=" ms" max={16.7} />
        <MiniGraph label="Chunk generation" values={generationValues} unit=" ms" max={10} />
        <MiniGraph label="Memory" values={memoryValues} unit=" MB" />
      </div>
    </div>
  );
};
