import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { resourcePacks } from '../resourcepack/ResourcePackManager';

/**
 * Minecraft sky system
 * - Sun / moon use the real textures from /textures/environment (additive blended like vanilla)
 * - 8 moon phases (moon_phase_0..7.png, vanilla order)
 * - Star dome that fades in at night
 * - "Fancy" Minecraft clouds: 12x12 block cells, 4 blocks tall, vanilla face shading
 *   (top 1.0 / bottom 0.7 / N-S 0.8 / E-W 0.9), vanilla cloud colour curve, 0.6 blocks/s drift,
 *   and a GLSL shader that does the distance fade-out. Ported from the vanilla cloud renderer.
 * - Continuous day/night cycle (time 0.25 = noon, 0.5 = sunset, 0.75 = midnight, 0 = sunrise)
 */

// ---- Vanilla cloud constants ----
const CLOUD_CELL = 12; // blocks per cloud texel
const CLOUD_THICKNESS = 4; // blocks
const CLOUD_Y = 108; // base height of the cloud layer
const CLOUD_RADIUS = 20; // cells rendered around the camera
const CLOUD_SPEED = 0.6; // blocks / second (0.03 blocks per tick)
let MASK_W = 256; // vanilla clouds.png is 256x256
let MASK_H = 256;

const CLOUD_VERT = /* glsl */ `
  attribute float shade;
  uniform vec2 uCenter;
  varying float vShade;
  varying float vDist;
  void main() {
    vShade = shade;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vDist = length(wp.xz - uCenter);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const CLOUD_FRAG = /* glsl */ `
  uniform vec3 uTint;
  uniform float uAlpha;
  uniform float uFadeStart;
  uniform float uFadeEnd;
  varying float vShade;
  varying float vDist;
  void main() {
    float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, vDist);
    if (fade < 0.01) discard;
    gl_FragColor = vec4(uTint * vShade, uAlpha * fade);
    #include <colorspace_fragment>
  }
