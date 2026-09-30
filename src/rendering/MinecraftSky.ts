import * as THREE from 'three';

/**
 * Authentic Minecraft Sky System:
 * - Square Pixel Sun
 * - 8 Minecraft Moon Phases (Full, Waning Gibbous, Third Quarter, Waning Crescent, New Moon, Waxing Crescent, First Quarter, Waxing Gibbous)
 * - Twinkling 1500 Star Dome
 * - Blocky Minecraft Clouds drifting at y = 82
 * - Day/Night Celestial Rotation with color-accurate fog & ambient transitions
 */
export class MinecraftSky {
  public scene: THREE.Scene;
  public celestialRig: THREE.Group;
  public sunMesh: THREE.Mesh;
  public moonMesh: THREE.Mesh;
  public starPoints: THREE.Points;
  public cloudMesh: THREE.Mesh;

  // Moon phases: 0 to 7
  public currentMoonPhase: number = 0;
  private moonTextures: THREE.CanvasTexture[] = [];

  // Celestial cycle state
  public timeOfDay: number = 0.25; // 0.0 = dawn/sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight
  public dayDurationSec: number = 600; // 10 minutes full Minecraft day (or paused/slider controlled)
  public isTimeRunning: boolean = true;
  private cloudOffset: number = 0;

  // Sky & Fog colors
  private currentSkyColor = new THREE.Color();
  private currentFogColor = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.celestialRig = new THREE.Group();
    this.scene.add(this.celestialRig);

