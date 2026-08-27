// Project factory and edit operations.
//
// Every function here is pure: it takes a Project and returns a *new* Project,
// never mutating the input. That immutability is what makes snapshot-based
// undo/redo trivially correct — each edit produces a distinct object we can
// stash and restore. Projects are small, so targeted cloning is cheap and far
// clearer than deep-cloning everything.

import { newEntryId, newGroupId, newNoteId, newSectionId, newTrackId } from './ids';
import { barsToBeats, beatsToSeconds } from './time';
import type { Instrument, Note, Project, Section, TimeSignature, Track } from './types';
import { PROJECT_FORMAT_VERSION } from './types';
import { getVoice, isPitched } from './voices';
import {
  DEFAULT_SCALE_ID,
  DEFAULT_SCALE_ROOT,
  SCALES,
  mapPitchBetweenScales,
  nearestLadderIndex,
  pitchLadder,
} from './scales';

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

// ---- Sections (the song's parts) -----------------------------------------

/** Chip colours for parts, assigned round-robin as parts are created. */
export const SECTION_COLORS = [
  '#f59e0b',
  '#60a5fa',
  '#34d399',
  '#f472b6',
  '#a78bfa',
  '#f87171',
  '#22d3ee',
  '#facc15',
];

/** The next free single-letter name (A, B, …), falling back to "Part n". */
function nextSectionName(sections: Section[]): string {
  const used = new Set(sections.map((s) => s.name));
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    if (!used.has(letter)) return letter;
  }
  return `Part ${sections.length + 1}`;
}

export function createSection(sections: Section[], lengthBars = DEFAULT_BARS): Section {
  return {
    id: newSectionId(),
    name: nextSectionName(sections),
    lengthBars: clamp(Math.round(lengthBars), MIN_BARS, MAX_BARS),
    color: SECTION_COLORS[sections.length % SECTION_COLORS.length],
  };
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
    echo: 0,
  };
}

/**
 * A new song. Comes pre-loaded with the three drums a beat is usually built
 * from, so the timeline is never an intimidating blank slate — the child sees
 * the building blocks immediately.
 */
export function createDefaultProject(name = 'My Song'): Project {
  const section = createSection([]);
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    name,
    bpm: DEFAULT_BPM,
    timeSignature: { ...DEFAULT_TIME_SIGNATURE },
    scaleRoot: DEFAULT_SCALE_ROOT,
    scaleId: DEFAULT_SCALE_ID,
    sections: [section],
    arrangement: [{ id: newEntryId(), sectionId: section.id }],
    tracks: [createTrackForVoice('kick'), createTrackForVoice('snare'), createTrackForVoice('hihat')],
  };
}

/** The id an audio track carries in place of a synth voice. */
export const CLIP_VOICE_ID = 'clip';

/** A track that plays back recordings rather than making sounds. */
export function createAudioTrack(name = 'My Voice'): Track {
  return {
    id: newTrackId(),
    name,
    type: 'audio',
    color: '#f472b6',
    instrument: { voiceId: CLIP_VOICE_ID, params: {} },
    notes: [],
    // Quieter than the synths by default: a voice recorded close to a laptop
    // microphone is a much hotter signal than a synthesised drum.
    gain: 0.75,
    muted: false,
    solo: false,
    echo: 0,
  };
}

/**
 * A place to sing: a block on the voice row with nothing recorded into it yet.
 *
 * Choosing where your voice goes used to mean aiming a marker that existed
 * nowhere in the song. This is an ordinary block — placed, dragged, selected
 * and deleted like every other one — that simply has no sound in it so far.
 * Selecting it is what opens the recording controls, so "where does my voice
 * go?" and "how do I record it?" are the same object.
 */
export function createVoiceBlock(sectionId: string, startBeat: number, lengthBeats = 4): Note {
  return {
    id: newNoteId(),
    sectionId,
    startBeat: Math.max(0, startBeat),
    lengthBeats: Math.max(0.0625, lengthBeats),
    velocity: DEFAULT_NOTE_VELOCITY,
    params: {},
  };
}