`;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MinecraftSky {
  public scene: THREE.Scene;
  public celestialRig: THREE.Group;
  public sunMesh: THREE.Mesh;
  public moonMesh: THREE.Mesh;
  public starPoints: THREE.Points;
  public cloudMesh: THREE.Mesh;

  public currentMoonPhase: number = 0;
  private moonTextures: THREE.Texture[] = [];
  private sunTexture: THREE.Texture;

  public timeOfDay: number = 0.25;
  public dayDurationSec: number = 600;
  public isTimeRunning: boolean = true;

  private currentSkyColor = new THREE.Color();
  private currentFogColor = new THREE.Color();

  // Clouds
  private cloudMask: Uint8Array = new Uint8Array(256 * 256);
  private defaultCloudMask: Uint8Array | null = null;
  private defaultSun!: THREE.Texture;
  private defaultMoons: THREE.Texture[] = [];
  private cloudMaterial: THREE.ShaderMaterial;
  private cloudScroll = 0;
  private cloudCellX = Number.NaN;
  private cloudCellZ = Number.NaN;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.celestialRig = new THREE.Group();
    this.scene.add(this.celestialRig);

    const loader = new THREE.TextureLoader();
    const prep = (t: THREE.Texture) => {
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };

    // 1. Sun (vanilla: additive, drawn at distance with fog disabled)
    this.sunTexture = prep(loader.load('/textures/environment/celestial/sun.png'));
    this.sunMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(72, 72),
      new THREE.MeshBasicMaterial({
        map: this.sunTexture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      })
    );
    this.sunMesh.position.set(0, 240, 0);
    this.sunMesh.rotation.x = Math.PI / 2;
    this.sunMesh.renderOrder = -10;
    this.celestialRig.add(this.sunMesh);

    // 2. Moon + 8 phases (literal paths so the asset bundler can resolve them)
    const moonPaths = [
      '/textures/environment/celestial/moon/full_moon.png',
      '/textures/environment/celestial/moon/waning_gibbous.png',
      '/textures/environment/celestial/moon/third_quarter.png',
      '/textures/environment/celestial/moon/waning_crescent.png',
      '/textures/environment/celestial/moon/new_moon.png',
      '/textures/environment/celestial/moon/waxing_crescent.png',
      '/textures/environment/celestial/moon/first_quarter.png',
      '/textures/environment/celestial/moon/waxing_gibbous.png',
    ];
    this.moonTextures = moonPaths.map((p) => prep(loader.load(p)));
    this.moonMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(48, 48),
      new THREE.MeshBasicMaterial({
        map: this.moonTextures[0],
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      })
    );
    this.moonMesh.position.set(0, -240, 0);
    this.moonMesh.rotation.x = -Math.PI / 2;
    this.moonMesh.renderOrder = -10;
    this.celestialRig.add(this.moonMesh);

    // 3. Stars
    this.starPoints = this.createStarDome();
    this.celestialRig.add(this.starPoints);

    // 4. Clouds
    this.generateCloudMask(1337);
    this.defaultCloudMask = this.cloudMask;
    this.defaultSun = this.sunTexture;
    this.defaultMoons = this.moonTextures;
    this.cloudMaterial = new THREE.ShaderMaterial({
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      uniforms: {
        uTint: { value: new THREE.Color(1, 1, 1) },
        uAlpha: { value: 0.8 },
        uFadeStart: { value: CLOUD_RADIUS * CLOUD_CELL * 0.55 },
        uFadeEnd: { value: CLOUD_RADIUS * CLOUD_CELL * 0.95 },
        uCenter: { value: new THREE.Vector2() },
      },
      transparent: true,
      depthWrite: true,
      side: THREE.FrontSide,
    });
    this.cloudMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.cloudMaterial);
    this.cloudMesh.frustumCulled = false;
    this.cloudMesh.renderOrder = -5;
    this.scene.add(this.cloudMesh);

    this.setTimeOfDay(0.25);
  }

  // ---------------------------------------------------------------- clouds

  /** Procedural stand-in for vanilla's clouds.png: a 256x256 on/off cell mask. */
  private generateCloudMask(seed: number) {
    const noise = createNoise2D(mulberry32(seed));
    MASK_W = 256;
    MASK_H = 256;
    this.cloudMask = new Uint8Array(MASK_W * MASK_H);
    for (let y = 0; y < MASK_H; y++) {
      for (let x = 0; x < MASK_W; x++) {
        const v =
          noise(x * 0.045, y * 0.045) * 0.65 +
          noise(x * 0.11 + 40, y * 0.11 + 40) * 0.3 +
          noise(x * 0.25 + 90, y * 0.25 + 90) * 0.1;
        this.cloudMask[y * MASK_W + x] = v > 0.18 ? 1 : 0;
      }
    }
  }

  private cloudAt(i: number, j: number): boolean {
    const x = ((i % MASK_W) + MASK_W) % MASK_W;
    const y = ((j % MASK_H) + MASK_H) % MASK_H;
    return this.cloudMask[y * MASK_W + x] === 1;
  }

  /** Builds the cloud mesh around cell (cx, cz) with vanilla culling + face shading. */
  private rebuildClouds(cx: number, cz: number) {
    const positions: number[] = [];
    const shades: number[] = [];
    const indices: number[] = [];
    let v = 0;
    const lin = (s: number) => Math.pow(s, 2.2); // vanilla multiplies in gamma space

    const quad = (p: number[], shade: number) => {
      positions.push(...p);
      const s = lin(shade);
      shades.push(s, s, s, s);
      indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    };

    const H = CLOUD_THICKNESS;
    for (let j = cz - CLOUD_RADIUS; j <= cz + CLOUD_RADIUS; j++) {
      for (let i = cx - CLOUD_RADIUS; i <= cx + CLOUD_RADIUS; i++) {
        if (!this.cloudAt(i, j)) continue;
        const x0 = i * CLOUD_CELL, x1 = x0 + CLOUD_CELL;
        const z0 = j * CLOUD_CELL, z1 = z0 + CLOUD_CELL;

        quad([x0, H, z1, x1, H, z1, x1, H, z0, x0, H, z0], 1.0); // top
        quad([x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1], 0.7); // bottom
        if (!this.cloudAt(i + 1, j)) quad([x1, 0, z1, x1, 0, z0, x1, H, z0, x1, H, z1], 0.9); // +X
        if (!this.cloudAt(i - 1, j)) quad([x0, 0, z0, x0, 0, z1, x0, H, z1, x0, H, z0], 0.9); // -X
        if (!this.cloudAt(i, j + 1)) quad([x0, 0, z1, x1, 0, z1, x1, H, z1, x0, H, z1], 0.8); // +Z
        if (!this.cloudAt(i, j - 1)) quad([x1, 0, z0, x0, 0, z0, x0, H, z0, x1, H, z0], 0.8); // -Z
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('shade', new THREE.Float32BufferAttribute(shades, 1));
    geo.setIndex(indices);
    this.cloudMesh.geometry.dispose();
    this.cloudMesh.geometry = geo;
  }

  /** Vanilla Level.getCloudColor(): white, dimmed by time of day. */
  private updateCloudTint(sunHeight: number) {
    const f = THREE.MathUtils.clamp(sunHeight * 2 + 0.5, 0, 1);
    const r = f * 0.9 + 0.1;
    const b = f * 0.85 + 0.15;
    (this.cloudMaterial.uniforms.uTint.value as THREE.Color).setRGB(
      Math.pow(r, 2.2),
      Math.pow(r, 2.2),
      Math.pow(b, 2.2)
    );
  }

  // ------------------------------------------------------------------ moon

  /** Use sun / moon phases / cloud shape from the enabled resource packs (or the defaults). */
  public async applyResourcePack() {
    const mkTex = (c: HTMLCanvasElement) => {
      const t = new THREE.CanvasTexture(c);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };

    // Sun
    const sun = await resourcePacks.getTexture(['environment/celestial/sun']);
    const oldSun = this.sunTexture;
    this.sunTexture = sun ? mkTex(sun) : this.defaultSun;
    if (oldSun !== this.defaultSun && oldSun !== this.sunTexture) oldSun.dispose();
    (this.sunMesh.material as THREE.MeshBasicMaterial).map = this.sunTexture;
    (this.sunMesh.material as THREE.MeshBasicMaterial).needsUpdate = true;

    // Moon phases: vanilla sheet is 4 columns x 2 rows (phase 0..7, row-major)
    const moonPaths = [
      'environment/celestial/moon/full_moon',
      'environment/celestial/moon/waning_gibbous',
      'environment/celestial/moon/third_quarter',
      'environment/celestial/moon/waning_crescent',
      'environment/celestial/moon/new_moon',
      'environment/celestial/moon/waxing_crescent',
      'environment/celestial/moon/first_quarter',
      'environment/celestial/moon/waxing_gibbous',
    ];
    const packMoons = await Promise.all(moonPaths.map((path) => resourcePacks.getTexture([path])));
    for (const t of this.moonTextures) if (!this.defaultMoons.includes(t)) t.dispose();
    if (packMoons.every(Boolean)) {
      this.moonTextures = packMoons.map((canvas) => mkTex(canvas!));
    } else {
      this.moonTextures = this.defaultMoons;
    }
    this.setMoonPhase(this.currentMoonPhase);

    // Clouds: any non-transparent pixel of clouds.png is a cloud cell
    const clouds = await resourcePacks.getTexture(['environment/clouds']);
    if (clouds) {
      const g = clouds.getContext('2d')!;
      const data = g.getImageData(0, 0, clouds.width, clouds.height).data;
      MASK_W = clouds.width;
      MASK_H = clouds.height;
      this.cloudMask = new Uint8Array(MASK_W * MASK_H);
      for (let i = 0; i < MASK_W * MASK_H; i++) this.cloudMask[i] = data[i * 4 + 3] > 0 ? 1 : 0;
    } else if (this.defaultCloudMask) {
      MASK_W = 256;
      MASK_H = 256;
      this.cloudMask = this.defaultCloudMask;
    }
    this.cloudCellX = Number.NaN; // force a mesh rebuild
  }

  public setMoonPhase(phase: number) {
    this.currentMoonPhase = ((phase % 8) + 8) % 8;
    const mat = this.moonMesh.material as THREE.MeshBasicMaterial;
    mat.map = this.moonTextures[this.currentMoonPhase];
    mat.needsUpdate = true;
  }

  public nextMoonPhase() {
    this.setMoonPhase(this.currentMoonPhase + 1);
  }

  // ----------------------------------------------------------------- stars

  private createStarDome(): THREE.Points {
    const starCount = 1500;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * 2 * Math.PI;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 260 + Math.random() * 20;
      const sp = Math.sin(phi);
      positions[i * 3] = r * sp * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * sp * Math.sin(theta);
      const tint = Math.random();
      const c = tint > 0.85 ? [0.9, 0.95, 1] : tint > 0.7 ? [1, 0.95, 0.8] : [1, 1, 1];
      colors.set(c, i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 2.4,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const pts = new THREE.Points(geometry, material);
    pts.renderOrder = -11;
    return pts;
  }

  // ------------------------------------------------------------ day / night

  /** 1 = full day, 0 = full night (smooth through sunrise/sunset). */
  public getDaylight(): number {
    const h = Math.cos((this.timeOfDay - 0.25) * 2 * Math.PI);
    return THREE.MathUtils.smoothstep(h, -0.2, 0.3);
  }

  /**
   * 0.0 = sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight
   */
  public setTimeOfDay(time: number) {
    this.timeOfDay = ((time % 1) + 1) % 1;

    const angle = (this.timeOfDay - 0.25) * 2 * Math.PI;
    this.celestialRig.rotation.z = angle;
    const sunHeight = Math.cos(angle);

    (this.starPoints.material as THREE.PointsMaterial).opacity = THREE.MathUtils.clamp(-sunHeight * 2.0 + 0.1, 0, 1);

    // Continuous sky / fog colour (night -> sunset -> day)
    const night = { sky: 0x0b0e14, fog: 0x0e131d };
    const dusk = { sky: 0xb8643e, fog: 0xeb8a4a };
    const day = { sky: 0x78a7ff, fog: 0xc0d8ff };
    const a = new THREE.Color();
    const b = new THREE.Color();
    if (sunHeight >= 0.25) {
      this.currentSkyColor.setHex(day.sky);
      this.currentFogColor.setHex(day.fog);
    } else if (sunHeight >= 0) {
      const t = sunHeight / 0.25;
      this.currentSkyColor.setHex(dusk.sky).lerp(a.setHex(day.sky), t);
      this.currentFogColor.setHex(dusk.fog).lerp(b.setHex(day.fog), t);
    } else if (sunHeight >= -0.25) {
      const t = (sunHeight + 0.25) / 0.25;
      this.currentSkyColor.setHex(night.sky).lerp(a.setHex(dusk.sky), t);
      this.currentFogColor.setHex(night.fog).lerp(b.setHex(dusk.fog), t);
    } else {
      this.currentSkyColor.setHex(night.sky);
      this.currentFogColor.setHex(night.fog);
    }

    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(this.currentSkyColor);
    } else {
      this.scene.background = this.currentSkyColor.clone();
    }
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(this.currentFogColor);
    }

    this.updateCloudTint(sunHeight);
  }

  public getSunDirection(): THREE.Vector3 {
    return new THREE.Vector3(0, 1, 0).applyEuler(this.celestialRig.rotation);
  }

  public update(delta: number, playerPos?: THREE.Vector3) {
    if (this.isTimeRunning) {
      const prev = this.timeOfDay;
      this.timeOfDay = (this.timeOfDay + delta / this.dayDurationSec) % 1;
      if (prev > 0.95 && this.timeOfDay < 0.05) this.nextMoonPhase();
      this.setTimeOfDay(this.timeOfDay);
    }

    const px = playerPos?.x ?? 0;
    const py = playerPos?.y ?? 0;
    const pz = playerPos?.z ?? 0;
    this.celestialRig.position.set(px, py, pz);

    // Clouds drift along +X like vanilla; the mesh is rebuilt when the camera crosses a cell
    this.cloudScroll += delta * CLOUD_SPEED;
    this.cloudMesh.position.set(this.cloudScroll, CLOUD_Y, 0);
    const cx = Math.floor((px - this.cloudScroll) / CLOUD_CELL);
    const cz = Math.floor(pz / CLOUD_CELL);
    if (cx !== this.cloudCellX || cz !== this.cloudCellZ) {
      this.cloudCellX = cx;
      this.cloudCellZ = cz;
      this.rebuildClouds(cx, cz);
    }
    (this.cloudMaterial.uniforms.uCenter.value as THREE.Vector2).set(px, pz);
  }

  public dispose() {
    this.scene.remove(this.celestialRig);
    this.scene.remove(this.cloudMesh);
    this.sunMesh.geometry.dispose();
    (this.sunMesh.material as THREE.Material).dispose();
    this.sunTexture.dispose();
    this.moonMesh.geometry.dispose();
    (this.moonMesh.material as THREE.Material).dispose();
    for (const t of this.moonTextures) t.dispose();
    this.starPoints.geometry.dispose();
    (this.starPoints.material as THREE.Material).dispose();
    this.cloudMesh.geometry.dispose();
    this.cloudMaterial.dispose();
  }
}
