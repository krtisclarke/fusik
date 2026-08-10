// The catalog of instrument "voices" the studio can make.
//
// This is pure reference data — no audio code — so the model and UI can use it
// freely. The audio layer (audio/synth.ts) reads each voice's `defaults` and
// turns the numbers into actual sound. A track's `instrument.params` overrides
// these defaults; an empty override object means "sound exactly like this".
//
// Every sound here is synthesized from scratch, so there are zero sample
// licensing concerns and every parameter is something a child can tweak.

export type VoiceCategory = 'Drums' | 'Bass' | 'Keys' | 'Cymbals' | 'Percussion';

/** Drum voices play a fixed sound; pitched voices play melodic notes. */
export type VoiceKind = 'drum' | 'pitched';

export interface VoiceDef {
  id: string;
  label: string;
  emoji: string;
  category: VoiceCategory;
  /** Tint for this voice's clips and library tile. */
  color: string;
  /** 'drum' (default) or 'pitched'. */
  kind?: VoiceKind;
  /** For pitched voices: lowest octave (MIDI) the note-grid starts from. */
  baseMidi?: number;
  /** For pitched voices: how many octaves of the scale the note-grid spans. */
  octaves?: number;
  /** Base parameters for the synth. Overridable per track. */
  defaults: Record<string, number>;
}

export function isPitched(voice: VoiceDef | undefined): boolean {
  return voice?.kind === 'pitched';
}

export const VOICE_CATALOG: VoiceDef[] = [
  {
    id: 'kick',
    label: 'Kick',
    emoji: '🥁',
    category: 'Drums',
    color: '#ef4444',
    defaults: { tune: 50, pitchDrop: 110, decay: 0.34, click: 0.4, drive: 0.15, gain: 1.0 },
  },
  {
    id: 'snare',
    label: 'Snare',
    emoji: '🪘',
    category: 'Drums',
    color: '#f59e0b',
    defaults: { tune: 180, decay: 0.2, noise: 0.7, tone: 2200, gain: 0.9 },
  },
  {
    id: 'hihat',
    label: 'Hi-Hat',
    emoji: '🎩',
    category: 'Cymbals',
    color: '#22d3ee',
    defaults: { decay: 0.05, tone: 8000, gain: 0.55 },
  },
  {
    id: 'openhat',
    label: 'Open Hat',
    emoji: '👒',
    category: 'Cymbals',
    color: '#2dd4bf',
    defaults: { decay: 0.32, tone: 8000, gain: 0.5 },
  },
  {
    id: 'clap',
    label: 'Clap',
    emoji: '👏',
    category: 'Percussion',
    color: '#a78bfa',
    defaults: { decay: 0.18, tone: 1500, gain: 0.8 },
  },
  {
    id: 'tom',
    label: 'Tom',
    emoji: '🛢️',
    category: 'Drums',
    color: '#fb923c',
    defaults: { tune: 120, pitchDrop: 70, decay: 0.34, click: 0.1, drive: 0.0, gain: 0.9 },
  },
  {
    id: 'crash',
    label: 'Crash',
    emoji: '💥',
    category: 'Cymbals',
    color: '#eab308',
    defaults: { decay: 1.3, tone: 5000, gain: 0.5 },
  },
  {
    id: 'ride',
    label: 'Ride',
    emoji: '🔔',
    category: 'Cymbals',
    color: '#84cc16',
    defaults: { decay: 0.85, tone: 7000, gain: 0.45 },
  },
  {
    id: 'rim',
    label: 'Rim',
    emoji: '🥢',
    category: 'Percussion',
    color: '#f472b6',
    defaults: { tune: 1700, decay: 0.05, gain: 0.7 },
  },
  {
    id: 'shaker',
    label: 'Shaker',
    emoji: '🧂',
    category: 'Percussion',
    color: '#38bdf8',
    defaults: { decay: 0.06, tone: 6500, gain: 0.5 },
  },
  {
    id: 'cowbell',
    label: 'Cowbell',
    emoji: '🐄',
    category: 'Percussion',
    color: '#f97316',
    defaults: { tune: 540, decay: 0.35, gain: 0.6 },
  },
  {
    id: 'perc',
    label: 'Blip',
    emoji: '✨',
    category: 'Percussion',
    color: '#c084fc',
    defaults: { tune: 420, decay: 0.22, gain: 0.6 },
  },

  // ---- Pitched instruments (wave: 0=sine 1=triangle 2=saw 3=square) ----
  {
    id: 'piano',
    label: 'Piano',
    emoji: '🎹',
    category: 'Keys',
    color: '#60a5fa',
    kind: 'pitched',
    baseMidi: 60,
    octaves: 2,
    defaults: { wave: 1, attack: 0.005, decay: 0.5, sustain: 0.0, release: 0.3, cutoff: 6000, detune: 5, gain: 0.5 },
  },
  {
    id: 'synth',
    label: 'Synth',
    emoji: '🎚️',
    category: 'Keys',
    color: '#a855f7',
    kind: 'pitched',
    baseMidi: 60,
    octaves: 2,
    defaults: { wave: 2, attack: 0.02, decay: 0.25, sustain: 0.6, release: 0.25, cutoff: 3500, detune: 9, gain: 0.42 },
  },
  {
    id: 'bells',
    label: 'Bells',
    emoji: '🛎️',
    category: 'Keys',
    color: '#f0abfc',
    kind: 'pitched',
    baseMidi: 72,
    octaves: 2,
    defaults: { wave: 0, attack: 0.002, decay: 0.9, sustain: 0.0, release: 0.5, cutoff: 9000, detune: 0, gain: 0.4 },
  },
  {
    id: 'bass',
    label: 'Bass',
    emoji: '🎸',
    category: 'Bass',
    color: '#34d399',
    kind: 'pitched',
    baseMidi: 36,
    octaves: 2,
    defaults: { wave: 2, attack: 0.005, decay: 0.2, sustain: 0.5, release: 0.14, cutoff: 1500, detune: 4, gain: 0.55 },
  },
];

const VOICE_BY_ID = new Map(VOICE_CATALOG.map((v) => [v.id, v]));

export function getVoice(voiceId: string): VoiceDef | undefined {
  return VOICE_BY_ID.get(voiceId);
}

/** Merge a voice's defaults with per-track overrides into a full param set. */
export function resolveParams(
  voiceId: string,
  overrides: Record<string, number>,
): Record<string, number> {
  const voice = VOICE_BY_ID.get(voiceId);
  return { ...(voice?.defaults ?? {}), ...overrides };
}
