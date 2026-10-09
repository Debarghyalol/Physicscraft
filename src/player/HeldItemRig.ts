import * as THREE from 'three';
import { resourcePacks } from '../resourcepack/ResourcePackManager';
import { getBlockIconFaces } from '../resourcepack/blockIconFaces';
import type { ItemDef } from '../inventory/items';

const D2R = Math.PI / 180;
const SHADE = { top: 1.0, z: 0.8, x: 0.6, bottom: 0.5 };

function nearestTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Extrude a sprite into one small cube per opaque pixel, like vanilla's generated item models. */
function buildSpriteGeometry(canvas: HTMLCanvasElement): THREE.BufferGeometry {
  const w = canvas.width;
  const h = Math.min(canvas.height, canvas.width);
  const data = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] > 127;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const px = 1 / w, th = 1 / 16;
  const quad = (v: number[][], u: number, vv: number) => {
    const base = pos.length / 3;
    for (const p of v) {
      pos.push(p[0], p[1], p[2]);
      uv.push(u, vv);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!solid(x, y)) continue;
      const u = (x + 0.5) / w, v = 1 - (y + 0.5) / h; // pixel centre: no bleeding between texels
      const x0 = x * px - 0.5, x1 = x0 + px, y1 = 0.5 - y * px, y0 = y1 - px, z1 = th / 2, z0 = -th / 2;
      quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], u, v); // front (+Z)
      quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], u, v); // back (-Z)
      if (!solid(x - 1, y)) quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], u, v);
      if (!solid(x + 1, y)) quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], u, v);
      if (!solid(x, y - 1)) quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], u, v);
      if (!solid(x, y + 1)) quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], u, v);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * The item shown in the first-person hand. Transform chain ported from vanilla's
 * ItemInHandRenderer (equip dip, swing, then the model's first_person_righthand display).
 */
export class HeldItemRig {
  public readonly rig = new THREE.Group();
  private swingPos = new THREE.Group();
  private place = new THREE.Group();
  private swingYaw = new THREE.Group();
  private swingRoll = new THREE.Group();
  private swingPitch = new THREE.Group();
  private unYaw = new THREE.Group();
  private display = new THREE.Group();
  private content: THREE.Object3D | null = null;
  private disposables: { dispose(): void }[] = [];
  private materials: { mat: THREE.MeshBasicMaterial; shade: number }[] = [];
  private tint = new THREE.Color(1, 1, 1);
  private currentId: string | null = null;
  private lastDef: ItemDef | null = null;
  private token = 0;
  private equip = 1;
  public hasItem = false;

  constructor() {
    this.rig.add(this.swingPos);
    this.swingPos.add(this.place);
    this.place.position.set(0.56, -0.52, -0.72);
    this.place.add(this.swingYaw);
    this.swingYaw.add(this.swingRoll);
    this.swingRoll.add(this.swingPitch);
    this.swingPitch.add(this.unYaw);
    this.unYaw.rotation.y = -45 * D2R;
    this.unYaw.add(this.display);
    this.rig.visible = false;
    resourcePacks.subscribe(() => {
      if (this.lastDef) void this.build(this.lastDef);
    });
  }

  /** Which item is in hand (null = empty hand, the arm is shown instead). */
  public setItem(def: ItemDef | null) {
    const id = def?.id ?? null;
    if (id === this.currentId) return;
    this.currentId = id;
    this.lastDef = def;
    this.token++; // cancel any build still loading
    this.equip = 0;
    if (!def) {
      this.clear();
      this.hasItem = false;
      return;
    }
    this.hasItem = true;
    void this.build(def);
  }

  public setTint(color: THREE.Color) {
    this.tint.copy(color);
    for (const m of this.materials) m.mat.color.copy(color).multiplyScalar(m.shade);
  }

  private clear() {
    if (this.content) this.display.remove(this.content);
    this.content = null;
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.materials = [];
  }

  private material(map: THREE.Texture, shade: number, alphaTest: number) {
    const mat = new THREE.MeshBasicMaterial({ map, alphaTest, transparent: false, depthTest: false, side: THREE.FrontSide });
    mat.color.copy(this.tint).multiplyScalar(shade);
    this.materials.push({ mat, shade });
    this.disposables.push(mat, map);
    return mat;
  }

  private async build(def: ItemDef) {
    const token = ++this.token;
    let object: THREE.Object3D | null = null;
    let blockLike = false;
    const staged = { materials: [] as typeof this.materials, disposables: [] as typeof this.disposables };
    const keep = { m: this.materials, d: this.disposables };
    this.materials = staged.materials;
    this.disposables = staged.disposables;
    try {
      if (def.voxel !== undefined) {
        const faces = await getBlockIconFaces(def.voxel);
        if (faces) {
          const top = nearestTexture(faces.top), side = nearestTexture(faces.side);
          const mats = [
            this.material(side, SHADE.x, 0.1), this.material(side, SHADE.x, 0.1),
            this.material(top, SHADE.top, 0.1), this.material(side, SHADE.bottom, 0.1),
            this.material(side, SHADE.z, 0.1), this.material(side, SHADE.z, 0.1),
          ];
          object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mats);
          this.disposables.push((object as THREE.Mesh).geometry);
          blockLike = true;
        }
      } else {
        const tex = await resourcePacks.getTexture([def.texture ?? `item/music_disc_${def.disc}`]);
        if (tex) {
          const geo = buildSpriteGeometry(tex);
          object = new THREE.Mesh(geo, this.material(nearestTexture(tex), 1, 0.5));
          this.disposables.push(geo);
        }
      }
    } catch {
      object = null;
    }
    // Stale (the player switched item while textures loaded): throw the staged result away.
    if (token !== this.token) {
      staged.disposables.forEach((d) => d.dispose());
      this.materials = keep.m;
      this.disposables = keep.d;
      return;
    }
    this.materials = keep.m;
    this.disposables = keep.d;
    this.clear();
    this.materials = staged.materials;
    this.disposables = staged.disposables;
    if (!object) return;
    object.renderOrder = 1002;
    object.frustumCulled = false;
    this.display.rotation.order = 'XYZ';
    if (blockLike) {
      // block model: first_person_righthand rotation [0,45,0], scale 0.4
      this.display.position.set(0, 0, 0);
      this.display.rotation.set(0, 45 * D2R, 0);
      this.display.scale.setScalar(0.4);
    } else {
      // item/generated: rotation [0,-90,25], translation [1.13,3.2,1.13], scale 0.68
      this.display.position.set(1.13 / 16, 3.2 / 16, 1.13 / 16);
      this.display.rotation.set(0, -90 * D2R, 25 * D2R);
      this.display.scale.setScalar(0.68);
    }
    this.content = object;
    this.display.add(object);
  }

  /** `s` is vanilla swingProgress (0..1). */
  public update(delta: number, s: number) {
    this.equip = Math.min(1, this.equip + delta / 0.25);
    const g = Math.sqrt(s);
    const f = Math.sin(s * s * Math.PI);
    this.swingPos.position.set(-0.4 * Math.sin(g * Math.PI), 0.2 * Math.sin(g * Math.PI * 2) - 0.6 * (1 - this.equip), -0.2 * Math.sin(s * Math.PI));
    this.swingYaw.rotation.y = (45 + f * -20) * D2R;
    this.swingRoll.rotation.z = Math.sin(g * Math.PI) * -20 * D2R;
    this.swingPitch.rotation.x = Math.sin(g * Math.PI) * -80 * D2R;
  }

  public dispose() {
    this.clear();
  }
}
