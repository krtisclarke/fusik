import { describe, it, expect } from 'vitest';
import {
  TOUR_STEPS,
  isStepDone,
  nextCelebration,
  remainingLabel,
  stepApplies,
  type TourContext,
} from './tour';

const EMPTY: TourContext = {
  drumNotes: 0,
  drumRows: 0,
  instrumentTracks: 0,
  instrumentNotes: 0,
  isPlaying: false,
  playedNotes: 0,
  parts: 1,
  recordings: 0,
  canRecordMic: true,
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
      recordings: 3,
      canRecordMic: true,
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
    const targets = new Set(['lanes', 'play', 'library', 'keyboard', 'parts', 'mic']);
    for (const s of TOUR_STEPS) {
      if (s.target) expect(targets.has(s.target), `${s.id} -> ${s.target}`).toBe(true);
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.body.length).toBeGreaterThan(0);
    }
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
  });
});

describe('the tick between steps', () => {
  it('starts when the step is done, and not before', () => {
    expect(nextCelebration(null, 2, false)).toBeNull();
    expect(nextCelebration(null, 2, true)).toBe(2);
  });

  // The bug this exists for. On "Hear it" a child presses play, sees the tick,
  // and presses play again to stop — inside the same second. If the tick were
  // tied to the goal still being met, that second press would cancel it along
  // with the timer that moves the walkthrough on, and the card would sit on
  // "Nice one!" with its buttons disabled for ever, because nothing would ever
  // complete that step again.
  it('does not stop when the child undoes the thing they just did', () => {
    let c = nextCelebration(null, 3, true);
    expect(c).toBe(3);
    c = nextCelebration(c, 3, false); // pressed stop again
    expect(c).toBe(3);
    c = nextCelebration(c, 3, false);
    expect(c).toBe(3);
  });

  it('ends when the walkthrough moves on', () => {
    let c = nextCelebration(null, 3, true);
    c = nextCelebration(c, 4, false); // the next step opened
    expect(c).toBeNull();
  });

  it('ends when the walkthrough is closed, whatever it was doing', () => {
    // Closing mid-tick used to strand the tick, so pressing ? later reopened a
    // dead card: "Nice one!" with a greyed-out Start, for the rest of the session.
    const mid = nextCelebration(null, 3, true);
    expect(nextCelebration(mid, null, true)).toBeNull();
    expect(nextCelebration(mid, null, false)).toBeNull();
  });

  it('lets a reopened walkthrough celebrate again', () => {
    const closed = nextCelebration(nextCelebration(null, 3, true), null, false);
    expect(closed).toBeNull();
    expect(nextCelebration(closed, 0, false)).toBeNull(); // welcome has nothing to do
    expect(nextCelebration(closed, 1, true)).toBe(1);
  });
});

describe('a step that does not apply here', () => {
  // Recording needs the desktop app. A step telling a child in a browser to
  // press a button that is disabled is worse than no step at all.
  it('is skipped where it cannot be followed', () => {
    const voice = TOUR_STEPS.find((s) => s.id === 'voice');
    expect(voice, 'the walkthrough should teach recording').toBeTruthy();
    expect(stepApplies(voice!, { ...EMPTY, canRecordMic: true })).toBe(true);
    expect(stepApplies(voice!, { ...EMPTY, canRecordMic: false })).toBe(false);
  });

  it('is the only one that is ever skipped', () => {
    // Everything else must be doable wherever the app runs, or a child could be
    // left on a step with nothing to press and no way forward but Skip.
    for (const step of TOUR_STEPS) {
      if (step.id === 'voice') continue;
      expect(stepApplies(step, { ...EMPTY, canRecordMic: false }), step.id).toBe(true);
    }
  });

  it('completes when a recording is made', () => {
    const voice = TOUR_STEPS.find((s) => s.id === 'voice')!;
    expect(isStepDone(voice, EMPTY, EMPTY)).toBe(false);
    expect(isStepDone(voice, { ...EMPTY, recordings: 1 }, EMPTY)).toBe(true);
    // and on a replay, an existing recording doesn't count for a new one
    const busy = { ...EMPTY, recordings: 4 };
    expect(isStepDone(voice, busy, busy)).toBe(false);
    expect(isStepDone(voice, { ...busy, recordings: 5 }, busy)).toBe(true);
  });
});