/**
 * Put a finished take into the block it was sung into.
 *
 * The block keeps its identity, so the whole take — choosing the spot and
 * filling it — collapses to what a child would call one thing, and one undo
 * takes it back. Its length becomes the recording's, because that is now what
 * it is: the placeholder's length was only ever a guess at it.
 */
export function fillVoiceBlock(
  project: Project,
  trackId: string,
  noteId: string,
  clipId: string,
  seconds: number,
  lengthBeats: number,
): Project {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track || !track.notes.some((n) => n.id === noteId)) return project;
  return mapTrack(project, trackId, (t) => ({
    ...t,
    notes: t.notes.map((n) =>
      n.id === noteId
        ? {
            ...n,
            clipId,
            clipSeconds: Math.max(0, seconds),
            lengthBeats: Math.max(0.0625, lengthBeats),
            // Re-recording over a block that had been cut out of an older take
            // must not keep pointing part-way into the new one.
            clipStartSeconds: undefined,
          }
        : n,
    ),
  }));
}

/** A block that plays a recording. `seconds` is the recording's real length. */
export function createClipNote(
  sectionId: string,
  startBeat: number,
  lengthBeats: number,
  clipId: string,
  seconds: number,
  clipStartSeconds = 0,
): Note {
  const note: Note = {
    id: newNoteId(),
    sectionId,
    startBeat: Math.max(0, startBeat),
    lengthBeats: Math.max(0.0625, lengthBeats),
    velocity: DEFAULT_NOTE_VELOCITY,
    params: {},
    clipId,
    clipSeconds: Math.max(0, seconds),
  };
  if (clipStartSeconds > 0) note.clipStartSeconds = clipStartSeconds;
  return note;
}

/**
 * Cut a block in two at `atBeat`, measured from the start of its part.
 *
 * For a recording this is the whole of "cut a bit out and use it somewhere
 * else": no audio is copied, the second half simply points further into the
 * same take. Cutting is then split-then-delete, and copying is split-then-
 * duplicate, both out of one gesture a child already has — and the file next
 * to the song stays the single recording it always was.
 *
 * A cut outside the block does nothing, so a mis-aimed playhead is a no-op
 * rather than a block quietly turning into a sliver.
 */
export function splitNote(
  project: Project,
  trackId: string,
  noteId: string,
  atBeat: number,
): Project {
  const track = project.tracks.find((t) => t.id === trackId);
  const note = track?.notes.find((n) => n.id === noteId);
  if (!track || !note) return project;
  const from = note.startBeat;
  const to = note.startBeat + note.lengthBeats;
  // A cut has to leave something on both sides of it.
  if (atBeat <= from + 1e-6 || atBeat >= to - 1e-6) return project;

  const firstLength = atBeat - from;
  const head: Note = { ...note, lengthBeats: firstLength };
  const tail: Note = {
    ...note,
    id: newNoteId(),
    startBeat: atBeat,
    lengthBeats: to - atBeat,
    params: { ...note.params },
  };
  // A chained block cut in two would leave the halves promising to keep each
  // other's length, which is the one thing cutting them apart is undoing.
  delete head.groupId;
  delete tail.groupId;
  if (note.clipId) {
    tail.clipStartSeconds =
      (note.clipStartSeconds ?? 0) + beatsToSeconds(firstLength, project.bpm);
  }
  return mapTrack(project, trackId, (t) => ({
    ...t,
    notes: t.notes.map((n) => (n.id === noteId ? head : n)).concat(tail),
  }));
}

/**
 * Copy these blocks, each landing straight after itself.
 *
 * Right after, rather than on top: a copy you cannot see is indistinguishable
 * from a button that did nothing. From there it is dragged wherever it is
 * wanted, which is a gesture already known. A copy with nowhere to go inside
 * the part is left out rather than piled at the end.
 */
