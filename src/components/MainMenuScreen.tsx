import React, { useState } from 'react';
import { Globe, Plus, Trash2 } from 'lucide-react';
import { StructurePreset } from '../types/physics';

export interface WorldSave {
  id: string;
  name: string;
  mode: 'Survival' | 'Creative' | 'Physics';
  seed: number;
  preset: StructurePreset;
  lastPlayed: string;
}

export interface MainMenuScreenProps {
  onPlayWorld: (world: WorldSave) => void;
  onOpenSettings: () => void;
}

const DEFAULT_WORLDS: WorldSave[] = [
  {
    id: 'world-1',
    name: 'New World',
    mode: 'Survival',
    seed: 133742,
    preset: 'empty',
    lastPlayed: 'Today',
  },
  {
    id: 'world-2',
    name: 'Creative Flatlands',
    mode: 'Creative',
    seed: 849201,
    preset: 'empty',
    lastPlayed: 'Yesterday',
  },
];

const SPLASH_TEXTS = [
  'Now with Rapier 3D physics!',
  'Procedural infinite chunks!',
  '100% Java Edition feel!',
  'Also try Terraria!',
  'Mikola Lysenko AO!',
  'Pixel art textures!',
  'Made with Three.js!',
  'Watch out for Creepers!',
];

export const MainMenuScreen: React.FC<MainMenuScreenProps> = ({
  onPlayWorld,
  onOpenSettings,
}) => {
  const [view, setView] = useState<'title' | 'singleplayer' | 'create_world'>('title');
  const [worlds, setWorlds] = useState<WorldSave[]>(DEFAULT_WORLDS);
  const [selectedWorldId, setSelectedWorldId] = useState<string>(DEFAULT_WORLDS[0].id);

  // Random splash text
  const [splashText] = useState<string>(
    () => SPLASH_TEXTS[Math.floor(Math.random() * SPLASH_TEXTS.length)]
  );

  // Create world form state
  const [newWorldName, setNewWorldName] = useState('New World');
  const [newWorldMode, setNewWorldMode] = useState<'Survival' | 'Creative'>('Survival');
  const [newWorldSeed, setNewWorldSeed] = useState<string>(
    String(Math.floor(Math.random() * 900000) + 100000)
  );

  const handlePlaySelected = () => {
    const world = worlds.find((w) => w.id === selectedWorldId);
    if (world) {
      onPlayWorld(world);
    }
  };

  const handleCreateWorldSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const seedNum = parseInt(newWorldSeed, 10) || Math.floor(Math.random() * 900000);
    const newWorld: WorldSave = {
      id: `world_${Date.now()}`,
      name: newWorldName.trim() || 'New World',
      mode: newWorldMode,
      seed: seedNum,
      preset: 'empty',
      lastPlayed: 'Just now',
    };

    setWorlds([newWorld, ...worlds]);
    setSelectedWorldId(newWorld.id);
    onPlayWorld(newWorld);
  };

  const handleDeleteWorld = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (worlds.length <= 1) return;
    const remaining = worlds.filter((w) => w.id !== id);
    setWorlds(remaining);
    if (selectedWorldId === id) {
      setSelectedWorldId(remaining[0].id);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between mc-dirt-bg select-none text-white font-mono overflow-hidden">
      {/* Dark Vignette Overlay for Minecraft Java depth */}
      <div className="absolute inset-0 bg-black/45 pointer-events-none" />

      {/* VIEW 1: AUTHENTIC MINECRAFT JAVA TITLE SCREEN */}
      {view === 'title' && (
        <div className="relative z-10 flex flex-col items-center justify-between w-full h-full p-4 sm:p-8 max-w-2xl mx-auto">
          {/* Minecraft Java Logo & Bouncing Yellow Splash Text */}
          <div className="relative mt-8 sm:mt-12 flex flex-col items-center">
            <img
              src="/textures/gui/minecraft_logo.png"
              alt="Minecraft Java Edition"
              className="w-72 sm:w-[420px] h-auto drop-shadow-[0_8px_16px_rgba(0,0,0,0.85)] image-render-pixel"
              style={{ imageRendering: 'pixelated' }}
            />
            {/* Authentic Tilted Yellow Splash Text */}
            <div className="absolute -bottom-2 -right-4 sm:right-0 mc-splash text-[#ffff55] font-bold text-xs sm:text-sm tracking-wide whitespace-nowrap pointer-events-none drop-shadow-[2px_2px_0px_#3f3f00]">
              {splashText}
            </div>
          </div>

          {/* Minecraft Java Standard Button Stack (380px wide) */}
          <div className="flex flex-col items-center gap-2.5 w-full max-w-sm my-auto">
            {/* Singleplayer */}
            <button
              onClick={() => setView('singleplayer')}
              className="mc-button w-full py-2.5 text-sm"
            >
              Singleplayer
            </button>

            {/* Multiplayer */}
            <button
              disabled
              className="mc-button w-full py-2.5 text-sm opacity-60"
              title="Multiplayer server connection"
            >
              Multiplayer
            </button>

            {/* Options... & Quit Game (Half-width side by side) */}
            <div className="flex items-center gap-2 w-full">
              <button
                onClick={onOpenSettings}
                className="mc-button flex-1 py-2.5 text-sm"
              >
                Options...
              </button>
              <button
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.location.reload();
                  }
                }}
                className="mc-button flex-1 py-2.5 text-sm"
              >
                Quit Game
              </button>
            </div>
          </div>

          {/* Minecraft Java Edition Bottom Footer */}
          <div className="w-full flex items-center justify-between text-[11px] text-[#aaaaaa] drop-shadow-[1px_1px_0px_#000000] px-2 pb-1">
            <span>Minecraft 1.21 (Java Edition / Rapier 3D)</span>
            <span>Copyright Mojang AB. Do not distribute!</span>
          </div>
        </div>
      )}

      {/* VIEW 2: SELECT WORLD (SINGLEPLAYER) */}
      {view === 'singleplayer' && (
        <div className="relative z-10 flex flex-col items-center justify-between w-full h-full max-w-3xl mx-auto">
          {/* Header */}
          <div className="w-full py-4 text-center border-b-2 border-black/40 bg-black/40">
            <h2 className="text-base sm:text-lg font-bold text-[#e0e0e0] drop-shadow-[2px_2px_0px_#222222]">
              Select World
            </h2>
          </div>

          {/* Middle World List Panel */}
          <div className="w-full flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {worlds.map((world) => {
              const isSelected = world.id === selectedWorldId;
              return (
                <div
                  key={world.id}
                  onClick={() => setSelectedWorldId(world.id)}
                  onDoubleClick={handlePlaySelected}
                  className={`flex items-center justify-between p-3 border-2 cursor-pointer transition ${
                    isSelected
                      ? 'bg-black/80 border-[#ffffff] text-white shadow-inner'
                      : 'bg-black/50 border-[#333333] hover:border-[#666666] text-[#cccccc]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {/* World Thumbnail / Grass Block Icon */}
                    <div className="w-10 h-10 bg-neutral-900 border border-neutral-700 flex items-center justify-center shrink-0">
                      <span className="text-xl">🟩</span>
                    </div>
                    <div>
                      <div className="font-bold text-sm text-[#ffffff] drop-shadow-[1px_1px_0px_#000000]">
                        {world.name}
                      </div>
                      <div className="text-[11px] text-[#888888]">
                        {world.mode} Mode · Seed: {world.seed} · {world.lastPlayed}
                      </div>
                    </div>
                  </div>

                  {/* Delete Button */}
                  {worlds.length > 1 && (
                    <button
                      onClick={(e) => handleDeleteWorld(world.id, e)}
                      className="p-1.5 text-neutral-400 hover:text-red-400 transition"
                      title="Delete World"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Bottom Action Buttons Bar */}
          <div className="w-full py-4 px-4 border-t-2 border-black/40 bg-black/50 flex flex-col sm:flex-row items-center justify-center gap-2.5">
            <button
              onClick={handlePlaySelected}
              className="mc-button w-full sm:w-48 py-2.5 text-xs uppercase"
            >
              Play Selected World
            </button>

            <button
              onClick={() => setView('create_world')}
              className="mc-button w-full sm:w-44 py-2.5 text-xs uppercase"
            >
              Create New World
            </button>

            <button
              onClick={() => setView('title')}
              className="mc-button w-full sm:w-36 py-2.5 text-xs uppercase"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* VIEW 3: CREATE NEW WORLD */}
      {view === 'create_world' && (
        <div className="relative z-10 flex flex-col items-center justify-between w-full h-full max-w-xl mx-auto">
          {/* Header */}
          <div className="w-full py-4 text-center border-b-2 border-black/40 bg-black/40">
            <h2 className="text-base sm:text-lg font-bold text-[#e0e0e0] drop-shadow-[2px_2px_0px_#222222]">
              Create New World
            </h2>
          </div>

          {/* Form Content */}
          <form
            onSubmit={handleCreateWorldSubmit}
            className="w-full flex-1 px-6 py-6 flex flex-col gap-4 overflow-y-auto"
          >
            {/* World Name */}
            <div>
              <label className="block text-xs text-[#aaaaaa] mb-1.5 drop-shadow-[1px_1px_0px_#000000]">
                World Name
              </label>
              <input
                type="text"
                value={newWorldName}
                onChange={(e) => setNewWorldName(e.target.value)}
                maxLength={32}
                className="w-full px-3 py-2 bg-black border-2 border-[#555555] focus:border-[#ffffff] text-white text-sm outline-none font-mono"
              />
            </div>

            {/* Game Mode Toggle */}
            <div>
              <label className="block text-xs text-[#aaaaaa] mb-1.5 drop-shadow-[1px_1px_0px_#000000]">
                Game Mode
              </label>
              <button
                type="button"
                onClick={() =>
                  setNewWorldMode(newWorldMode === 'Survival' ? 'Creative' : 'Survival')
                }
                className="mc-button w-full py-2.5 text-xs"
              >
                Game Mode: {newWorldMode}
              </button>
              <p className="text-[10px] text-[#888888] mt-1">
                {newWorldMode === 'Survival'
                  ? 'Search for resources, craft, gain levels, health and hunger.'
                  : 'Unlimited blocks, free flying and destroy blocks instantly.'}
              </p>
            </div>

            {/* Seed */}
            <div>
              <label className="block text-xs text-[#aaaaaa] mb-1.5 drop-shadow-[1px_1px_0px_#000000]">
                Seed for the World Generator
              </label>
              <input
                type="text"
                value={newWorldSeed}
                onChange={(e) => setNewWorldSeed(e.target.value)}
                placeholder="Leave blank for random seed"
                className="w-full px-3 py-2 bg-black border-2 border-[#555555] focus:border-[#ffffff] text-white text-sm outline-none font-mono"
              />
            </div>

            {/* Submit / Cancel Buttons */}
            <div className="mt-auto pt-6 flex items-center justify-between gap-3">
              <button
                type="submit"
                className="mc-button flex-1 py-2.5 text-xs uppercase"
              >
                Create New World
              </button>
              <button
                type="button"
                onClick={() => setView('singleplayer')}
                className="mc-button flex-1 py-2.5 text-xs uppercase"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
