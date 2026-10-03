import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Viewport3D } from './components/Viewport3D';
import { TopHeader } from './components/TopHeader';
import { SettingsModal, GraphicsSettings } from './components/SettingsModal';
import { MainMenuScreen, WorldSave } from './components/MainMenuScreen';
import { PhysicsEngine } from './physics/PhysicsEngine';
import { ActiveTool, BlockShape, BlockMaterial, StructurePreset, CameraViewMode } from './types/physics';
import { resourcePacks } from './resourcepack/ResourcePackManager';
import { soundManager } from './audio/SoundEffects';

export default function App() {
  // Load persisted resource packs once
  useEffect(() => {
    resourcePacks.init();
  }, []);

  // Game lifecycle state: 'menu' shows ONLY the Minecraft Main Menu; 'playing' runs the 3D world
  const [gameState, setGameState] = useState<'menu' | 'playing'>('menu');

  const [engine, setEngine] = useState<PhysicsEngine | null>(null);
  const [currentPreset, setCurrentPreset] = useState<StructurePreset>('empty');
  const [activeTool, setActiveTool] = useState<ActiveTool>('interact');
  const [selectedShape, setSelectedShape] = useState<BlockShape>('cube');
  const [selectedMaterial, setSelectedMaterial] = useState<BlockMaterial>('wood');

  // Active World state
  const [currentWorld, setCurrentWorld] = useState<WorldSave>({
    id: 'world-1',
    name: 'Infinite Wilderness',
    mode: 'Survival',
    seed: 133742,
    preset: 'empty',
    lastPlayed: 'Today',
  });

  // Settings State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // Graphics Settings (Shadows, Viewport frame mode, Wireframe, FOV, Sky)
  const [graphics, setGraphics] = useState<GraphicsSettings>({
    shadows: true,
    viewportFrameMode: false,
    wireframe: false,
    fov: 65,
    skyPreset: 'daylight',
  });

  // Controls Settings
  const [viewMode, setViewMode] = useState<CameraViewMode>('first_person');
  const [lookSensitivity, setLookSensitivity] = useState(0.0042);
  const [invertPitch, setInvertPitch] = useState(false);

  // Physics tuning state
  const [gravityMagnitude, setGravityMagnitude] = useState(9.81);
  const [timeScale, setTimeScale] = useState(1.0);

  // Real-time telemetry
  const [stats, setStats] = useState({ count: 0, fps: 60, stepTimeMs: 0 });

  const engineRef = useRef<PhysicsEngine | null>(null);
  engineRef.current = engine;

  // Handle engine ready (called when Viewport3D initializes)
  const handleEngineReady = useCallback(
    (readyEngine: PhysicsEngine) => {
      setEngine(readyEngine);
      readyEngine.setWorldSeed(currentWorld.seed);
      readyEngine.loadPreset(currentWorld.preset);
    },
    [currentWorld.seed, currentWorld.preset]
  );

  // Update telemetry
  const handleUpdateStats = useCallback(
    (newStats: { count: number; fps: number; stepTimeMs: number }) => {
      setStats(newStats);
    },
    []
  );

  // Start Playing World from Singleplayer Menu
  const handlePlayWorld = (world: WorldSave) => {
    setCurrentWorld(world);
    setCurrentPreset(world.preset);
    setGameState('playing');
    soundManager.playPop(true);
  };

  // Leave active world and return to main menu
  const handleLeaveWorld = () => {
    setIsSettingsOpen(false);
    setGameState('menu');
    setEngine(null);
    soundManager.playPop(false);
  };

  // Change preset
  const handleSelectPreset = (preset: StructurePreset) => {
    setCurrentPreset(preset);
    if (engine) {
      engine.loadPreset(preset);
      soundManager.playPop(true);
    }
  };

  // Reset current preset
  const handleReset = () => {
    if (engine) {
      engine.loadPreset(currentPreset);
      soundManager.playPop(false);
    }
  };

  // Toggle Mute
  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    soundManager.setMuted(nextMuted);
  };

  // Change Gravity
  const handleChangeGravity = (g: number) => {
    setGravityMagnitude(g);
    if (engine) {
      engine.baseGravityMagnitude = g;
      engine.setGravityVector(0, -g, 0);
    }
  };

  // Change Time scale
  const handleChangeTimeScale = (scale: number) => {
    setTimeScale(scale);
    if (engine) {
      engine.timeScale = scale;
    }
  };

  // Update Graphics Settings
  const handleChangeGraphics = (newSettings: Partial<GraphicsSettings>) => {
    setGraphics((prev) => ({ ...prev, ...newSettings }));
  };

  // Toggle View Mode (1st / 3rd person)
  const handleToggleViewMode = () => {
    const nextMode: CameraViewMode = viewMode === 'first_person' ? 'third_person' : 'first_person';
    setViewMode(nextMode);
    if (engine?.player) {
      engine.player.setViewMode(nextMode);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'r' || e.key === 'R') {
        if (gameState === 'playing') handleReset();
      }
      if (e.key === 'm' || e.key === 'M') handleToggleMute();
      if (e.key === 'Escape') {
        if (gameState === 'playing') {
          setIsSettingsOpen((prev) => !prev);
        } else if (isSettingsOpen) {
          setIsSettingsOpen(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [engine, currentPreset, isMuted, isSettingsOpen, gameState]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black font-sans select-none touch-none">
      {gameState === 'menu' ? (
        /* 1. AUTHENTIC FULL-SCREEN MINECRAFT MAIN MENU (Game does NOT run until world is opened) */
        <>
          <MainMenuScreen
            onPlayWorld={handlePlayWorld}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />

          {/* Settings Modal (when opened from Title Screen) */}
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            graphics={graphics}
            onChangeGraphics={handleChangeGraphics}
            viewMode={viewMode}
            onToggleViewMode={handleToggleViewMode}
            sensitivity={lookSensitivity}
            onChangeSensitivity={setLookSensitivity}
            invertPitch={invertPitch}
            onToggleInvertPitch={() => setInvertPitch(!invertPitch)}
            currentPreset={currentPreset}
            onSelectPreset={handleSelectPreset}
            gravityMagnitude={gravityMagnitude}
            onChangeGravity={handleChangeGravity}
            timeScale={timeScale}
            onChangeTimeScale={handleChangeTimeScale}
            onReset={handleReset}
            isMuted={isMuted}
            onToggleMute={handleToggleMute}
          />
        </>
      ) : (
        /* 2. ACTIVE 3D VOXEL WORLD (Started when world is selected) */
        <>
          {/* Top Options Bar (Clean, no floating menu button) */}
          <TopHeader
            onOpenSettings={() => setIsSettingsOpen(true)}
            fps={stats.fps}
            blockCount={stats.count}
            onReset={handleReset}
          />

          {/* 3D Physics Viewport with Rapier 3D + Voxel Streaming + Dynamic Shader Lighting */}
          <Viewport3D
            onEngineReady={handleEngineReady}
            activeTool={activeTool}
            selectedShape={selectedShape}
            selectedMaterial={selectedMaterial}
            currentPreset={currentPreset}
            graphics={graphics}
            viewMode={viewMode}
            onToggleViewMode={handleToggleViewMode}
            lookSensitivity={lookSensitivity}
            invertPitch={invertPitch}
            onUpdateStats={handleUpdateStats}
          />

          {/* Settings Modal with LEAVE WORLD button to exit back to Main Menu */}
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            onLeaveWorld={handleLeaveWorld}
            graphics={graphics}
            onChangeGraphics={handleChangeGraphics}
            viewMode={viewMode}
            onToggleViewMode={handleToggleViewMode}
            sensitivity={lookSensitivity}
            onChangeSensitivity={setLookSensitivity}
            invertPitch={invertPitch}
            onToggleInvertPitch={() => setInvertPitch(!invertPitch)}
            currentPreset={currentPreset}
            onSelectPreset={handleSelectPreset}
            gravityMagnitude={gravityMagnitude}
            onChangeGravity={handleChangeGravity}
            timeScale={timeScale}
            onChangeTimeScale={handleChangeTimeScale}
            onReset={handleReset}
            isMuted={isMuted}
            onToggleMute={handleToggleMute}
          />
        </>
      )}
    </div>
  );
}