export function duplicateNotes(project: Project, ids: Set<string>): Project {
  if (ids.size === 0) return project;
  let added = false;
  const tracks = project.tracks.map((track) => {
    const copies: Note[] = [];
    for (const note of track.notes) {
      if (!ids.has(note.id)) continue;
      const length = sectionLengthBeats(project, note.sectionId);
      const at = note.startBeat + note.lengthBeats;
      if (length > 0 && at >= length) continue; // no room left in this part
      copies.push({
        ...note,
        id: newNoteId(),
        startBeat: at,
        lengthBeats: length > 0 ? Math.min(note.lengthBeats, length - at) : note.lengthBeats,
        params: { ...note.params },
        // The copy is its own block, not a link in the original's chain.
        groupId: undefined,
      });
    }
    if (copies.length === 0) return track;
    added = true;
    return { ...track, notes: [...track.notes, ...copies] };
  });
  return added ? { ...project, tracks } : project;
}

/** Every recording the song refers to. Used to know what to keep on disk. */
export function clipIdsIn(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const track of project.tracks) {
    for (const note of track.notes) if (note.clipId) ids.add(note.clipId);
  }
  return ids;
}

export function createNote(
  sectionId: string,
  startBeat: number,
  lengthBeats = 1,
  velocity = DEFAULT_NOTE_VELOCITY,
  pitch?: number,
): Note {
  const note: Note = {
    id: newNoteId(),
    sectionId,
    startBeat: Math.max(0, startBeat),
    lengthBeats: Math.max(0.0625, lengthBeats),
    velocity: clamp(velocity, 0, 1),
    params: {},
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
  const value = clamp(gain, 0, 1);
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track || track.gain === value) return project;
  return mapTrack(project, trackId, (t) => ({ ...t, gain: value }));
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

/** How much echo the whole track gets, 0..1. 0 turns it off entirely. */
export function setTrackEcho(project: Project, trackId: string, echo: number): Project {
  const value = clamp(echo, 0, 1);
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track || track.echo === value) return project;
  return mapTrack(project, trackId, (t) => ({ ...t, echo: value }));
}

export function renameTrack(project: Project, trackId: string, name: string): Project {
  return mapTrack(project, trackId, (t) => ({ ...t, name }));
}

// ---- Per-block sound & chaining ------------------------------------------
//
// Each block (note) carries its own `params`. Blocks sharing a `groupId` are
// "chained": they always keep the same sound and length. Edits are applied to a
// set of note ids; the store expands a selection to include chained partners
// (see expandChain) so linked blocks move together.

/** Apply `fn` to every note whose id is in `ids`, across all tracks. */
function mapNotes(project: Project, ids: Set<string>, fn: (n: Note) => Note): Project {
  if (ids.size === 0) return project;
  return {
    ...project,
    tracks: project.tracks.map((t) =>
      t.notes.some((n) => ids.has(n.id))
        ? { ...t, notes: t.notes.map((n) => (ids.has(n.id) ? fn(n) : n)) }
        : t,
    ),
  };
}

function findNote(project: Project, noteId: string): Note | undefined {
  for (const t of project.tracks) {
    const n = t.notes.find((x) => x.id === noteId);
    if (n) return n;
  }
  return undefined;
}

/** All note ids chained with `noteId` (itself included). */
export function chainedIds(project: Project, noteId: string): string[] {
  const note = findNote(project, noteId);
  if (!note?.groupId) return note ? [noteId] : [];
  const ids: string[] = [];
  for (const t of project.tracks) for (const n of t.notes) if (n.groupId === note.groupId) ids.push(n.id);
  return ids;
}

/** Expand a selection to include every chained partner of every selected note. */
export function expandChain(project: Project, noteIds: string[]): Set<string> {
  const out = new Set<string>();
  for (const id of noteIds) for (const m of chainedIds(project, id)) out.add(m);
  return out;
}

export function setNotesParam(project: Project, ids: Set<string>, key: string, value: number): Project {
  const v = Number.isFinite(value) ? value : 0;
  return mapNotes(project, ids, (n) => ({ ...n, params: { ...n.params, [key]: v } }));
}

