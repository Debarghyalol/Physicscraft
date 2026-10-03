import React from 'react';
import { Settings, Maximize2, Minimize2 } from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';

interface TopHeaderProps {
  onOpenSettings: () => void;
  fps: number;
  blockCount: number;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  onOpenSettings,
  fps,
  blockCount,
}) => {
  const [isFullscreen, setIsFullscreen] = React.useState(false);

  React.useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement !== null);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handleToggleLandscape = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        if (screen.orientation && 'lock' in screen.orientation) {
          await (screen.orientation as any).lock('landscape').catch(() => {});
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
        if (screen.orientation && 'unlock' in screen.orientation) {
          (screen.orientation as any).unlock();
        }
      }
    } catch {
      // Ignored
    }
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-30 pointer-events-none flex items-center justify-between p-3 sm:p-4">
      {/* Top-Left: Clean Settings Button & Telemetry */}
      <div className="flex items-center gap-2 pointer-events-auto">
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-black/60 hover:bg-black/85 backdrop-blur-md border border-white/20 text-white font-mono text-xs font-semibold shadow-lg transition active:scale-95 group"
          title="Open Settings & Options (ESC)"
        >
          <div className="w-4 h-4 rounded-xs border-2 border-white flex items-center justify-center group-hover:bg-white group-hover:text-black transition">
            <Settings className="w-2.5 h-2.5" />
          </div>
          <span>OPTIONS</span>
        </button>

        {/* Minimal Transparent Telemetry */}
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/35 backdrop-blur-xs border border-white/10 text-[11px] font-mono text-white/70 tabular-nums">
          <span>{fps} FPS</span>
          <span className="opacity-40">·</span>
          <span>{blockCount} BLOCKS</span>
        </div>
      </div>

      {/* Top-Right: Quick Landscape & Reset (Minimal Transparent) */}
      <div className="flex items-center gap-2 pointer-events-auto">
        <button
          onClick={handleToggleLandscape}
          className="p-2 rounded-xl bg-black/50 hover:bg-black/75 backdrop-blur-md border border-white/20 text-white shadow-lg transition active:scale-95"
          title="Landscape / Fullscreen Mode"
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>

        <PWAInstallButton />
      </div>
    </header>
  );
};
