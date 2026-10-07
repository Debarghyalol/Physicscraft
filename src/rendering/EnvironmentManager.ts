import * as THREE from 'three';
import { MinecraftSky } from './MinecraftSky';

export type SkyPreset = 'daylight' | 'sunset' | 'dawn' | 'midnight' | 'studio';

export interface EnvironmentSettings {
  preset: SkyPreset;
  timeOfDay: number; // 0.0 = sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight
  sunIntensity: number;
  ambientIntensity: number;
}

export const SKY_PRESETS: Record<SkyPreset, EnvironmentSettings> = {
  daylight: {
    preset: 'daylight',
    timeOfDay: 0.25,
    sunIntensity: 0.9,
    ambientIntensity: 0.45,
  },
  sunset: {
    preset: 'sunset',
    timeOfDay: 0.48,
    sunIntensity: 0.9,
    ambientIntensity: 0.4,
  },
  dawn: {
    preset: 'dawn',
    timeOfDay: 0.05,
    sunIntensity: 0.85,
    ambientIntensity: 0.4,
  },
  midnight: {
    preset: 'midnight',
    timeOfDay: 0.75,
    sunIntensity: 0.35, // Soft moonlight
    ambientIntensity: 0.22,
  },
  studio: {
    preset: 'studio',
    timeOfDay: 0.22,
    sunIntensity: 0.9,
    ambientIntensity: 0.45,
  },
};

/** Half-size (blocks) of the sun shadow frustum. Nostalgia: shadowDistance = 128. */
const SHADOW_HALF_EXTENT = 64;
/** Distance of the shadow camera from the frustum centre along the light direction. */
const SHADOW_LIGHT_OFFSET = 160;
/** Nostalgia: shadowIntervalSize = 2. */
const SHADOW_INTERVAL = 2;
const shadowBasis = new THREE.Matrix4();
const shadowZero = new THREE.Vector3();
const shadowUp = new THREE.Vector3(0, 1, 0);
const shadowForward = new THREE.Vector3();
const shadowRight = new THREE.Vector3();
const shadowUpAxis = new THREE.Vector3();
const shadowBack = new THREE.Vector3();
const shadowSnapped = new THREE.Vector3();

export class EnvironmentManager {
  private scene: THREE.Scene;
  private renderer: THREE.Renderer;

  public minecraftSky: MinecraftSky;
  public sunLight: THREE.DirectionalLight;
  public fillLight: THREE.DirectionalLight;
  public ambientLight: THREE.HemisphereLight;

  public currentSettings: EnvironmentSettings;
  private worldTint = new THREE.Color();
  private voxelTint = new THREE.Color();
  private white = new THREE.Color(1, 1, 1);
  private warmTint = new THREE.Color(1.0, 0.7, 0.45);

  constructor(scene: THREE.Scene, renderer: THREE.Renderer) {
    this.scene = scene;
    this.renderer = renderer;

    this.currentSettings = { ...SKY_PRESETS.daylight };

    // 1. Authentic Minecraft Sky (Sun, 8 Moon phases, 1500 Stars, Drifting Clouds)
    this.minecraftSky = new MinecraftSky(scene);

    // 2. Key Sun/Moon Directional Light with soft PCF shadows
    this.sunLight = new THREE.DirectionalLight(0xfff8ee, this.currentSettings.sunIntensity);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    // Nostalgia: shadowDistance = 128. With a 2048 map and no warp, a half-extent of 64
    // gives 16 texels per block. The light sits SHADOW_LIGHT_OFFSET along the sun
    // direction so terrain well above the player (mountains over a cave) still casts.
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = SHADOW_LIGHT_OFFSET * 2 + 20;
    const shadowD = SHADOW_HALF_EXTENT;
    this.sunLight.shadow.camera.left = -shadowD;
    this.sunLight.shadow.camera.right = shadowD;
    this.sunLight.shadow.camera.top = shadowD;
    this.sunLight.shadow.camera.bottom = -shadowD;
    this.sunLight.shadow.bias = -0.0003;

    // Let the active Three.js renderer own the shadow render target.
    // WebGPURenderer uses its native depth target; do not install a
    // WebGLRenderTarget here.
    this.scene.add(this.sunLight);

    // 3. Fill Directional Light (Soft blue sky bounce, never washed out)
    this.fillLight = new THREE.DirectionalLight(0x93c5fd, 0.22);
    this.fillLight.position.set(-15, 20, -15);
    this.scene.add(this.fillLight);

    // 4. Ambient / Hemisphere Light (Balanced for rich Minecraft contrast)
    this.ambientLight = new THREE.HemisphereLight(0xe2e8f0, 0x1e293b, this.currentSettings.ambientIntensity);
    this.scene.add(this.ambientLight);

    // Dynamic Minecraft distance fog (blends chunk boundaries seamlessly into sky horizon)
    const fogColor = new THREE.Color(0xc0d8ff);
    this.scene.fog = new THREE.Fog(fogColor, 28, 52);

    // Color tone mapping calibrated for vivid, punchy colors with zero milky haze
    // No filmic tone mapping: ACES lifted/desaturated the unlit voxel colours (the "white wash").
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.applySettings(this.currentSettings);
  }