export function resetNotesParams(project: Project, ids: Set<string>): Project {
  return mapNotes(project, ids, (n) => ({ ...n, params: {} }));
}

export function setNotesLength(project: Project, ids: Set<string>, lengthBeats: number): Project {
  const len = Math.max(0.0625, lengthBeats);
  return mapNotes(project, ids, (n) => ({ ...n, lengthBeats: len }));
}

/** Link blocks into one chain: they take the first block's sound + length. */
export function chainNotes(project: Project, noteIds: string[]): Project {
  if (noteIds.length < 2) return project;
  const primary = findNote(project, noteIds[0]);
  if (!primary) return project;
  const groupId = newGroupId();
  const params = { ...primary.params };
  const lengthBeats = primary.lengthBeats;
  return mapNotes(project, new Set(noteIds), (n) => ({
    ...n,
    groupId,
    params: { ...params },
    lengthBeats,
  }));
}

/** Break the chain on the given blocks (they keep their current sound/length). */
export function unchainNotes(project: Project, noteIds: string[]): Project {
  return mapNotes(project, new Set(noteIds), (n) => {
    const next = { ...n };
    delete next.groupId;
    return next;
  });
}

/** Remove every note whose id is in `ids`, across all tracks. */
export function removeNotes(project: Project, ids: Set<string>): Project {
  if (ids.size === 0) return project;
  return {
    ...project,
    tracks: project.tracks.map((t) => ({ ...t, notes: t.notes.filter((n) => !ids.has(n.id)) })),
  };
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
/**
 * Move a block: in time, up or down the scale, to another row — and, since the
 * timeline shows the whole song end to end, into another *part*. Dragging a
 * block across a part boundary is the obvious thing to try once every part is
 * on screen at once, and it has to mean what it looks like it means.
 */
export function moveNote(
  project: Project,
  fromTrackId: string,
  noteId: string,
  toTrackId: string,
  startBeat: number,
  pitch?: number,
  sectionId?: string,
): Project {
  const fromTrack = project.tracks.find((t) => t.id === fromTrackId);
  const note = fromTrack?.notes.find((n) => n.id === noteId);
  if (!note) return project;

  const moved: Note = { ...note, startBeat: Math.max(0, startBeat) };
  if (sectionId && project.sections.some((s) => s.id === sectionId)) {
    moved.sectionId = sectionId;
  }
  // Re-pitching is only meaningful for a block that has a pitch. Giving a drum
  // one would make it a note the drum voices don't read and the note-grid can't
  // draw — silently turning a kick into something with no row to live on.
  if (pitch != null && note.pitch != null) {
    moved.pitch = clamp(Math.round(pitch), 0, 127);
  }
  if (fromTrackId === toTrackId) {
    return mapTrack(project, fromTrackId, (t) => ({
      ...t,
      notes: t.notes.map((n) => (n.id === noteId ? moved : n)),
    }));
  }
  const removed = removeNote(project, fromTrackId, noteId);
  return addNote(removed, toTrackId, moved);
}

// ---- getting blocks on the beat ------------------------------------------
//
// Placing a block is easy; placing eight of them the same distance apart is
// fiddly, and getting it slightly wrong is exactly what makes a beat sound
// wrong rather than sound like a style. These three do the arithmetic, so the
// answer to "how do I make it even?" is a button rather than a steady hand.

/** How long a section runs, in beats. */
function sectionLengthBeats(project: Project, sectionId: string): number {
  const section = project.sections.find((s) => s.id === sectionId);
  return section ? barsToBeats(section.lengthBars, project.timeSignature) : 0;
}

/**
 * Fill this block's part with copies of it, one every `everyBeats`.
 *
 * The copies land on the same *offset* as the block itself, not merely after
 * it — a kick sitting on beat 3 asked to repeat every beat fills beats 1, 2, 3
 * and 4, which is plainly what was meant, rather than leaving the first half
 * of the bar empty because that is where the child happened to click. A spot
 * already occupied by a matching block is left alone, so pressing the button
 * twice doesn't stack two blocks in the same place.
 */
export function repeatNoteEvenly(
  project: Project,
  trackId: string,
  noteId: string,
  everyBeats: number,
): Project {
  const track = project.tracks.find((t) => t.id === trackId);
  const note = track?.notes.find((n) => n.id === noteId);
  if (!track || !note || everyBeats <= 0) return project;
  const length = sectionLengthBeats(project, note.sectionId);
  if (length <= 0) return project;

  const phase = note.startBeat % everyBeats;
  const copies: Note[] = [];
  for (let beat = phase; beat < length - 1e-6; beat += everyBeats) {
    const taken = track.notes.some(
      (n) =>
        n.sectionId === note.sectionId &&
        Math.abs(n.startBeat - beat) < 1e-6 &&
        n.pitch === note.pitch,
    );
    if (taken) continue;
    copies.push({ ...note, id: newNoteId(), startBeat: beat, params: { ...note.params } });
  }
  if (copies.length === 0) return project;
  return mapTrack(project, trackId, (t) => ({ ...t, notes: [...t.notes, ...copies] }));
}

/** Move each of these blocks to the nearest multiple of `stepBeats`. */
export function alignNotes(project: Project, ids: Set<string>, stepBeats: number): Project {
  if (ids.size === 0 || stepBeats <= 0) return project;
  let changed = false;
  const tracks = project.tracks.map((track) => ({
    ...track,
    notes: track.notes.map((n) => {
      if (!ids.has(n.id)) return n;
      const length = sectionLengthBeats(project, n.sectionId);
      const snapped = clamp(
        Math.round(n.startBeat / stepBeats) * stepBeats,
        0,
        Math.max(0, length - stepBeats),
      );
      if (Math.abs(snapped - n.startBeat) < 1e-9) return n;
      changed = true;
      return { ...n, startBeat: snapped };
    }),
  }));
  return changed ? { ...project, tracks } : project;
}

/**
 * Spread these blocks evenly between the first and the last of them.
 *
 * The two ends stay exactly where they were put — those are the decision; the
 * ones in between are the arithmetic. Needs three to mean anything.
 */
export function spreadNotes(project: Project, ids: Set<string>): Project {
  const all: Note[] = [];
  for (const track of project.tracks) {
    for (const n of track.notes) if (ids.has(n.id)) all.push(n);
  }
  if (all.length < 3) return project;
  const sorted = [...all].sort((a, b) => a.startBeat - b.startBeat);
  const first = sorted[0].startBeat;
  const last = sorted[sorted.length - 1].startBeat;
  if (last - first <= 0) return project;
  const gap = (last - first) / (sorted.length - 1);
  const target = new Map<string, number>();
  sorted.forEach((n, i) => target.set(n.id, first + i * gap));

  let changed = false;
  const tracks = project.tracks.map((track) => ({
    ...track,
    notes: track.notes.map((n) => {
      const at = target.get(n.id);
      if (at == null || Math.abs(at - n.startBeat) < 1e-9) return n;
      changed = true;
      return { ...n, startBeat: at };
    }),
  }));
  return changed ? { ...project, tracks } : project;
}

// ---- Song-level edits ----------------------------------------------------

// Each of these returns the *same* project when the edit changes nothing (a
// stepper pressed at its limit, a rename to the current name). The store commits
// whatever it is handed, so a fresh-but-identical object would otherwise land an
// undo step that does nothing — and wipe the redo stack on the way.

/**
 * Change the song's scale — its mood — and bring every note already written
 * along with it, each moved to the nearest note of the new scale.
 *
 * Leaving the notes where they are would be easier and wrong: they'd sit off
 * the note-grid's rows, and the app's one promise to a child — that nothing on
 * the grid can sound wrong — would quietly stop being true for the song they
 * already had. Moving them keeps the tune recognisable *and* keeps the promise.
 */
/**
 * Play this row on a different instrument, tune and all.
 *
 * A child who writes a melody on the Piano and wants to hear it on the Bells
 * should not have to write it again. The notes come across by their place on
 * the note-grid rather than by their raw pitch, because instruments sit in
 * different registers — the Bass lives two octaves below the Piano, so keeping
 * the pitches would draw the tune on one row and play it somewhere else
 * entirely. Carrying the ladder position over lands it in the new instrument's
 * own range, sounding like the tune played *there*.
 *
 * A drum row can only become another drum, and a melodic row another melodic
 * one. Swapping across would leave every block carrying a pitch the drum voices
 * ignore and the grid has no row for — and this is enforced here, not in the
 * dropdown, so no future caller can get it wrong.
 */
export function setTrackVoice(project: Project, trackId: string, voiceId: string): Project {
  const voice = getVoice(voiceId);
  const track = project.tracks.find((t) => t.id === trackId);
  if (!voice || !track) return project;
  if (track.instrument.voiceId === voiceId) return project;
  const pitched = isPitched(voice);
  if (pitched !== (track.type === 'instrument')) return project;

  let notes = track.notes;
  if (pitched) {
    const previous = getVoice(track.instrument.voiceId);
    const from = pitchLadder(
      previous?.baseMidi ?? 60,
      previous?.octaves ?? 2,
      project.scaleRoot,
      project.scaleId,
    );
    const to = pitchLadder(voice.baseMidi ?? 60, voice.octaves ?? 2, project.scaleRoot, project.scaleId);
    notes = notes.map((note) =>
      note.pitch == null
        ? note
        : { ...note, pitch: to[clamp(nearestLadderIndex(from, note.pitch), 0, to.length - 1)] },
    );
  }

  return mapTrack(project, trackId, (t) => ({
    ...t,
    name: voice.label,
    color: voice.color,
    instrument: { ...t.instrument, voiceId },
    notes,
  }));
}

export function setScale(project: Project, scaleRoot: number, scaleId: string): Project {
  const root = clamp(Math.round(scaleRoot), 0, 11);
  if (!SCALES[scaleId]) return project;
  if (project.scaleRoot === root && project.scaleId === scaleId) return project;
  return {
    ...project,
    scaleRoot: root,
    scaleId,
    tracks: project.tracks.map((track) => ({
      ...track,
      notes: track.notes.map((note) =>
        note.pitch == null
          ? note
          : { ...note, pitch: mapPitchBetweenScales(note.pitch, root, project.scaleId, scaleId) },
      ),
    })),
  };
}

export function setBpm(project: Project, bpm: number): Project {
  const next = clamp(Math.round(bpm), MIN_BPM, MAX_BPM);
  if (next === project.bpm) return project;

  // A recording plays at the speed it was made — changing the song's tempo
  // can't stretch a voice. So the block it occupies has to be re-measured, or a
  // child who speeds the song up would see a block that no longer matches the
  // sound coming out of it.
  const ratio = next / project.bpm;
  const tracks = project.tracks.map((track) =>
    track.notes.some((n) => n.clipId)
      ? {
          ...track,
          notes: track.notes.map((note) =>
            note.clipId
              ? { ...note, lengthBeats: Math.max(0.0625, note.lengthBeats * ratio) }
              : note,
          ),
        }
      : track,
  );
  return { ...project, bpm: next, tracks };
}

// ---- Section & arrangement edits -----------------------------------------
//
// The song = sections (parts) played in arrangement order. Invariant kept by
// every operation here: at least one section, at least one arrangement entry,
// and every section appears in the arrangement (no hidden parts).

/** Add a brand-new empty part to the end of the song. */
export function addSection(project: Project): Project {
  const last = project.sections[project.sections.length - 1];
  const section = createSection(project.sections, last?.lengthBars ?? DEFAULT_BARS);
  return {
    ...project,
    sections: [...project.sections, section],
    arrangement: [...project.arrangement, { id: newEntryId(), sectionId: section.id }],
  };
}

/**
 * Copy a part — a new independent section with a copy of every note the source
 * had, added to the end of the song. Chains are copied too, but re-linked among
 * the copies so editing the copy never drags the original along.
 */
export function duplicateSection(project: Project, sectionId: string): Project {
  const source = project.sections.find((s) => s.id === sectionId);
  if (!source) return project;
  const section: Section = {
    ...createSection(project.sections, source.lengthBars),
  };
  const groupMap = new Map<string, string>();
  const tracks = project.tracks.map((t) => {
    const copies = t.notes
      .filter((n) => n.sectionId === sectionId)
      .map((n) => {
        const copy: Note = { ...n, id: newNoteId(), sectionId: section.id, params: { ...n.params } };
        if (n.groupId) {
          if (!groupMap.has(n.groupId)) groupMap.set(n.groupId, newGroupId());
          copy.groupId = groupMap.get(n.groupId);
        }
        return copy;
      });
    return copies.length > 0 ? { ...t, notes: [...t.notes, ...copies] } : t;
  });
  return {
    ...project,
    sections: [...project.sections, section],
    arrangement: [...project.arrangement, { id: newEntryId(), sectionId: section.id }],
    tracks,
  };
}

export function renameSection(project: Project, sectionId: string, name: string): Project {
  const section = project.sections.find((s) => s.id === sectionId);
  if (!section || section.name === name) return project;
  return {
    ...project,
    sections: project.sections.map((s) => (s.id === sectionId ? { ...s, name } : s)),
  };
}

export function setSectionLength(project: Project, sectionId: string, lengthBars: number): Project {
  const bars = clamp(Math.round(lengthBars), MIN_BARS, MAX_BARS);
  const section = project.sections.find((s) => s.id === sectionId);
  if (!section || section.lengthBars === bars) return project;
  return {
    ...project,
    sections: project.sections.map((s) => (s.id === sectionId ? { ...s, lengthBars: bars } : s)),
  };
}

/** Play a part one more time: add another arrangement slot for it at the end. */
export function repeatSection(project: Project, sectionId: string): Project {
  if (!project.sections.some((s) => s.id === sectionId)) return project;
  return {
    ...project,
    arrangement: [...project.arrangement, { id: newEntryId(), sectionId }],
  };
}

/** Move one slot of the song's running order to a new position. */
export function moveArrangementEntry(project: Project, fromIndex: number, toIndex: number): Project {
  const a = project.arrangement;
  if (fromIndex < 0 || fromIndex >= a.length || toIndex < 0 || toIndex >= a.length) return project;
  if (fromIndex === toIndex) return project;
  const next = [...a];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return { ...project, arrangement: next };
}

/**
 * Remove one slot from the song. If that was the section's only slot, the
 * section and its notes go too (nothing hidden). The last remaining slot can't
 * be removed — a song always has at least one part.
 */
export function removeArrangementEntry(project: Project, entryId: string): Project {
  if (project.arrangement.length <= 1) return project;
  const entry = project.arrangement.find((e) => e.id === entryId);
  if (!entry) return project;
  const arrangement = project.arrangement.filter((e) => e.id !== entryId);
  const stillUsed = arrangement.some((e) => e.sectionId === entry.sectionId);
  if (stillUsed) return { ...project, arrangement };
  return {
    ...project,
    arrangement,
    sections: project.sections.filter((s) => s.id !== entry.sectionId),
    tracks: project.tracks.map((t) => ({
      ...t,
      notes: t.notes.filter((n) => n.sectionId !== entry.sectionId),
    })),
  };
}

/**
 * Name the song. Blank is refused and the same name is a no-op: with several
 * songs on a shelf now, a row of blanks would be unusable, and committing an
 * unchanged name would spend an undo step that undoes nothing.
 */
export function renameProject(project: Project, name: string): Project {
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed || trimmed === project.name) return project;
  return { ...project, name: trimmed };
}

/** Find an existing track for a voice, or null. Used to group dropped drums. */
export function findTrackByVoice(project: Project, voiceId: string): Track | undefined {
  return project.tracks.find((t) => t.instrument.voiceId === voiceId);
}
