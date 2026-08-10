// Snapshot-based undo/redo.
//
// Rather than recording each *action* and how to reverse it, we simply keep
// snapshots of whole project states. Undo = step back to the previous snapshot;
// redo = step forward. Because projects are small immutable objects, this is
// cheap, and — critically for a kids' app where fearless experimentation is the
// whole point — it is impossible to get subtly wrong. Every action is undoable
// by construction.

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const DEFAULT_HISTORY_LIMIT = 100;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/**
 * Record a new present state. The previous present moves into the past, and the
 * redo stack is cleared (you've branched away from it). `limit` caps how far
 * back undo can reach so memory stays bounded.
 */
export function commit<T>(history: History<T>, next: T, limit = DEFAULT_HISTORY_LIMIT): History<T> {
  const past = [...history.past, history.present];
  if (past.length > limit) past.shift();
  return { past, present: next, future: [] };
}

/** Replace the present without touching history — for live drags, etc. */
export function replacePresent<T>(history: History<T>, next: T): History<T> {
  return { ...history, present: next };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history;
  const next = history.future[0];
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}
