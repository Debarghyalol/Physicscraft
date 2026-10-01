import * as THREE from 'three';

/**
 * Minecraft-style sky system:
 * - Square Pixel Sun
 * - 8 Minecraft Moon Phases (Full, Waning Gibbous, Third Quarter, Waning Crescent, New Moon, Waxing Crescent, First Quarter, Waxing Gibbous)
 * - Twinkling 1500 Star Dome
 * - Blocky Minecraft Clouds drifting at y = 82
 * - Day/Night Celestial Rotation with color-accurate fog & ambient transitions
 */
export class MinecraftSky {
  public scene: THREE.Scene;
  public celestialRig: THREE.Group;
  public sunMesh: THREE.Sprite;
  public moonMesh: THREE.Sprite;
  public starPoints: THREE.Points;
  public cloudMesh: THREE.Mesh;

  // Moon phases: 0 to 7
  public currentMoonPhase: number = 0;
  private moonTextures: THREE.Texture[] = [];

  // Celestial cycle state
  public timeOfDay: number = 0.25; // 0.0 = dawn/sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight
  public dayDurationSec: number = 1200; // Minecraft's 20-minute day
  public isTimeRunning: boolean = true;
  private cloudOffset: number = 0;
  private readonly celestialOrbitRadius = 320;

  // Sky & Fog colors
  private currentSkyColor = new THREE.Color();
  private currentFogColor = new THREE.Color();
  private readonly nightSkyColor = new THREE.Color(0x0f172a);
  private readonly daySkyColor = new THREE.Color(0x7aa8ff);
  private readonly twilightSkyColor = new THREE.Color(0xe38d5c);
  private readonly nightFogColor = new THREE.Color(0x111c2d);
  private readonly dayFogColor = new THREE.Color(0x98bdf4);
  private readonly twilightFogColor = new THREE.Color(0xd47b50);
  private readonly nightCloudColor = new THREE.Color(0x46556d);
  private readonly dayCloudColor = new THREE.Color(0xdbe5f0);
  private readonly twilightCloudColor = new THREE.Color(0xd4a58a);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.celestialRig = new THREE.Group();
    this.scene.add(this.celestialRig);

