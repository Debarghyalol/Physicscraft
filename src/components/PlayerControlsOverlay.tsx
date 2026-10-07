import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PlayerInput } from '../player/PlayerController';
import { CameraViewMode, VoxelType } from '../types/physics';
import { Camera, Wrench } from 'lucide-react';
import { resourcePacks } from '../resourcepack/ResourcePackManager';

export interface PlayerControlsOverlayProps {
  onInputUpdate: (input: PlayerInput) => void;
  onLookDelta: (deltaYaw: number, deltaPitch: number) => void;
  onAimTouchCoords?: (coords: { x: number; y: number } | null) => void;
  onActionMine: (coords?: { x: number; y: number }) => void;
  onActionPlace: (coords?: { x: number; y: number }) => void;
  onToggleViewMode: () => void;
  isFlying?: boolean;
  viewMode: CameraViewMode;
  selectedVoxel: VoxelType;
  onSelectVoxel: (v: VoxelType) => void;
  onTogglePhysicsMaker?: () => void;
  isPhysicsMakerActive?: boolean;
}

const HOTBAR_TEXTURES: Record<VoxelType, { paths: string[]; fallback: string }> = {
  [VoxelType.GRASS]: { paths: ['block/grass_block_side', 'block/grass_block'], fallback: 'grass_block_side' },
  [VoxelType.DIRT]: { paths: ['block/dirt'], fallback: 'dirt' },
  [VoxelType.STONE]: { paths: ['block/stone'], fallback: 'stone' },
  [VoxelType.WOOD]: { paths: ['block/oak_log', 'block/oak_log_side'], fallback: 'oak_log' },
  [VoxelType.LEAVES]: { paths: ['block/oak_leaves'], fallback: 'oak_leaves' },
  [VoxelType.SAND]: { paths: ['block/sand'], fallback: 'sand' },
  [VoxelType.COBBLESTONE]: { paths: ['block/cobblestone'], fallback: 'cobblestone' },
  [VoxelType.GLASS]: { paths: ['block/glass'], fallback: 'glass' },
  [VoxelType.GLOWSTONE]: { paths: ['block/glowstone'], fallback: 'glowstone' },
  [VoxelType.TNT]: { paths: ['block/tnt_side', 'block/tnt'], fallback: 'tnt_side' },
};
export const HOTBAR_ITEMS: { type: VoxelType; name: string }[] = [
  { type: VoxelType.GRASS, name: 'Grass Block' },
  { type: VoxelType.DIRT, name: 'Dirt' },
  { type: VoxelType.STONE, name: 'Stone' },
  { type: VoxelType.WOOD, name: 'Oak Wood' },
  { type: VoxelType.LEAVES, name: 'Oak Leaves' },
  { type: VoxelType.SAND, name: 'Sand' },
  { type: VoxelType.COBBLESTONE, name: 'Cobblestone' },
  { type: VoxelType.GLASS, name: 'Glass' },
  { type: VoxelType.GLOWSTONE, name: 'Glowstone' },
];

/**
 * Pixelated 3D Isometric Voxel Block Icon for authentic Minecraft UI
 */
