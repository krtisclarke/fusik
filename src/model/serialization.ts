// Turning a Project into the on-disk .beatbox file and safely back again.
//
// The file is plain JSON — human-readable and future-proof. Loading is the
// dangerous direction: the bytes might be truncated, hand-edited, from a newer
// version, or not a project at all. So `parseProject` validates every field,
// repairs what it sensibly can (clamping, filling defaults), and throws a clear
// ProjectLoadError on anything it can't trust. A round-trip of valid data is
// always exact.

import {
  clamp,
  DEFAULT_BARS,
  DEFAULT_BPM,
  DEFAULT_NOTE_VELOCITY,
  DEFAULT_TIME_SIGNATURE,
  MAX_BARS,
  MAX_BPM,
  MIN_BARS,
  MIN_BPM,
} from './project';
import { newNoteId, newTrackId } from './ids';
import type { Instrument, Note, Project, TimeSignature, Track, TrackType } from './types';
import { PROJECT_FORMAT_VERSION } from './types';

export class ProjectLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectLoadError';
  }
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

// ---- validation helpers --------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function parseTimeSignature(value: unknown): TimeSignature {
  if (!isObject(value)) return { ...DEFAULT_TIME_SIGNATURE };
  return {
    numerator: clamp(Math.round(asNumber(value.numerator, 4)), 1, 32),
    denominator: clamp(Math.round(asNumber(value.denominator, 4)), 1, 32),
  };
}

function parseInstrument(value: unknown): Instrument {
  if (!isObject(value)) return { voiceId: 'kick', params: {} };
  const params: Record<string, number> = {};
  if (isObject(value.params)) {
    for (const [key, raw] of Object.entries(value.params)) {
      if (typeof raw === 'number' && Number.isFinite(raw)) params[key] = raw;
    }
  }
  return { voiceId: asString(value.voiceId, 'kick'), params };
}

function parseNote(value: unknown): Note {
  const v = isObject(value) ? value : {};
  return {
    id: asString(v.id, newNoteId()),
    startBeat: Math.max(0, asNumber(v.startBeat, 0)),
    lengthBeats: Math.max(0.0625, asNumber(v.lengthBeats, 1)),
    velocity: clamp(asNumber(v.velocity, DEFAULT_NOTE_VELOCITY), 0, 1),
  };
}

function parseTrack(value: unknown): Track {
  const v = isObject(value) ? value : {};
  const notes = Array.isArray(v.notes) ? v.notes.map(parseNote) : [];
  // Only 'drum' exists today; keep the field for forward compatibility.
  const type: TrackType = 'drum';
  return {
    id: asString(v.id, newTrackId()),
    name: asString(v.name, 'Track'),
    type,
    color: asString(v.color, '#9aa0aa'),
    instrument: parseInstrument(v.instrument),
    notes,
    gain: clamp(asNumber(v.gain, 0.85), 0, 1),
    muted: asBool(v.muted, false),
    solo: asBool(v.solo, false),
  };
}

/**
 * Parse project JSON. Throws ProjectLoadError on input that isn't a project at
 * all; otherwise repairs and returns a valid Project.
 */
export function parseProject(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectLoadError("This file isn't valid JSON — it may be corrupted.");
  }

  if (!isObject(raw)) {
    throw new ProjectLoadError("This file doesn't look like a Beatbox project.");
  }

  if (!Array.isArray(raw.tracks)) {
    throw new ProjectLoadError('This project is missing its tracks and cannot be opened.');
  }

  const version = asNumber(raw.formatVersion, PROJECT_FORMAT_VERSION);
  if (version > PROJECT_FORMAT_VERSION) {
    throw new ProjectLoadError(
      `This project was made in a newer version of Beatbox Studio (format ${version}). Please update to open it.`,
    );
  }

  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    name: asString(raw.name, 'Untitled Song'),
    bpm: clamp(Math.round(asNumber(raw.bpm, DEFAULT_BPM)), MIN_BPM, MAX_BPM),
    timeSignature: parseTimeSignature(raw.timeSignature),
    lengthBars: clamp(Math.round(asNumber(raw.lengthBars, DEFAULT_BARS)), MIN_BARS, MAX_BARS),
    tracks: raw.tracks.map(parseTrack),
  };
}
