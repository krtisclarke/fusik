// Deciding *when* to autosave, and hooking it up to the store.
//
// The rule: never more than `AUTOSAVE_DELAY_MS` of work is at risk, and never
// more than one write per that window. Dragging a sound slider changes the
// project on every pointer move, and a recording take adds a note per key
// press; a plain "write when it goes quiet" debounce would keep pushing the
// write back for as long as the child kept going, which is exactly when there
// is most to lose. So the first change starts the clock and the write happens
// when it runs out, with whatever the song looks like by then.
//
// Closing the tab doesn't wait for that clock: the page-hidden events flush
// immediately, because after them there may be no page left to run in.

import type { StoreApi, UseBoundStore } from 'zustand';
import type { Project } from '../model/types';
import { writeAutosave } from '../platform/autosave';
import type { StoreState } from './store';

export const AUTOSAVE_DELAY_MS = 1000;

export interface Autosaver {
  /** The song changed. Guarantees a write within the delay. */
  schedule: (project: Project) => void;
  /** Write anything outstanding right now. */
  flush: () => void;
  /** Flush and stop; nothing further is scheduled. */
  stop: () => void;
}

export function createAutosaver(
  write: (project: Project) => void,
  delayMs: number = AUTOSAVE_DELAY_MS,
): Autosaver {
  let pending: Project | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function fire(): void {
    timer = null;
    const project = pending;
    pending = null;
    if (project) write(project);
  }

  return {
    schedule(project) {
      if (stopped) return;
      pending = project;
      // Already counting down — let it run out. Restarting it here is what
      // would let a busy child push the write off indefinitely.
      if (timer === null) timer = setTimeout(fire, delayMs);
    },
    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      const project = pending;
      pending = null;
      if (project) write(project);
    },
    stop() {
      this.flush();
      stopped = true;
    },
  };
}

/**
 * Wire autosaving to the store and the page's lifecycle. Returns a function
 * that unhooks it again (used by React's effect cleanup).
 */
export function startAutosave(store: UseBoundStore<StoreApi<StoreState>>): () => void {
  // Storage being full is worth telling the child once — "your song is safe
  // here" quietly becoming untrue is the one failure that matters. Repeating it
  // every second would be its own problem.
  let warnedFull = false;

  const autosaver = createAutosaver((project) => {
    const result = writeAutosave(project);
    if (result === 'full' && !warnedFull) {
      warnedFull = true;
      store.getState().setStatus("This song is too big to keep by itself — press Save to keep it in a file.");
    }
  });

  const unsubscribe = store.subscribe((state, previous) => {
    if (state.project !== previous.project) autosaver.schedule(state.project);
  });

  const flush = () => autosaver.flush();
  const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flush();
  };

  if (typeof window !== 'undefined') {
    // `pagehide` fires where `beforeunload` is unreliable (mobile, bfcache);
    // `visibilitychange` catches switching away, which on a phone or tablet is
    // often the last thing that happens before the page is discarded.
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
  }

  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    }
    unsubscribe();
    autosaver.stop();
  };
}
