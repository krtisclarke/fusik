// The catalog of instrument "voices" the studio can make.
//
// This is pure reference data — no audio code — so the model and UI can use it
// freely. The audio layer (audio/synth.ts) reads each voice's `defaults` and
// turns the numbers into actual sound. A track's `instrument.params` overrides
// these defaults; an empty override object means "sound exactly like this".
//
// Most sounds here are synthesized from scratch. The acoustic ones — the
// instruments no amount of synthesis makes convincing — play recordings
// instead: a voice with a `sampleSet` is played by audio/sampler.ts from the
// files in public/samples/, and one without is built by audio/synth.ts. The two
// live together in the same song and behave identically everywhere else.
//
// Every recording is CC0. Provenance, licence and hashes: docs/asset-manifest.json.

export type VoiceCategory = 'Drums' | 'Bass' | 'Keys' | 'Mallets' | 'Cymbals' | 'Percussion' | 'Strings';

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
  /**
   * Recordings this voice plays, from model/sampleSets.ts. Absent means the
   * voice is synthesized. The parameters a sampled voice offers are different —
   * see the note at the top of this file.
   */
  sampleSet?: string;
  /** Base parameters. Overridable per block. */
  defaults: Record<string, number>;
}

export function isPitched(voice: VoiceDef | undefined): boolean {
  return voice?.kind === 'pitched';
}

/** Whether this voice plays a recording rather than building a sound. */
export function isSampled(voice: VoiceDef | undefined): boolean {
  return !!voice?.sampleSet;
}

/**
 * The controls a sampled voice offers.
 *
 * Volume, pitch, brightness, drive and attack all still mean exactly what they
 * meant on a synthesized voice — they shape the sound on its way out. Waveform
 * and detune describe how a sound is *built*, and there is nothing to build, so
 * they are absent rather than present and dead. `decay` is how long a drum rings
 * before it is cut; a pitched voice uses `release` instead, because its length
 * already comes from its block.
 */
/**
 * `gain` here is measured rather than guessed. Every recording is levelled to a
 * common loudness at build time, but instruments still differ in how much of
 * that loudness survives as a peak — a woodblock is all transient, a cymbal is
 * all tail — so each voice's level was set by rendering one hit and comparing it
 * against the synthesized voice it replaced. Values above 1 are normal and safe:
 * a recording peaks well below full scale by the time it has been levelled, and
 * the master limiter is the backstop either way.
 */
function sampledDefaults(gain: number, opts: { pitched?: boolean; seconds?: number }): Record<string, number> {
  // Insertion order is the order the Sound Editor draws them in, so the two a
  // child reaches for first come first.
  //
  // Brightness keeps the key each voice used when it was synthesized —
  // `cutoff` for the melodic ones, `tone` for the drums. Both already read as
  // "Brightness" in the editor, and matching them means a block a child had
  // already darkened stays darkened when its instrument becomes a recording
  // instead of quietly springing back.
  //
  // Pitch is offered on drums only. On a melodic voice the note-grid is the
  // pitch control, and its one promise is that nothing placed on it can sound
  // wrong — a slider that moves a block a semitone off its own row, invisibly,
  // breaks exactly that.
  return opts.pitched
    ? { gain, release: 0.25, cutoff: 12000, drive: 0, attack: 0.002 }
    : { gain, pitch: 0, decay: opts.seconds ?? 1, tone: 12000, drive: 0, attack: 0.002 };
}

