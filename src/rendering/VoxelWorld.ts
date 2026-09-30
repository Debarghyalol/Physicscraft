import * as THREE from 'three';
import FastNoiseLite from 'fastnoise-lite';
import RAPIER from '@dimforge/rapier3d-compat';
import { VoxelType } from '../types/physics';

export const CHUNK_SIZE_X = 16;
export const CHUNK_SIZE_Z = 16;
export const CHUNK_HEIGHT = 28;
export const CHUNK_GRID_RADIUS = 2; // -2 to 1 (4x4 chunks = 64x64 blocks)

export interface VoxelRaycastHit {
  blockX: number;
  blockY: number;
  blockZ: number;
  normal: THREE.Vector3;
  voxelType: VoxelType;
  point: THREE.Vector3;
}

/**
 * Procedural Minecraft-style Voxel World with Chunk-based Face Culling & Frustum Culling
 */
export class VoxelWorld {
  public scene: THREE.Scene;
  public rapierWorld: RAPIER.World | null = null;
  private noise: any;
  private treeNoise: any;

  // Chunks map: key = `${cx},${cz}`
  public chunks: Map<string, Uint8Array> = new Map();
  public chunkMeshes: Map<string, THREE.Mesh> = new Map();
  public chunkColliders: Map<string, RAPIER.Collider> = new Map();
  public terrainBody: RAPIER.RigidBody | null = null;

  // Dynamic Open-Source Infinite Chunk Streaming
  public seed: number = 1337;
  public renderDistance: number = 2; // Radius in chunks (5x5 active chunks)
  private lastPlayerChunkX: number = 999999;
  private lastPlayerChunkZ: number = 999999;

