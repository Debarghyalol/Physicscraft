import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PlayerInput } from '../player/PlayerController';
import { CameraViewMode } from '../types/physics';
import { Camera, Wrench } from 'lucide-react';
import { inventory, HOTBAR_SIZE } from '../inventory/InventoryStore';
import { useInventory } from '../inventory/useInventory';
import { ItemIcon, StackCount } from '../inventory/icons';
import { getItemDef } from '../inventory/items';

export interface PlayerControlsOverlayProps {
  onInputUpdate: (input: PlayerInput) => void;
  onLookDelta: (deltaYaw: number, deltaPitch: number) => void;
  onAimTouchCoords?: (coords: { x: number; y: number } | null) => void;
  onActionMine: (coords?: { x: number; y: number }) => void;
  onActionPlace: (coords?: { x: number; y: number }) => void;
  /** What is under a screen point: a mob (tap = attack) or a block/nothing (tap = place, hold = break). */
  onQueryTarget?: (coords: { x: number; y: number }) => 'mob' | 'block';
  onToggleViewMode: () => void;
  isFlying?: boolean;
  viewMode: CameraViewMode;
  onTogglePhysicsMaker?: () => void;
  isPhysicsMakerActive?: boolean;
}

const CONTROLS_PATH = '/textures/gui/controls';

/** Pixel-art mobile control button */
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
    className={`${className} select-none touch-none p-0 border-0 bg-transparent flex items-center justify-center`}
    style={{
      width: size,
      height: size,
      boxSizing: 'border-box',
      backgroundImage: visible
        ? `url(${CONTROLS_PATH}/${name}${pressed ? '_pressed' : ''}.png)`
        : 'none',
      backgroundSize: '100% 100%',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'center',
      imageRendering: 'pixelated',
      opacity: visible ? 1 : 0,
      pointerEvents: visible ? 'auto' : 'none',
    }}
  />
);

