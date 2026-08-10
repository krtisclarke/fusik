// The project model: plain, serializable data that fully describes a song.
//
// These types are the single source of truth for what a project *is*. The audio
// engine reads them to make sound; the UI reads them to draw; serialization
// turns them into the .beatbox file on disk. Nothing here knows about Web Audio,
// React, or the DOM — that separation is deliberate and load-bearing.

/** Bumped whenever the on-disk shape changes in a non-backwards-compatible way. */
export const PROJECT_FORMAT_VERSION = 1;

export interface TimeSignature {
  /** Beats per bar (the top number). */
  numerator: number;
  /** Which note value is "one beat" (the bottom number). Phase 1 assumes 4. */
  denominator: number;
}

/** Drum tracks trigger a fixed sound; instrument tracks play pitched notes. */
export type TrackType = 'drum' | 'instrument';

/**
 * A single note on the timeline: "play this track's sound, here, this long,
 * this hard." `pitch` is a MIDI note number (60 = middle C); drum tracks ignore
 * it, melodic instrument tracks use it.
 */
export interface Note {
  id: string;
  /** Position from the start of the song, measured in beats. */
  startBeat: number;
  /** How long the note occupies on the grid, in beats. Always > 0. */
  lengthBeats: number;
  /** How hard the note is hit, 0..1. Drives loudness and tone. */
  velocity: number;
  /** MIDI note number for melodic tracks. Absent/ignored for drums. */
  pitch?: number;
}

/**
 * Which synthesized sound a track makes, plus any tweaks to it.
 * `params` holds *overrides* only — an empty object means "use the voice's
 * built-in defaults". Phase 3's sound editor fills this in.
 */
export interface Instrument {
  /** Identifies the synth voice, e.g. 'kick', 'snare'. See audio/voices. */
  voiceId: string;
  /** Overrides for that voice's default parameters. */
  params: Record<string, number>;
}

export interface Track {
  id: string;
  name: string;
  type: TrackType;
  /** Hex colour used to tint the track's clips in the UI. */
  color: string;
  instrument: Instrument;
  notes: Note[];
  /** Track volume, 0..1. */
  gain: number;
  muted: boolean;
  solo: boolean;
}

export interface Project {
  formatVersion: number;
  name: string;
  /** Tempo in beats per minute. */
  bpm: number;
  timeSignature: TimeSignature;
  /** Length of the song (and the loop region) in bars. */
  lengthBars: number;
  /** Root of the musical scale, as a pitch class 0..11 (0 = C). */
  scaleRoot: number;
  /** Which scale melodic notes snap to, e.g. 'majorPentatonic'. */
  scaleId: string;
  tracks: Track[];
}