    // 1. Build Square Minecraft Sun
    const sunTexture = this.createSunTexture();
    const sunGeo = new THREE.PlaneGeometry(38, 38);
    const sunMat = new THREE.MeshBasicMaterial({
      map: sunTexture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.sunMesh = new THREE.Mesh(sunGeo, sunMat);
    // Sun placed along +Y or +Z in celestial rig at distance 240
    this.sunMesh.position.set(0, 240, 0);
    this.sunMesh.rotation.x = Math.PI / 2;
    this.celestialRig.add(this.sunMesh);

    // 2. Build 8 Moon Phase Textures & Moon Mesh
    this.initMoonTextures();
    const moonGeo = new THREE.PlaneGeometry(36, 36);
    const moonMat = new THREE.MeshBasicMaterial({
      map: this.moonTextures[0],
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.moonMesh = new THREE.Mesh(moonGeo, moonMat);
    // Moon positioned exactly opposite the sun (distance 240 in -Y)
    this.moonMesh.position.set(0, -240, 0);
    this.moonMesh.rotation.x = -Math.PI / 2;
    this.celestialRig.add(this.moonMesh);

    // 3. Build Minecraft Stars Dome
    this.starPoints = this.createStarDome();
    this.celestialRig.add(this.starPoints);

    // 4. Build Minecraft Clouds Layer
    this.cloudMesh = this.createClouds();
    this.scene.add(this.cloudMesh);

    // Set initial time
    this.setTimeOfDay(0.25);
  }

  /**
   * Generates authentic 64x64 pixel art Minecraft Sun:
   * White glowing inner square, warm yellow outer border, semi-transparent aura.
   */
  private createSunTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    ctx.clearRect(0, 0, 64, 64);

    // Soft outer warm solar aura
    ctx.fillStyle = 'rgba(255, 220, 130, 0.22)';
    ctx.fillRect(8, 8, 48, 48);

    // Mid warm golden corona
    ctx.fillStyle = 'rgba(255, 235, 170, 0.65)';
    ctx.fillRect(16, 16, 32, 32);

    // Inner bright sun square
    ctx.fillStyle = '#fffae8';
    ctx.fillRect(20, 20, 24, 24);

    // Core pure incandescent white
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(24, 24, 16, 16);

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    return texture;
  }

  /**
   * Generates the 8 official Minecraft Moon Phases:
   * Phase 0: Full Moon
   * Phase 1: Waning Gibbous
   * Phase 2: Third Quarter
   * Phase 3: Waning Crescent
   * Phase 4: New Moon (faint dark silhouette)
   * Phase 5: Waxing Crescent
   * Phase 6: First Quarter
   * Phase 7: Waxing Gibbous
   */
  private initMoonTextures() {
    for (let phase = 0; phase < 8; phase++) {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;

      ctx.clearRect(0, 0, 64, 64);

      // Draw 32x32 pixel moon centered at (16, 16)
      const ox = 16;
      const oy = 16;
      const size = 32;

      // Base lunar crater texture for illuminated areas
      const isPixelLit = (px: number, py: number): boolean => {
        // px from 0 to 31 (left to right)
        // Authentic Minecraft moon phase masking:
        switch (phase) {
          case 0: // Full Moon
            return true;
          case 1: // Waning Gibbous (~75% lit, right side darkens)
            return px < 24;
          case 2: // Third Quarter (50% lit, left half)
            return px < 16;
          case 3: // Waning Crescent (25% lit, far left)
            return px < 8;
          case 4: // New Moon (dark / invisible)
            return false;
          case 5: // Waxing Crescent (25% lit, far right)
            return px >= 24;
          case 6: // First Quarter (50% lit, right half)
            return px >= 16;
          case 7: // Waxing Gibbous (75% lit, left side darkens)
            return px >= 8;
          default:
            return true;
        }
      };

      // Draw craters and lunar surface
      for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
          if (isPixelLit(x, y)) {
            // Authentic Minecraft moon silver-white palette with dark crater pixels
            const isCrater =
              (x >= 6 && x <= 10 && y >= 8 && y <= 12) ||
              (x >= 18 && x <= 22 && y >= 16 && y <= 20) ||
              (x >= 10 && x <= 14 && y >= 22 && y <= 25) ||
              ((x + y * 7) % 11 === 0 && x > 2 && x < 30 && y > 2 && y < 30);

            if (isCrater) {
              ctx.fillStyle = '#b0b5be'; // darker silver crater
            } else {
              ctx.fillStyle = (x + y) % 3 === 0 ? '#d4dbe8' : '#f0f4ff'; // bright lunar rock
            }
            ctx.fillRect(ox + x, oy + y, 1, 1);
          } else if (phase === 4) {
            // New Moon: very faint dark blue outline so player can still locate moon
            if (x === 0 || x === size - 1 || y === 0 || y === size - 1) {
              ctx.fillStyle = 'rgba(25, 35, 55, 0.4)';
              ctx.fillRect(ox + x, oy + y, 1, 1);
            }
          }
        }
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      this.moonTextures.push(texture);
    }
  }

  /**
   * Sets current moon phase (0 to 7)
   */
  public setMoonPhase(phase: number) {
    this.currentMoonPhase = (phase % 8 + 8) % 8;
    (this.moonMesh.material as THREE.MeshBasicMaterial).map = this.moonTextures[this.currentMoonPhase];
    (this.moonMesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
  }

  public nextMoonPhase() {
    this.setMoonPhase(this.currentMoonPhase + 1);
  }

  /**
   * Creates 1500 Minecraft star points distributed across celestial sphere
   */
  private createStarDome(): THREE.Points {
    const starCount = 1500;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      // Random direction on sphere
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = 260 + Math.random() * 20;

      const sinPhi = Math.sin(phi);
      positions[i * 3] = r * sinPhi * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * sinPhi * Math.sin(theta);

      // Star color: white with subtle blue and yellow tints
      const tint = Math.random();
      if (tint > 0.85) {
        colors[i * 3] = 0.9;
        colors[i * 3 + 1] = 0.95;
        colors[i * 3 + 2] = 1.0; // blue-white
      } else if (tint > 0.7) {
        colors[i * 3] = 1.0;
        colors[i * 3 + 1] = 0.95;
        colors[i * 3 + 2] = 0.8; // warm yellow
      } else {
        colors[i * 3] = 1.0;
        colors[i * 3 + 1] = 1.0;
        colors[i * 3 + 2] = 1.0; // pure white
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 2.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.0, // Driven dynamically based on time of day
      depthWrite: false,
    });

    return new THREE.Points(geometry, material);
  }

  /**
   * Creates classic Minecraft blocky drifting clouds
   */
  private createClouds(): THREE.Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = 'rgba(0, 0, 0, 0)';
    ctx.fillRect(0, 0, 128, 128);

    // Pixelated blocky cloud clusters
    const drawCloudCluster = (cx: number, cy: number, w: number, h: number) => {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
      ctx.fillRect(cx, cy, w, h);
      // Subtle cloud shading on bottom edge
      ctx.fillStyle = 'rgba(215, 225, 240, 0.85)';
      ctx.fillRect(cx, cy + h - 2, w, 2);
    };

    // Deterministic blocky clusters
    drawCloudCluster(10, 12, 44, 20);
    drawCloudCluster(24, 28, 38, 16);
    drawCloudCluster(72, 18, 48, 22);
    drawCloudCluster(85, 36, 32, 14);
    drawCloudCluster(4, 76, 52, 24);
    drawCloudCluster(68, 80, 56, 26);
    drawCloudCluster(32, 100, 42, 18);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(16, 16);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;

    // Cloud plane placed at y = 82 (authentic Minecraft cloud height)
    const geo = new THREE.PlaneGeometry(600, 600);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 82;
    return mesh;
  }