  /**
   * Returns the actual depth attachment of the directional-light shadow map.
   *
   * Shader-pack shadowtex0/shadowtex1 are depth textures in Iris/OptiFine.
   * The render-target color texture (shadow.map.texture) is NOT compatible
   * with sampler2D/sampler2DShadow and causes WebGL INVALID_OPERATION 1282.
   */
  public getShadowDepthTexture(): THREE.DepthTexture | null {
    return this.sunLight.shadow.map?.depthTexture ?? null;
  }

  public getShadowCamera(): THREE.Camera {
    return this.sunLight.shadow.camera;
  }

  public setPreset(preset: SkyPreset) {
    const config = SKY_PRESETS[preset] || SKY_PRESETS.daylight;
    this.applySettings(config);
  }

  public setTimeOfDay(time: number) {
    this.currentSettings.timeOfDay = time;
    this.minecraftSky.setTimeOfDay(time);
    this.updateLightingColors();
  }

  public setMoonPhase(phase: number) {
    this.minecraftSky.setMoonPhase(phase);
  }

  public nextMoonPhase() {
    this.minecraftSky.nextMoonPhase();
  }

  public setShadowsEnabled(enabled: boolean) {
    this.sunLight.castShadow = enabled;
    this.renderer.shadowMap.enabled = enabled;
  }

  public updateDistanceFog(renderDistanceChunks: number = 3) {
    if (this.scene.fog && this.scene.fog instanceof THREE.Fog) {
      // Minecraft's render-distance fog is tied to the active render distance.
      // Keep it proportional so changing the chunk distance also changes the
      // visible horizon instead of leaving the old fixed 52-block fog.
      const farDist = Math.max(32, renderDistanceChunks * 16);
      const nearDist = Math.max(16, farDist * 0.72);
      this.scene.fog.near = nearDist;
      this.scene.fog.far = farDist;
    }
  }

  public setUndergroundLighting(_isUnderground: boolean) {
    // In Minecraft, underground atmosphere is naturally maintained
  }

  /**
   * Snap the shadow frustum centre to a grid in light space (Nostalgia's
   * shadowIntervalSize = 2). Without this the shadow map re-rasterises at sub-texel
   * offsets every frame as the player moves and shadow edges crawl/shimmer.
   * 2 blocks is a whole number of texels at the current map size and extent.
   */
  private snapShadowCenter(pos: THREE.Vector3, sunDir: THREE.Vector3): THREE.Vector3 {
    // Same orientation the shadow camera will use (lookAt from the light to the target).
    // The light sits at +sunDir and looks back at the target, i.e. along -sunDir.
    shadowBasis.lookAt(shadowZero, shadowForward.copy(sunDir).negate(), shadowUp);
    const e = shadowBasis.elements;
    shadowRight.set(e[0], e[1], e[2]);
    shadowUpAxis.set(e[4], e[5], e[6]);
    shadowBack.set(e[8], e[9], e[10]);
    const sx = Math.round(pos.dot(shadowRight) / SHADOW_INTERVAL) * SHADOW_INTERVAL;
    const sy = Math.round(pos.dot(shadowUpAxis) / SHADOW_INTERVAL) * SHADOW_INTERVAL;
    const sz = pos.dot(shadowBack);
    return shadowSnapped
      .set(0, 0, 0)
      .addScaledVector(shadowRight, sx)
      .addScaledVector(shadowUpAxis, sy)
      .addScaledVector(shadowBack, sz);
  }

