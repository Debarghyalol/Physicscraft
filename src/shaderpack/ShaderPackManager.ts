import JSZip from 'jszip';
import { PackFiles, translateProgram } from './GlslTranslator';
import { compileShaderToWGSL } from './ShaderPackWebGPUCompiler';

/**
 * Shader pack (OptiFine / Iris format) import and storage.
 *
 * Packs are the user's own .zip files, kept in this browser's IndexedDB. Nothing from any
 * pack is bundled with the game. A pack is valid when it has a `shaders/` folder containing
 * at least one `.fsh` / `.vsh` program.
 */

export interface ShaderPackInfo {
  id: string;
  name: string;
  sizeBytes: number;
  programCount: number;
  dimensions: string[];
  enabled: boolean;
}

export interface ProgramReport {
  name: string;
  stage: 'vertex' | 'fragment';
  ok: boolean;
  log: string;
}

interface StoredPack extends ShaderPackInfo {
  blob: Blob;
}

const DB_NAME = 'physicscraft-shaderpacks';
const STORE = 'packs';
const TEXT_EXT = /\.(glsl|fsh|vsh|gsh|properties|lang|txt|inc|h)$/i;

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

type Listener = () => void;

class ShaderPackManagerImpl {
  private packs: StoredPack[] = [];
  private listeners = new Set<Listener>();
  private lastCompileReports: ProgramReport[] = [];
  public ready = false;

