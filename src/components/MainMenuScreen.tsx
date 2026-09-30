import React, { useState } from 'react';
import {
  Play,
  Users,
  Settings,
  Globe,
  Plus,
  Trash2,
  ArrowLeft,
  RotateCcw,
  Boxes,
  Check,
} from 'lucide-react';
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
    name: 'Infinite Wilderness',
    mode: 'Survival',
    seed: 133742,
    preset: 'empty',
    lastPlayed: 'Today',
  },
  {
    id: 'world-2',
    name: 'Physics Playground',
    mode: 'Physics',
    seed: 849201,
    preset: 'jenga',
    lastPlayed: 'Yesterday',
  },
  {
    id: 'world-3',
    name: 'Mountain Fortress',
    mode: 'Creative',
    seed: 994215,
    preset: 'castle',
    lastPlayed: '3 days ago',
  },
];

const LANGUAGES = [
  { code: 'en_US', name: 'English (US)' },
  { code: 'en_GB', name: 'English (UK)' },
  { code: 'es_ES', name: 'Español' },
  { code: 'fr_FR', name: 'Français' },
  { code: 'de_DE', name: 'Deutsch' },
  { code: 'ja_JP', name: '日本語' },
  { code: 'pt_BR', name: 'Português' },
  { code: 'zh_CN', name: '中文 (简体)' },
];

