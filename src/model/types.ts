// The project model: plain, serializable data that fully describes a song.
//
// These types are the single source of truth for what a project *is*. The audio
// engine reads them to make sound; the UI reads them to draw; serialization
// turns them into the .beatbox file on disk. Nothing here knows about Web Audio,
// React, or the DOM — that separation is deliberate and load-bearing.

/**
 * Bumped whenever the on-disk shape — or what a number in it *means* — changes.
 *
 * Version 4 is a meaning change rather than a shape change: most instruments
 * became real recordings, which sit at a different Volume from the synthesized
 * ones they replaced, so a Volume a child had set on a block needed rescaling to
 * keep meaning what they meant by it. See `migrateBlockVolume` in
 * model/voices.ts.
 */
export const PROJECT_FORMAT_VERSION = 4;

export interface TimeSignature {
  /** Beats per bar (the top number). */
  numerator: number;
  /** Which note value is "one beat" (the bottom number). Phase 1 assumes 4. */
  denominator: number;
}

/**
 * Drum tracks trigger a fixed sound; instrument tracks play pitched notes;
 * audio tracks play back something the child recorded through the microphone.
 *
 * An audio track's blocks are ordinary `Note`s carrying a `clipId` instead of a
 * pitch. That is deliberate: everything the timeline already does — placing,
 * moving, selecting, deleting, undo, arranging into parts — keeps working
 * without knowing that some blocks are recordings.
 */
export type TrackType = 'drum' | 'instrument' | 'audio';

/**
 * A section ("part") of the song: its own mini-loop with its own notes and its
 * own length. The song is sections played in arrangement order — the same
 * section may appear several times (verse, chorus, verse…).
 */
export interface Section {
  id: string;
  /** Kid-facing name: "A", "B", … (renameable). */
  name: string;
  /** This part's length in bars. */
  lengthBars: number;
  /** Chip colour in the arrangement strip. */
  color: string;
}

/**
 * One slot in the song's running order, pointing at a section. Slots have their
 * own ids so the same section can appear twice (A A B A) and still be
 * reordered/removed individually.
 */
export interface ArrangementEntry {
  id: string;
  sectionId: string;
}

/**
 * A single note on the timeline: "play this track's sound, here, this long,
 * this hard." `pitch` is a MIDI note number (60 = middle C); drum tracks ignore
 * it, melodic instrument tracks use it.
 */
export interface Note {
  id: string;
  /** Which section (part) of the song this note belongs to. */
  sectionId: string;
  /** Position from the start of its section, measured in beats. */
  startBeat: number;
  /** How long the note occupies on the grid, in beats. Always > 0. */
  lengthBeats: number;
  /** How hard the note is hit, 0..1. Drives loudness and tone. */
  velocity: number;
  /** MIDI note number for melodic tracks. Absent/ignored for drums. */
  pitch?: number;
  /**
   * This block's own sound settings — overrides on top of its voice's defaults.
   * Empty means "sound like the plain voice". Every block is independent.
   */
  params: Record<string, number>;
  /**
   * Chain membership. Blocks sharing a groupId are linked: they always keep the
   * same sound and the same length. Absent = not chained to anything.
   */
  groupId?: string;
  /**
   * A recording this block plays, on an audio track. The audio itself is *not*
   * in the project file: it lives next to it as its own `.wav`, because a
   * minute of sound is a thousand times the size of the entire song describing
   * it, and undo keeps a hundred copies of the song.
   */
  clipId?: string;
  /**
   * How long that recording actually is, in seconds. `lengthBeats` is what the
   * block occupies on the grid and follows the tempo; this doesn't, because a
   * recording plays at the speed it was made.
   */
  clipSeconds?: number;
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
  /**
   * How much echo this track gets, 0..1 (0 = none). One control on purpose:
   * it drives the repeats' loudness *and* how many there are together, and the
   * delay time follows the song's tempo, so there is no way to set it to
   * something unmusical. Sound lives on the blocks; echo is the space the whole
   * instrument sits in, so it belongs to the track.
   */
  echo: number;
}

export interface Project {
  formatVersion: number;
  name: string;
  /** Tempo in beats per minute. */
  bpm: number;
  timeSignature: TimeSignature;
  /** Root of the musical scale, as a pitch class 0..11 (0 = C). */
  scaleRoot: number;
  /** Which scale melodic notes snap to, e.g. 'majorPentatonic'. */
  scaleId: string;
  /** The song's parts. Always at least one. */
  sections: Section[];
  /** The song = sections played in this order. Always at least one entry. */
  arrangement: ArrangementEntry[];
  tracks: Track[];
}
