import { VoxelType } from '../types/physics';
import { resourcePacks } from './ResourcePackManager';

/**
 * Biome tints for the grayscale foliage textures. VoxelWorld applies the same values to the
 * world atlas, so hotbar icons match the blocks you actually place.
 */
export const GRASS_TINT = '#91bd59';
export const LEAF_TINT = '#77ab2f';

interface IconSpec {
  /** Texture paths (first hit wins) for the top face. Falls back to the side texture. */
  top?: string[];
  topTint?: string;
  /** Texture paths for the two visible side faces. */
  side: string[];
  sideTint?: string;
  /** Drawn over the side texture (grass blades), tinted like the top. */
  sideOverlay?: string[];
  overlayTint?: string;
}

const ICON_SPECS: Partial<Record<VoxelType, IconSpec>> = {
  [VoxelType.GRASS]: {
    top: ['block/grass_block_top'],
    topTint: GRASS_TINT,
    side: ['block/grass_block_side'],
    sideOverlay: ['block/grass_block_side_overlay'],
    overlayTint: GRASS_TINT,
  },
  [VoxelType.DIRT]: { side: ['block/dirt'] },
  [VoxelType.STONE]: { side: ['block/stone'] },
  [VoxelType.BEDROCK]: { side: ['block/bedrock'] },
  [VoxelType.WOOD]: { top: ['block/oak_log_top'], side: ['block/oak_log'] },
  [VoxelType.LEAVES]: { topTint: LEAF_TINT, side: ['block/oak_leaves'], sideTint: LEAF_TINT },
  [VoxelType.SAND]: { side: ['block/sand'] },
  [VoxelType.GLASS]: { side: ['block/glass'] },
  [VoxelType.COBBLESTONE]: { side: ['block/cobblestone'] },
  [VoxelType.TNT]: { top: ['block/tnt_top'], side: ['block/tnt_side'] },
  [VoxelType.GOLD]: { side: ['block/gold_block'] },
  [VoxelType.GLOWSTONE]: { side: ['block/glowstone'] },
  [VoxelType.JUKEBOX]: { top: ['block/jukebox_top'], side: ['block/jukebox_side', 'block/jukebox'] },
};

// Register an icon spec for every appended block automatically. Minecraft texture names usually
// match the lower-case voxel enum name; logs and leaves have dedicated top textures.
for (const [key, value] of Object.entries(VoxelType)) {
  if (!/^[0-9]+$/.test(key) || typeof value !== 'number' || value <= VoxelType.WATER) continue;
  const voxel = value as VoxelType;
  if (ICON_SPECS[voxel]) continue;
  const name = key.toLowerCase();
  const isLog = name.endsWith('_log');
  const isLeaves = name.endsWith('_leaves');
  const side = isLeaves
    ? [`block/${name}`, 'block/oak_leaves']
    : [`block/${name}`];
  ICON_SPECS[voxel] = {
    ...(isLog ? { top: [`block/${name}_top`] } : {}),
    side,
    ...(isLeaves ? { sideTint: LEAF_TINT, topTint: LEAF_TINT } : {}),
  };
}

/** Multiply a texture by a colour, keeping its alpha (same maths as the world atlas). */
function tinted(img: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(img, 0, 0);
  return c;
}

export interface BlockIconFaces {
  top: HTMLCanvasElement;
  side: HTMLCanvasElement;
}

/**
 * The top and side textures for a block icon, taken from the enabled resource packs and
 * tinted exactly like the world renders them. Null when no pack provides the block's texture.
 */