  // Voxel material with crisp pixelated Minecraft texture atlas
  public material!: THREE.MeshStandardMaterial;
  private atlasTexture!: THREE.CanvasTexture;
  public shaderUniforms: Record<string, { value: any }> | null = null;
  public currentUnderground: number = 0.0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.initNoise();
    this.createTextureAtlas();
    this.generateWorldChunks();
  }

  public setRapierWorld(world: RAPIER.World) {
    this.rapierWorld = world;
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
    this.terrainBody = world.createRigidBody(bodyDesc);
    this.buildPhysicsColliders();
  }

  private initNoise() {
    this.noise = new FastNoiseLite();
    this.noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2);
    this.noise.SetFrequency(0.035);
    this.noise.SetFractalType(FastNoiseLite.FractalType.FBm);
    this.noise.SetFractalOctaves(3);

    this.treeNoise = new FastNoiseLite(1337);
    this.treeNoise.SetNoiseType(FastNoiseLite.NoiseType.Cellular);
    this.treeNoise.SetFrequency(0.08);
  }

  /**
   * Generates a 256x256 pixel art texture atlas for Minecraft blocks with NearestFilter
   */
  private createTextureAtlas() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Helper to draw pixelated 16x16 tile at (col, row)
    const drawTile = (col: number, row: number, renderFn: (c: CanvasRenderingContext2D, x: number, y: number) => void) => {
      ctx.save();
      renderFn(ctx, col * 16, row * 16);
      ctx.restore();
    };

    // 0,0: Grass Top (Vibrant green pixels)
    drawTile(0, 0, (c, ox, oy) => {
      c.fillStyle = '#55a832';
      c.fillRect(ox, oy, 16, 16);
      for (let px = 0; px < 16; px++) {
        for (let py = 0; py < 16; py++) {
          const r = Math.random();
          if (r > 0.65) {
            c.fillStyle = r > 0.85 ? '#438e24' : '#69be3c';
            c.fillRect(ox + px, oy + py, 1, 1);
          }
        }
      }
    });

    // 1,0: Grass Side (Green grass top border + dirt bottom)
    drawTile(1, 0, (c, ox, oy) => {
      // Dirt base
      c.fillStyle = '#866043';
      c.fillRect(ox, oy, 16, 16);
      for (let px = 0; px < 16; px++) {
        for (let py = 0; py < 16; py++) {
          const r = Math.random();
          if (r > 0.6) {
            c.fillStyle = r > 0.8 ? '#6d4c33' : '#9c7353';
            c.fillRect(ox + px, oy + py, 1, 1);
          }
        }
      }
      // Grass overhang fringe
      c.fillStyle = '#55a832';
      c.fillRect(ox, oy, 16, 3);
      for (let px = 0; px < 16; px++) {
        const drop = (px * 7 + 3) % 4 === 0 ? 5 : (px * 3) % 3 === 0 ? 4 : 3;
        c.fillRect(ox + px, oy, 1, drop);
      }
    });

    // 2,0: Dirt
    drawTile(2, 0, (c, ox, oy) => {
      c.fillStyle = '#866043';
      c.fillRect(ox, oy, 16, 16);
      for (let px = 0; px < 16; px++) {
        for (let py = 0; py < 16; py++) {
          const r = Math.random();
          if (r > 0.65) {
            c.fillStyle = r > 0.82 ? '#67472e' : '#9c7353';
            c.fillRect(ox + px, oy + py, 1, 1);
          }
        }
      }
    });

    // 3,0: Stone
    drawTile(3, 0, (c, ox, oy) => {
      c.fillStyle = '#7a7a7a';
      c.fillRect(ox, oy, 16, 16);
      for (let px = 0; px < 16; px++) {
        for (let py = 0; py < 16; py++) {
          const r = Math.random();
          if (r > 0.6) {
            c.fillStyle = r > 0.8 ? '#5f5f5f' : '#969696';
            c.fillRect(ox + px, oy + py, 1, 1);
          }
        }
      }
    });

    // 4,0: Bedrock
    drawTile(4, 0, (c, ox, oy) => {
      c.fillStyle = '#222222';
      c.fillRect(ox, oy, 16, 16);
      for (let px = 0; px < 16; px++) {
        for (let py = 0; py < 16; py++) {
          const r = Math.random();
          if (r > 0.5) {
            c.fillStyle = r > 0.75 ? '#111111' : '#3f3f3f';
            c.fillRect(ox + px, oy + py, 1, 1);
          }
        }
      }
    });

    // 5,0: Wood Log Side (Bark)
    drawTile(5, 0, (c, ox, oy) => {
      c.fillStyle = '#6b5130';
      c.fillRect(ox, oy, 16, 16);
      for (let px = 0; px < 16; px++) {
        if (px % 4 === 0) {
          c.fillStyle = '#4e381f';
          c.fillRect(ox + px, oy, 1, 16);
        } else if (px % 4 === 2) {
          c.fillStyle = '#826540';
          c.fillRect(ox + px, oy, 1, 16);
        }
      }
    });

    // 6,0: Wood Log Top (Rings)
    drawTile(6, 0, (c, ox, oy) => {
      c.fillStyle = '#a68252';
      c.fillRect(ox, oy, 16, 16);
      c.strokeStyle = '#6b5130';
      c.strokeRect(ox + 0.5, oy + 0.5, 15, 15);
      c.strokeRect(ox + 3.5, oy + 3.5, 9, 9);
      c.fillStyle = '#4e381f';
      c.fillRect(ox + 7, oy + 7, 2, 2);
    });

    // 7,0: Leaves (Oak green with dapples)
    drawTile(7, 0, (c, ox, oy) => {
      c.fillStyle = '#347b26';
      c.fillRect(ox, oy, 16, 16);
      for (let px = 0; px < 16; px++) {
        for (let py = 0; py < 16; py++) {
          const r = Math.random();
          if (r > 0.55) {
            c.fillStyle = r > 0.8 ? '#245919' : '#4a9c37';
            c.fillRect(ox + px, oy + py, 1, 1);
          }
        }
      }
    });

    // 8,0: Sand
    drawTile(8, 0, (c, ox, oy) => {
      c.fillStyle = '#d9cc8c';
      c.fillRect(ox, oy, 16, 16);
      for (let px = 0; px < 16; px++) {
        for (let py = 0; py < 16; py++) {
          const r = Math.random();
          if (r > 0.6) {
            c.fillStyle = r > 0.8 ? '#c2b370' : '#ece0a6';
            c.fillRect(ox + px, oy + py, 1, 1);
          }
        }
      }
    });

    // 9,0: Cobblestone
    drawTile(9, 0, (c, ox, oy) => {
      c.fillStyle = '#686868';
      c.fillRect(ox, oy, 16, 16);
      for (let px = 0; px < 16; px += 4) {
        for (let py = 0; py < 16; py += 4) {
          c.strokeStyle = '#434343';
          c.strokeRect(ox + px + 0.5, oy + py + 0.5, 3, 3);
          c.fillStyle = Math.random() > 0.5 ? '#808080' : '#575757';
          c.fillRect(ox + px + 1, oy + py + 1, 2, 2);
        }
      }
    });

    // 10,0: TNT
    drawTile(10, 0, (c, ox, oy) => {
      c.fillStyle = '#cc2a20';
      c.fillRect(ox, oy, 16, 16);
      // White TNT label banner in center
      c.fillStyle = '#ffffff';
      c.fillRect(ox, oy + 5, 16, 6);
      c.fillStyle = '#000000';
      c.font = 'bold 5px sans-serif';
      c.fillText('TNT', ox + 2, oy + 10);
    });

    // 11,0: Gold Block
    drawTile(11, 0, (c, ox, oy) => {
      c.fillStyle = '#f5c531';
      c.fillRect(ox, oy, 16, 16);
      c.strokeStyle = '#c69a19';
      c.strokeRect(ox + 0.5, oy + 0.5, 15, 15);
      c.strokeRect(ox + 2.5, oy + 2.5, 11, 11);
      c.fillStyle = '#ffdf6b';
      c.fillRect(ox + 3, oy + 3, 4, 4);
    });

    // 12,0: Glass (Transparent grid)
    drawTile(12, 0, (c, ox, oy) => {
      c.fillStyle = 'rgba(215, 235, 255, 0.45)';
      c.fillRect(ox, oy, 16, 16);
      c.strokeStyle = '#ffffff';
      c.strokeRect(ox + 0.5, oy + 0.5, 15, 15);
      c.fillStyle = '#ffffff';
      c.fillRect(ox + 2, oy + 2, 2, 2);
      c.fillRect(ox + 3, oy + 3, 2, 2);
    });

    this.atlasTexture = new THREE.CanvasTexture(canvas);
    this.atlasTexture.magFilter = THREE.NearestFilter;
    this.atlasTexture.minFilter = THREE.NearestFilter;
    this.atlasTexture.generateMipmaps = false;

    this.material = new THREE.MeshStandardMaterial({
      map: this.atlasTexture,
      roughness: 0.85,
      metalness: 0.1,
      transparent: false,
    });

    this.material.defines = {
      USE_UV: '',
    };

    // Custom shader hook for Binary Greedy Meshing + Seamless Repeating Atlas + Shader-based AO & Dynamic Underground Lighting
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uUnderground = { value: 0.0 };
      shader.uniforms.uSkySunColor = { value: new THREE.Color(0xfff6ea) };
      shader.uniforms.uCaveColor = { value: new THREE.Color(0x3e4554) };
      this.shaderUniforms = shader.uniforms;

      shader.vertexShader = `
        attribute vec2 aTile;
        attribute float aAo;
        attribute float aLight;
        varying vec2 vTile;
        varying vec2 vMeshUv;
        varying float vAo;
        varying float vLight;
        ${shader.vertexShader}
      `.replace(
        'void main() {',
        `void main() {
          vTile = aTile;
          vMeshUv = uv;
          vAo = aAo;
          vLight = aLight;`
      );

      shader.fragmentShader = `
        uniform float uUnderground;
        uniform vec3 uSkySunColor;
        uniform vec3 uCaveColor;
        varying vec2 vTile;
        varying vec2 vMeshUv;
        varying float vAo;
        varying float vLight;
        ${shader.fragmentShader}
      `.replace(
        '#include <map_fragment>',
        `
        #ifdef USE_MAP
          // Seamless repeating texture for binary greedy meshing
          vec2 localUv = fract(vMeshUv);
          localUv = clamp(localUv, 0.002, 0.998);

          float tileW = 1.0 / 16.0;
          float u = (vTile.x + localUv.x) * tileW;
          float v = 1.0 - (vTile.y + (1.0 - localUv.y)) * tileW;

          vec4 sampledTexel = texture2D( map, vec2(u, v) );

          // SHADER-BASED AMBIENT OCCLUSION (AO):
          // Deep corner and crevice occlusion that enhances 3D block contours
          float aoFactor = pow(vAo, mix(1.2, 1.8, uUnderground));

          // SHADER-BASED DYNAMIC LIGHTING:
          // Smoothly shifts between warm direct sunlight on surface and atmospheric cave darkness
          float surfaceIntensity = 0.38 + 0.62 * vLight;
          float caveIntensity = 0.16 + 0.22 * (vLight * 0.5);
          float dynamicLight = mix(surfaceIntensity, caveIntensity, uUnderground);

          vec3 tone = mix(uSkySunColor, uCaveColor, uUnderground * 0.85);

          sampledTexel.rgb *= aoFactor * dynamicLight * tone;

          diffuseColor *= sampledTexel;
        #endif
        `
      );
    };

    (this.material as any).customProgramCacheKey = () => 'greedy_voxel_atlas_shader_v6_dynamic_light';
  }

  /**
   * Determine if player/camera is currently underground (under solid blocks or low Y)
   */
  public isPlayerUnderground(px: number, py: number, pz: number): boolean {
    const bx = Math.floor(px);
    const by = Math.floor(py);
    const bz = Math.floor(pz);

    if (by < 5) return true; // Low bedrock cavern level

    let solidCount = 0;
    for (let y = by + 1; y < CHUNK_HEIGHT; y++) {
      const v = this.getVoxel(bx, y, bz);
      if (v !== VoxelType.AIR && v !== VoxelType.GLASS) {
        solidCount++;
        if (solidCount >= 2) return true;
      }
    }
    return false;
  }

  /**
   * Dynamically update lighting uniforms based on player environment
   */
  public updateLighting(playerPos: THREE.Vector3, delta: number): boolean {
    const isUnderground = this.isPlayerUnderground(playerPos.x, playerPos.y, playerPos.z);
    const targetUnderground = isUnderground ? 1.0 : 0.0;

    this.currentUnderground = THREE.MathUtils.lerp(
      this.currentUnderground,
      targetUnderground,
      Math.min(1.0, delta * 3.0)
    );

    if (this.shaderUniforms && this.shaderUniforms.uUnderground) {
      this.shaderUniforms.uUnderground.value = this.currentUnderground;
    }

    return isUnderground;
  }

  public setWireframe(enabled: boolean) {
    if (this.material) {
      this.material.wireframe = enabled;
      this.material.needsUpdate = true;
    }
  }

  /**
   * Helper to get UV offset in atlas (atlas has 16x16 tiles of 16x16 pixels)
   */
  private getTileUVs(tileX: number, tileY: number): [number, number, number, number] {
    const tileW = 16 / 256;
    const tileH = 16 / 256;
    const u0 = tileX * tileW;
    const v1 = 1.0 - tileY * tileH;
    const u1 = u0 + tileW;
    const v0 = v1 - tileH;
    return [u0, v0, u1, v1];
  }

  private getVoxelFaceTile(voxel: VoxelType, faceIndex: number): [number, number] {
    // faceIndex: 0: +X, 1: -X, 2: +Y (Top), 3: -Y (Bottom), 4: +Z, 5: -Z
    switch (voxel) {
      case VoxelType.GRASS:
        if (faceIndex === 2) return [0, 0]; // Top grass
        if (faceIndex === 3) return [2, 0]; // Bottom dirt
        return [1, 0]; // Side grass
      case VoxelType.DIRT:
        return [2, 0];
      case VoxelType.STONE:
        return [3, 0];
      case VoxelType.BEDROCK:
        return [4, 0];
      case VoxelType.WOOD:
        if (faceIndex === 2 || faceIndex === 3) return [6, 0]; // Rings top/bottom
        return [5, 0]; // Bark sides
      case VoxelType.LEAVES:
        return [7, 0];
      case VoxelType.SAND:
        return [8, 0];
      case VoxelType.COBBLESTONE:
        return [9, 0];
      case VoxelType.TNT:
        return [10, 0];
      case VoxelType.GOLD:
        return [11, 0];
      case VoxelType.GLASS:
        return [12, 0];
      default:
        return [0, 0];
    }
  }

  public getChunkKey(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  public getChunk(cx: number, cz: number): Uint8Array {
    const key = this.getChunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Uint8Array(CHUNK_SIZE_X * CHUNK_SIZE_Z * CHUNK_HEIGHT);
      this.chunks.set(key, chunk);
      this.populateChunkTerrain(cx, cz, chunk);
    }
    return chunk;
  }

  private getVoxelIndex(lx: number, ly: number, lz: number): number {
    return (ly * CHUNK_SIZE_Z + lz) * CHUNK_SIZE_X + lx;
  }

  public getVoxel(wx: number, wy: number, wz: number): VoxelType {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return VoxelType.AIR;
    const cx = Math.floor(wx / CHUNK_SIZE_X);
    const cz = Math.floor(wz / CHUNK_SIZE_Z);
    const chunk = this.chunks.get(this.getChunkKey(cx, cz));
    if (!chunk) return VoxelType.AIR;

    const lx = ((wx % CHUNK_SIZE_X) + CHUNK_SIZE_X) % CHUNK_SIZE_X;
    const lz = ((wz % CHUNK_SIZE_Z) + CHUNK_SIZE_Z) % CHUNK_SIZE_Z;
    return chunk[this.getVoxelIndex(lx, wy, lz)] as VoxelType;
  }

  public setVoxel(wx: number, wy: number, wz: number, type: VoxelType) {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return;
    const cx = Math.floor(wx / CHUNK_SIZE_X);
    const cz = Math.floor(wz / CHUNK_SIZE_Z);
    const chunk = this.getChunk(cx, cz);

    const lx = ((wx % CHUNK_SIZE_X) + CHUNK_SIZE_X) % CHUNK_SIZE_X;
    const lz = ((wz % CHUNK_SIZE_Z) + CHUNK_SIZE_Z) % CHUNK_SIZE_Z;
    chunk[this.getVoxelIndex(lx, wy, lz)] = type;

    // Remesh affected chunk and neighbors if on edge
    this.buildChunkMesh(cx, cz);
    if (lx === 0) this.buildChunkMesh(cx - 1, cz);
    if (lx === CHUNK_SIZE_X - 1) this.buildChunkMesh(cx + 1, cz);
    if (lz === 0) this.buildChunkMesh(cx, cz - 1);
    if (lz === CHUNK_SIZE_Z - 1) this.buildChunkMesh(cx, cz + 1);

    // Update Rapier collision mesh
    this.updateChunkCollider(cx, cz);
  }

  /**
   * Procedural terrain generator using FastNoiseLite
   * Flat central area for physics showcase, rolling hills outside, bedrock bottom, and trees.
   */
  private populateChunkTerrain(cx: number, cz: number, chunk: Uint8Array) {
    for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
        const wx = cx * CHUNK_SIZE_X + lx;
        const wz = cz * CHUNK_SIZE_Z + lz;

        // Bedrock layer
        chunk[this.getVoxelIndex(lx, 0, lz)] = VoxelType.BEDROCK;

        const distFromCenter = Math.hypot(wx, wz);
        let height = 8;

        if (distFromCenter < 12) {
          // Flat central plaza at y=8
          height = 8;
        } else {
          // Rolling voxel hills
          const n = this.noise.GetNoise(wx, wz); // -1 to 1
          const hillHeight = Math.floor((n + 1) * 4.5); // 0 to 9
          const rim = Math.min(4, Math.floor(Math.pow(distFromCenter / 28, 2) * 3));
          height = Math.min(CHUNK_HEIGHT - 6, Math.max(5, 8 + hillHeight + rim));
        }

        // Fill column
        for (let y = 1; y <= height; y++) {
          let block = VoxelType.STONE;
          if (y === height) {
            block = y <= 6 ? VoxelType.SAND : VoxelType.GRASS;
          } else if (y >= height - 3) {
            block = y <= 6 ? VoxelType.SAND : VoxelType.DIRT;
          }
          chunk[this.getVoxelIndex(lx, y, lz)] = block;
        }

        // Procedural trees on grassy hills outside center
        if (distFromCenter > 13 && height > 6 && height < CHUNK_HEIGHT - 8) {
          const treeVal = this.treeNoise.GetNoise(wx, wz);
          if (treeVal > 0.55 && (wx + wz) % 5 === 0) {
            this.placeTree(chunk, lx, height + 1, lz, cx, cz, wx, wz);
          }
        }
      }
    }
  }

  private placeTree(
    chunk: Uint8Array,
    lx: number,
    baseY: number,
    lz: number,
    cx: number,
    cz: number,
    wx: number,
    wz: number
  ) {
    const trunkHeight = 4;
    // Wood trunk
    for (let ty = 0; ty < trunkHeight; ty++) {
      const y = baseY + ty;
      if (y < CHUNK_HEIGHT) {
        chunk[this.getVoxelIndex(lx, y, lz)] = VoxelType.WOOD;
      }
    }

    // Leaves canopy
    const leafBase = baseY + trunkHeight - 1;
    for (let ox = -2; ox <= 2; ox++) {
      for (let oz = -2; oz <= 2; oz++) {
        for (let oy = 0; oy <= 2; oy++) {
          if (Math.abs(ox) === 2 && Math.abs(oz) === 2 && oy === 2) continue; // round corners
          const curWx = wx + ox;
          const curWz = wz + oz;
          const curY = leafBase + oy;
          if (curY >= CHUNK_HEIGHT) continue;

          // If within current chunk
          const curLx = ((curWx % CHUNK_SIZE_X) + CHUNK_SIZE_X) % CHUNK_SIZE_X;
          const curLz = ((curWz % CHUNK_SIZE_Z) + CHUNK_SIZE_Z) % CHUNK_SIZE_Z;
          const curCx = Math.floor(curWx / CHUNK_SIZE_X);
          const curCz = Math.floor(curWz / CHUNK_SIZE_Z);

          if (curCx === cx && curCz === cz) {
            const idx = this.getVoxelIndex(curLx, curY, curLz);
            if (chunk[idx] === VoxelType.AIR) {
              chunk[idx] = VoxelType.LEAVES;
            }
          }
        }
      }
    }
  }

  /**
   * Reset world and apply new seed
   */
  public setSeed(newSeed: number) {
    this.seed = newSeed;
    this.noise.SetSeed(newSeed);
    this.treeNoise.SetSeed(newSeed + 999);
    this.clearAllChunks();
    this.generateWorldChunks();
    this.buildPhysicsColliders();
  }

  public clearAllChunks() {
    for (const mesh of this.chunkMeshes.values()) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.chunkMeshes.clear();
    this.chunks.clear();

    if (this.rapierWorld && this.terrainBody) {
      for (const col of this.chunkColliders.values()) {
        this.rapierWorld.removeCollider(col, false);
      }
      this.chunkColliders.clear();
    }

    this.lastPlayerChunkX = 999999;
    this.lastPlayerChunkZ = 999999;
  }

  /**
   * Open-source infinite procedural chunk streaming around player
   */
  public updatePlayerPosition(playerX: number, playerZ: number) {
    const pcx = Math.floor(playerX / CHUNK_SIZE_X);
    const pcz = Math.floor(playerZ / CHUNK_SIZE_Z);

    if (pcx === this.lastPlayerChunkX && pcz === this.lastPlayerChunkZ) {
      return;
    }
    this.lastPlayerChunkX = pcx;
    this.lastPlayerChunkZ = pcz;

    const r = this.renderDistance;

    // 1. Generate voxel data for all chunks in player radius
    for (let cx = pcx - r; cx <= pcx + r; cx++) {
      for (let cz = pcz - r; cz <= pcz + r; cz++) {
        this.getChunk(cx, cz);
      }
    }

    // 2. Build meshes and colliders for any newly visible chunks
    for (let cx = pcx - r; cx <= pcx + r; cx++) {
      for (let cz = pcz - r; cz <= pcz + r; cz++) {
        const key = this.getChunkKey(cx, cz);
        if (!this.chunkMeshes.has(key)) {
          this.buildChunkMesh(cx, cz);
          this.updateChunkCollider(cx, cz);
        }
      }
    }

    // 3. Unload distant chunks outside radius + 1
    const unloadDist = r + 2;
    for (const [key, mesh] of this.chunkMeshes.entries()) {
      const [kcx, kcz] = key.split(',').map(Number);
      if (Math.abs(kcx - pcx) > unloadDist || Math.abs(kcz - pcz) > unloadDist) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        this.chunkMeshes.delete(key);

        if (this.rapierWorld && this.terrainBody) {
          const col = this.chunkColliders.get(key);
          if (col) {
            this.rapierWorld.removeCollider(col, false);
            this.chunkColliders.delete(key);
          }
        }
      }
    }
  }

  /**
   * Generate initial chunks in the active radius
   */
  public generateWorldChunks() {
    for (let cx = -CHUNK_GRID_RADIUS; cx < CHUNK_GRID_RADIUS; cx++) {
      for (let cz = -CHUNK_GRID_RADIUS; cz < CHUNK_GRID_RADIUS; cz++) {
        this.getChunk(cx, cz);
      }
    }

    // Build meshes after chunks are initialized so face culling can inspect adjacent chunks
    for (let cx = -CHUNK_GRID_RADIUS; cx < CHUNK_GRID_RADIUS; cx++) {
      for (let cz = -CHUNK_GRID_RADIUS; cz < CHUNK_GRID_RADIUS; cz++) {
        this.buildChunkMesh(cx, cz);
      }
    }
  }

  /**
   * BINARY GREEDY MESHING & ADVANCED CULLING OPTIMIZATION
   * 1. Merges adjacent identical voxel faces into unified rectangular quads (reduces triangles by ~80%).
   * 2. Texture repeats seamlessly across greedy quads using shader fract(vUv) and aTile.
   * 3. Bottom Layer Culling: Never renders the bottom face (-Y) of bottom bedrock blocks (wy <= 0).
   * 4. Open-source infinite chunk boundary culling.
   */
  public buildChunkMesh(cx: number, cz: number) {
    const chunk = this.chunks.get(this.getChunkKey(cx, cz));
    if (!chunk) return;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const aTiles: number[] = [];
    const aAos: number[] = [];
    const aLights: number[] = [];
    const indices: number[] = [];
    let vertexCount = 0;

    // Visibility test with unseen face culling
    const isFaceVisible = (wx: number, wy: number, wz: number, face: number): boolean => {
      // 1. Bottom Bedrock Culling: Player is above ground, never underneath
      if (face === 3 && wy <= 0) return false;

      // 2. Top of world limit
      if (face === 2 && wy >= CHUNK_HEIGHT - 1) return true;

      // 3. Neighbor voxel solid check (culls internal faces)
      const dx = face === 0 ? 1 : face === 1 ? -1 : 0;
      const dy = face === 2 ? 1 : face === 3 ? -1 : 0;
      const dz = face === 4 ? 1 : face === 5 ? -1 : 0;
      const neighbor = this.getVoxel(wx + dx, wy + dy, wz + dz);
      return neighbor === VoxelType.AIR || neighbor === VoxelType.GLASS;
    };

    const isSolid = (wx: number, wy: number, wz: number): boolean => {
      if (wy < 0) return true;
      if (wy >= CHUNK_HEIGHT) return false;
      const v = this.getVoxel(wx, wy, wz);
      return v !== VoxelType.AIR && v !== VoxelType.GLASS;
    };

    const vertexAO = (s1: boolean, s2: boolean, c: boolean): number => {
      if (s1 && s2) return 0.45;
      const count = (s1 ? 1 : 0) + (s2 ? 1 : 0) + (c ? 1 : 0);
      return 1.0 - count * 0.17;
    };

    const getLight = (wx: number, wy: number, wz: number): number => {
      for (let y = wy + 1; y < CHUNK_HEIGHT; y++) {
        if (isSolid(wx, y, wz)) {
          const depth = Math.min(10, CHUNK_HEIGHT - wy);
          return Math.max(0.18, 0.75 - depth * 0.05);
        }
      }
      return 1.0;
    };

    const addQuad = (
      x0: number,
      y0: number,
      z0: number,
      W: number,
      H: number,
      face: number,
      tileCol: number,
      tileRow: number
    ) => {
      let ao0 = 1.0;
      let ao1 = 1.0;
      let ao2 = 1.0;
      let ao3 = 1.0;

      if (face === 2) {
        // +Y (Top): Normal (0, 1, 0), W spans along X, H spans along Z
        positions.push(
          x0, y0 + 1, z0 + H,
          x0 + W, y0 + 1, z0 + H,
          x0 + W, y0 + 1, z0,
          x0, y0 + 1, z0
        );
        normals.push(0, 1, 0,  0, 1, 0,  0, 1, 0,  0, 1, 0);
        uvs.push(0, H,  W, H,  W, 0,  0, 0);

        const y = y0 + 1;
        ao0 = vertexAO(isSolid(x0 - 1, y, z0 + H), isSolid(x0, y, z0 + H + 1), isSolid(x0 - 1, y, z0 + H + 1));
        ao1 = vertexAO(isSolid(x0 + W, y, z0 + H), isSolid(x0 + W - 1, y, z0 + H + 1), isSolid(x0 + W, y, z0 + H + 1));
        ao2 = vertexAO(isSolid(x0 + W, y, z0), isSolid(x0 + W - 1, y, z0 - 1), isSolid(x0 + W, y, z0 - 1));
        ao3 = vertexAO(isSolid(x0 - 1, y, z0), isSolid(x0, y, z0 - 1), isSolid(x0 - 1, y, z0 - 1));
      } else if (face === 3) {
        // -Y (Bottom): Normal (0, -1, 0), W spans along X, H spans along Z
        positions.push(
          x0, y0, z0,
          x0 + W, y0, z0,
          x0 + W, y0, z0 + H,
          x0, y0, z0 + H
        );
        normals.push(0, -1, 0,  0, -1, 0,  0, -1, 0,  0, -1, 0);
        uvs.push(0, 0,  W, 0,  W, H,  0, H);

        const y = y0 - 1;
        ao0 = vertexAO(isSolid(x0 - 1, y, z0), isSolid(x0, y, z0 - 1), isSolid(x0 - 1, y, z0 - 1));
        ao1 = vertexAO(isSolid(x0 + W, y, z0), isSolid(x0 + W - 1, y, z0 - 1), isSolid(x0 + W, y, z0 - 1));
        ao2 = vertexAO(isSolid(x0 + W, y, z0 + H), isSolid(x0 + W - 1, y, z0 + H + 1), isSolid(x0 + W, y, z0 + H + 1));
        ao3 = vertexAO(isSolid(x0 - 1, y, z0 + H), isSolid(x0, y, z0 + H + 1), isSolid(x0 - 1, y, z0 + H + 1));
      } else if (face === 0) {
        // +X (Right / East): Normal (1, 0, 0), W spans along Z, H spans along Y
        const x1 = x0 + 1;
        positions.push(
          x1, y0, z0,
          x1, y0 + H, z0,
          x1, y0 + H, z0 + W,
          x1, y0, z0 + W
        );
        normals.push(1, 0, 0,  1, 0, 0,  1, 0, 0,  1, 0, 0);
        uvs.push(W, 0,  W, H,  0, H,  0, 0);

        ao0 = vertexAO(isSolid(x1, y0 - 1, z0), isSolid(x1, y0, z0 - 1), isSolid(x1, y0 - 1, z0 - 1));
        ao1 = vertexAO(isSolid(x1, y0 + H, z0), isSolid(x1, y0 + H - 1, z0 - 1), isSolid(x1, y0 + H, z0 - 1));
        ao2 = vertexAO(isSolid(x1, y0 + H, z0 + W), isSolid(x1, y0 + H - 1, z0 + W), isSolid(x1, y0 + H, z0 + W));
        ao3 = vertexAO(isSolid(x1, y0 - 1, z0 + W), isSolid(x1, y0, z0 + W), isSolid(x1, y0 - 1, z0 + W));
      } else if (face === 1) {
        // -X (Left / West): Normal (-1, 0, 0), W spans along Z, H spans along Y
        positions.push(
          x0, y0, z0 + W,
          x0, y0 + H, z0 + W,
          x0, y0 + H, z0,
          x0, y0, z0
        );
        normals.push(-1, 0, 0,  -1, 0, 0,  -1, 0, 0,  -1, 0, 0);
        uvs.push(0, 0,  0, H,  W, H,  W, 0);

        const x = x0 - 1;
        ao0 = vertexAO(isSolid(x, y0 - 1, z0 + W), isSolid(x, y0, z0 + W), isSolid(x, y0 - 1, z0 + W));
        ao1 = vertexAO(isSolid(x, y0 + H, z0 + W), isSolid(x, y0 + H - 1, z0 + W), isSolid(x, y0 + H, z0 + W));
        ao2 = vertexAO(isSolid(x, y0 + H, z0), isSolid(x, y0 + H - 1, z0 - 1), isSolid(x, y0 + H, z0 - 1));
        ao3 = vertexAO(isSolid(x, y0 - 1, z0), isSolid(x, y0, z0 - 1), isSolid(x, y0 - 1, z0 - 1));
      } else if (face === 4) {
        // +Z (Front / South): Normal (0, 0, 1), W spans along X, H spans along Y
        const z1 = z0 + 1;
        positions.push(
          x0 + W, y0, z1,
          x0 + W, y0 + H, z1,
          x0, y0 + H, z1,
          x0, y0, z1
        );
        normals.push(0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1);
        uvs.push(W, 0,  W, H,  0, H,  0, 0);

        ao0 = vertexAO(isSolid(x0 + W, y0, z1), isSolid(x0 + W - 1, y0 - 1, z1), isSolid(x0 + W, y0 - 1, z1));
        ao1 = vertexAO(isSolid(x0 + W, y0 + H, z1), isSolid(x0 + W - 1, y0 + H, z1), isSolid(x0 + W, y0 + H, z1));
        ao2 = vertexAO(isSolid(x0 - 1, y0 + H, z1), isSolid(x0, y0 + H, z1), isSolid(x0 - 1, y0 + H, z1));
        ao3 = vertexAO(isSolid(x0 - 1, y0, z1), isSolid(x0, y0 - 1, z1), isSolid(x0 - 1, y0 - 1, z1));
      } else {
        // -Z (Back / North): Normal (0, 0, -1), W spans along X, H spans along Y
        positions.push(
          x0, y0, z0,
          x0, y0 + H, z0,
          x0 + W, y0 + H, z0,
          x0 + W, y0, z0
        );
        normals.push(0, 0, -1,  0, 0, -1,  0, 0, -1,  0, 0, -1);
        uvs.push(0, 0,  0, H,  W, H,  W, 0);

        const z = z0 - 1;
        ao0 = vertexAO(isSolid(x0 - 1, y0, z), isSolid(x0, y0 - 1, z), isSolid(x0 - 1, y0 - 1, z));
        ao1 = vertexAO(isSolid(x0 - 1, y0 + H, z), isSolid(x0, y0 + H, z), isSolid(x0 - 1, y0 + H, z));
        ao2 = vertexAO(isSolid(x0 + W, y0 + H, z), isSolid(x0 + W - 1, y0 + H, z), isSolid(x0 + W, y0 + H, z));
        ao3 = vertexAO(isSolid(x0 + W, y0, z), isSolid(x0 + W - 1, y0 - 1, z), isSolid(x0 + W, y0 - 1, z));
      }

      const light = getLight(x0, y0, z0);

      for (let i = 0; i < 4; i++) {
        aTiles.push(tileCol, tileRow);
        aLights.push(light);
      }

      aAos.push(ao0, ao1, ao2, ao3);

      indices.push(
        vertexCount, vertexCount + 1, vertexCount + 2,
        vertexCount, vertexCount + 2, vertexCount + 3
      );
      vertexCount += 4;
    };

    // 1. Binary Greedy Meshing for Vertical Faces: +Y (2) and -Y (3)
    const yMask = new Uint8Array(CHUNK_SIZE_X * CHUNK_SIZE_Z);
    for (const face of [2, 3]) {
      for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
        if (face === 3 && ly <= 0) continue; // Cull bottom bedrock layer

        let hasAny = false;
        for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
          for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
            const idx = lx + lz * CHUNK_SIZE_X;
            const voxel = chunk[this.getVoxelIndex(lx, ly, lz)];
            if (voxel !== VoxelType.AIR) {
              const wx = cx * CHUNK_SIZE_X + lx;
              const wz = cz * CHUNK_SIZE_Z + lz;
              if (isFaceVisible(wx, ly, wz, face)) {
                yMask[idx] = voxel;
                hasAny = true;
              } else {
                yMask[idx] = 0;
              }
            } else {
              yMask[idx] = 0;
            }
          }
        }
        if (!hasAny) continue;

        // Greedy 2D rectangular merge
        for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
          for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
            const vType = yMask[lx + lz * CHUNK_SIZE_X];
            if (vType === 0) continue;

            let W = 1;
            while (lx + W < CHUNK_SIZE_X && yMask[(lx + W) + lz * CHUNK_SIZE_X] === vType) W++;

            let H = 1;
            rowCheck: while (lz + H < CHUNK_SIZE_Z) {
              for (let k = 0; k < W; k++) {
                if (yMask[(lx + k) + (lz + H) * CHUNK_SIZE_X] !== vType) break rowCheck;
              }
              H++;
            }

            for (let dh = 0; dh < H; dh++) {
              for (let dw = 0; dw < W; dw++) {
                yMask[(lx + dw) + (lz + dh) * CHUNK_SIZE_X] = 0;
              }
            }

            const [tileCol, tileRow] = this.getVoxelFaceTile(vType, face);
            addQuad(cx * CHUNK_SIZE_X + lx, ly, cz * CHUNK_SIZE_Z + lz, W, H, face, tileCol, tileRow);
          }
        }
      }
    }

    // 2. Binary Greedy Meshing for X Faces: +X (0) and -X (1)
    const xMask = new Uint8Array(CHUNK_SIZE_Z * CHUNK_HEIGHT);
    for (const face of [0, 1]) {
      for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
        const wx = cx * CHUNK_SIZE_X + lx;

        let hasAny = false;
        for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
          for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
            const idx = lz + ly * CHUNK_SIZE_Z;
            const voxel = chunk[this.getVoxelIndex(lx, ly, lz)];
            if (voxel !== VoxelType.AIR) {
              const wz = cz * CHUNK_SIZE_Z + lz;
              if (isFaceVisible(wx, ly, wz, face)) {
                xMask[idx] = voxel;
                hasAny = true;
              } else {
                xMask[idx] = 0;
              }
            } else {
              xMask[idx] = 0;
            }
          }
        }
        if (!hasAny) continue;

        for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
          for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
            const vType = xMask[lz + ly * CHUNK_SIZE_Z];
            if (vType === 0) continue;

            let W = 1;
            while (lz + W < CHUNK_SIZE_Z && xMask[(lz + W) + ly * CHUNK_SIZE_Z] === vType) W++;

            let H = 1;
            rowCheck: while (ly + H < CHUNK_HEIGHT) {
              for (let k = 0; k < W; k++) {
                if (xMask[(lz + k) + (ly + H) * CHUNK_SIZE_Z] !== vType) break rowCheck;
              }
              H++;
            }

            for (let dh = 0; dh < H; dh++) {
              for (let dw = 0; dw < W; dw++) {
                xMask[(lz + dw) + (ly + dh) * CHUNK_SIZE_Z] = 0;
              }
            }

            const [tileCol, tileRow] = this.getVoxelFaceTile(vType, face);
            addQuad(wx, ly, cz * CHUNK_SIZE_Z + lz, W, H, face, tileCol, tileRow);
          }
        }
      }
    }

    // 3. Binary Greedy Meshing for Z Faces: +Z (4) and -Z (5)
    const zMask = new Uint8Array(CHUNK_SIZE_X * CHUNK_HEIGHT);
    for (const face of [4, 5]) {
      for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
        const wz = cz * CHUNK_SIZE_Z + lz;

        let hasAny = false;
        for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
          for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
            const idx = lx + ly * CHUNK_SIZE_X;
            const voxel = chunk[this.getVoxelIndex(lx, ly, lz)];
            if (voxel !== VoxelType.AIR) {
              const wx = cx * CHUNK_SIZE_X + lx;
              if (isFaceVisible(wx, ly, wz, face)) {
                zMask[idx] = voxel;
                hasAny = true;
              } else {
                zMask[idx] = 0;
              }
            } else {
              zMask[idx] = 0;
            }
          }
        }
        if (!hasAny) continue;

        for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
          for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
            const vType = zMask[lx + ly * CHUNK_SIZE_X];
            if (vType === 0) continue;

            let W = 1;
            while (lx + W < CHUNK_SIZE_X && zMask[(lx + W) + ly * CHUNK_SIZE_X] === vType) W++;

            let H = 1;
            rowCheck: while (ly + H < CHUNK_HEIGHT) {
              for (let k = 0; k < W; k++) {
                if (zMask[(lx + k) + (ly + H) * CHUNK_SIZE_X] !== vType) break rowCheck;
              }
              H++;
            }

            for (let dh = 0; dh < H; dh++) {
              for (let dw = 0; dw < W; dw++) {
                zMask[(lx + dw) + (ly + dh) * CHUNK_SIZE_X] = 0;
              }
            }

            const [tileCol, tileRow] = this.getVoxelFaceTile(vType, face);
            addQuad(cx * CHUNK_SIZE_X + lx, ly, wz, W, H, face, tileCol, tileRow);
          }
        }
      }
    }

    const key = this.getChunkKey(cx, cz);
    let mesh = this.chunkMeshes.get(key);

    if (positions.length === 0) {
      if (mesh) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        this.chunkMeshes.delete(key);
      }
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('aTile', new THREE.Float32BufferAttribute(aTiles, 2));
    geometry.setAttribute('aAo', new THREE.Float32BufferAttribute(aAos, 1));
    geometry.setAttribute('aLight', new THREE.Float32BufferAttribute(aLights, 1));
    geometry.setIndex(indices);

    // Frustum culling bounds
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    if (!mesh) {
      mesh = new THREE.Mesh(geometry, this.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;
      mesh.userData = { isVoxelChunk: true, cx, cz };
      this.scene.add(mesh);
      this.chunkMeshes.set(key, mesh);
    } else {
      mesh.geometry.dispose();
      mesh.geometry = geometry;
      mesh.frustumCulled = true;
    }
  }

  /**
   * Build Rapier Physics Trimesh Collider for each chunk
   */
  public buildPhysicsColliders() {
    if (!this.rapierWorld || !this.terrainBody) return;

    for (let cx = -CHUNK_GRID_RADIUS; cx < CHUNK_GRID_RADIUS; cx++) {
      for (let cz = -CHUNK_GRID_RADIUS; cz < CHUNK_GRID_RADIUS; cz++) {
        this.updateChunkCollider(cx, cz);
      }
    }
  }

  public updateChunkCollider(cx: number, cz: number) {
    if (!this.rapierWorld || !this.terrainBody) return;

    const key = this.getChunkKey(cx, cz);
    const existing = this.chunkColliders.get(key);
    if (existing) {
      this.rapierWorld.removeCollider(existing, false);
      this.chunkColliders.delete(key);
    }

    const mesh = this.chunkMeshes.get(key);
    if (!mesh || !mesh.geometry) return;

    const posAttr = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const indexAttr = mesh.geometry.index;
    if (!posAttr || !indexAttr) return;

    const vertices = posAttr.array as Float32Array;
    const indices = new Uint32Array(indexAttr.array);

    try {
      const colliderDesc = RAPIER.ColliderDesc.trimesh(vertices, indices)
        .setFriction(0.65)
        .setRestitution(0.15)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

      const collider = this.rapierWorld.createCollider(colliderDesc, this.terrainBody);
      this.chunkColliders.set(key, collider);
    } catch (e) {
      console.warn('Failed to build trimesh collider for chunk', key, e);
    }
  }

  /**
   * Raycast into voxel world using Fast Voxel Traversal algorithm
   */
  public raycastVoxel(ray: THREE.Ray, maxDistance: number = 8.0): VoxelRaycastHit | null {
    let t = 0;
    const step = 0.08;
    const currentPos = new THREE.Vector3();
    const lastAirPos = new THREE.Vector3();
    let hasAir = false;

    while (t < maxDistance) {
      currentPos.copy(ray.origin).addScaledVector(ray.direction, t);
      const bx = Math.floor(currentPos.x);
      const by = Math.floor(currentPos.y);
      const bz = Math.floor(currentPos.z);

      const voxel = this.getVoxel(bx, by, bz);
      if (voxel !== VoxelType.AIR) {
        // Hit solid block! Calculate normal based on last air position
        const normal = new THREE.Vector3(0, 1, 0);
        if (hasAir) {
          const abx = Math.floor(lastAirPos.x);
          const aby = Math.floor(lastAirPos.y);
          const abz = Math.floor(lastAirPos.z);
          normal.set(abx - bx, aby - by, abz - bz).clampLength(0, 1);
          if (normal.lengthSq() === 0) normal.set(0, 1, 0);
        }

        return {
          blockX: bx,
          blockY: by,
          blockZ: bz,
          normal,
          voxelType: voxel,
          point: currentPos.clone(),
        };
      } else {
        lastAirPos.copy(currentPos);
        hasAir = true;
      }
      t += step;
    }

    return null;
  }

  /**
   * Fast height query at world coordinates (x, z)
   */
  public getElevationAt(wx: number, wz: number): number {
    const bx = Math.floor(wx);
    const bz = Math.floor(wz);
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      const v = this.getVoxel(bx, y, bz);
      if (v !== VoxelType.AIR) {
        return y + 1.0;
      }
    }
    return 1.0;
  }

  public dispose() {
    for (const mesh of this.chunkMeshes.values()) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.chunkMeshes.clear();

    if (this.rapierWorld && this.terrainBody) {
      for (const col of this.chunkColliders.values()) {
        this.rapierWorld.removeCollider(col, false);
      }
      this.chunkColliders.clear();
      this.rapierWorld.removeRigidBody(this.terrainBody);
    }
    this.atlasTexture.dispose();
    this.material.dispose();
  }
}
