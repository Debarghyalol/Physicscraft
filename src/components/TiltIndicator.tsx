import React from 'react';
import { GyroState } from '../types/physics';
import { Compass } from 'lucide-react';

interface TiltIndicatorProps {
  gyroState: GyroState;
  onToggle: () => void;
}

export const TiltIndicator: React.FC<TiltIndicatorProps> = ({ gyroState, onToggle }) => {
  if (!gyroState.enabled) return null;

  // Clamp bubble displacement inside circle
  const maxOffset = 18;
  const offsetX = Math.max(-maxOffset, Math.min(maxOffset, (gyroState.gamma / 45) * maxOffset));
  const offsetY = Math.max(-maxOffset, Math.min(maxOffset, ((gyroState.beta - 45) / 45) * maxOffset));

  return (
    <div
      onClick={onToggle}
      className="flex items-center gap-2.5 bg-slate-900/90 backdrop-blur-md border border-sky-500/40 rounded-full px-3 py-1.5 shadow-lg shadow-sky-950/40 cursor-pointer select-none"
      title="Android Gyro Gravity Active - Tap to Disable"
    >
      <div className="relative w-8 h-8 rounded-full border border-sky-400/50 bg-slate-950 flex items-center justify-center overflow-hidden">
        {/* Crosshair guide lines */}
        <div className="absolute w-full h-[1px] bg-slate-800" />
        <div className="absolute h-full w-[1px] bg-slate-800" />
        {/* Tilting bubble indicator */}
        <div
          className="w-3.5 h-3.5 rounded-full bg-sky-400 shadow-md shadow-sky-400/80 transition-transform duration-75 ease-out"
          style={{
            transform: `translate(${offsetX}px, ${offsetY}px)`,
          }}
        />
      </div>

      <div className="flex flex-col text-left">
        <span className="text-[10px] font-semibold text-sky-400 flex items-center gap-1">
          <Compass className="w-3 h-3 animate-spin text-sky-400" style={{ animationDuration: '6s' }} />
          GYRO GRAVITY
        </span>
        <span className="text-[9px] text-slate-400 font-mono tabular-nums">
          X: {gyroState.gamma.toFixed(0)}° · Y: {gyroState.beta.toFixed(0)}°
        </span>
      </div>
    </div>
  );
};
