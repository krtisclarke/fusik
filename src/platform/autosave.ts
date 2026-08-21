// Keeping the song safe between visits.
//
// A child does not think to save. Closing the tab, a crash, a laptop lid — any
// of those used to take the whole song with them, because the only copy lived
// in memory. So the app keeps its own copy in the browser's local storage and
// puts it back on the next start.
//
// It is deliberately the *same bytes* a .beatbox file holds: `serializeProject`
// out, `parseProject` back in. That means the restored song goes through the
// exact validation and repair a file does, and a half-written or hand-mangled
// slot can only ever mean "no autosave", never a broken app.
//
// Local storage only — no accounts, nothing leaves the machine. It is a single
// slot: the song as it is now, not a history of versions (undo covers that
// within a session).

import { parseProject, serializeProject } from '../model/serialization';
import type { Project } from '../model/types';

/** Versioned so a future change of shape can't be misread as this one. */
export const AUTOSAVE_KEY = 'beatbox.autosave.v1';

/** What actually sits in the slot. `json` is a whole .beatbox file's text. */
interface AutosaveSlot {
  savedAt: number;
  name: string;
  json: string;
}

/** The bit of the Storage interface we use — so tests can hand in a fake. */
export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/**
 * The browser's local storage, or null where there isn't one. Merely *reading*
 * `localStorage` throws in some privacy modes, so even that is guarded — the
 * app has to keep working without a place to autosave.
 */
export function browserStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export type WriteResult = 'ok' | 'full' | 'unavailable';

/** Put the song in the slot, replacing whatever was there. */
export function writeAutosave(project: Project, storage = browserStorage()): WriteResult {
  if (!storage) return 'unavailable';
  const slot: AutosaveSlot = {
    savedAt: Date.now(),
    name: project.name,
    json: serializeProject(project),
  };
  try {
    storage.setItem(AUTOSAVE_KEY, JSON.stringify(slot));
    return 'ok';
  } catch {
    // Out of room (the quota is a few megabytes) or storage denied. Either way
    // the song in front of the child is untouched; only the safety net is gone,
    // and the caller says so once rather than every second.
    return 'full';
  }
}

export interface RestoredProject {
  project: Project;
  savedAt: number;
}

/**
 * The song from the last visit, or null if there isn't a usable one.
 *
 * Never throws and never clears the slot: a slot that can't be read today might
 * still be worth something to a human with a text editor, and startup must not
 * be the thing that deletes it.
 */
export function readAutosave(storage = browserStorage()): RestoredProject | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(AUTOSAVE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const slot = JSON.parse(raw) as Partial<AutosaveSlot>;
    if (!slot || typeof slot.json !== 'string') return null;
    const project = parseProject(slot.json);
    const savedAt = typeof slot.savedAt === 'number' && Number.isFinite(slot.savedAt) ? slot.savedAt : 0;
    return { project, savedAt };
  } catch {
    return null; // corrupt, or from a newer format than this build understands
  }
}

/** Empty the slot — starting a new song, so there is nothing to come back to. */
export function clearAutosave(storage = browserStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(AUTOSAVE_KEY);
  } catch {
    // Nothing to do: the slot is either already gone or unreachable.
  }
}
