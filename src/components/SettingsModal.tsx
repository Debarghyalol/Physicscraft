import React, { useState } from 'react';
import { CameraViewMode, StructurePreset } from '../types/physics';
import { ResourcePacksScreen } from './ResourcePacksScreen';
import { SkyPreset } from '../rendering/EnvironmentManager';

export interface GraphicsSettings {
  shadows: boolean;
  viewportFrameMode: boolean;
  wireframe: boolean;
  fov: number;
  renderDistance: number;
  skyPreset: SkyPreset;
  debugMode: boolean;
}

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Graphics
  graphics: GraphicsSettings;
  onChangeGraphics: (newSettings: Partial<GraphicsSettings>) => void;
  // Controls
  viewMode: CameraViewMode;
  onToggleViewMode: () => void;
  sensitivity: number;
  onChangeSensitivity: (val: number) => void;
  invertPitch: boolean;
  onToggleInvertPitch: () => void;
  // Physics (Engine API preserved, removed from settings UI)
  currentPreset?: StructurePreset;
  onSelectPreset?: (preset: StructurePreset) => void;
  gravityMagnitude?: number;
  onChangeGravity?: (g: number) => void;
  timeScale?: number;
  onChangeTimeScale?: (scale: number) => void;
  onReset?: () => void;
  // Audio
  isMuted: boolean;
  onToggleMute: () => void;
  // World Session
  onLeaveWorld?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  graphics,
  onChangeGraphics,
  viewMode,
  onToggleViewMode,
  sensitivity,
  onChangeSensitivity,
  invertPitch,
  onToggleInvertPitch,
  isMuted,
  onToggleMute,
  onLeaveWorld,
}) => {
  const [subView, setSubView] = useState<'game_menu' | 'options' | 'resource_packs'>('game_menu');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center select-none font-mono text-white animate-in fade-in duration-100">
      {/* Dark Vignette Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-xs"
        onClick={() => {
          if (subView === 'resource_packs') {
            setSubView('options');
          } else if (subView === 'options') {
            setSubView('game_menu');
          } else {
            onClose();
          }
        }}
      />

      {/* VIEW 1: AUTHENTIC MINECRAFT JAVA "GAME MENU" */}
      {subView === 'game_menu' && (
        <div className="relative z-10 w-full max-w-sm px-4 py-8 flex flex-col items-center">
          {/* Header */}
          <h2 className="text-base sm:text-lg font-bold text-[#e0e0e0] drop-shadow-[2px_2px_0px_#181818] mb-6">
            Game Menu
          </h2>

          {/* Minecraft Java Button Column */}
          <div className="w-full flex flex-col items-center gap-2.5">
            {/* Back to Game */}
            <button
              onClick={onClose}
              className="mc-button w-full py-2.5 text-xs uppercase"
            >
              Back to Game
            </button>

            {/* Toggle Camera Perspective */}
            <button
              onClick={onToggleViewMode}
              className="mc-button w-full py-2.5 text-xs uppercase"
            >
              Camera: {viewMode === 'first_person' ? 'First Person' : viewMode === 'third_person' ? 'Third Person' : 'Front View'}
            </button>

            {/* Options... */}
            <button
              onClick={() => setSubView('options')}
              className="mc-button w-full py-2.5 text-xs uppercase"
            >
              Options...
            </button>

            {/* Save & Quit to Title / Leave World */}
            {onLeaveWorld && (
              <button
                onClick={() => {
                  onClose();
                  onLeaveWorld();
                }}
                className="mc-button w-full py-2.5 text-xs uppercase text-[#ffaaaa] hover:text-[#ffffaa]"
              >
                Save and Quit to Title
              </button>
            )}
          </div>
        </div>
      )}

      {/* VIEW 3: RESOURCE PACKS */}
      {subView === 'resource_packs' && <ResourcePacksScreen onDone={() => setSubView('options')} />}

      {/* VIEW 2: AUTHENTIC MINECRAFT JAVA "OPTIONS" */}
      {subView === 'options' && (
        <div className="relative z-10 w-full max-w-xl h-full max-h-[92vh] mc-dirt-bg border-4 border-black/75 shadow-2xl flex flex-col items-center justify-between overflow-hidden">
          {/* Header */}
          <div className="w-full py-4 text-center">
            <h2 className="text-base sm:text-lg font-bold text-[#e0e0e0] drop-shadow-[2px_2px_0px_#222222]">
              Options
            </h2>
          </div>

          {/* Options Grid (Authentic 2-Column Minecraft Settings) */}
          <div className="w-full flex-1 overflow-y-auto px-6 py-6 grid grid-cols-1 sm:grid-cols-2 gap-3.5 content-start">
            {/* FOV */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[#aaaaaa] drop-shadow-[1px_1px_0px_#000000]">
                Field of View: {graphics.fov} {graphics.fov === 75 ? '(Normal)' : graphics.fov >= 100 ? '(Quake Pro)' : ''}
              </label>
              <input
                type="range"
                min="50"
                max="110"
                step="1"
                value={graphics.fov}
                onChange={(e) => onChangeGraphics({ fov: Number(e.target.value) })}
                className="w-full accent-white cursor-pointer"
              />
            </div>

            {/* Render Distance */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[#aaaaaa] drop-shadow-[1px_1px_0px_#000000]">
                Render Distance: {graphics.renderDistance} chunks
              </label>
              <input
                type="range"
                min="2"
                max="35"
                step="1"
                value={graphics.renderDistance}
                onChange={(e) => onChangeGraphics({ renderDistance: Number(e.target.value) })}
                className="w-full accent-white cursor-pointer"
              />
            </div>

            {/* Graphics Preset */}
            <button
              type="button"
              onClick={() =>
                onChangeGraphics({
                  shadows: !graphics.shadows,
                })
              }
              className="mc-button py-2.5 text-xs"
            >
              Graphics: {graphics.shadows ? 'Fancy' : 'Fast'}
            </button>

            {/* Music & Sound Mute Toggle */}
            <button
              type="button"
              onClick={onToggleMute}
              className="mc-button py-2.5 text-xs"
            >
              Music & Sounds: {isMuted ? 'OFF' : 'ON'}
            </button>

            {/* Invert Mouse Pitch */}
            <button
              type="button"
              onClick={onToggleInvertPitch}
              className="mc-button py-2.5 text-xs"
            >
              Invert Mouse: {invertPitch ? 'ON' : 'OFF'}
            </button>

            {/* Wireframe */}
            <button
              type="button"
              onClick={() => onChangeGraphics({ wireframe: !graphics.wireframe })}
              className="mc-button py-2.5 text-xs"
            >
              Chunk Wireframe: {graphics.wireframe ? 'ON' : 'OFF'}
            </button>

            {/* Resource Packs (Minecraft Java resource pack import) */}
            <button
              type="button"
              onClick={() => setSubView('resource_packs')}
              className="mc-button py-2.5 text-xs"
            >
              Resource Packs...
            </button>

            <button
              type="button"
              onClick={() => onChangeGraphics({ debugMode: !graphics.debugMode })}
              className={`mc-button py-2.5 text-xs ${graphics.debugMode ? 'ring-2 ring-white/70' : ''}`}
            >
              Debug Mode: {graphics.debugMode ? 'ON' : 'OFF'}
            </button>

            {/* Mouse Look Sensitivity */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[#aaaaaa] drop-shadow-[1px_1px_0px_#000000]">
                Sensitivity: {Math.round((sensitivity / 0.0042) * 100)}%
              </label>
              <input
                type="range"
                min="0.001"
                max="0.008"
                step="0.0005"
                value={sensitivity}
                onChange={(e) => onChangeSensitivity(Number(e.target.value))}
                className="w-full accent-white cursor-pointer"
              />
            </div>
          </div>

          {/* Bottom Done Button */}
          <div className="w-full py-4 flex items-center justify-center">
            <button
              onClick={() => setSubView('game_menu')}
              className="mc-button w-48 py-2.5 text-xs uppercase"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
