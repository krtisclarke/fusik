// Small local preferences — the things the app should remember about *this
// computer* rather than about the song. Local only, like everything else here.

import { browserStorage, type StorageLike } from './storage';

const TUTORIAL_SEEN_KEY = 'beatbox.tutorial.v1';

/**
 * Has the walkthrough already been offered? It should appear once, unasked, for
 * a child opening the app for the first time — and never again on its own. The
 * ? button in the toolbar starts it whenever they want it back.
 */
export function hasSeenTutorial(storage: StorageLike | null = browserStorage()): boolean {
  if (!storage) return true; // nowhere to remember "seen" = don't nag on every load
  try {
    return storage.getItem(TUTORIAL_SEEN_KEY) === 'done';
  } catch {
    return true;
  }
}

export function markTutorialSeen(storage: StorageLike | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(TUTORIAL_SEEN_KEY, 'done');
  } catch {
    // Out of room or storage denied: the walkthrough will offer itself again
    // next time, which is a far better failure than the app refusing to start.
  }
}
