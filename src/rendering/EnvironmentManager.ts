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
    sunIntensity: 1.15,
    ambientIntensity: 0.38,
  },
  sunset: {
    preset: 'sunset',
    timeOfDay: 0.48,
    sunIntensity: 1.25,
    ambientIntensity: 0.32,
  },
  dawn: {
    preset: 'dawn',
    timeOfDay: 0.05,
    sunIntensity: 1.1,
    ambientIntensity: 0.35,
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
    sunIntensity: 1.2,
    ambientIntensity: 0.42,
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
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;

    this.applySettings(this.currentSettings);
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
      const farDist = renderDistanceChunks * 16 + 8;
      const nearDist = Math.max(16, farDist - 22);
      this.scene.fog.near = nearDist;
      this.scene.fog.far = farDist;
    }
  }

  public setUndergroundLighting(_isUnderground: boolean) {
    // In Minecraft, underground atmosphere is naturally maintained
  }

  public getWarmTint(): THREE.Color {
    const sky = this.minecraftSky;
    const h = Math.cos((sky.timeOfDay - 0.25) * 2 * Math.PI);
    const warm = THREE.MathUtils.clamp(1 - Math.abs(h) / 0.3, 0, 1);
    return this.voxelTint.copy(this.white).lerp(this.warmTint, warm * 0.3);
  }

  public update(delta: number, playerPos?: THREE.Vector3) {
    this.minecraftSky.update(delta, playerPos);
    this.updateLightingColors();

    if (playerPos) {
      // Keep sun light shadow frustum centered on player
      const sunDir = this.minecraftSky.getSunDirection();
      this.sunLight.position.copy(playerPos).add(sunDir.multiplyScalar(40));
      this.sunLight.target.position.copy(playerPos);
      this.sunLight.target.updateMatrixWorld();
    }
  }

  private updateLightingColors() {
    const time = this.minecraftSky.timeOfDay;
    const angle = (time - 0.25) * 2.0 * Math.PI;
    const sunHeight = Math.cos(angle);

    if (sunHeight > 0.15) {
      // Day
      this.sunLight.color.setHex(0xfffbeb);
      this.sunLight.intensity = this.currentSettings.sunIntensity;
      this.ambientLight.color.setHex(0xffffff);
      this.ambientLight.groundColor.setHex(0x334155);
      this.ambientLight.intensity = this.currentSettings.ambientIntensity;
    } else if (sunHeight > -0.15) {
      // Sunset / Dawn
      this.sunLight.color.setHex(0xf97316);
      this.sunLight.intensity = this.currentSettings.sunIntensity * 1.1;
      this.ambientLight.color.setHex(0xfde047);
      this.ambientLight.groundColor.setHex(0x1e1b4b);
      this.ambientLight.intensity = this.currentSettings.ambientIntensity * 0.9;
    } else {
      // Night (Moonlight)
      this.sunLight.color.setHex(0x93c5fd);
      this.sunLight.intensity = 0.35;
      this.ambientLight.color.setHex(0x38bdf8);
      this.ambientLight.groundColor.setHex(0x0f172a);
      this.ambientLight.intensity = 0.22;
    }
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
