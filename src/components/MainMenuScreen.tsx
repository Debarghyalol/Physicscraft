import React, { useEffect, useMemo, useState } from 'react';
import { Accessibility, ChevronLeft, Globe, Languages, Trash2 } from 'lucide-react';
import { deleteSavedWorld, listSavedWorlds, saveWorld } from '../persistence/WorldSaveStore';
import { StructurePreset } from '../types/physics';

export interface WorldSave {
  id: string;
  name: string;
  mode: 'Survival' | 'Creative' | 'Physics';
  seed: number;
  preset: StructurePreset;
  lastPlayed: string;
  thumbnail?: string;
}
interface ServerEntry { id: string; name: string; address: string; resourcePacks: 'enabled' | 'prompt' | 'disabled'; }
type MenuView = 'title' | 'singleplayer' | 'create_world' | 'multiplayer' | 'language' | 'accessibility';
type ServerForm = { id?: string; name: string; address: string; resourcePacks: 'enabled' | 'prompt' | 'disabled' };

export interface MainMenuScreenProps {
  onPlayWorld: (world: WorldSave) => void;
  onOpenSettings: () => void;
}

const DEFAULT_WORLDS: WorldSave[] = [
  { id: 'world-1', name: 'New World', mode: 'Survival', seed: 133742, preset: 'empty', lastPlayed: 'Today' },
  { id: 'world-2', name: 'Creative Flatlands', mode: 'Creative', seed: 849201, preset: 'empty', lastPlayed: 'Yesterday' },
];
const SPLASH_TEXTS = ['Now with Rapier 3D physics!', 'Procedural infinite chunks!', '100% Java Edition feel!', 'Pixel art textures!', 'Made with Three.js!', 'Watch out for Creepers!'];
const SERVERS_KEY = 'physicscraft-multiplayer-servers';
const loadServers = (): ServerEntry[] => {
  try { const data = JSON.parse(localStorage.getItem(SERVERS_KEY) || '[]'); return Array.isArray(data) ? data : []; }
  catch { return []; }
};

const Btn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className = '', ...props }) => (
  <button {...props} className={`mc-button min-h-9 px-3 py-2 text-xs ${className}`} />
);

