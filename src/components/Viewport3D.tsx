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
import { InventoryOverlay } from './InventoryOverlay';
import { MusicDiscId } from '../audio/MusicEngine';
import { PlayerInput } from '../player/PlayerController';
import { GraphicsSettings } from './SettingsModal';
import { resourcePacks } from '../resourcepack/ResourcePackManager';
import { ViewportFrameOverlay } from './ViewportFrameOverlay';
import { DebugOverlay, DebugFrameSample } from './DebugOverlay';
import { shaderPacks } from '../shaderpack/ShaderPackManager';
import { ShaderPackRuntime } from '../shaderpack/ShaderPackRuntime';
import { ShaderFinalPass } from '../shaderpack/ShaderFinalPass';
import { ShaderGBufferPass } from '../shaderpack/ShaderGBufferPass';
import { ShaderFullscreenPass } from '../shaderpack/ShaderFullscreenPass';

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
  const [selectedDisc, setSelectedDisc] = useState<MusicDiscId>('13');
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [currentFps, setCurrentFps] = useState(60);
  const fpsRef = useRef(60);
  const [isFlying, setIsFlying] = useState(false);
  const [shaderDiagnostics, setShaderDiagnostics] = useState<string[]>([]);
  const lastPresetRef = useRef<string | null>(null);
  const [debugSample, setDebugSample] = useState<DebugFrameSample>({
    frameMs: 0, physicsMs: 0, renderMs: 0, streamingMs: 0, generationMs: 0,
    chunks: 0, meshes: 0, drawCalls: 0, triangles: 0, geometries: 0, textures: 0, jsHeapMb: null, playerPos: null,
  });
  const debugHistoryRef = useRef<DebugFrameSample[]>([]);
  const graphicsRef = useRef(graphics);
  graphicsRef.current = graphics;

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
      envManagerRef.current.updateDistanceFog(graphics.renderDistance);
      // Only apply the preset when it actually changes (so other settings don't reset the clock)
      if (lastPresetRef.current !== graphics.skyPreset) {
        lastPresetRef.current = graphics.skyPreset;
        envManagerRef.current.setPreset(graphics.skyPreset);
      }
    }
    if (engineRef.current?.voxelWorld) {
      engineRef.current.voxelWorld.setWireframe(graphics.wireframe);
      engineRef.current.voxelWorld.setRenderDistance(graphics.renderDistance);
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
    const shaderRuntime = new ShaderPackRuntime(renderer, { debug: graphicsRef.current.debugMode });
    const shaderFinalPass = new ShaderFinalPass(renderer, shaderRuntime);
    const shaderGBufferPass = new ShaderGBufferPass(renderer, shaderRuntime);
    const shaderFullscreenPass = new ShaderFullscreenPass(renderer, shaderRuntime, shaderGBufferPass.framebufferManager);
    const pixelRatio = Math.min(window.devicePixelRatio, 1.75);
    renderer.setPixelRatio(pixelRatio);

    // Keep the canvas's CSS box and its WebGL drawing buffer in sync. On
    // mobile browsers the canvas can otherwise be displayed larger than the
    // drawing buffer, leaving the shader viewport anchored to the
    // bottom-left and exposing the page/clear color around it.
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';

    const resizeRenderer = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      const drawingBuffer = renderer.getDrawingBufferSize(new THREE.Vector2());
      shaderGBufferPass.resize(drawingBuffer.x, drawingBuffer.y);
      shaderFinalPass.resize(drawingBuffer.x, drawingBuffer.y);
    };

    resizeRenderer();
    renderer.shadowMap.enabled = graphics.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(renderer.domElement);

    // 3. Procedural Sky & Lighting
    const envManager = new EnvironmentManager(scene, renderer);
    envManagerRef.current = envManager;
    lastPresetRef.current = graphics.skyPreset;
    envManager.setPreset(graphics.skyPreset);
    envManager.setShadowsEnabled(graphics.shadows);
    envManager.updateDistanceFog(graphics.renderDistance);

    // 4. Initialize Physics Engine (Rapier 3D + Minecraft VoxelWorld + Steve + SoftBodies)
    const engine = new PhysicsEngine(scene, camera);
    engineRef.current = engine;

    let isDisposed = false;
    const steveLight = new THREE.Color();

    // Shader-pack runtime: compile/link the imported pack and execute the
    // real final fullscreen pass when the pack provides one. The scene itself
    // is rendered into colortex0 first.
    let shaderLoadGeneration = 0;
    const reloadShaderRuntime = async () => {
      const generation = ++shaderLoadGeneration;

      // Shader packs live in IndexedDB. Wait for the manager to finish loading
      // persisted packs before checking the active selection; otherwise the
      // viewport can race init() and incorrectly fall back to vanilla.
      await shaderPacks.init();
      if (generation !== shaderLoadGeneration || isDisposed) return;

      const active = shaderPacks.getActive();
      if (!active) {
        shaderRuntime.dispose();
        setShaderDiagnostics([]);
        console.info('[ShaderPipeline] No shader pack active; using vanilla renderer');
        return;
      }

      console.info(`[ShaderPipeline] Loading active pack: ${active.name} (${active.id}) / world0`);

      try {
        await shaderRuntime.load(active.id, 'world0');
        if (generation !== shaderLoadGeneration || isDisposed) return;
        const diagnostics = shaderRuntime.getDiagnostics();
        setShaderDiagnostics(diagnostics);
        console.info('[ShaderPipeline] Program catalog:', shaderRuntime.getProgramNames());
        if (diagnostics.length > 0) {
          console.warn(`[ShaderPipeline] ${diagnostics.length} pass(es) failed; successful programs remain loaded`);
        }
      } catch (error) {
        if (generation !== shaderLoadGeneration || isDisposed) return;
        const diagnostics = shaderRuntime.getDiagnostics();
        setShaderDiagnostics(diagnostics.length > 0 ? diagnostics : [error instanceof Error ? (error.stack || error.message) : String(error)]);
        console.error('[ShaderPipeline] Failed to load shader runtime:', error instanceof Error ? (error.stack || error.message) : String(error));
        shaderRuntime.dispose();
      }
    };
    const unsubscribeShaders = shaderPacks.subscribe(() => {
      void reloadShaderRuntime();
    });
    void reloadShaderRuntime();
    let unsubscribePacks: (() => void) | null = null;
    engine.initialize().then(() => {
      if (isDisposed) return;
      engine.voxelWorld.setRenderDistance(graphicsRef.current.renderDistance);
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
    const memoryInfo = () => {
      const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
      return perf.memory ? perf.memory.usedJSHeapSize / (1024 * 1024) : null;
    };

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
        fpsRef.current = computedFps;
        setCurrentFps(computedFps);

        onUpdateStats({
          count: engine.getBlockCount(),
          fps: computedFps,
          stepTimeMs: Math.round(delta * 1000),
        });
      }

      const frameStart = performance.now();
      const physicsStart = performance.now();
      engine.step(Math.min(delta, 0.05), playerInputRef.current);
      const physicsEnd = performance.now();

      let streamingMs = 0;

      // Dynamic Shader-Based Lighting:
      // Updates underground vs surface light transition and cave atmosphere
      if (engine.voxelWorld && engine.player) {
        const playerPos = engine.player.getPosition();
        const streamingStart = performance.now();
        const isUnderground = engine.voxelWorld.updateLighting(playerPos, delta);
        const streamingEnd = performance.now();
        streamingMs = streamingEnd - streamingStart;
        envManager.setUndergroundLighting(isUnderground);

        // Day/night cycle: sun, moon, stars, clouds, sky colour and world light tint
        envManager.update(delta, playerPos);
        const skyDim = 1 - envManager.minecraftSky.getDaylight();
        engine.voxelWorld.setSkyDim(skyDim);
        // Keep voxel base colors neutral. Moonlight tint is applied only to the sky-light
        // channel in VoxelWorld's shader; tinting the whole material made surfaces look bright.
        // Steve is lit by the flood-fill light at his position (caves are dark, glowstone lights him up)
        engine.voxelWorld.getLightColorAt(playerPos.x, playerPos.y + 1.0, playerPos.z, skyDim, steveLight);
        steveLight.multiply(envManager.getWarmTint());
        engine.player.model.setLightTint(steveLight);
      }

      // Real shader-pack pipeline, currently at:
      //   gbuffers_terrain -> ping-pong colortex0..7 + depthtex0 -> deferred chain -> final -> screen
      // Keep the vanilla renderer as a safe fallback until the next pass is
      // available or a shader stage fails on the current GPU.
      const renderStart = performance.now();
      let shaderRendered = false;

      if (shaderRuntime.isLoaded && engine.voxelWorld) {
        const lightDir = envManager.minecraftSky.getSunDirection();
        shaderGBufferPass.render(
          scene,
          camera,
          engine.voxelWorld,
          renderer.domElement.width,
          renderer.domElement.height,
          frameCount,
          Math.floor(envManager.minecraftSky.timeOfDay * 24000) % 24000,
          lightDir
        );

        const shaderWorldTime = Math.floor(envManager.minecraftSky.timeOfDay * 24000) % 24000;
        const drawingBuffer = renderer.getDrawingBufferSize(new THREE.Vector2());
        const shaderWidth = Math.max(1, Math.floor(drawingBuffer.x));
        const shaderHeight = Math.max(1, Math.floor(drawingBuffer.y));

        const orderedPasses = (prefix: 'prepare' | 'deferred' | 'composite') =>
          shaderRuntime
            .getProgramNames()
            .filter((name) => new RegExp(`^${prefix}(?:\\\\d+)?import React, { useEffect, useRef, useState, useCallback } from 'react';
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
import { InventoryOverlay } from './InventoryOverlay';
import { MusicDiscId } from '../audio/MusicEngine';
import { PlayerInput } from '../player/PlayerController';
import { GraphicsSettings } from './SettingsModal';
import { resourcePacks } from '../resourcepack/ResourcePackManager';
import { ViewportFrameOverlay } from './ViewportFrameOverlay';
import { DebugOverlay, DebugFrameSample } from './DebugOverlay';
import { shaderPacks } from '../shaderpack/ShaderPackManager';
import { ShaderPackRuntime } from '../shaderpack/ShaderPackRuntime';
import { ShaderFinalPass } from '../shaderpack/ShaderFinalPass';
import { ShaderGBufferPass } from '../shaderpack/ShaderGBufferPass';
import { ShaderFullscreenPass } from '../shaderpack/ShaderFullscreenPass';

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
  const [selectedDisc, setSelectedDisc] = useState<MusicDiscId>('13');
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [currentFps, setCurrentFps] = useState(60);
  const fpsRef = useRef(60);
  const [isFlying, setIsFlying] = useState(false);
  const [shaderDiagnostics, setShaderDiagnostics] = useState<string[]>([]);
  const lastPresetRef = useRef<string | null>(null);
  const [debugSample, setDebugSample] = useState<DebugFrameSample>({
    frameMs: 0, physicsMs: 0, renderMs: 0, streamingMs: 0, generationMs: 0,
    chunks: 0, meshes: 0, drawCalls: 0, triangles: 0, geometries: 0, textures: 0, jsHeapMb: null, playerPos: null,
  });
  const debugHistoryRef = useRef<DebugFrameSample[]>([]);
  const graphicsRef = useRef(graphics);
  graphicsRef.current = graphics;

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
      envManagerRef.current.updateDistanceFog(graphics.renderDistance);
      // Only apply the preset when it actually changes (so other settings don't reset the clock)
      if (lastPresetRef.current !== graphics.skyPreset) {
        lastPresetRef.current = graphics.skyPreset;
        envManagerRef.current.setPreset(graphics.skyPreset);
      }
    }
    if (engineRef.current?.voxelWorld) {
      engineRef.current.voxelWorld.setWireframe(graphics.wireframe);
      engineRef.current.voxelWorld.setRenderDistance(graphics.renderDistance);
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
    const shaderRuntime = new ShaderPackRuntime(renderer, { debug: graphicsRef.current.debugMode });
    const shaderFinalPass = new ShaderFinalPass(renderer, shaderRuntime);
    const shaderGBufferPass = new ShaderGBufferPass(renderer, shaderRuntime);
    const shaderFullscreenPass = new ShaderFullscreenPass(renderer, shaderRuntime, shaderGBufferPass.framebufferManager);
    const pixelRatio = Math.min(window.devicePixelRatio, 1.75);
    renderer.setPixelRatio(pixelRatio);

    // Keep the canvas's CSS box and its WebGL drawing buffer in sync. On
    // mobile browsers the canvas can otherwise be displayed larger than the
    // drawing buffer, leaving the shader viewport anchored to the
    // bottom-left and exposing the page/clear color around it.
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';

    const resizeRenderer = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      const drawingBuffer = renderer.getDrawingBufferSize(new THREE.Vector2());
      shaderGBufferPass.resize(drawingBuffer.x, drawingBuffer.y);
      shaderFinalPass.resize(drawingBuffer.x, drawingBuffer.y);
    };

    resizeRenderer();
    renderer.shadowMap.enabled = graphics.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(renderer.domElement);

    // 3. Procedural Sky & Lighting
    const envManager = new EnvironmentManager(scene, renderer);
    envManagerRef.current = envManager;
    lastPresetRef.current = graphics.skyPreset;
    envManager.setPreset(graphics.skyPreset);
    envManager.setShadowsEnabled(graphics.shadows);
    envManager.updateDistanceFog(graphics.renderDistance);

    // 4. Initialize Physics Engine (Rapier 3D + Minecraft VoxelWorld + Steve + SoftBodies)
    const engine = new PhysicsEngine(scene, camera);
    engineRef.current = engine;

    let isDisposed = false;
    const steveLight = new THREE.Color();

    // Shader-pack runtime: compile/link the imported pack and execute the
    // real final fullscreen pass when the pack provides one. The scene itself
    // is rendered into colortex0 first.
    let shaderLoadGeneration = 0;
    const reloadShaderRuntime = async () => {
      const generation = ++shaderLoadGeneration;

      // Shader packs live in IndexedDB. Wait for the manager to finish loading
      // persisted packs before checking the active selection; otherwise the
      // viewport can race init() and incorrectly fall back to vanilla.
      await shaderPacks.init();
      if (generation !== shaderLoadGeneration || isDisposed) return;

      const active = shaderPacks.getActive();
      if (!active) {
        shaderRuntime.dispose();
        setShaderDiagnostics([]);
        console.info('[ShaderPipeline] No shader pack active; using vanilla renderer');
        return;
      }

      console.info(`[ShaderPipeline] Loading active pack: ${active.name} (${active.id}) / world0`);

      try {
        await shaderRuntime.load(active.id, 'world0');
        if (generation !== shaderLoadGeneration || isDisposed) return;
        const diagnostics = shaderRuntime.getDiagnostics();
        setShaderDiagnostics(diagnostics);
        console.info('[ShaderPipeline] Program catalog:', shaderRuntime.getProgramNames());
        if (diagnostics.length > 0) {
          console.warn(`[ShaderPipeline] ${diagnostics.length} pass(es) failed; successful programs remain loaded`);
        }
      } catch (error) {
        if (generation !== shaderLoadGeneration || isDisposed) return;
        const diagnostics = shaderRuntime.getDiagnostics();
        setShaderDiagnostics(diagnostics.length > 0 ? diagnostics : [error instanceof Error ? (error.stack || error.message) : String(error)]);
        console.error('[ShaderPipeline] Failed to load shader runtime:', error instanceof Error ? (error.stack || error.message) : String(error));
        shaderRuntime.dispose();
      }
    };
    const unsubscribeShaders = shaderPacks.subscribe(() => {
      void reloadShaderRuntime();
    });
    void reloadShaderRuntime();
    let unsubscribePacks: (() => void) | null = null;
    engine.initialize().then(() => {
      if (isDisposed) return;
      engine.voxelWorld.setRenderDistance(graphicsRef.current.renderDistance);
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
    const memoryInfo = () => {
      const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
      return perf.memory ? perf.memory.usedJSHeapSize / (1024 * 1024) : null;
    };

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
        fpsRef.current = computedFps;
        setCurrentFps(computedFps);

        onUpdateStats({
          count: engine.getBlockCount(),
          fps: computedFps,
          stepTimeMs: Math.round(delta * 1000),
        });
      }

      const frameStart = performance.now();
      const physicsStart = performance.now();
      engine.step(Math.min(delta, 0.05), playerInputRef.current);
      const physicsEnd = performance.now();

      let streamingMs = 0;

      // Dynamic Shader-Based Lighting:
      // Updates underground vs surface light transition and cave atmosphere
      if (engine.voxelWorld && engine.player) {
        const playerPos = engine.player.getPosition();
        const streamingStart = performance.now();
        const isUnderground = engine.voxelWorld.updateLighting(playerPos, delta);
        const streamingEnd = performance.now();
        streamingMs = streamingEnd - streamingStart;
        envManager.setUndergroundLighting(isUnderground);

        // Day/night cycle: sun, moon, stars, clouds, sky colour and world light tint
        envManager.update(delta, playerPos);
        const skyDim = 1 - envManager.minecraftSky.getDaylight();
        engine.voxelWorld.setSkyDim(skyDim);
        // Keep voxel base colors neutral. Moonlight tint is applied only to the sky-light
        // channel in VoxelWorld's shader; tinting the whole material made surfaces look bright.
        // Steve is lit by the flood-fill light at his position (caves are dark, glowstone lights him up)
        engine.voxelWorld.getLightColorAt(playerPos.x, playerPos.y + 1.0, playerPos.z, skyDim, steveLight);
        steveLight.multiply(envManager.getWarmTint());
        engine.player.model.setLightTint(steveLight);
      }

      // Real shader-pack pipeline, currently at:
      //   gbuffers_terrain -> ping-pong colortex0..7 + depthtex0 -> deferred chain -> final -> screen
      // Keep the vanilla renderer as a safe fallback until the next pass is
      // available or a shader stage fails on the current GPU.
      const renderStart = performance.now();
      let shaderRendered = false;

      if (shaderRuntime.isLoaded && engine.voxelWorld) {
        const lightDir = envManager.minecraftSky.getSunDirection();
        shaderGBufferPass.render(
          scene,
          camera,
          engine.voxelWorld,
          renderer.domElement.width,
          renderer.domElement.height,
          frameCount,
          Math.floor(envManager.minecraftSky.timeOfDay * 24000) % 24000,
          lightDir
        );

).test(name))
            .sort((a, b) => {
              const ai = a === prefix ? 0 : Number(a.slice(prefix.length));
              const bi = b === prefix ? 0 : Number(b.slice(prefix.length));
              return ai - bi;
            });

        // OptiFine/Iris executes the fullscreen stages in this order after the
        // terrain G-buffer: prepare -> deferred -> composite -> final.
        for (const passName of [
          ...orderedPasses('prepare'),
          ...orderedPasses('deferred'),
          ...orderedPasses('composite'),
        ]) {
          shaderFullscreenPass.render(
            passName,
            shaderWidth,
            shaderHeight,
            frameCount,
            shaderWorldTime,
          );
        }

        const gbufferColor = shaderGBufferPass.colorTexture;
        if (gbufferColor) {
          shaderRendered = shaderFinalPass.renderTexture(
            gbufferColor,
            shaderWidth,
            shaderHeight
          );
        }
      }

      if (!shaderRendered) renderer.render(scene, camera);
      const renderEnd = performance.now();
      if (graphicsRef.current.debugMode) {
        const info = renderer.info;
        const memory = memoryInfo();
        const meshes = scene.children.reduce((count, object) => count + (object instanceof THREE.Mesh ? 1 : 0), 0);
        const sample: DebugFrameSample = {
          frameMs: renderEnd - frameStart,
          physicsMs: physicsEnd - physicsStart,
          renderMs: renderEnd - renderStart,
          streamingMs,
          generationMs: engine.voxelWorld.consumeDebugGenerationTime(),
          chunks: engine.voxelWorld.chunks.size,
          meshes,
          drawCalls: info.render.calls,
          triangles: info.render.triangles,
          geometries: info.memory.geometries,
          textures: info.memory.textures,
          jsHeapMb: memory,
          playerPos: engine.player ? engine.player.getPosition() : null,
        };
        debugHistoryRef.current = debugHistoryRef.current.length >= 120
          ? [...debugHistoryRef.current.slice(1), sample]
          : [...debugHistoryRef.current, sample];
        setDebugSample(sample);
      }
    };

    animate();

    // 6. Resize handling
    const resizeObserver = new ResizeObserver(resizeRenderer);
    resizeObserver.observe(container);
    window.addEventListener('resize', resizeRenderer);

    return () => {
      isDisposed = true;
      unsubscribePacks?.();
      unsubscribeShaders();
      shaderGBufferPass.dispose();
      shaderFullscreenPass.dispose();
      shaderFinalPass.dispose();
      shaderRuntime.dispose();
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      window.removeEventListener('resize', resizeRenderer);
      envManager.dispose();
      engine.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [onEngineReady, onUpdateStats]);

  useEffect(() => {
    const handleInventoryKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key.toLowerCase() === 'e') {
        event.preventDefault();
        setInventoryOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', handleInventoryKey);
    return () => window.removeEventListener('keydown', handleInventoryKey);
  }, []);

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
        engineRef.current.player.selectedDisc = selectedDisc;
        engineRef.current.player.placeBlock(coords);
      }
    },
    [selectedVoxel, selectedDisc]
  );

  // Action: Select Voxel
  const handleSelectVoxel = useCallback((v: VoxelType) => {
    setSelectedVoxel(v);
    if (engineRef.current?.player) {
      engineRef.current.player.selectedVoxel = v;
    }
  }, []);

  const handleSelectDisc = useCallback((disc: MusicDiscId) => {
    setSelectedDisc(disc);
    if (engineRef.current?.player) engineRef.current.player.selectedDisc = disc;
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

      <InventoryOverlay
        open={inventoryOpen}
        onClose={() => setInventoryOpen(false)}
        selectedVoxel={selectedVoxel}
        onSelectVoxel={handleSelectVoxel}
        selectedDisc={selectedDisc}
        onSelectDisc={handleSelectDisc}
      />

      {/* Cinematic Viewport Frame Mode Overlay (Brackets + HUD) */}
      <ViewportFrameOverlay enabled={graphics.viewportFrameMode} fps={currentFps} />
      <DebugOverlay enabled={graphics.debugMode} sample={debugSample} history={debugHistoryRef.current} shaderDiagnostics={shaderDiagnostics} onCopyShaderErrors={() => {
        const diagnostics = [...shaderDiagnostics, ...shaderPacks.getCompileDiagnostics()];
        const uniqueDiagnostics = [...new Set(diagnostics)];
        const text = uniqueDiagnostics.join('\\n\\n') || '[ShaderPipeline] No shader diagnostics captured.';
        void navigator.clipboard.writeText(text).then(() => console.info('[ShaderPipeline] Diagnostics copied to clipboard'));
      }} />

      {/* MCPE Touch Controls Overlay (Direct touch coordinate mining & placing) */}
      <PlayerControlsOverlay
        onInputUpdate={handleInputUpdate}
        onLookDelta={handleLookDelta}
        onAimTouchCoords={handleAimTouchCoords}
        onActionMine={handleActionMine}
        onActionPlace={handleActionPlace}
        onToggleViewMode={onToggleViewMode}
        onToggleInventory={() => setInventoryOpen((open) => !open)}
        isFlying={isFlying}
        viewMode={viewMode}
        selectedVoxel={selectedVoxel}
        onSelectVoxel={handleSelectVoxel}
      />
    </div>
  );
};