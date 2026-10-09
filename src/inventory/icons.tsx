import React, { useEffect, useState } from 'react';
import { resourcePacks } from '../resourcepack/ResourcePackManager';
import { getBlockIconFaces, renderIsometricBlockIcon } from '../resourcepack/blockIconFaces';
import { getItemDef } from './items';

/** Icons are rendered at 32px (a 16px item at GUI scale 2) and displayed at any CSS size. */
const ICON_PX = 32;

function upscale(tex: HTMLCanvasElement, size = ICON_PX): string {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(tex, 0, 0, size, size);
  return c.toDataURL('image/png');
}

/** Load a pack texture as a data URL (null when no enabled pack has it); refreshes on pack changes. */
export function usePackImage(paths: string[], raw = false): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const key = paths.join('|') + (raw ? '#raw' : '');
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const tex = await resourcePacks.getTexture(paths);
        if (alive) setUrl(tex ? (raw ? tex.toDataURL('image/png') : upscale(tex)) : null);
      } catch {
        if (alive) setUrl(null);
      }
    };
    void load();
    const off = resourcePacks.subscribe(load);
    return () => {
      alive = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return url;
}

function useItemIconUrl(itemId: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const def = getItemDef(itemId);
    const load = async () => {
      try {
        let out: string | null = null;
        if (def?.voxel !== undefined) {
          const faces = await getBlockIconFaces(def.voxel);
          if (faces) out = renderIsometricBlockIcon(faces, ICON_PX).toDataURL('image/png');
        } else if (def?.disc) {
          const tex = await resourcePacks.getTexture([`item/music_disc_${def.disc}`]);
          if (tex) out = upscale(tex);
        }
        if (alive) setUrl(out);
      } catch {
        if (alive) setUrl(null);
      }
    };
    void load();
    const off = resourcePacks.subscribe(load);
    return () => {
      alive = false;
      off();
    };
  }, [itemId]);
  return url;
}

/** A block/item icon (isometric cube for blocks, flat sprite for discs). */
export const ItemIcon: React.FC<{ itemId: string; size: number; style?: React.CSSProperties }> = ({ itemId, size, style }) => {
  const url = useItemIconUrl(itemId);
  if (!url) {
    return <div style={{ width: size * 0.7, height: size * 0.7, margin: size * 0.15, background: '#888', ...style }} />;
  }
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      style={{ width: size, height: size, display: 'block', imageRendering: 'pixelated', pointerEvents: 'none', ...style }}
    />
  );
};

/** A plain pack texture shown as an icon (tab icons). */
export const TextureIcon: React.FC<{ paths: string[]; size: number }> = ({ paths, size }) => {
  const url = usePackImage(paths);
  if (!url) return null;
  return <img src={url} alt="" draggable={false} style={{ width: size, height: size, imageRendering: 'pixelated', pointerEvents: 'none', display: 'block' }} />;
};

/** Stack size in the bottom-right of a slot, in the vanilla style (white with a dark shadow). */
export const StackCount: React.FC<{ count: number; size?: number }> = ({ count, size = 8 }) =>
  count > 1 ? (
    <span
      style={{
        position: 'absolute', right: -size / 8, bottom: -size / 8, fontSize: size, lineHeight: `${size}px`, color: '#fff',
        textShadow: `${size / 8}px ${size / 8}px 0 #3f3f3f`, pointerEvents: 'none', fontFamily: 'Minecraft, monospace',
      }}
    >
      {count}
    </span>
  ) : null;
