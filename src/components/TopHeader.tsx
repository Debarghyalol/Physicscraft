import React from 'react';
import { Maximize2 } from 'lucide-react';

export const TopHeader: React.FC = () => {
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
    <header className="fixed top-0 left-0 right-0 z-40 pointer-events-none p-3 sm:p-4">
      {!isFullscreen && (
        <button
          type="button"
          onClick={handleToggleLandscape}
          className="pointer-events-auto absolute right-3 sm:right-4 top-3 sm:top-4 p-2 rounded-xl bg-black/50 hover:bg-black/75 backdrop-blur-md border border-white/20 text-white shadow-lg transition active:scale-95"
          title="Fullscreen / Landscape Mode"
          aria-label="Enter fullscreen"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      )}
    </header>
  );
};