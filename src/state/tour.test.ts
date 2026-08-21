import { describe, it, expect } from 'vitest';
import { TOUR_STEPS, isStepDone, remainingLabel, type TourContext } from './tour';

const EMPTY: TourContext = {
  drumNotes: 0,
  drumRows: 0,
  instrumentTracks: 0,
  instrumentNotes: 0,
  isPlaying: false,
  playedNotes: 0,
  parts: 1,
};

const step = (id: string) => {
  const found = TOUR_STEPS.find((s) => s.id === id);
  if (!found) throw new Error(`no step ${id}`);
  return found;
};

describe('the first-song walkthrough', () => {
  it('opens and closes with steps the child only has to read', () => {
    const first = TOUR_STEPS[0];
    const last = TOUR_STEPS[TOUR_STEPS.length - 1];
    expect(first.goal).toBeUndefined();
    expect(last.goal).toBeUndefined();
    expect(first.button).toBeTruthy();
    expect(last.button).toBeTruthy();
    // A read-only step is never "done" by itself — the button is the only way on.
    expect(isStepDone(first, EMPTY, EMPTY)).toBe(false);
  });

  it('finishes a step when the child does the thing', () => {
    const kick = step('kick');
    expect(isStepDone(kick, EMPTY, EMPTY)).toBe(false);
    expect(isStepDone(kick, { ...EMPTY, drumNotes: 2 }, EMPTY)).toBe(false);
    expect(isStepDone(kick, { ...EMPTY, drumNotes: 3 }, EMPTY)).toBe(true);
    expect(isStepDone(kick, { ...EMPTY, drumNotes: 9 }, EMPTY)).toBe(true);
  });

  // The one that matters for replaying it later. Every goal is measured against
  // the moment the step began, so a child who already has a song doesn't watch
  // the walkthrough race through six steps it thinks are already done.
  it('asks for new work, not work already on screen', () => {
    const busy: TourContext = {
      drumNotes: 40,
      drumRows: 3,
      instrumentTracks: 2,
      instrumentNotes: 30,
      isPlaying: false,
      playedNotes: 50,
      parts: 4,
    };
    for (const s of TOUR_STEPS) {
      if (!s.goal || s.id === 'play') continue; // 'play' asks for a state, not a count
      expect(isStepDone(s, busy, busy), `${s.id} should still need doing`).toBe(false);
    }
    // And each still completes once the child adds to it.
    expect(isStepDone(step('kick'), { ...busy, drumNotes: 43 }, busy)).toBe(true);
    expect(isStepDone(step('layer'), { ...busy, drumRows: 4 }, busy)).toBe(true);
    expect(isStepDone(step('instrument'), { ...busy, instrumentTracks: 3 }, busy)).toBe(true);
    expect(isStepDone(step('melody'), { ...busy, instrumentNotes: 33 }, busy)).toBe(true);
    expect(isStepDone(step('keyboard'), { ...busy, playedNotes: 53 }, busy)).toBe(true);
    expect(isStepDone(step('parts'), { ...busy, parts: 5 }, busy)).toBe(true);
  });

  it('is not undone by taking something away again', () => {
    // Placing beats then deleting one shouldn't read as negative progress.
    const kick = step('kick');
    expect(remainingLabel(kick, { ...EMPTY, drumNotes: 0 }, { ...EMPTY, drumNotes: 5 })).toBe(
      '3 to go',
    );
  });

  it('counts down what is left, and says nothing once there is nothing left', () => {
    const kick = step('kick');
    expect(remainingLabel(kick, EMPTY, EMPTY)).toBe('3 to go');
    expect(remainingLabel(kick, { ...EMPTY, drumNotes: 2 }, EMPTY)).toBe('1 to go');
    expect(remainingLabel(kick, { ...EMPTY, drumNotes: 3 }, EMPTY)).toBeNull();
    // One-off steps don't get a countdown — "1 to go" tells a child nothing.
    expect(remainingLabel(step('play'), EMPTY, EMPTY)).toBeNull();
    expect(remainingLabel(TOUR_STEPS[0], EMPTY, EMPTY)).toBeNull();
  });

  it('points every step at a control that exists, and starts at the beginning', () => {
    const targets = new Set(['lanes', 'play', 'library', 'keyboard', 'parts']);
    for (const s of TOUR_STEPS) {
      if (s.target) expect(targets.has(s.target), `${s.id} -> ${s.target}`).toBe(true);
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.body.length).toBeGreaterThan(0);
    }
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
  });
});
