import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PlayerInput } from '../player/PlayerController';
import { CameraViewMode, VoxelType } from '../types/physics';
import { ArrowUp } from 'lucide-react';

export interface PlayerControlsOverlayProps {
  onInputUpdate: (input: PlayerInput) => void;
  onLookDelta: (deltaYaw: number, deltaPitch: number) => void;
  onAimTouchCoords?: (coords: { x: number; y: number } | null) => void;
  onActionMine: (coords?: { x: number; y: number }) => void;
  onActionPlace: (coords?: { x: number; y: number }) => void;
  onToggleViewMode: () => void;
  viewMode: CameraViewMode;
  selectedVoxel: VoxelType;
  onSelectVoxel: (v: VoxelType) => void;
}

const HOTBAR_ITEMS: { type: VoxelType; name: string; color: string; border: string }[] = [
  { type: VoxelType.GRASS, name: 'Grass Block', color: '#55a832', border: '#438e24' },
  { type: VoxelType.DIRT, name: 'Dirt', color: '#866043', border: '#67472e' },
  { type: VoxelType.STONE, name: 'Stone', color: '#7a7a7a', border: '#5f5f5f' },
  { type: VoxelType.WOOD, name: 'Oak Wood', color: '#6b5130', border: '#4e381f' },
  { type: VoxelType.LEAVES, name: 'Oak Leaves', color: '#347b26', border: '#245919' },
  { type: VoxelType.SAND, name: 'Sand', color: '#d9cc8c', border: '#c2b370' },
  { type: VoxelType.COBBLESTONE, name: 'Cobblestone', color: '#686868', border: '#434343' },
  { type: VoxelType.GLASS, name: 'Glass', color: 'rgba(215, 235, 255, 0.7)', border: '#ffffff' },
  { type: VoxelType.TNT, name: 'TNT', color: '#cc2a20', border: '#ff4444' },
];

