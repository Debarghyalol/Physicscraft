/**
 * Procedural Audio Synthesizer & Android Haptic Feedback
 * Produces crisp, tactile impact sounds and haptic pulses for physics collisions.
 */

class SoundSynthesizer {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private lastSoundTimes: Map<string, number> = new Map();
  private isUnlocked: boolean = false;
  private soundPools: Map<string, HTMLAudioElement[]> = new Map();

  // Keep the Minecraft asset hierarchy intact: dig/* is used for block break/place,
  // while step/* is used for footsteps. UI button clicks use random/click_stereo.
  private readonly soundAssets: Record<string, string[]> = {
    dig_grass: Object.values(import.meta.glob('../../sounds/dig/grass*.ogg', {
      eager: true,
      query: '?url',
      import: 'default',
    })) as string[],
    dig_stone: Object.values(import.meta.glob('../../sounds/dig/stone*.ogg', {
      eager: true,
      query: '?url',
      import: 'default',
    })) as string[],
    dig_wood: Object.values(import.meta.glob('../../sounds/dig/wood*.ogg', {
      eager: true,
      query: '?url',
      import: 'default',
    })) as string[],
    dig_sand: Object.values(import.meta.glob('../../sounds/dig/sand*.ogg', {
      eager: true,
      query: '?url',
      import: 'default',
    })) as string[],

    step_grass: Object.values(import.meta.glob('../../sounds/step/grass*.ogg', {
      eager: true,
      query: '?url',
      import: 'default',
    })) as string[],
    step_stone: Object.values(import.meta.glob('../../sounds/step/stone*.ogg', {
      eager: true,
      query: '?url',
      import: 'default',
    })) as string[],
    step_wood: Object.values(import.meta.glob('../../sounds/step/wood*.ogg', {
      eager: true,
      query: '?url',
      import: 'default',
    })) as string[],
    step_sand: Object.values(import.meta.glob('../../sounds/step/sand*.ogg', {
      eager: true,
      query: '?url',
      import: 'default',
    })) as string[],

    ui_button: Object.values(import.meta.glob('../../sounds/random/click_stereo.ogg', {
      eager: true,
      query: '?url',
      import: 'default',
    })) as string[],
    fall_small: Object.values(import.meta.glob('../../sounds/damage/fallsmall.ogg', {
      eager: true,
      query: '?url',
      import: 'default',
    })) as string[],
    fall_big: Object.values(import.meta.glob('../../sounds/damage/fallbig.ogg', {
      eager: true,
      query: '?url',
      import: 'default',
    })) as string[],
  };

  private playAsset(url: string, volume: number = 1.0, playbackRate: number = 1.0): void {
    if (this.isMuted || typeof window === 'undefined') return;

    let pool = this.soundPools.get(url);
    if (!pool) {
      pool = [];
      this.soundPools.set(url, pool);
    }

    let audio = pool.find((candidate) => candidate.paused || candidate.ended);
    if (!audio) {
      audio = new Audio(url);
      audio.preload = 'auto';
      pool.push(audio);
    }

    audio.volume = Math.min(Math.max(volume, 0), 1);
    audio.playbackRate = playbackRate;
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  }

  private playAssetGroup(
    group: keyof typeof this.soundAssets,
    volume: number,
    minRate: number,
    maxRate: number
  ): void {
    const variants = this.soundAssets[group];
    const url = variants[Math.floor(Math.random() * variants.length)];
    this.playAsset(url, volume, minRate + Math.random() * (maxRate - minRate));
  }

  constructor() {
    if (typeof window !== 'undefined') {
      const unlockAudio = () => {
        this.initCtx();
        if (this.ctx && this.ctx.state === 'running') {
          this.isUnlocked = true;
          window.removeEventListener('pointerdown', unlockAudio);
          window.removeEventListener('touchstart', unlockAudio);
          window.removeEventListener('keydown', unlockAudio);
        }
      };
      window.addEventListener('pointerdown', unlockAudio, { passive: true });
      window.addEventListener('touchstart', unlockAudio, { passive: true });
      window.addEventListener('keydown', unlockAudio, { passive: true });
    }
  }

