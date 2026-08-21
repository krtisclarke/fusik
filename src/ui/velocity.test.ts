import { describe, it, expect } from 'vitest';
import {
  strikeVelocity,
  MIN_STRIKE_VELOCITY,
  MAX_STRIKE_VELOCITY,
  TYPED_VELOCITY,
} from './velocity';

describe('how hard a key was hit', () => {
  it('is gentle at the far end of the key and hard at the near edge', () => {
    expect(strikeVelocity(0, 100)).toBeCloseTo(MIN_STRIKE_VELOCITY);
    expect(strikeVelocity(100, 100)).toBeCloseTo(MAX_STRIKE_VELOCITY);
    expect(strikeVelocity(50, 100)).toBeGreaterThan(strikeVelocity(20, 100));
    expect(strikeVelocity(80, 100)).toBeGreaterThan(strikeVelocity(50, 100));
  });

  it('never goes silent, and never goes past full', () => {
    // A pointer can land slightly outside the element it fired on.
    for (const y of [-40, -1, 0, 50, 100, 140, 5000]) {
      const v = strikeVelocity(y, 100);
      expect(v).toBeGreaterThanOrEqual(MIN_STRIKE_VELOCITY);
      expect(v).toBeLessThanOrEqual(MAX_STRIKE_VELOCITY);
    }
  });

  it('falls back to a normal hit when there is nothing to measure', () => {
    // Mid-layout the key can have no height yet; a note must still sound.
    expect(strikeVelocity(10, 0)).toBe(TYPED_VELOCITY);
    expect(strikeVelocity(10, -5)).toBe(TYPED_VELOCITY);
    expect(strikeVelocity(NaN, 100)).toBe(TYPED_VELOCITY);
    expect(strikeVelocity(10, NaN)).toBe(TYPED_VELOCITY);
  });

  it('stays inside what the engine and the limiter expect', () => {
    expect(MAX_STRIKE_VELOCITY).toBeLessThanOrEqual(1);
    expect(MIN_STRIKE_VELOCITY).toBeGreaterThan(0);
  });
});
