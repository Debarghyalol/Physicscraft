import React, { useState, useEffect } from 'react';
import {
  X,
  Monitor,
  Gamepad2,
  Atom,
  Volume2,
  VolumeX,
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  LogOut,
} from 'lucide-react';
import { StructurePreset, CameraViewMode } from '../types/physics';
import { SkyPreset } from '../rendering/EnvironmentManager';
import { radioService, RadioStation } from '../audio/RadioService';

export interface GraphicsSettings {
  shadows: boolean;
  viewportFrameMode: boolean;
  wireframe: boolean;
  fov: number;
  skyPreset: SkyPreset;
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
  // Physics
  currentPreset: StructurePreset;
  onSelectPreset: (preset: StructurePreset) => void;
  gravityMagnitude: number;
  onChangeGravity: (g: number) => void;
  timeScale: number;
  onChangeTimeScale: (scale: number) => void;
  onReset: () => void;
  // Audio
  isMuted: boolean;
  onToggleMute: () => void;
  // World Session
  onLeaveWorld?: () => void;
}

type SettingsTab = 'graphics' | 'controls' | 'physics' | 'audio';

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
  currentPreset,
  onSelectPreset,
  gravityMagnitude,
  onChangeGravity,
  timeScale,
  onChangeTimeScale,
  onReset,
  isMuted,
  onToggleMute,
  onLeaveWorld,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('graphics');

  // Live Radio State
  const [isPlayingRadio, setIsPlayingRadio] = useState(radioService.getIsPlaying());
  const [isLoadingRadio, setIsLoadingRadio] = useState(radioService.getIsLoading());
  const [currentStation, setCurrentStation] = useState(radioService.getCurrentStation());
  const [radioVolume, setRadioVolume] = useState(radioService.getVolume());
  const [stations, setStations] = useState<RadioStation[]>(radioService.getStations());

  useEffect(() => {
    return radioService.subscribe(() => {
      setIsPlayingRadio(radioService.getIsPlaying());
      setIsLoadingRadio(radioService.getIsLoading());
      setCurrentStation(radioService.getCurrentStation());
      setStations(radioService.getStations());
    });
  }, []);

  if (!isOpen) return null;

  const presets: { id: StructurePreset; label: string }[] = [
    { id: 'jenga', label: 'Jenga' },
    { id: 'softbody', label: 'Squishy Jelly' },
    { id: 'castle', label: 'Castle' },
    { id: 'dominoes', label: 'Dominoes' },
    { id: 'pyramid', label: 'Pyramid' },
    { id: 'cradle', label: 'Demolition' },
    { id: 'empty', label: 'Sandbox' },
  ];

  const skyPresets: { id: SkyPreset; label: string }[] = [
    { id: 'daylight', label: 'Daylight' },
    { id: 'sunset', label: 'Sunset' },
    { id: 'dawn', label: 'Dawn' },
    { id: 'studio', label: 'Studio' },
    { id: 'twilight', label: 'Twilight' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl bg-black/90 backdrop-blur-2xl border border-white/20 rounded-2xl shadow-2xl flex flex-col max-h-[88vh] overflow-hidden text-white font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Header (Pure B&W) */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-white rounded-xs" />
            <h2 className="text-sm font-mono uppercase tracking-widest text-white font-bold">
              Settings
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation (Monochrome Black & White) */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-white/10 overflow-x-auto scrollbar-none bg-black/40">
          <button
            onClick={() => setActiveTab('graphics')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium uppercase tracking-wider transition ${
              activeTab === 'graphics'
                ? 'bg-white text-black font-semibold shadow-sm'
                : 'text-neutral-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>Graphics</span>
          </button>

          <button
            onClick={() => setActiveTab('controls')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium uppercase tracking-wider transition ${
              activeTab === 'controls'
                ? 'bg-white text-black font-semibold shadow-sm'
                : 'text-neutral-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Gamepad2 className="w-3.5 h-3.5" />
            <span>Controls</span>
          </button>

          <button
            onClick={() => setActiveTab('physics')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium uppercase tracking-wider transition ${
              activeTab === 'physics'
                ? 'bg-white text-black font-semibold shadow-sm'
                : 'text-neutral-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Atom className="w-3.5 h-3.5" />
            <span>Physics</span>
          </button>

          <button
            onClick={() => setActiveTab('audio')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium uppercase tracking-wider transition ${
              activeTab === 'audio'
                ? 'bg-white text-black font-semibold shadow-sm'
                : 'text-neutral-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Volume2 className="w-3.5 h-3.5" />
            <span>Audio & Radio</span>
          </button>
        </div>

        {/* Tab Contents */}
        <div className="p-5 overflow-y-auto space-y-6 flex-1 scrollbar-thin">
          {/* TAB 1: GRAPHICS */}
          {activeTab === 'graphics' && (
            <div className="space-y-5">
              {/* Shadows Toggle */}
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-neutral-900/60 border border-white/10">
                <div>
                  <div className="text-sm font-semibold text-white">Dynamic Shadows</div>
                  <div className="text-xs text-neutral-400 mt-0.5">
                    Toggle sunlight shadows on terrain and blocks
                  </div>
                </div>
                <button
                  onClick={() => onChangeGraphics({ shadows: !graphics.shadows })}
                  className={`w-12 h-6 rounded-full transition-colors relative flex items-center p-0.5 ${
                    graphics.shadows ? 'bg-white' : 'bg-neutral-800 border border-white/20'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full transition-transform ${
                      graphics.shadows
                        ? 'translate-x-6 bg-black shadow-md'
                        : 'translate-x-0 bg-neutral-400'
                    }`}
                  />
                </button>
              </div>

              {/* Viewport Frame Mode */}
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-neutral-900/60 border border-white/10">
                <div>
                  <div className="text-sm font-semibold text-white">Viewport Frame Mode</div>
                  <div className="text-xs text-neutral-400 mt-0.5">
                    Display aesthetic camera framing brackets & letterbox border
                  </div>
                </div>
                <button
                  onClick={() =>
                    onChangeGraphics({ viewportFrameMode: !graphics.viewportFrameMode })
                  }
                  className={`w-12 h-6 rounded-full transition-colors relative flex items-center p-0.5 ${
                    graphics.viewportFrameMode
                      ? 'bg-white'
                      : 'bg-neutral-800 border border-white/20'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full transition-transform ${
                      graphics.viewportFrameMode
                        ? 'translate-x-6 bg-black shadow-md'
                        : 'translate-x-0 bg-neutral-400'
                    }`}
                  />
                </button>
              </div>

              {/* Wireframe Terrain Mode */}
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-neutral-900/60 border border-white/10">
                <div>
                  <div className="text-sm font-semibold text-white">Wireframe Terrain</div>
                  <div className="text-xs text-neutral-400 mt-0.5">
                    Render voxel chunk surfaces in wireframe lines
                  </div>
                </div>
                <button
                  onClick={() => onChangeGraphics({ wireframe: !graphics.wireframe })}
                  className={`w-12 h-6 rounded-full transition-colors relative flex items-center p-0.5 ${
                    graphics.wireframe ? 'bg-white' : 'bg-neutral-800 border border-white/20'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full transition-transform ${
                      graphics.wireframe
                        ? 'translate-x-6 bg-black shadow-md'
                        : 'translate-x-0 bg-neutral-400'
                    }`}
                  />
                </button>
              </div>

              {/* Field of View Slider */}
              <div className="p-3.5 rounded-xl bg-neutral-900/60 border border-white/10 space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="font-semibold text-white">Field of View (FOV)</span>
                  <span className="font-mono text-neutral-300">{graphics.fov}°</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="90"
                  step="1"
                  value={graphics.fov}
                  onChange={(e) => onChangeGraphics({ fov: Number(e.target.value) })}
                  className="w-full accent-white cursor-pointer"
                />
              </div>

              {/* Sky Atmosphere Presets */}
              <div className="space-y-2">
                <label className="text-xs font-mono uppercase tracking-wider text-neutral-400">
                  Time of Day & Atmosphere
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {skyPresets.map((sp) => (
                    <button
                      key={sp.id}
                      onClick={() => onChangeGraphics({ skyPreset: sp.id })}
                      className={`px-3 py-2 rounded-xl text-xs font-medium border transition ${
                        graphics.skyPreset === sp.id
                          ? 'bg-white text-black border-white font-semibold'
                          : 'bg-neutral-900/80 text-neutral-300 border-white/10 hover:border-white/30 hover:bg-neutral-800'
                      }`}
                    >
                      {sp.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CONTROLS & CAMERA */}
          {activeTab === 'controls' && (
            <div className="space-y-5">
              {/* Camera Perspective */}
              <div className="p-3.5 rounded-xl bg-neutral-900/60 border border-white/10 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-white">Camera Perspective</div>
                  <div className="text-xs text-neutral-400 mt-0.5">Toggle 1st / 3rd Person View (F5)</div>
                </div>
                <div className="flex items-center gap-1 bg-black p-1 rounded-lg border border-white/15">
                  <button
                    onClick={viewMode === 'third_person' ? onToggleViewMode : undefined}
                    className={`px-3 py-1 text-xs rounded font-medium transition ${
                      viewMode === 'first_person'
                        ? 'bg-white text-black font-semibold'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    1st Person
                  </button>
                  <button
                    onClick={viewMode === 'first_person' ? onToggleViewMode : undefined}
                    className={`px-3 py-1 text-xs rounded font-medium transition ${
                      viewMode === 'third_person'
                        ? 'bg-white text-black font-semibold'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    3rd Person
                  </button>
                </div>
              </div>

              {/* Look Sensitivity */}
              <div className="p-3.5 rounded-xl bg-neutral-900/60 border border-white/10 space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="font-semibold text-white">Look Sensitivity</span>
                  <span className="font-mono text-neutral-300">
                    {(sensitivity * 1000).toFixed(1)}x
                  </span>
                </div>
                <input
                  type="range"
                  min="0.002"
                  max="0.010"
                  step="0.0005"
                  value={sensitivity}
                  onChange={(e) => onChangeSensitivity(Number(e.target.value))}
                  className="w-full accent-white cursor-pointer"
                />
              </div>

              {/* Invert Pitch */}
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-neutral-900/60 border border-white/10">
                <div>
                  <div className="text-sm font-semibold text-white">Invert Y-Axis Pitch</div>
                  <div className="text-xs text-neutral-400 mt-0.5">Invert vertical look rotation</div>
                </div>
                <button
                  onClick={onToggleInvertPitch}
                  className={`w-12 h-6 rounded-full transition-colors relative flex items-center p-0.5 ${
                    invertPitch ? 'bg-white' : 'bg-neutral-800 border border-white/20'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full transition-transform ${
                      invertPitch ? 'translate-x-6 bg-black shadow-md' : 'translate-x-0 bg-neutral-400'
                    }`}
                  />
                </button>
              </div>

              {/* Controls Cheatsheet */}
              <div className="p-4 rounded-xl bg-neutral-900/40 border border-white/10 space-y-2 text-xs">
                <div className="font-mono uppercase text-neutral-400 font-semibold mb-2">
                  Controls Guide
                </div>
                <div className="grid grid-cols-2 gap-2 text-neutral-300 font-mono">
                  <div>
                    <span className="text-white font-bold">Touch Swipe:</span> Rotate camera
                  </div>
                  <div>
                    <span className="text-white font-bold">Touch Tap:</span> Place voxel
                  </div>
                  <div>
                    <span className="text-white font-bold">Touch Hold:</span> Mine voxel
                  </div>
                  <div>
                    <span className="text-white font-bold">Joystick:</span> Walk/Move
                  </div>
                  <div>
                    <span className="text-white font-bold">WASD:</span> Move on PC
                  </div>
                  <div>
                    <span className="text-white font-bold">Right Click:</span> Place voxel
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: PHYSICS & PRESETS */}
          {activeTab === 'physics' && (
            <div className="space-y-5">
              {/* Presets Grid */}
              <div className="space-y-2">
                <label className="text-xs font-mono uppercase tracking-wider text-neutral-400">
                  Structure Presets
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {presets.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => onSelectPreset(p.id)}
                      className={`px-3 py-2.5 rounded-xl text-xs font-medium border transition ${
                        currentPreset === p.id
                          ? 'bg-white text-black border-white font-semibold shadow-sm'
                          : 'bg-neutral-900/80 text-neutral-300 border-white/10 hover:border-white/30 hover:bg-neutral-800'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Gravity Magnitude */}
              <div className="p-3.5 rounded-xl bg-neutral-900/60 border border-white/10 space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="font-semibold text-white">Gravity Strength</span>
                  <span className="font-mono text-neutral-300">{gravityMagnitude.toFixed(1)} m/s²</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="25"
                  step="0.5"
                  value={gravityMagnitude}
                  onChange={(e) => onChangeGravity(Number(e.target.value))}
                  className="w-full accent-white cursor-pointer"
                />
              </div>

              {/* Simulation Time Scale */}
              <div className="p-3.5 rounded-xl bg-neutral-900/60 border border-white/10 space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="font-semibold text-white">Simulation Speed</span>
                  <span className="font-mono text-neutral-300">{timeScale.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="2.0"
                  step="0.05"
                  value={timeScale}
                  onChange={(e) => onChangeTimeScale(Number(e.target.value))}
                  className="w-full accent-white cursor-pointer"
                />
              </div>

              {/* Reset World */}
              <div className="pt-2">
                <button
                  onClick={() => {
                    onReset();
                    onClose();
                  }}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-white text-black font-semibold rounded-xl hover:bg-neutral-200 transition text-xs uppercase tracking-wider"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Reset Physics Simulation</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: AUDIO & RADIO */}
          {activeTab === 'audio' && (
            <div className="space-y-5">
              {/* Sound FX Mute Toggle */}
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-neutral-900/60 border border-white/10">
                <div className="flex items-center gap-3">
                  {isMuted ? (
                    <VolumeX className="w-5 h-5 text-neutral-400" />
                  ) : (
                    <Volume2 className="w-5 h-5 text-white" />
                  )}
                  <div>
                    <div className="text-sm font-semibold text-white">Collision & Block Sound FX</div>
                    <div className="text-xs text-neutral-400">Tactile impact and footstep audio</div>
                  </div>
                </div>
                <button
                  onClick={onToggleMute}
                  className={`w-12 h-6 rounded-full transition-colors relative flex items-center p-0.5 ${
                    !isMuted ? 'bg-white' : 'bg-neutral-800 border border-white/20'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full transition-transform ${
                      !isMuted ? 'translate-x-6 bg-black shadow-md' : 'translate-x-0 bg-neutral-400'
                    }`}
                  />
                </button>
              </div>

              {/* Live Radio Player Section */}
              <div className="p-4 rounded-xl bg-neutral-900/60 border border-white/10 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isPlayingRadio ? 'bg-white animate-pulse' : 'bg-neutral-600'
                      }`}
                    />
                    <span className="text-xs font-mono uppercase tracking-wider text-neutral-400">
                      Live Radio Stream
                    </span>
                  </div>
                  <span className="text-xs font-mono text-neutral-400">
                    {isLoadingRadio ? 'Buffering...' : isPlayingRadio ? 'Streaming' : 'Paused'}
                  </span>
                </div>

                <div className="text-base font-semibold text-white truncate">
                  {currentStation?.name || 'SomaFM: Groove Salad'}
                </div>

                {/* Radio Player Controls (Pure B&W) */}
                <div className="flex items-center justify-center gap-3 py-1">
                  <button
                    onClick={() => radioService.prevStation()}
                    className="p-2.5 rounded-full bg-neutral-800 text-white hover:bg-neutral-700 transition"
                    title="Previous Station"
                  >
                    <SkipForward className="w-4 h-4 rotate-180" />
                  </button>

                  <button
                    onClick={() => radioService.togglePlay()}
                    className="w-12 h-12 rounded-full bg-white text-black flex items-center justify-center hover:bg-neutral-200 transition shadow-lg"
                    title={isPlayingRadio ? 'Pause Radio' : 'Play Radio'}
                  >
                    {isPlayingRadio ? (
                      <Pause className="w-5 h-5 text-black" />
                    ) : (
                      <Play className="w-5 h-5 text-black ml-0.5" />
                    )}
                  </button>

                  <button
                    onClick={() => radioService.nextStation()}
                    className="p-2.5 rounded-full bg-neutral-800 text-white hover:bg-neutral-700 transition"
                    title="Next Station"
                  >
                    <SkipForward className="w-4 h-4" />
                  </button>
                </div>

                {/* Volume slider */}
                <div className="space-y-1.5 pt-2">
                  <div className="flex justify-between items-center text-xs text-neutral-400 font-mono">
                    <span>Radio Volume</span>
                    <span>{Math.round(radioVolume * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.02"
                    value={radioVolume}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setRadioVolume(v);
                      radioService.setVolume(v);
                    }}
                    className="w-full accent-white cursor-pointer"
                  />
                </div>

                {/* Curated Station List */}
                <div className="space-y-1.5 pt-2">
                  <span className="text-[11px] font-mono uppercase text-neutral-400">
                    Stations
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-36 overflow-y-auto scrollbar-thin">
                    {stations.slice(0, 8).map((st) => (
                      <button
                        key={st.stationuuid}
                        onClick={() => radioService.playStation(st)}
                        className={`text-left px-3 py-2 rounded-lg text-xs truncate transition border ${
                          currentStation?.stationuuid === st.stationuuid
                            ? 'bg-white text-black border-white font-semibold'
                            : 'bg-neutral-800/60 text-neutral-300 border-white/5 hover:bg-neutral-700'
                        }`}
                      >
                        {st.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Bottom Action Bar (Leave World & Done) */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-white/10 bg-black/60">
          {onLeaveWorld && (
            <button
              onClick={() => {
                onClose();
                onLeaveWorld();
              }}
              className="px-4 py-2 bg-red-950/60 hover:bg-red-900/80 text-red-200 hover:text-white border border-red-500/30 hover:border-red-400 rounded-xl font-mono text-xs uppercase tracking-wider flex items-center gap-2 transition active:scale-95 shadow-md"
              title="Save & Quit to Title Screen"
            >
              <LogOut className="w-3.5 h-3.5 text-red-300" />
              <span>Leave World (Save & Quit)</span>
            </button>
          )}

          <button
            onClick={onClose}
            className="ml-auto px-5 py-2 bg-white text-black font-semibold rounded-xl hover:bg-neutral-200 transition font-mono text-xs uppercase tracking-wider shadow-md active:scale-95"
          >
            Resume / Done (ESC)
          </button>
        </div>
      </div>
    </div>
  );
};
