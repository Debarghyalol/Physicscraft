import React, { useState } from 'react';
import {
  X,
  Play,
  Users,
  Settings,
  Globe,
  Plus,
  Trash2,
  ArrowLeft,
  Check,
  Compass,
  Boxes,
  Shield,
  RotateCcw,
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

export interface GameMenuModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onLoadWorld: (world: WorldSave) => void;
  currentWorldName: string;
}

type MenuView = 'main' | 'singleplayer' | 'create_world' | 'multiplayer' | 'language';

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
    name: 'Mountain Citadel',
    mode: 'Creative',
    seed: 994215,
    preset: 'castle',
    lastPlayed: '2 days ago',
  },
];

const LANGUAGES = [
  { code: 'en_US', name: 'English (US)' },
  { code: 'en_GB', name: 'English (UK)' },
  { code: 'es_ES', name: 'Español' },
  { code: 'fr_FR', name: 'Français' },
  { code: 'de_DE', name: 'Deutsch' },
  { code: 'ja_JP', name: '日本語' },
  { code: 'pt_BR', name: 'Português (Brasil)' },
  { code: 'zh_CN', name: '中文 (简体)' },
];

export const GameMenuModal: React.FC<GameMenuModalProps> = ({
  isOpen,
  onClose,
  onOpenSettings,
  onLoadWorld,
  currentWorldName,
}) => {
  const [view, setView] = useState<MenuView>('main');
  const [worlds, setWorlds] = useState<WorldSave[]>(DEFAULT_WORLDS);
  const [selectedWorldId, setSelectedWorldId] = useState<string>(DEFAULT_WORLDS[0].id);

  // Create World Form State
  const [newWorldName, setNewWorldName] = useState('New World');
  const [newWorldMode, setNewWorldMode] = useState<'Survival' | 'Creative' | 'Physics'>('Survival');
  const [newWorldSeed, setNewWorldSeed] = useState<string>(
    String(Math.floor(Math.random() * 900000) + 100000)
  );
  const [newWorldPreset, setNewWorldPreset] = useState<StructurePreset>('empty');

  // Language state
  const [selectedLanguage, setSelectedLanguage] = useState('en_US');

  if (!isOpen) return null;

  const handlePlaySelected = () => {
    const world = worlds.find((w) => w.id === selectedWorldId);
    if (world) {
      onLoadWorld(world);
      onClose();
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
    onLoadWorld(newWorld);
    setView('main');
    onClose();
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl bg-black/90 backdrop-blur-2xl border border-white/20 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-white font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header (Clean Roblox Style) */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-black/40">
          <div className="flex items-center gap-2.5">
            {view !== 'main' && (
              <button
                onClick={() => setView('main')}
                className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition mr-1"
                title="Back to Menu"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="w-4 h-4 rounded-xs border-2 border-white flex items-center justify-center bg-white/10">
              <div className="w-1.5 h-1.5 bg-white rounded-xs" />
            </div>
            <h2 className="text-xs font-mono uppercase tracking-widest text-white font-bold">
              {view === 'main'
                ? 'Game Menu'
                : view === 'singleplayer'
                ? 'Select World'
                : view === 'create_world'
                ? 'Create New World'
                : view === 'multiplayer'
                ? 'Multiplayer Realms'
                : 'Language Settings'}
            </h2>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition"
            title="Resume Game (ESC)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* VIEW 1: MAIN MENU */}
        {view === 'main' && (
          <div className="p-6 space-y-4 overflow-y-auto">
            {/* Title Banner */}
            <div className="text-center py-2 space-y-1">
              <h1 className="text-2xl sm:text-3xl font-mono font-black tracking-widest text-white drop-shadow-md">
                MINECRAFT 3D
              </h1>
              <p className="text-[11px] font-mono text-neutral-400 uppercase tracking-widest">
                Open-Source Infinite Procedural Physics Engine
              </p>
              {currentWorldName && (
                <div className="inline-block px-3 py-1 mt-1 rounded-full bg-neutral-900 border border-white/15 text-[10px] font-mono text-neutral-300">
                  Current: <span className="text-white font-semibold">{currentWorldName}</span>
                </div>
              )}
            </div>

            {/* Menu Options (Roblox-styled monochrome buttons) */}
            <div className="space-y-2.5 max-w-md mx-auto pt-2">
              {/* Singleplayer */}
              <button
                onClick={() => setView('singleplayer')}
                className="w-full flex items-center justify-between px-4 py-3 bg-neutral-900/80 hover:bg-neutral-800 border border-white/15 hover:border-white/40 rounded-xl transition text-left group shadow-md"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-white/10 text-white group-hover:bg-white group-hover:text-black transition">
                    <Compass className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">Singleplayer</div>
                    <div className="text-xs text-neutral-400">Select or create offline worlds</div>
                  </div>
                </div>
                <span className="text-xs font-mono text-neutral-400 group-hover:text-white transition">
                  ENTER →
                </span>
              </button>

              {/* Multiplayer */}
              <button
                onClick={() => setView('multiplayer')}
                className="w-full flex items-center justify-between px-4 py-3 bg-neutral-900/80 hover:bg-neutral-800 border border-white/15 hover:border-white/40 rounded-xl transition text-left group shadow-md"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-white/10 text-white group-hover:bg-white group-hover:text-black transition">
                    <Users className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">Multiplayer</div>
                    <div className="text-xs text-neutral-400">Join online realms & peer lobbies</div>
                  </div>
                </div>
                <span className="text-xs font-mono text-neutral-400 group-hover:text-white transition">
                  BROWSE →
                </span>
              </button>

              {/* Settings */}
              <button
                onClick={() => {
                  onClose();
                  onOpenSettings();
                }}
                className="w-full flex items-center justify-between px-4 py-3 bg-neutral-900/80 hover:bg-neutral-800 border border-white/15 hover:border-white/40 rounded-xl transition text-left group shadow-md"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-white/10 text-white group-hover:bg-white group-hover:text-black transition">
                    <Settings className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">Settings & Options</div>
                    <div className="text-xs text-neutral-400">Graphics, shadows, controls & radio</div>
                  </div>
                </div>
                <span className="text-xs font-mono text-neutral-400 group-hover:text-white transition">
                  CONFIGURE →
                </span>
              </button>

              {/* Language */}
              <button
                onClick={() => setView('language')}
                className="w-full flex items-center justify-between px-4 py-3 bg-neutral-900/80 hover:bg-neutral-800 border border-white/15 hover:border-white/40 rounded-xl transition text-left group shadow-md"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-white/10 text-white group-hover:bg-white group-hover:text-black transition">
                    <Globe className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">Language</div>
                    <div className="text-xs text-neutral-400">
                      Current:{' '}
                      {LANGUAGES.find((l) => l.code === selectedLanguage)?.name || 'English (US)'}
                    </div>
                  </div>
                </div>
                <span className="text-xs font-mono text-neutral-400 group-hover:text-white transition">
                  CHANGE →
                </span>
              </button>

              {/* Resume Game */}
              <div className="pt-2">
                <button
                  onClick={onClose}
                  className="w-full py-3 bg-white text-black font-semibold rounded-xl hover:bg-neutral-200 transition text-xs font-mono uppercase tracking-wider flex items-center justify-center gap-2 shadow-xl"
                >
                  <Play className="w-3.5 h-3.5 fill-black" />
                  <span>Back to Game (ESC)</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 2: SINGLEPLAYER WORLD SELECTOR */}
        {view === 'singleplayer' && (
          <div className="p-5 flex flex-col h-full space-y-4 overflow-hidden">
            <div className="text-xs text-neutral-400 font-mono">
              SELECT A WORLD OR CREATE A NEW ONE:
            </div>

            {/* World List (Minecraft-style entries in Roblox clean monochrome styling) */}
            <div className="space-y-2 overflow-y-auto max-h-72 pr-1 scrollbar-thin">
              {worlds.map((w) => {
                const isSelected = selectedWorldId === w.id;
                return (
                  <div
                    key={w.id}
                    onClick={() => setSelectedWorldId(w.id)}
                    className={`p-3.5 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                      isSelected
                        ? 'bg-neutral-800/90 border-white shadow-md ring-1 ring-white/50'
                        : 'bg-neutral-900/60 border-white/10 hover:border-white/30 hover:bg-neutral-900'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center border ${
                          isSelected ? 'bg-white text-black border-white' : 'bg-black text-white border-white/20'
                        }`}
                      >
                        <Boxes className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white">{w.name}</div>
                        <div className="text-xs text-neutral-400 font-mono mt-0.5">
                          {w.mode} Mode · Seed: {w.seed} · {w.lastPlayed}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isSelected && (
                        <span className="text-[10px] font-mono bg-white text-black font-bold px-2 py-0.5 rounded">
                          SELECTED
                        </span>
                      )}
                      {worlds.length > 1 && (
                        <button
                          onClick={(e) => handleDeleteWorld(w.id, e)}
                          className="p-2 text-neutral-400 hover:text-white hover:bg-white/10 rounded-lg transition"
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

            {/* Bottom Controls */}
            <div className="pt-2 grid grid-cols-2 gap-2 border-t border-white/10">
              <button
                onClick={handlePlaySelected}
                className="py-2.5 bg-white text-black font-semibold rounded-xl hover:bg-neutral-200 transition text-xs font-mono uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md"
              >
                <Play className="w-3.5 h-3.5 fill-black" />
                <span>Play Selected World</span>
              </button>

              <button
                onClick={() => setView('create_world')}
                className="py-2.5 bg-neutral-900 text-white border border-white/20 hover:border-white/40 font-semibold rounded-xl hover:bg-neutral-800 transition text-xs font-mono uppercase tracking-wider flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create New World</span>
              </button>

              <button
                onClick={() => setView('main')}
                className="col-span-2 py-2 bg-neutral-900/60 text-neutral-300 hover:text-white border border-white/10 rounded-xl transition text-xs font-mono uppercase tracking-wider"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* VIEW 3: CREATE NEW WORLD */}
        {view === 'create_world' && (
          <form onSubmit={handleCreateWorldSubmit} className="p-5 space-y-4 overflow-y-auto">
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
                className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-900 border border-white/20 text-white font-mono text-sm focus:outline-none focus:border-white"
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
                    className={`py-2 px-3 rounded-xl border text-xs font-mono uppercase tracking-wider transition ${
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
                  className="flex-1 px-3.5 py-2.5 rounded-xl bg-neutral-900 border border-white/20 text-white font-mono text-sm focus:outline-none focus:border-white"
                  placeholder="Random Seed"
                />
                <button
                  type="button"
                  onClick={() =>
                    setNewWorldSeed(String(Math.floor(Math.random() * 900000) + 100000))
                  }
                  className="px-3 py-2 bg-neutral-800 border border-white/20 hover:border-white/40 rounded-xl text-xs font-mono text-white transition"
                  title="Randomize Seed"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-mono uppercase tracking-wider text-neutral-300">
                Terrain Structure Preset
              </label>
              <select
                value={newWorldPreset}
                onChange={(e) => setNewWorldPreset(e.target.value as StructurePreset)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-900 border border-white/20 text-white font-mono text-sm focus:outline-none focus:border-white"
              >
                <option value="empty">Procedural Natural Terrain (Hills & Trees)</option>
                <option value="jenga">Jenga Tower Physics</option>
                <option value="softbody">Soft Body Jelly Showcase</option>
                <option value="castle">Castle Fortress</option>
                <option value="pyramid">Ancient Pyramid</option>
                <option value="cradle">Demolition Arena</option>
                <option value="dominoes">Domino Run</option>
              </select>
            </div>

            <div className="pt-3 grid grid-cols-2 gap-2 border-t border-white/10">
              <button
                type="submit"
                className="py-2.5 bg-white text-black font-semibold rounded-xl hover:bg-neutral-200 transition text-xs font-mono uppercase tracking-wider shadow-md"
              >
                Create World
              </button>

              <button
                type="button"
                onClick={() => setView('singleplayer')}
                className="py-2.5 bg-neutral-900 text-neutral-300 hover:text-white border border-white/10 rounded-xl transition text-xs font-mono uppercase tracking-wider"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* VIEW 4: MULTIPLAYER REALMS */}
        {view === 'multiplayer' && (
          <div className="p-5 space-y-4 overflow-y-auto">
            <div className="text-xs text-neutral-400 font-mono">
              AVAILABLE PEER REALMS & SERVERS:
            </div>

            <div className="space-y-2">
              {[
                { name: 'US-East Creative Realm', ping: '24ms', players: '14/24', mode: 'Creative' },
                { name: 'EU-Central Survival Sandbox', ping: '68ms', players: '32/50', mode: 'Survival' },
                { name: 'Physics Demolition Arena', ping: '42ms', players: '8/16', mode: 'Physics' },
              ].map((server, i) => (
                <div
                  key={i}
                  className="p-3.5 rounded-xl bg-neutral-900/60 border border-white/10 flex items-center justify-between hover:border-white/30 transition cursor-pointer"
                  onClick={() => {
                    alert(`Connecting to ${server.name}... (LAN/Peer-to-Peer ready)`);
                  }}
                >
                  <div>
                    <div className="text-sm font-semibold text-white">{server.name}</div>
                    <div className="text-xs text-neutral-400 font-mono mt-0.5">
                      {server.mode} · {server.players} Players
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-mono text-emerald-400">{server.ping}</span>
                    <button className="block mt-1 px-3 py-1 bg-white text-black text-[11px] font-mono font-bold rounded-lg hover:bg-neutral-200 transition">
                      JOIN
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-2">
              <button
                onClick={() => setView('main')}
                className="w-full py-2.5 bg-neutral-900 text-neutral-300 hover:text-white border border-white/10 rounded-xl transition text-xs font-mono uppercase tracking-wider"
              >
                Back to Menu
              </button>
            </div>
          </div>
        )}

        {/* VIEW 5: LANGUAGE SELECTOR */}
        {view === 'language' && (
          <div className="p-5 space-y-4 overflow-y-auto">
            <div className="text-xs text-neutral-400 font-mono">SELECT INTERFACE LANGUAGE:</div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1 scrollbar-thin">
              {LANGUAGES.map((lang) => {
                const isSelected = selectedLanguage === lang.code;
                return (
                  <button
                    key={lang.code}
                    onClick={() => setSelectedLanguage(lang.code)}
                    className={`p-3 rounded-xl border text-left flex items-center justify-between transition ${
                      isSelected
                        ? 'bg-white text-black border-white font-semibold'
                        : 'bg-neutral-900/60 text-neutral-300 border-white/10 hover:border-white/30 hover:bg-neutral-900'
                    }`}
                  >
                    <span className="text-xs font-mono">{lang.name}</span>
                    {isSelected && <Check className="w-4 h-4 text-black" />}
                  </button>
                );
              })}
            </div>

            <div className="pt-2">
              <button
                onClick={() => setView('main')}
                className="w-full py-2.5 bg-white text-black font-semibold rounded-xl hover:bg-neutral-200 transition text-xs font-mono uppercase tracking-wider"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
