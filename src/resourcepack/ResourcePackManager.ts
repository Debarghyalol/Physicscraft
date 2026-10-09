import JSZip from 'jszip';

/**
 * Minecraft: Java Edition resource pack support (.zip packs).
 *
 * Supported: pack.mcmeta / pack.png, block textures, the player skin, sun / moon phases,
 * clouds.png (cloud shape mask), and the hotbar / menu background GUI textures.
 * Packs are persisted in IndexedDB so they survive reloads. Higher in the "Selected" list
 * = higher priority (same as the vanilla screen). The built-in Default pack is always last.
 */

export interface ResourcePackInfo {
  id: string;
  name: string; // file name without .zip
  description: string;
  packFormat: number | null;
  iconUrl: string | null;
  enabled: boolean;
  order: number; // among enabled packs, 0 = top / highest priority
  sizeBytes: number;
}

interface LoadedPack extends ResourcePackInfo {
  zip: JSZip;
  root: string; // folder prefix inside the zip ('' or 'MyPack/')
  blob: Blob;
}

const DB_NAME = 'physicscraft-resourcepacks';
const STORE = 'packs';

/**
 * The pack that ships with the game (public/packs). It is imported once on first run and enabled
 * if the player has no other pack active. After that it behaves like any other pack: the player
 * can disable or remove it, and it is not re-added.
 */
const BUNDLED_PACK = {
  id: 'bundled-default-pack',
  name: 'Default Pack (1.21.10)',
  file: 'packs/default-resource-pack.zip',
  seededKey: 'physicscraft-bundled-pack-seeded',
};

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Flatten a pack.mcmeta description (string or JSON text component) to plain text. */
function flattenDescription(desc: any): string {
  if (desc == null) return '';
  if (typeof desc === 'string') return desc.replace(/§[0-9a-fk-or]/gi, '');
  if (Array.isArray(desc)) return desc.map(flattenDescription).join('');
  let out = typeof desc.text === 'string' ? desc.text : '';
  if (Array.isArray(desc.extra)) out += desc.extra.map(flattenDescription).join('');
  return out.replace(/§[0-9a-fk-or]/gi, '');
}

type Listener = () => void;

class ResourcePackManagerImpl {
  private packs: LoadedPack[] = [];
  private listeners = new Set<Listener>();
  private imageCache = new Map<string, HTMLCanvasElement | null>();
  public ready = false;

  // ---------------------------------------------------------------- lifecycle