export const MainMenuScreen: React.FC<MainMenuScreenProps> = ({
  onPlayWorld,
  onOpenSettings,
}) => {
  const [view, setView] = useState<'title' | 'singleplayer' | 'create_world' | 'multiplayer' | 'language'>('title');
  const [worlds, setWorlds] = useState<WorldSave[]>(DEFAULT_WORLDS);
  const [selectedWorldId, setSelectedWorldId] = useState<string>(DEFAULT_WORLDS[0].id);

  // Create world form state
  const [newWorldName, setNewWorldName] = useState('New World');
  const [newWorldMode, setNewWorldMode] = useState<'Survival' | 'Creative' | 'Physics'>('Survival');
  const [newWorldSeed, setNewWorldSeed] = useState<string>(
    String(Math.floor(Math.random() * 900000) + 100000)
  );
  const [newWorldPreset, setNewWorldPreset] = useState<StructurePreset>('empty');

  // Language state
  const [selectedLanguage, setSelectedLanguage] = useState('en_US');

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
      name: newWorldName.trim() || 'My World',
      mode: newWorldMode,
      seed: seedNum,
      preset: newWorldPreset,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black select-none text-white font-sans overflow-hidden">
      {/* Subtle Atmospheric Dirt / Dark Grid Background (Authentic Minecraft Panorama aesthetic in Roblox Monochrome) */}
      <div className="absolute inset-0 opacity-20 pointer-events-none bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:24px_24px]" />

      {/* VIEW 1: FULL SCREEN TITLE SCREEN */}
      {view === 'title' && (
        <div className="relative z-10 flex flex-col items-center justify-between w-full h-full p-6 sm:p-10 max-w-lg mx-auto">
          {/* Top Logo & Title */}
          <div className="text-center pt-8 sm:pt-14 space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-[10px] font-mono tracking-widest uppercase text-white/80">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              VOXEL 3D EDITION
            </div>
            <h1 className="text-4xl sm:text-5xl font-mono font-black tracking-widest text-white drop-shadow-[0_4px_12px_rgba(0,0,0,0.9)]">
              MINECRAFT
            </h1>
            <p className="text-xs font-mono tracking-widest text-neutral-400 uppercase">
              Procedural Infinite Worlds · Rapier 3D Physics
            </p>
          </div>

          {/* Center Navigation Options (Clean Roblox Monochrome Cards) */}
          <div className="w-full space-y-3">
            {/* Singleplayer (Primary) */}
            <button
              onClick={() => setView('singleplayer')}
              className="w-full flex items-center justify-between px-5 py-4 bg-white text-black hover:bg-neutral-200 rounded-2xl font-mono font-bold text-sm tracking-wider shadow-2xl transition active:scale-[0.98] group"
            >
              <div className="flex items-center gap-3">
                <Play className="w-4 h-4 fill-black" />
                <span>SINGLEPLAYER</span>
              </div>
              <span className="text-xs font-mono opacity-60 group-hover:opacity-100 transition">
                ENTER →
              </span>
            </button>

            {/* Multiplayer */}
            <button
              onClick={() => setView('multiplayer')}
              className="w-full flex items-center justify-between px-5 py-3.5 bg-neutral-900/80 hover:bg-neutral-800 border border-white/15 hover:border-white/40 rounded-2xl font-mono text-sm tracking-wider transition active:scale-[0.98] group shadow-lg"
            >
              <div className="flex items-center gap-3">
                <Users className="w-4 h-4 text-white" />
                <span>MULTIPLAYER</span>
              </div>
              <span className="text-xs font-mono text-neutral-400 group-hover:text-white transition">
                BROWSE →
              </span>
            </button>

            {/* Settings & Language Grid */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                onClick={onOpenSettings}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-neutral-900/80 hover:bg-neutral-800 border border-white/15 hover:border-white/40 rounded-2xl font-mono text-xs tracking-wider transition active:scale-[0.98]"
              >
                <Settings className="w-4 h-4" />
                <span>SETTINGS</span>
              </button>

              <button
                onClick={() => setView('language')}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-neutral-900/80 hover:bg-neutral-800 border border-white/15 hover:border-white/40 rounded-2xl font-mono text-xs tracking-wider transition active:scale-[0.98]"
              >
                <Globe className="w-4 h-4" />
                <span>LANGUAGE</span>
              </button>
            </div>
          </div>

          {/* Bottom Footer Info */}
          <div className="text-center pb-2 text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
            Minecraft Engine 3D · Bedrock & Java Style
          </div>
        </div>
      )}

      {/* VIEW 2: SINGLEPLAYER WORLD SELECT */}
      {view === 'singleplayer' && (
        <div className="relative z-10 flex flex-col justify-between w-full h-full p-4 sm:p-8 max-w-xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setView('title')}
                className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 transition"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h2 className="text-lg font-mono font-bold uppercase tracking-wider text-white">
                Select World
              </h2>
            </div>
            <span className="text-xs font-mono text-neutral-400">
              {worlds.length} {worlds.length === 1 ? 'World' : 'Worlds'}
            </span>
          </div>

          {/* World List */}
          <div className="flex-1 my-4 space-y-2.5 overflow-y-auto pr-1 scrollbar-thin">
            {worlds.map((w) => {
              const isSelected = selectedWorldId === w.id;
              return (
                <div
                  key={w.id}
                  onClick={() => setSelectedWorldId(w.id)}
                  onDoubleClick={handlePlaySelected}
                  className={`p-4 rounded-2xl border transition cursor-pointer flex items-center justify-between ${
                    isSelected
                      ? 'bg-neutral-800/90 border-white ring-1 ring-white/50 shadow-xl'
                      : 'bg-neutral-900/60 border-white/10 hover:border-white/30 hover:bg-neutral-900'
                  }`}
                >
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`w-11 h-11 rounded-xl flex items-center justify-center border ${
                        isSelected ? 'bg-white text-black border-white' : 'bg-black text-white border-white/20'
                      }`}
                    >
                      <Boxes className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white tracking-wide">{w.name}</div>
                      <div className="text-xs text-neutral-400 font-mono mt-0.5">
                        {w.mode} Mode · Seed: {w.seed} · {w.lastPlayed}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isSelected && (
                      <span className="text-[10px] font-mono bg-white text-black font-bold px-2 py-0.5 rounded-sm">
                        READY
                      </span>
                    )}
                    {worlds.length > 1 && (
                      <button
                        onClick={(e) => handleDeleteWorld(w.id, e)}
                        className="p-2 text-neutral-400 hover:text-white hover:bg-white/10 rounded-xl transition"
                        title="Delete World"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Controls Footer */}
          <div className="pt-3 border-t border-white/10 space-y-2">
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={handlePlaySelected}
                className="py-3.5 bg-white text-black font-mono font-bold text-xs tracking-wider uppercase rounded-xl hover:bg-neutral-200 transition shadow-xl flex items-center justify-center gap-2 active:scale-[0.98]"
              >
                <Play className="w-4 h-4 fill-black" />
                <span>Play Selected World</span>
              </button>

              <button
                onClick={() => setView('create_world')}
                className="py-3.5 bg-neutral-900 text-white border border-white/20 hover:border-white/40 font-mono font-semibold text-xs tracking-wider uppercase rounded-xl hover:bg-neutral-800 transition flex items-center justify-center gap-2 active:scale-[0.98]"
              >
                <Plus className="w-4 h-4" />
                <span>Create New World</span>
              </button>
            </div>

            <button
              onClick={() => setView('title')}
              className="w-full py-2.5 bg-neutral-900/60 text-neutral-400 hover:text-white border border-white/10 rounded-xl font-mono text-xs uppercase tracking-wider transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* VIEW 3: CREATE NEW WORLD */}
      {view === 'create_world' && (
        <form onSubmit={handleCreateWorldSubmit} className="relative z-10 flex flex-col justify-between w-full h-full p-4 sm:p-8 max-w-xl mx-auto">
          {/* Header */}
          <div className="flex items-center gap-3 pb-3 border-b border-white/10">
            <button
              type="button"
              onClick={() => setView('singleplayer')}
              className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 transition"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h2 className="text-lg font-mono font-bold uppercase tracking-wider text-white">
              Create New World
            </h2>
          </div>

          {/* Form Fields */}
          <div className="my-auto space-y-4 py-4 overflow-y-auto">
            <div className="space-y-1.5">
              <label className="text-xs font-mono uppercase tracking-wider text-neutral-300">
                World Name
              </label>
              <input
                type="text"
                value={newWorldName}
                onChange={(e) => setNewWorldName(e.target.value)}
                maxLength={30}
                required
                className="w-full px-4 py-3 rounded-xl bg-neutral-900 border border-white/20 text-white font-mono text-sm focus:outline-none focus:border-white"
                placeholder="My World"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-mono uppercase tracking-wider text-neutral-300">
                Game Mode
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['Survival', 'Creative', 'Physics'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setNewWorldMode(mode)}
                    className={`py-2.5 px-3 rounded-xl border text-xs font-mono uppercase tracking-wider transition ${
                      newWorldMode === mode
                        ? 'bg-white text-black font-semibold border-white shadow-md'
                        : 'bg-neutral-900 text-neutral-400 border-white/10 hover:border-white/30 hover:text-white'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-mono uppercase tracking-wider text-neutral-300">
                World Seed
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newWorldSeed}
                  onChange={(e) => setNewWorldSeed(e.target.value.replace(/[^0-9]/g, ''))}
                  className="flex-1 px-4 py-3 rounded-xl bg-neutral-900 border border-white/20 text-white font-mono text-sm focus:outline-none focus:border-white"
                  placeholder="Random Seed"
                />
                <button
                  type="button"
                  onClick={() =>
                    setNewWorldSeed(String(Math.floor(Math.random() * 900000) + 100000))
                  }
                  className="px-4 py-3 bg-neutral-800 border border-white/20 hover:border-white/40 rounded-xl text-xs font-mono text-white transition flex items-center gap-1.5"
                  title="Randomize Seed"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-mono uppercase tracking-wider text-neutral-300">
                Initial Structure Preset
              </label>
              <select
                value={newWorldPreset}
                onChange={(e) => setNewWorldPreset(e.target.value as StructurePreset)}
                className="w-full px-4 py-3 rounded-xl bg-neutral-900 border border-white/20 text-white font-mono text-sm focus:outline-none focus:border-white"
              >
                <option value="empty">Natural Infinite Procedural Wilderness</option>
                <option value="jenga">Jenga Tower Physics</option>
                <option value="softbody">Soft Body Jelly Showcase</option>
                <option value="castle">Castle Fortress</option>
                <option value="pyramid">Ancient Pyramid</option>
                <option value="cradle">Demolition Arena</option>
                <option value="dominoes">Domino Run</option>
              </select>
            </div>
          </div>

          {/* Footer Controls */}
          <div className="pt-3 border-t border-white/10 grid grid-cols-2 gap-2.5">
            <button
              type="submit"
              className="py-3.5 bg-white text-black font-mono font-bold text-xs tracking-wider uppercase rounded-xl hover:bg-neutral-200 transition shadow-xl"
            >
              Create World
            </button>

            <button
              type="button"
              onClick={() => setView('singleplayer')}
              className="py-3.5 bg-neutral-900 text-neutral-300 hover:text-white border border-white/10 rounded-xl font-mono text-xs uppercase tracking-wider transition"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* VIEW 4: MULTIPLAYER REALMS */}
      {view === 'multiplayer' && (
        <div className="relative z-10 flex flex-col justify-between w-full h-full p-4 sm:p-8 max-w-xl mx-auto">
          <div className="flex items-center gap-3 pb-3 border-b border-white/10">
            <button
              onClick={() => setView('title')}
              className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 transition"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h2 className="text-lg font-mono font-bold uppercase tracking-wider text-white">
              Multiplayer Realms
            </h2>
          </div>

          <div className="flex-1 my-4 space-y-2.5 overflow-y-auto pr-1">
            {[
              { name: 'US-East Creative Realm', ping: '24ms', players: '14/24', mode: 'Creative' },
              { name: 'EU-Central Survival Sandbox', ping: '68ms', players: '32/50', mode: 'Survival' },
              { name: 'Physics Demolition Arena', ping: '42ms', players: '8/16', mode: 'Physics' },
            ].map((server, i) => (
              <div
                key={i}
                className="p-4 rounded-2xl bg-neutral-900/60 border border-white/10 flex items-center justify-between hover:border-white/30 transition"
              >
                <div>
                  <div className="text-sm font-semibold text-white">{server.name}</div>
                  <div className="text-xs text-neutral-400 font-mono mt-0.5">
                    {server.mode} · {server.players} Players
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xs font-mono text-emerald-400">{server.ping}</span>
                  <button
                    onClick={() => alert(`Connecting to ${server.name}...`)}
                    className="block mt-1 px-3 py-1 bg-white text-black text-[11px] font-mono font-bold rounded-lg hover:bg-neutral-200 transition"
                  >
                    JOIN
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => setView('title')}
            className="w-full py-3 bg-neutral-900 text-neutral-300 hover:text-white border border-white/10 rounded-xl font-mono text-xs uppercase tracking-wider transition"
          >
            Back to Title
          </button>
        </div>
      )}

      {/* VIEW 5: LANGUAGE SELECTOR */}
      {view === 'language' && (
        <div className="relative z-10 flex flex-col justify-between w-full h-full p-4 sm:p-8 max-w-xl mx-auto">
          <div className="flex items-center gap-3 pb-3 border-b border-white/10">
            <button
              onClick={() => setView('title')}
              className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 transition"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h2 className="text-lg font-mono font-bold uppercase tracking-wider text-white">
              Language Settings
            </h2>
          </div>

          <div className="flex-1 my-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5 overflow-y-auto pr-1">
            {LANGUAGES.map((lang) => {
              const isSelected = selectedLanguage === lang.code;
              return (
                <button
                  key={lang.code}
                  onClick={() => setSelectedLanguage(lang.code)}
                  className={`p-3.5 rounded-2xl border text-left flex items-center justify-between transition ${
                    isSelected
                      ? 'bg-white text-black border-white font-semibold shadow-md'
                      : 'bg-neutral-900/60 text-neutral-300 border-white/10 hover:border-white/30 hover:bg-neutral-900'
                  }`}
                >
                  <span className="text-xs font-mono">{lang.name}</span>
                  {isSelected && <Check className="w-4 h-4 text-black" />}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => setView('title')}
            className="w-full py-3.5 bg-white text-black font-mono font-bold text-xs tracking-wider uppercase rounded-xl hover:bg-neutral-200 transition shadow-xl"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
};
