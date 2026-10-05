import React, { useEffect, useState } from 'react';
import { VoxelType } from '../types/physics';
import { HOTBAR_ITEMS } from './PlayerControlsOverlay';
import { MUSIC_DISCS, MusicDiscId } from '../audio/MusicEngine';

export interface InventoryOverlayProps {
  open: boolean;
  onClose: () => void;
  selectedVoxel: VoxelType;
  onSelectVoxel: (voxel: VoxelType) => void;
  selectedDisc: MusicDiscId;
  onSelectDisc: (disc: MusicDiscId) => void;
}

const INVENTORY_BLOCKS: { type: VoxelType; name: string }[] = [
  ...HOTBAR_ITEMS,
  { type: VoxelType.TNT, name: 'TNT' },
  { type: VoxelType.GOLD, name: 'Gold Block' },
  { type: VoxelType.JUKEBOX, name: 'Jukebox' },
];

export const InventoryOverlay: React.FC<InventoryOverlayProps> = ({
  open,
  onClose,
  selectedVoxel,
  onSelectVoxel,
  selectedDisc,
  onSelectDisc,
}) => {
  const [tab, setTab] = useState<'blocks' | 'discs'>('blocks');

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key.toLowerCase() === 'e') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ui-touch-interactive fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-3 sm:p-6">
      <div
        className="relative w-full max-w-3xl border-2 border-black/80 shadow-2xl"
        style={{
          backgroundImage: 'var(--rp-inventory-container, linear-gradient(#c6c6c6, #8f8f8f))',
          backgroundSize: '100% 100%',
          imageRendering: 'pixelated',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-2 border-white/35 bg-black/10 p-3 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-white font-mono font-bold">Inventory</div>
            <button className="mcpe-action-btn w-9 h-9 text-white" onClick={onClose} aria-label="Close inventory">×</button>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-4">
            <button className="mcpe-action-btn py-2 text-white font-mono" onClick={() => setTab('blocks')}>Blocks</button>
            <button className="mcpe-action-btn py-2 text-white font-mono" onClick={() => setTab('discs')}>Music Discs</button>
          </div>

          {tab === 'blocks' ? (
            <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-1.5">
              {INVENTORY_BLOCKS.map((item) => {
                const selected = item.type === selectedVoxel;
                return (
                  <button
                    key={item.type}
                    title={item.name}
                    onClick={() => onSelectVoxel(item.type)}
                    className="relative aspect-square flex items-center justify-center border border-black/35 bg-black/20 hover:bg-white/15"
                    style={{
                      backgroundImage: 'var(--rp-inventory-slot, linear-gradient(#8b8b8b, #6b6b6b))',
                      backgroundSize: '100% 100%',
                      imageRendering: 'pixelated',
                      outline: selected ? '2px solid white' : 'none',
                    }}
                  >
                    <span className="text-2xl drop-shadow">{item.type === VoxelType.JUKEBOX ? '♫' : '■'}</span>
                    <span className="absolute bottom-0.5 left-1 right-1 truncate text-[8px] text-white font-mono drop-shadow">{item.name}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5 max-h-[55vh] overflow-y-auto">
              {MUSIC_DISCS.map((disc) => {
                const selected = disc.id === selectedDisc;
                return (
                  <button
                    key={disc.id}
                    title={disc.title}
                    onClick={() => onSelectDisc(disc.id)}
                    className="relative aspect-square flex flex-col items-center justify-center border border-black/35 bg-black/20 hover:bg-white/15 p-1"
                    style={{
                      backgroundImage: 'var(--rp-inventory-slot, linear-gradient(#8b8b8b, #6b6b6b))',
                      backgroundSize: '100% 100%',
                      imageRendering: 'pixelated',
                      outline: selected ? '2px solid white' : 'none',
                    }}
                  >
                    <div className="w-10 h-10 rounded-full border-2 border-black/60 bg-neutral-800 flex items-center justify-center text-white">♪</div>
                    <span className="mt-1 text-[9px] text-white font-mono truncate max-w-full">{disc.title}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-4 text-[10px] text-white/80 font-mono text-center">
            Press E to close • Select a music disc, then interact with a jukebox to play it
          </div>
        </div>
      </div>
    </div>
  );
};