export const PlayerControlsOverlay: React.FC<PlayerControlsOverlayProps> = ({
  onInputUpdate,
  onLookDelta,
  onAimTouchCoords,
  onActionMine,
  onActionPlace,
  onToggleViewMode,
  selectedVoxel,
  onSelectVoxel,
}) => {
  const isMobile = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

  // PC Keyboard & Pointer Lock
  const keysDown = useRef<Set<string>>(new Set());
  const [isSprinting, setIsSprinting] = useState(false);
  const [isPointerLocked, setIsPointerLocked] = useState(false);

  // Mobile virtual joystick state (Left side)
  const [joystickActive, setJoystickActive] = useState(false);
  const [joystickKnob, setJoystickKnob] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const joystickTouchId = useRef<number | null>(null);
  const joystickCenter = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const joystickVector = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

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

  // Jump button active
  const [jumpPressed, setJumpPressed] = useState(false);

  // Send input changes
  const emitInput = useCallback(() => {
    let forward = 0;
    let right = 0;

    // Keyboard WASD
    if (keysDown.current.has('KeyW') || keysDown.current.has('ArrowUp')) forward += 1;
    if (keysDown.current.has('KeyS') || keysDown.current.has('ArrowDown')) forward -= 1;
    if (keysDown.current.has('KeyA') || keysDown.current.has('ArrowLeft')) right -= 1;
    if (keysDown.current.has('KeyD') || keysDown.current.has('ArrowRight')) right += 1;

    // Joystick input
    if (joystickActive) {
      forward += joystickVector.current.y;
      right += joystickVector.current.x;
    }

    forward = Math.max(-1, Math.min(1, forward));
    right = Math.max(-1, Math.min(1, right));

    const jump = jumpPressed || keysDown.current.has('Space');
    const sprint = isSprinting || keysDown.current.has('ShiftLeft') || keysDown.current.has('ShiftRight');

    onInputUpdate({
      moveForward: forward,
      moveRight: right,
      jump,
      sprint,
    });
  }, [isSprinting, joystickActive, jumpPressed, onInputUpdate]);

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

  // Dedicated Virtual Joystick Touch Handlers (Strictly self-contained)
  const handleJoystickTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (joystickTouchId.current !== null) return;
    const touch = e.changedTouches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    joystickTouchId.current = touch.identifier;
    joystickCenter.current = { x: centerX, y: centerY };
    setJoystickKnob({ x: 0, y: 0 });
    setJoystickActive(true);
  };

  const handleJoystickTouchMove = (e: React.TouchEvent) => {
    e.stopPropagation();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === joystickTouchId.current) {
        const dx = touch.clientX - joystickCenter.current.x;
        const dy = touch.clientY - joystickCenter.current.y;
        const maxDist = 40;
        const dist = Math.hypot(dx, dy);
        const clampedDist = Math.min(dist, maxDist);
        const angle = Math.atan2(dy, dx);

        const kx = Math.cos(angle) * clampedDist;
        const ky = Math.sin(angle) * clampedDist;

        setJoystickKnob({ x: kx, y: ky });
        joystickVector.current = {
          x: kx / maxDist,
          y: -ky / maxDist,
        };
        emitInput();
        break;
      }
    }
  };

  const handleJoystickTouchEnd = (e: React.TouchEvent) => {
    e.stopPropagation();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === joystickTouchId.current) {
        joystickTouchId.current = null;
        setJoystickActive(false);
        setJoystickKnob({ x: 0, y: 0 });
        joystickVector.current = { x: 0, y: 0 };
        emitInput();
        break;
      }
    }
  };

  // Touch handlers for World Interaction & Camera Look (Excludes UI & Joystick Zones)
  const handleTouchStart = (e: React.TouchEvent) => {
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];

      // 1. Deadzone: Ignore touches on bottom hotbar strip or top header
      if (touch.clientY > screenH - 72 || touch.clientY < 60) {
        continue;
      }

      // 2. Deadzone: Ignore touches in bottom-left Joystick quadrant (prevents accidental mining/placing)
      if (touch.clientX < 160 && touch.clientY > screenH - 180) {
        continue;
      }

      // 3. Deadzone: Ignore touches in bottom-right Jump button area
      if (touch.clientX > screenW - 120 && touch.clientY > screenH - 160) {
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
        const duration = 300; // 300ms hold threshold

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
              }, 240);
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

        // If finger swiped > 8px, it is a camera rotation swipe!
        if (totalMoved > 8) {
          hasMovedRef.current = true;
          // Cancel hold break because player is actively panning camera!
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

        // MCPE Rule:
        // Place ONLY if:
        // - Finger didn't drag camera (!hasMovedRef.current)
        // - Finger didn't break a block (!didBreakRef.current)
        // - Finger didn't enter hold-breaking mode (!isBreakingRef.current)
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
      {/* PC ONLY: Center Crosshair (HIDDEN ON MOBILE as requested!) */}
      {!isMobile && isPointerLocked && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center">
          <div className="w-5 h-5 relative">
            <div className="absolute top-2 left-0 w-5 h-1 bg-white/80 shadow-sm rounded-xs" />
            <div className="absolute top-0 left-2 w-1 h-5 bg-white/80 shadow-sm rounded-xs" />
            <div className="absolute top-[9px] left-[9px] w-1 h-1 bg-black/90" />
          </div>
        </div>
      )}

      {/* MCPE Break Progress Radial Indicator (No icons or emojis!) */}
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

      {/* Minimal Virtual Joystick (Bottom Left - Clean B&W styling, strictly isolated) */}
      <div
        className="ui-touch-interactive absolute bottom-20 sm:bottom-24 left-5 sm:left-8 pointer-events-auto select-none touch-none"
        onTouchStart={handleJoystickTouchStart}
        onTouchMove={handleJoystickTouchMove}
        onTouchEnd={handleJoystickTouchEnd}
        onTouchCancel={handleJoystickTouchEnd}
      >
        <div
          className={`w-24 h-24 rounded-full border transition-colors flex items-center justify-center relative shadow-lg ${
            joystickActive ? 'bg-black/60 border-white/70' : 'bg-black/30 border-white/20'
          }`}
        >
          <div className="w-10 h-10 rounded-full border border-white/10" />
          {/* Thumb knob */}
          <div
            className="w-10 h-10 rounded-full bg-white/95 border border-white shadow-md absolute flex items-center justify-center pointer-events-none"
            style={{
              transform: `translate(${joystickKnob.x}px, ${joystickKnob.y}px)`,
              transition: joystickActive ? 'none' : 'transform 0.15s ease-out',
            }}
          >
            <div className="w-3 h-3 rounded-full bg-black/70" />
          </div>
        </div>
      </div>

      {/* Single Clean Jump Button on Bottom Right */}
      <div className="ui-touch-interactive absolute bottom-20 sm:bottom-24 right-5 sm:right-8 pointer-events-auto">
        <button
          onTouchStart={(e) => {
            e.stopPropagation();
            setJumpPressed(true);
            emitInput();
          }}
          onTouchEnd={(e) => {
            e.stopPropagation();
            setJumpPressed(false);
            emitInput();
          }}
          onMouseDown={() => {
            setJumpPressed(true);
            emitInput();
          }}
          onMouseUp={() => {
            setJumpPressed(false);
            emitInput();
          }}
          className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-black/50 backdrop-blur-md border border-white/30 text-white flex items-center justify-center active:scale-90 active:bg-white active:text-black shadow-lg transition"
          title="Jump"
        >
          <ArrowUp className="w-6 h-6 stroke-[2.5]" />
        </button>
      </div>

      {/* Authentic Minecraft 9-Slot Hotbar (Using user's hotbar.png and hotbar_selection.png) */}
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
            backgroundImage: 'url(/textures/gui/hotbar.png)',
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
                  backgroundImage: 'url(/textures/gui/hotbar_selection.png)',
                  backgroundSize: '100% 100%',
                  imageRendering: 'pixelated',
                  zIndex: 10,
                }}
              />
            );
          })()}

          {/* 9 Hotbar Slots */}
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
                  height: '40px',
                  marginLeft: idx === 0 ? '2px' : '0px',
                }}
                title={`${idx + 1}: ${item.name}`}
              >
                {/* Pixel Block Icon */}
                <div
                  className="w-6 h-6 rounded-xs shadow-md border"
                  style={{
                    backgroundColor: item.color,
                    borderColor: item.border,
                  }}
                />
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
