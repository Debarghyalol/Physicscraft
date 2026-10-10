import * as THREE from 'three';
import { resourcePacks } from '../resourcepack/ResourcePackManager';
import { setSkinUVs } from '../player/PlayerModel';

/**
 * Pig geometry ported from vanilla PigModel / QuadrupedModel (legSize 6). Vanilla model space is
 * y-down with the front at -Z; the entity renderer's net transform is (x, y, z) -> (x, -y, -z),
 * so parts are built y-up facing +Z at yaw 0, with the same box UV layout as the player skin code.
 */
const PX = 1 / 16;

export interface PigRig {
  root: THREE.Group;
  /** Rotated on death (lying on its side). */
  rig: THREE.Group;
  head: THREE.Group;
  legs: { rh: THREE.Group; lh: THREE.Group; rf: THREE.Group; lf: THREE.Group };
  materials: THREE.MeshBasicMaterial[];
  texture: THREE.Texture | null;
}

function box(
  mat: THREE.Material,
  u: number, v: number,
  x: number, y: number, z: number,
  w: number, h: number, d: number
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w * PX, h * PX, d * PX);
  setSkinUVs(geo, u, v, w, h, d);
  // vanilla box min corner (x,y,z) -> centre, then (x,-y,-z)
  const cx = x + w / 2, cy = y + h / 2, cz = z + d / 2;
  geo.translate(cx * PX, -cy * PX, -cz * PX);
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  return m;
}

/** Part pivot at vanilla pose offset (px, py, pz) -> three position. */
function part(rig: THREE.Group, px: number, py: number, pz: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(px * PX, (24 - py) * PX, -pz * PX);
  rig.add(g);
  return g;
}

export async function loadPigTexture(): Promise<THREE.Texture | null> {
  const img = await resourcePacks.getTexture(['entity/pig/temperate_pig', 'entity/pig/pig']);
  if (!img) return null;
  const t = new THREE.CanvasTexture(img);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createPigRig(texture: THREE.Texture | null): PigRig {
  const materials: THREE.MeshBasicMaterial[] = [];
  const mat = new THREE.MeshBasicMaterial(texture ? { map: texture, alphaTest: 0.1 } : { color: 0xf0a8a0 });
  materials.push(mat);

  const root = new THREE.Group();
  const rig = new THREE.Group();
  root.add(rig);

  const head = part(rig, 0, 12, -6);
  head.add(box(mat, 0, 0, -4, -4, -8, 8, 8, 8));
  head.add(box(mat, 16, 16, -2, 0, -9, 4, 3, 1)); // snout

  const body = part(rig, 0, 11, 2);
  body.rotation.x = Math.PI / 2;
  body.add(box(mat, 28, 8, -5, -10, -7, 10, 16, 8));

  const leg = (px: number, pz: number) => {
    const g = part(rig, px, 18, pz);
    g.add(box(mat, 0, 16, -2, 0, -2, 4, 6, 4));
    return g;
  };
  const legs = { rh: leg(-3, 7), lh: leg(3, 7), rf: leg(-3, -5), lf: leg(3, -5) };
  return { root, rig, head, legs, materials, texture };
}