export async function getBlockIconFaces(voxel: VoxelType): Promise<BlockIconFaces | null> {
  const spec = ICON_SPECS[voxel];
  if (!spec) return null;

  // Keep blocks visible in the hotbar and first-person hand even if the active resource pack
  // does not contain a texture for a newly registered voxel. Prefer its real texture when found.
  const sideBase = (await resourcePacks.getTexture(spec.side)) ?? await resourcePacks.getTexture(['block/stone']);
  if (!sideBase) return null;
  let side = spec.sideTint ? tinted(sideBase, spec.sideTint) : sideBase;
  if (spec.sideOverlay) {
    const overlay = await resourcePacks.getTexture(spec.sideOverlay);
    if (overlay) {
      const c = document.createElement('canvas');
      c.width = side.width;
      c.height = side.height;
      const g = c.getContext('2d')!;
      g.imageSmoothingEnabled = false;
      g.drawImage(side, 0, 0);
      g.drawImage(spec.overlayTint ? tinted(overlay, spec.overlayTint) : overlay, 0, 0, c.width, c.height);
      side = c;
    }
  }

  // Top face: its own texture when the block has one, otherwise the side texture (+ tint).
  const topBase = (spec.top ? await resourcePacks.getTexture(spec.top) : null) ?? sideBase;
  const top = spec.topTint ? tinted(topBase, spec.topTint) : topBase;
  return { top, side };
}

/** Face shading used by the vanilla GUI cube: up 1.0, south 0.8, east 0.6. */
const SHADE_TOP = 1.0;
const SHADE_LEFT = 0.8;
const SHADE_RIGHT = 0.6;

/**
 * Render the classic isometric inventory cube, pixel by pixel.
 *
 * The cube fills a size x size icon (default 32 = a 16px item at GUI scale 2):
 *
 *            T (0.5, 0)
 *       UL /   \  UR
 *         |  C  |        top face = T/UR/C/UL, left face = UL/C/B/LL, right face = C/UR/LR/B
 *       LL \   /  LR
 *            B (0.5, 1)
 *
 * Each destination pixel is mapped back into the face texture and sampled nearest-neighbour, so
 * the result is crisp with no anti-aliased seams between faces (clip + affine drawImage leaves
 * faint hairlines) and transparent texels (glass, leaves) stay transparent.
 */
export function renderIsometricBlockIcon(faces: BlockIconFaces, size = 32): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(size, size);

  const read = (tex: HTMLCanvasElement) => {
    const ctx = tex.getContext('2d')!;
    return { w: tex.width, h: tex.height, data: ctx.getImageData(0, 0, tex.width, tex.height).data };
  };
  const top = read(faces.top);
  const side = read(faces.side);

  // Hexagon corners in icon space (true isometric: width = sqrt(3)/2 * height).
  const halfW = size * 0.4375; // 14 of 32
  const cx = size / 2;
  const T = [cx, 0], UR = [cx + halfW, size * 0.25], UL = [cx - halfW, size * 0.25];
  const C = [cx, size * 0.5], B = [cx, size], LL = [cx - halfW, size * 0.75], LR = [cx + halfW, size * 0.75];

  // face: origin a, u axis a->b (texture x), v axis a->c (texture y)
  const faceDefs = [
    { tex: top, shade: SHADE_TOP, a: T, b: UR, c: UL },
    { tex: side, shade: SHADE_LEFT, a: UL, b: C, c: LL },
    { tex: side, shade: SHADE_RIGHT, a: C, b: UR, c: B },
  ].map((f) => {
    const ux = f.b[0] - f.a[0], uy = f.b[1] - f.a[1];
    const vx = f.c[0] - f.a[0], vy = f.c[1] - f.a[1];
    const det = ux * vy - uy * vx;
    return { ...f, ux, uy, vx, vy, det };
  });

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5, py = y + 0.5;
      for (const f of faceDefs) {
        const dx = px - f.a[0], dy = py - f.a[1];
        const s = (dx * f.vy - dy * f.vx) / f.det;
        const t = (f.ux * dy - f.uy * dx) / f.det;
        if (s < 0 || s >= 1 || t < 0 || t >= 1) continue;
        const tx = Math.min(f.tex.w - 1, Math.floor(s * f.tex.w));
        const ty = Math.min(f.tex.h - 1, Math.floor(t * f.tex.h));
        const si = (ty * f.tex.w + tx) * 4;
        const di = (y * size + x) * 4;
        img.data[di] = f.tex.data[si] * f.shade;
        img.data[di + 1] = f.tex.data[si + 1] * f.shade;
        img.data[di + 2] = f.tex.data[si + 2] * f.shade;
        img.data[di + 3] = f.tex.data[si + 3];
        break;
      }
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}