  public update(delta: number, playerPos?: THREE.Vector3) {
    this.minecraftSky.update(delta, playerPos);
    this.updateLightingColors();

    if (playerPos) {
      // Keep sun light shadow frustum centered on player
      const sunDir = this.minecraftSky.getSunDirection();
      if (sunDir.y < 0) sunDir.negate(); // at night the light comes from the moon's side of the sky
      sunDir.normalize();
      const center = this.snapShadowCenter(playerPos, sunDir);
      this.sunLight.position.copy(center).addScaledVector(sunDir, SHADOW_LIGHT_OFFSET);
      this.sunLight.target.position.copy(center);
      this.sunLight.target.updateMatrixWorld(true);
      this.sunLight.updateMatrixWorld(true);
    }
  }

  private updateLightingColors() {
    const sky = this.minecraftSky;
    const d = sky.getDaylight(); // 0 night .. 1 day
    const h = Math.cos((sky.timeOfDay - 0.25) * 2 * Math.PI);
    const warm = THREE.MathUtils.clamp(1 - Math.abs(h) / 0.3, 0, 1); // sunrise / sunset glow

    if (h >= 0) {
      this.sunLight.color.setHex(0xfffbeb).lerp(new THREE.Color(0xff9a4d), warm * 0.7);
      this.sunLight.intensity = this.currentSettings.sunIntensity * d;
    } else {
      this.sunLight.color.setHex(0x9db8ff); // moonlight
      this.sunLight.intensity = 0.25 * (1 - d);
    }
    this.ambientLight.color.setHex(0xffffff).lerp(new THREE.Color(0x4a5a8a), 1 - d);
    this.ambientLight.groundColor.setHex(0x334155);
    this.ambientLight.intensity = THREE.MathUtils.lerp(0.16, this.currentSettings.ambientIntensity, d);
    this.fillLight.intensity = 0.2 * d;
  }

  /** Sunset / sunrise glow only (voxel brightness comes from per-vertex light + sky dim). */
  public getWarmTint(): THREE.Color {
    const sky = this.minecraftSky;
    const h = Math.cos((sky.timeOfDay - 0.25) * 2 * Math.PI);
    const warm = THREE.MathUtils.clamp(1 - Math.abs(h) / 0.3, 0, 1);
    return this.voxelTint.copy(this.white).lerp(this.warmTint, warm * 0.3);
  }

  /** Colour multiplier for unlit (baked-light) materials: voxels and Steve. */
  public getWorldTint(): THREE.Color {
    const sky = this.minecraftSky;
    const d = sky.getDaylight();
    const h = Math.cos((sky.timeOfDay - 0.25) * 2 * Math.PI);
    const warm = THREE.MathUtils.clamp(1 - Math.abs(h) / 0.3, 0, 1);
    this.worldTint.setRGB(0.07, 0.09, 0.2).lerp(this.white, d);
    this.worldTint.lerp(this.warmTint, warm * 0.3);
    return this.worldTint;
  }

  public applySettings(settings: Partial<EnvironmentSettings>) {
    this.currentSettings = { ...this.currentSettings, ...settings };
    this.minecraftSky.setTimeOfDay(this.currentSettings.timeOfDay);
    this.updateLightingColors();
  }

  public dispose() {
    this.minecraftSky.dispose();
    this.scene.remove(this.sunLight);
    this.scene.remove(this.sunLight.target);
    this.scene.remove(this.fillLight);
    this.scene.remove(this.ambientLight);
  }
}