    // 1. Load the bundled Minecraft-style sun texture
    const sunTexture = this.loadSkyTexture('/textures/environment/sun.png');
    const sunMat = new THREE.SpriteMaterial({
      map: sunTexture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.sunMesh = new THREE.Sprite(sunMat);
    this.sunMesh.scale.set(32, 32, 1);
    this.celestialRig.add(this.sunMesh);

    // 2. Build 8 Moon Phase Textures & Moon Mesh
    this.initMoonTextures();
    const moonMat = new THREE.SpriteMaterial({
      map: this.moonTextures[0],
      transparent: true,
      depthWrite: false,
    });
    this.moonMesh = new THREE.Sprite(moonMat);
    this.moonMesh.scale.set(30, 30, 1);
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

  private loadSkyTexture(path: string): THREE.Texture {
    const texture = new THREE.TextureLoader().load(path);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    return texture;
  }

  /**
  * Loads the eight bundled moon phase textures:
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
      this.moonTextures.push(this.loadSkyTexture(`/textures/environment/moon_phase_${phase}.png`));
    }
  }

  /**
   * Sets current moon phase (0 to 7)
   */
  public setMoonPhase(phase: number) {
    this.currentMoonPhase = (phase % 8 + 8) % 8;
    (this.moonMesh.material as THREE.SpriteMaterial).map = this.moonTextures[this.currentMoonPhase];
    (this.moonMesh.material as THREE.SpriteMaterial).needsUpdate = true;
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

    const drawCloudCluster = (cx: number, cy: number, w: number, h: number) => {
      ctx.fillStyle = '#c3ccd6';
      ctx.fillRect(cx, cy + 8, w, h - 8);
      ctx.fillStyle = '#e1e7ed';
      ctx.fillRect(cx + 8, cy + 4, w - 16, h - 8);
      ctx.fillStyle = '#f1f4f7';
      ctx.fillRect(cx + 16, cy, w - 32, h - 8);
    };

    drawCloudCluster(0, 12, 64, 24);
    drawCloudCluster(32, 4, 48, 24);
    drawCloudCluster(88, 16, 40, 24);
    drawCloudCluster(16, 68, 56, 24);
    drawCloudCluster(48, 60, 64, 24);
    drawCloudCluster(96, 72, 32, 24);
    drawCloudCluster(0, 108, 48, 20);
    drawCloudCluster(72, 108, 56, 20);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(6, 6);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;

    // Cloud plane placed at y = 82 (authentic Minecraft cloud height)
    const geo = new THREE.PlaneGeometry(600, 600);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.72,
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
  public setCycleSpeed(dayDurationSeconds: number) {
    this.dayDurationSec = Math.max(30, dayDurationSeconds);
  }

  public getCelestialState() {
    const orbitAngle = ((this.timeOfDay - 0.25) * 2.0 * Math.PI) + (Math.PI / 2.0);
    const sunHeight = Math.sin(orbitAngle);
    const dayFactor = THREE.MathUtils.smoothstep(sunHeight, -0.12, 0.22);
    const twilightFactor = 1 - THREE.MathUtils.smoothstep(Math.abs(sunHeight), 0.02, 0.3);

    return {
      timeOfDay: this.timeOfDay,
      sunHeight,
      dayFactor,
      twilightFactor,
      isDay: dayFactor > 0.5,
      isNight: dayFactor < 0.25,
      sunDirection: this.getSunDirection(),
      moonPhase: this.currentMoonPhase,
    };
  }

  public setTimeOfDay(time: number) {
    this.timeOfDay = ((time % 1.0) + 1.0) % 1.0;

    // Orbit the sun and moon in a proper sky arc. Noon sits at the zenith;
    // sunrise/sunset stay on the horizon, and midnight hides the sun behind the planet.
    const orbitAngle = ((this.timeOfDay - 0.25) * 2.0 * Math.PI) + (Math.PI / 2.0);
    const sunX = Math.cos(orbitAngle) * this.celestialOrbitRadius;
    const sunY = Math.sin(orbitAngle) * this.celestialOrbitRadius * 0.45;

    this.sunMesh.position.set(sunX, sunY, 0);
    this.moonMesh.position.set(-sunX, -sunY, 0);

    // Sun height ratio: 1.0 at noon, 0.0 at dawn/sunset, -1.0 at midnight
    const sunHeight = Math.sin(orbitAngle);

    // Stars fade around dawn and dusk rather than switching abruptly.
    const starOpacity = 1 - THREE.MathUtils.smoothstep(sunHeight, -0.12, 0.12);
    (this.starPoints.material as THREE.PointsMaterial).opacity = starOpacity;

    const dayFactor = THREE.MathUtils.smoothstep(sunHeight, -0.12, 0.22);
    const twilightFactor = 1 - THREE.MathUtils.smoothstep(Math.abs(sunHeight), 0.02, 0.3);
    this.currentSkyColor
      .copy(this.nightSkyColor)
      .lerp(this.daySkyColor, dayFactor)
      .lerp(this.twilightSkyColor, twilightFactor * 0.72);
    this.currentFogColor
      .copy(this.nightFogColor)
      .lerp(this.dayFogColor, dayFactor)
      .lerp(this.twilightFogColor, twilightFactor * 0.58);

    const cloudMaterial = this.cloudMesh.material as THREE.MeshBasicMaterial;
    cloudMaterial.color
      .copy(this.nightCloudColor)
      .lerp(this.dayCloudColor, dayFactor)
      .lerp(this.twilightCloudColor, twilightFactor * 0.5);

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
    // Current direction vector to sun based on the actual celestial orbit position.
    const dir = new THREE.Vector3(this.sunMesh.position.x, this.sunMesh.position.y, this.sunMesh.position.z);
    return dir.normalize();
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
    (this.sunMesh.material as THREE.Material).dispose();
    (this.moonMesh.material as THREE.Material).dispose();
    for (const t of this.moonTextures) t.dispose();
    ((this.sunMesh.material as THREE.SpriteMaterial).map as THREE.Texture | null)?.dispose();
    this.starPoints.geometry.dispose();
    (this.starPoints.material as THREE.Material).dispose();
    this.cloudMesh.geometry.dispose();
    (this.cloudMesh.material as THREE.Material).dispose();
  }
}
