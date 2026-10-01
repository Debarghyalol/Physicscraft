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
    sunIntensity: 0.72,
    ambientIntensity: 0.17,
  },
  sunset: {
    preset: 'sunset',
    timeOfDay: 0.48,
    sunIntensity: 0.62,
    ambientIntensity: 0.15,
  },
  dawn: {
    preset: 'dawn',
    timeOfDay: 0.05,
    sunIntensity: 0.6,
    ambientIntensity: 0.14,
  },
  midnight: {
    preset: 'midnight',
    timeOfDay: 0.75,
    sunIntensity: 0.1,
    ambientIntensity: 0.08,
  },
  studio: {
    preset: 'studio',
    timeOfDay: 0.22,
    sunIntensity: 0.8,
    ambientIntensity: 0.18,
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
  private readonly daySunColor = new THREE.Color(0xfff4df);
  private readonly twilightSunColor = new THREE.Color(0xff9861);
  private readonly nightSunColor = new THREE.Color(0x849bc8);
  private readonly dayAmbientColor = new THREE.Color(0xc7dcff);
  private readonly twilightAmbientColor = new THREE.Color(0xf0b38c);
  private readonly nightAmbientColor = new THREE.Color(0x64759a);
  private readonly dayGroundColor = new THREE.Color(0x394653);
  private readonly nightGroundColor = new THREE.Color(0x161d2b);

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
    this.fillLight = new THREE.DirectionalLight(0x93c5fd, 0.1);
    this.fillLight.position.set(-15, 20, -15);
    this.scene.add(this.fillLight);

    // 4. Ambient / Hemisphere Light (Balanced for rich Minecraft contrast)
    this.ambientLight = new THREE.HemisphereLight(0xc7dcff, 0x29303a, this.currentSettings.ambientIntensity);
    this.scene.add(this.ambientLight);

    // Dynamic Minecraft distance fog (blends chunk boundaries seamlessly into sky horizon)
    const fogColor = new THREE.Color(0x9ebce8);
    this.scene.fog = new THREE.Fog(fogColor, 28, 52);

    // Color tone mapping calibrated for vivid, natural contrast without flattening all surfaces to white.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.68;

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

  public setCycleSpeed(dayDurationSeconds: number) {
    this.minecraftSky.setCycleSpeed(dayDurationSeconds);
  }

  public getSkyState() {
    return this.minecraftSky.getCelestialState();
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

    const dayFactor = THREE.MathUtils.smoothstep(sunHeight, -0.12, 0.22);
    const twilightFactor = 1 - THREE.MathUtils.smoothstep(Math.abs(sunHeight), 0.02, 0.3);
    this.sunLight.color
      .copy(this.nightSunColor)
      .lerp(this.daySunColor, dayFactor)
      .lerp(this.twilightSunColor, twilightFactor * 0.8);
    this.sunLight.intensity = THREE.MathUtils.lerp(0.04, this.currentSettings.sunIntensity, dayFactor) +
      twilightFactor * this.currentSettings.sunIntensity * 0.08;

    this.ambientLight.color
      .copy(this.nightAmbientColor)
      .lerp(this.dayAmbientColor, dayFactor)
      .lerp(this.twilightAmbientColor, twilightFactor * 0.5);
    this.ambientLight.groundColor.copy(this.nightGroundColor).lerp(this.dayGroundColor, dayFactor);
    this.ambientLight.intensity = THREE.MathUtils.lerp(0.08, this.currentSettings.ambientIntensity, dayFactor);
    this.fillLight.intensity = THREE.MathUtils.lerp(0.025, 0.08, dayFactor);
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