  public initCtx() {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public triggerHaptic(durationMs: number | number[] = 15) {
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(durationMs);
      }
    } catch {
      // Haptics unavailable in iframe or unsupported device
    }
  }

  /**
   * Sound when blocks collide with each other or the terrain
   * @param material 'wood' | 'stone' | 'metal' | 'rubber' | 'ice' | 'tnt'
   * @param intensity Impact strength 0.0 to 1.0 (derived from impact speed)
   */
  public playImpact(material: string = 'wood', intensity: number = 0.5) {
    if (this.isMuted) return;

    // Rate-limit collision audio per material to avoid harsh sound overlap
    const now = performance.now();
    const lastTime = this.lastSoundTimes.get(material) || 0;
    if (now - lastTime < 35) return;
    this.lastSoundTimes.set(material, now);

    this.initCtx();
    if (!this.ctx) return;

    const volume = Math.min(Math.max(intensity, 0.08), 1.0);
    const audioTime = this.ctx.currentTime;

    if (material === 'wood') {
      // Rich acoustic wood knock: resonant low-pass triangle
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(420 + Math.random() * 80, audioTime);

      osc.type = 'triangle';
      const baseFreq = 160 + Math.random() * 50;
      osc.frequency.setValueAtTime(baseFreq, audioTime);
      osc.frequency.exponentialRampToValueAtTime(55, audioTime + 0.07);

      gain.gain.setValueAtTime(volume * 0.65, audioTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioTime + 0.08);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(audioTime);
      osc.stop(audioTime + 0.09);
    } else if (material === 'stone') {
      // Heavy granite stone clack: bandpass click with low-frequency thump
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(550, audioTime);
      filter.Q.setValueAtTime(2.5, audioTime);

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220 + Math.random() * 60, audioTime);
      osc.frequency.exponentialRampToValueAtTime(70, audioTime + 0.06);

      gain.gain.setValueAtTime(volume * 0.7, audioTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioTime + 0.07);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(audioTime);
      osc.stop(audioTime + 0.08);
    } else if (material === 'metal') {
      // Crisp metallic clang with harmonic overtone
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(820 + Math.random() * 80, audioTime);
      osc1.frequency.exponentialRampToValueAtTime(400, audioTime + 0.2);

      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1640 + Math.random() * 100, audioTime);

      gain.gain.setValueAtTime(volume * 0.5, audioTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioTime + 0.22);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc1.start(audioTime);
      osc2.start(audioTime);
      osc1.stop(audioTime + 0.24);
      osc2.stop(audioTime + 0.24);
    } else if (material === 'rubber') {
      // Squishy spring bounce / boing
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(180, audioTime);
      osc.frequency.exponentialRampToValueAtTime(420, audioTime + 0.05);
      osc.frequency.exponentialRampToValueAtTime(140, audioTime + 0.12);

      gain.gain.setValueAtTime(volume * 0.55, audioTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioTime + 0.13);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(audioTime);
      osc.stop(audioTime + 0.14);
    } else if (material === 'ice') {
      // Glassy crystal clink
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(1400 + Math.random() * 300, audioTime);
      osc.frequency.exponentialRampToValueAtTime(800, audioTime + 0.05);

      gain.gain.setValueAtTime(volume * 0.35, audioTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioTime + 0.06);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(audioTime);
      osc.stop(audioTime + 0.07);
    } else {
      // Default ground impact thump
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(120, audioTime);
      osc.frequency.exponentialRampToValueAtTime(40, audioTime + 0.09);

      gain.gain.setValueAtTime(volume * 0.6, audioTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioTime + 0.1);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(audioTime);
      osc.stop(audioTime + 0.11);
    }

    if (intensity > 0.45) {
      this.triggerHaptic(Math.min(30, Math.round(intensity * 25)));
    }
  }

  public playCannonShoot() {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    const audioTime = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, audioTime);
    osc.frequency.exponentialRampToValueAtTime(30, audioTime + 0.24);

    gain.gain.setValueAtTime(0.7, audioTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioTime + 0.26);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(audioTime);
    osc.stop(audioTime + 0.28);

    this.triggerHaptic([35, 20, 45]);
  }

  public playExplosion() {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    const audioTime = this.ctx.currentTime;

    // Sub-bass boom
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, audioTime);
    osc.frequency.exponentialRampToValueAtTime(18, audioTime + 0.5);
    gain.gain.setValueAtTime(0.85, audioTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioTime + 0.55);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(audioTime);
    osc.stop(audioTime + 0.56);

    // Noise crackle
    const bufferSize = this.ctx.sampleRate * 0.45;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, audioTime);
    filter.frequency.exponentialRampToValueAtTime(80, audioTime + 0.45);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.65, audioTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, audioTime + 0.45);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.ctx.destination);

    noise.start(audioTime);
    noise.stop(audioTime + 0.48);

    this.triggerHaptic([70, 30, 90]);
  }

  public playBlockBreak(type: 'grass' | 'stone' | 'wood' | 'sand' = 'stone') {
    if (this.isMuted) return;

    const now = performance.now();
    const last = this.lastSoundTimes.get('block-break') || 0;
    if (now - last < 70) return;
    this.lastSoundTimes.set('block-break', now);

    const group = type === 'grass'
      ? 'dig_grass'
      : type === 'wood'
        ? 'dig_wood'
        : type === 'sand'
          ? 'dig_sand'
          : 'dig_stone';

    this.playAssetGroup(group, 0.72, 0.96, 1.04);
    this.triggerHaptic(20);
  }

  public playBlockPlace(type: 'grass' | 'stone' | 'wood' | 'sand' = 'stone') {
    if (this.isMuted) return;

    const now = performance.now();
    const last = this.lastSoundTimes.get('block-place') || 0;
    if (now - last < 70) return;
    this.lastSoundTimes.set('block-place', now);

    // Vanilla Java block.place reuses the material's dig/* sounds.
    const group = type === 'grass'
      ? 'dig_grass'
      : type === 'wood'
        ? 'dig_wood'
        : type === 'sand'
          ? 'dig_sand'
          : 'dig_stone';

    this.playAssetGroup(group, 0.8, 0.96, 1.04);
    this.triggerHaptic(15);
  }


  public playFootstep(material: 'grass' | 'stone' | 'wood' | 'sand' = 'grass') {
    if (this.isMuted) return;

    const now = performance.now();
    const last = this.lastSoundTimes.get('step') || 0;
    if (now - last < 260) return;
    this.lastSoundTimes.set('step', now);

    const group = material === 'grass'
      ? 'step_grass'
      : material === 'wood'
        ? 'step_wood'
        : material === 'sand'
          ? 'step_sand'
          : 'step_stone';

    this.playAssetGroup(group, 0.15, 0.94, 1.06);
  }

  public playUiClick() {
    if (this.isMuted) return;
    this.playAssetGroup('ui_button', 0.35, 0.98, 1.02);
  }

  public playLanding(fallSpeed: number) {
    if (this.isMuted || fallSpeed < 5) return;

    if (fallSpeed >= 12) {
      this.playAsset(this.soundAssets.fall_big[0], 0.55, 0.95 + Math.random() * 0.08);
    } else {
      this.playAsset(this.soundAssets.fall_small[0], 0.5, 0.96 + Math.random() * 0.08);
    }
    this.triggerHaptic(Math.min(35, Math.round(fallSpeed * 1.5)));
  }

  public playJump() {
    // Minecraft Java 1.21.x has no entity.player.jump sound event.
    // Keep this method as a no-op so callers cannot reintroduce a procedural jump sound.
  }