const IsometricVoxelIcon: React.FC<{ type: VoxelType }> = ({ type }) => {
  // SVG drawing of 3D isometric cube with 3 visible faces
  // Top face: path "M12 2 L22 8 L12 14 L2 8 Z"
  // Left face: path "M2 8 L12 14 L12 22 L2 16 Z"
  // Right face: path "M12 14 L22 8 L22 16 L12 22 Z"

  switch (type) {
    case VoxelType.GRASS:
      return (
        <svg viewBox="0 0 24 24" className="w-6 h-6 shape-rendering-crispEdges">
          {/* Top Face (Green grass) */}
          <polygon points="12,2 22,7.8 12,13.6 2,7.8" fill="#58a032" />
          {/* Left Face (Dirt with grass fringe) */}
          <polygon points="2,7.8 12,13.6 12,22 2,16.2" fill="#866043" />
          <polygon points="2,7.8 12,13.6 12,16 2,10.2" fill="#4d8c2c" />
          {/* Right Face (Dirt with grass fringe, slightly shaded) */}
          <polygon points="12,13.6 22,7.8 22,16.2 12,22" fill="#6d4c33" />
          <polygon points="12,13.6 22,7.8 22,10.2 12,16" fill="#3f7523" />
        </svg>
      );
    case VoxelType.DIRT:
      return (
        <svg viewBox="0 0 24 24" className="w-6 h-6 shape-rendering-crispEdges">
          <polygon points="12,2 22,7.8 12,13.6 2,7.8" fill="#9c7353" />
          <polygon points="2,7.8 12,13.6 12,22 2,16.2" fill="#866043" />
          <polygon points="12,13.6 22,7.8 22,16.2 12,22" fill="#67472e" />
        </svg>
      );
    case VoxelType.STONE:
      return (
        <svg viewBox="0 0 24 24" className="w-6 h-6 shape-rendering-crispEdges">
          <polygon points="12,2 22,7.8 12,13.6 2,7.8" fill="#8e8e8e" />
          <polygon points="2,7.8 12,13.6 12,22 2,16.2" fill="#7a7a7a" />
          <polygon points="12,13.6 22,7.8 22,16.2 12,22" fill="#5f5f5f" />
        </svg>
      );
    case VoxelType.WOOD:
      return (
        <svg viewBox="0 0 24 24" className="w-6 h-6 shape-rendering-crispEdges">
          {/* Tree Rings on top */}
          <polygon points="12,2 22,7.8 12,13.6 2,7.8" fill="#aa8555" />
          <circle cx="12" cy="7.8" r="2.5" fill="#7d5930" />
          {/* Bark sides */}
          <polygon points="2,7.8 12,13.6 12,22 2,16.2" fill="#674d2b" />
          <polygon points="12,13.6 22,7.8 22,16.2 12,22" fill="#4d391d" />
        </svg>
      );
    case VoxelType.LEAVES:
      return (
        <svg viewBox="0 0 24 24" className="w-6 h-6 shape-rendering-crispEdges">
          <polygon points="12,2 22,7.8 12,13.6 2,7.8" fill="#429e2e" />
          <polygon points="2,7.8 12,13.6 12,22 2,16.2" fill="#328221" />
          <polygon points="12,13.6 22,7.8 22,16.2 12,22" fill="#246416" />
        </svg>
      );
    case VoxelType.SAND:
      return (
        <svg viewBox="0 0 24 24" className="w-6 h-6 shape-rendering-crispEdges">
          <polygon points="12,2 22,7.8 12,13.6 2,7.8" fill="#e8dc9e" />
          <polygon points="2,7.8 12,13.6 12,22 2,16.2" fill="#d8cb8c" />
          <polygon points="12,13.6 22,7.8 22,16.2 12,22" fill="#b9ab6d" />
        </svg>
      );
    case VoxelType.COBBLESTONE:
      return (
        <svg viewBox="0 0 24 24" className="w-6 h-6 shape-rendering-crispEdges">
          <polygon points="12,2 22,7.8 12,13.6 2,7.8" fill="#787878" stroke="#484848" strokeWidth="0.5" />
          <polygon points="2,7.8 12,13.6 12,22 2,16.2" fill="#626262" stroke="#484848" strokeWidth="0.5" />
          <polygon points="12,13.6 22,7.8 22,16.2 12,22" fill="#4c4c4c" stroke="#363636" strokeWidth="0.5" />
        </svg>
      );
    case VoxelType.GLASS:
      return (
        <svg viewBox="0 0 24 24" className="w-6 h-6 shape-rendering-crispEdges">
          <polygon points="12,2 22,7.8 12,13.6 2,7.8" fill="rgba(220, 240, 255, 0.55)" stroke="#ffffff" strokeWidth="0.8" />
          <polygon points="2,7.8 12,13.6 12,22 2,16.2" fill="rgba(180, 215, 245, 0.45)" stroke="#ffffff" strokeWidth="0.8" />
          <polygon points="12,13.6 22,7.8 22,16.2 12,22" fill="rgba(150, 195, 235, 0.45)" stroke="#ffffff" strokeWidth="0.8" />
          <line x1="8" y1="12" x2="16" y2="18" stroke="#ffffff" strokeWidth="1" strokeLinecap="round" />
        </svg>
      );
    case VoxelType.GLOWSTONE:
      return (
        <svg viewBox="0 0 24 24" className="w-6 h-6 shape-rendering-crispEdges">
          <polygon points="12,2 22,7.8 12,13.6 2,7.8" fill="#ffe08a" />
          <polygon points="2,7.8 12,13.6 12,22 2,16.2" fill="#d9a441" />
          <polygon points="12,13.6 22,7.8 22,16.2 12,22" fill="#b8832f" />
          <rect x="9" y="6" width="2" height="2" fill="#fff6c8" />
          <rect x="5" y="12" width="2" height="2" fill="#fff0a8" />
          <rect x="16" y="13" width="2" height="2" fill="#f7d36b" />
        </svg>
      );
    case VoxelType.TNT:
      return (
        <svg viewBox="0 0 24 24" className="w-6 h-6 shape-rendering-crispEdges">
          <polygon points="12,2 22,7.8 12,13.6 2,7.8" fill="#cc2a20" />
          <polygon points="2,7.8 12,13.6 12,22 2,16.2" fill="#b0241b" />
          <polygon points="12,13.6 22,7.8 22,16.2 12,22" fill="#8f1c15" />
          {/* White TNT band */}
          <polygon points="2,11.5 12,17.3 12,19 2,13.2" fill="#ffffff" />
          <polygon points="12,17.3 22,11.5 22,13.2 12,19" fill="#e0e0e0" />
          <text x="7" y="16.5" fill="#000000" fontSize="3" fontWeight="bold" fontFamily="monospace">TNT</text>
        </svg>
      );
    default:
      return <div className="w-5 h-5 bg-neutral-500 rounded-xs" />;
  }
};

