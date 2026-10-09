import { useSyncExternalStore } from 'react';
import { inventory } from './InventoryStore';

/** Re-render when the inventory changes; returns the singleton. */
export function useInventory() {
  useSyncExternalStore(inventory.subscribe, inventory.getVersion);
  return inventory;
}