export const MainMenuScreen: React.FC<MainMenuScreenProps> = ({ onPlayWorld, onOpenSettings }) => {
  const [view, setView] = useState<MenuView>('title');
  const [worlds, setWorlds] = useState<WorldSave[]>(DEFAULT_WORLDS);
  const [selectedWorldId, setSelectedWorldId] = useState(DEFAULT_WORLDS[0].id);
  const [worldSearch, setWorldSearch] = useState('');
  const [newWorldName, setNewWorldName] = useState('New World');
  const [newWorldMode, setNewWorldMode] = useState<'Survival' | 'Creative'>('Survival');
  const [newWorldSeed, setNewWorldSeed] = useState(() => String(Math.floor(Math.random() * 900000) + 100000));
  const [createTab, setCreateTab] = useState<'game' | 'world'>('game');
  const [generateStructures, setGenerateStructures] = useState(true);
  const [bonusChest, setBonusChest] = useState(false);
  const [servers, setServers] = useState<ServerEntry[]>(loadServers);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [serverForm, setServerForm] = useState<ServerForm | null>(null);
  const [directConnect, setDirectConnect] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<WorldSave | null>(null);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [notice, setNotice] = useState('');
  const [splashText] = useState(() => SPLASH_TEXTS[Math.floor(Math.random() * SPLASH_TEXTS.length)]);
  const [selectedLanguage, setSelectedLanguage] = useState(() => localStorage.getItem('physicscraft-language') || 'English (US)');
  const [largeUi, setLargeUi] = useState(() => localStorage.getItem('physicscraft-large-ui') === 'true');
  const [highContrast, setHighContrast] = useState(() => localStorage.getItem('physicscraft-high-contrast') === 'true');

  useEffect(() => {
    listSavedWorlds().then((saved) => setWorlds((current) => {
      const byId = new Map(current.map((world) => [world.id, world]));
      for (const world of saved) byId.set(world.id, world);
      return [...byId.values()];
    })).catch((error) => console.warn('Could not load saved world list', error));
  }, []);
  useEffect(() => { localStorage.setItem(SERVERS_KEY, JSON.stringify(servers)); }, [servers]);
  useEffect(() => { localStorage.setItem('physicscraft-language', selectedLanguage); }, [selectedLanguage]);
  useEffect(() => { localStorage.setItem('physicscraft-large-ui', String(largeUi)); }, [largeUi]);
  useEffect(() => { localStorage.setItem('physicscraft-high-contrast', String(highContrast)); }, [highContrast]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const selectedWorld = worlds.find((world) => world.id === selectedWorldId);
  const filteredWorlds = useMemo(() => worlds.filter((world) => world.name.toLowerCase().includes(worldSearch.toLowerCase())), [worlds, worldSearch]);
  const selectedServer = servers.find((server) => server.id === selectedServerId);
  const panorama = worlds.find((world) => world.thumbnail)?.thumbnail;

  const playSelected = () => { if (selectedWorld) onPlayWorld(selectedWorld); };
  const createWorld = (event: React.FormEvent) => {
    event.preventDefault();
    const parsedSeed = Number.parseInt(newWorldSeed, 10);
    const world: WorldSave = {
      id: `world_${Date.now()}`,
      name: newWorldName.trim() || 'New World',
      mode: newWorldMode,
      seed: Number.isFinite(parsedSeed) ? parsedSeed : Math.floor(Math.random() * 900000),
      preset: 'empty',
      lastPlayed: 'Just now',
    };
    setWorlds((list) => [world, ...list]);
    setSelectedWorldId(world.id);
    void saveWorld(world).catch((error) => console.warn('Could not save new world metadata', error));
    onPlayWorld(world);
  };
  const deleteWorld = (id: string) => {
    if (worlds.length <= 1) return;
    const next = worlds.filter((world) => world.id !== id);
    setWorlds(next);
    void deleteSavedWorld(id).catch((error) => console.warn('Could not delete world', error));
    if (selectedWorldId === id) setSelectedWorldId(next[0].id);
  };
  const saveServer = (event: React.FormEvent) => {
    event.preventDefault();
    if (!serverForm?.address.trim()) return;
    if (directConnect) {
      setServerForm(null);
      setDirectConnect(false);
      announceUnsupportedConnection();
      return;
    }
    const next: ServerEntry = { id: serverForm.id || `server_${Date.now()}`, name: serverForm.name.trim() || serverForm.address.trim(), address: serverForm.address.trim(), resourcePacks: serverForm.resourcePacks || 'prompt' };
    setServers((list) => serverForm.id ? list.map((item) => item.id === next.id ? next : item) : [...list, next]);
    setSelectedServerId(next.id);
    setServerForm(null);
  };
  const announceUnsupportedConnection = () => setNotice('Server entries are saved. Joining Minecraft servers is not supported by Physicscraft yet.');

  const title = view === 'singleplayer' ? 'Select World' : view === 'create_world' ? 'Create New World' : view === 'multiplayer' ? 'Play Multiplayer' : view === 'language' ? 'Language' : view === 'accessibility' ? 'Accessibility Settings' : '';
  const back = () => setView(view === 'create_world' ? 'singleplayer' : 'title');

  return (
    <div className={`fixed inset-0 z-50 flex flex-col mc-dirt-bg select-none text-white font-mono overflow-hidden ${highContrast ? 'mc-menu-high-contrast' : ''} ${largeUi ? 'mc-menu-large' : ''}`} style={{ backgroundImage: `linear-gradient(rgba(0,0,0,.50),rgba(0,0,0,.62)),url(${panorama || '/textures/gui/title/background/physicscraft_panorama.svg'})`, backgroundSize: 'cover', backgroundPosition: 'center', animation: 'mc-panorama-drift 70s linear infinite alternate' }}>
      <div className="absolute inset-0 bg-black/50 pointer-events-none" />
      {view === 'title' && <div className="relative z-10 flex h-full w-full flex-col items-center justify-between px-4 py-5 sm:px-8 sm:py-8">
        <div className="relative mt-[5vh] flex flex-col items-center">
          <img src="/textures/gui/minecraft_logo.png" alt="Minecraft Java Edition" className="w-72 sm:w-[420px] h-auto drop-shadow-[0_8px_16px_rgba(0,0,0,0.85)]" style={{ imageRendering: 'pixelated' }} />
          <div className="absolute -bottom-2 -right-4 sm:right-0 mc-splash whitespace-nowrap text-xs font-bold tracking-wide text-[#ffff55] drop-shadow-[2px_2px_0px_#3f3f00]">{splashText}</div>
        </div>
        <div className="my-auto flex w-full max-w-[360px] flex-col items-center gap-2">
          <Btn className="w-full" onClick={() => setView('singleplayer')}>Singleplayer</Btn>
          <Btn className="w-full" onClick={() => setView('multiplayer')}>Multiplayer</Btn>
          <Btn className="w-full opacity-60" title="Realms is not available in Physicscraft" onClick={() => setNotice('Realms is not available in Physicscraft.')}>Minecraft Realms</Btn>
          <div className="flex w-full gap-2 pt-1">
            <Btn className="flex-1" onClick={onOpenSettings}>Options...</Btn>
            <Btn className="flex-1" onClick={() => setNotice('You can close this tab to quit Physicscraft.')}>Quit Game</Btn>
          </div>
          <div className="flex w-full justify-end gap-2 pt-1">
            <Btn className="min-h-8 px-2 py-1" aria-label="Language" title="Language" onClick={() => setView('language')}><Languages size={16} /></Btn>
            <Btn className="min-h-8 px-2 py-1" aria-label="Accessibility" title="Accessibility" onClick={() => setView('accessibility')}><Accessibility size={16} /></Btn>
          </div>
        </div>
        <footer className="flex w-full items-end justify-between gap-3 text-[10px] text-[#bbb] drop-shadow-[1px_1px_0_#000]">
          <span>Physicscraft · Java-style menu</span><span className="text-right">Based on Minecraft 26.1 screen flow</span>
        </footer>
      </div>}

      {view !== 'title' && <div className="relative z-10 mx-auto flex h-full w-full max-w-4xl flex-col p-3 sm:p-5">
        <header className="mb-3 flex shrink-0 items-center justify-between border-b-2 border-black/50 bg-black/40 px-4 py-3">
          <h1 className="text-base font-bold text-white drop-shadow-[2px_2px_0_#222] sm:text-lg">{title}</h1>
          <Btn className="min-h-8 px-2 py-1" onClick={back}><ChevronLeft size={16} /> Back</Btn>
        </header>

        {view === 'singleplayer' && <>
          <label className="mb-2 flex shrink-0 items-center gap-2 text-xs text-neutral-300">Search worlds
            <input value={worldSearch} onChange={(event) => setWorldSearch(event.target.value)} className="min-w-0 flex-1 border-2 border-[#555] bg-black/80 px-2 py-1.5 text-white outline-none focus:border-white" placeholder="World name" />
          </label>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-black/30 p-2">
            {filteredWorlds.map((world) => <div key={world.id} onClick={() => setSelectedWorldId(world.id)} onDoubleClick={playSelected} className={`flex cursor-pointer items-center justify-between border-2 p-3 ${world.id === selectedWorldId ? 'border-white bg-black/80' : 'border-[#333] bg-black/50 hover:border-[#777]'}`}>
              <div className="flex min-w-0 items-center gap-3"><div className="h-12 w-12 shrink-0 overflow-hidden border border-neutral-600 bg-gradient-to-b from-[#66a342] to-[#6e4828]">{world.thumbnail ? <img src={world.thumbnail} alt={`${world.name} screenshot`} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-2xl">▧</div>}</div><div className="min-w-0"><div className="truncate text-sm font-bold">{world.name}</div><div className="mt-1 text-[10px] text-neutral-400">{world.mode} · Seed: {world.seed} · {world.lastPlayed}</div></div></div>
            </div>)}
            {filteredWorlds.length === 0 && <div className="p-8 text-center text-sm text-neutral-400">No worlds found.</div>}
          </div>
          <div className="mt-3 grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-5">
            <Btn disabled={!selectedWorld} onClick={playSelected}>Play Selected</Btn>
            <Btn onClick={() => { setCreateTab('game'); setView('create_world'); }}>Create New</Btn>
            <Btn disabled={!selectedWorld} onClick={() => setNotice('World editing is not available yet.')}>Edit</Btn>
            <Btn disabled={!selectedWorld} onClick={() => { if (selectedWorld) { setPendingDelete(selectedWorld); setDeleteConfirmed(false); } }}>Delete</Btn>
            <Btn disabled={!selectedWorld} onClick={() => { if (selectedWorld) onPlayWorld({ ...selectedWorld, id: `world_${Date.now()}`, name: `${selectedWorld.name} (Copy)` }); }}>Re-create</Btn>
          </div>
        </>}

        {view === 'create_world' && <form onSubmit={createWorld} className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col gap-4 overflow-y-auto p-2 sm:p-6">
          <div className="flex gap-2 border-b border-white/20 pb-2"><button type="button" onClick={() => setCreateTab('game')} className={`px-3 pb-2 text-sm ${createTab === 'game' ? 'border-b-2 border-white' : 'text-neutral-500'}`}>Game</button><button type="button" onClick={() => setCreateTab('world')} className={`px-3 pb-2 text-sm ${createTab === 'world' ? 'border-b-2 border-white' : 'text-neutral-500'}`}>World</button></div>
          {createTab === 'game' ? <>
            <label className="text-xs text-neutral-300">World Name<input value={newWorldName} onChange={(event) => setNewWorldName(event.target.value)} maxLength={32} className="mt-1 w-full border-2 border-[#555] bg-black px-3 py-2 text-white outline-none focus:border-white" /></label>
            <div><span className="text-xs text-neutral-300">Game Mode</span><Btn type="button" className="mt-1 w-full" onClick={() => setNewWorldMode((mode) => mode === 'Survival' ? 'Creative' : 'Survival')}>Game Mode: {newWorldMode} · Click to change</Btn><p className="mt-1 text-[10px] text-neutral-500">{newWorldMode === 'Survival' ? 'Explore and build in Survival mode.' : 'Build freely in Creative mode.'}</p></div>
          </> : <>
            <label className="text-xs text-neutral-300">Seed for the World Generator<input value={newWorldSeed} onChange={(event) => setNewWorldSeed(event.target.value)} className="mt-1 w-full border-2 border-[#555] bg-black px-3 py-2 text-white outline-none focus:border-white" placeholder="Leave blank for random seed" /></label>
            <label className="flex items-center gap-2 border border-white/15 p-3 text-sm"><input type="checkbox" checked={generateStructures} onChange={(event) => setGenerateStructures(event.target.checked)} />Generate Structures</label>
            <label className="flex items-center gap-2 border border-white/15 p-3 text-sm"><input type="checkbox" checked={bonusChest} onChange={(event) => setBonusChest(event.target.checked)} />Bonus Chest</label>
            <p className="text-[10px] text-neutral-500">Structure and bonus-chest generation controls are saved in the UI but not yet applied by the world generator.</p>
          </>}
          <div className="mt-auto flex gap-2 pt-3"><Btn type="submit" className="flex-1">Create New World</Btn><Btn type="button" className="flex-1" onClick={() => setView('singleplayer')}>Cancel</Btn></div>
        </form>}

        {view === 'multiplayer' && <>
          <div className="mb-2 text-center text-[11px] text-neutral-400">Saved servers for this browser</div>
          <div className="min-h-0 flex-1 overflow-y-auto border-2 border-black/60 bg-black/45 p-2">
            {servers.map((server) => <div key={server.id} onClick={() => setSelectedServerId(server.id)} onDoubleClick={announceUnsupportedConnection} className={`mb-2 flex cursor-pointer items-center justify-between border-2 p-3 ${selectedServerId === server.id ? 'border-white bg-black/80' : 'border-[#333] bg-black/40 hover:border-[#777]'}`}>
              <div className="flex items-center gap-3"><Globe className="text-neutral-400" size={22} /><div><div className="text-sm font-bold">{server.name}</div><div className="text-[10px] text-neutral-400">{server.address}</div></div></div><span className="text-[10px] text-neutral-500">Saved</span>
            </div>)}
            {servers.length === 0 && <div className="flex h-full min-h-40 items-center justify-center text-center text-xs text-neutral-400">No servers added.<br />Use Add Server to save an address.</div>}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Btn disabled={!selectedServer} onClick={announceUnsupportedConnection}>Join Server</Btn>
            <Btn onClick={() => { setDirectConnect(true); setServerForm({ name: '', address: '', resourcePacks: 'prompt' }); }}>Direct Connect</Btn>
            <Btn onClick={() => { setDirectConnect(false); setServerForm({ name: '', address: '', resourcePacks: 'prompt' }); }}>Add Server</Btn>
            <Btn disabled={!selectedServer} onClick={() => selectedServer && setServerForm({ ...selectedServer, resourcePacks: selectedServer.resourcePacks || 'prompt' })}>Edit</Btn>
            <Btn disabled={!selectedServer} onClick={() => { setServers((list) => list.filter((server) => server.id !== selectedServerId)); setSelectedServerId(null); }}>Delete</Btn>
            <Btn onClick={() => setNotice('Server list refreshed. Physicscraft does not probe Minecraft servers.')}>Refresh</Btn>
            <Btn onClick={() => setView('title')}>Done</Btn>
          </div>
        </>}

        {view === 'language' && <div className="mx-auto w-full max-w-xl flex-1 overflow-y-auto border-2 border-black/50 bg-black/50 p-3">
          <p className="mb-3 text-xs text-neutral-400">Choose a display language. The menu stores your selection; translations are not yet included.</p>
          {['English (US)', 'English (UK)', 'Deutsch', 'Español', 'Français', '日本語'].map((language) => <button key={language} onClick={() => setSelectedLanguage(language)} className={`mb-2 w-full border-2 p-3 text-left text-sm ${selectedLanguage === language ? 'border-white bg-black/70' : 'border-[#444] bg-black/40 hover:border-[#888]'}`}>{language}{selectedLanguage === language ? ' ✓' : ''}</button>)}
        </div>}

        {view === 'accessibility' && <div className="mx-auto w-full max-w-xl flex-1 border-2 border-black/50 bg-black/50 p-4">
          <p className="mb-4 text-xs text-neutral-400">Accessibility display preferences</p>
          <label className="mb-3 flex items-center justify-between border border-white/15 p-3 text-sm">Larger menu text<input type="checkbox" checked={largeUi} onChange={(event) => setLargeUi(event.target.checked)} /></label>
          <label className="flex items-center justify-between border border-white/15 p-3 text-sm">Higher menu contrast<input type="checkbox" checked={highContrast} onChange={(event) => setHighContrast(event.target.checked)} /></label>
        </div>}
      </div>}

      {pendingDelete && <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-4"><div className="w-full max-w-md border-2 border-[#aaa] bg-[#202020] p-5 shadow-2xl"><h2 className="mb-3 text-center text-base font-bold">Delete World</h2><p className="mb-4 text-center text-sm">Delete <strong>{pendingDelete.name}</strong>?</p><label className="mb-5 flex items-center gap-2 text-xs text-neutral-300"><input type="checkbox" checked={deleteConfirmed} onChange={(event) => setDeleteConfirmed(event.target.checked)} />I understand this world will be permanently deleted.</label><div className="flex gap-2"><Btn disabled={!deleteConfirmed} className="flex-1" onClick={() => { deleteWorld(pendingDelete.id); setPendingDelete(null); }}>Delete</Btn><Btn className="flex-1" onClick={() => setPendingDelete(null)}>Cancel</Btn></div></div></div>}

      {serverForm && <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-4"><form onSubmit={saveServer} className="w-full max-w-md border-2 border-[#aaa] bg-[#202020] p-5 shadow-2xl">
        <h2 className="mb-4 text-center text-base font-bold">{directConnect ? 'Direct Connection' : serverForm.id ? 'Edit Server Info' : 'Add Server'}</h2>
        <label className="mb-3 block text-xs text-neutral-300">Server Name<input autoFocus value={serverForm.name} onChange={(event) => setServerForm({ ...serverForm, name: event.target.value })} className="mt-1 w-full border-2 border-[#555] bg-black px-2 py-2 text-sm text-white outline-none focus:border-white" /></label>
        <label className="mb-4 block text-xs text-neutral-300">Server Address<input value={serverForm.address} onChange={(event) => setServerForm({ ...serverForm, address: event.target.value })} className="mt-1 w-full border-2 border-[#555] bg-black px-2 py-2 text-sm text-white outline-none focus:border-white" placeholder="example.com:25565" /></label>
        <label className="mb-4 flex items-center justify-between text-xs text-neutral-300">Server Resource Packs<select value={serverForm.resourcePacks || 'prompt'} onChange={(event) => setServerForm({ ...serverForm, resourcePacks: event.target.value as ServerEntry['resourcePacks'] })} className="border-2 border-[#555] bg-black px-2 py-1.5 text-white"><option value="enabled">Enabled</option><option value="prompt">Prompt</option><option value="disabled">Disabled</option></select></label>
        <p className="mb-4 text-[10px] text-amber-300">Server addresses are stored locally. Connecting to Minecraft servers is not supported yet.</p>
        <div className="flex gap-2"><Btn type="submit" className="flex-1">Done</Btn><Btn type="button" className="flex-1" onClick={() => setServerForm(null)}>Cancel</Btn></div>
      </form></div>}

      <style>{'@keyframes mc-panorama-drift{from{background-position:50% 50%}to{background-position:58% 46%}}'}</style>
      {notice && <div role="status" className="absolute bottom-5 left-1/2 z-30 -translate-x-1/2 border-2 border-[#aaa] bg-[#202020] px-4 py-3 text-center text-xs shadow-xl">{notice}</div>
      {highContrast && <style>{'.mc-menu-high-contrast .mc-button{filter:contrast(1.35)}'}</style>}
      {largeUi && <style>{'.mc-menu-large .mc-button{font-size:15px}.mc-menu-large label,.mc-menu-large p{font-size:14px}'}</style>}
    </div>
  );
};
