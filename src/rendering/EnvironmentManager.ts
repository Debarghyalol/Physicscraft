import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export type SkyPreset = 'daylight' | 'sunset' | 'dawn' | 'studio' | 'twilight';

export interface EnvironmentSettings {
  preset: SkyPreset;
  elevation: number;    // Sun elevation in degrees (0 to 90)
  azimuth: number;      // Sun azimuth in degrees (0 to 360)
  turbidity: number;    // 1 to 10 (haze/dust)
  rayleigh: number;     // 0.5 to 4 (sky blue scattering)
  mieCoefficient: number; // 0.001 to 0.1
  mieDirectionalG: number; // 0.5 to 0.99
  sunIntensity: number; // 0.5 to 3.0
  ambientIntensity: number; // 0.2 to 1.5
}

export const SKY_PRESETS: Record<SkyPreset, EnvironmentSettings> = {
  daylight: {
    preset: 'daylight',
    elevation: 48,
    azimuth: 180,
    turbidity: 4.5,
    rayleigh: 1.8,
    mieCoefficient: 0.005,
    mieDirectionalG: 0.8,
    sunIntensity: 2.2,
    ambientIntensity: 0.85,
  },
  sunset: {
    preset: 'sunset',
    elevation: 3.5,
    azimuth: 195,
    turbidity: 8.0,
    rayleigh: 3.2,
    mieCoefficient: 0.02,
    mieDirectionalG: 0.85,
    sunIntensity: 2.6,
    ambientIntensity: 0.7,
  },
  dawn: {
    preset: 'dawn',
    elevation: 9.0,
    azimuth: 85,
    turbidity: 3.5,
    rayleigh: 2.4,
    mieCoefficient: 0.008,
    mieDirectionalG: 0.82,
    sunIntensity: 1.9,
    ambientIntensity: 0.8,
  },
  studio: {
    preset: 'studio',
    elevation: 65,
    azimuth: 140,
    turbidity: 1.5,
    rayleigh: 0.8,
    mieCoefficient: 0.002,
    mieDirectionalG: 0.75,
    sunIntensity: 1.8,
    ambientIntensity: 1.1,
  },
  twilight: {
    preset: 'twilight',
    elevation: 0.5,
    azimuth: 220,
    turbidity: 10.0,
    rayleigh: 4.0,
    mieCoefficient: 0.05,
    mieDirectionalG: 0.9,
    sunIntensity: 1.2,
    ambientIntensity: 0.5,
  },
};

export class EnvironmentManager {
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;

  public sky: Sky;
  public sunLight: THREE.DirectionalLight;
  public fillLight: THREE.DirectionalLight;
  public ambientLight: THREE.HemisphereLight;

  private sunPosition: THREE.Vector3 = new THREE.Vector3();
  public currentSettings: EnvironmentSettings;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.renderer = renderer;

    this.currentSettings = { ...SKY_PRESETS.daylight };

    // 1. Procedural Preetham Sky Mesh
    this.sky = new Sky();
    this.sky.scale.setScalar(450000);
    this.scene.add(this.sky);

    // 2. Key Sun Light with soft PCF shadows
    this.sunLight = new THREE.DirectionalLight(0xfff8ee, this.currentSettings.sunIntensity);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 120;
    const shadowD = 22;
    this.sunLight.shadow.camera.left = -shadowD;
    this.sunLight.shadow.camera.right = shadowD;
    this.sunLight.shadow.camera.top = shadowD;
    this.sunLight.shadow.camera.bottom = -shadowD;
    this.sunLight.shadow.bias = -0.0004;
    this.scene.add(this.sunLight);

    // 3. Fill Directional Light
    this.fillLight = new THREE.DirectionalLight(0x93c5fd, 0.6);
    this.fillLight.position.set(-15, 15, -15);
    this.scene.add(this.fillLight);

    // 4. Ambient / Hemisphere Light
    this.ambientLight = new THREE.HemisphereLight(0xffffff, 0x334155, this.currentSettings.ambientIntensity);
    this.scene.add(this.ambientLight);

