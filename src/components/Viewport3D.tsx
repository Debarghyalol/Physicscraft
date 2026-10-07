import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { pass, uniform, float } from 'three/tsl';
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
import { translateProgram } from '../shaderpack/GlslTranslator';
import { activateNostalgiaGBuffer, createNostalgiaDeferredLighting, createNostalgiaFinalOutput, isNostalgiaFinalSource, updateNostalgiaShadowMap } from '../shaderpack/ShaderPackWebGPUFinalPass';

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

    let disposed = false;
    let cleanupRenderer: (() => void) | null = null;

    const initializeRenderer = async () => {
      const renderer = new WebGPURenderer({
        antialias: false,
        powerPreference: 'high-performance',
      });
      await renderer.init();

      if (disposed) {
        renderer.dispose();
        return;
      }

      console.info(
        '[Renderer] Three.js WebGPURenderer initialized:',
        renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2 fallback'
      );

    // 1. Three.js Scene & Camera setup
    const scene = new THREE.Scene();
    const aspect = container.clientWidth / container.clientHeight;
    const camera = new THREE.PerspectiveCamera(graphics.fov, aspect, 0.1, 400);
    cameraRef.current = camera;

    // WebGPU post-processing is owned by Three's RenderPipeline/TSL stack.
    // The scene pass is colortex0 for the first shader-pack output adapter.
    const scenePass = pass(scene, camera);
    const sceneGBuffer = activateNostalgiaGBuffer(scenePass);
    const renderPipeline = new RenderPipeline(renderer, sceneGBuffer.color);
    const nostalgiaLightDirectionWorld = uniform(new THREE.Vector3(0, 1, 0));
    const nostalgiaLightStrength = uniform(1.0);
    const nostalgiaSkyDim = uniform(0.0);
    const nostalgiaFrameCounter = uniform(0.0);
    let nostalgiaNoiseTexture: THREE.Texture | null = null;

    // 2. WebGPU canvas configuration
    const pixelRatio = Math.min(window.devicePixelRatio, 1.75);
    renderer.setPixelRatio(pixelRatio);

    // Keep the canvas's CSS box and its WebGPU drawing buffer in sync. On
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

    };

    resizeRenderer();
    renderer.shadowMap.enabled = graphics.shadows;

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

    const steveLight = new THREE.Color();
    const nostalgiaWorldLight = new THREE.Vector3();
    const debugCameraDirection = new THREE.Vector3();

    // Shader-pack execution is intentionally paused here. The previous
    // implementation compiled raw GLSL through WebGL. WebGPURenderer requires
    // TSL/node materials, so shader stages will be ported to WGSL/TSL instead
    // of routing them through the old WebGL pipeline.
    setShaderDiagnostics([
      '[Renderer] WebGPU renderer initialized.',
      '[ShaderPipeline] WebGPU shader compiler bridge is active.',
    ]);

    // Validate the selected Iris/OptiFine pack through the new WebGPU compiler.
    // Rendering is intentionally still vanilla here: compilation and rendering are
    // separate milestones, so a shader translation failure cannot corrupt the game loop.
    void (async () => {
      try {
        await shaderPacks.init();
        const activePack = shaderPacks.getActive();
        if (!activePack || disposed) return;

        // Nostalgia's SSAO uses the pack's real shaders/image/noise2D.png, not a procedural substitute.
        // Keep it as a tiny 256x256 nearest-neighbour texture so the AO lookup is effectively texelFetch.
        const noiseBlob = await shaderPacks.loadAsset(activePack.id, 'image/noise2D.png');
        if (!noiseBlob) throw new Error('Active shader pack is missing shaders/image/noise2D.png');
        const noiseBitmap = await createImageBitmap(noiseBlob);
        nostalgiaNoiseTexture = new THREE.Texture(noiseBitmap);
        nostalgiaNoiseTexture.wrapS = THREE.RepeatWrapping;
        nostalgiaNoiseTexture.wrapT = THREE.RepeatWrapping;
        nostalgiaNoiseTexture.magFilter = THREE.NearestFilter;
        nostalgiaNoiseTexture.minFilter = THREE.NearestFilter;
        nostalgiaNoiseTexture.generateMipmaps = false;
        nostalgiaNoiseTexture.colorSpace = THREE.NoColorSpace;
        nostalgiaNoiseTexture.needsUpdate = true;

        const reports = await shaderPacks.compileWebGPUReport(activePack.id, 'world0');
        if (disposed) return;
        const failed = reports.filter((report) => !report.ok);

        let finalAdapter = false;
        try {
          const { files } = await shaderPacks.loadFiles(activePack.id);
          const finalEntry = 'world0/final.fsh';
          if (files.has(finalEntry)) {
            const translatedFinal = translateProgram({
              files,
              entry: finalEntry,
              stage: 'fragment',
            });
            if (isNostalgiaFinalSource(translatedFinal.source)) {
              // The PassNode owns the MRT configuration; configure it before the render graph compiles.
              const deferredColor = createNostalgiaDeferredLighting(
                sceneGBuffer.albedo,
                sceneGBuffer.normal,
                sceneGBuffer.lightmap,
                sceneGBuffer.gdata,
                sceneGBuffer.depth,
                nostalgiaLightDirectionWorld,
                nostalgiaLightStrength,
                nostalgiaSkyDim,
                envManager.sunLight,
                camera,
                nostalgiaFrameCounter,
                nostalgiaNoiseTexture,
              );
              const nostalgiaBeauty = createNostalgiaFinalOutput(
                deferredColor,
                sceneGBuffer.color,
                sceneGBuffer.depth,
              );
              renderPipeline.outputNode = nostalgiaBeauty;
              renderPipeline.needsUpdate = true;
              finalAdapter = true;
            }
          }
        } catch (adapterError: any) {
          console.warn('[ShaderPipeline] WebGPU final-pass adapter setup failed:', adapterError);
        }

        setShaderDiagnostics([
          '[Renderer] WebGPU renderer initialized.',
          `[ShaderPipeline] ${reports.filter((report) => report.ok).length}/${reports.length} world0 shader stages translated to WGSL.`,
          finalAdapter
            ? '[ShaderPipeline] Nostalgia deferred lighting + final CAS stages mapped to WebGPU TSL.'
            : '[ShaderPipeline] No supported WebGPU final-pass adapter for the active pack yet.',
          ...failed.slice(0, 12).map((report) =>
            `[ShaderPipeline] ${report.name} (${report.stage})\\n${report.log}`,
          ),
        ]);
      } catch (error: any) {
        if (!disposed) {
          setShaderDiagnostics((previous) => [
            ...previous,
            `[ShaderPipeline] WebGPU compiler initialization failed: ${String(error?.message ?? error)}`,
          ]);
        }
      }
    })();

    let unsubscribePacks: (() => void) | null = null;
    engine.initialize().then(() => {
      if (disposed) return;
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
        nostalgiaSkyDim.value = skyDim;
        // Keep voxel base colors neutral. Moonlight tint is applied only to the sky-light
        // channel in VoxelWorld's shader; tinting the whole material made surfaces look bright.
        // Steve is lit by the flood-fill light at his position (caves are dark, glowstone lights him up)
        engine.voxelWorld.getLightColorAt(playerPos.x, playerPos.y + 1.0, playerPos.z, skyDim, steveLight);
        steveLight.multiply(envManager.getWarmTint());
        engine.player.model.setLightTint(steveLight);
      }

        // Use the Minecraft sky's authoritative celestial direction for deferred lighting.
      // This is the direction FROM the surface TOWARD the sun/moon. Do not derive it
      // back from DirectionalLight.matrixWorld here: the light transform is updated
      // earlier in EnvironmentManager.update(), and its world matrix may not yet have
      // been rebuilt when this code runs.
      nostalgiaWorldLight.copy(envManager.minecraftSky.getSunDirection());
      if (nostalgiaWorldLight.y < 0) nostalgiaWorldLight.negate();
      nostalgiaWorldLight.normalize();
      nostalgiaLightDirectionWorld.value.copy(nostalgiaWorldLight);
      nostalgiaLightStrength.value = Math.max(0.0, envManager.sunLight.intensity);
      nostalgiaFrameCounter.value += 1.0;
      
      // Capture the exact world-space camera look vector for the F3 diagnostics.
      // Three.js cameras look along their local -Z axis, and getWorldDirection()
      // returns that direction in world space.
      camera.updateMatrixWorld(true);
      camera.getWorldDirection(debugCameraDirection);

      // Render through the WebGPU render graph. Shader-pack stages will be
      // composed here as TSL nodes instead of WebGL fullscreen passes.
      // Three only resets per-frame render stats inside its own setAnimationLoop; this app
      // drives its own requestAnimationFrame loop, so reset them here. Without this,
      // drawCalls/triangles accumulate forever (and `info.render.calls` is a lifetime
      // counter of render() calls, not draw calls, so it is never what we want).
      renderer.info.reset();
      // Shadow map must be rendered from the world scene (see updateNostalgiaShadowMap).
      updateNostalgiaShadowMap(renderer, scene, camera);
      renderPipeline.render();
      const renderEnd = performance.now();
      if (graphicsRef.current.debugMode) {
        const info = renderer.info;
        const memory = memoryInfo();
        const meshes = scene.children.reduce((count, object) => count + (object instanceof THREE.Mesh ? 1 : 0), 0);
        const horizontalLength = Math.hypot(debugCameraDirection.x, debugCameraDirection.z);
        const facing = horizontalLength < 0.0001
          ? (debugCameraDirection.y >= 0 ? 'UP (+Y)' : 'DOWN (-Y)')
          : Math.abs(debugCameraDirection.x) >= Math.abs(debugCameraDirection.z)
            ? (debugCameraDirection.x >= 0 ? '+X' : '-X')
            : (debugCameraDirection.z >= 0 ? '+Z' : '-Z');
        const cameraHeading = Math.atan2(debugCameraDirection.x, debugCameraDirection.z) * 180 / Math.PI;
        const cameraPitch = Math.asin(THREE.MathUtils.clamp(debugCameraDirection.y, -1, 1)) * 180 / Math.PI;
        const sample: DebugFrameSample = {
          frameMs: renderEnd - frameStart,
          physicsMs: physicsEnd - physicsStart,
          renderMs: renderEnd - frameStart,
          streamingMs,
          generationMs: engine.voxelWorld.consumeDebugGenerationTime(),
          chunks: engine.voxelWorld.chunks.size,
          meshes,
          drawCalls: info.render.drawCalls,
          triangles: info.render.triangles,
          geometries: info.memory.geometries,
          textures: info.memory.textures,
          jsHeapMb: memory,
          playerPos: engine.player ? engine.player.getPosition() : null,
          cameraPos: {
            x: camera.position.x,
            y: camera.position.y,
            z: camera.position.z,
          },
          cameraDirection: {
            x: debugCameraDirection.x,
            y: debugCameraDirection.y,
            z: debugCameraDirection.z,
          },
          cameraFacing: facing,
          cameraYaw: cameraHeading,
          cameraPitch,
          sunDirection: {
            x: nostalgiaWorldLight.x,
            y: nostalgiaWorldLight.y,
            z: nostalgiaWorldLight.z,
          },
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

    cleanupRenderer = () => {
      unsubscribePacks?.();
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      window.removeEventListener('resize', resizeRenderer);
      envManager.dispose();
      engine.dispose();
      renderPipeline.dispose();
      nostalgiaNoiseTexture?.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
    };

    void initializeRenderer();

    return () => {
      disposed = true;
      cleanupRenderer?.();
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
      {/* 3D WebGPU Canvas */}
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
