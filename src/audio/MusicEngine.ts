/**
 * Minecraft-style music player.
 *
 * Uses the sound assets already present in /sounds/music instead of the old
 * procedural synthesizer. Menu and in-game music are deliberately separate,
 * matching Minecraft's menu/game sound groups.
 */

export type MusicMode = 'menu' | 'game' | 'disc';
export type MusicDiscId = '11' | '13' | '5' | 'blocks' | 'bounce' | 'cat' | 'chirp' | 'creator' | 'creator_music_box' | 'far' | 'lava_chicken' | 'mall' | 'mellohi' | 'otherside' | 'pigstep' | 'precipice' | 'relic' | 'stal' | 'strad' | 'tears' | 'wait' | 'ward';

export const MUSIC_DISCS: { id: MusicDiscId; title: string }[] = [
  { id: '11', title: '11' }, { id: '13', title: '13' }, { id: '5', title: '5' },
  { id: 'blocks', title: 'Blocks' }, { id: 'bounce', title: 'Creator - Bounce' }, { id: 'cat', title: 'Cat' },
  { id: 'chirp', title: 'Chirp' }, { id: 'creator', title: 'Creator' }, { id: 'creator_music_box', title: 'Creator - Music Box' },
  { id: 'far', title: 'Far' }, { id: 'lava_chicken', title: 'Lava Chicken' }, { id: 'mall', title: 'Mall' },
  { id: 'mellohi', title: 'Mellohi' }, { id: 'otherside', title: 'Otherside' }, { id: 'pigstep', title: 'Pigstep' },
  { id: 'precipice', title: 'Precipice' }, { id: 'relic', title: 'Relic' }, { id: 'stal', title: 'Stal' },
  { id: 'strad', title: 'Strad' }, { id: 'tears', title: 'Tears' }, { id: 'wait', title: 'Wait' }, { id: 'ward', title: 'Ward' },
];

export interface MusicTrackInfo {
  id: string;
  title: string;
  artist: string;
  type: 'minecraft';
  description: string;
}

const MENU_MUSIC = Object.values(
  import.meta.glob('../../sounds/music/menu/*.ogg', {
    eager: true,
    query: '?url',
    import: 'default',
  })
) as string[];

const DISC_MUSIC = Object.values(
  import.meta.glob('../../sounds/records/*.ogg', {
    eager: true,
    query: '?url',
    import: 'default',
  })
) as string[];

const GAME_MUSIC = Object.values(
  import.meta.glob('../../sounds/music/game/*.ogg', {
    eager: true,
    query: '?url',
    import: 'default',
  })
) as string[];

export const MUSIC_TRACKS: MusicTrackInfo[] = [
  { id: 'menu', title: 'Minecraft Menu', artist: 'Minecraft', type: 'minecraft', description: 'Vanilla menu music rotation' },
  { id: 'game', title: 'Minecraft Game', artist: 'Minecraft', type: 'minecraft', description: 'Vanilla overworld music rotation' },
];

class MusicEngine {
  private audio: HTMLAudioElement | null = null;
  private mode: MusicMode = 'menu';
  private currentUrl: string | null = null;
  private volume = 0.32;
  private muted = false;

  constructor() {
    if (typeof window !== 'undefined') {
      const retryPlayback = () => {
        if (!this.muted && this.audio?.paused) {
          void this.audio.play().catch(() => {});
        }
      };

      window.addEventListener('pointerdown', retryPlayback, { passive: true });
      window.addEventListener('touchstart', retryPlayback, { passive: true });
      window.addEventListener('keydown', retryPlayback, { passive: true });
    }
  }

  private getPool(mode: MusicMode): string[] {
    return mode === 'menu' ? MENU_MUSIC : GAME_MUSIC;
  }

  private pickTrack(mode: MusicMode): string | null {
    const pool = this.getPool(mode);
    if (pool.length === 0) return null;

    if (pool.length === 1) return pool[0];

    let candidate = pool[Math.floor(Math.random() * pool.length)];
    while (candidate === this.currentUrl) {
      candidate = pool[Math.floor(Math.random() * pool.length)];
    }
    return candidate;
  }

  private startTrack(url: string) {
    if (typeof window === 'undefined') return;

    this.stop();

    const audio = new Audio(url);
    audio.preload = 'auto';
    audio.volume = this.volume;
    audio.onended = () => {
      if (!this.muted) {
        const next = this.pickTrack(this.mode);
        if (next) {
          this.currentUrl = next;
          this.startTrack(next);
        }
      }
    };
    audio.onerror = () => {
      // Skip an unavailable/corrupt asset without falling back to procedural music.
      if (!this.muted) {
        const next = this.pickTrack(this.mode);
        if (next && next !== url) {
          this.currentUrl = next;
          this.startTrack(next);
        }
      }
    };

    this.audio = audio;
    this.currentUrl = url;
    void audio.play().catch(() => {
      // Browser autoplay policy: the gesture listener in the constructor retries it.
    });
  }

  private startMode(mode: MusicMode) {
    if (this.mode === mode && this.audio && !this.audio.paused) return;

    this.mode = mode;
    if (this.muted) return;

    const track = this.pickTrack(mode);
    if (track) this.startTrack(track);
  }

  public playMenu() {
    this.startMode('menu');
  }

  public playGame() {
    this.startMode('game');
  }

  public playDisc(id: MusicDiscId) {
    if (this.muted) return;
    const url = DISC_MUSIC.find((candidate) => candidate.endsWith('/' + id + '.ogg'));
    if (!url) return;
    this.mode = 'disc';
    this.startTrack(url);
  }

  public stopDisc() {
    if (this.mode !== 'disc') return;
    this.stop();
    this.mode = 'game';
  }

  public stop() {
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio.onended = null;
      this.audio.onerror = null;
    }
    this.audio = null;
  }

  public setMuted(muted: boolean) {
    this.muted = muted;

    if (muted) {
      this.stop();
      return;
    }

    const track = this.pickTrack(this.mode);
    if (track) this.startTrack(track);
  }

  public setVolume(volume: number) {
    this.volume = Math.min(Math.max(volume, 0), 1);
    if (this.audio) this.audio.volume = this.volume;
  }

  public getVolume(): number {
    return this.volume;
  }

  public getMode(): MusicMode {
    return this.mode;
  }

  public getIsPlaying(): boolean {
    return !!this.audio && !this.audio.paused;
  }
}

export const musicEngine = new MusicEngine();
