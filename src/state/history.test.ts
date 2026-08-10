import { describe, it, expect } from 'vitest';
import { createHistory, commit, undo, redo, canUndo, canRedo } from './history';

describe('undo / redo history', () => {
  it('starts with nothing to undo or redo', () => {
    const h = createHistory('a');
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(h.present).toBe('a');
  });

  it('commits, undoes, and redoes', () => {
    let h = createHistory('a');
    h = commit(h, 'b');
    h = commit(h, 'c');
    expect(h.present).toBe('c');
    expect(canUndo(h)).toBe(true);

    h = undo(h);
    expect(h.present).toBe('b');
    h = undo(h);
    expect(h.present).toBe('a');
    expect(canUndo(h)).toBe(false);

    h = redo(h);
    expect(h.present).toBe('b');
    h = redo(h);
    expect(h.present).toBe('c');
    expect(canRedo(h)).toBe(false);
  });

  it('clears the redo stack after a new commit', () => {
    let h = createHistory('a');
    h = commit(h, 'b');
    h = undo(h); // present 'a', future has 'b'
    expect(canRedo(h)).toBe(true);
    h = commit(h, 'z'); // branch away
    expect(canRedo(h)).toBe(false);
    expect(h.present).toBe('z');
  });

  it('is a no-op at the ends', () => {
    const h = createHistory('a');
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it('respects the history limit', () => {
    let h = createHistory(0);
    for (let i = 1; i <= 5; i++) h = commit(h, i, 2);
    expect(h.present).toBe(5);
    expect(h.past).toHaveLength(2); // capped
    // Can only step back through the two retained snapshots.
    h = undo(h);
    h = undo(h);
    expect(canUndo(h)).toBe(false);
    expect(h.present).toBe(3);
  });
});