const CONTROLS_PATH = '/textures/gui/controls';

/** Pixel-art mobile control button (textures from public/textures/gui/controls). */
const ControlImg: React.FC<{
  name: string;
  pressed: boolean;
  size: number;
  className?: string;
  title?: string;
  onClick?: () => void;
  visible?: boolean;
}> = ({ name, pressed, size, className = '', title, onClick, visible = true }) => (
  <button
    type="button"
    title={visible ? title : undefined}
    aria-hidden={!visible}
    tabIndex={visible ? 0 : -1}
    onClick={visible ? onClick : undefined}
    className={`${className} select-none touch-none p-0 border-0 bg-transparent`}
    style={{
      width: size,
      height: size,
      backgroundImage: visible
        ? `url(${CONTROLS_PATH}/${name}${pressed ? '_pressed' : ''}.png)`
        : 'none',
      backgroundSize: '100% 100%',
      imageRendering: 'pixelated',
      opacity: visible ? 1 : 0,
      pointerEvents: visible ? 'auto' : 'none',
    }}
  />
);

const ResourcePackBlockIcon: React.FC<{ type: VoxelType }> = ({ type }) => {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    const tintIfGrayscale = (input: HTMLCanvasElement, tint: string) => {
      const c = document.createElement('canvas');
      c.width = input.width;
      c.height = input.height;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(input, 0, 0);

      const sample = ctx.getImageData(0, 0, c.width, c.height);
      let colorPixels = 0;
      let opaquePixels = 0;
      for (let i = 0; i < sample.data.length; i += 4) {
        if (sample.data[i + 3] < 16) continue;
        opaquePixels++;
        const max = Math.max(sample.data[i], sample.data[i + 1], sample.data[i + 2]);
        const min = Math.min(sample.data[i], sample.data[i + 1], sample.data[i + 2]);
        if (max - min > 14) colorPixels++;
      }
      if (!opaquePixels || colorPixels / opaquePixels > 0.18) return c;

      const tinted = document.createElement('canvas');
      tinted.width = c.width;
      tinted.height = c.height;
      const tc = tinted.getContext('2d')!;
      tc.imageSmoothingEnabled = false;
      tc.drawImage(c, 0, 0);
      tc.globalCompositeOperation = 'multiply';
      tc.fillStyle = tint;
      tc.fillRect(0, 0, c.width, c.height);
      tc.globalCompositeOperation = 'destination-in';
      tc.drawImage(c, 0, 0);
      return tinted;
    };

    const load = async () => {
      const entry = HOTBAR_TEXTURES[type];
      if (!entry) return;

      const get = async (paths: string[]) => resourcePacks.getTexture(paths);
      let top = await get(
        type === VoxelType.GRASS ? ['block/grass_block_top'] :
        type === VoxelType.WOOD ? ['block/oak_log_top'] :
        entry.paths
      );
      let side = await get(
        type === VoxelType.GRASS ? ['block/grass_block_side'] :
        type === VoxelType.WOOD ? ['block/oak_log', 'block/oak_log_side'] :
        entry.paths
      );

      if (!top && !side) {
        if (alive) setSrc(null);
        return;
      }
      side = side ?? top;
      top = top ?? side;

      if (type === VoxelType.GRASS && top) top = tintIfGrayscale(top, '#91bd59');
      if (type === VoxelType.LEAVES && side) side = tintIfGrayscale(side, '#77ab2f');

      const out = document.createElement('canvas');
      out.width = 40;
      out.height = 40;
      const ctx = out.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;

      const drawFace = (
        image: HTMLCanvasElement,
        p0: [number, number],
        p1: [number, number],
        p2: [number, number],
        p3: [number, number],
        brightness = 1
      ) => {
        const w = image.width;
        const h = image.height;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(...p0);
        ctx.lineTo(...p1);
        ctx.lineTo(...p2);
        ctx.lineTo(...p3);
        ctx.closePath();
        ctx.clip();
        ctx.filter = brightness === 1 ? 'none' : 'brightness(' + brightness + ')';
        ctx.setTransform(
          (p1[0] - p0[0]) / w,
          (p1[1] - p0[1]) / w,
          (p3[0] - p0[0]) / h,
          (p3[1] - p0[1]) / h,
          p0[0],
          p0[1]
        );
        ctx.drawImage(image, 0, 0, w, h);
        ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      };

      drawFace(top, [3, 13], [20, 3], [37, 13], [20, 23], 1.08);
      drawFace(side, [3, 13], [20, 23], [20, 37], [3, 27], 0.88);
      drawFace(side, [20, 23], [37, 13], [37, 27], [20, 37], 0.72);

      if (alive) setSrc(out.toDataURL('image/png'));
    };

    void load();
    const unsubscribe = resourcePacks.subscribe(() => { void load(); });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [type]);

  if (!src) {
    return (
      <div className="flex items-center justify-center" style={{ width: 38, height: 38 }}>
        <IsometricVoxelIcon type={type} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{ width: 38, height: 38, imageRendering: 'pixelated', objectFit: 'contain', display: 'block' }}
    />
  );
};