  async init() {
    if (this.ready) return;
    const db = await openDb();
    if (db) {
      const rows: StoredPack[] = await new Promise((resolve) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
      this.packs = rows;
    }
    this.ready = true;
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  private async persist(p: StoredPack) {
    const db = await openDb();
    db?.transaction(STORE, 'readwrite').objectStore(STORE).put(p);
  }

  getPacks(): ShaderPackInfo[] {
    return this.packs.map(({ blob: _blob, ...info }) => info);
  }

  getActive(): ShaderPackInfo | null {
    return this.getPacks().find((p) => p.enabled) ?? null;
  }

  /** Read the pack's `shaders/` folder as text files keyed by path relative to it. */
  private async readFiles(blob: Blob): Promise<{ files: PackFiles; dimensions: string[] }> {
    const zip = await JSZip.loadAsync(blob);
    let root: string | null = null;
    zip.forEach((path) => {
      const m = /^(.*?)shaders\/./.exec(path);
      if (m && (root === null || m[1].length < root.length)) root = m[1];
    });
    if (root === null) throw new Error('Not a shader pack: no "shaders" folder found');
    const prefix = `${root}shaders/`;
    const files: PackFiles = new Map();
    const jobs: Promise<void>[] = [];
    zip.forEach((path, entry) => {
      if (entry.dir || !path.startsWith(prefix)) return;
      const rel = path.slice(prefix.length);
      if (!TEXT_EXT.test(rel)) return;
      jobs.push(entry.async('string').then((s) => void files.set(rel, s.replace(/^﻿/, ''))));
    });
    await Promise.all(jobs);
    const dims = new Set<string>();
    let programs = 0;
    for (const p of files.keys()) {
      if (/\.(fsh|vsh)$/.test(p)) {
        programs++;
        const m = /^(world-?\d+)\//.exec(p);
        if (m) dims.add(m[1]);
      }
    }
    if (programs === 0) throw new Error('Not a shader pack: no .fsh / .vsh programs found');
    return { files, dimensions: [...dims].sort() };
  }

  async importFile(file: File): Promise<ShaderPackInfo> {
    const id = `${file.name}-${file.size}-${file.lastModified}`;
    const existing = this.packs.find((p) => p.id === id);
    if (existing) return existing;
    const { files, dimensions } = await this.readFiles(file);
    let programCount = 0;
    for (const p of files.keys()) if (/\.fsh$/.test(p)) programCount++;
    const pack: StoredPack = {
      id,
      name: file.name.replace(/\.zip$/i, ''),
      sizeBytes: file.size,
      programCount,
      dimensions,
      enabled: false,
      blob: file,
    };
    this.packs.push(pack);
    await this.persist(pack);
    this.emit();
    return pack;
  }

  /** At most one pack is active, like Iris / OptiFine. Pass null to go back to vanilla. */
  async select(id: string | null) {
    for (const p of this.packs) {
      const want = p.id === id;
      if (p.enabled !== want) {
        p.enabled = want;
        await this.persist(p);
      }
    }
    this.emit();
  }

  async remove(id: string) {
    const i = this.packs.findIndex((p) => p.id === id);
    if (i < 0) return;
    this.packs.splice(i, 1);
    const db = await openDb();
    db?.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
    this.emit();
  }

  async loadFiles(id: string): Promise<{ files: PackFiles; dimensions: string[] }> {
    const p = this.packs.find((x) => x.id === id);
    if (!p) throw new Error('pack not found');
    return this.readFiles(p.blob);
  }


  /** Load a binary asset from the active shader-pack archive (PNG, raw texture, etc.). */
  async loadAsset(id: string, relativePath: string): Promise<Blob | null> {
    const p = this.packs.find((x) => x.id === id);
    if (!p) throw new Error('pack not found');
    const zip = await JSZip.loadAsync(p.blob);
    let root: string | null = null;
    zip.forEach((path) => {
      const m = /^(.*?)shaders\//.exec(path);
      if (m && (root === null || m[1].length < root.length)) root = m[1];
    });
    if (root === null) throw new Error('Not a shader pack: no "shaders/" folder found');
    const entry = zip.file(`${root}shaders/${relativePath.replace(/^\/+/, '')}`);
    if (!entry) return null;
    const bytes = await entry.async('uint8array');
    return new Blob([bytes]);
  }

  /**
   * Translate and compile every program of one dimension with the given GL context and
   * report which ones the GPU driver accepts. Used by the "Check compatibility" button.
   */
  async compileReport(id: string, dimension: string, gl: WebGL2RenderingContext): Promise<ProgramReport[]> {
    const { files } = await this.loadFiles(id);
    const names = new Map<string, { vsh?: string; fsh?: string }>();
    for (const p of files.keys()) {
      const m = new RegExp(`^${dimension}/([^/]+)\\.(vsh|fsh)$`).exec(p);
      if (!m) continue;
      const e = names.get(m[1]) ?? {};
      e[m[2] as 'vsh' | 'fsh'] = p;
      names.set(m[1], e);
    }
    const reports: ProgramReport[] = [];
    for (const [name, e] of [...names].sort()) {
      for (const stage of ['vertex', 'fragment'] as const) {
        const entry = stage === 'vertex' ? e.vsh : e.fsh;
        if (!entry) continue;
        try {
          const t = translateProgram({ files, entry, stage });
          const sh = gl.createShader(stage === 'vertex' ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER)!;
          gl.shaderSource(sh, t.source);
          gl.compileShader(sh);
          const ok = !!gl.getShaderParameter(sh, gl.COMPILE_STATUS);
          reports.push({ name, stage, ok, log: ok ? '' : gl.getShaderInfoLog(sh) || 'compile failed' });
          gl.deleteShader(sh);
        } catch (err: any) {
          reports.push({ name, stage, ok: false, log: String(err?.message ?? err) });
        }
      }
    }
    this.lastCompileReports = reports;
    return reports;
  }


  /** Translate shader stages through GLSL -> SPIR-V -> WGSL for WebGPU validation. */
  async compileWebGPUReport(id: string, dimension: string): Promise<ProgramReport[]> {
    const { files } = await this.loadFiles(id);
    const names = new Map<string, { vsh?: string; fsh?: string }>();

    for (const p of files.keys()) {
      const match = new RegExp(\`^\${dimension}/([^/]+)\\.(vsh|fsh)$\`).exec(p);
      if (!match) continue;

      const entry = names.get(match[1]) ?? {};
      entry[match[2] as 'vsh' | 'fsh'] = p;
      names.set(match[1], entry);
    }

    const reports: ProgramReport[] = [];
    for (const [name, entries] of [...names].sort()) {
      for (const stage of ['vertex', 'fragment'] as const) {
        const entry = stage === 'vertex' ? entries.vsh : entries.fsh;
        if (!entry) continue;

        try {
          const translated = translateProgram({ files, entry, stage });
          await compileShaderToWGSL(translated.source, stage);
          reports.push({ name, stage, ok: true, log: '' });
        } catch (err: any) {
          reports.push({ name, stage, ok: false, log: String(err?.message ?? err) });
        }
      }
    }

    this.lastCompileReports = reports;
    return reports;
  }

  getCompileDiagnostics(): string[] {
    return this.lastCompileReports
      .filter((report) => !report.ok)
      .map((report) => \`[ShaderPipeline] \${report.name} (\${report.stage})\\n\${report.log}\`);
  }
}

export const shaderPacks = new ShaderPackManagerImpl();