    // Dynamic distance & atmospheric fog
    this.scene.fog = new THREE.FogExp2(0xdbeafe, 0.012);

    this.applySettings(this.currentSettings);
  }

  public setPreset(preset: SkyPreset) {
    this.applySettings({ ...SKY_PRESETS[preset] });
  }

  public setShadowsEnabled(enabled: boolean) {
    this.sunLight.castShadow = enabled;
    this.renderer.shadowMap.enabled = enabled;
  }

  public setUndergroundLighting(isUnderground: boolean) {
    if (isUnderground) {
      this.sunLight.intensity = THREE.MathUtils.lerp(this.sunLight.intensity, 0.2, 0.15);
      this.ambientLight.intensity = THREE.MathUtils.lerp(this.ambientLight.intensity, 0.35, 0.15);
      if (this.scene.fog && this.scene.fog instanceof THREE.FogExp2) {
        this.scene.fog.color.lerp(new THREE.Color(0x0e0e14), 0.15);
        this.scene.fog.density = THREE.MathUtils.lerp(this.scene.fog.density, 0.032, 0.15);
      }
    } else {
      this.sunLight.intensity = THREE.MathUtils.lerp(this.sunLight.intensity, this.currentSettings.sunIntensity, 0.08);
      this.ambientLight.intensity = THREE.MathUtils.lerp(this.ambientLight.intensity, this.currentSettings.ambientIntensity, 0.08);
      if (this.scene.fog && this.scene.fog instanceof THREE.FogExp2) {
        this.scene.fog.color.lerp(new THREE.Color(0xdbeafe), 0.08);
        this.scene.fog.density = THREE.MathUtils.lerp(this.scene.fog.density, 0.012, 0.08);
      }
    }
  }

  public applySettings(settings: Partial<EnvironmentSettings>) {
    this.currentSettings = { ...this.currentSettings, ...settings };

    const {
      elevation,
      azimuth,
      turbidity,
      rayleigh,
      mieCoefficient,
      mieDirectionalG,
      sunIntensity,
      ambientIntensity,
    } = this.currentSettings;

    // Update Sky Uniforms
    const uniforms = this.sky.material.uniforms;
    uniforms['turbidity'].value = turbidity;
    uniforms['rayleigh'].value = rayleigh;
    uniforms['mieCoefficient'].value = mieCoefficient;
    uniforms['mieDirectionalG'].value = mieDirectionalG;

    // Calculate Sun position from spherical coordinates
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    this.sunPosition.setFromSphericalCoords(1, phi, theta);

    uniforms['sunPosition'].value.copy(this.sunPosition);

    // Position Sun Light to match sky sun disc
    this.sunLight.position.copy(this.sunPosition).multiplyScalar(50);
    this.sunLight.intensity = sunIntensity;

    // Adjust light color temperature based on sun elevation
    if (elevation < 8) {
      // Golden / Sunset glow
      this.sunLight.color.setHex(0xf97316);
      this.ambientLight.color.setHex(0xfde047);
      this.ambientLight.groundColor.setHex(0x1e1b4b);
      this.scene.fog = new THREE.FogExp2(0xfbcfe8, 0.008);
    } else if (elevation < 18) {
      // Warm Morning / Dawn
      this.sunLight.color.setHex(0xfef08a);
      this.ambientLight.color.setHex(0xe0f2fe);
      this.ambientLight.groundColor.setHex(0x334155);
      this.scene.fog = new THREE.FogExp2(0xe0f2fe, 0.007);
    } else {
      // Daylight
      this.sunLight.color.setHex(0xfffbeb);
      this.ambientLight.color.setHex(0xffffff);
      this.ambientLight.groundColor.setHex(0x475569);
      this.scene.fog = new THREE.FogExp2(0xdbeafe, 0.006);
    }

    this.ambientLight.intensity = ambientIntensity;

    // Set tone mapping for atmospheric fidelity
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
  }

  public dispose() {
    this.scene.remove(this.sky);
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.scene.remove(this.sunLight);
    this.scene.remove(this.fillLight);
    this.scene.remove(this.ambientLight);
  }
}
