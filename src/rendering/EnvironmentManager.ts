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

export class EnvironmentManager {
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;

  public minecraftSky: MinecraftSky;
  public sunLight: THREE.DirectionalLight;
  public fillLight: THREE.DirectionalLight;
  public ambientLight: THREE.HemisphereLight;

  public currentSettings: EnvironmentSettings;
  private worldTint = new THREE.Color();
  private voxelTint = new THREE.Color();
  private white = new THREE.Color(1, 1, 1);
  private warmTint = new THREE.Color(1.0, 0.7, 0.45);

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
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
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 140;
    const shadowD = 24;
    this.sunLight.shadow.camera.left = -shadowD;
    this.sunLight.shadow.camera.right = shadowD;
    this.sunLight.shadow.camera.top = shadowD;
    this.sunLight.shadow.camera.bottom = -shadowD;
    this.sunLight.shadow.bias = -0.0003;

    // Shader packs expect shadowtex0/shadowtex1 to be real depth textures.
    // Three.js' WebGL shadow path can otherwise allocate only a color shadow
    // map plus a depth renderbuffer, leaving shadow.map.depthTexture null.
    // Install an explicit depth attachment so WebGL2 can legally bind it to
    // both sampler2D and sampler2DShadow (with the pass-specific sampler state).
    const shadowDepthTexture = new THREE.DepthTexture(
      this.sunLight.shadow.mapSize.width,
      this.sunLight.shadow.mapSize.height,
      THREE.UnsignedIntType,
    );
    shadowDepthTexture.format = THREE.DepthFormat;
    shadowDepthTexture.minFilter = THREE.NearestFilter;
    shadowDepthTexture.magFilter = THREE.NearestFilter;
    shadowDepthTexture.wrapS = THREE.ClampToEdgeWrapping;
    shadowDepthTexture.wrapT = THREE.ClampToEdgeWrapping;
    shadowDepthTexture.generateMipmaps = false;
    shadowDepthTexture.name = 'PhysicscraftShadowDepth';

    const shadowRenderTarget = new THREE.WebGLRenderTarget(
      this.sunLight.shadow.mapSize.width,
      this.sunLight.shadow.mapSize.height,
      {
        depthBuffer: true,
        stencilBuffer: false,
        generateMipmaps: false,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
      },
    );
    shadowRenderTarget.depthTexture = shadowDepthTexture;
    shadowRenderTarget.texture.colorSpace = THREE.NoColorSpace;
    shadowRenderTarget.texture.name = 'PhysicscraftShadowColor';
    this.sunLight.shadow.map = shadowRenderTarget;

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

  public update(delta: number, playerPos?: THREE.Vector3) {
    this.minecraftSky.update(delta, playerPos);
    this.updateLightingColors();

    if (playerPos) {
      // Keep sun light shadow frustum centered on player
      const sunDir = this.minecraftSky.getSunDirection();
      if (sunDir.y < 0) sunDir.negate(); // at night the light comes from the moon's side of the sky
      this.sunLight.position.copy(playerPos).add(sunDir.multiplyScalar(40));
      this.sunLight.target.position.copy(playerPos);
      this.sunLight.target.updateMatrixWorld();
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
    this.scene.remove(this.fillLight);
    this.scene.remove(this.ambientLight);
  }
}
