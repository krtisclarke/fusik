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
