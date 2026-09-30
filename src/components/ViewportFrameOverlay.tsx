import React from 'react';

interface ViewportFrameOverlayProps {
  enabled: boolean;
  fps: number;
}

export const ViewportFrameOverlay: React.FC<ViewportFrameOverlayProps> = ({ enabled, fps }) => {
  if (!enabled) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden flex flex-col justify-between p-3 sm:p-5">
      {/* Top Framing Bar & Left/Right Brackets */}
      <div className="flex justify-between items-start">
        {/* Top-Left Bracket */}
        <div className="w-8 h-8 border-t-2 border-l-2 border-white/60" />

        <div className="px-2 py-0.5 rounded bg-black/40 border border-white/10 text-[9px] font-mono tracking-widest text-white/60 uppercase">
          VIEWPORT · 16:9 · {fps} FPS
        </div>

        {/* Top-Right Bracket */}
        <div className="w-8 h-8 border-t-2 border-r-2 border-white/60" />
      </div>

      {/* Bottom Framing Bar & Brackets */}
      <div className="flex justify-between items-end">
        {/* Bottom-Left Bracket */}
        <div className="w-8 h-8 border-b-2 border-l-2 border-white/60" />

        <div className="text-[8px] font-mono tracking-widest text-white/30 uppercase">
          RAW PROJECTION
        </div>

        {/* Bottom-Right Bracket */}
        <div className="w-8 h-8 border-b-2 border-r-2 border-white/60" />
      </div>

      {/* Outer border guide */}
      <div className="absolute inset-3 sm:inset-5 border border-white/10 rounded pointer-events-none" />
    </div>
  );
};
