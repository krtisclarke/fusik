// The songs a child has made, kept on this computer.
//
// Autosave started as a single slot: the app remembered the song you were last
// working on and nothing else. That is enough right up until a child makes
// something they like and then starts a new one — at which point the first is
// gone unless they thought to save a file, which children do not.
//
// So the browser's storage holds a shelf instead: an index of songs, and one
// slot per song holding exactly the text a .beatbox file holds. Everything goes
// out through `serializeProject` and comes back through `parseProject`, so a
// restored song gets the same validation, repair and version check a file does,
// and any slot that can't be read can only ever mean "that song isn't there",
// never a broken app.
//
// Local only. Nothing here leaves the machine.

import { parseProject, serializeProject } from '../model/serialization';
import type { Project } from '../model/types';
import { browserStorage, type StorageLike } from './storage';

const INDEX_KEY = 'beatbox.songs.v1';
const SLOT_PREFIX = 'beatbox.song.';
const CURRENT_KEY = 'beatbox.current.v1';
/** The single slot the first version of autosave used. Read once, then retired. */
const LEGACY_SLOT_KEY = 'beatbox.autosave.v1';

/** What the songs list shows. The song itself lives in its own slot. */
export interface SongSummary {
  id: string;
  name: string;
  savedAt: number;
}

export type WriteResult = 'ok' | 'full' | 'unavailable';

function slotKey(id: string): string {
  return SLOT_PREFIX + id;
}

function readIndex(storage: StorageLike): SongSummary[] {
  try {
    const raw = storage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is SongSummary =>
          !!entry &&
          typeof entry.id === 'string' &&
          entry.id.length > 0 &&
          typeof entry.name === 'string' &&
          typeof entry.savedAt === 'number' &&
          Number.isFinite(entry.savedAt),
      )
      .map((entry) => ({ id: entry.id, name: entry.name, savedAt: entry.savedAt }));
  } catch {
    return []; // a corrupt index means an empty shelf, never a failed start
  }
}

function writeIndex(storage: StorageLike, songs: SongSummary[]): WriteResult {
  try {
    storage.setItem(INDEX_KEY, JSON.stringify(songs));
    return 'ok';
  } catch {
    return 'full';
  }
}

/** Every song on the shelf, most recently worked on first. */
export function listSongs(storage: StorageLike | null = browserStorage()): SongSummary[] {
  if (!storage) return [];
  return readIndex(storage).sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * One song, or null if it isn't there or can't be read.
 *
 * Never throws and never deletes: a slot that can't be read today might still
 * mean something to a human with a text editor, and opening a song must not be
 * the thing that destroys it.
 */
export function readSong(
  id: string,
  storage: StorageLike | null = browserStorage(),
): Project | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(slotKey(id));
    if (!raw) return null;
    return parseProject(raw);
  } catch {
    return null; // corrupt, or from a newer format than this build understands
  }
}

/** Put a song on the shelf under `id`, replacing whatever was there. */
export function writeSong(
  id: string,
  project: Project,
  storage: StorageLike | null = browserStorage(),
): WriteResult {
  if (!storage) return 'unavailable';
  try {
    storage.setItem(slotKey(id), serializeProject(project));
  } catch {
    // Out of room, or storage denied. The song in front of the child is
    // untouched; only the shelf is. The caller says so once, not every second.
    return 'full';
  }
  const songs = readIndex(storage).filter((s) => s.id !== id);
  songs.push({ id, name: project.name, savedAt: Date.now() });
  return writeIndex(storage, songs);
}

/** Take a song off the shelf for good. */
export function deleteSong(id: string, storage: StorageLike | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(slotKey(id));
  } catch {
    // Already gone or unreachable; the index still needs tidying either way.
  }
  writeIndex(
    storage,
    readIndex(storage).filter((s) => s.id !== id),
  );
}

/** Which song the app was last in, if that song is still on the shelf. */
export function readCurrentSongId(storage: StorageLike | null = browserStorage()): string | null {
  if (!storage) return null;
  try {
    const id = storage.getItem(CURRENT_KEY);
    if (!id) return null;
    return readIndex(storage).some((s) => s.id === id) ? id : null;
  } catch {
    return null;
  }
}

export function writeCurrentSongId(
  id: string,
  storage: StorageLike | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(CURRENT_KEY, id);
  } catch {
    // Worst case the app opens the most recent song instead of this one.
  }
}

/**
 * Bring the old single-slot autosave onto the shelf, once.
 *
 * Without this, updating the app would silently swallow whatever the child was
 * working on — the one thing autosave exists to prevent. The legacy slot is
 * cleared only after its song is safely stored under its own id.
 */
export function importLegacyAutosave(
  newId: string,
  storage: StorageLike | null = browserStorage(),
): string | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(LEGACY_SLOT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let project: Project;
  try {
    const legacy = JSON.parse(raw) as { json?: unknown };
    if (!legacy || typeof legacy.json !== 'string') return null;
    project = parseProject(legacy.json);
  } catch {
    return null;
  }

  if (writeSong(newId, project, storage) !== 'ok') return null;
  try {
    storage.removeItem(LEGACY_SLOT_KEY);
  } catch {
    // Left behind; it will simply be ignored from now on.
  }
  return newId;
}
