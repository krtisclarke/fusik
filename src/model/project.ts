// Project factory and edit operations.
//
// Every function here is pure: it takes a Project and returns a *new* Project,
// never mutating the input. That immutability is what makes snapshot-based
// undo/redo trivially correct — each edit produces a distinct object we can
// stash and restore. Projects are small, so targeted cloning is cheap and far
// clearer than deep-cloning everything.

import { newNoteId, newTrackId } from './ids';
import type { Instrument, Note, Project, TimeSignature, Track } from './types';
import { PROJECT_FORMAT_VERSION } from './types';
import { getVoice, isPitched } from './voices';
import { DEFAULT_SCALE_ID, DEFAULT_SCALE_ROOT } from './scales';

export const MIN_BPM = 20;
export const MAX_BPM = 300;
export const DEFAULT_BPM = 120;
export const MIN_BARS = 1;
export const MAX_BARS = 64;
export const DEFAULT_BARS = 4;
export const DEFAULT_TIME_SIGNATURE: TimeSignature = { numerator: 4, denominator: 4 };
export const DEFAULT_NOTE_VELOCITY = 0.8;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Build a fresh track wired to a given voice, with sensible presentation. */
export function createTrackForVoice(voiceId: string): Track {
  const voice = getVoice(voiceId);
  const pitched = isPitched(voice);
  const instrument: Instrument = { voiceId, params: {} };
  return {
    id: newTrackId(),
    name: voice?.label ?? voiceId,
    type: pitched ? 'instrument' : 'drum',
    color: voice?.color ?? '#9aa0aa',
    instrument,
    notes: [],
    gain: pitched ? 0.7 : 0.85,
    muted: false,
    solo: false,
  };
}

/**
 * A new song. Comes pre-loaded with the three drums a beat is usually built
 * from, so the timeline is never an intimidating blank slate — the child sees
 * the building blocks immediately.
 */
export function createDefaultProject(name = 'My Song'): Project {
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    name,
    bpm: DEFAULT_BPM,
    timeSignature: { ...DEFAULT_TIME_SIGNATURE },
    lengthBars: DEFAULT_BARS,
    scaleRoot: DEFAULT_SCALE_ROOT,
    scaleId: DEFAULT_SCALE_ID,
    tracks: [createTrackForVoice('kick'), createTrackForVoice('snare'), createTrackForVoice('hihat')],
  };
}

export function createNote(
  startBeat: number,
  lengthBeats = 1,
  velocity = DEFAULT_NOTE_VELOCITY,
  pitch?: number,
): Note {
  const note: Note = {
    id: newNoteId(),
    startBeat: Math.max(0, startBeat),
    lengthBeats: Math.max(0.0625, lengthBeats),
    velocity: clamp(velocity, 0, 1),
  };
  if (pitch != null) note.pitch = Math.round(pitch);
  return note;
}

// ---- Track-level edits ---------------------------------------------------

export function addTrack(project: Project, track: Track): Project {
  return { ...project, tracks: [...project.tracks, track] };
}

export function removeTrack(project: Project, trackId: string): Project {
  return { ...project, tracks: project.tracks.filter((t) => t.id !== trackId) };
}

function mapTrack(project: Project, trackId: string, fn: (t: Track) => Track): Project {
  return {
    ...project,
    tracks: project.tracks.map((t) => (t.id === trackId ? fn(t) : t)),
  };
}

export function setTrackGain(project: Project, trackId: string, gain: number): Project {
  return mapTrack(project, trackId, (t) => ({ ...t, gain: clamp(gain, 0, 1) }));
}

export function setTrackMuted(project: Project, trackId: string, muted: boolean): Project {
  return mapTrack(project, trackId, (t) => ({ ...t, muted }));
}

export function toggleTrackMuted(project: Project, trackId: string): Project {
  return mapTrack(project, trackId, (t) => ({ ...t, muted: !t.muted }));
}

export function toggleTrackSolo(project: Project, trackId: string): Project {
  return mapTrack(project, trackId, (t) => ({ ...t, solo: !t.solo }));
}

export function renameTrack(project: Project, trackId: string, name: string): Project {
  return mapTrack(project, trackId, (t) => ({ ...t, name }));
}

// ---- Note-level edits ----------------------------------------------------

export function addNote(project: Project, trackId: string, note: Note): Project {
  return mapTrack(project, trackId, (t) => ({ ...t, notes: [...t.notes, note] }));
}

export function removeNote(project: Project, trackId: string, noteId: string): Project {
  return mapTrack(project, trackId, (t) => ({
    ...t,
    notes: t.notes.filter((n) => n.id !== noteId),
  }));
}

export function updateNote(
  project: Project,
  trackId: string,
  noteId: string,
  changes: Partial<Omit<Note, 'id'>>,
): Project {
  return mapTrack(project, trackId, (t) => ({
    ...t,
    notes: t.notes.map((n) =>
      n.id === noteId
        ? {
            ...n,
            ...changes,
            startBeat: changes.startBeat != null ? Math.max(0, changes.startBeat) : n.startBeat,
            lengthBeats:
              changes.lengthBeats != null ? Math.max(0.0625, changes.lengthBeats) : n.lengthBeats,
            velocity: changes.velocity != null ? clamp(changes.velocity, 0, 1) : n.velocity,
          }
        : n,
    ),
  }));
}

/** Move a note to a new track and/or beat position in one operation. */
export function moveNote(
  project: Project,
  fromTrackId: string,
  noteId: string,
  toTrackId: string,
  startBeat: number,
): Project {
  const fromTrack = project.tracks.find((t) => t.id === fromTrackId);
  const note = fromTrack?.notes.find((n) => n.id === noteId);
  if (!note) return project;

  const moved: Note = { ...note, startBeat: Math.max(0, startBeat) };
  if (fromTrackId === toTrackId) {
    return mapTrack(project, fromTrackId, (t) => ({
      ...t,
      notes: t.notes.map((n) => (n.id === noteId ? moved : n)),
    }));
  }
  const removed = removeNote(project, fromTrackId, noteId);
  return addNote(removed, toTrackId, moved);
}

// ---- Song-level edits ----------------------------------------------------

export function setBpm(project: Project, bpm: number): Project {
  return { ...project, bpm: clamp(Math.round(bpm), MIN_BPM, MAX_BPM) };
}

export function setLengthBars(project: Project, lengthBars: number): Project {
  return { ...project, lengthBars: clamp(Math.round(lengthBars), MIN_BARS, MAX_BARS) };
}

export function renameProject(project: Project, name: string): Project {
  return { ...project, name };
}

/** Find an existing track for a voice, or null. Used to group dropped drums. */
export function findTrackByVoice(project: Project, voiceId: string): Track | undefined {
  return project.tracks.find((t) => t.instrument.voiceId === voiceId);
}
