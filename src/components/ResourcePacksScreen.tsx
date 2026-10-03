import React, { useEffect, useRef, useState } from 'react';
import { resourcePacks, ResourcePackInfo } from '../resourcepack/ResourcePackManager';

/**
 * Minecraft Java "Select Resource Packs" screen:
 * Available (left) / Selected (right, top = highest priority), import from .zip,
 * enable / disable arrows, reorder, delete, Done. Default pack is always at the bottom.
 */

const formatSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

const PackRow: React.FC<{
  pack: ResourcePackInfo | null; // null = built-in Default
  selected: boolean;
  index?: number;
  count?: number;
}> = ({ pack, selected, index = 0, count = 0 }) => {
  const iconStyle: React.CSSProperties = { imageRendering: 'pixelated' };
  const btn =
    'w-7 h-7 flex items-center justify-center bg-[#4a4a4a] border border-black/70 text-white text-sm hover:bg-[#6a6a8a] disabled:opacity-30 disabled:hover:bg-[#4a4a4a]';
  return (
    <div className="flex items-center gap-3 p-2 bg-black/45 border-2 border-transparent hover:border-white/70">
      {pack?.iconUrl ? (
        <img src={pack.iconUrl} alt="" width={48} height={48} className="shrink-0" style={iconStyle} />
      ) : (
        <img src="/textures/gui/options_background.png" alt="" width={48} height={48} className="shrink-0" style={iconStyle} />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-xs text-white truncate">{pack ? pack.name : 'Default'}</div>
        <div className="text-[10px] text-[#a0a0a0] line-clamp-2 leading-tight">
          {pack ? pack.description || 'No description' : 'The default look and feel of the game'}
        </div>
        {pack && (
          <div className="text-[9px] text-[#777]">
            {pack.packFormat != null ? `pack_format ${pack.packFormat} · ` : ''}
            {formatSize(pack.sizeBytes)}
          </div>
        )}
      </div>
      {pack && (
        <div className="flex items-center gap-1 shrink-0">
          {selected && (
            <>
              <button className={btn} disabled={index === 0} onClick={() => resourcePacks.move(pack.id, -1)} title="Move up (higher priority)">
                ▲
              </button>
              <button className={btn} disabled={index === count - 1} onClick={() => resourcePacks.move(pack.id, 1)} title="Move down">
                ▼
              </button>
            </>
          )}
          <button
            className={btn}
            onClick={() => (selected ? resourcePacks.disable(pack.id) : resourcePacks.enable(pack.id))}
            title={selected ? 'Deselect pack' : 'Select pack'}
          >
            {selected ? '◀' : '▶'}
          </button>
          {!selected && (
            <button className={btn + ' text-[#ff8888]'} onClick={() => resourcePacks.removePack(pack.id)} title="Delete pack">
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export const ResourcePacksScreen: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [, force] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => resourcePacks.subscribe(() => force((n) => n + 1)), []);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    for (const file of Array.from(files)) {
      try {
        await resourcePacks.importFile(file);
      } catch (e: any) {
        setError(`${file.name}: ${e?.message || 'could not read pack'}`);
      }
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const available = resourcePacks.getAvailable();
  const selected = resourcePacks.getSelected();

  return (
    <div className="relative z-10 w-full max-w-4xl h-full max-h-[92vh] mc-dirt-bg border-4 border-black/75 shadow-2xl flex flex-col overflow-hidden">
      <div className="w-full py-3 text-center border-b-2 border-black/50 bg-black/40">
        <h2 className="text-base sm:text-lg font-bold text-[#e0e0e0] drop-shadow-[2px_2px_0px_#222222]">Select Resource Packs</h2>
        <p className="text-[10px] text-[#aaaaaa] mt-0.5">Import a Minecraft: Java Edition resource pack (.zip). Packs higher in the list override lower ones.</p>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 overflow-y-auto">
        <div className="flex flex-col min-h-0">
          <div className="text-xs text-white text-center py-1 drop-shadow-[1px_1px_0px_#000]">Available Resource Packs</div>
          <div className="flex-1 bg-black/55 border-2 border-black/80 p-1.5 flex flex-col gap-1.5 overflow-y-auto min-h-[120px]">
            {available.length === 0 && <div className="text-[11px] text-[#888] text-center py-6">No packs imported.<br />Use “Import Pack…” below.</div>}
            {available.map((p) => (
              <PackRow key={p.id} pack={p} selected={false} />
            ))}
          </div>
        </div>

        <div className="flex flex-col min-h-0">
          <div className="text-xs text-white text-center py-1 drop-shadow-[1px_1px_0px_#000]">Selected Resource Packs</div>
          <div className="flex-1 bg-black/55 border-2 border-black/80 p-1.5 flex flex-col gap-1.5 overflow-y-auto min-h-[120px]">
            {selected.map((p, i) => (
              <PackRow key={p.id} pack={p} selected index={i} count={selected.length} />
            ))}
            <PackRow pack={null} selected />
          </div>
        </div>
      </div>

      {error && <div className="px-4 py-1 text-[11px] text-[#ff7777] bg-black/60 text-center">{error}</div>}

      <div className="w-full py-3 border-t-2 border-black/50 bg-black/40 flex items-center justify-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <button onClick={() => fileRef.current?.click()} disabled={busy} className="mc-button w-48 py-2.5 text-xs uppercase">
          {busy ? 'Importing…' : 'Import Pack…'}
        </button>
        <button onClick={onDone} className="mc-button w-48 py-2.5 text-xs uppercase">
          Done
        </button>
      </div>
    </div>
  );
};
