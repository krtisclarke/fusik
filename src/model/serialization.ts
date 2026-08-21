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
import { createSection } from './project';
import { newEntryId, newNoteId, newSectionId, newTrackId } from './ids';
import type {
  ArrangementEntry,
  Instrument,
  Note,
  Project,
  Section,
  TimeSignature,
  Track,
  TrackType,
} from './types';
import { PROJECT_FORMAT_VERSION } from './types';
import { DEFAULT_SCALE_ID, DEFAULT_SCALE_ROOT } from './scales';

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

function parseParams(value: unknown): Record<string, number> {
  const params: Record<string, number> = {};
  if (isObject(value)) {
    for (const [key, raw] of Object.entries(value)) {
      if (typeof raw === 'number' && Number.isFinite(raw)) params[key] = raw;
    }
  }
  return params;
}

function parseInstrument(value: unknown): Instrument {
  if (!isObject(value)) return { voiceId: 'kick', params: {} };
  return { voiceId: asString(value.voiceId, 'kick'), params: parseParams(value.params) };
}

function parseNote(value: unknown): Note {
  const v = isObject(value) ? value : {};
  const note: Note = {
    id: asString(v.id, newNoteId()),
    sectionId: asString(v.sectionId, ''),
    startBeat: Math.max(0, asNumber(v.startBeat, 0)),
    lengthBeats: Math.max(0.0625, asNumber(v.lengthBeats, 1)),
    velocity: clamp(asNumber(v.velocity, DEFAULT_NOTE_VELOCITY), 0, 1),
    params: parseParams(v.params),
  };
  if (typeof v.pitch === 'number' && Number.isFinite(v.pitch)) {
    note.pitch = clamp(Math.round(v.pitch), 0, 127);
  }
  if (typeof v.groupId === 'string') note.groupId = v.groupId;
  return note;
}

function parseTrack(value: unknown, version: number): Track {
  const v = isObject(value) ? value : {};
  const type: TrackType = v.type === 'instrument' ? 'instrument' : 'drum';
  const instrument = parseInstrument(v.instrument);
  let notes = Array.isArray(v.notes) ? v.notes.map(parseNote) : [];
  // Migration: format-1 files stored the sound on the track. Move it onto each
  // block that doesn't already carry its own sound, so old songs still sound
  // right. Only for format 1 — from format 2 on, sound lives on the blocks and a
  // block with no params deliberately means "the plain voice", so re-stamping it
  // would resurrect a sound the child had reset.
  if (version < 2 && Object.keys(instrument.params).length > 0) {
    notes = notes.map((n) =>
      Object.keys(n.params).length === 0 ? { ...n, params: { ...instrument.params } } : n,
    );
  }
  return {
    id: asString(v.id, newTrackId()),
    name: asString(v.name, 'Track'),
    type,
    color: asString(v.color, '#9aa0aa'),
    instrument,
    notes,
    gain: clamp(asNumber(v.gain, 0.85), 0, 1),
    muted: asBool(v.muted, false),
    solo: asBool(v.solo, false),
    echo: clamp(asNumber(v.echo, 0), 0, 1),
  };
}

function parseSection(value: unknown): Section {
  const v = isObject(value) ? value : {};
  return {
    id: asString(v.id, newSectionId()),
    name: asString(v.name, 'A'),
    lengthBars: clamp(Math.round(asNumber(v.lengthBars, DEFAULT_BARS)), MIN_BARS, MAX_BARS),
    color: asString(v.color, '#f59e0b'),
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

  const tracks = raw.tracks.map((t) => parseTrack(t, version));

  // Sections + arrangement. Format 1 files predate sections entirely: the whole
  // song becomes one part ("A") of the old song length, and every note joins it.
  // For format 2 files, imperfect data is repaired rather than refused. The
  // repairs below re-establish every invariant the rest of the app relies on:
  // ids are unique, at least one part, at least one slot, every slot points at a
  // real part, every part is reachable in the arrangement, and every note lives
  // in a real part. A hand-edited or half-written file can violate any of these.
  let sections: Section[] = Array.isArray(raw.sections) ? raw.sections.map(parseSection) : [];
  if (sections.length === 0) {
    const bars = clamp(Math.round(asNumber(raw.lengthBars, DEFAULT_BARS)), MIN_BARS, MAX_BARS);
    sections = [{ ...createSection([], bars), name: 'A' }];
  }
  // Duplicate ids would make two parts indistinguishable; re-id the later ones.
  const sectionIds = new Set<string>();
  sections = sections.map((s) => {
    const section = sectionIds.has(s.id) ? { ...s, id: newSectionId() } : s;
    sectionIds.add(section.id);
    return section;
  });

  // Slots need unique ids too: removing a slot matches by id, so duplicates
  // would take every twin out of the song at once.
  const entryIds = new Set<string>();
  let arrangement: ArrangementEntry[] = Array.isArray(raw.arrangement)
    ? raw.arrangement
        .map((e): ArrangementEntry => {
          const v = isObject(e) ? e : {};
          return { id: asString(v.id, newEntryId()), sectionId: asString(v.sectionId, '') };
        })
        .filter((e) => sectionIds.has(e.sectionId))
        .map((e) => {
          const entry = entryIds.has(e.id) ? { ...e, id: newEntryId() } : e;
          entryIds.add(entry.id);
          return entry;
        })
    : [];
  if (arrangement.length === 0) {
    arrangement = sections.map((s) => ({ id: newEntryId(), sectionId: s.id }));
  } else {
    // A part that appears nowhere in the arrangement would be unreachable — it
    // could never be heard, edited or deleted. Give it a slot at the end.
    const used = new Set(arrangement.map((e) => e.sectionId));
    for (const s of sections) {
      if (!used.has(s.id)) arrangement.push({ id: newEntryId(), sectionId: s.id });
    }
  }

  // Every note must point at a real section (strays go to the first part) and
  // carry an id unique across the whole song — selection and per-block sound
  // edits address blocks by id alone, across tracks.
  const fallbackSectionId = sections[0].id;
  const noteIds = new Set<string>();
  for (const track of tracks) {
    track.notes = track.notes.map((n) => {
      let note = sectionIds.has(n.sectionId) ? n : { ...n, sectionId: fallbackSectionId };
      if (noteIds.has(note.id)) note = { ...note, id: newNoteId() };
      noteIds.add(note.id);
      return note;
    });
  }

  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    name: asString(raw.name, 'Untitled Song'),
    bpm: clamp(Math.round(asNumber(raw.bpm, DEFAULT_BPM)), MIN_BPM, MAX_BPM),
    timeSignature: parseTimeSignature(raw.timeSignature),
    scaleRoot: clamp(Math.round(asNumber(raw.scaleRoot, DEFAULT_SCALE_ROOT)), 0, 11),
    scaleId: asString(raw.scaleId, DEFAULT_SCALE_ID),
    sections,
    arrangement,
    tracks,
  };
}