  /**
   * Sets time of day: 0.0 to 1.0
   * 0.00 = Sunrise / Dawn
   * 0.25 = Noon (Sun high overhead)
   * 0.50 = Sunset (Sun setting in west, Moon rising)
   * 0.75 = Midnight (Moon high overhead, stars bright)
   */
  public setTimeOfDay(time: number) {
    this.timeOfDay = ((time % 1.0) + 1.0) % 1.0;

    // Rotate celestial rig around Z-axis (East to West arc)
    // At noon (0.25): rotation = 0, Sun is at (0, 240, 0)
    const angle = (this.timeOfDay - 0.25) * 2.0 * Math.PI;
    this.celestialRig.rotation.z = angle;

    // Sun height ratio: 1.0 at noon, 0.0 at dawn/sunset, -1.0 at midnight
    const sunHeight = Math.cos(angle);

    // 1. Stars Opacity: Fades to 0 during day, reaches 1.0 at night
    const starOpacity = THREE.MathUtils.clamp(-sunHeight * 1.5, 0, 1.0);
    (this.starPoints.material as THREE.PointsMaterial).opacity = starOpacity;

    // 2. Sky & Fog color transitions
    if (sunHeight > 0.15) {
      // Daytime: Classic Minecraft clear blue
      this.currentSkyColor.setHex(0x78a7ff);
      this.currentFogColor.setHex(0xc0d8ff);
    } else if (sunHeight > -0.15) {
      // Sunset / Dawn: Warm golden-orange horizon
      const t = (sunHeight + 0.15) / 0.3; // 0 to 1
      const sunsetSky = new THREE.Color(0xd35624);
      const daySky = new THREE.Color(0x78a7ff);
      this.currentSkyColor.copy(sunsetSky).lerp(daySky, t);

      const sunsetFog = new THREE.Color(0xeb7734);
      const dayFog = new THREE.Color(0xc0d8ff);
      this.currentFogColor.copy(sunsetFog).lerp(dayFog, t);
    } else {
      // Nighttime: Deep midnight navy
      this.currentSkyColor.setHex(0x0b0e14);
      this.currentFogColor.setHex(0x0e131d);
    }

    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(this.currentSkyColor);
    } else {
      this.scene.background = this.currentSkyColor.clone();
    }

    if (this.scene.fog && this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(this.currentFogColor);
    }
  }

  public getSunDirection(): THREE.Vector3 {
    // Current direction vector to sun
    const dir = new THREE.Vector3(0, 1, 0);
    dir.applyEuler(this.celestialRig.rotation);
    return dir;
  }

  public update(delta: number, playerPos?: THREE.Vector3) {
    // 1. Time progression
    if (this.isTimeRunning) {
      const prevTime = this.timeOfDay;
      this.timeOfDay = (this.timeOfDay + delta / this.dayDurationSec) % 1.0;

      // When passing from night to day (crossing 0.0), advance moon phase!
      if (prevTime > 0.95 && this.timeOfDay < 0.05) {
        this.nextMoonPhase();
      }

      this.setTimeOfDay(this.timeOfDay);
    }

    // 2. Center celestial dome and clouds on player
    if (playerPos) {
      this.celestialRig.position.set(playerPos.x, 0, playerPos.z);
      this.cloudMesh.position.x = playerPos.x;
      this.cloudMesh.position.z = playerPos.z;
    }

    // 3. Scroll clouds smoothly with wind
    this.cloudOffset += delta * 0.003;
    const cloudMat = this.cloudMesh.material as THREE.MeshBasicMaterial;
    if (cloudMat.map) {
      cloudMat.map.offset.x = this.cloudOffset;
      cloudMat.map.offset.y = this.cloudOffset * 0.4;
    }
  }

  public dispose() {
    this.scene.remove(this.celestialRig);
    this.scene.remove(this.cloudMesh);
    this.sunMesh.geometry.dispose();
    (this.sunMesh.material as THREE.Material).dispose();
    this.moonMesh.geometry.dispose();
    (this.moonMesh.material as THREE.Material).dispose();
    for (const t of this.moonTextures) t.dispose();
    this.starPoints.geometry.dispose();
    (this.starPoints.material as THREE.Material).dispose();
    this.cloudMesh.geometry.dispose();
    (this.cloudMesh.material as THREE.Material).dispose();
  }
}
