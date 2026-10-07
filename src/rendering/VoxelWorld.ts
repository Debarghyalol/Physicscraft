import * as THREE from 'three';
import { resourcePacks } from '../resourcepack/ResourcePackManager';
import FastNoiseLite from 'fastnoise-lite';
import { VoxelType } from '../types/physics';

export const CHUNK_SIZE_X = 16;
export const CHUNK_SIZE_Z = 16;
export const SECTION_SIZE = 16; // subchunk (16x16x16) edge length
// Minecraft 1.18+ world height limits: y = -64 .. 319 (384 blocks, 24 subchunks per column)
export const WORLD_MIN_Y = -64;
export const WORLD_MAX_Y = 320; // exclusive
export const WORLD_HEIGHT = WORLD_MAX_Y - WORLD_MIN_Y;
export const SECTION_COUNT = WORLD_HEIGHT / SECTION_SIZE;
export const CHUNK_HEIGHT = WORLD_HEIGHT;
export const CHUNK_GRID_RADIUS = 2; // initial synchronous build radius (in chunks)

// ---- light data -----------------------------------------------------------
/** How much each block type dims light passing through it (15 = fully opaque). */
const OPACITY = new Uint8Array(256).fill(15);
OPACITY[VoxelType.AIR] = 0;
OPACITY[VoxelType.GLASS] = 0;
OPACITY[VoxelType.LEAVES] = 1;
/** Block light emitted by each block type. */
const EMISSION = new Uint8Array(256);
EMISSION[VoxelType.GLOWSTONE] = 15;
/** Sky light removed at midnight (vanilla: up to 11; a bit less here so nights stay playable). */
// Vanilla's effective night sky light is 4: 15 - 11 = 4.
// The stored flood-fill sky light remains 15; this is the visual/gameplay subtraction.
const SKY_DIM_LEVELS = 11;

const DIR_X = [1, -1, 0, 0, 0, 0];
const DIR_Y = [0, 0, 1, -1, 0, 0];
const DIR_Z = [0, 0, 0, 0, 1, -1];

// ---- meshing tables ---------------------------------------------------------
const PAD = 18;
const PAD_Y = PAD * PAD;
const FACE_OFF = [1, -1, PAD_Y, -PAD_Y, PAD, -PAD];
const AO_VALUES = [1.0, 0.76, 0.55, 0.35];
const FACE_MULT = [0.68, 0.68, 1.0, 0.52, 0.82, 0.82];
/** Vertex shade in linear space (Minecraft multiplies in gamma space) for [face][aoLevel]. */
const SHADE_LINEAR = new Float32Array(24);
for (let f = 0; f < 6; f++) for (let a = 0; a < 4; a++) SHADE_LINEAR[f * 4 + a] = Math.pow(FACE_MULT[f] * AO_VALUES[a], 2.2);

// Atlas layout: every tile is surrounded by an edge-extruded gutter (10% of the cell on each side),
// so sampling just outside a face (MSAA / rounding) never bleeds in a neighbouring tile or empty
// space -> no more dark seams between blocks. The ratio is resolution independent.
const ATLAS_INNER_MIN = 0.1;
const ATLAS_INNER_MAX = 0.9;
const ATLAS_INNER_MIN_V = 0.1;
const ATLAS_INNER_MAX_V = 0.9;

interface FaceVertexInfo {
  px: number; py: number; pz: number;
  oCenter: number; o1: number; o2: number; oC: number;
}
const FACE_VERTS: number[][][] = [
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], // +X
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], // -X
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], // +Y
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], // -Y
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], // +Z
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], // -Z
];
const FACE_NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const FACE_INFO: FaceVertexInfo[][] = FACE_VERTS.map((verts, f) => {
  const n = FACE_NORMALS[f];
  const axis = n.findIndex((v) => v !== 0);
  const tangents = [0, 1, 2].filter((a) => a !== axis);
  const toOff = (v: number[]) => v[0] + v[2] * PAD + v[1] * PAD_Y;
  return verts.map((p) => {
    const s1 = [0, 0, 0];
    const s2 = [0, 0, 0];
    s1[tangents[0]] = p[tangents[0]] ? 1 : -1;
    s2[tangents[1]] = p[tangents[1]] ? 1 : -1;
    return {
      px: p[0], py: p[1], pz: p[2],
      oCenter: toOff(n),
      o1: toOff([n[0] + s1[0], n[1] + s1[1], n[2] + s1[2]]),
      o2: toOff([n[0] + s2[0], n[1] + s2[1], n[2] + s2[2]]),
      oC: toOff([n[0] + s1[0] + s2[0], n[1] + s1[1] + s2[1], n[2] + s1[2] + s2[2]]),
    };
  });
});

/** Growable typed-array geometry builder (reused between subchunk builds, no per-face allocations). */
class MeshBuilder {
  pos: Float32Array;
  uv: Float32Array;
  col: Float32Array;
  lit: Float32Array;
  normal: Float32Array;
  materialClass: Float32Array;
  idx: Uint32Array;
  cap: number; // capacity in faces
  vc = 0;
  ic = 0;

  constructor(cap = 2048) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 12);
    this.uv = new Float32Array(cap * 8);
    this.col = new Float32Array(cap * 12);
    this.lit = new Float32Array(cap * 8);
    this.normal = new Float32Array(cap * 12);
    this.materialClass = new Float32Array(cap * 4);
    this.idx = new Uint32Array(cap * 6);
  }

  reset() {
    this.vc = 0;
    this.ic = 0;
  }

  ensure(extraFaces: number) {
    const need = (this.vc >> 2) + extraFaces;
    if (need <= this.cap) return;
    let cap = this.cap;
    while (cap < need) cap *= 2;
    const grow = <T extends Float32Array | Uint32Array>(a: T, n: number): T => {
      const b = new (a.constructor as any)(n) as T;
      b.set(a);
      return b;
    };
    this.pos = grow(this.pos, cap * 12);
    this.uv = grow(this.uv, cap * 8);
    this.col = grow(this.col, cap * 12);
    this.lit = grow(this.lit, cap * 8);
    this.normal = grow(this.normal, cap * 12);
    this.materialClass = grow(this.materialClass, cap * 4);
    this.idx = grow(this.idx, cap * 6);
    this.cap = cap;
  }

  toGeometry(cx: number, cy: number, cz: number): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.vc * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.slice(0, this.vc * 2), 2));
    const color = new THREE.BufferAttribute(this.col.slice(0, this.vc * 3), 3);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const light = new THREE.BufferAttribute(this.lit.slice(0, this.vc * 2), 2);
    const normal = new THREE.BufferAttribute(this.normal.slice(0, this.vc * 3), 3);
    const materialClass = new THREE.BufferAttribute(this.materialClass.slice(0, this.vc), 1);
    g.setAttribute('color', color);
    g.setAttribute('aLight', light);
    g.setAttribute('normal', normal);
    // 0 = opaque/cutout G-buffer surface, 1 = forward translucent terrain.
    g.setAttribute('aMaterialClass', materialClass);

    // Shader-pack aliases. The Nostalgia terrain program uses Minecraft's
    // legacy attribute names; keep the vanilla renderer's attributes intact
    // and expose the same underlying buffers under the translated names.
    g.setAttribute('iris_Vertex', g.getAttribute('position'));
    g.setAttribute('iris_MultiTexCoord0', uv);
    g.setAttribute('iris_MultiTexCoord1', light);
    g.setAttribute('iris_Normal', normal);
    g.setAttribute('iris_Color', color);
    const ind = this.idx.subarray(0, this.ic);
    g.setIndex(new THREE.BufferAttribute(this.vc <= 65535 ? Uint16Array.from(ind) : ind.slice(), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), 14);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(cx - 8, cy - 8, cz - 8), new THREE.Vector3(cx + 8, cy + 8, cz + 8));
    return g;
  }
}

/** One 16x16x384 column of the world: blocks, packed light (sky<<4 | block) and per-subchunk meshes. */
export class ChunkColumn {
  cx: number;
  cz: number;
  blocks = new Uint8Array(16 * 16 * WORLD_HEIGHT);
  light = new Uint8Array(16 * 16 * WORLD_HEIGHT);
  counts = new Uint16Array(SECTION_COUNT); // non-air blocks per subchunk (empty ones are skipped)
  topY = new Int16Array(256); // highest non-air block per (x,z)
  heightmap = new Int16Array(256); // highest light-blocking block per (x,z)
  maxTop = WORLD_MIN_Y - 1;
  emitters = 0;
  lit = false; // initial light computed
  ready = false; // all 8 neighbours lit -> safe to mesh
  modified = false; // edited by the player: never discarded when far away
  opaqueMeshes: (THREE.Mesh | null)[] = new Array(SECTION_COUNT).fill(null);
  cutoutMeshes: (THREE.Mesh | null)[] = new Array(SECTION_COUNT).fill(null);
  transMeshes: (THREE.Mesh | null)[] = new Array(SECTION_COUNT).fill(null);