export const VOICE_CATALOG: VoiceDef[] = [
  {
    id: 'kick',
    label: 'Kick',
    emoji: '🥁',
    category: 'Drums',
    color: '#ef4444',
    // Left synthesized on purpose. A drum-machine kick *is* a built sound —
    // that is what the instrument is — and the only real recording available is
    // an orchestral bass drum, which is a different, boomier thing. That one is
    // here too, as its own voice ('bassdrum').
    // 0.45, not 1.0. At 1.0 this voice peaked at 1.35 on its own — clipped
    // before it even reached the limiter, and loud enough to bury every other
    // drum in the kit now that the rest are recordings. It is still the fullest
    // thing in there.
    defaults: { tune: 50, pitchDrop: 110, decay: 0.34, click: 0.4, drive: 0.15, gain: 0.45 },
  },
  {
    id: 'bassdrum',
    label: 'Big Drum',
    emoji: '🪘',
    category: 'Drums',
    color: '#dc2626',
    sampleSet: 'kick',
    defaults: sampledDefaults(0.95, { seconds: 2 }),
  },
  {
    id: 'snare',
    label: 'Snare',
    emoji: '🪘',
    category: 'Drums',
    color: '#f59e0b',
    sampleSet: 'snare',
    defaults: sampledDefaults(1.05, { seconds: 1.2 }),
  },
  {
    id: 'hihat',
    label: 'Hi-Hat',
    emoji: '🎩',
    category: 'Cymbals',
    color: '#22d3ee',
    sampleSet: 'hihat',
    defaults: sampledDefaults(1.3, { seconds: 1 }),
  },
  {
    id: 'openhat',
    label: 'Open Hat',
    emoji: '👒',
    category: 'Cymbals',
    color: '#2dd4bf',
    sampleSet: 'openhat',
    defaults: sampledDefaults(1.1, { seconds: 2.5 }),
  },
  {
    id: 'clap',
    label: 'Clap',
    emoji: '👏',
    category: 'Percussion',
    color: '#a78bfa',
    sampleSet: 'clap',
    defaults: sampledDefaults(1.15, { seconds: 0.77 }),
  },
  {
    id: 'tom',
    label: 'Tom',
    emoji: '🛢️',
    category: 'Drums',
    color: '#fb923c',
    sampleSet: 'tom',
    defaults: sampledDefaults(1.0, { seconds: 1.6 }),
  },
  {
    id: 'tomlow',
    label: 'Low Tom',
    emoji: '🛢️',
    category: 'Drums',
    color: '#ea580c',
    sampleSet: 'tomlow',
    defaults: sampledDefaults(0.95, { seconds: 1.8 }),
  },
  {
    id: 'crash',
    label: 'Crash',
    emoji: '💥',
    category: 'Cymbals',
    color: '#eab308',
    sampleSet: 'crash',
    defaults: sampledDefaults(0.95, { seconds: 4 }),
  },
  {
    id: 'ride',
    label: 'Ride',
    emoji: '🔔',
    category: 'Cymbals',
    color: '#84cc16',
    sampleSet: 'ride',
    defaults: sampledDefaults(1.45, { seconds: 3 }),
  },
  {
    id: 'rim',
    label: 'Rim',
    emoji: '🥢',
    category: 'Percussion',
    color: '#f472b6',
    sampleSet: 'rim',
    defaults: sampledDefaults(1.05, { seconds: 0.8 }),
  },
  {
    id: 'shaker',
    label: 'Shaker',
    emoji: '🧂',
    category: 'Percussion',
    color: '#38bdf8',
    sampleSet: 'shaker',
    defaults: sampledDefaults(1.9, { seconds: 0.18 }),
  },
  {
    id: 'cowbell',
    label: 'Cowbell',
    emoji: '🐄',
    category: 'Percussion',
    color: '#f97316',
    sampleSet: 'cowbell',
    defaults: sampledDefaults(1.0, { seconds: 1.15 }),
  },
  {
    id: 'perc',
    label: 'Wood Block',
    emoji: '🪵',
    category: 'Percussion',
    color: '#c084fc',
    sampleSet: 'perc',
    defaults: sampledDefaults(1.05, { seconds: 0.8 }),
  },

  // ---- hand percussion ----------------------------------------------------
  // The bongos are two voices because a bongo pair is two drums, and the
  // high–low conversation between them is the whole point — same shape as
  // Tom / Low Tom.
  {
    id: 'bongo',
    label: 'Bongo',
    emoji: '👐',
    category: 'Drums',
    color: '#fb7185',
    sampleSet: 'bongo',
    defaults: sampledDefaults(1.05, { seconds: 0.8 }),
  },
  {
    id: 'bongolow',
    label: 'Low Bongo',
    emoji: '🤲',
    category: 'Drums',
    color: '#e11d48',
    sampleSet: 'bongolow',
    defaults: sampledDefaults(1.05, { seconds: 0.8 }),
  },
  {
    id: 'conga',
    label: 'Conga',
    emoji: '🥥',
    category: 'Drums',
    color: '#fbbf24',
    sampleSet: 'conga',
    defaults: sampledDefaults(1.0, { seconds: 1.0 }),
  },
  {
    id: 'triangle',
    label: 'Triangle',
    emoji: '🔺',
    category: 'Percussion',
    color: '#e2e8f0',
    sampleSet: 'triangle',
    defaults: sampledDefaults(1.15, { seconds: 3.5 }),
  },
  {
    id: 'tambourine',
    label: 'Tambourine',
    emoji: '🎊',
    category: 'Percussion',
    color: '#fde047',
    sampleSet: 'tambourine',
    defaults: sampledDefaults(1.1, { seconds: 0.8 }),
  },
  {
    id: 'claves',
    label: 'Claves',
    emoji: '🪃',
    category: 'Percussion',
    color: '#d4a373',
    sampleSet: 'claves',
    defaults: sampledDefaults(1.05, { seconds: 0.5 }),
  },
  {
    id: 'agogo',
    label: 'Agogo',
    emoji: '🧲',
    category: 'Percussion',
    color: '#94a3b8',
    sampleSet: 'agogo',
    defaults: sampledDefaults(1.0, { seconds: 1.2 }),
  },

  // ---- Pitched instruments ------------------------------------------------
  {
    id: 'piano',
    label: 'Piano',
    emoji: '🎹',
    category: 'Keys',
    color: '#60a5fa',
    kind: 'pitched',
    baseMidi: 60,
    octaves: 2,
    sampleSet: 'piano',
    defaults: sampledDefaults(1.6, { pitched: true }),
  },
  {
    id: 'bells',
    label: 'Bells',
    emoji: '🛎️',
    category: 'Mallets',
    color: '#f0abfc',
    kind: 'pitched',
    // Left where it was, at 72, even though the glockenspiel's lowest recorded
    // bar is G5 (79). Moving the grid up to meet the recordings sounded better
    // and broke every song already written: a saved note below the new range
    // keeps its pitch, has no row to be drawn on, and collapses onto the bottom
    // one — so a tune shows as a stack of blocks on one row while still playing
    // six different notes, and dragging any of them rewrites it for good.
    // The rows below G5 used to play the lowest bar stretched down, which read
    // as a larger, duller metallophone; they are now backed by real vibraphone
    // notes in the same sample set instead.
    baseMidi: 72,
    octaves: 2,
    sampleSet: 'bells',
    defaults: sampledDefaults(1.25, { pitched: true }),
  },

  // ---- mallets ------------------------------------------------------------
  {
    id: 'marimba',
    label: 'Marimba',
    emoji: '🪵',
    category: 'Mallets',
    color: '#d97706',
    kind: 'pitched',
    // Two octaves below middle C's neighbourhood: the marimba's warm wooden
    // middle, and the register the Bells can't reach.
    baseMidi: 48,
    octaves: 2,
    sampleSet: 'marimba',
    defaults: sampledDefaults(1.45, { pitched: true }),
  },
  {
    id: 'vibraphone',
    label: 'Vibraphone',
    emoji: '🎐',
    category: 'Mallets',
    color: '#7dd3fc',
    kind: 'pitched',
    baseMidi: 60,
    octaves: 2,
    sampleSet: 'vibraphone',
    defaults: sampledDefaults(1.25, { pitched: true }),
  },
  {
    id: 'xylophone',
    label: 'Xylophone',
    emoji: '🌈',
    category: 'Mallets',
    color: '#fda4af',
    kind: 'pitched',
    baseMidi: 72,
    octaves: 2,
    sampleSet: 'xylophone',
    defaults: sampledDefaults(1.2, { pitched: true }),
  },
  // Synthesized on purpose: these are synthesizers. There is no "real" version
  // of them to be more faithful to.
  {
    id: 'synth',
    label: 'Synth',
    emoji: '🎚️',
    category: 'Keys',
    color: '#a855f7',
    kind: 'pitched',
    baseMidi: 60,
    octaves: 2,
    defaults: { wave: 2, attack: 0.02, decay: 0.35, sustain: 0.55, release: 0.28, cutoff: 1400, bite: 2.4, detune: 14, gain: 0.42 },
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
    defaults: { wave: 2, attack: 0.004, decay: 0.22, sustain: 0.45, release: 0.16, cutoff: 520, bite: 3.0, detune: 7, gain: 0.55 },
  },
  // ---- strings ------------------------------------------------------------
  // Both synthesized for now, deliberately shippable that way: the Guitar is a
  // built pluck the way the Bass is, and the Strings are the classic synth
  // string pad. The Strings are slated to become a real recording (VSCO 2 CE's
  // violin ensemble — sampleSet 'strings') once the source audio is fetched
  // and levelled; neither library holds any guitar, so a recorded Guitar
  // waits on vetting a new CC0 source. Imported MIDI songs land on these
  // (model/gm.ts), which is why they exist before the recordings do.
  {
    id: 'guitar',
    label: 'Guitar',
    emoji: '🎸',
    category: 'Strings',
    color: '#b45309',
    kind: 'pitched',
    // Between the Bass and the Piano, where a guitar actually sits.
    baseMidi: 48,
    octaves: 2,
    // A pluck: sharp attack, quick settle, little sustain, and enough bite
    // that the filter envelope snaps the way a picked string does.
    defaults: { wave: 2, attack: 0.003, decay: 0.5, sustain: 0.12, release: 0.2, cutoff: 1800, bite: 2.6, detune: 4, gain: 0.5 },
  },
  {
    id: 'strings',
    label: 'Strings',
    emoji: '🎻',
    category: 'Strings',
    color: '#c4b5fd',
    kind: 'pitched',
    baseMidi: 60,
    octaves: 2,
    // A pad: the swell in, the held middle and the slow letting-go are the
    // whole character; detune supplies the "many players" width.
    defaults: { wave: 2, attack: 0.12, decay: 0.3, sustain: 0.8, release: 0.5, cutoff: 2200, bite: 1.2, detune: 10, gain: 0.4 },
  },
  {
    // A real upright, plucked — the one recording VCSL couldn't provide, from
    // VSCO 2 CE (same publisher, same CC0; see docs/asset-manifest.json). Its
    // own voice next to the synth Bass rather than a replacement, so no saved
    // song changes sound.
    id: 'upright',
    label: 'Upright Bass',
    emoji: '🎻',
    category: 'Bass',
    color: '#10b981',
    kind: 'pitched',
    baseMidi: 36,
    octaves: 2,
    sampleSet: 'upright',
    defaults: sampledDefaults(1.5, { pitched: true }),
  },
];

