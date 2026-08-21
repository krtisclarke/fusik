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
import { getDesktop } from './files';
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

/**
 * The desktop app's songs folder, when we're running in the desktop app.
 *
 * On the desktop a song is a real file a grown-up can find, copy and back up,
 * with no few-megabyte browser allowance in the way — which is what makes room
 * for recordings. In a plain browser (development) there is no such folder, and
 * everything below falls back to local storage. Tests pass a fake storage in
 * explicitly and so never take this path.
 */
function desktopSongs() {
  return getDesktop()?.songs;
}

/** Every song on the shelf, most recently worked on first. */
export function listSongs(storage: StorageLike | null = browserStorage()): SongSummary[] {
  const files = desktopSongs();
  if (files) {
    const result = files.list();
    return (result.ok && result.songs ? result.songs : []).sort((a, b) => b.savedAt - a.savedAt);
  }
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
  const files = desktopSongs();
  if (files) {
    try {
      const result = files.read(id);
      return result.ok && result.json ? parseProject(result.json) : null;
    } catch {
      return null;
    }
  }
  if (!storage) return null;
  try {
    const raw = storage.getItem(slotKey(id));
    if (!raw) return null;
    return parseProject(raw);
  } catch {
    return null; // corrupt, or from a newer format than this build understands
  }
}

/**
 * On the desktop a song's id *is* its file name, so renaming the song renames
 * the file and the id moves with it. Callers hold the id, so writing hands the
 * new one back.
 */
export interface WriteOutcome {
  result: WriteResult;
  id: string;
}

/** Write, and report the id the song now lives under. */
export function saveSong(
  id: string,
  project: Project,
  storage: StorageLike | null = browserStorage(),
): WriteOutcome {
  const files = desktopSongs();
  if (files) {
    try {
      const written = files.write(id, project.name, serializeProject(project));
      return written.ok ? { result: 'ok', id: written.id ?? id } : { result: 'full', id };
    } catch {
      return { result: 'full', id };
    }
  }
  return { result: writeSong(id, project, storage), id };
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
  const files = desktopSongs();
  if (files) {
    try {
      files.remove(id);
    } catch {
      // Already gone, or the folder is unreachable; nothing else to undo.
    }
    return;
  }
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
  let id: string | null;
  try {
    id = storage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
  if (!id) return null;
  // Only if that song is still there. Which shelf it lives on doesn't matter;
  // this pointer is about this machine, not about anyone's work.
  return listSongs(storage).some((s) => s.id === id) ? id : null;
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
 * Move songs that were kept in browser storage into the desktop's folder, once.
 *
 * The first version of the shelf lived in local storage even in the desktop
 * app. Anyone who used it has songs there, and switching to real files must not
 * look like the app forgot them. Each song is copied across and then removed
 * from storage — but only after the copy is on disk, so a failure leaves the
 * original exactly where it was.
 *
 * Returns the new id of the song that was open, if it was one of them.
 */
export function importBrowserShelf(
  storage: StorageLike | null = browserStorage(),
): string | null {
  const files = desktopSongs();
  if (!files || !storage) return null;

  // Read the "which song was open" pointer straight from storage. The public
  // reader checks it against the songs that exist, and at this moment none of
  // them do — they are all still in storage, which is the thing being emptied.
  // Going through it would hand back null and lose the child's place.
  let currentId: string | null = null;
  try {
    currentId = storage.getItem(CURRENT_KEY);
  } catch {
    currentId = null;
  }

  let movedCurrentTo: string | null = null;
  for (const summary of readIndex(storage)) {
    let project: Project;
    try {
      const raw = storage.getItem(slotKey(summary.id));
      if (!raw) continue;
      project = parseProject(raw);
    } catch {
      continue; // unreadable: leave it alone rather than destroying it
    }
    const written = saveSong(summary.id, project, storage);
    if (written.result !== 'ok') continue;
    if (summary.id === currentId) movedCurrentTo = written.id;
    try {
      storage.removeItem(slotKey(summary.id));
    } catch {
      // Left behind; harmless, since the index below is what's read.
    }
  }
  writeIndex(storage, []);
  if (movedCurrentTo) writeCurrentSongId(movedCurrentTo, storage);
  return movedCurrentTo;
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
  // Mark it as the song that was open. Without this the child lands on a blank
  // song after updating — their work is safely on the shelf, but nothing says
  // so, which looks exactly like having lost it. It also lets the desktop's
  // sweep below carry their place across to the folder.
  writeCurrentSongId(newId, storage);
  try {
    storage.removeItem(LEGACY_SLOT_KEY);
  } catch {
    // Left behind; it will simply be ignored from now on.
  }
  return newId;
}
