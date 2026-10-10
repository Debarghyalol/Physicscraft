import * as THREE from 'three';
import { resourcePacks } from '../resourcepack/ResourcePackManager';

/** A rectangle of the water atlas in vanilla texture space (v grows downwards). */
export interface WaterSprite {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

export const spriteU = (s: WaterSprite, f: number) => s.u0 + f * (s.u1 - s.u0);
export const spriteV = (s: WaterSprite, f: number) => s.v0 + f * (s.v1 - s.v0);

const STILL_FRAMETIME = 2; // water_still.png.mcmeta: frametime 2
const FLOW_FRAMETIME = 1; // water_flow.png.mcmeta: animation {} -> 1 tick per frame
const TICK = 1 / 20;

/**
 * Animated water atlas: the still tile (W x W) and the flowing tile (2W x 2W), each with an
 * edge-extruded gutter so nearest filtering never bleeds into the neighbour. Frames come from the
 * resource pack's tall animation strips; a procedural blue is used if the pack has none.
 */
export class WaterTexture {
  public texture: THREE.CanvasTexture;
  public still: WaterSprite = { u0: 0, u1: 1, v0: 0, v1: 1 };
  public flow: WaterSprite = { u0: 0, u1: 1, v0: 0, v1: 1 };
  /** Called when the underlying texture object was replaced (pack change). */
  public onReplaced?: (tex: THREE.CanvasTexture) => void;

  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private stillImg: HTMLCanvasElement | null = null;
  private flowImg: HTMLCanvasElement | null = null;
  private w = 16;
  private pad = 2;
  private lastStill = -1;
  private lastFlow = -1;
  private timeTicks = 0;
  private loadId = 0;

  constructor() {
    this.layout(16);
    this.texture = this.makeTexture();
    this.drawFrames(0, 0);
  }

  private makeTexture() {
    const tex = new THREE.CanvasTexture(this.canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private layout(w: number) {
    this.w = w;
    this.pad = Math.max(2, Math.ceil(w / 8));
    const p = this.pad;
    this.canvas.width = w + 2 * p + 2 * w + 2 * p;
    this.canvas.height = 2 * w + 2 * p;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    this.still = { u0: p / cw, u1: (p + w) / cw, v0: p / ch, v1: (p + w) / ch };
    const fx = w + 2 * p + p;
    this.flow = { u0: fx / cw, u1: (fx + 2 * w) / cw, v0: p / ch, v1: (p + 2 * w) / ch };
  }

  /** (Re)load frames from the active resource packs. */
  public async load() {
    const id = ++this.loadId;
    const [still, flow] = await Promise.all([
      resourcePacks.getTexture(['block/water_still']),
      resourcePacks.getTexture(['block/water_flow']),
    ]);
    if (id !== this.loadId) return;
    this.stillImg = still;
    this.flowImg = flow;
    const w = still ? Math.max(16, Math.min(128, still.width)) : 16;
    if (w !== this.w || this.canvas.width === 0) {
      this.layout(w);
      const old = this.texture;
      this.texture = this.makeTexture();
      old.dispose();
      this.onReplaced?.(this.texture);
    }
    this.lastStill = this.lastFlow = -1;
    this.drawFrames(this.frameIndex(this.stillImg, STILL_FRAMETIME), this.frameIndex(this.flowImg, FLOW_FRAMETIME));
  }

  private frameIndex(img: HTMLCanvasElement | null, frametime: number) {
    if (!img || img.width === 0) return Math.floor(this.timeTicks / frametime) % 32;
    const frames = Math.max(1, Math.floor(img.height / img.width));
    return Math.floor(this.timeTicks / frametime) % frames;
  }

  /** Advance the animation (call every frame). */
  public update(dt: number) {
    this.timeTicks += dt / TICK;
    const s = this.frameIndex(this.stillImg, STILL_FRAMETIME);
    const f = this.frameIndex(this.flowImg, FLOW_FRAMETIME);
    if (s !== this.lastStill || f !== this.lastFlow) this.drawFrames(s, f);
  }

  private drawFrames(stillFrame: number, flowFrame: number) {
    this.lastStill = stillFrame;
    this.lastFlow = flowFrame;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const w = this.w;
    const p = this.pad;
    this.drawTile(this.stillImg, stillFrame, p, p, w, [0.2, 0.4, 0.95]);
    this.drawTile(this.flowImg, flowFrame, w + 2 * p + p, p, 2 * w, [0.25, 0.45, 0.95]);
    this.texture.needsUpdate = true;
  }

  /** Draw one animation frame (or a procedural fallback) at (x, y) size s, then extrude its edges. */
  private drawTile(img: HTMLCanvasElement | null, frame: number, x: number, y: number, s: number, rgb: number[]) {
    const ctx = this.ctx;
    const p = this.pad;
    if (img && img.width > 0) {
      const fs = img.width;
      const frames = Math.max(1, Math.floor(img.height / fs));
      const sy = (frame % frames) * fs;
      ctx.drawImage(img, 0, sy, fs, fs, x, y, s, s);
    } else {
      // Fallback: rippled translucent blue.
      for (let py = 0; py < s; py += 2) {
        for (let px = 0; px < s; px += 2) {
          const n = 0.85 + 0.15 * Math.sin((px + frame * 1.5) * 0.9) * Math.cos((py - frame) * 0.7);
          ctx.fillStyle = `rgba(${Math.round(rgb[0] * 255 * n)},${Math.round(rgb[1] * 255 * n)},${Math.round(rgb[2] * 255 * n)},0.72)`;
          ctx.fillRect(x + px, y + py, 2, 2);
        }
      }
    }
    // gutter: left/right columns first, then full rows so the corners are filled
    ctx.drawImage(this.canvas, x, y, 1, s, x - p, y, p, s);
    ctx.drawImage(this.canvas, x + s - 1, y, 1, s, x + s, y, p, s);
    ctx.drawImage(this.canvas, x - p, y, s + 2 * p, 1, x - p, y - p, s + 2 * p, p);
    ctx.drawImage(this.canvas, x - p, y + s - 1, s + 2 * p, 1, x - p, y + s, s + 2 * p, p);
  }

  public dispose() {
    this.texture.dispose();
  }
}