const VOICE_BY_ID = new Map(VOICE_CATALOG.map((v) => [v.id, v]));

/**
 * The Volume each voice sat at before it became a recording.
 *
 * A block's Volume is stored as an absolute number, not as a fraction of its
 * voice's normal level — so when a voice's normal level moves, every block a
 * child had ever nudged moves with it, in the wrong direction. The piano went
 * from 0.34 to 1.6, so a saved block someone had turned *up* to 0.5 came back
 * about thirteen decibels *below* its untouched neighbours in the same phrase:
 * a note they had emphasised, gone.
 *
 * Kept as plain data rather than derived, because it is a fact about files
 * already on disk and must not change again when a level is next retuned.
 */
const VOLUME_BEFORE_RECORDINGS: Record<string, number> = {
  kick: 1.0,
  snare: 0.9,
  hihat: 0.55,
  openhat: 0.5,
  clap: 0.8,
  tom: 0.9,
  crash: 0.5,
  ride: 0.45,
  rim: 0.7,
  shaker: 0.5,
  cowbell: 0.6,
  perc: 0.6,
  piano: 0.34,
  bells: 0.4,
  // synth and bass are unchanged, so they need no entry.
};

/**
 * Rescale a Volume saved before the recordings arrived, keeping the *proportion*
 * the child chose: a block set to half its voice's normal level stays at half.
 * Returns the value unchanged for a voice whose level never moved.
 */
export function migrateBlockVolume(voiceId: string, gain: number): number {
  const before = VOLUME_BEFORE_RECORDINGS[voiceId];
  const now = VOICE_BY_ID.get(voiceId)?.defaults.gain;
  if (!before || !now || before === now) return gain;
  return gain * (now / before);
}

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
