import React from 'react';

export interface DebugFrameSample {
  frameMs: number;
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

const Graph: React.FC<{ values: number[]; width?: number; height?: number; max?: number }> = ({
  values, width = 180, height = 28, max,
}) => {
  if (values.length < 2) return null;
  const hi = max ?? Math.max(...values, 1);
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - Math.min(1, Math.max(0, v / hi)) * (height - 2) - 1;
    return x + ',' + y;
  }).join(' ');
  return (
    <svg viewBox={'0 0 ' + width + ' ' + height} className="inline-block w-[180px] h-7 align-middle opacity-70">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
};

const Metric: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="leading-[15px] whitespace-nowrap">
    <span className="text-white/65">{label}: </span>
    <span className="text-white">{value}</span>
  </div>
);

export const DebugOverlay: React.FC<DebugOverlayProps> = ({ enabled, sample, history }) => {
  if (!enabled) return null;

  const frameValues = history.map((s) => s.frameMs);
  const renderValues = history.map((s) => s.renderMs);
  const generationValues = history.map((s) => s.generationMs);
  const memoryValues = history.filter((s) => s.jsHeapMb != null).map((s) => s.jsHeapMb as number);

  return (
    <div className="absolute inset-0 z-40 pointer-events-none select-none text-white font-mono text-[11px] leading-[15px] drop-shadow-[1px_1px_1px_rgba(0,0,0,0.95)]">
      <div className="absolute top-2 left-2 max-w-[390px]">
        <div className="text-white/90 mb-0.5">Physicscraft Debug (F3)</div>
        <Metric label="Frame" value={fmt(sample.frameMs, 2) + ' ms'} />
        <Metric label="Physics" value={fmt(sample.physicsMs, 2) + ' ms'} />
        <Metric label="Render" value={fmt(sample.renderMs, 2) + ' ms'} />
        <Metric label="Streaming" value={fmt(sample.streamingMs, 2) + ' ms'} />
        <Metric label="Generation" value={fmt(sample.generationMs, 2) + ' ms'} />
        <Metric label="Chunks" value={sample.chunks} />
        <Metric label="Meshes" value={sample.meshes} />
        <Metric label="Draw calls" value={sample.drawCalls} />
        <Metric label="Triangles" value={sample.triangles.toLocaleString()} />
        <Metric label="Geometries" value={sample.geometries} />
        <Metric label="Textures" value={sample.textures} />
        <Metric label="JS heap" value={sample.jsHeapMb == null ? 'unavailable' : fmt(sample.jsHeapMb) + ' MB'} />
      </div>

      <div className="absolute top-2 right-2 text-right max-w-[210px]">
        <div className="text-white/90 mb-0.5">Performance</div>
        <div className="flex items-center justify-end gap-1">
          <span className="text-white/65">Frame</span><Graph values={frameValues} max={33.3} />
        </div>
        <div className="flex items-center justify-end gap-1">
          <span className="text-white/65">Render</span><Graph values={renderValues} max={16.7} />
        </div>
        <div className="flex items-center justify-end gap-1">
          <span className="text-white/65">Generation</span><Graph values={generationValues} max={10} />
        </div>
        {memoryValues.length > 1 && (
          <div className="flex items-center justify-end gap-1">
            <span className="text-white/65">Memory</span><Graph values={memoryValues} />
          </div>
        )}
      </div>
    </div>
  );
};
