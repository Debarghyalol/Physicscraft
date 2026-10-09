import React from 'react';
import { Maximize2 } from 'lucide-react';

interface TopHeaderProps {
  onOpenPauseMenu: () => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({ onOpenPauseMenu }) => {
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
    <header className="fixed inset-0 z-40 pointer-events-none p-3 sm:p-4">
      <button
        type="button"
        onClick={onOpenPauseMenu}
        // MCPE keeps the pause button small and tucked against the top-centre edge. The sprite is
        // 20x16 and already carries its own bevel, so it is drawn at that aspect ratio with no
        // extra border/background. The ::before pad keeps a finger-sized (44px) touch target.
        className="pointer-events-auto absolute left-1/2 top-0.5 -translate-x-1/2 w-[30px] h-6 transition active:scale-95 before:absolute before:-inset-2 before:content-['']"
        style={{
          backgroundImage: "url('/textures/gui/130366.png')",
          backgroundRepeat: 'no-repeat',
          backgroundSize: '100% 100%',
          backgroundPosition: 'center',
          imageRendering: 'pixelated',
        }}
        title="Open pause menu"
        aria-label="Open pause menu"
      />
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