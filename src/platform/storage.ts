// The browser's own little cupboard, and the one careful way we open it.
//
// Merely *reading* `localStorage` throws in some privacy modes, so every use
// goes through here rather than touching the global directly. Everything the
// app keeps locally — the autosaved song, whether the walkthrough has been
// seen — lives behind this.

/** The bit of the Storage interface we use — so tests can hand in a fake. */
export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/** The browser's local storage, or null where there isn't a usable one. */
export function browserStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}
