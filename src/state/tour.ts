// The first-song walkthrough: what it asks for, and how it knows it happened.
//
// The steps are plain data and pure functions so they can be tested without a
// browser. A step is finished by the child *doing the thing* — placing beats,
// pressing play, playing a key — not by pressing Next, which is what makes this
// a walkthrough rather than a slideshow.
//
// Every goal is measured against a snapshot taken when the step began, never
// against zero. That way the walkthrough behaves the same on an empty song and
// on one the child already has: "put in three beats" always means three more
// than there were a moment ago, so replaying it later can't skip half the steps
// because the work is already on screen.

/** What the walkthrough can see about the song and what's being done to it. */
export interface TourContext {
  /** Drum blocks in the part currently on screen. */
  drumNotes: number;
  /** How many different drum rows have a block in that part. */
  drumRows: number;
  /** Melodic tracks (piano, synth, bells, bass) in the song. */
  instrumentTracks: number;
  /** Melodic blocks in the part currently on screen. */
  instrumentNotes: number;
  /** Is the song playing right now. */
  isPlaying: boolean;
  /** Notes played by hand on the keyboard since the app opened. */
  playedNotes: number;
  /** How many parts the song has. */
  parts: number;
}

export interface TourProgress {
  done: number;
  total: number;
}

export interface TourStep {
  id: string;
  title: string;
  /** One or two short sentences. `*word*` is drawn bold. */
  body: string;
  /** `data-tour` value of the control to point at. Absent = middle of screen. */
  target?: string;
  /** Label for the button that moves on. */
  button?: string;
  /**
   * How much of this step is done. Absent means there is nothing to do but
   * read it, so the button is the only way on.
   */
  goal?: (now: TourContext, start: TourContext) => TourProgress;
}

/** Clamped progress towards `total` more of something than there was at `start`. */
function moreThan(now: number, start: number, total: number): TourProgress {
  return { done: Math.max(0, Math.min(total, now - start)), total };
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: "Let's make a song",
    body: "It takes a couple of minutes, and at the end you'll have something you can really listen to.",
    button: 'Start',
  },
  {
    id: 'kick',
    title: 'Start with a drum',
    body: 'Click the empty squares in the *Kick* row to drop some beats in.',
    target: 'lanes',
    goal: (now, start) => moreThan(now.drumNotes, start.drumNotes, 3),
  },
  {
    id: 'layer',
    title: 'Add another drum',
    body: 'Now put some beats in a different row — the *Snare* or the *Hi-Hat*. Two drums together already sound like music.',
    target: 'lanes',
    goal: (now, start) => moreThan(now.drumRows, start.drumRows, 1),
  },
  {
    id: 'play',
    title: 'Hear it',
    body: 'Press *▶* to start. Your beat goes round and round, and you can keep changing it while it plays.',
    target: 'play',
    goal: (now) => ({ done: now.isPlaying ? 1 : 0, total: 1 }),
  },
  {
    id: 'instrument',
    title: 'Add a tune',
    body: 'Find *Piano* in the list on the left and drag it onto the timeline.',
    target: 'library',
    goal: (now, start) => moreThan(now.instrumentTracks, start.instrumentTracks, 1),
  },
  {
    id: 'melody',
    title: 'Write some notes',
    body: "Click in the Piano row to place notes. Every square on the grid fits the others, so there's no wrong one to pick.",
    target: 'lanes',
    goal: (now, start) => moreThan(now.instrumentNotes, start.instrumentNotes, 3),
  },
  {
    id: 'keyboard',
    title: 'Play it yourself',
    body: 'The keys along the bottom play your piano — try the *z x c v b* keys. Hit a key near the *bottom* for a loud note and near the *top* for a soft one.',
    target: 'keyboard',
    goal: (now, start) => moreThan(now.playedNotes, start.playedNotes, 3),
  },
  {
    id: 'parts',
    title: 'Give it a second bit',
    body: 'Real songs change halfway through. Press *＋ New part* and make a different beat in it.',
    target: 'parts',
    goal: (now, start) => moreThan(now.parts, start.parts, 1),
  },
  {
    id: 'done',
    title: "That's a song!",
    body: "It saves itself, so it'll be waiting for you next time. *Export* turns it into an audio file you can play anywhere.",
    button: 'Finish',
  },
];

/** Has the child done what this step asked? Read-only steps are never "done". */
export function isStepDone(step: TourStep, now: TourContext, start: TourContext): boolean {
  if (!step.goal) return false;
  const { done, total } = step.goal(now, start);
  return done >= total;
}

/**
 * Which step's "Nice one!" should be showing, given what was showing a moment
 * ago. The walkthrough pauses on a tick before moving on, and this decides when
 * that tick is up.
 *
 * The important word is **latched**. A celebration belongs to the step that
 * earned it, not to the goal still being met right now — because plenty of
 * goals can un-complete. A child on "Hear it" presses play, sees the tick, and
 * presses play again to stop it, all inside the same second; a beat placed can
 * be deleted; a new part can be undone. If the tick were tied to the goal, that
 * second press would cancel the celebration mid-flight, taking the timer that
 * moves the walkthrough on with it and leaving the card frozen on "Nice one!"
 * with its buttons disabled — stuck for good, since nothing would ever complete
 * that step again.
 *
 * So: once a step is celebrating it keeps celebrating until the step itself
 * changes, and a closed walkthrough is never celebrating anything.
 */
export function nextCelebration(
  current: number | null,
  stepIndex: number | null,
  done: boolean,
): number | null {
  if (stepIndex == null) return null; // the walkthrough is closed
  if (current === stepIndex) return current; // latched to the step that earned it
  if (current != null) return null; // the tick belonged to a step we've left
  return done ? stepIndex : null;
}

/** "2 to go" — or null when there is nothing to count. */
export function remainingLabel(step: TourStep, now: TourContext, start: TourContext): string | null {
  if (!step.goal) return null;
  const { done, total } = step.goal(now, start);
  if (total <= 1 || done >= total) return null;
  return `${total - done} to go`;
}
