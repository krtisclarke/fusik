import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAutosaver, AUTOSAVE_DELAY_MS } from './autosave';
import { createDefaultProject } from '../model/project';
import type { Project } from '../model/types';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('autosave timing', () => {
  it('writes the song shortly after a change', () => {
    const written: Project[] = [];
    const saver = createAutosaver((p) => written.push(p), AUTOSAVE_DELAY_MS);
    const project = createDefaultProject('One');

    saver.schedule(project);
    expect(written).toHaveLength(0); // not on every keystroke

    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    expect(written).toEqual([project]);
  });

  it('collapses a burst of changes into one write of the latest', () => {
    const written: Project[] = [];
    const saver = createAutosaver((p) => written.push(p), AUTOSAVE_DELAY_MS);

    const a = createDefaultProject('A');
    const b = createDefaultProject('B');
    const c = createDefaultProject('C');
    saver.schedule(a);
    vi.advanceTimersByTime(10);
    saver.schedule(b);
    vi.advanceTimersByTime(10);
    saver.schedule(c);

    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    expect(written).toEqual([c]);
  });

  // The one that matters: a child dragging a slider or recording a take changes
  // the song constantly. A "wait until it goes quiet" debounce would put the
  // write off for as long as they kept going — losing exactly the work that was
  // hardest won. The clock starts on the first change and is not restarted.
  it('keeps writing while the song is being changed continuously', () => {
    const written: Project[] = [];
    const saver = createAutosaver((p) => written.push(p), AUTOSAVE_DELAY_MS);

    // Ten seconds of a slider being dragged: a change every 50 ms, never a gap.
    for (let t = 0; t < 10_000; t += 50) {
      saver.schedule(createDefaultProject(`t${t}`));
      vi.advanceTimersByTime(50);
    }

    expect(written.length).toBeGreaterThanOrEqual(9);
    expect(written[0].name).toBe('t950');
  });

  it('writes immediately when the tab is going away', () => {
    const written: Project[] = [];
    const saver = createAutosaver((p) => written.push(p), AUTOSAVE_DELAY_MS);

    saver.schedule(createDefaultProject('Last'));
    saver.flush();
    expect(written.map((p) => p.name)).toEqual(['Last']);

    // The pending timer must be cancelled, not left to write a second time.
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2);
    expect(written).toHaveLength(1);
  });

  it('writes nothing when nothing has changed', () => {
    const written: Project[] = [];
    const saver = createAutosaver((p) => written.push(p), AUTOSAVE_DELAY_MS);
    saver.flush();
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2);
    expect(written).toHaveLength(0);
  });

  it('saves what is outstanding when it stops, then stops', () => {
    const written: Project[] = [];
    const saver = createAutosaver((p) => written.push(p), AUTOSAVE_DELAY_MS);

    saver.schedule(createDefaultProject('Pending'));
    saver.stop();
    expect(written.map((p) => p.name)).toEqual(['Pending']);

    saver.schedule(createDefaultProject('After'));
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2);
    expect(written).toHaveLength(1);
  });
});
