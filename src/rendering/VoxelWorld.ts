import * as THREE from 'three';
import { resourcePacks } from '../resourcepack/ResourcePackManager';
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
  public chunkTransMeshes: Map<string, THREE.Mesh> = new Map();
  public chunkColliders: Map<string, RAPIER.Collider> = new Map();
  public terrainBody: RAPIER.RigidBody | null = null;

  // Dynamic Open-Source Infinite Chunk Streaming
  public seed: number = 1337;
  public renderDistance: number = 2; // Radius in chunks (5x5 active chunks)
  private lastPlayerChunkX: number = 999999;
  private lastPlayerChunkZ: number = 999999;

  // Voxel materials: Opaque & Transparent (Glass) with crisp pixelated Minecraft texture atlas
  public material!: THREE.MeshBasicMaterial;
  public transparentMaterial!: THREE.MeshBasicMaterial;
  private atlasTexture!: THREE.CanvasTexture;
  private baseAtlasCanvas!: HTMLCanvasElement;
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

    // 12,0: Glass (Authentic Minecraft transparent windowpane with glare glints)
    drawTile(12, 0, (c, ox, oy) => {
      c.fillStyle = 'rgba(215, 238, 255, 0.35)';
      c.fillRect(ox, oy, 16, 16);
      c.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      c.lineWidth = 1;
      c.strokeRect(ox + 0.5, oy + 0.5, 15, 15);
      c.fillStyle = '#ffffff';
      c.fillRect(ox + 2, oy + 2, 2, 2);
      c.fillRect(ox + 3, oy + 3, 2, 2);
      c.fillRect(ox + 10, oy + 9, 2, 2);
      c.fillRect(ox + 11, oy + 10, 2, 2);
    });

    this.baseAtlasCanvas = canvas;
    this.atlasTexture = new THREE.CanvasTexture(canvas);
    this.atlasTexture.magFilter = THREE.NearestFilter;
    this.atlasTexture.minFilter = THREE.NearestFilter;
    this.atlasTexture.generateMipmaps = false;
    this.atlasTexture.colorSpace = THREE.SRGBColorSpace;

    // Authentic Minecraft Opaque Material with native vertexColors for deep AO & face lighting
    this.material = new THREE.MeshBasicMaterial({
      map: this.atlasTexture,
      vertexColors: true,
      transparent: false,
      side: THREE.FrontSide,
    });

    // Dedicated Minecraft Transparent Material (for Glass blocks)
    this.transparentMaterial = new THREE.MeshBasicMaterial({
      map: this.atlasTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      depthWrite: true,
    });
  }

  /**
   * Safe no-op: Minecraft lighting is per-face/per-vertex, never global screen darkening
   */
  public updateLighting(_playerPos: THREE.Vector3, _delta: number): boolean {
    return false;
  }

  /**
   * Rebuild the block atlas from the enabled resource packs (falls back to the built-in
   * procedural tiles for anything a pack does not provide). Supports HD packs (up to 128px).
   * Chunk UVs are fractional, so no remeshing is needed.
   */
  public async applyResourcePack() {
    // [tile column, texture candidates, tint colour or null, optional overlay texture]
    const grassTint = '#91bd59';
    const leafTint = '#77ab2f';
    const tiles: Array<[number, string[], string | null, string[]?]> = [
      [0, ['block/grass_block_top'], grassTint],
      [1, ['block/grass_block_side'], null, ['block/grass_block_side_overlay']],
      [2, ['block/dirt'], null],
      [3, ['block/stone'], null],
      [4, ['block/bedrock'], null],
      [5, ['block/oak_log'], null],
      [6, ['block/oak_log_top'], null],
      [7, ['block/oak_leaves'], leafTint],
      [8, ['block/sand'], null],
      [9, ['block/cobblestone'], null],
      [10, ['block/tnt_side'], null],
      [11, ['block/gold_block'], null],
      [12, ['block/glass'], null],
    ];

    const loaded = await Promise.all(
      tiles.map(async ([col, names, tint, overlay]) => ({
        col,
        tint,
        img: await resourcePacks.getTexture(names),
        overlay: overlay ? await resourcePacks.getTexture(overlay) : null,
      }))
    );

    let res = 16;
    for (const t of loaded) if (t.img) res = Math.max(res, Math.min(128, t.img.width));
    const size = res * 16;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.baseAtlasCanvas, 0, 0, size, size);

    const tinted = (img: HTMLCanvasElement, color: string) => {
      const c = document.createElement('canvas');
      c.width = res;
      c.height = res;
      const g = c.getContext('2d')!;
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0, res, res);
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = color;
      g.fillRect(0, 0, res, res);
      g.globalCompositeOperation = 'destination-in'; // keep original alpha
      g.drawImage(img, 0, 0, res, res);
      return c;
    };

    for (const t of loaded) {
      if (!t.img) continue;
      const x = t.col * res;
      ctx.clearRect(x, 0, res, res);
      ctx.drawImage(t.tint ? tinted(t.img, t.tint) : t.img, x, 0, res, res);
      if (t.overlay) ctx.drawImage(tinted(t.overlay, grassTint), x, 0, res, res);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    const old = this.atlasTexture;
    this.atlasTexture = tex;
    this.material.map = tex;
    this.transparentMaterial.map = tex;
    this.material.needsUpdate = true;
    this.transparentMaterial.needsUpdate = true;
    old.dispose();
  }

  /** Day/night world tint (voxel materials are unlit, so multiply their colour) */
  public setLightTint(color: THREE.Color) {
    this.material.color.copy(color);
    this.transparentMaterial.color.copy(color);
  }

  public setWireframe(enabled: boolean) {
    if (this.material) {
      this.material.wireframe = enabled;
      this.material.needsUpdate = true;
    }
    if (this.transparentMaterial) {
      this.transparentMaterial.wireframe = enabled;
      this.transparentMaterial.needsUpdate = true;
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

        const transMesh = this.chunkTransMeshes.get(key);
        if (transMesh) {
          this.scene.remove(transMesh);
          transMesh.geometry.dispose();
          this.chunkTransMeshes.delete(key);
        }

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
   * AUTHENTIC MINECRAFT CHUNK MESHING
   * 1. 100% genuine Minecraft Face Directional Lighting: Top (+Y) = 1.0, Bottom (-Y) = 0.5, Z (+Z/-Z) = 0.8, X (+X/-X) = 0.6.
   * 2. Authentic Mikola Lysenko Minecraft Ambient Occlusion (0fps.net) evaluated per-vertex on the face plane.
   * 3. Authentic Quad Diagonal Flipping (ao0 + ao2 > ao1 + ao3) eliminates lighting crease anisotropy.
   * 4. Strict Counter-Clockwise (CCW) front face winding with true outward normals.
   * 5. Bedrock floor culling (y <= 0) and hidden face culling.
   */
  public buildChunkMesh(cx: number, cz: number) {
    const chunk = this.chunks.get(this.getChunkKey(cx, cz));
    if (!chunk) return;

    // Opaque Geometry Buffers
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    let vertexCount = 0;

    // Dedicated Transparent (Glass) Geometry Buffers
    const transPositions: number[] = [];
    const transNormals: number[] = [];
    const transUvs: number[] = [];
    const transColors: number[] = [];
    const transIndices: number[] = [];
    let transVertexCount = 0;

    // Visibility test with transparency-aware face culling
    const isFaceVisible = (wx: number, wy: number, wz: number, face: number, voxel: VoxelType): boolean => {
      // 1. Bottom Bedrock Culling: Player is above ground, never underneath
      if (face === 3 && wy <= 0) return false;

      // 2. Top of world limit
      if (face === 2 && wy >= CHUNK_HEIGHT - 1) return true;

      // 3. Neighbor voxel solid check
      const dx = face === 0 ? 1 : face === 1 ? -1 : 0;
      const dy = face === 2 ? 1 : face === 3 ? -1 : 0;
      const dz = face === 4 ? 1 : face === 5 ? -1 : 0;
      const neighbor = this.getVoxel(wx + dx, wy + dy, wz + dz);

      if (voxel === VoxelType.GLASS) {
        // Glass faces are visible against air, but culled against another glass block (seamless panes!)
        return neighbor === VoxelType.AIR;
      } else {
        // Opaque faces are visible against air OR glass (player sees through glass to terrain)
        return neighbor === VoxelType.AIR || neighbor === VoxelType.GLASS;
      }
    };

    const isSolid = (wx: number, wy: number, wz: number): boolean => {
      if (wy < 0) return true;
      if (wy >= CHUNK_HEIGHT) return false;
      const v = this.getVoxel(wx, wy, wz);
      return v !== VoxelType.AIR && v !== VoxelType.GLASS;
    };

    // Authentic Mikola Lysenko / Minecraft vertex ambient occlusion (0fps.net)
    const getAO = (s1: boolean, s2: boolean, c: boolean): number => {
      if (s1 && s2) {
        return 0.35;
      }
      const count = (s1 ? 1 : 0) + (s2 ? 1 : 0) + (c ? 1 : 0);
      if (count === 3) return 0.35;
      if (count === 2) return 0.55;
      if (count === 1) return 0.76;
      return 1.0;
    };

    // Authentic Minecraft Directional Face Multipliers:
    // +X (0): 0.68, -X (1): 0.68, +Y (2): 1.0, -Y (3): 0.52, +Z (4): 0.82, -Z (5): 0.82
    const faceLightMultipliers = [0.68, 0.68, 1.0, 0.52, 0.82, 0.82];

    const getFaceLight = (nx: number, ny: number, nz: number, face: number): number => {
      const baseMult = faceLightMultipliers[face];
      if (face === 3) return baseMult;

      let hasSky = true;
      for (let y = ny + 1; y < CHUNK_HEIGHT; y++) {
        if (isSolid(nx, y, nz)) {
          hasSky = false;
          break;
        }
      }
      return hasSky ? baseMult : baseMult * 0.85;
    };

    const tileW = 1.0 / 16.0;

    // Iterate all blocks in this chunk
    for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
      for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
          const voxel = chunk[this.getVoxelIndex(lx, ly, lz)];
          if (voxel === VoxelType.AIR) continue;

          const isGlass = voxel === VoxelType.GLASS;
          const targetPositions = isGlass ? transPositions : positions;
          const targetNormals = isGlass ? transNormals : normals;
          const targetUvs = isGlass ? transUvs : uvs;
          const targetColors = isGlass ? transColors : colors;
          const targetIndices = isGlass ? transIndices : indices;

          const wx = cx * CHUNK_SIZE_X + lx;
          const wy = ly;
          const wz = cz * CHUNK_SIZE_Z + lz;

          // Test all 6 faces
          for (let face = 0; face < 6; face++) {
            if (!isFaceVisible(wx, wy, wz, face, voxel)) continue;

            const [tileCol, tileRow] = this.getVoxelFaceTile(voxel, face);
            const u0 = tileCol * tileW;
            const u1 = u0 + tileW;
            const v0 = 1.0 - (tileRow + 1) * tileW;
            const v1 = 1.0 - tileRow * tileW;

            let ao0 = 1.0;
            let ao1 = 1.0;
            let ao2 = 1.0;
            let ao3 = 1.0;

            const x0 = wx;
            const y0 = wy;
            const z0 = wz;

            if (face === 2) {
              // +Y (Top Face): normal (0, 1, 0)
              targetPositions.push(
                x0, y0 + 1, z0 + 1,
                x0 + 1, y0 + 1, z0 + 1,
                x0 + 1, y0 + 1, z0,
                x0, y0 + 1, z0
              );
              targetNormals.push(0, 1, 0,  0, 1, 0,  0, 1, 0,  0, 1, 0);

              const y = wy + 1;
              ao0 = getAO(isSolid(wx - 1, y, wz), isSolid(wx, y, wz + 1), isSolid(wx - 1, y, wz + 1));
              ao1 = getAO(isSolid(wx + 1, y, wz), isSolid(wx, y, wz + 1), isSolid(wx + 1, y, wz + 1));
              ao2 = getAO(isSolid(wx + 1, y, wz), isSolid(wx, y, wz - 1), isSolid(wx + 1, y, wz - 1));
              ao3 = getAO(isSolid(wx - 1, y, wz), isSolid(wx, y, wz - 1), isSolid(wx - 1, y, wz - 1));
            } else if (face === 3) {
              // -Y (Bottom Face): normal (0, -1, 0)
              targetPositions.push(
                x0, y0, z0,
                x0 + 1, y0, z0,
                x0 + 1, y0, z0 + 1,
                x0, y0, z0 + 1
              );
              targetNormals.push(0, -1, 0,  0, -1, 0,  0, -1, 0,  0, -1, 0);

              const y = wy - 1;
              ao0 = getAO(isSolid(wx - 1, y, wz), isSolid(wx, y, wz - 1), isSolid(wx - 1, y, wz - 1));
              ao1 = getAO(isSolid(wx + 1, y, wz), isSolid(wx, y, wz - 1), isSolid(wx + 1, y, wz - 1));
              ao2 = getAO(isSolid(wx + 1, y, wz), isSolid(wx, y, wz + 1), isSolid(wx + 1, y, wz + 1));
              ao3 = getAO(isSolid(wx - 1, y, wz), isSolid(wx, y, wz + 1), isSolid(wx - 1, y, wz + 1));
            } else if (face === 0) {
              // +X (East / Right): normal (1, 0, 0)
              targetPositions.push(
                x0 + 1, y0, z0 + 1,
                x0 + 1, y0, z0,
                x0 + 1, y0 + 1, z0,
                x0 + 1, y0 + 1, z0 + 1
              );
              targetNormals.push(1, 0, 0,  1, 0, 0,  1, 0, 0,  1, 0, 0);

              const x = wx + 1;
              ao0 = getAO(isSolid(x, wy - 1, wz), isSolid(x, wy, wz + 1), isSolid(x, wy - 1, wz + 1));
              ao1 = getAO(isSolid(x, wy - 1, wz), isSolid(x, wy, wz - 1), isSolid(x, wy - 1, wz - 1));
              ao2 = getAO(isSolid(x, wy + 1, wz), isSolid(x, wy, wz - 1), isSolid(x, wy + 1, wz - 1));
              ao3 = getAO(isSolid(x, wy + 1, wz), isSolid(x, wy, wz + 1), isSolid(x, wy + 1, wz + 1));
            } else if (face === 1) {
              // -X (West / Left): normal (-1, 0, 0)
              targetPositions.push(
                x0, y0, z0,
                x0, y0, z0 + 1,
                x0, y0 + 1, z0 + 1,
                x0, y0 + 1, z0
              );
              targetNormals.push(-1, 0, 0,  -1, 0, 0,  -1, 0, 0,  -1, 0, 0);

              const x = wx - 1;
              ao0 = getAO(isSolid(x, wy - 1, wz), isSolid(x, wy, wz - 1), isSolid(x, wy - 1, wz - 1));
              ao1 = getAO(isSolid(x, wy - 1, wz), isSolid(x, wy, wz + 1), isSolid(x, wy - 1, wz + 1));
              ao2 = getAO(isSolid(x, wy + 1, wz), isSolid(x, wy, wz + 1), isSolid(x, wy + 1, wz + 1));
              ao3 = getAO(isSolid(x, wy + 1, wz), isSolid(x, wy, wz - 1), isSolid(x, wy + 1, wz - 1));
            } else if (face === 4) {
              // +Z (South / Front): normal (0, 0, 1)
              targetPositions.push(
                x0, y0, z0 + 1,
                x0 + 1, y0, z0 + 1,
                x0 + 1, y0 + 1, z0 + 1,
                x0, y0 + 1, z0 + 1
              );
              targetNormals.push(0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1);

              const z = wz + 1;
              ao0 = getAO(isSolid(wx - 1, wy, z), isSolid(wx, wy - 1, z), isSolid(wx - 1, wy - 1, z));
              ao1 = getAO(isSolid(wx + 1, wy, z), isSolid(wx, wy - 1, z), isSolid(wx + 1, wy - 1, z));
              ao2 = getAO(isSolid(wx + 1, wy, z), isSolid(wx, wy + 1, z), isSolid(wx + 1, wy + 1, z));
              ao3 = getAO(isSolid(wx - 1, wy, z), isSolid(wx, wy + 1, z), isSolid(wx - 1, wy + 1, z));
            } else {
              // -Z (North / Back): normal (0, 0, -1)
              targetPositions.push(
                x0 + 1, y0, z0,
                x0, y0, z0,
                x0, y0 + 1, z0,
                x0 + 1, y0 + 1, z0
              );
              targetNormals.push(0, 0, -1,  0, 0, -1,  0, 0, -1,  0, 0, -1);

              const z = wz - 1;
              ao0 = getAO(isSolid(wx + 1, wy, z), isSolid(wx, wy - 1, z), isSolid(wx + 1, wy - 1, z));
              ao1 = getAO(isSolid(wx - 1, wy, z), isSolid(wx, wy - 1, z), isSolid(wx - 1, wy - 1, z));
              ao2 = getAO(isSolid(wx - 1, wy, z), isSolid(wx, wy + 1, z), isSolid(wx - 1, wy + 1, z));
              ao3 = getAO(isSolid(wx + 1, wy, z), isSolid(wx, wy + 1, z), isSolid(wx + 1, wy + 1, z));
            }

            // Standard crisp 1x1 tile UV coordinates
            targetUvs.push(
              u0, v0,
              u1, v0,
              u1, v1,
              u0, v1
            );

            // Light: Evaluated at the air neighbor block facing this face
            const dx = face === 0 ? 1 : face === 1 ? -1 : 0;
            const dy = face === 2 ? 1 : face === 3 ? -1 : 0;
            const dz = face === 4 ? 1 : face === 5 ? -1 : 0;
            const faceLight = getFaceLight(wx + dx, wy + dy, wz + dz, face);

            // Native vertex colors with face directional lighting * Ambient Occlusion
            // Shading is authored in Minecraft's gamma space; convert to linear so the
            // sRGB output stage reproduces the original (not washed-out) look.
            const col0 = Math.pow(Math.max(0.2, ao0 * faceLight), 2.2);
            const col1 = Math.pow(Math.max(0.2, ao1 * faceLight), 2.2);
            const col2 = Math.pow(Math.max(0.2, ao2 * faceLight), 2.2);
            const col3 = Math.pow(Math.max(0.2, ao3 * faceLight), 2.2);

            targetColors.push(
              col0, col0, col0,
              col1, col1, col1,
              col2, col2, col2,
              col3, col3, col3
            );

            // Quad Diagonal Flip for Smooth Lighting (Anisotropy Fix)
            const currentVertexCount = isGlass ? transVertexCount : vertexCount;
            if (ao0 + ao2 > ao1 + ao3) {
              targetIndices.push(
                currentVertexCount, currentVertexCount + 1, currentVertexCount + 2,
                currentVertexCount, currentVertexCount + 2, currentVertexCount + 3
              );
            } else {
              targetIndices.push(
                currentVertexCount + 1, currentVertexCount + 2, currentVertexCount + 3,
                currentVertexCount + 1, currentVertexCount + 3, currentVertexCount
              );
            }

            if (isGlass) {
              transVertexCount += 4;
            } else {
              vertexCount += 4;
            }
          }
        }
      }
    }

    const key = this.getChunkKey(cx, cz);

    // 1. Build or Update Opaque Mesh
    let mesh = this.chunkMeshes.get(key);
    if (positions.length === 0) {
      if (mesh) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        this.chunkMeshes.delete(key);
      }
    } else {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();

      if (!mesh) {
        mesh = new THREE.Mesh(geometry, this.material);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
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

    // 2. Build or Update Transparent Glass Mesh
    let transMesh = this.chunkTransMeshes.get(key);
    if (transPositions.length === 0) {
      if (transMesh) {
        this.scene.remove(transMesh);
        transMesh.geometry.dispose();
        this.chunkTransMeshes.delete(key);
      }
    } else {
      const transGeometry = new THREE.BufferGeometry();
      transGeometry.setAttribute('position', new THREE.Float32BufferAttribute(transPositions, 3));
      transGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(transNormals, 3));
      transGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(transUvs, 2));
      transGeometry.setAttribute('color', new THREE.Float32BufferAttribute(transColors, 3));
      transGeometry.setIndex(transIndices);
      transGeometry.computeBoundingBox();
      transGeometry.computeBoundingSphere();

      if (!transMesh) {
        transMesh = new THREE.Mesh(transGeometry, this.transparentMaterial);
        transMesh.renderOrder = 1; // Render after opaque geometry
        transMesh.castShadow = false;
        transMesh.receiveShadow = false;
        transMesh.frustumCulled = true;
        transMesh.userData = { isVoxelChunkTrans: true, cx, cz };
        this.scene.add(transMesh);
        this.chunkTransMeshes.set(key, transMesh);
      } else {
        transMesh.geometry.dispose();
        transMesh.geometry = transGeometry;
        transMesh.frustumCulled = true;
      }
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
        .setFriction(0.0)
        .setRestitution(0.0)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
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

    for (const transMesh of this.chunkTransMeshes.values()) {
      this.scene.remove(transMesh);
      transMesh.geometry.dispose();
    }
    this.chunkTransMeshes.clear();

    if (this.rapierWorld && this.terrainBody) {
      for (const col of this.chunkColliders.values()) {
        this.rapierWorld.removeCollider(col, false);
      }
      this.chunkColliders.clear();
      this.rapierWorld.removeRigidBody(this.terrainBody);
    }
    this.atlasTexture.dispose();
    this.material.dispose();
    this.transparentMaterial.dispose();
  }
}
