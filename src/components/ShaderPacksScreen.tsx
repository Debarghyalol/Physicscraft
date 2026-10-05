import React, { useEffect, useRef, useState } from 'react';
import { shaderPacks, ShaderPackInfo, ProgramReport } from '../shaderpack/ShaderPackManager';

/**
 * Options > Shader Packs: import an OptiFine / Iris style shader pack (.zip), pick which one is
 * active, remove packs, and check how many of the pack's programs this device's GPU can compile.
 */

const formatSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export const ShaderPacksScreen: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [, force] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ pack: string; items: ProgramReport[] } | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => shaderPacks.subscribe(() => force((n) => n + 1)), []);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    for (const file of Array.from(files)) {
      try {
        await shaderPacks.importFile(file);
      } catch (e: any) {
        setError(`${file.name}: ${e?.message || 'could not read shader pack'}`);
      }
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const check = async (p: ShaderPackInfo) => {
    setChecking(p.id);
    setReport(null);
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');
      if (!gl) throw new Error('WebGL2 is not available on this device');
      const dim = p.dimensions.includes('world0') ? 'world0' : p.dimensions[0] ?? 'world0';
      const items = await shaderPacks.compileReport(p.id, dim, gl);
      setReport({ pack: p.name, items });
    } catch (e: any) {
      setError(e?.message || 'compatibility check failed');
    }
    setChecking(null);
  };

  const packs = shaderPacks.getPacks();
  const btn = 'px-2 h-7 flex items-center justify-center bg-[#4a4a4a] border border-black/70 text-white text-[11px] hover:bg-[#6a6a8a] disabled:opacity-40';
  const failed = report?.items.filter((r) => !r.ok) ?? [];

  return (
    <div className="relative z-10 w-full max-w-3xl h-full max-h-[92vh] mc-dirt-bg border-4 border-black/75 shadow-2xl flex flex-col overflow-hidden">
      <div className="w-full py-3 text-center border-b-2 border-black/50 bg-black/40">
        <h2 className="text-base sm:text-lg font-bold text-[#e0e0e0] drop-shadow-[2px_2px_0px_#222222]">Shader Packs</h2>
        <p className="text-[10px] text-[#aaaaaa] mt-0.5 px-3">
          Import an OptiFine / Iris shader pack (.zip). Packs stay on this device; only one can be active.
        </p>
      </div>

      <div className="flex-1 min-h-0 p-3 overflow-y-auto flex flex-col gap-2">
        <div className="bg-black/55 border-2 border-black/80 p-1.5 flex flex-col gap-1.5">
          <div className={`flex items-center gap-3 p-2 bg-black/45 border-2 ${!packs.some((p) => p.enabled) ? 'border-white/80' : 'border-transparent'}`}>
            <div className="flex-1 text-xs text-white">(Off) Vanilla rendering</div>
            <button className={btn} onClick={() => shaderPacks.select(null)} disabled={!packs.some((p) => p.enabled)}>
              Use
            </button>
          </div>
          {packs.map((p) => (
            <div key={p.id} className={`flex items-center gap-3 p-2 bg-black/45 border-2 ${p.enabled ? 'border-white/80' : 'border-transparent'}`}>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-white truncate">{p.name}</div>
                <div className="text-[10px] text-[#a0a0a0]">
                  {p.programCount} programs · {p.dimensions.join(', ') || 'no dimensions'} · {formatSize(p.sizeBytes)}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                <button className={btn} onClick={() => check(p)} disabled={checking !== null}>
                  {checking === p.id ? 'Checking…' : 'Check'}
                </button>
                <button className={btn} onClick={() => shaderPacks.select(p.id)} disabled={p.enabled}>
                  {p.enabled ? 'Selected' : 'Select'}
                </button>
                <button className={btn + ' text-[#ff8888]'} onClick={() => shaderPacks.remove(p.id)} title="Delete pack">
                  ✕
                </button>
              </div>
            </div>
          ))}
          {packs.length === 0 && <div className="text-[11px] text-[#888] text-center py-4">No shader packs imported.<br />Use “Import Shader Pack…” below.</div>}
        </div>

        {report && (
          <div className="bg-black/55 border-2 border-black/80 p-2 text-[11px] text-[#ddd]">
            <div className="text-white mb-1">
              {report.pack}: {report.items.length - failed.length}/{report.items.length} shader stages compile on this GPU
            </div>
            {failed.length > 0 && (
              <div className="max-h-40 overflow-y-auto text-[10px] text-[#ff9999] font-mono whitespace-pre-wrap">
                {failed.slice(0, 20).map((f) => `${f.name} (${f.stage}): ${f.log.split('\n')[0]}`).join('\n')}
              </div>
            )}
          </div>
        )}

        <p className="text-[10px] text-[#aaa] leading-snug px-1">
          Heads-up: shader support is still being built. Importing and selecting a pack is saved, but the game does not yet render
          with it; “Check” shows how much of the pack this device can already compile.
        </p>
      </div>

      {error && <div className="px-4 py-1 text-[11px] text-[#ff7777] bg-black/60 text-center">{error}</div>}

      <div className="w-full py-3 border-t-2 border-black/50 bg-black/40 flex items-center justify-center gap-3">
        <input ref={fileRef} type="file" accept=".zip,application/zip" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} disabled={busy} className="mc-button w-52 py-2.5 text-xs uppercase">
          {busy ? 'Importing…' : 'Import Shader Pack…'}
        </button>
        <button onClick={onDone} className="mc-button w-40 py-2.5 text-xs uppercase">
          Done
        </button>
      </div>
    </div>
  );
};
