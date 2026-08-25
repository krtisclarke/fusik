import { describe, it, expect } from 'vitest';
import { encodeMp3 } from './mp3';

const SR = 44100;

/** One second of a stereo A440 sine at a healthy level. */
function sine(seconds = 1): Float32Array[] {
  const n = Math.round(SR * seconds);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = 0.6 * Math.sin((2 * Math.PI * 440 * i) / SR);
    right[i] = 0.6 * Math.sin((2 * Math.PI * 440 * i) / SR + 0.5);
  }
  return [left, right];
}

describe('encodeMp3', () => {
  it('produces MPEG frames, starting with a frame sync', () => {
    const bytes = encodeMp3(sine(), SR);
    // Every MPEG audio frame opens with eleven set bits.
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1] & 0xe0).toBe(0xe0);
  });

  it('comes out around the asked-for bitrate, not the WAV size', () => {
    const seconds = 2;
    const bytes = encodeMp3(sine(seconds), SR, 192);
    const expected = (192_000 / 8) * seconds; // bytes at a constant 192 kbps
    expect(bytes.length).toBeGreaterThan(expected * 0.8);
    expect(bytes.length).toBeLessThan(expected * 1.2);
    // And roughly a tenth of what the same audio costs uncompressed.
    const wavSize = seconds * SR * 2 * 2;
    expect(bytes.length).toBeLessThan(wavSize / 5);
  });

  it('survives a mono input and overshooting samples', () => {
    // Decoded AAC comes back above ±1 (measured 1.0236 in the mic path), so
    // the clamp is not hypothetical.
    const n = SR / 2;
    const loud = new Float32Array(n);
    for (let i = 0; i < n; i++) loud[i] = 1.2 * Math.sin((2 * Math.PI * 220 * i) / SR);
    const bytes = encodeMp3([loud], SR);
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes[0]).toBe(0xff);
  });

  it('encodes nothing gracefully', () => {
    const bytes = encodeMp3([new Float32Array(0)], SR);
    // A flush alone may or may not emit a header frame; it must simply not throw.
    expect(bytes.length).toBeGreaterThanOrEqual(0);
  });
});