export const PlayerControlsOverlay: React.FC<PlayerControlsOverlayProps> = ({
  onInputUpdate,
  onLookDelta,
  onAimTouchCoords,
  onActionMine,
  onActionPlace,
  onToggleViewMode,
  selectedVoxel,
  onSelectVoxel,
  onTogglePhysicsMaker,
  isPhysicsMakerActive,
  isFlying = false,
}) => {
  const isMobile = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

  // PC Keyboard & Pointer Lock
  const keysDown = useRef<Set<string>>(new Set());
  const [isSprinting, setIsSprinting] = useState(false);
  const [isSneaking, setIsSneaking] = useState(false);
  const [isPointerLocked, setIsPointerLocked] = useState(false);

  // Official MCPE D-Pad Touch State (Left side)
  const [dpadDir, setDpadDir] = useState<{ forward: number; right: number }>({ forward: 0, right: 0 });
  const dpadTouchId = useRef<number | null>(null);
  const dpadContainerRef = useRef<HTMLDivElement | null>(null);

  // Jump button active
  const [jumpPressed, setJumpPressed] = useState(false);
  const [descendPressed, setDescendPressed] = useState(false);

  // Mobile touch aim & MCPE state separation
  const lookTouchId = useRef<number | null>(null);
  const lookStartPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastLookPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const hasMovedRef = useRef<boolean>(false);
  const touchStartTimeRef = useRef<number>(0);
  const didBreakRef = useRef<boolean>(false);
  const isBreakingRef = useRef<boolean>(false);

  // MCPE Hold-to-Destroy timer & clean progress ring
  const holdBreakTimer = useRef<number | null>(null);
  const holdBreakInterval = useRef<number | null>(null);
  const [breakProgress, setBreakProgress] = useState<number | null>(null);
  const [breakIndicatorPos, setBreakIndicatorPos] = useState<{ x: number; y: number } | null>(null);

  // Send input changes
  const emitInput = useCallback(() => {
    let forward = 0;
    let right = 0;

    // Keyboard WASD
    if (keysDown.current.has('KeyW') || keysDown.current.has('ArrowUp')) forward += 1;
    if (keysDown.current.has('KeyS') || keysDown.current.has('ArrowDown')) forward -= 1;
    if (keysDown.current.has('KeyA') || keysDown.current.has('ArrowLeft')) right -= 1;
    if (keysDown.current.has('KeyD') || keysDown.current.has('ArrowRight')) right += 1;

    // MCPE D-Pad
    forward += dpadDir.forward;
    right += dpadDir.right;

    forward = Math.max(-1, Math.min(1, forward));
    right = Math.max(-1, Math.min(1, right));

    const jump = jumpPressed || keysDown.current.has('Space');
    const shift = keysDown.current.has('ShiftLeft') || keysDown.current.has('ShiftRight');
    // While flying: Shift / C / on-screen button = descend (sprint is disabled)
    const descend = isFlying && (descendPressed || shift || keysDown.current.has('KeyC'));
    const sprint = !isFlying && (isSprinting || shift);

    onInputUpdate({
      moveForward: forward,
      moveRight: right,
      jump,
      sprint,
      descend,
    });
  }, [dpadDir, isSprinting, jumpPressed, descendPressed, isFlying, onInputUpdate]);

  useEffect(() => {
    emitInput();
  }, [dpadDir, jumpPressed, isSprinting, descendPressed, isFlying, emitInput]);

  // Keyboard Event Listeners for PC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      keysDown.current.add(e.code);

      if (e.code === 'KeyF' || e.code === 'F5') {
        e.preventDefault();
        onToggleViewMode();
      }

      // Hotbar 1-9
      if (e.code.startsWith('Digit')) {
        const num = parseInt(e.code.replace('Digit', ''), 10);
        if (num >= 1 && num <= HOTBAR_ITEMS.length) {
          onSelectVoxel(HOTBAR_ITEMS[num - 1].type);
        }
      }

      emitInput();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysDown.current.delete(e.code);
      emitInput();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [emitInput, onSelectVoxel, onToggleViewMode]);

  // PC Pointer Lock mouse look listener
  useEffect(() => {
    const handlePointerLockChange = () => {
      setIsPointerLocked(document.pointerLockElement !== null);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== null) {
        const sensitivity = 0.0022;
        onLookDelta(e.movementX * sensitivity, e.movementY * sensitivity);
      }
    };

    document.addEventListener('pointerlockchange', handlePointerLockChange);
    document.addEventListener('mousemove', handleMouseMove);

    return () => {
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, [onLookDelta]);

  // Clear MCPE hold break timers
  const cancelHoldBreak = () => {
    if (holdBreakTimer.current) {
      window.clearTimeout(holdBreakTimer.current);
      holdBreakTimer.current = null;
    }
    if (holdBreakInterval.current) {
      window.clearInterval(holdBreakInterval.current);
      holdBreakInterval.current = null;
    }
    setBreakProgress(null);
    setBreakIndicatorPos(null);
  };

  // Official MCPE D-Pad Touch Handlers
  const handleDpadUpdate = (touchX: number, touchY: number) => {
    if (!dpadContainerRef.current) return;
    const rect = dpadContainerRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = touchX - centerX;
    const dy = touchY - centerY;
    const dist = Math.hypot(dx, dy);

    if (dist < 18) {
      // Center zone (Crouch / Sneak toggle)
      setDpadDir({ forward: 0, right: 0 });
      return;
    }

    // Snap the finger to the nearest of the 8 directions. Equal 45° sectors
    // make diagonal activation stable while sliding between buttons.
    const angle = Math.atan2(dy, dx);
    const sector = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
    let f = 0;
    let r = 0;

    switch (sector) {
      case 0:  r = 1;  break; // RIGHT
      case 1:  f = -1; r = 1;  break; // DOWN-RIGHT
      case 2:  f = -1; break; // DOWN
      case 3:  f = -1; r = -1; break; // DOWN-LEFT
      case 4:  r = -1; break; // LEFT
      case 5:  f = 1;  r = -1; break; // UP-LEFT
      case 6:  f = 1;  break; // UP
      case 7:  f = 1;  r = 1; break; // UP-RIGHT
    }

    setDpadDir({ forward: f, right: r });
  };

  const handleDpadTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    const touch = e.changedTouches[0];
    dpadTouchId.current = touch.identifier;
    handleDpadUpdate(touch.clientX, touch.clientY);
  };

  const handleDpadTouchMove = (e: React.TouchEvent) => {
    e.stopPropagation();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === dpadTouchId.current) {
        handleDpadUpdate(touch.clientX, touch.clientY);
        break;
      }
    }
  };

  const handleDpadTouchEnd = (e: React.TouchEvent) => {
    e.stopPropagation();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === dpadTouchId.current) {
        dpadTouchId.current = null;
        setDpadDir({ forward: 0, right: 0 });
        break;
      }
    }
  };

  // Touch handlers for World Interaction & Camera Look (Excludes UI Zones)
  const handleTouchStart = (e: React.TouchEvent) => {
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];

      // 1. Deadzone: Ignore touches on bottom hotbar strip or top header
      if (touch.clientY > screenH - 72 || touch.clientY < 60) {
        continue;
      }

      // 2. Deadzone: Ignore touches in bottom-left D-Pad quadrant
      if (touch.clientX < 190 && touch.clientY > screenH - 220) {
        continue;
      }

      // 3. Deadzone: Ignore touches in bottom-right Jump button area
      if (touch.clientX > screenW - 130 && touch.clientY > screenH - 180) {
        continue;
      }

      // 4. Ignore touches that started on an interactive UI element
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      if (target?.closest('.ui-touch-interactive') || target?.closest('button')) {
        continue;
      }

      // Valid Game Interaction Zone (Looking, Mining, Placing)
      if (lookTouchId.current === null) {
        lookTouchId.current = touch.identifier;
        lookStartPos.current = { x: touch.clientX, y: touch.clientY };
        lastLookPos.current = { x: touch.clientX, y: touch.clientY };
        hasMovedRef.current = false;
        didBreakRef.current = false;
        isBreakingRef.current = false;
        touchStartTimeRef.current = performance.now();

        const targetPos = { x: touch.clientX, y: touch.clientY };
        onAimTouchCoords?.(targetPos);
        setBreakIndicatorPos(targetPos);
        setBreakProgress(0);

        const startTime = performance.now();
        const duration = 280; // 280ms hold threshold for mining

        const tickProgress = () => {
          const elapsed = performance.now() - startTime;
          const p = Math.min(1.0, elapsed / duration);
          setBreakProgress(p);

          if (p >= 1.0) {
            // MCPE Hold-Break completed!
            isBreakingRef.current = true;
            didBreakRef.current = true;
            onActionMine(targetPos);
            setBreakProgress(0);

            // Repeat breaking while finger remains held
            if (!holdBreakInterval.current) {
              holdBreakInterval.current = window.setInterval(() => {
                onActionMine(targetPos);
              }, 220);
            }
          } else {
            holdBreakTimer.current = window.setTimeout(tickProgress, 25);
          }
        };

        holdBreakTimer.current = window.setTimeout(tickProgress, 25);
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];

      // Camera Look Move
      if (touch.identifier === lookTouchId.current) {
        onAimTouchCoords?.({ x: touch.clientX, y: touch.clientY });
        const dx = touch.clientX - lastLookPos.current.x;
        const dy = touch.clientY - lastLookPos.current.y;
        lastLookPos.current = { x: touch.clientX, y: touch.clientY };

        const totalMoved = Math.hypot(
          touch.clientX - lookStartPos.current.x,
          touch.clientY - lookStartPos.current.y
        );

        // If finger swiped > 8px, it is camera rotation!
        if (totalMoved > 8) {
          hasMovedRef.current = true;
          cancelHoldBreak();
        }

        // Apply smooth camera rotation
        const touchSensitivity = 0.0042;
        onLookDelta(dx * touchSensitivity, dy * touchSensitivity);
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];

      // Look / Tap End
      if (touch.identifier === lookTouchId.current) {
        lookTouchId.current = null;
        onAimTouchCoords?.(null);
        const duration = performance.now() - touchStartTimeRef.current;

        // Place ONLY if:
        // - Finger didn't drag camera (!hasMovedRef.current)
        // - Finger didn't break a block (!didBreakRef.current)
        // - It was a quick tap (< 240ms)
        if (!hasMovedRef.current && !didBreakRef.current && !isBreakingRef.current && duration < 240) {
          onActionPlace({ x: touch.clientX, y: touch.clientY });
        }

        cancelHoldBreak();
      }
    }
  };

  return (
    <div
      className="absolute inset-0 select-none overflow-hidden z-20 touch-none pointer-events-auto"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {/* PC ONLY: Center Crosshair (Hidden on mobile) */}
      {!isMobile && isPointerLocked && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center">
          <div className="w-5 h-5 relative">
            <div className="absolute top-2 left-0 w-5 h-1 bg-white/80 shadow-sm rounded-xs" />
            <div className="absolute top-0 left-2 w-1 h-5 bg-white/80 shadow-sm rounded-xs" />
            <div className="absolute top-[9px] left-[9px] w-1 h-1 bg-black/90" />
          </div>
        </div>
      )}

      {/* MCPE Break Progress Radial Indicator */}
      {breakProgress !== null && breakIndicatorPos && (
        <div
          className="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2 flex items-center justify-center z-40"
          style={{ left: breakIndicatorPos.x, top: breakIndicatorPos.y }}
        >
          <svg className="w-12 h-12 -rotate-90">
            <circle
              cx="24"
              cy="24"
              r="18"
              stroke="rgba(255,255,255,0.25)"
              strokeWidth="3"
              fill="rgba(0,0,0,0.35)"
            />
            <circle
              cx="24"
              cy="24"
              r="18"
              stroke="#ffffff"
              strokeWidth="3.5"
              fill="transparent"
              strokeDasharray={2 * Math.PI * 18}
              strokeDashoffset={2 * Math.PI * 18 * (1 - breakProgress)}
              strokeLinecap="round"
            />
          </svg>
        </div>
      )}

      {/* MCPE-style 8-way D-pad. Diagonals live in the four gaps. */}
      <div
        ref={dpadContainerRef}
        className="ui-touch-interactive absolute left-3 sm:left-5 bottom-[clamp(4.25rem,9vh,6.5rem)] pointer-events-auto select-none touch-none z-30"
        style={{ width: 168, height: 168 }}
        onTouchStart={handleDpadTouchStart}
        onTouchMove={handleDpadTouchMove}
        onTouchEnd={handleDpadTouchEnd}
        onTouchCancel={handleDpadTouchEnd}
      >
        {([
          ['up', 1, 0, 'Move Forward', 56, 0, 56],
          ['left', 0, -1, 'Strafe Left', 0, 56, 56],
          ['sneak_dpad', null, null, 'Sneak / Crouch', 56, 56, 56],
          ['right', 0, 1, 'Strafe Right', 112, 56, 56],
          ['down', -1, 0, 'Move Backward', 56, 112, 56],
          ['up_left', 1, -1, 'Forward-Left', 8, 8, 40],
          ['up_right', 1, 1, 'Forward-Right', 120, 8, 40],
          ['down_left', -1, -1, 'Back-Left', 8, 120, 40],
          ['down_right', -1, 1, 'Back-Right', 120, 120, 40],
        ] as [string, number | null, number | null, string, number, number, number][]).map(([name, f, r, title, left, top, size]) => {
          const isCenter = f === null;
          const isActive = isCenter
            ? isSneaking
            : dpadDir.forward === f && dpadDir.right === r;

          return (
            <div
              key={name}
              className="absolute"
              style={{ left, top, width: size, height: size, zIndex: 2 }}
            >
              <ControlImg
                name={name}
                pressed={isActive}
                size={size}
                title={title}
                visible
                onClick={isCenter ? () => setIsSneaking(!isSneaking) : undefined}
              />
            </div>
          );
        })}
      </div>

      {/* OFFICIAL MCPE JUMP & CAMERA CONTROLS (Bottom Right) */}
      <div className="ui-touch-interactive absolute bottom-20 sm:bottom-24 right-5 sm:right-8 pointer-events-auto flex flex-col items-center gap-3 z-30">
        {/* Physics Maker HUD Toggle (Create/Aeronautics Wand) */}
        {onTogglePhysicsMaker && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePhysicsMaker();
            }}
            className={`mcpe-action-btn w-11 h-11 flex items-center justify-center transition active:scale-95 shadow-xl ${
              isPhysicsMakerActive
                ? 'bg-cyan-600/90 text-yellow-300 border-2 border-yellow-300'
                : 'text-cyan-300 hover:text-white'
            }`}
            title="Physics Maker (Create/Aeronautics)"
          >
            <Wrench className="w-5 h-5" />
          </button>
        )}

        {/* Camera Perspective Toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleViewMode();
          }}
          className="mcpe-action-btn w-11 h-11 flex items-center justify-center text-white active:scale-95 transition"
          title="Toggle Perspective (F5)"
        >
          <Camera className="w-5 h-5" />
        </button>

        {/* Fly-down button (only while flying) */}
        {isFlying && (
          <div
            onTouchStart={(e) => {
              e.stopPropagation();
              setDescendPressed(true);
            }}
            onTouchEnd={(e) => {
              e.stopPropagation();
              setDescendPressed(false);
            }}
            onMouseDown={() => setDescendPressed(true)}
            onMouseUp={() => setDescendPressed(false)}
          >
            <ControlImg name="waterdescend" pressed={descendPressed} size={66} title="Fly down" />
          </div>
        )}

        {/* Fly-up / Jump Button */}
        <div
          onTouchStart={(e) => {
            e.stopPropagation();
            setJumpPressed(true);
          }}
          onTouchEnd={(e) => {
            e.stopPropagation();
            setJumpPressed(false);
          }}
          onMouseDown={() => setJumpPressed(true)}
          onMouseUp={() => setJumpPressed(false)}
        >
          <ControlImg
            name={isFlying ? 'waterascend' : 'jump'}
            pressed={jumpPressed}
            size={66}
            title="Jump"
          />
        </div>
      </div>

      {/* AUTHENTIC MINECRAFT 9-SLOT HOTBAR (Uses genuine hotbar.png and hotbar_selection.png) */}
      <div
        className="ui-touch-interactive absolute bottom-2 sm:bottom-3 left-1/2 -translate-x-1/2 pointer-events-auto z-30 select-none max-w-[98vw] overflow-x-auto pb-0.5 scrollbar-none"
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        <div
          className="relative flex items-center shadow-2xl shrink-0"
          style={{
            width: '364px',
            height: '48px',
            backgroundImage: 'var(--rp-hotbar, url(/textures/gui/hotbar.png))',
            backgroundSize: '100% 100%',
            imageRendering: 'pixelated',
          }}
        >
          {/* Active Hotbar Selection Box Cursor */}
          {(() => {
            const selectedIdx = Math.max(0, HOTBAR_ITEMS.findIndex((it) => it.type === selectedVoxel));
            return (
              <div
                className="absolute pointer-events-none transition-all duration-100 ease-out"
                style={{
                  width: '48px',
                  height: '48px',
                  left: `${selectedIdx * 40 - 2}px`,
                  top: '-2px',
                  backgroundImage: 'var(--rp-hotbar-selection, url(/textures/gui/hotbar_selection.png))',
                  backgroundSize: '100% 100%',
                  imageRendering: 'pixelated',
                  zIndex: 10,
                }}
              />
            );
          })()}

          {/* 9 Hotbar Slots with 3D Isometric Voxel Icons */}
          {HOTBAR_ITEMS.map((item, idx) => {
            return (
              <button
                key={item.type}
                onTouchStart={(e) => {
                  e.stopPropagation();
                  onSelectVoxel(item.type);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectVoxel(item.type);
                }}
                className="relative flex items-center justify-center cursor-pointer active:scale-95 transition-transform"
                style={{
                  width: '40px',
                  height: '44px',
                  marginLeft: idx === 0 ? '2px' : '0px',
                }}
                title={`${idx + 1}: ${item.name}`}
              >
                {/* Resource-pack-aware Minecraft block icon */}
                <div className="flex items-center justify-center">
                  <ResourcePackBlockIcon type={item.type} />
                </div>
                {/* Slot index number in Minecraft font */}
                <span className="absolute bottom-0.5 right-1 text-[9px] font-mono font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">
                  {idx + 1}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
