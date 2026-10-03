import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { PhysicsEngine } from '../physics/PhysicsEngine';
import {
  ActiveTool,
  BlockShape,
  BlockMaterial,
  StructurePreset,
  CameraViewMode,
  VoxelType,
} from '../types/physics';
import { EnvironmentManager } from '../rendering/EnvironmentManager';
import { PlayerControlsOverlay } from './PlayerControlsOverlay';
import { PlayerInput } from '../player/PlayerController';
import { GraphicsSettings } from './SettingsModal';
import { resourcePacks } from '../resourcepack/ResourcePackManager';
import { ViewportFrameOverlay } from './ViewportFrameOverlay';

interface Viewport3DProps {
  onEngineReady: (engine: PhysicsEngine) => void;
  activeTool: ActiveTool;
  selectedShape: BlockShape;
  selectedMaterial: BlockMaterial;
  currentPreset: StructurePreset;
  graphics: GraphicsSettings;
  viewMode: CameraViewMode;
  onToggleViewMode: () => void;
  lookSensitivity: number;
  invertPitch: boolean;
  onUpdateStats: (stats: { count: number; fps: number; stepTimeMs: number }) => void;
}

export const Viewport3D: React.FC<Viewport3DProps> = ({
  onEngineReady,
  graphics,
  viewMode,
  onToggleViewMode,
  lookSensitivity,
  invertPitch,
  onUpdateStats,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<PhysicsEngine | null>(null);
  const envManagerRef = useRef<EnvironmentManager | null>(null);

  // Camera & Player State (Starts in FIRST PERSON as requested)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const [selectedVoxel, setSelectedVoxel] = useState<VoxelType>(VoxelType.STONE);
  const [currentFps, setCurrentFps] = useState(60);
  const [isFlying, setIsFlying] = useState(false);
  const lastPresetRef = useRef<string | null>(null);

  // Player Input Ref for continuous 60fps simulation
  const playerInputRef = useRef<PlayerInput>({
    moveForward: 0,
    moveRight: 0,
    jump: false,
    sprint: false,
  });

  // Sync Graphics Settings
  useEffect(() => {
    if (envManagerRef.current) {
      envManagerRef.current.setShadowsEnabled(graphics.shadows);
      // Only apply the preset when it actually changes (so other settings don't reset the clock)
      if (lastPresetRef.current !== graphics.skyPreset) {
        lastPresetRef.current = graphics.skyPreset;
        envManagerRef.current.setPreset(graphics.skyPreset);
      }
    }
    if (engineRef.current?.voxelWorld) {
      engineRef.current.voxelWorld.setWireframe(graphics.wireframe);
    }
    if (cameraRef.current) {
      cameraRef.current.fov = graphics.fov;
      cameraRef.current.updateProjectionMatrix();
    }
  }, [graphics]);

  // Sync Camera View Mode
  useEffect(() => {
    if (engineRef.current?.player) {
      engineRef.current.player.setViewMode(viewMode);
    }
  }, [viewMode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Three.js Scene & Camera setup
    const scene = new THREE.Scene();
    const aspect = container.clientWidth / container.clientHeight;
    const camera = new THREE.PerspectiveCamera(graphics.fov, aspect, 0.1, 400);
    cameraRef.current = camera;

    // 2. WebGL Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = graphics.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(renderer.domElement);

    // 3. Procedural Sky & Lighting
    const envManager = new EnvironmentManager(scene, renderer);
    envManagerRef.current = envManager;
    lastPresetRef.current = graphics.skyPreset;
    envManager.setPreset(graphics.skyPreset);
    envManager.setShadowsEnabled(graphics.shadows);

    // 4. Initialize Physics Engine (Rapier 3D + Minecraft VoxelWorld + Steve + SoftBodies)
    const engine = new PhysicsEngine(scene, camera);
    engineRef.current = engine;

    let isDisposed = false;
    let unsubscribePacks: (() => void) | null = null;
    engine.initialize().then(() => {
      if (isDisposed) return;
      onEngineReady(engine);
      // Clean Minecraft world by default: no clutter physics objects
      engine.loadPreset('empty');
      if (engine.player) {
        engine.player.setViewMode('first_person');
        engine.player.onFlyingChange = setIsFlying;
      }

      // Resource packs: apply now and whenever the selection changes
      const applyPacks = () => {
        engine.voxelWorld.applyResourcePack();
        envManager.minecraftSky.applyResourcePack();
        engine.player?.model.applyResourcePack();
      };
      applyPacks();
      unsubscribePacks = resourcePacks.subscribe(applyPacks);
    });

    // 5. Animation & Simulation Loop
    let animationFrameId: number;
    let lastTime = performance.now();
    let frameCount = 0;
    let fpsTimer = performance.now();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      const now = performance.now();
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      // Telemetry FPS calculation
      frameCount++;
      if (now - fpsTimer >= 500) {
        const computedFps = Math.round((frameCount * 1000) / (now - fpsTimer));
        frameCount = 0;
        fpsTimer = now;
        setCurrentFps(computedFps);

        onUpdateStats({
          count: engine.getBlockCount(),
          fps: computedFps,
          stepTimeMs: Math.round(delta * 1000),
        });
      }

      // Step physics with player input
      engine.step(Math.min(delta, 0.05), playerInputRef.current);

      // Dynamic Shader-Based Lighting:
      // Updates underground vs surface light transition and cave atmosphere
      if (engine.voxelWorld && engine.player) {
        const playerPos = engine.player.getPosition();
        const isUnderground = engine.voxelWorld.updateLighting(playerPos, delta);
        envManager.setUndergroundLighting(isUnderground);

        // Day/night cycle: sun, moon, stars, clouds, sky colour and world light tint
        envManager.update(delta, playerPos);
        const tint = envManager.getWorldTint();
        engine.voxelWorld.setLightTint(tint);
        engine.player.model.setLightTint(tint);
      }

      // Render Three.js scene
      renderer.render(scene, camera);
    };

    animate();

    // 6. Resize handling
    const handleResize = () => {
      if (!container) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      isDisposed = true;
      unsubscribePacks?.();
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      envManager.dispose();
      engine.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [onEngineReady, onUpdateStats]);

  // Handle Input from Joystick / Keyboard
  const handleInputUpdate = useCallback((input: PlayerInput) => {
    playerInputRef.current = input;
  }, []);

  // Handle Look Delta from mouse or touch
  const handleLookDelta = useCallback(
    (deltaYaw: number, deltaPitch: number) => {
      if (engineRef.current?.player) {
        const pitchMultiplier = invertPitch ? -1 : 1;
        engineRef.current.player.addLookInput(
          deltaYaw * (lookSensitivity / 0.0042),
          deltaPitch * (lookSensitivity / 0.0042) * pitchMultiplier
        );
      }
    },
    [invertPitch, lookSensitivity]
  );

  // Action: Mine target block (accepts exact screen touch coordinates!)
  const handleActionMine = useCallback((coords?: { x: number; y: number }) => {
    if (engineRef.current?.player) {
      engineRef.current.player.breakTargetedBlock(coords);
    }
  }, []);

  // Action: Place block (accepts exact screen touch coordinates!)
  const handleActionPlace = useCallback(
    (coords?: { x: number; y: number }) => {
      if (engineRef.current?.player) {
        engineRef.current.player.selectedVoxel = selectedVoxel;
        engineRef.current.player.placeBlock(coords);
      }
    },
    [selectedVoxel]
  );

  // Action: Select Voxel
  const handleSelectVoxel = useCallback((v: VoxelType) => {
    setSelectedVoxel(v);
    if (engineRef.current?.player) {
      engineRef.current.player.selectedVoxel = v;
    }
  }, []);

  // Update touch aim coordinates on player
  const handleAimTouchCoords = useCallback((coords: { x: number; y: number } | null) => {
    if (engineRef.current?.player) {
      engineRef.current.player.setAimTouchCoords(coords);
    }
  }, []);

  // Mouse click handler on PC (pointer lock + Left/Right click)
  const handleMouseDown = (e: React.MouseEvent) => {
    const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isMobile) return;

    if (document.pointerLockElement === null) {
      containerRef.current?.requestPointerLock();
      return;
    }

    if (e.button === 0) {
      // Left Click: Mine at screen coords (or center aim if locked)
      handleActionMine({ x: e.clientX, y: e.clientY });
    } else if (e.button === 2) {
      // Right Click: Place Block at screen coords (or center aim if locked)
      e.preventDefault();
      handleActionPlace({ x: e.clientX, y: e.clientY });
    }
  };

  return (
    <div
      className="relative w-full h-full overflow-hidden select-none touch-none"
      onContextMenu={(e) => e.preventDefault()}
      onMouseDown={handleMouseDown}
    >
      {/* 3D WebGL Canvas */}
      <div ref={containerRef} className="w-full h-full cursor-crosshair" />

      {/* Cinematic Viewport Frame Mode Overlay (Brackets + HUD) */}
      <ViewportFrameOverlay enabled={graphics.viewportFrameMode} fps={currentFps} />

      {/* MCPE Touch Controls Overlay (Direct touch coordinate mining & placing) */}
      <PlayerControlsOverlay
        onInputUpdate={handleInputUpdate}
        onLookDelta={handleLookDelta}
        onAimTouchCoords={handleAimTouchCoords}
        onActionMine={handleActionMine}
        onActionPlace={handleActionPlace}
        onToggleViewMode={onToggleViewMode}
        isFlying={isFlying}
        viewMode={viewMode}
        selectedVoxel={selectedVoxel}
        onSelectVoxel={handleSelectVoxel}
      />
    </div>
  );
};