() {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    const audioTime = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, audioTime);
    osc.frequency.exponentialRampToValueAtTime(260, audioTime + 0.1);

    gain.gain.setValueAtTime(0.25, audioTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioTime + 0.11);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(audioTime);
    osc.stop(audioTime + 0.12);
    this.triggerHaptic(15);
  }

  public playPop(isLift: boolean = true) {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    const audioTime = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    if (isLift) {
      osc.frequency.setValueAtTime(340, audioTime);
      osc.frequency.exponentialRampToValueAtTime(580, audioTime + 0.05);
    } else {
      osc.frequency.setValueAtTime(520, audioTime);
      osc.frequency.exponentialRampToValueAtTime(240, audioTime + 0.05);
    }

    gain.gain.setValueAtTime(0.3, audioTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioTime + 0.06);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(audioTime);
    osc.stop(audioTime + 0.07);

    this.triggerHaptic(12);
  }

  public playAssemble() {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    const audioTime = this.ctx.currentTime;

    // Heavy mechanical gear clunk + metallic ring (Minecraft Create style)
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    const gain2 = this.ctx.createGain();

    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(140, audioTime);
    osc1.frequency.exponentialRampToValueAtTime(70, audioTime + 0.18);

    gain1.gain.setValueAtTime(0.55, audioTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, audioTime + 0.22);

    osc2.type = 'square';
    osc2.frequency.setValueAtTime(420, audioTime + 0.04);
    osc2.frequency.exponentialRampToValueAtTime(880, audioTime + 0.16);

    gain2.gain.setValueAtTime(0.3, audioTime + 0.04);
    gain2.gain.exponentialRampToValueAtTime(0.001, audioTime + 0.26);

    osc1.connect(gain1);
    gain1.connect(this.ctx.destination);
    osc2.connect(gain2);
    gain2.connect(this.ctx.destination);

    osc1.start(audioTime);
    osc1.stop(audioTime + 0.24);
    osc2.start(audioTime + 0.04);
    osc2.stop(audioTime + 0.28);

    this.triggerHaptic([25, 40, 60]);
  }

  public playJointConnect() {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    const audioTime = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(280, audioTime);
    osc.frequency.linearRampToValueAtTime(640, audioTime + 0.08);

    gain.gain.setValueAtTime(0.35, audioTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioTime + 0.14);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(audioTime);
    osc.stop(audioTime + 0.15);
    this.triggerHaptic(20);
  }
}

export const soundManager = new SoundSynthesizer();
