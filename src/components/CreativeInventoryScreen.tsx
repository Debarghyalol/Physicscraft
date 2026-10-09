import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useInventory } from '../inventory/useInventory';
import { HOTBAR_SIZE, InventoryTab, inventory } from '../inventory/InventoryStore';
import { ITEM_DEFS, getItemDef } from '../inventory/items';
import { BG, ItemIcon, StackCount, TextureIcon, usePackImage } from '../inventory/icons';

/**
 * Java-edition creative inventory. Everything is laid out in the texture's own 195x136 pixel
 * space and the whole panel is scaled (nearest-neighbour), so slot coordinates match the PNGs.
 */
const PANEL_W = 195;
const PANEL_H = 136;
const GRID_COLS = 9;
const GRID_ROWS = 5;
const SPR = 'gui/sprites/container/creative_inventory/';
const TAB_BG: Record<InventoryTab, string> = {
  items: 'gui/container/creative_inventory/tab_items',
  search: 'gui/container/creative_inventory/tab_item_search',
  inventory: 'gui/container/creative_inventory/tab_inventory',
};

interface TabDef { id: InventoryTab; row: 'top' | 'bottom'; col: number; icon: string[]; itemIcon?: string; title: string }
const TABS: TabDef[] = [
  { id: 'items', row: 'top', col: 1, icon: [], itemIcon: 'block:1', title: 'Building Blocks' },
  { id: 'search', row: 'top', col: 7, icon: ['item/compass_00', 'item/compass_16'], title: 'Search Items' },
  { id: 'inventory', row: 'bottom', col: 7, icon: ['item/iron_chestplate'], title: 'Survival Inventory' },
];
const tabX = (col: number) => (col === 7 ? PANEL_W - 26 : (col - 1) * 27);

const FONT: React.CSSProperties = { fontFamily: 'Minecraft, monospace' };

const TabButton: React.FC<{ tab: TabDef; selected: boolean; onSelect: () => void; onHover: (t: string | null) => void }> = ({ tab, selected, onSelect, onHover }) => {
  const sprite = usePackImage([`${SPR}tab_${tab.row}_${selected ? 'selected' : 'unselected'}_${tab.col}`], true);
  const x = tabX(tab.col);
  const y = tab.row === 'top' ? -28 : PANEL_H - 4;
  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => onHover(tab.title)}
      onMouseLeave={() => onHover(null)}
      style={{
        position: 'absolute', left: x, top: y, width: 26, height: 32, cursor: 'pointer',
        backgroundColor: sprite ? undefined : selected ? '#c6c6c6' : '#8b8b8b',
        backgroundImage: sprite ? `url(${sprite})` : undefined, backgroundSize: '100% 100%',
        zIndex: selected ? 3 : 1, imageRendering: 'pixelated',
      }}
    >
      <div style={{ position: 'absolute', left: 5, top: tab.row === 'top' ? 6 : 10 }}>
        {tab.itemIcon ? <ItemIcon itemId={tab.itemIcon} size={16} /> : <TextureIcon paths={tab.icon} size={16} />}
      </div>
    </div>
  );
};

const PlayerPreview: React.FC = () => {
  const [url, setUrl] = useState<string | null>(null);
  const skin = usePackImage(['entity/player/wide/steve', 'entity/player/wide/alex', 'entity/player/wide/ari', 'entity/player/wide/kai'], true);
  useEffect(() => {
    if (!skin) return setUrl(null);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 16;
      c.height = 32;
      const g = c.getContext('2d')!;
      g.imageSmoothingEnabled = false;
      const part = (sx: number, sy: number, w: number, h: number, dx: number, dy: number) => g.drawImage(img, sx, sy, w, h, dx, dy, w, h);
      part(4, 20, 4, 12, 4, 20); part(20, 52, 4, 12, 8, 20); // legs
      part(20, 20, 8, 12, 4, 8); part(44, 20, 4, 12, 0, 8); part(36, 52, 4, 12, 12, 8); // body + arms
      part(8, 8, 8, 8, 4, 0); part(40, 8, 8, 8, 4, 0); // head + hat
      setUrl(c.toDataURL());
    };
    img.src = skin;
  }, [skin]);
  if (!url) return null;
  return <div aria-hidden="true" style={{ position: 'absolute', left: 81, top: 10, width: 16, height: 32, backgroundImage: `url(${url})`, ...BG }} />;
};

