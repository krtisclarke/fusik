import { describe, it, expect } from 'vitest';
import {
  secondsPerBeat,
  beatsToSeconds,
  secondsToBeats,
  barsToBeats,
  totalBeats,
  formatPosition,
  snapBeat,
  snapStepInBeats,
  beatOccurrencesInWindow,
} from './time';
import type { TimeSignature } from './types';

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4 };

describe('tempo conversions', () => {
  it('converts beats and seconds at 120 BPM', () => {
    expect(secondsPerBeat(120)).toBe(0.5);
    expect(beatsToSeconds(4, 120)).toBe(2);
    expect(secondsToBeats(2, 120)).toBe(4);
  });

  it('round-trips through beats and seconds', () => {
    expect(secondsToBeats(beatsToSeconds(3.5, 137), 137)).toBeCloseTo(3.5, 9);
  });
});

describe('bars and beats', () => {
  it('counts beats in bars', () => {
    expect(barsToBeats(2, FOUR_FOUR)).toBe(8);
    expect(totalBeats(4, FOUR_FOUR)).toBe(16);
  });

  it('formats a 1-indexed bar.beat readout', () => {
    expect(formatPosition(0, FOUR_FOUR)).toBe('1.1');
    expect(formatPosition(4, FOUR_FOUR)).toBe('2.1');
    expect(formatPosition(5, FOUR_FOUR)).toBe('2.2');
    expect(formatPosition(2.9, FOUR_FOUR)).toBe('1.3');
  });
});

describe('snapping', () => {
  it('resolves snap steps in beats', () => {
    expect(snapStepInBeats('bar', FOUR_FOUR)).toBe(4);
    expect(snapStepInBeats('beat', FOUR_FOUR)).toBe(1);
    expect(snapStepInBeats('sixteenth', FOUR_FOUR)).toBe(0.0625);
    expect(snapStepInBeats('off', FOUR_FOUR)).toBe(0);
  });

  it('snaps to the nearest grid line', () => {
    expect(snapBeat(1.4, 'beat', FOUR_FOUR)).toBe(1);
    expect(snapBeat(1.6, 'beat', FOUR_FOUR)).toBe(2);
    expect(snapBeat(6, 'bar', FOUR_FOUR)).toBe(8);
    expect(snapBeat(1, 'bar', FOUR_FOUR)).toBe(0);
  });

  it('leaves the position untouched when snapping is off', () => {
    expect(snapBeat(3.7, 'off', FOUR_FOUR)).toBe(3.7);
  });

  it('never returns a negative beat', () => {
    expect(snapBeat(-5, 'beat', FOUR_FOUR)).toBe(0);
  });
});

describe('scheduling windows', () => {
  it('covers consecutive windows exactly once — no note played twice', () => {
    // Windows (0,4], (4,8] over a note on beat 4 of an 8-beat loop.
    expect(beatOccurrencesInWindow(0, 4, 4, 8)).toEqual([4]);
    expect(beatOccurrencesInWindow(4, 8, 4, 8)).toEqual([]);
  });

  it('repeats a note every loop', () => {
    expect(beatOccurrencesInWindow(-0.001, 40, 2, 8)).toEqual([2, 10, 18, 26, 34]);
  });

  it('plays a one-shot (no loop) exactly once', () => {
    expect(beatOccurrencesInWindow(-0.001, 4, 0, Infinity)).toEqual([0]);
    expect(beatOccurrencesInWindow(4, 100, 0, Infinity)).toEqual([]);
  });

  it('finds the downbeat when the window opens just below it', () => {
    // The bug this guards: pressing Play starts at beat 0, and a window of
    // exactly (0, hi] skips a note sitting on beat 0 — the whole song's
    // downbeat, silent on the first pass (forever, with looping off).
    expect(beatOccurrencesInWindow(0, 0.08, 0, 16)).toEqual([]); // why the caller nudges lo
    expect(beatOccurrencesInWindow(-1e-6, 0.08, 0, 16)).toEqual([0]);
    expect(beatOccurrencesInWindow(-1e-6, 0.08, 0, Infinity)).toEqual([0]);
  });

  it('never schedules a note before the song starts', () => {
    expect(beatOccurrencesInWindow(-4, -1, 2, 8)).toEqual([]);
  });
});
