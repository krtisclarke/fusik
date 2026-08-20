// Musical time math. Pure functions, no state — easy to reason about and test.
//
// The core idea: the audio engine thinks in *seconds* (that's what Web Audio
// schedules on), but musicians and the UI think in *beats* and *bars*. These
// helpers translate between the two, and handle snapping to the grid.
//
// Phase 1 simplification: one "beat" is a quarter note, and a bar holds
// `timeSignature.numerator` beats. Odd denominators (6/8 etc.) are a later
// concern; the default is 4/4.

import type { TimeSignature } from './types';

export function secondsPerBeat(bpm: number): number {
  return 60 / bpm;
}

export function beatsToSeconds(beats: number, bpm: number): number {
  return beats * secondsPerBeat(bpm);
}

export function secondsToBeats(seconds: number, bpm: number): number {
  return seconds / secondsPerBeat(bpm);
}

export function beatsPerBar(ts: TimeSignature): number {
  return ts.numerator;
}

export function barsToBeats(bars: number, ts: TimeSignature): number {
  return bars * beatsPerBar(ts);
}

export function totalBeats(lengthBars: number, ts: TimeSignature): number {
  return barsToBeats(lengthBars, ts);
}

/** Split an absolute beat into a musician-friendly bar + beat-within-bar. */
export function beatToBarAndBeat(
  beat: number,
  ts: TimeSignature,
): { bar: number; beat: number } {
  const per = beatsPerBar(ts);
  const bar = Math.floor(beat / per);
  const within = beat - bar * per;
  return { bar, beat: within };
}

/**
 * A "Bar.Beat" readout, 1-indexed like a real DAW (bar 1, beat 1 is the start).
 * e.g. beat 5 in 4/4 -> "2.1".
 */
export function formatPosition(beat: number, ts: TimeSignature): string {
  const { bar, beat: within } = beatToBarAndBeat(beat, ts);
  return `${bar + 1}.${Math.floor(within) + 1}`;
}

/** The named snap resolutions, expressed as a fraction of a beat. */
export const SNAP_DIVISIONS = {
  bar: 'bar',
  beat: 1,
  half: 1 / 2,
  quarter: 1 / 4,
  eighth: 1 / 8,
  sixteenth: 1 / 16,
  off: 'off',
} as const;

export type SnapId = keyof typeof SNAP_DIVISIONS;

/** How many beats one snap step spans (bar depends on the time signature). */
export function snapStepInBeats(snap: SnapId, ts: TimeSignature): number {
  const value = SNAP_DIVISIONS[snap];
  if (value === 'bar') return beatsPerBar(ts);
  if (value === 'off') return 0;
  return value;
}

/** Snap a beat position to the current grid. `off` returns it unchanged. */
export function snapBeat(beat: number, snap: SnapId, ts: TimeSignature): number {
  const step = snapStepInBeats(snap, ts);
  if (step <= 0) return Math.max(0, beat);
  return Math.max(0, Math.round(beat / step) * step);
}

/**
 * Every beat at which `base` falls inside the window `(lo, hi]`, repeating every
 * `period` beats (`Infinity` = plays once, no repeat).
 *
 * This is the scheduler's core question, asked ~40 times a second: "of the notes
 * in this song, which ones land in the slice of time I'm about to hand to Web
 * Audio?" The window is open at the bottom and closed at the top so that
 * consecutive windows — (a, b], (b, c] — cover the timeline exactly once, and no
 * note is ever scheduled twice. The caller is responsible for starting its very
 * first window just below the beat it starts from, or a note sitting exactly
 * there is missed.
 */
export function beatOccurrencesInWindow(
  lo: number,
  hi: number,
  base: number,
  period: number,
): number[] {
  const out: number[] = [];
  if (period === Infinity) {
    if (base > lo && base <= hi) out.push(base);
    return out;
  }
  if (period <= 0) return out;
  const first = Math.max(0, Math.ceil((lo - base) / period));
  for (let k = first; ; k++) {
    const beat = base + k * period;
    if (beat > hi) break;
    if (beat > lo) out.push(beat);
  }
  return out;
}