const Slot: React.FC<{ x: number; y: number; itemId?: string | null; count?: number; onClick: (e: React.MouseEvent) => void; label?: string | null; setTooltip: (t: string | null) => void }> = ({ x, y, itemId, count, onClick, label, setTooltip }) => (
  <div
    className="cc-slot"
    onMouseDown={(e) => {
      e.preventDefault();
      onClick(e);
    }}
    onMouseEnter={() => setTooltip(label ?? null)}
    onMouseLeave={() => setTooltip(null)}
    style={{ position: 'absolute', left: x, top: y, width: 16, height: 16, cursor: 'pointer' }}
  >
    {itemId && <ItemIcon itemId={itemId} size={16} />}
    {itemId && count ? <StackCount count={count} /> : null}
    <div className="cc-hl" style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,.5)', display: 'none', pointerEvents: 'none' }} />
  </div>
);


export const CreativeInventoryScreen: React.FC = () => {
  const inv = useInventory();
  const { open, tab, search, cursor } = inv;
  const [scroll, setScroll] = useState(0); // 0..1
  const [tooltip, setTooltip] = useState<string | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);

  const bg = usePackImage([TAB_BG[tab]], true);
  const scrollerOn = usePackImage([`${SPR}scroller`], true);
  const scrollerOff = usePackImage([`${SPR}scroller_disabled`], true);

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // E / Escape close the screen (E is ignored while typing in the search field).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === 'Escape' || (!typing && e.key.toLowerCase() === 'e')) {
        e.preventDefault();
        inventory.setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open && tab === 'search') searchRef.current?.focus();
  }, [open, tab]);

  const items = useMemo(() => {
    const q = tab === 'search' ? search.trim().toLowerCase() : '';
    return q ? ITEM_DEFS.filter((d) => d.name.toLowerCase().includes(q)) : ITEM_DEFS;
  }, [tab, search]);
  const rows = Math.max(GRID_ROWS, Math.ceil(items.length / GRID_COLS));
  const maxRow = rows - GRID_ROWS;
  const firstRow = maxRow > 0 ? Math.round(scroll * maxRow) : 0;
  useEffect(() => setScroll(0), [search, tab]);

  if (!open) return null;

  const s = (() => {
    const fit = Math.min(vp.w / (PANEL_W + 20), vp.h / (PANEL_H + 72));
    return Math.max(1, Math.min(4, fit >= 2 ? Math.floor(fit) : fit));
  })();

  const toLogical = (e: { clientX: number; clientY: number }) => {
    const r = panelRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
  };
  const setScrollFromY = (y: number) => setScroll(Math.min(1, Math.max(0, (y - 18 - 7.5) / (112 - 15))));
  const btn = (e: React.MouseEvent): 0 | 2 => (e.button === 2 ? 2 : 0);

  const stackSlot = (i: number, x: number, y: number) => {
    const st = inv.slots[i];
    const def = st ? getItemDef(st.id) : null;
    return (
      <Slot
        setTooltip={setTooltip} key={`s${i}`} x={x} y={y} itemId={st?.id} count={st?.count} label={def?.name}
        onClick={(e) => (e.shiftKey ? inventory.quickMove(i) : inventory.clickSlot(i, btn(e)))}
      />
    );
  };

  const cursorDef = cursor ? getItemDef(cursor.id) : null;

  return (
    <div
      className="ui-touch-interactive"
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'linear-gradient(rgba(16,16,16,.75), rgba(16,16,16,.82))', cursor: cursor ? 'none' : 'default', userSelect: 'none', touchAction: 'none' }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      onMouseMove={(e) => panelRef.current && setMouse(toLogical(e))}
      onWheel={(e) => maxRow > 0 && setScroll((v) => Math.min(1, Math.max(0, v + Math.sign(e.deltaY) / maxRow)))}
    >
      <style>{`.cc-slot:hover .cc-hl{display:block !important}`}</style>
      <button
        className="mcpe-action-btn text-white"
        style={{ position: 'fixed', top: 8, right: 8, width: 36, height: 36 }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => inventory.setOpen(false)}
        aria-label="Close inventory"
      >
        ×
      </button>
      <div
        ref={panelRef}
        style={{
          position: 'absolute', left: '50%', top: '50%', width: PANEL_W, height: PANEL_H,
          transform: `translate(-50%, -50%) scale(${s})`, transformOrigin: 'center', imageRendering: 'pixelated', ...FONT,
        }}
      >
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 2,
            backgroundColor: bg ? undefined : '#c6c6c6',
            backgroundImage: bg ? `url(${bg})` : undefined, backgroundSize: '256px 256px', backgroundPosition: '0 0', backgroundRepeat: 'no-repeat',
          }}
        />
        {TABS.map((t) => (
          <TabButton key={t.id} tab={t} selected={tab === t.id} onSelect={() => inventory.setTab(t.id)} onHover={setTooltip} />
        ))}

        <div style={{ position: 'absolute', inset: 0, zIndex: 4 }}>
          {/* Title */}
          <div style={{ position: 'absolute', left: 8, top: 6, fontSize: 8, lineHeight: '8px', color: '#404040', whiteSpace: 'nowrap', display: tab === 'search' || tab === 'inventory' ? 'none' : undefined }}>
            {TABS.find((t) => t.id === tab)!.title}
          </div>

          {tab === 'search' && (
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => inventory.setSearch(e.target.value)}
              spellCheck={false}
              maxLength={32}
              onMouseDown={(e) => e.stopPropagation()}
              style={{ position: 'absolute', left: 82, top: 6, width: 86, height: 9, padding: 0, background: 'transparent', border: 0, outline: 0, color: '#fff', fontSize: 8, lineHeight: '9px', ...FONT }}
            />
          )}

          {tab !== 'inventory' && (
            <>
              {Array.from({ length: GRID_ROWS * GRID_COLS }, (_, n) => {
                const def = items[(firstRow + Math.floor(n / GRID_COLS)) * GRID_COLS + (n % GRID_COLS)];
                const x = 9 + (n % GRID_COLS) * 18, y = 18 + Math.floor(n / GRID_COLS) * 18;
                return (
                  <Slot
                    setTooltip={setTooltip} key={`g${n}`} x={x} y={y} itemId={def?.id} label={def?.name}
                    onClick={(e) => {
                      if (!def) return;
                      if (cursor && !e.shiftKey && cursor.id !== def.id) inventory.clearCursor();
                      else inventory.pickFromCreative(def, btn(e), e.shiftKey);
                    }}
                  />
                );
              })}
              <div
                style={{ position: 'absolute', left: 175, top: 18, width: 12, height: 112, touchAction: 'none' }}
                onPointerDown={(e) => {
                  if (maxRow <= 0) return;
                  dragging.current = true;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setScrollFromY(toLogical(e).y);
                }}
                onPointerMove={(e) => dragging.current && setScrollFromY(toLogical(e).y)}
                onPointerUp={() => (dragging.current = false)}
                onPointerCancel={() => (dragging.current = false)}
              >
                <div
                  style={{
                    position: 'absolute', left: 0, top: maxRow > 0 ? Math.round(scroll * 97) : 0, width: 12, height: 15,
                    backgroundColor: (maxRow > 0 ? scrollerOn : scrollerOff) ? undefined : '#8b8b8b',
                    backgroundImage: `url(${maxRow > 0 ? scrollerOn : scrollerOff})`, backgroundSize: '100% 100%',
                  }}
                />
              </div>
            </>
          )}

          {tab === 'inventory' && (
            <>
              <PlayerPreview />
              {Array.from({ length: 27 }, (_, n) => stackSlot(9 + n, 9 + (n % 9) * 18, 54 + Math.floor(n / 9) * 18))}
              <Slot setTooltip={setTooltip} x={173} y={112} itemId={null} label="Delete Item" onClick={() => inventory.clearCursor()} />
            </>
          )}

          {Array.from({ length: HOTBAR_SIZE }, (_, i) => stackSlot(i, 9 + i * 18, 112))}
        </div>

        {/* Tooltip + carried stack (inside the scaled panel so they match its pixel size) */}
        {tooltip && !cursor && (
          <div
            style={{
              position: 'absolute', left: mouse.x + 8, top: mouse.y - 16, zIndex: 20, pointerEvents: 'none', whiteSpace: 'nowrap',
              padding: '2px 3px', fontSize: 8, lineHeight: '8px', color: '#fff', background: 'rgba(16,0,16,.94)',
              boxShadow: '0 0 0 1px rgba(80,0,255,.45)',
            }}
          >
            {tooltip}
          </div>
        )}
        {cursor && cursorDef && (
          <div style={{ position: 'absolute', left: mouse.x - 8, top: mouse.y - 8, width: 16, height: 16, zIndex: 30, pointerEvents: 'none' }}>
            <ItemIcon itemId={cursor.id} size={16} />
            <StackCount count={cursor.count} />
          </div>
        )}
      </div>
    </div>
  );
};