export const PlayerControlsOverlay: React.FC<PlayerControlsOverlayProps> = ({
  onInputUpdate,
  onLookDelta,
  onAimTouchCoords,
  onActionMine,
  onActionPlace,
  onQueryTarget,
  onToggleViewMode,
  onTogglePhysicsMaker,
  isPhysicsMakerActive,
  isFlying = false,
}) => {
  const inv = useInventory();
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
  const [burst, setBurst] = useState<{ x: number; y: number; id: number } | null>(null);
  const holdActiveRef = useRef(false); // finger has been down long enough that release is not a tap

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
    if (inventory.open) return;
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      keysDown.current.add(e.code);

      if (e.code === 'KeyF' || e.code === 'F5') {
        e.preventDefault();
        onToggleViewMode();
      }

      // Hotbar 1-9
      if (e.code.startsWith('Digit')) {
        const num = parseInt(e.code.replace('Digit', ''), 10);
        if (num >= 1 && num <= HOTBAR_SIZE) {
          inventory.select(num - 1);
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
  }, [emitInput, onToggleViewMode]);

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

    // Center zone threshold (Crouch / Sneak toggle)
    if (dist < 26) {
      setDpadDir({ forward: 0, right: 0 });
      return;
    }

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

  // Touch handlers for World Interaction & Camera Look
  const handleTouchStart = (e: React.TouchEvent) => {
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];

      // 1. Deadzone: Ignore touches on bottom hotbar strip or top header
      if (touch.clientY > screenH - 72 || touch.clientY < 60) {
        continue;
      }

      // 2. Deadzone: Ignore touches in bottom-left D-Pad area (Expanded to protect top corners)
      if (touch.clientX < 220 && touch.clientY > screenH - 260) {
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

      // Valid Game Interaction Zone
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
        holdActiveRef.current = false;
        const kind = onQueryTarget?.(targetPos) ?? 'block';

        // Timeline: release before TAP_MAX_MS = tap (place / attack). Past it the touch is a hold:
        // on a block the ring fills until BREAK_AT_MS and the block breaks; on a mob it attacks
        // repeatedly. Releasing mid-ring cancels, so a slow tap never breaks by accident.
        const TAP_MAX_MS = 250;
        const BREAK_AT_MS = 650;
        const startTime = performance.now();
        let lastRepeat = 0;

        const tickProgress = () => {
          const elapsed = performance.now() - startTime;
          if (elapsed < TAP_MAX_MS) {
            holdBreakTimer.current = window.setTimeout(tickProgress, 20);
            return;
          }
          holdActiveRef.current = true;

          if (kind === 'mob') {
            const now = performance.now();
            if (now - lastRepeat >= 450) {
              lastRepeat = now;
              didBreakRef.current = true;
              onActionMine(targetPos);
            }
            holdBreakTimer.current = window.setTimeout(tickProgress, 40);
            return;
          }

          const p = Math.min(1.0, (elapsed - TAP_MAX_MS) / (BREAK_AT_MS - TAP_MAX_MS));
          setBreakIndicatorPos(targetPos);
          setBreakProgress(p);

          if (p >= 1.0) {
            isBreakingRef.current = true;
            didBreakRef.current = true;
            onActionMine(targetPos);
            setBurst({ x: targetPos.x, y: targetPos.y, id: performance.now() });
            setBreakProgress(0);

            if (!holdBreakInterval.current) {
              holdBreakInterval.current = window.setInterval(() => {
                onActionMine(targetPos);
              }, 300);
            }
          } else {
            holdBreakTimer.current = window.setTimeout(tickProgress, 20);
          }
        };

        holdBreakTimer.current = window.setTimeout(tickProgress, 20);
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];

      if (touch.identifier === lookTouchId.current) {
        onAimTouchCoords?.({ x: touch.clientX, y: touch.clientY });
        const dx = touch.clientX - lastLookPos.current.x;
        const dy = touch.clientY - lastLookPos.current.y;
        lastLookPos.current = { x: touch.clientX, y: touch.clientY };

        const totalMoved = Math.hypot(
          touch.clientX - lookStartPos.current.x,
          touch.clientY - lookStartPos.current.y
        );

        if (totalMoved > 14) {
          hasMovedRef.current = true;
          cancelHoldBreak();
        }

        const touchSensitivity = 0.0042;
        onLookDelta(dx * touchSensitivity, dy * touchSensitivity);
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];

      if (touch.identifier === lookTouchId.current) {
        lookTouchId.current = null;
        onAimTouchCoords?.(null);
        const duration = performance.now() - touchStartTimeRef.current;

        if (!hasMovedRef.current && !didBreakRef.current && !isBreakingRef.current && !holdActiveRef.current && duration < 250) {
          const pos = { x: touch.clientX, y: touch.clientY };
          // Tap on a mob attacks it; anywhere else it places a block / uses the item.
          if ((onQueryTarget?.(pos) ?? 'block') === 'mob') onActionMine(pos);
          else onActionPlace(pos);
        }
        holdActiveRef.current = false;

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
      {/* PC ONLY: Center Crosshair */}
      {!isMobile && isPointerLocked && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center">
          <div className="w-5 h-5 relative">
            <div className="absolute top-2 left-0 w-5 h-1 bg-white/80 shadow-sm rounded-xs" />
            <div className="absolute top-0 left-2 w-1 h-5 bg-white/80 shadow-sm rounded-xs" />
            <div className="absolute top-[9px] left-[9px] w-1 h-1 bg-black/90" />
          </div>
        </div>
      )}

      {/* MCPE hold-to-break ring: pops in once the touch becomes a hold, fills clockwise (white -> green) */}
      <style>{`
        @keyframes pe-ring-in { from { transform: translate(-50%,-50%) scale(.55); opacity: 0 } to { transform: translate(-50%,-50%) scale(1); opacity: 1 } }
        @keyframes pe-ring-burst { from { transform: translate(-50%,-50%) scale(1); opacity: .9 } to { transform: translate(-50%,-50%) scale(1.7); opacity: 0 } }
      `}</style>
      {breakProgress !== null && breakIndicatorPos && (
        <div
          className="absolute pointer-events-none z-40"
          style={{ left: breakIndicatorPos.x, top: breakIndicatorPos.y, width: 96, height: 96, transform: 'translate(-50%,-50%)', animation: 'pe-ring-in 120ms ease-out' }}
        >
          <svg width="96" height="96" viewBox="0 0 96 96" className="-rotate-90" style={{ filter: 'drop-shadow(0 0 3px rgba(0,0,0,.65))' }}>
            <circle cx="48" cy="48" r="38" fill="rgba(0,0,0,0.28)" stroke="rgba(255,255,255,0.3)" strokeWidth="8" />
            <circle
              cx="48" cy="48" r="38" fill="none"
              stroke={`hsl(${Math.round(breakProgress * 105)}, ${Math.round(breakProgress * 85)}%, ${100 - Math.round(breakProgress * 38)}%)`}
              strokeWidth="8"
              strokeDasharray={2 * Math.PI * 38}
              strokeDashoffset={2 * Math.PI * 38 * (1 - breakProgress)}
              strokeLinecap="butt"
            />
          </svg>
        </div>
      )}
      {burst && (
        <div
          key={burst.id}
          className="absolute pointer-events-none z-40 rounded-full"
          style={{ left: burst.x, top: burst.y, width: 96, height: 96, border: '6px solid #9bff7a', boxShadow: '0 0 12px rgba(155,255,122,.8)', animation: 'pe-ring-burst 260ms ease-out forwards' }}
          onAnimationEnd={() => setBurst(null)}
        />
      )}

      {/* MCPE D-Pad: Contiguous 3x3 Grid; all buttons have identical size and stay properly anchored */}
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
          ['up_left', 1, -1, 'Forward-Left', 0, 0],
          ['up', 1, 0, 'Move Forward', 56, 0],
          ['up_right', 1, 1, 'Forward-Right', 112, 0],
          ['left', 0, -1, 'Strafe Left', 0, 56],
          ['sneak_dpad', null, null, 'Sneak / Crouch', 56, 56],
          ['right', 0, 1, 'Strafe Right', 112, 56],
          ['down_left', -1, -1, 'Back-Left', 0, 112],
          ['down', -1, 0, 'Move Backward', 56, 112],
          ['down_right', -1, 1, 'Back-Right', 112, 112],
        ] as [string, number | null, number | null, string, number, number][]).map(([name, f, r, title, left, top]) => {
          const isCenter = f === null;
          const isActive = isCenter
            ? isSneaking
            : dpadDir.forward === f && dpadDir.right === r;

          return (
            <div
              key={name}
              className="absolute"
              style={{ left, top, width: 56, height: 56, boxSizing: 'border-box' }}
            >
              <ControlImg
                name={name}
                pressed={isActive}
                size={56}
                title={title}
                visible={!isCenter && (f === 1 || f === -1) && (r === 1 || r === -1) ? isActive : true}
                onClick={isCenter ? () => setIsSneaking(!isSneaking) : undefined}
              />
            </div>
          );
        })}
      </div>

      {/* OFFICIAL MCPE JUMP & CAMERA CONTROLS */}
      <div className="ui-touch-interactive absolute bottom-20 sm:bottom-24 right-5 sm:right-8 pointer-events-auto flex flex-col items-center gap-3 z-30">
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

      {/* AUTHENTIC MINECRAFT 9-SLOT HOTBAR */}
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
            height: '44px',
            backgroundImage: 'var(--rp-hotbar, url(/textures/gui/hotbar.png))',
            backgroundSize: '100% 100%',
            imageRendering: 'pixelated',
          }}
        >
          {/* Active Hotbar Selection Cursor */}
          <div
            className="absolute pointer-events-none transition-all duration-100 ease-out"
            style={{
              width: '48px',
              height: '46px',
              left: `${inv.selected * 40 - 2}px`,
              top: '-2px',
              backgroundImage: 'var(--rp-hotbar-selection, url(/textures/gui/hotbar_selection.png))',
              backgroundSize: '100% 100%',
              imageRendering: 'pixelated',
              zIndex: 10,
            }}
          />

          {/* 9 Hotbar Slots (driven by the inventory store) */}
          {Array.from({ length: HOTBAR_SIZE }, (_, idx) => {
            const stack = inv.slots[idx];
            return (
              <button
                key={idx}
                onTouchStart={(e) => {
                  e.stopPropagation();
                  inventory.select(idx);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  inventory.select(idx);
                }}
                className="relative flex items-center justify-center cursor-pointer active:scale-95 transition-transform"
                style={{ width: '40px', height: '44px', marginLeft: idx === 0 ? '2px' : '0px' }}
                title={stack ? `${idx + 1}: ${getItemDef(stack.id)?.name ?? ''}` : `${idx + 1}`}
              >
                {stack && (
                  <div className="relative" style={{ width: 32, height: 32 }}>
                    <ItemIcon itemId={stack.id} size={32} />
                    <StackCount count={stack.count} size={16} />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    <button
      type="button"
      onTouchStart={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        inventory.toggle();
      }}
      className="ui-touch-interactive absolute bottom-2 sm:bottom-3 z-30 pointer-events-auto w-10 h-11 text-white text-xl leading-none active:scale-95"
      style={{ left: 'calc(50% + 190px)', backgroundImage: 'var(--rp-hotbar-selection, none)', backgroundSize: '100% 100%', imageRendering: 'pixelated', textShadow: '2px 2px #3f3f3f' }}
      title="Inventory (E)"
      aria-label="Open inventory"
    >
      …
    </button>
    </div>
  );
};