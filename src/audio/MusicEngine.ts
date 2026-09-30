/**
 * High-Quality Procedural & Open-Source Music Engine
 * Uses Web Audio API to procedurally generate ambient soundscapes and synthesize
 * open-source classical masterpieces without external network dependencies.
 */

export type MusicTrackId =
  | 'zen_ambient'
  | 'lofi_physics'
  | 'deep_space'
  | 'gymnopedie'
  | 'clair_de_lune'
  | 'canon_d';

export interface MusicTrackInfo {
  id: MusicTrackId;
  title: string;
  artist: string;
  type: 'procedural' | 'open-source';
  description: string;
}

export const MUSIC_TRACKS: MusicTrackInfo[] = [
  {
    id: 'zen_ambient',
    title: 'Ethereal Zen Pad',
    artist: 'Procedural Generative',
    type: 'procedural',
    description: 'Evolving generative ambient pads with delicate pentatonic bells',
  },
  {
    id: 'lofi_physics',
    title: 'Warm Physics Study',
    artist: 'Procedural Chill',
    type: 'procedural',
    description: 'Soft electric piano ninth chords with gentle tape flutter',
  },
  {
    id: 'deep_space',
    title: 'Weightless Orbit',
    artist: 'Procedural Drone',
    type: 'procedural',
    description: 'Deep resonant sub-drone with expansive space harmonics',
  },
  {
    id: 'gymnopedie',
    title: 'Gymnopédie No. 1',
    artist: 'Erik Satie (Open Source)',
    type: 'open-source',
    description: 'Iconic serene French impressionist piano waltz (Public Domain)',
  },
  {
    id: 'clair_de_lune',
    title: 'Clair de Lune',
    artist: 'Claude Debussy (Open Source)',
    type: 'open-source',
    description: 'Gentle, dreamy nocturnal piano melody (Public Domain)',
  },
  {
    id: 'canon_d',
    title: 'Canon in D',
    artist: 'Johann Pachelbel (Open Source)',
    type: 'open-source',
    description: 'Uplifting baroque harmonic progression (Public Domain)',
  },
];

class MusicEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private isPlaying: boolean = false;
  private currentTrackId: MusicTrackId = 'zen_ambient';
  private volume: number = 0.45;
  private activeTimers: number[] = [];

  // Musical frequency tables
  private static midiToFreq(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  private initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
  }

  public getVolume(): number {
    return this.volume;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public getCurrentTrack(): MusicTrackId {
    return this.currentTrackId;
  }

  public setTrack(trackId: MusicTrackId) {
    const wasPlaying = this.isPlaying;
    this.stop();
    this.currentTrackId = trackId;
    if (wasPlaying) {
      this.play();
    }
  }

  public play() {
    this.initContext();
    if (!this.ctx || !this.masterGain) return;

    this.stop();
    this.isPlaying = true;

    switch (this.currentTrackId) {
      case 'zen_ambient':
        this.startZenAmbient();
        break;
      case 'lofi_physics':
        this.startLofiChill();
        break;
      case 'deep_space':
        this.startDeepSpace();
        break;
      case 'gymnopedie':
        this.startGymnopedie();
        break;
      case 'clair_de_lune':
        this.startClairDeLune();
        break;
      case 'canon_d':
        this.startCanonInD();
        break;
      default:
        this.startZenAmbient();
        break;
    }
  }

  public stop() {
    this.isPlaying = false;
    this.activeTimers.forEach((timer) => clearTimeout(timer));
    this.activeTimers = [];
  }

  public togglePlay() {
    if (this.isPlaying) {
      this.stop();
    } else {
      this.play();
    }
  }

  // --- Sound Generation Primitives ---

  /** Play a warm bell / chime note */
  private playBell(midi: number, duration: number = 3.5, gainLevel: number = 0.15) {
    if (!this.ctx || !this.masterGain) return;
    const t0 = this.ctx.currentTime;
    const freq = MusicEngine.midiToFreq(midi);

    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(freq, t0);

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq * 2.01, t0); // Slight harmonic overtone

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(gainLevel, t0 + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.masterGain);

    osc1.start(t0);
    osc2.start(t0);
    osc1.stop(t0 + duration + 0.1);
    osc2.stop(t0 + duration + 0.1);
  }

  /** Play a warm Rhodes electric piano chord */
  private playWarmPianoChord(midis: number[], duration: number = 4.0, gainLevel: number = 0.18) {
    if (!this.ctx || !this.masterGain) return;
    const t0 = this.ctx.currentTime;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, t0);
    filter.frequency.exponentialRampToValueAtTime(450, t0 + duration);
    filter.connect(this.masterGain);

    midis.forEach((midi, i) => {
      if (!this.ctx) return;
      const freq = MusicEngine.midiToFreq(midi);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t0);

      // Stagger notes slightly for human arpeggio feel
      const noteDelay = i * 0.035;
      gain.gain.setValueAtTime(0.0001, t0 + noteDelay);
      gain.gain.linearRampToValueAtTime(gainLevel, t0 + noteDelay + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

      osc.connect(gain);
      gain.connect(filter);

      osc.start(t0 + noteDelay);
      osc.stop(t0 + duration + 0.1);
    });
  }

  // --- Track Implementations ---

  /** 1. Zen Ambient: Generative peaceful pads with pentatonic chimes */
  private startZenAmbient() {
    const chords = [
      [57, 60, 64, 67, 72], // Am9
      [53, 57, 60, 65, 69], // Fmaj9
      [55, 59, 62, 67, 71], // G9
      [48, 55, 60, 64, 67], // Cmaj7
    ];
    const pentatonic = [60, 62, 64, 67, 69, 72, 74, 76];

    let chordIndex = 0;

    const stepChord = () => {
      if (!this.isPlaying) return;
      const chord = chords[chordIndex % chords.length];
      this.playWarmPianoChord(chord, 5.5, 0.14);
      chordIndex++;

      // Schedule random high bell chimes
      const chimeCount = 2 + Math.floor(Math.random() * 3);
      for (let c = 0; c < chimeCount; c++) {
        const delay = 400 + Math.random() * 4500;
        const note = pentatonic[Math.floor(Math.random() * pentatonic.length)];
        const timer = window.setTimeout(() => {
          if (this.isPlaying) this.playBell(note, 3.5, 0.08);
        }, delay);
        this.activeTimers.push(timer);
      }

      const nextTimer = window.setTimeout(stepChord, 6000);
      this.activeTimers.push(nextTimer);
    };

    stepChord();
  }

  /** 2. Lo-Fi Physics Study: Relaxing chord loops */
  private startLofiChill() {
    const progression = [
      [50, 57, 62, 65, 69], // Dm9
      [43, 55, 59, 65, 69], // G13
      [48, 55, 59, 64, 67], // Cmaj9
      [45, 52, 57, 60, 64], // Am7
    ];

    let step = 0;
    const playNext = () => {
      if (!this.isPlaying) return;
      const chord = progression[step % progression.length];
      this.playWarmPianoChord(chord, 3.8, 0.16);

      // Little bass tick
      this.playBell(chord[0] - 12, 1.2, 0.12);

      step++;
      const timer = window.setTimeout(playNext, 4000);
      this.activeTimers.push(timer);
    };

    playNext();
  }

  /** 3. Deep Space Drone: Expansive low frequencies & shimmer */
  private startDeepSpace() {
    const droneRoots = [36, 41, 43, 38]; // C, F, G, D
    let idx = 0;

    const droneStep = () => {
      if (!this.isPlaying) return;
      const root = droneRoots[idx % droneRoots.length];
      this.playWarmPianoChord([root, root + 7, root + 14, root + 19], 7.0, 0.15);
      idx++;

      const timer = window.setTimeout(droneStep, 7500);
      this.activeTimers.push(timer);
    };

    droneStep();
  }

  /** 4. Erik Satie - Gymnopédie No. 1 */
  private startGymnopedie() {
    // Measures of Gymnopédie: Bass note -> 2 mid chords -> melody
    const measures: { bass: number; chord: number[]; melody?: number }[] = [
      { bass: 43, chord: [59, 62, 66] }, // G - B D F#
      { bass: 38, chord: [57, 62, 66] }, // D - A D F#
      { bass: 43, chord: [59, 62, 66], melody: 69 }, // A
      { bass: 38, chord: [57, 62, 66], melody: 67 }, // G
      { bass: 43, chord: [59, 62, 66], melody: 66 }, // F#
      { bass: 38, chord: [57, 62, 66], melody: 62 }, // D
      { bass: 40, chord: [55, 59, 64], melody: 64 }, // E - G B E
      { bass: 38, chord: [57, 62, 66], melody: 62 }, // D
    ];

    let mIdx = 0;

    const playMeasure = () => {
      if (!this.isPlaying) return;
      const m = measures[mIdx % measures.length];

      // 1. Bass note on beat 1
      this.playBell(m.bass, 2.5, 0.16);

      // 2. Chords on beats 2 and 3
      const t1 = window.setTimeout(() => {
        if (this.isPlaying) this.playWarmPianoChord(m.chord, 1.8, 0.12);
      }, 700);
      const t2 = window.setTimeout(() => {
        if (this.isPlaying) this.playWarmPianoChord(m.chord, 1.8, 0.12);
      }, 1400);

      // 3. Melody note if present
      if (m.melody) {
        const tMel = window.setTimeout(() => {
          if (this.isPlaying) this.playBell(m.melody!, 3.0, 0.22);
        }, 750);
        this.activeTimers.push(tMel);
      }

      this.activeTimers.push(t1, t2);

      mIdx++;
      const nextTimer = window.setTimeout(playMeasure, 2400);
      this.activeTimers.push(nextTimer);
    };

    playMeasure();
  }

  /** 5. Claude Debussy - Clair de Lune */
  private startClairDeLune() {
    // 9/8 Impressionist arpeggiation
    const phraseNotes = [
      { notes: [65, 68, 72], delay: 0 },
      { notes: [63, 67, 70], delay: 1200 },
      { notes: [61, 65, 68], delay: 2400 },
      { notes: [60, 63, 67], delay: 3600 },
      { notes: [58, 61, 65, 70], delay: 4800 },
      { notes: [56, 60, 63, 68], delay: 6000 },
    ];

    let pIdx = 0;
    const playPhrase = () => {
      if (!this.isPlaying) return;
      const p = phraseNotes[pIdx % phraseNotes.length];
      this.playWarmPianoChord(p.notes, 3.2, 0.16);
      pIdx++;

      const timer = window.setTimeout(playPhrase, 2200);
      this.activeTimers.push(timer);
    };

    playPhrase();
  }

  /** 6. Johann Pachelbel - Canon in D */
  private startCanonInD() {
    const chords = [
      { bass: 50, notes: [62, 66, 69] }, // D
      { bass: 45, notes: [57, 61, 64] }, // A
      { bass: 47, notes: [59, 62, 66] }, // Bm
      { bass: 42, notes: [54, 57, 61] }, // F#m
      { bass: 43, notes: [55, 59, 62] }, // G
      { bass: 38, notes: [50, 54, 57] }, // D
      { bass: 43, notes: [55, 59, 62] }, // G
      { bass: 45, notes: [57, 61, 64] }, // A
    ];

    let cIdx = 0;
    const playProgression = () => {
      if (!this.isPlaying) return;
      const step = chords[cIdx % chords.length];

      this.playBell(step.bass, 2.2, 0.15);
      this.playWarmPianoChord(step.notes, 2.0, 0.14);

      cIdx++;
      const timer = window.setTimeout(playProgression, 2000);
      this.activeTimers.push(timer);
    };

    playProgression();
  }
}

export const musicEngine = new MusicEngine();
