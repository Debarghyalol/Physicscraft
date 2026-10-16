import type { StructurePreset } from '../types/physics';

export interface SavedWorldMeta {
  id: string;
  name: string;
  mode: 'Survival' | 'Creative' | 'Physics';
  seed: number;
  preset: StructurePreset;
  lastPlayed: string;
  thumbnail?: string;
}

export interface SavedChunk {
  cx: number;
  cz: number;
  blocks: Uint8Array;
  fluid: Uint8Array;
}

export interface StoredWorld extends SavedWorldMeta {
  playerPosition?: [number, number, number];
  inventorySlots?: ({ id: string; count: number } | null)[];
  inventorySelected?: number;
  chunks?: SavedChunk[];
}

const DB_NAME = 'physicscraft-world-saves';
const STORE_NAME = 'worlds';
let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open world save database'));
  });
  return dbPromise;
}

export async function listSavedWorlds(): Promise<SavedWorldMeta[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result as StoredWorld[]).map(({ id, name, mode, seed, preset, lastPlayed, thumbnail }) => ({ id, name, mode, seed, preset, lastPlayed, thumbnail })));
    request.onerror = () => reject(request.error ?? new Error('Could not list saved worlds'));
  });
}

export async function loadSavedWorld(id: string): Promise<StoredWorld | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result as StoredWorld | undefined);
    request.onerror = () => reject(request.error ?? new Error('Could not load world save'));
  });
}

export async function saveWorld(world: StoredWorld): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(world);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Could not save world'));
  });
}

export async function deleteSavedWorld(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Could not delete world save'));
  });
}