  constructor(cx: number, cz: number) {
    this.cx = cx;
    this.cz = cz;
  }
}

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
  private noise: any;
  private treeNoise: any;

  // Terrain collision is handled by PlayerController's voxel AABB collision.
  private mountainNoise: any;
  private caveNoise: any;

  // World storage: numeric key -> 16x16x384 column
  public chunks: Map<number, ChunkColumn> = new Map();
  private lcX = NaN;
  private lcZ = NaN;
  private lcCol: ChunkColumn | null = null;

  // Subchunk rebuild queue and streaming state
  private dirty: Map<number, { col: ChunkColumn; sy: number; geo: boolean }> = new Map();
  private lastMarkKey = -1;
  private batchDepth = 0;
  private terrainQueue: Array<[number, number, number]> = [];
  private terrainQueueIndex = 0;
  private lightQueue: ChunkColumn[] = [];
  private readyQueue: ChunkColumn[] = [];
  private queuedLight = new Set<number>();
  private queuedReady = new Set<number>();
  private streamCx = NaN;
  private streamCz = NaN;
  public seed: number = 1337;
  public renderDistance: number = 3; // chunks meshed around the player

  /** Change the streamed/meshed radius without forcing synchronous world generation. */
  public setRenderDistance(distance: number) {
    const next = Math.max(2, Math.min(35, Math.round(distance)));
    if (next === this.renderDistance) return;
    this.renderDistance = next;

    // Rebuild the request queues around the current player chunk. Do not perform generation
    // synchronously here: the normal frame-budgeted streamer will drain the queues.
    if (Number.isFinite(this.streamCx) && Number.isFinite(this.streamCz)) {
      const cx = this.streamCx;
      const cz = this.streamCz;
      this.streamCx = NaN;
      this.streamCz = NaN;
      this.updatePlayerPosition(cx * CHUNK_SIZE_X, cz * CHUNK_SIZE_Z);
    }
  }

  // Scratch buffers (avoid allocations while meshing / lighting)
  private padB = new Uint8Array(PAD * PAD * PAD);
  private padL = new Uint8Array(PAD * PAD * PAD);
  private padCols: Array<ChunkColumn | undefined> = new Array(9);
  private bufOpaque = new MeshBuilder(4096);
  private bufTrans = new MeshBuilder(256);
  private bufCutout = new MeshBuilder(256);
  private aoScratch = new Uint8Array(4);
  private skyScratch = new Float32Array(4);
  private blkScratch = new Float32Array(4);
  private leafTopScratch = new Int16Array(256);
  private debugGenerationTimeMs = 0;

  // Terrain render classes mirror Iris/Nostalgia: opaque, alpha-cutout, translucent.
  public material!: THREE.MeshBasicMaterial;
  public cutoutMaterial!: THREE.MeshBasicMaterial;
  public transparentMaterial!: THREE.MeshBasicMaterial;
  private atlasTexture!: THREE.CanvasTexture;
  private baseAtlasCanvas!: HTMLCanvasElement;
  public shaderUniforms: Record<string, { value: any }> | null = null;

  /** Texture atlas used by voxel meshes; shader-pack G-buffers sample this as gcolor. */
  public getAtlasTexture(): THREE.Texture {
    return this.atlasTexture;
  }
  private lightUniforms = { uSkyDim: { value: 0 } };
  public currentUnderground: number = 0.0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.initNoise();
    this.createTextureAtlas();
    this.generateWorldChunks();
  }

  public setRapierWorld(_world: unknown) {
    // Kept as a compatibility hook. Static voxel terrain is no longer inserted
    // into Rapier as trimesh colliders.
  }

  private initNoise() {
    this.noise = new FastNoiseLite(this.seed);
    this.noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2);
    this.noise.SetFrequency(0.035);
    this.noise.SetFractalType(FastNoiseLite.FractalType.FBm);
    this.noise.SetFractalOctaves(3);

    this.treeNoise = new FastNoiseLite(this.seed === 1337 ? 1337 : this.seed + 999);
    this.treeNoise.SetNoiseType(FastNoiseLite.NoiseType.Cellular);
    this.treeNoise.SetFrequency(0.08);

    this.mountainNoise = new FastNoiseLite(this.seed + 17);
    this.mountainNoise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2);
    this.mountainNoise.SetFrequency(0.006);
    this.mountainNoise.SetFractalType(FastNoiseLite.FractalType.FBm);
    this.mountainNoise.SetFractalOctaves(3);

    this.caveNoise = new FastNoiseLite(this.seed + 31);
    this.caveNoise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2);
    this.caveNoise.SetFrequency(0.045);
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

    // 7,0: Leaves. Deliberately contains transparent pixels so the built-in texture
    // exercises the same alpha-cutout path as a real Minecraft leaf PNG.
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
      // Deterministic leaf gaps; the alpha test discards these fragments while
      // the surrounding leaf faces still write depth and participate in shadows.
      for (let px = 0; px < 16; px++) {
        for (let py = 0; py < 16; py++) {
          if (((px * 17 + py * 31 + 7) % 11) < 3) c.clearRect(ox + px, oy + py, 1, 1);
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

    // 14,0: Jukebox fallback texture (custom resource packs override this)
    drawTile(14, 0, (c, ox, oy) => {
      c.fillStyle = '#6b4b2b'; c.fillRect(ox, oy, 16, 16);
      c.fillStyle = '#8a6337'; c.fillRect(ox, oy, 16, 3);
      c.fillStyle = '#3d2a18'; c.fillRect(ox + 3, oy + 5, 10, 7);
      c.fillStyle = '#b58a52'; c.fillRect(ox + 4, oy + 6, 8, 5);
    });

    // 13,0: Glowstone
    drawTile(13, 0, (c, ox, oy) => {
      c.fillStyle = '#b8863a';
      c.fillRect(ox, oy, 16, 16);
      for (let px = 0; px < 16; px++) {
        for (let py = 0; py < 16; py++) {
          const r = Math.random();
          if (r > 0.45) {
            c.fillStyle = r > 0.9 ? '#fff1b0' : r > 0.7 ? '#f7cf6a' : '#8a5f22';
            c.fillRect(ox + px, oy + py, 1, 1);
          }
        }
      }
    });

    this.baseAtlasCanvas = canvas;
    this.atlasTexture = this.composeAtlas(16, () => null);

    // Minecraft-style materials. A small shader patch adds per-vertex sky + block light
    // (separate channels so the day/night cycle can dim only the sky light, no remeshing).
    this.material = new THREE.MeshBasicMaterial({
      map: this.atlasTexture,
      vertexColors: true,
      transparent: false,
      side: THREE.FrontSide,
      depthWrite: true,
    });
    // Iris TERRAIN_CUTOUT: alpha-tested foliage stays in the depth/G-buffer path.
    this.cutoutMaterial = new THREE.MeshBasicMaterial({
      map: this.atlasTexture,
      vertexColors: true,
      transparent: false,
      alphaTest: 0.1,
      // Foliage is a crossed/planar cutout surface in Minecraft. Both sides
      // must render; back-face culling makes leaves disappear from many angles.
      side: THREE.DoubleSide,
      depthWrite: true,
    });
    // Iris TERRAIN_TRANSLUCENT / Nostalgia forward.fsh: real texture alpha is blended
    // after opaque + cutout terrain and does not write depth.
    this.transparentMaterial = new THREE.MeshBasicMaterial({
      map: this.atlasTexture,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.patchLightShader(this.material);
    this.patchLightShader(this.cutoutMaterial);
    this.patchLightShader(this.transparentMaterial);
  }

  private patchLightShader(mat: THREE.MeshBasicMaterial) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uSkyDim = this.lightUniforms.uSkyDim;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aLight;\nvarying vec2 vLight;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLight = aLight;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uSkyDim;
          varying vec2 vLight;
          // Vanilla's non-linear light curve. At sky light 15 this is 1.0;
          // at the effective midnight sky light 4 it is much dimmer.
          float mcLight(float l) { float f = 1.0 - l; return (1.0 - f) / (f * 3.0 + 1.0); }`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            float skyL = max(vLight.x - uSkyDim * (${(SKY_DIM_LEVELS / 15).toFixed(5)}), 0.0);
            // Minecraft's moonlit sky light is visibly blue while daytime sky light is white.
            vec3 skyCol = mix(vec3(1.0), vec3(0.52, 0.68, 1.0), smoothstep(0.05, 1.0, uSkyDim));
            // Moonlight tint affects only actual sky light. Block light remains warm/neutral,
            // so caves do not inherit a fake blue ambient fill.
            vec3 skyLight = vec3(mcLight(skyL)) * skyCol;
            vec3 blockLight = vec3(mcLight(vLight.y)) * vec3(1.0, 0.82, 0.6);
            vec3 lc = max(skyLight, blockLight);
            lc = max(lc, vec3(0.03, 0.032, 0.045));
            diffuseColor.rgb *= pow(lc, vec3(2.2));
          }`
        );
    };
    mat.customProgramCacheKey = () => 'mc-voxel-light-v1';
  }

  /**
   * Build the block atlas: 16 tiles in a row, each with an edge-extruded gutter of res/8 px.
   * `tileImg(col)` returns a pack texture for that tile or null to use the built-in default.
   */
  private composeAtlas(res: number, tileImg: (col: number) => HTMLCanvasElement | null): THREE.CanvasTexture {
    const pad = res / 8;
    const stride = res + pad * 2;
    const canvas = document.createElement('canvas');
    canvas.width = stride * 16;
    canvas.height = stride;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    for (let col = 0; col < 16; col++) {
      const x = col * stride + pad;
      const y = pad;
      const img = tileImg(col);
      if (img) ctx.drawImage(img, 0, 0, img.width, img.width, x, y, res, res);
      else ctx.drawImage(this.baseAtlasCanvas, col * 16, 0, 16, 16, x, y, res, res);
      // extrude edges into the gutter (left/right first, then full rows for the corners)
      ctx.drawImage(canvas, x, y, 1, res, x - pad, y, pad, res);
      ctx.drawImage(canvas, x + res - 1, y, 1, res, x + res, y, pad, res);
      ctx.drawImage(canvas, x - pad, y, stride, 1, x - pad, 0, stride, pad);
      ctx.drawImage(canvas, x - pad, y + res - 1, stride, 1, x - pad, y + res, stride, pad);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
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
   * UVs are resolution independent, so no remeshing is needed.
   */
  public async applyResourcePack() {
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
      [13, ['block/glowstone'], null],
      [14, ['block/jukebox'], null],
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
    res = Math.ceil(res / 8) * 8; // gutter is res/8 px

    const tinted = (img: HTMLCanvasElement, color: string) => {
      const c = document.createElement('canvas');
      c.width = res;
      c.height = res;
      const g = c.getContext('2d')!;
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0, img.width, img.width, 0, 0, res, res);
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = color;
      g.fillRect(0, 0, res, res);
      g.globalCompositeOperation = 'destination-in'; // keep original alpha
      g.drawImage(img, 0, 0, img.width, img.width, 0, 0, res, res);
      return c;
    };

    const prepared = new Map<number, HTMLCanvasElement>();
    for (const t of loaded) {
      if (!t.img) continue;
      const c = document.createElement('canvas');
      c.width = res;
      c.height = res;
      const g = c.getContext('2d')!;
      g.imageSmoothingEnabled = false;
      const base = t.tint ? tinted(t.img, t.tint) : t.img;
      g.drawImage(base, 0, 0, base.width, base.width, 0, 0, res, res);
      if (t.overlay) g.drawImage(tinted(t.overlay, grassTint), 0, 0, res, res);
      prepared.set(t.col, c);
    }

    const tex = this.composeAtlas(res, (col) => prepared.get(col) ?? null);
    const old = this.atlasTexture;
    this.atlasTexture = tex;
    this.material.map = tex;
    this.cutoutMaterial.map = tex;
    this.transparentMaterial.map = tex;
    this.material.needsUpdate = true;
    this.cutoutMaterial.needsUpdate = true;
    this.transparentMaterial.needsUpdate = true;
    old.dispose();
  }

  /** 0 = noon, 1 = midnight: how much sky light is removed by the day/night cycle. */
  public setSkyDim(v: number) {
    this.lightUniforms.uSkyDim.value = v;
  }

  /** Day/night world tint (voxel materials are unlit, so multiply their colour) */
  public setLightTint(color: THREE.Color) {
    this.material.color.copy(color);
    this.cutoutMaterial.color.copy(color);
    this.transparentMaterial.color.copy(color);
  }

  public setWireframe(enabled: boolean) {
    if (this.material) {
      this.material.wireframe = enabled;
      this.material.needsUpdate = true;
    }
    if (this.cutoutMaterial) {
      this.cutoutMaterial.wireframe = enabled;
      this.cutoutMaterial.needsUpdate = true;
    }
    if (this.transparentMaterial) {
      this.transparentMaterial.wireframe = enabled;
      this.transparentMaterial.needsUpdate = true;
    }
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
      case VoxelType.GLOWSTONE:
        return [13, 0];
      case VoxelType.JUKEBOX:
        return [14, 0];
      default:
        return [0, 0];
    }
  }

  // ======================================================================
  //  Chunk storage / lookup
  // ======================================================================

  private ckey(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  public getColumn(cx: number, cz: number): ChunkColumn | undefined {
    return this.chunks.get(this.ckey(cx, cz));
  }

  /** Column containing world (wx, wz), with a one-entry cache (BFS/meshing hammer this). */
  private colAt(wx: number, wz: number): ChunkColumn | null {
    const cx = wx >> 4;
    const cz = wz >> 4;
    if (cx === this.lcX && cz === this.lcZ) return this.lcCol;
    this.lcX = cx;
    this.lcZ = cz;
    this.lcCol = this.chunks.get(this.ckey(cx, cz)) ?? null;
    return this.lcCol;
  }

  private invalidateColCache() {
    this.lcX = NaN;
    this.lcZ = NaN;
    this.lcCol = null;
  }

  /** Get (generating terrain if needed) the column at chunk coords. */
  public getChunk(cx: number, cz: number): ChunkColumn {
    const key = this.ckey(cx, cz);
    let col = this.chunks.get(key);
    if (!col) {
      col = new ChunkColumn(cx, cz);
      this.chunks.set(key, col);
      this.invalidateColCache();
      this.populateChunkTerrain(col);
      this.finalizeColumn(col);
    }
    return col;
  }

  private idx(lx: number, wy: number, lz: number): number {
    return (((wy - WORLD_MIN_Y) << 4 | lz) << 4) | lx;
  }

  public getVoxel(wx: number, wy: number, wz: number): VoxelType {
    if (wy < WORLD_MIN_Y || wy >= WORLD_MAX_Y) return VoxelType.AIR;
    const col = this.colAt(wx, wz);
    if (!col) return VoxelType.AIR;
    return col.blocks[this.idx(wx & 15, wy, wz & 15)] as VoxelType;
  }

  // ======================================================================
  //  Terrain generation
  // ======================================================================

  private hash3(x: number, y: number, z: number): number {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }

  /**
   * Terrain for a full -64..319 column: bedrock floor with rough layer, stone, dirt/grass/sand,
   * mountains up to ~y=130, cheese caves (with glowstone in cave ceilings) and trees.
   * The flat plaza stays at y=8 so the physics presets keep working.
   */
  private populateChunkTerrain(col: ChunkColumn) {
    const { cx, cz, blocks } = col;
    for (let lx = 0; lx < 16; lx++) {
      for (let lz = 0; lz < 16; lz++) {
        const wx = cx * 16 + lx;
        const wz = cz * 16 + lz;
        const dist = Math.hypot(wx, wz);

        let height = 8;
        if (dist >= 12) {
          const amp = Math.min(1, (dist - 12) / 16);
          const n = this.noise.GetNoise(wx, wz);
          let h = (n + 1) * 4.5 * amp;
          const m = this.mountainNoise.GetNoise(wx, wz);
          if (m > 0.08) h += Math.pow((m - 0.08) / 0.92, 1.5) * 120 * amp;
          const rim = Math.min(4, Math.floor(Math.pow(dist / 28, 2) * 3));
          height = Math.max(5, Math.floor(8 + h + rim * amp));
        }
        height = Math.min(height, WORLD_MAX_Y - 14);

        // Bedrock: solid floor with a ragged 4-layer ceiling like vanilla
        blocks[this.idx(lx, WORLD_MIN_Y, lz)] = VoxelType.BEDROCK;
        for (let k = 1; k <= 4; k++) {
          if ((this.hash3(wx, WORLD_MIN_Y + k, wz) % 5) < 5 - k) blocks[this.idx(lx, WORLD_MIN_Y + k, lz)] = VoxelType.BEDROCK;
        }

        for (let y = WORLD_MIN_Y + 1; y <= height; y++) {
          let block = VoxelType.STONE;
          if (y === height) block = height >= 110 ? VoxelType.STONE : y <= 6 ? VoxelType.SAND : VoxelType.GRASS;
          else if (y >= height - 3) block = height >= 110 ? VoxelType.STONE : y <= 6 ? VoxelType.SAND : VoxelType.DIRT;
          blocks[this.idx(lx, y, lz)] = block;
        }

        // Caves (kept away from the central plaza and sealed from the surface)
        if (dist > 20) {
          let prevCarved = false;
          for (let y = WORLD_MIN_Y + 6; y <= height - 8; y++) {
            const carved = this.caveNoise.GetNoise(wx, y * 1.6, wz) > 0.5;
            const i = this.idx(lx, y, lz);
            if (carved) {
              blocks[i] = VoxelType.AIR;
            } else if (prevCarved && blocks[i] === VoxelType.STONE && this.hash3(wx, y, wz) % 45 === 0) {
              blocks[i] = VoxelType.GLOWSTONE; // glowing cave ceiling
            }
            prevCarved = carved;
          }
        }

        // Procedural trees on grassy hills outside center
        if (dist > 13 && height > 6 && height < 100) {
          const treeVal = this.treeNoise.GetNoise(wx, wz);
          if (treeVal > 0.55 && (wx + wz) % 5 === 0 && blocks[this.idx(lx, height, lz)] === VoxelType.GRASS) {
            this.placeTree(col, lx, height + 1, lz, wx, wz);
          }
        }
      }
    }
  }

  private placeTree(col: ChunkColumn, lx: number, baseY: number, lz: number, wx: number, wz: number) {
    const trunkHeight = 4;
    for (let ty = 0; ty < trunkHeight; ty++) {
      const y = baseY + ty;
      if (y < WORLD_MAX_Y) col.blocks[this.idx(lx, y, lz)] = VoxelType.WOOD;
    }
    const leafBase = baseY + trunkHeight - 1;
    for (let ox = -2; ox <= 2; ox++) {
      for (let oz = -2; oz <= 2; oz++) {
        for (let oy = 0; oy <= 2; oy++) {
          if (Math.abs(ox) === 2 && Math.abs(oz) === 2 && oy === 2) continue;
          const curWx = wx + ox;
          const curWz = wz + oz;
          const curY = leafBase + oy;
          if (curY >= WORLD_MAX_Y) continue;
          if (curWx >> 4 !== col.cx || curWz >> 4 !== col.cz) continue; // stays inside this chunk
          const i = this.idx(curWx & 15, curY, curWz & 15);
          if (col.blocks[i] === VoxelType.AIR) col.blocks[i] = VoxelType.LEAVES;
        }
      }
    }
  }

  /** Recompute per-section counts, topmost block, light-blocking heightmap and emitter count. */
  private finalizeColumn(col: ChunkColumn) {
    const b = col.blocks;
    col.emitters = 0;
    let highestSection = -1;
    for (let sy = 0; sy < SECTION_COUNT; sy++) {
      let count = 0;
      const base = sy * 4096;
      for (let i = 0; i < 4096; i++) {
        const t = b[base + i];
        if (t !== 0) {
          count++;
          if (EMISSION[t] > 0) col.emitters++;
        }
      }
      col.counts[sy] = count;
      if (count > 0) highestSection = sy;
    }
    col.topY.fill(WORLD_MIN_Y - 1);
    col.heightmap.fill(WORLD_MIN_Y - 1);
    col.maxTop = WORLD_MIN_Y - 1;
    if (highestSection < 0) return;
    const yStart = Math.min(WORLD_MAX_Y - 1, WORLD_MIN_Y + highestSection * 16 + 15);
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        let top = WORLD_MIN_Y - 1;
        let hm = WORLD_MIN_Y - 1;
        for (let y = yStart; y >= WORLD_MIN_Y; y--) {
          const t = b[this.idx(lx, y, lz)];
          if (t === 0) continue;
          if (top < WORLD_MIN_Y) top = y;
          if (OPACITY[t] >= 15) {
            hm = y;
            break;
          }
        }
        col.topY[lz * 16 + lx] = top;
        col.heightmap[lz * 16 + lx] = hm;
        if (top > col.maxTop) col.maxTop = top;
      }
    }
  }

  // ======================================================================
  //  Flood-fill lighting (Minecraft style)
  //  - Two 4-bit channels per block: sky light (sunlight) and block light (emitters).
  //  - Light drops by 1 per block (or by the block's opacity); sky light falls straight
  //    down at full strength, which is what makes caves/overhangs fill in naturally.
  //  - Placing/removing blocks uses the classic two-pass BFS: a removal pass that clears
  //    everything that depended on the changed cell, then a re-add pass from the borders.
  //  - Everything works in world coordinates, so light floods across chunk borders.
  // ======================================================================

  /** Light level (0-15) of channel ch (0 = sky, 1 = block) at a world cell, or -1 if unloaded. */
  private getLightCh(ch: number, wx: number, wy: number, wz: number): number {
    if (wy >= WORLD_MAX_Y) return ch === 0 ? 15 : 0;
    if (wy < WORLD_MIN_Y) return 0;
    const col = this.colAt(wx, wz);
    if (!col || !col.lit) return -1;
    const v = col.light[this.idx(wx & 15, wy, wz & 15)];
    return ch === 0 ? v >> 4 : v & 15;
  }

  private setLightCh(ch: number, wx: number, wy: number, wz: number, val: number) {
    const col = this.colAt(wx, wz);
    if (!col) return;
    const i = this.idx(wx & 15, wy, wz & 15);
    const old = col.light[i];
    col.light[i] = ch === 0 ? (old & 0x0f) | (val << 4) : (old & 0xf0) | val;
    if (col.ready) this.markAround(wx, wy, wz, false);
  }

  private blockTypeAt(wx: number, wy: number, wz: number): number {
    if (wy >= WORLD_MAX_Y) return 0;
    if (wy < WORLD_MIN_Y) return VoxelType.BEDROCK;
    const col = this.colAt(wx, wz);
    if (!col) return -1;
    return col.blocks[this.idx(wx & 15, wy, wz & 15)];
  }

  /** Breadth-first light propagation. `q` holds flat x,y,z triples of already-lit cells. */
  private propagateAdd(ch: number, q: number[]) {
    let head = 0;
    while (head < q.length) {
      const x = q[head++];
      const y = q[head++];
      const z = q[head++];
      const L = this.getLightCh(ch, x, y, z);
      if (L <= 1) continue;
      for (let d = 0; d < 6; d++) {
        const nx = x + DIR_X[d];
        const ny = y + DIR_Y[d];
        const nz = z + DIR_Z[d];
        const t = this.blockTypeAt(nx, ny, nz);
        if (t < 0) continue; // unloaded
        const op = OPACITY[t];
        if (op >= 15) continue;
        let nl = L - (op > 1 ? op : 1);
        if (ch === 0 && d === 3 && L === 15 && op === 0) nl = 15; // sunlight falls without loss
        if (nl <= 0) continue;
        const cur = this.getLightCh(ch, nx, ny, nz);
        if (cur < 0 || cur >= nl) continue;
        this.setLightCh(ch, nx, ny, nz, nl);
        q.push(nx, ny, nz);
      }
    }
  }

  /** Removal pass: darken every cell that was lit *through* the removed cells, collect re-add seeds. */
  private propagateRemove(ch: number, rq: number[], addQ: number[]) {
    let head = 0;
    while (head < rq.length) {
      const x = rq[head++];
      const y = rq[head++];
      const z = rq[head++];
      const lvl = rq[head++];
      for (let d = 0; d < 6; d++) {
        const nx = x + DIR_X[d];
        const ny = y + DIR_Y[d];
        const nz = z + DIR_Z[d];
        const cur = this.getLightCh(ch, nx, ny, nz);
        if (cur <= 0) continue;
        const sunDown = ch === 0 && d === 3 && lvl === 15 && cur === 15;
        if (cur < lvl || sunDown) {
          if (ch === 1) {
            const t = this.blockTypeAt(nx, ny, nz);
            if (t >= 0 && EMISSION[t] >= cur) {
              addQ.push(nx, ny, nz); // an emitter: keep it and re-spread
              continue;
            }
          }
          this.setLightCh(ch, nx, ny, nz, 0);
          rq.push(nx, ny, nz, cur);
        } else {
          addQ.push(nx, ny, nz); // independent (brighter) source, re-spread into the hole
        }
      }
    }
  }

  /** Incremental light update after a block change at a world cell. */
  private relight(wx: number, wy: number, wz: number, oldT: number, newT: number) {
    const oldOp = OPACITY[oldT];
    const newOp = OPACITY[newT];
    for (let ch = 1; ch >= 0; ch--) {
      const addQ: number[] = [];
      const old = this.getLightCh(ch, wx, wy, wz);
      const emitDropped = ch === 1 && EMISSION[oldT] > EMISSION[newT];
      if (old > 0 && (newOp > oldOp || emitDropped)) {
        this.setLightCh(ch, wx, wy, wz, 0);
        this.propagateRemove(ch, [wx, wy, wz, old], addQ);
      }
      if (ch === 1 && EMISSION[newT] > 0) {
        if (this.getLightCh(1, wx, wy, wz) < EMISSION[newT]) this.setLightCh(1, wx, wy, wz, EMISSION[newT]);
        addQ.push(wx, wy, wz);
      }
      if (newOp < oldOp || emitDropped || (newOp > oldOp)) {
        // pull light in from the six neighbours (opened cell, or hole left by the removal pass)
        for (let d = 0; d < 6; d++) {
          const nx = wx + DIR_X[d];
          const ny = wy + DIR_Y[d];
          const nz = wz + DIR_Z[d];
          if (this.getLightCh(ch, nx, ny, nz) > 1) addQ.push(nx, ny, nz);
        }
      }
      if (addQ.length) this.propagateAdd(ch, addQ);
    }
  }

  /** Compute the initial light of a freshly generated column and flood it into/out of neighbours. */
  private initChunkLight(col: ChunkColumn) {
    if (col.lit) return;
    const L = col.light;
    const blocks = col.blocks;
    L.fill(0);

    // Everything above the tallest block sees the sky
    const first = Math.min(WORLD_MAX_Y, col.maxTop + 1);
    L.fill(0xf0, this.idx(0, first, 0));

    const leafTop = this.leafTopScratch;
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        let cur = 15;
        let lt = WORLD_MIN_Y - 1;
        for (let y = col.maxTop; y >= WORLD_MIN_Y; y--) {
          const i = this.idx(lx, y, lz);
          const op = OPACITY[blocks[i]];
          if (op >= 15) break;
          if (op > 0) {
            cur = Math.max(0, cur - op);
            if (lt < WORLD_MIN_Y) lt = y;
          }
          L[i] = cur << 4;
        }
        leafTop[lz * 16 + lx] = lt;
      }
    }
    col.lit = true;

    const skyQ: number[] = [];
    const blockQ: number[] = [];
    const wx0 = col.cx * 16;
    const wz0 = col.cz * 16;
    const west = this.chunks.get(this.ckey(col.cx - 1, col.cz));
    const east = this.chunks.get(this.ckey(col.cx + 1, col.cz));
    const north = this.chunks.get(this.ckey(col.cx, col.cz - 1));
    const south = this.chunks.get(this.ckey(col.cx, col.cz + 1));

    // Sky seeds: lit cells that sit next to a column whose roof is higher (and leaf-shaded cells)
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const c = lz * 16 + lx;
        const hm = col.heightmap[c];
        const hW = lx > 0 ? col.heightmap[c - 1] : west ? west.heightmap[lz * 16 + 15] : hm;
        const hE = lx < 15 ? col.heightmap[c + 1] : east ? east.heightmap[lz * 16] : hm;
        const hN = lz > 0 ? col.heightmap[c - 16] : north ? north.heightmap[15 * 16 + lx] : hm;
        const hS = lz < 15 ? col.heightmap[c + 16] : south ? south.heightmap[lx] : hm;
        const yTo = Math.max(hW, hE, hN, hS, leafTop[c]);
        for (let y = hm + 1; y <= yTo; y++) {
          if (((L[this.idx(lx, y, lz)] >> 4) & 15) > 1) skyQ.push(wx0 + lx, y, wz0 + lz);
        }
      }
    }

    // Block-light emitters
    if (col.emitters > 0) {
      for (let sy = 0; sy < SECTION_COUNT; sy++) {
        if (col.counts[sy] === 0) continue;
        const base = sy * 4096;
        for (let i = 0; i < 4096; i++) {
          const e = EMISSION[blocks[base + i]];
          if (e > 0) {
            L[base + i] = (L[base + i] & 0xf0) | e;
            const lx = i & 15;
            const lz = (i >> 4) & 15;
            const y = WORLD_MIN_Y + sy * 16 + (i >> 8);
            blockQ.push(wx0 + lx, y, wz0 + lz);
          }
        }
      }
    }

    // Flood across the borders in both directions with every already-lit neighbour
    const edge = (n: ChunkColumn | undefined, side: 0 | 1 | 2 | 3) => {
      if (!n || !n.lit) return;
      const yMax = Math.min(WORLD_MAX_Y - 1, Math.max(col.maxTop, n.maxTop) + 2);
      for (let k = 0; k < 16; k++) {
        // our edge cell (ox,oz) and the neighbour's touching cell (nx,nz), as chunk-local coords
        let ox = 0, oz = 0, nx = 0, nz = 0;
        if (side === 0) { ox = 0; oz = k; nx = 15; nz = k; }
        else if (side === 1) { ox = 15; oz = k; nx = 0; nz = k; }
        else if (side === 2) { ox = k; oz = 0; nx = k; nz = 15; }
        else { ox = k; oz = 15; nx = k; nz = 0; }
        for (let y = WORLD_MIN_Y; y <= yMax; y++) {
          const li = L[this.idx(ox, y, oz)];
          const ni = n.light[this.idx(nx, y, nz)];
          if ((li >> 4) > 1) skyQ.push(wx0 + ox, y, wz0 + oz);
          if ((li & 15) > 1) blockQ.push(wx0 + ox, y, wz0 + oz);
          if ((ni >> 4) > 1) skyQ.push(n.cx * 16 + nx, y, n.cz * 16 + nz);
          if ((ni & 15) > 1) blockQ.push(n.cx * 16 + nx, y, n.cz * 16 + nz);
        }
      }
    };
    edge(west, 0);
    edge(east, 1);
    edge(north, 2);
    edge(south, 3);

    this.propagateAdd(0, skyQ);
    this.propagateAdd(1, blockQ);
  }

  // ======================================================================
  //  Dirty tracking and subchunk meshing
  // ======================================================================

  private markDirty(cx: number, cz: number, sy: number, geo: boolean) {
    if (sy < 0 || sy >= SECTION_COUNT) return;
    const col = this.chunks.get(this.ckey(cx, cz));
    if (!col || !col.ready) return;
    const k = this.ckey(cx, cz) * 32 + sy;
    const e = this.dirty.get(k);
    if (e) {
      if (geo) e.geo = true;
    } else {
      this.dirty.set(k, { col, sy, geo });
    }
  }

  /** Mark the subchunk containing the cell, plus neighbours the cell borders (AO / smooth light read across edges). */
  private markAround(wx: number, wy: number, wz: number, geo: boolean) {
    const lx = wx & 15;
    const lz = wz & 15;
    const ly = (wy - WORLD_MIN_Y) & 15;
    const cx = wx >> 4;
    const cz = wz >> 4;
    const sy = (wy - WORLD_MIN_Y) >> 4;
    if (!geo && lx > 0 && lx < 15 && lz > 0 && lz < 15 && ly > 0 && ly < 15) {
      const key = this.ckey(cx, cz) * 32 + sy;
      if (key === this.lastMarkKey) return;
      this.lastMarkKey = key;
      this.markDirty(cx, cz, sy, false);
      return;
    }
    for (let dx = lx === 0 ? -1 : 0; dx <= (lx === 15 ? 1 : 0); dx++) {
      for (let dz = lz === 0 ? -1 : 0; dz <= (lz === 15 ? 1 : 0); dz++) {
        for (let dy = ly === 0 ? -1 : 0; dy <= (ly === 15 ? 1 : 0); dy++) {
          this.markDirty(cx + dx, cz + dz, sy + dy, geo);
        }
      }
    }
  }

  /** Rebuild queued subchunk meshes, nearest first, until the time budget is spent. */
  private processDirty(deadline: number) {
    if (this.dirty.size === 0) return;
    const entries = Array.from(this.dirty.entries());
    if (entries.length > 1) {
      const px = this.streamCx;
      const pz = this.streamCz;
      entries.sort((a, b) => {
        const da = (a[1].col.cx - px) ** 2 + (a[1].col.cz - pz) ** 2;
        const db = (b[1].col.cx - px) ** 2 + (b[1].col.cz - pz) ** 2;
        return da - db;
      });
    }
    for (const [k, e] of entries) {
      this.dirty.delete(k);
      if (e.col.ready && this.chunks.get(this.ckey(e.col.cx, e.col.cz)) === e.col) {
        this.buildSection(e.col, e.sy, e.geo);
      }
      if (performance.now() > deadline) break;
    }
  }

  private fillPad(col: ChunkColumn, sy: number) {
    const cols = this.padCols;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        cols[(dz + 1) * 3 + dx + 1] = this.chunks.get(this.ckey(col.cx + dx, col.cz + dz));
      }
    }
    const B = this.padB;
    const Lt = this.padL;
    const baseY = WORLD_MIN_Y + sy * 16;
    for (let py = 0; py < PAD; py++) {
      const wy = baseY + py - 1;
      for (let pz = 0; pz < PAD; pz++) {
        const czo = pz === 0 ? 0 : pz === PAD - 1 ? 2 : 1;
        const lz = pz === 0 ? 15 : pz === PAD - 1 ? 0 : pz - 1;
        for (let px = 0; px < PAD; px++) {
          const cxo = px === 0 ? 0 : px === PAD - 1 ? 2 : 1;
          const lx = px === 0 ? 15 : px === PAD - 1 ? 0 : px - 1;
          const pi = (py * PAD + pz) * PAD + px;
          if (wy >= WORLD_MAX_Y) {
            B[pi] = 0;
            Lt[pi] = 0xf0;
          } else if (wy < WORLD_MIN_Y) {
            B[pi] = 0;
            Lt[pi] = 0;
          } else {
            const c = cols[czo * 3 + cxo];
            if (!c) {
              B[pi] = VoxelType.STONE; // unloaded neighbour: treat as solid so no border faces appear
              Lt[pi] = 0;
            } else {
              const ci = (((wy - WORLD_MIN_Y) << 4 | lz) << 4) | lx;
              B[pi] = c.blocks[ci];
              Lt[pi] = c.light[ci];
            }
          }
        }
      }
    }
  }

  /**
   * Mesh one 16x16x16 subchunk.
   *  - Works on an 18^3 padded copy (blocks + light) that includes the neighbouring chunks, so faces
   *    on chunk borders are culled correctly and AO / smooth light are sampled across borders.
   *  - Vertex AO + Minecraft smooth lighting (average of the 4 cells around each vertex), with the
   *    quad diagonal flipped to hide anisotropy. Sky/block light are separate vertex attributes so the
   *    day/night cycle can dim sky light without remeshing.
   */
  private buildSection(col: ChunkColumn, sy: number, rebuildCollider: boolean) {
    const count = col.counts[sy];
    const op = this.bufOpaque;
    const tr = this.bufTrans;
    const cut = this.bufCutout;
    // Cutout geometry is intentionally kept separate from opaque geometry so its
    // alpha-test material can participate in the same depth/G-buffer pass without
    // becoming blended transparency.
    op.reset();
    tr.reset();
    cut.reset();

    if (count > 0) {
      this.fillPad(col, sy);
      const B = this.padB;
      const Lt = this.padL;
      const baseWy = WORLD_MIN_Y + sy * 16;
      const wx0 = col.cx * 16;
      const wz0 = col.cz * 16;
      const aoIdx = this.aoScratch;
      const skyV = this.skyScratch;
      const blkV = this.blkScratch;

      for (let ly = 0; ly < 16; ly++) {
        for (let lz = 0; lz < 16; lz++) {
          for (let lx = 0; lx < 16; lx++) {
            const pi = ((ly + 1) * PAD + lz + 1) * PAD + lx + 1;
            const voxel = B[pi];
            if (voxel === 0) continue;
            const renderClass = voxel === VoxelType.GLASS ? 'translucent' : voxel === VoxelType.LEAVES ? 'cutout' : 'opaque';
            const mb = renderClass === 'translucent' ? tr : renderClass === 'cutout' ? cut : op;
            const wy = baseWy + ly;

            for (let f = 0; f < 6; f++) {
              if (f === 3 && wy <= WORLD_MIN_Y) continue;
              const nb = B[pi + FACE_OFF[f]];
              // Opaque and cutout blocks occlude neighbouring faces; translucent glass
              // keeps a face against every non-air neighbour so it remains visible through
              // the surface. Two adjacent glass blocks do not generate an internal face.
              if (
                renderClass === 'translucent'
                  ? nb !== 0
                  : renderClass === 'cutout'
                    ? nb === VoxelType.LEAVES
                    : !(nb === 0 || nb === VoxelType.GLASS)
              ) continue;

              const tileCol = this.getVoxelFaceTile(voxel, f)[0];
              const u0 = (tileCol + ATLAS_INNER_MIN) / 16;
              const u1 = (tileCol + ATLAS_INNER_MAX) / 16;
              const infos = FACE_INFO[f];

              mb.ensure(1);
              const vb = mb.vc;
              let b0 = 0, b1 = 0, b2 = 0, b3 = 0;
              for (let k = 0; k < 4; k++) {
                const inf = infos[k];
                const l0 = Lt[pi + inf.oCenter];
                const i1 = pi + inf.o1;
                const i2 = pi + inf.o2;
                const ic = pi + inf.oC;
                const s1 = B[i1] !== 0 && B[i1] !== VoxelType.GLASS;
                const s2 = B[i2] !== 0 && B[i2] !== VoxelType.GLASS;
                const sc = B[ic] !== 0 && B[ic] !== VoxelType.GLASS;
                const aoLevel = s1 && s2 ? 3 : (s1 ? 1 : 0) + (s2 ? 1 : 0) + (sc ? 1 : 0);
                const l1 = s1 ? l0 : Lt[i1];
                const l2 = s2 ? l0 : Lt[i2];
                const lc = (s1 && s2) || sc ? l0 : Lt[ic];
                const sky = ((l0 >> 4) + (l1 >> 4) + (l2 >> 4) + (lc >> 4)) / 60;
                const blk = ((l0 & 15) + (l1 & 15) + (l2 & 15) + (lc & 15)) / 60;
                aoIdx[k] = aoLevel;
                skyV[k] = sky;
                blkV[k] = blk;
                const bright = AO_VALUES[aoLevel] * (sky > blk ? sky : blk);
                if (k === 0) b0 = bright;
                else if (k === 1) b1 = bright;
                else if (k === 2) b2 = bright;
                else b3 = bright;

                const o = (vb + k);
                mb.pos[o * 3] = wx0 + lx + inf.px;
                mb.pos[o * 3 + 1] = wy + inf.py;
                mb.pos[o * 3 + 2] = wz0 + lz + inf.pz;
                mb.normal[o * 3] = FACE_NORMALS[f][0];
                mb.normal[o * 3 + 1] = FACE_NORMALS[f][1];
                mb.normal[o * 3 + 2] = FACE_NORMALS[f][2];
                mb.materialClass[o] = renderClass === 'translucent' ? 1 : 0;
                const shade = SHADE_LINEAR[f * 4 + aoLevel];
                mb.col[o * 3] = shade;
                mb.col[o * 3 + 1] = shade;
                mb.col[o * 3 + 2] = shade;
                mb.lit[o * 2] = sky;
                mb.lit[o * 2 + 1] = blk;
                mb.uv[o * 2] = k === 0 || k === 3 ? u0 : u1;
                mb.uv[o * 2 + 1] = k < 2 ? ATLAS_INNER_MIN_V : ATLAS_INNER_MAX_V;
              }

              if (b0 + b2 > b1 + b3) {
                mb.idx[mb.ic++] = vb; mb.idx[mb.ic++] = vb + 1; mb.idx[mb.ic++] = vb + 2;
                mb.idx[mb.ic++] = vb; mb.idx[mb.ic++] = vb + 2; mb.idx[mb.ic++] = vb + 3;
              } else {
                mb.idx[mb.ic++] = vb + 1; mb.idx[mb.ic++] = vb + 2; mb.idx[mb.ic++] = vb + 3;
                mb.idx[mb.ic++] = vb + 1; mb.idx[mb.ic++] = vb + 3; mb.idx[mb.ic++] = vb;
              }
              mb.vc += 4;
            }
          }
        }
      }
    }

    const cxw = col.cx * 16 + 8;
    const cyw = WORLD_MIN_Y + sy * 16 + 8;
    const czw = col.cz * 16 + 8;
    this.applyBuilder(col, sy, op, 'opaque', cxw, cyw, czw);
    this.applyBuilder(col, sy, cut, 'cutout', cxw, cyw, czw);
    this.applyBuilder(col, sy, tr, 'translucent', cxw, cyw, czw);
    if (rebuildCollider) this.updateSectionCollider(col, sy, op);
  }

  private applyBuilder(
    col: ChunkColumn,
    sy: number,
    mb: MeshBuilder,
    renderClass: 'opaque' | 'cutout' | 'translucent',
    cx: number,
    cy: number,
    cz: number,
  ) {
    const arr = renderClass === 'translucent' ? col.transMeshes : renderClass === 'cutout' ? col.cutoutMeshes : col.opaqueMeshes;
    const material = renderClass === 'translucent' ? this.transparentMaterial : renderClass === 'cutout' ? this.cutoutMaterial : this.material;
    let mesh = arr[sy];
    if (mb.vc === 0) {
      if (mesh) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        arr[sy] = null;
      }
      return;
    }
    const geometry = mb.toGeometry(cx, cy, cz);
    if (!mesh) {
      mesh = new THREE.Mesh(geometry, material);
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = renderClass !== 'translucent';
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;
      // Keep all terrain on the active scene layer. Translucent terrain is
      // ordered after opaque/cutout terrain instead of being hidden on a layer
      // that the main WebGPU camera/pass does not render.
      mesh.layers.set(0);
      mesh.renderOrder = renderClass === 'translucent' ? 10 : 0;
      mesh.userData = {
        isVoxelChunk: renderClass !== 'translucent',
        isVoxelChunkCutout: renderClass === 'cutout',
        isVoxelChunkTrans: renderClass === 'translucent',
        cx: col.cx,
        cz: col.cz,
        sy,
      };
      this.scene.add(mesh);
      arr[sy] = mesh;
    } else {
      mesh.geometry.dispose();
      mesh.geometry = geometry;
    }
  }

  // ======================================================================
  //  Physics colliders (one trimesh per subchunk, rebuilt only when geometry changes)
  // ======================================================================

  private updateSectionCollider(_col: ChunkColumn, _sy: number, _mb: MeshBuilder) {
    // No terrain colliders: voxel collision is resolved directly from block AABBs.
  }

  public buildPhysicsColliders() {
    // Compatibility no-op. Terrain is intentionally not registered with Rapier.
  }

  // ======================================================================
  //  Editing
  // ======================================================================

  public beginBatch() {
    this.batchDepth++;
  }

  public endBatch() {
    if (this.batchDepth > 0) this.batchDepth--;
    if (this.batchDepth === 0) this.processDirty(Infinity);
  }

  public setVoxel(wx: number, wy: number, wz: number, type: VoxelType) {
    if (wy < WORLD_MIN_Y || wy >= WORLD_MAX_Y) return;
    const cx = wx >> 4;
    const cz = wz >> 4;
    const col = this.getChunk(cx, cz);
    if (!col.lit) this.initChunkLight(col);

    const lx = wx & 15;
    const lz = wz & 15;
    const i = this.idx(lx, wy, lz);
    const old = col.blocks[i];
    if (old === type) return;

    col.blocks[i] = type;
    col.modified = true;
    const sy = (wy - WORLD_MIN_Y) >> 4;
    col.counts[sy] += (type !== 0 ? 1 : 0) - (old !== 0 ? 1 : 0);
    col.emitters += (EMISSION[type] > 0 ? 1 : 0) - (EMISSION[old] > 0 ? 1 : 0);

    // Column bookkeeping: highest block and highest light-blocking block
    const c = lz * 16 + lx;
    if (type !== 0 && wy > col.topY[c]) col.topY[c] = wy;
    else if (type === 0 && wy === col.topY[c]) {
      let y = wy - 1;
      while (y >= WORLD_MIN_Y && col.blocks[this.idx(lx, y, lz)] === 0) y--;
      col.topY[c] = y >= WORLD_MIN_Y ? y : WORLD_MIN_Y - 1;
    }
    if (OPACITY[type] >= 15 && wy > col.heightmap[c]) col.heightmap[c] = wy;
    else if (OPACITY[type] < 15 && wy === col.heightmap[c]) {
      let y = wy - 1;
      while (y >= WORLD_MIN_Y && OPACITY[col.blocks[this.idx(lx, y, lz)]] < 15) y--;
      col.heightmap[c] = y >= WORLD_MIN_Y ? y : WORLD_MIN_Y - 1;
    }
    if (col.topY[c] > col.maxTop) col.maxTop = col.topY[c];

    this.relight(wx, wy, wz, old, type);
    // geometry changed here: remesh this subchunk (and neighbours the cell touches, for culling / AO)
    this.markAround(wx, wy, wz, true);
    if (this.batchDepth === 0) this.processDirty(Infinity);
  }

  // ======================================================================
  //  Streaming
  // ======================================================================

  /** Called every physics step with the player's position. */
  public updatePlayerPosition(playerX: number, playerZ: number) {
    const pcx = Math.floor(playerX / 16);
    const pcz = Math.floor(playerZ / 16);
    if (pcx === this.streamCx && pcz === this.streamCz) return;
    this.streamCx = pcx;
    this.streamCz = pcz;

    const r = this.renderDistance;
    // Terrain queue: everything within r+2 that is not generated yet, nearest first.
    // Use an index instead of Array.shift() so a large render-distance queue does not
    // repeatedly move thousands of entries in memory.
    const q: Array<[number, number, number]> = [];
    for (let cx = pcx - r - 2; cx <= pcx + r + 2; cx++) {
      for (let cz = pcz - r - 2; cz <= pcz + r + 2; cz++) {
        if (!this.chunks.has(this.ckey(cx, cz))) q.push([cx, cz, (cx - pcx) ** 2 + (cz - pcz) ** 2]);
      }
    }
    q.sort((a, b) => a[2] - b[2]);
    this.terrainQueue = q;
    this.terrainQueueIndex = 0;

    // Rebuild the secondary queues once per player-chunk/radius change. This replaces the
    // old O(radius²) lighting/readiness scan that ran every frame and became a bottleneck
    // at large render distances.
    this.lightQueue.length = 0;
    this.readyQueue.length = 0;
    this.queuedLight.clear();
    this.queuedReady.clear();

    // Unload far chunks: drop meshes beyond r+1, delete untouched columns beyond r+3.
    for (const [key, col] of this.chunks) {
      const d = Math.max(Math.abs(col.cx - pcx), Math.abs(col.cz - pcz));
      if (d > r + 1) this.disposeColumnMeshes(col);
      if (d > r + 3 && !col.modified) {
        this.chunks.delete(key);
        this.invalidateColCache();
        continue;
      }
      if (d <= r + 1 && !col.lit) this.queueLight(col);
      if (d <= r && col.lit && !col.ready) this.queueReady(col);
    }
  }

  private queueLight(col: ChunkColumn) {
    if (col.lit) return;
    const d = Math.max(Math.abs(col.cx - this.streamCx), Math.abs(col.cz - this.streamCz));
    if (d > this.renderDistance + 1) return;
    const key = this.ckey(col.cx, col.cz);
    if (this.queuedLight.has(key)) return;
    this.queuedLight.add(key);
    this.lightQueue.push(col);
  }

  private queueReady(col: ChunkColumn) {
    if (!col.lit || col.ready) return;
    const d = Math.max(Math.abs(col.cx - this.streamCx), Math.abs(col.cz - this.streamCz));
    if (d > this.renderDistance) return;
    const key = this.ckey(col.cx, col.cz);
    if (this.queuedReady.has(key)) return;
    this.queuedReady.add(key);
    this.readyQueue.push(col);
  }

  private queueReadyNeighborhood(col: ChunkColumn) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.chunks.get(this.ckey(col.cx + dx, col.cz + dz));
        if (n) this.queueReady(n);
      }
    }
  }

  private disposeColumnMeshes(col: ChunkColumn) {
    col.ready = false;
    for (let sy = 0; sy < SECTION_COUNT; sy++) {
      const m = col.opaqueMeshes[sy];
      if (m) {
        this.scene.remove(m);
        m.geometry.dispose();
        col.opaqueMeshes[sy] = null;
      }
      const c = col.cutoutMeshes[sy];
      if (c) {
        this.scene.remove(c);
        c.geometry.dispose();
        col.cutoutMeshes[sy] = null;
      }
      const t = col.transMeshes[sy];
      if (t) {
        this.scene.remove(t);
        t.geometry.dispose();
        col.transMeshes[sy] = null;
      }
    }
  }

  /** Generate terrain -> light -> mesh for chunks around the player within a time budget. */
  private streamWork(deadline: number) {
    // 1. Terrain generation. getChunk() can be expensive, so check the deadline before
    // every column and let subsequent frames continue the queue.
    while (this.terrainQueueIndex < this.terrainQueue.length && performance.now() < deadline) {
      const [cx, cz] = this.terrainQueue[this.terrainQueueIndex++];
      if (!this.chunks.has(this.ckey(cx, cz))) {
        const col = this.getChunk(cx, cz);
        this.queueLight(col);
      }
    }
    if (this.terrainQueueIndex >= this.terrainQueue.length) {
      this.terrainQueue.length = 0;
      this.terrainQueueIndex = 0;
    }

    // 2. Lighting. This is now an explicit queue rather than scanning every chunk inside
    // the render-distance square on every frame.
    while (this.lightQueue.length && performance.now() < deadline) {
      const col = this.lightQueue.pop()!;
      this.queuedLight.delete(this.ckey(col.cx, col.cz));
      if (!this.chunks.has(this.ckey(col.cx, col.cz)) || col.lit) continue;
      this.initChunkLight(col);
      this.queueReadyNeighborhood(col);
    }

    // 3. Mark chunks mesh-ready only after their 3x3 neighbourhood is lit.
    while (this.readyQueue.length && performance.now() < deadline) {
      const col = this.readyQueue.pop()!;
      this.queuedReady.delete(this.ckey(col.cx, col.cz));
      if (!this.chunks.has(this.ckey(col.cx, col.cz)) || !col.lit || col.ready) continue;

      let ok = true;
      for (let dz = -1; dz <= 1 && ok; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const n = this.chunks.get(this.ckey(col.cx + dx, col.cz + dz));
          if (!n || !n.lit) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) continue;

      col.ready = true;
      for (let sy = 0; sy < SECTION_COUNT; sy++) {
        if (col.counts[sy] > 0) this.markDirty(col.cx, col.cz, sy, true);
      }
    }
  }

  private streamIdle(): boolean {
    if (this.terrainQueueIndex < this.terrainQueue.length || this.lightQueue.length || this.readyQueue.length || this.dirty.size) return false;
    const r = this.renderDistance;
    for (let cx = this.streamCx - r; cx <= this.streamCx + r; cx++) {
      for (let cz = this.streamCz - r; cz <= this.streamCz + r; cz++) {
        const col = this.chunks.get(this.ckey(cx, cz));
        if (!col || !col.ready) return false;
      }
    }
    return true;
  }

  /** Per-frame work: budgeted streaming + subchunk rebuilds. */
  public update() {
    const t0 = performance.now();
    // Keep chunk generation/meshing well below a frame's 16.7 ms budget at 60 FPS.
    // Individual terrain/light/mesh operations can exceed the deadline, so use a conservative
    // budget and let the queue drain over subsequent frames instead of causing visible hitches.
    this.streamWork(t0 + 2);
    this.processDirty(t0 + 4);
    this.debugGenerationTimeMs += performance.now() - t0;
  }

  public consumeDebugGenerationTime() {
    const value = this.debugGenerationTimeMs;
    this.debugGenerationTimeMs = 0;
    return value;
  }

  /** Synchronously generate, light and mesh everything around a chunk (used on load / reseed). */
  private buildAround(cx: number, cz: number, radius: number) {
    const saved = this.renderDistance;
    this.renderDistance = radius;
    this.streamCx = NaN;
    this.updatePlayerPosition(cx * 16, cz * 16);
    for (let guard = 0; guard < 64 && !this.streamIdle(); guard++) {
      this.streamWork(Infinity);
      this.processDirty(Infinity);
    }
    this.renderDistance = saved;
    this.streamCx = NaN; // force the real radius to be streamed in on the next update
  }

  public generateWorldChunks() {
    this.buildAround(0, 0, CHUNK_GRID_RADIUS);
  }

  public setSeed(newSeed: number) {
    this.seed = newSeed;
    this.initNoise();
    this.clearAllChunks();
    this.generateWorldChunks();
    this.buildPhysicsColliders();
  }

  public clearAllChunks() {
    for (const col of this.chunks.values()) this.disposeColumnMeshes(col);
    this.chunks.clear();
    this.dirty.clear();
    this.terrainQueue = [];
    this.terrainQueueIndex = 0;
    this.lightQueue.length = 0;
    this.readyQueue.length = 0;
    this.queuedLight.clear();
    this.queuedReady.clear();
    this.invalidateColCache();
    this.streamCx = NaN;
    this.streamCz = NaN;
  }

  // ======================================================================
  //  Queries
  // ======================================================================

  /**
   * Light colour at a world position (same curve as the voxel shader) – used to shade Steve.
   * `skyDim` is 0 at noon and 1 at midnight.
   */
  public getLightColorAt(x: number, y: number, z: number, skyDim: number, out: THREE.Color) {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const fz = Math.floor(z);
    const s = Math.max(0, this.getLightCh(0, fx, fy, fz));
    const b = Math.max(0, this.getLightCh(1, fx, fy, fz));
    const curve = (l: number) => {
      const f = 1 - l;
      return 1 - f / (f * 3 + 1);
    };
    const sky = curve(Math.max(s / 15 - skyDim * (SKY_DIM_LEVELS / 15), 0));
    const blk = curve(b / 15);
    const moonTint = THREE.MathUtils.smoothstep(skyDim, 0.05, 1.0);
    let r = Math.max(sky * THREE.MathUtils.lerp(1.0, 0.52, moonTint), blk);
    let g = Math.max(sky * THREE.MathUtils.lerp(1.0, 0.68, moonTint), blk * 0.82);
    let bl = Math.max(sky, blk * 0.6);
    const floor = 0.03;
    r = Math.pow(Math.max(r, floor), 2.2);
    g = Math.pow(Math.max(g, floor), 2.2);
    bl = Math.pow(Math.max(bl, floor * 1.4), 2.2);
    out.setRGB(r, g, bl);
  }

  /**
   * Inner UV rectangles `[u0, v0, u1, v1]` of the atlas tiles used by a block's faces
   * (deduplicated). Used to cut break-particle fragments out of the block's own texture,
   * so particles follow resource packs automatically.
   */
  public getBlockTileRects(voxel: VoxelType): Array<[number, number, number, number]> {
    const cols = new Set<number>();
    for (let face = 0; face < 6; face++) cols.add(this.getVoxelFaceTile(voxel, face)[0]);

    // The atlas is not 16 tiles wide in UV space: every tile has an extruded
    // gutter (res / 8) on both sides. The old particle UV calculation assumed
    // a 16x16 no-gutter atlas, so break particles sampled unrelated/white atlas
    // pixels instead of the broken block texture.
    const image = this.atlasTexture.image as HTMLCanvasElement | undefined;
    const width = image?.width ?? 16 * 18;
    const height = image?.height ?? 18;
    const res = height * 0.8; // height = res + 2*(res/8)
    const pad = res / 8;
    const stride = res + pad * 2;

    return [...cols].map((col) => [
      (col * stride + pad + res * ATLAS_INNER_MIN / 1) / width,
      (pad + res * ATLAS_INNER_MIN_V) / height,
      (col * stride + pad + res * ATLAS_INNER_MAX / 1) / width,
      (pad + res * ATLAS_INNER_MAX_V) / height,
    ]);
  }

  private static readonly NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number, number]> = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  private lightScratch = new THREE.Color();

  /**
   * Light colour around block cell (bx, by, bz): the brightest of its six neighbours, since
   * a solid cell has no light of its own. Uses the current day/night level.
   */
  public getBlockSurroundLight(bx: number, by: number, bz: number, out: THREE.Color) {
    const skyDim = this.lightUniforms.uSkyDim.value;
    out.setRGB(0, 0, 0);
    for (const [dx, dy, dz] of VoxelWorld.NEIGHBOR_OFFSETS) {
      this.getLightColorAt(bx + dx + 0.5, by + dy + 0.5, bz + dz + 0.5, skyDim, this.lightScratch);
      out.r = Math.max(out.r, this.lightScratch.r);
      out.g = Math.max(out.g, this.lightScratch.g);
      out.b = Math.max(out.b, this.lightScratch.b);
    }
  }

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
        const normal = new THREE.Vector3(0, 1, 0);
        if (hasAir) {
          const abx = Math.floor(lastAirPos.x);
          const aby = Math.floor(lastAirPos.y);
          const abz = Math.floor(lastAirPos.z);
          normal.set(abx - bx, aby - by, abz - bz).clampLength(0, 1);
          if (normal.lengthSq() === 0) normal.set(0, 1, 0);
        }
        return { blockX: bx, blockY: by, blockZ: bz, normal, voxelType: voxel, point: currentPos.clone() };
      } else {
        lastAirPos.copy(currentPos);
        hasAir = true;
      }
      t += step;
    }
    return null;
  }

  /** Height of the first free cell above the highest block at world (x, z). */
  public getElevationAt(wx: number, wz: number): number {
    const bx = Math.floor(wx);
    const bz = Math.floor(wz);
    const col = this.colAt(bx, bz);
    if (!col) return 1.0;
    const top = col.topY[(bz & 15) * 16 + (bx & 15)];
    return top >= WORLD_MIN_Y ? top + 1.0 : 1.0;
  }

  public dispose() {
    this.clearAllChunks();
    this.atlasTexture.dispose();
    this.material.dispose();
    this.cutoutMaterial.dispose();
    this.transparentMaterial.dispose();
  }
}