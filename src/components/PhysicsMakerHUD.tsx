import React, { useState, useEffect } from 'react';
import { PhysicsEngine } from '../physics/PhysicsEngine';
import { EnvironmentManager } from '../rendering/EnvironmentManager';
import {
  Wrench,
  Zap,
  RotateCcw,
  Sun,
  Moon,
  Sunrise,
  Sunset,
  Box,
  Link,
  Trash2,
  Layers,
} from 'lucide-react';

interface PhysicsMakerHUDProps {
  engine: PhysicsEngine | null;
  envManager: EnvironmentManager | null;
  isOpen: boolean;
  onClose: () => void;
}

const MOON_PHASE_NAMES = [
  'Full Moon',
  'Waning Gibbous',
  'Third Quarter',
  'Waning Crescent',
  'New Moon',
  'Waxing Crescent',
  'First Quarter',
  'Waxing Gibbous',
];

export const PhysicsMakerHUD: React.FC<PhysicsMakerHUDProps> = ({
  engine,
  envManager,
  isOpen,
  onClose,
}) => {
  const [cornerA, setCornerA] = useState<{ x: number; y: number; z: number } | null>(null);
  const [cornerB, setCornerB] = useState<{ x: number; y: number; z: number } | null>(null);
  const [blockCount, setBlockCount] = useState(0);
  const [boxDimensions, setBoxDimensions] = useState<{ w: number; h: number; d: number } | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [moonPhase, setMoonPhase] = useState(0);
  const [timeOfDay, setTimeOfDay] = useState(0.25);

  // Poll selection status from engine
  useEffect(() => {
    if (!isOpen || !engine) return;

    const interval = setInterval(() => {
      const bounds = engine.selectionRenderer.getBounds();
      const a = engine.selectionRenderer.cornerA;
      const b = engine.selectionRenderer.cornerB;

      setCornerA(a ? { x: a.x, y: a.y, z: a.z } : null);
      setCornerB(b ? { x: b.x, y: b.y, z: b.z } : null);

      if (bounds) {
        setBoxDimensions({
          w: bounds.size.x,
          h: bounds.size.y,
          d: bounds.size.z,
        });

        // Count non-air blocks in volume
        let solidCount = 0;
        for (let x = bounds.min.x; x <= bounds.max.x; x++) {
          for (let y = bounds.min.y; y <= bounds.max.y; y++) {
            for (let z = bounds.min.z; z <= bounds.max.z; z++) {
              const v = engine.voxelWorld.getVoxel(x, y, z);
              if (v !== 0 && v !== 4) {
                // not AIR or BEDROCK
                solidCount++;
              }
            }
          }
        }
        setBlockCount(solidCount);
      } else {
        setBoxDimensions(null);
        setBlockCount(0);
      }

      if (envManager) {
        setMoonPhase(envManager.minecraftSky.currentMoonPhase);
        setTimeOfDay(envManager.minecraftSky.timeOfDay);
      }
    }, 150);

    return () => clearInterval(interval);
  }, [isOpen, engine, envManager]);

  const handleCreatePhysics = () => {
    if (!engine) return;
    const contraption = engine.assembleContraptionFromSelection();
    if (contraption) {
      setStatusMessage(`✨ Assembled ${contraption.blocks.length} blocks into 1 movable physics body!`);
      setTimeout(() => setStatusMessage(null), 4000);
    } else {
      setStatusMessage('⚠️ Select at least 1 non-air block inside the 3D bounding box!');
      setTimeout(() => setStatusMessage(null), 3000);
    }
  };

  const handleClearSelection = () => {
    if (!engine) return;
    engine.selectionRenderer.clear();
    setCornerA(null);
    setCornerB(null);
    setBlockCount(0);
    setBoxDimensions(null);
  };

  const handleSetTime = (t: number) => {
    if (!envManager) return;
    envManager.setTimeOfDay(t);
    setTimeOfDay(t);
  };

  const handleNextMoonPhase = () => {
    if (!envManager) return;
    envManager.nextMoonPhase();
    setMoonPhase(envManager.minecraftSky.currentMoonPhase);
  };

  if (!isOpen) return null;

  return (
    <div className="absolute top-16 left-4 z-40 pointer-events-auto select-none max-w-sm sm:max-w-md w-full">
      <div className="bg-slate-900/95 border-2 border-slate-700/80 rounded-xl shadow-2xl backdrop-blur-md overflow-hidden text-slate-100 p-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-cyan-600/30 border border-cyan-400/50 flex items-center justify-center text-cyan-300">
              <Wrench className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm tracking-wide text-white flex items-center gap-1.5">
                Physics Maker
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono border border-cyan-400/30">
                  Create/Aeronautics
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">Assemble voxels into articulated rigid bodies</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer text-xs"
          >
            ✕
          </button>
        </div>

        {/* Selection Status */}
        <div className="mt-3 bg-slate-950/70 rounded-lg p-3 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-cyan-400 font-medium">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
              Corner A:
            </span>
            <span className="font-mono text-slate-300 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
              {cornerA ? `(${cornerA.x}, ${cornerA.y}, ${cornerA.z})` : 'Touch/Click world to set'}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-amber-400 font-medium">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block shadow-[0_0_8px_rgba(245,158,11,0.8)]" />
              Corner B:
            </span>
            <span className="font-mono text-slate-300 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
              {cornerB ? `(${cornerB.x}, ${cornerB.y}, ${cornerB.z})` : 'Touch/Click world to set'}
            </span>
          </div>

          {boxDimensions && (
            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1 text-slate-300">
                <Box className="w-3.5 h-3.5 text-cyan-400" />
                Selected Volume:
              </span>
              <span className="font-bold text-white">
                <span className="text-cyan-300 font-mono">{blockCount}</span> blocks ({boxDimensions.w} × {boxDimensions.h} × {boxDimensions.d})
              </span>
            </div>
          )}
        </div>

        {/* Status notification */}
        {statusMessage && (
          <div className="mt-2 text-xs py-1.5 px-2.5 rounded bg-cyan-950/80 border border-cyan-500/40 text-cyan-200 animate-fade-in font-medium">
            {statusMessage}
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={handleCreatePhysics}
            disabled={blockCount === 0}
            className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg font-bold text-xs transition cursor-pointer shadow-lg ${
              blockCount > 0
                ? 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-cyan-900/40 active:scale-95'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
            }`}
          >
            <Zap className="w-4 h-4 text-yellow-300 fill-yellow-300" />
            Create Physics
          </button>

          <button
            onClick={handleClearSelection}
            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg font-medium text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer border border-slate-700/80 active:scale-95"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Clear Box
          </button>
        </div>

        {/* Joint Presets & Demonstration Shortcuts */}
        <div className="mt-3 pt-3 border-t border-slate-800">
          <div className="text-[11px] font-semibold text-slate-400 mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Link className="w-3.5 h-3.5 text-blue-400" />
              Articulated Joint Structures:
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1.5 text-xs">
            <button
              onClick={() => engine?.loadPreset('contraption')}
              className="py-1.5 px-2 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 transition cursor-pointer font-medium text-[11px]"
              title="Spawn ready-to-drive compound block contraption"
            >
              🚗 Contraption
            </button>
            <button
              onClick={() => engine?.loadPreset('articulated_arm')}
              className="py-1.5 px-2 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 transition cursor-pointer font-medium text-[11px]"
              title="Double-hinge articulated pendulum arm"
            >
              🦾 Hinge Arm
            </button>
            <button
              onClick={() => engine?.loadPreset('bridge')}
              className="py-1.5 px-2 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 transition cursor-pointer font-medium text-[11px]"
              title="Dynamic spring-linked suspension bridge"
            >
              🌉 Spring Bridge
            </button>
          </div>
        </div>

        {/* Minecraft Celestial & Atmosphere Controls */}
        <div className="mt-3 pt-3 border-t border-slate-800">
          <div className="text-[11px] font-semibold text-slate-400 mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              Minecraft Celestial Sky:
            </span>
            <span className="font-mono text-[10px] text-cyan-300">
              {MOON_PHASE_NAMES[moonPhase]} ({moonPhase + 1}/8)
            </span>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            <button
              onClick={() => handleSetTime(0.04)}
              className={`py-1 px-1.5 rounded flex items-center justify-center gap-1 text-[11px] font-medium border transition cursor-pointer ${
                Math.abs(timeOfDay - 0.04) < 0.08
                  ? 'bg-amber-600/30 border-amber-500 text-amber-200'
                  : 'bg-slate-800/70 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Sunrise className="w-3 h-3 text-amber-400" />
              Dawn
            </button>
            <button
              onClick={() => handleSetTime(0.25)}
              className={`py-1 px-1.5 rounded flex items-center justify-center gap-1 text-[11px] font-medium border transition cursor-pointer ${
                Math.abs(timeOfDay - 0.25) < 0.08
                  ? 'bg-blue-600/30 border-blue-500 text-blue-200'
                  : 'bg-slate-800/70 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Sun className="w-3 h-3 text-yellow-300" />
              Noon
            </button>
            <button
              onClick={() => handleSetTime(0.48)}
              className={`py-1 px-1.5 rounded flex items-center justify-center gap-1 text-[11px] font-medium border transition cursor-pointer ${
                Math.abs(timeOfDay - 0.48) < 0.08
                  ? 'bg-orange-600/30 border-orange-500 text-orange-200'
                  : 'bg-slate-800/70 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Sunset className="w-3 h-3 text-orange-400" />
              Sunset
            </button>
            <button
              onClick={() => handleSetTime(0.75)}
              className={`py-1 px-1.5 rounded flex items-center justify-center gap-1 text-[11px] font-medium border transition cursor-pointer ${
                Math.abs(timeOfDay - 0.75) < 0.08
                  ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200'
                  : 'bg-slate-800/70 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Moon className="w-3 h-3 text-indigo-300" />
              Night
            </button>
          </div>

          <div className="mt-2 flex items-center justify-between text-[11px]">
            <span className="text-slate-400">Moon Phase Cycle:</span>
            <button
              onClick={handleNextMoonPhase}
              className="py-1 px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 hover:text-white border border-slate-700 transition cursor-pointer flex items-center gap-1 text-xs"
            >
              Next Moon Phase ↻
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
