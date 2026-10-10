import { VoxelType } from '../types/physics';
import { getItemDef, blockItemId, ItemDef, ItemStack } from './items';
import type { MusicDiscId } from '../audio/MusicEngine';

export type InventoryTab = 'items' | 'search' | 'inventory';

export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36; // 0-8 hotbar, 9-35 main inventory

type Listener = () => void;

/**
 * Single source of truth for the player's items. Creative mode: placing blocks never consumes
 * them. UI reads it through useInventory(); gameplay code reads `held` directly.
 */
class InventoryStore {
  slots: (ItemStack | null)[] = Array(INVENTORY_SIZE).fill(null);
  selected = 0;
  cursor: ItemStack | null = null;
  open = false;
  tab: InventoryTab = 'items';
  search = '';
  version = 0;
  /** Last disc held, so a jukebox still plays something when a block is in hand. */
  lastDisc: MusicDiscId = '13';
  private listeners = new Set<Listener>();

  constructor() {
    [VoxelType.GRASS, VoxelType.DIRT, VoxelType.STONE, VoxelType.WOOD, VoxelType.LEAVES, VoxelType.SAND, VoxelType.COBBLESTONE, VoxelType.GLASS, VoxelType.GLOWSTONE]
      .forEach((v, i) => (this.slots[i] = { id: blockItemId(v), count: 64 }));
    // A few extras in the main inventory so the tools are within reach from the start.
    this.slots[9] = { id: 'tool:flint_and_steel', count: 1 };
    this.slots[10] = { id: 'disc:13', count: 1 };
    this.slots[11] = { id: blockItemId(VoxelType.TNT), count: 64 };
    this.slots[12] = { id: blockItemId(VoxelType.JUKEBOX), count: 64 };
    ['wooden_sword', 'stone_sword', 'iron_sword', 'diamond_sword', 'iron_axe', 'iron_pickaxe', 'iron_shovel', 'iron_hoe', 'netherite_sword'].forEach(
      (n, i) => (this.slots[13 + i] = { id: `tool:${n}`, count: 1 })
    );
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  private emit() {
    const h = this.held;
    if (h?.disc) this.lastDisc = h.disc;
    this.version++;
    this.listeners.forEach((l) => l());
  }

  get held(): ItemDef | null {
    const s = this.slots[this.selected];
    return s ? getItemDef(s.id) ?? null : null;
  }

  select(i: number) {
    if (i < 0 || i >= HOTBAR_SIZE || i === this.selected) return;
    this.selected = i;
    this.emit();
  }

  setOpen(open: boolean) {
    if (this.open === open) return;
    this.open = open;
    if (!open) this.cursor = null; // creative: whatever is on the cursor just vanishes
    this.emit();
  }
  toggle() {
    this.setOpen(!this.open);
  }
  setTab(tab: InventoryTab) {
    this.tab = tab;
    this.emit();
  }
  setSearch(text: string) {
    this.search = text;
    this.emit();
  }

  /** Click a real slot with the cursor: swap, or merge identical stacks. */
  clickSlot(i: number, button: 0 | 2 = 0) {
    const slot = this.slots[i];
    const cur = this.cursor;
    if (button === 2 && cur) {
      // right click: drop a single item
      const def = getItemDef(cur.id)!;
      if (!slot) this.slots[i] = { id: cur.id, count: 1 };
      else if (slot.id === cur.id && slot.count < def.maxStack) slot.count++;
      else return;
      if (--cur.count <= 0) this.cursor = null;
    } else if (button === 2 && slot) {
      // right click on a stack with an empty cursor: take half
      const take = Math.ceil(slot.count / 2);
      this.cursor = { id: slot.id, count: take };
      slot.count -= take;
      if (slot.count <= 0) this.slots[i] = null;
    } else if (cur && slot && cur.id === slot.id) {
      const max = getItemDef(cur.id)!.maxStack;
      const moved = Math.min(max - slot.count, cur.count);
      slot.count += moved;
      cur.count -= moved;
      if (cur.count <= 0) this.cursor = null;
    } else {
      this.slots[i] = cur;
      this.cursor = slot;
    }
    this.emit();
  }

  /** Click an item in the creative grid. */
  pickFromCreative(def: ItemDef, button: 0 | 2 = 0, shift = false) {
    const count = button === 2 ? 1 : def.maxStack;
    if (shift) {
      this.addToInventory({ id: def.id, count: def.maxStack });
    } else if (this.cursor && this.cursor.id === def.id) {
      this.cursor.count = Math.min(def.maxStack, this.cursor.count + (button === 2 ? 1 : def.maxStack));
    } else {
      this.cursor = { id: def.id, count };
    }
    this.emit();
  }

  /** Clicking the grid or delete slot while carrying something puts it away. */
  clearCursor() {
    if (!this.cursor) return;
    this.cursor = null;
    this.emit();
  }

  /** Quick-move: shift-click a slot to the other half (hotbar <-> inventory). */
  quickMove(i: number) {
    const s = this.slots[i];
    if (!s) return;
    this.slots[i] = null;
    const range = i < HOTBAR_SIZE ? [HOTBAR_SIZE, INVENTORY_SIZE] : [0, HOTBAR_SIZE];
    if (!this.addToInventory(s, range[0], range[1])) this.slots[i] = s;
    this.emit();
  }

  private addToInventory(stack: ItemStack, from = 0, to = INVENTORY_SIZE): boolean {
    const max = getItemDef(stack.id)!.maxStack;
    for (let i = from; i < to && stack.count > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === stack.id && s.count < max) {
        const m = Math.min(max - s.count, stack.count);
        s.count += m;
        stack.count -= m;
      }
    }
    for (let i = from; i < to && stack.count > 0; i++) {
      if (!this.slots[i]) {
        this.slots[i] = { id: stack.id, count: stack.count };
        stack.count = 0;
      }
    }
    return stack.count <= 0;
  }
}

export const inventory = new InventoryStore();
if (import.meta.env.DEV) (window as any).__inventory = inventory; // dev-only debugging hook