  async init() {
    if (this.ready) return;
    const db = await openDb();
    if (db) {
      const rows: any[] = await new Promise((resolve) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
      for (const row of rows) {
        try {
          const loaded = await this.loadZip(row.blob, row.id, row.name);
          loaded.enabled = !!row.enabled;
          loaded.order = row.order ?? 0;
          this.packs.push(loaded);
        } catch {
          /* skip unreadable pack */
        }
      }
    }
    this.ready = true;
    this.imageCache.clear();
    this.emit();

    // First run: install the bundled pack. Done after the first emit so packs the player
    // already has are applied immediately while the download happens.
    if (await this.seedBundledPack()) this.emit();
  }

  /** Import and (if nothing else is enabled) enable the bundled pack once. Returns true if changed. */
  private async seedBundledPack(): Promise<boolean> {
    try {
      if (localStorage.getItem(BUNDLED_PACK.seededKey) === BUNDLED_PACK.id) return false;
      if (this.packs.some((p) => p.id === BUNDLED_PACK.id)) {
        localStorage.setItem(BUNDLED_PACK.seededKey, BUNDLED_PACK.id);
        return false;
      }
      const res = await fetch(`${import.meta.env.BASE_URL}${BUNDLED_PACK.file}`);
      if (!res.ok) return false;
      // An SPA host answers unknown paths with index.html; loadZip rejects that (no pack.mcmeta).
      const pack = await this.loadZip(await res.blob(), BUNDLED_PACK.id, BUNDLED_PACK.name);
      pack.enabled = !this.hasActivePacks();
      pack.order = 0;
      this.packs.push(pack);
      await this.persist(pack);
      localStorage.setItem(BUNDLED_PACK.seededKey, BUNDLED_PACK.id);
      return true;
    } catch {
      return false; // offline / blocked storage: try again next launch
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.imageCache.clear();
    this.applyGuiVariables();
    for (const l of this.listeners) l();
  }

  private async persist(pack: LoadedPack) {
    const db = await openDb();
    if (!db) return;
    db.transaction(STORE, 'readwrite').objectStore(STORE).put({
      id: pack.id,
      name: pack.name,
      blob: pack.blob,
      enabled: pack.enabled,
      order: pack.order,
    });
  }

  private async unpersist(id: string) {
    const db = await openDb();
    if (!db) return;
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
  }

  // ------------------------------------------------------------------ packs

  private async loadZip(blob: Blob, id: string, name: string): Promise<LoadedPack> {
    const zip = await JSZip.loadAsync(blob);
    // pack.mcmeta may be at the zip root or inside a single top-level folder
    let metaPath: string | null = null;
    zip.forEach((path) => {
      if (/(^|\/)pack\.mcmeta$/.test(path) && (metaPath === null || path.length < metaPath.length)) metaPath = path;
    });
    if (!metaPath) throw new Error('Not a Minecraft resource pack: pack.mcmeta not found');
    const root = (metaPath as string).slice(0, (metaPath as string).length - 'pack.mcmeta'.length);

    let description = '';
    let packFormat: number | null = null;
    try {
      const meta = JSON.parse((await zip.file(metaPath as string)!.async('string')).replace(/^﻿/, ''));
      description = flattenDescription(meta?.pack?.description);
      packFormat = typeof meta?.pack?.pack_format === 'number' ? meta.pack.pack_format : null;
    } catch {
      description = 'Invalid pack.mcmeta';
    }

    let iconUrl: string | null = null;
    const icon = zip.file(root + 'pack.png');
    if (icon) iconUrl = URL.createObjectURL(new Blob([await icon.async('arraybuffer')], { type: 'image/png' }));

    return {
      id,
      name,
      description,
      packFormat,
      iconUrl,
      enabled: false,
      order: 0,
      sizeBytes: blob.size,
      zip,
      root,
      blob,
    };
  }

  /** Import a .zip pack. Throws with a readable message if it is not a valid pack. */
  async importFile(file: File): Promise<ResourcePackInfo> {
    const id = `${file.name}-${file.size}-${file.lastModified}`;
    const existing = this.packs.find((p) => p.id === id);
    if (existing) return existing;
    const pack = await this.loadZip(file, id, file.name.replace(/\.zip$/i, ''));
    pack.enabled = false;
    this.packs.push(pack);
    await this.persist(pack);
    this.emit();
    return pack;
  }

  async removePack(id: string) {
    const i = this.packs.findIndex((p) => p.id === id);
    if (i < 0) return;
    const [p] = this.packs.splice(i, 1);
    if (p.iconUrl) URL.revokeObjectURL(p.iconUrl);
    await this.unpersist(id);
    this.renumber();
    this.emit();
  }

  private renumber() {
    this.getSelected().forEach((p, i) => {
      const lp = this.packs.find((x) => x.id === p.id)!;
      lp.order = i;
      this.persist(lp);
    });
  }

  getAvailable(): ResourcePackInfo[] {
    return this.packs.filter((p) => !p.enabled).map(this.info);
  }

  getSelected(): ResourcePackInfo[] {
    return this.packs
      .filter((p) => p.enabled)
      .sort((a, b) => a.order - b.order)
      .map(this.info);
  }

  hasActivePacks(): boolean {
    return this.packs.some((p) => p.enabled);
  }

  private info = (p: LoadedPack): ResourcePackInfo => ({
    id: p.id,
    name: p.name,
    description: p.description,
    packFormat: p.packFormat,
    iconUrl: p.iconUrl,
    enabled: p.enabled,
    order: p.order,
    sizeBytes: p.sizeBytes,
  });

  /** Enable a pack; it goes to the top (highest priority) like vanilla. */
  enable(id: string) {
    const p = this.packs.find((x) => x.id === id);
    if (!p || p.enabled) return;
    this.packs.forEach((x) => x.enabled && x.order++);
    p.enabled = true;
    p.order = 0;
    this.persist(p);
    this.renumber();
    this.emit();
  }

  disable(id: string) {
    const p = this.packs.find((x) => x.id === id);
    if (!p || !p.enabled) return;
    p.enabled = false;
    this.persist(p);
    this.renumber();
    this.emit();
  }

  /** dir -1 = up (higher priority), +1 = down */
  move(id: string, dir: -1 | 1) {
    const sel = this.packs.filter((p) => p.enabled).sort((a, b) => a.order - b.order);
    const i = sel.findIndex((p) => p.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sel.length) return;
    [sel[i], sel[j]] = [sel[j], sel[i]];
    sel.forEach((p, k) => {
      p.order = k;
      this.persist(p);
    });
    this.emit();
  }

  // ---------------------------------------------------------------- assets

  /**
   * Find the first matching texture (highest-priority enabled pack wins).
   * `paths` are relative to assets/minecraft/textures/ without ".png", e.g. "block/stone".
   * Animated textures (tall strips) return their first frame. Returns null when no pack has it.
   */
  async getTexture(paths: string[]): Promise<HTMLCanvasElement | null> {
    const key = paths.join('|');
    if (this.imageCache.has(key)) return this.imageCache.get(key)!;
    let result: HTMLCanvasElement | null = null;
    const selected = this.packs.filter((p) => p.enabled).sort((a, b) => a.order - b.order);
    outer: for (const pack of selected) {
      for (const path of paths) {
        const f = pack.zip.file(`${pack.root}assets/minecraft/textures/${path}.png`);
        if (!f) continue;
        try {
          const bmp = await createImageBitmap(new Blob([await f.async('arraybuffer')], { type: 'image/png' }));
          result = document.createElement('canvas');
          // Animated texture: strip of square frames -> first frame
          const frame = bmp.height > bmp.width && path.startsWith('block/') ? bmp.width : bmp.height;
          result.width = bmp.width;
          result.height = frame;
          result.getContext('2d')!.drawImage(bmp, 0, 0);
          bmp.close();
          break outer;
        } catch {
          /* try next */
        }
      }
    }
    this.imageCache.set(key, result);
    return result;
  }

  // ------------------------------------------------------------------- GUI

  /** Hotbar + menu background are CSS driven, so the manager updates CSS variables directly. */
  private async applyGuiVariables() {
    const root = document.documentElement;
    const set = (name: string, url: string | null) => {
      if (url) root.style.setProperty(name, `url(${url})`);
      else root.style.removeProperty(name);
    };

    // Hotbar: modern sprite files, or the classic widgets.png sheet
    let hotbar: string | null = null;
    let selection: string | null = null;
    const hb = await this.getTexture(['gui/sprites/hud/hotbar']);
    const sel = await this.getTexture(['gui/sprites/hud/hotbar_selection']);
    if (hb) hotbar = hb.toDataURL();
    if (sel) selection = sel.toDataURL();
    if (!hotbar) {
      const w = await this.getTexture(['gui/widgets']);
      if (w) {
        const s = w.width / 256;
        const cut = (x: number, y: number, ww: number, hh: number) => {
          const c = document.createElement('canvas');
          c.width = ww * s;
          c.height = hh * s;
          c.getContext('2d')!.drawImage(w, x * s, y * s, ww * s, hh * s, 0, 0, c.width, c.height);
          return c.toDataURL();
        };
        hotbar = cut(0, 0, 182, 22);
        selection = cut(0, 22, 24, 24);
      }
    }
    set('--rp-hotbar', hotbar);
    set('--rp-hotbar-selection', selection);

    // Inventory GUI: prefer a classic inventory.png when a custom pack provides one;
    // otherwise use modern 26.2 sprite assets (slot / slot_frame).
    const inv = await this.getTexture(['gui/container/inventory']);
    const invSlot = await this.getTexture(['gui/sprites/container/slot', 'gui/sprites/widget/slot_frame']);
    set('--rp-inventory-container', inv ? inv.toDataURL() : null);
    set('--rp-inventory-slot', invSlot ? invSlot.toDataURL() : null);

    const bg = await this.getTexture(['gui/options_background', 'block/dirt']);
    set('--rp-options-bg', bg ? bg.toDataURL() : null);
  }
}

export const resourcePacks = new ResourcePackManagerImpl();
