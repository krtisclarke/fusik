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
