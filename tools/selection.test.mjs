// Every case here is a mistake that actually happened while building the
// sampled instruments, and every one of them was silent: the app kept running
// and one drum just stopped sounding, or sounded wrong on some hits and not
// others.

import { describe, it, expect } from 'vitest';
import { velocityBand, thinLayers, validate, normalise, dropSparseRoots, DRUM_ROOT } from './selection.mjs';

const region = (over = {}) => ({
  repoPath: over.repoPath ?? `x/${over.loVel ?? 0}_${over.seq ?? 1}.wav`,
  root: over.root ?? DRUM_ROOT,
  loVel: over.loVel ?? 0,
  hiVel: over.hiVel ?? 127,
  cents: 0,
  volumeDb: 0,
  seq: over.seq ?? 1,
  ...over,
});

describe('velocityBand', () => {
  it('reads a plain strength range', () => {
    expect(velocityBand({ lovel: '55', hivel: '83' })).toEqual([55, 83]);
  });

  it('turns a crossfade into a hard boundary at its midpoint', () => {
    // The glockenspiel names only where each fade starts and ends. Read as
    // "no range given", all three of its recordings claim the whole range and
    // every note plays three at once.
    const soft = velocityBand({ xfout_lovel: '0', xfout_hivel: '83' });
    const mid = velocityBand({ xfin_lovel: '0', xfin_hivel: '83', xfout_lovel: '84', xfout_hivel: '127' });
    const loud = velocityBand({ xfin_lovel: '84', xfin_hivel: '127' });
    expect(soft[0]).toBe(0);
    expect(loud[1]).toBe(127);
    expect(soft[1]).toBeLessThan(mid[1]);
    expect(mid[0]).toBeLessThan(loud[0]);
  });

  it('defaults to the whole range when nothing is said', () => {
    expect(velocityBand({})).toEqual([0, 127]);
  });
});

describe('thinLayers', () => {
  it('leaves no strength without a recording after thinning', () => {
    // Four recorded strengths, keep three. Keeping their original ranges
    // leaves a hole, and a hit landing in it finds nothing to play.
    const rows = [
      region({ loVel: 0, hiVel: 54 }),
      region({ loVel: 55, hiVel: 83 }),
      region({ loVel: 84, hiVel: 106 }),
      region({ loVel: 107, hiVel: 127 }),
    ];
    const kept = thinLayers(rows, 3);
    expect(kept).toHaveLength(3);
    const bands = kept.map((r) => [r.bandLo, r.bandHi]).sort((a, b) => a[0] - b[0]);
    expect(bands[0][0]).toBe(0);
    expect(bands[bands.length - 1][1]).toBe(127);
    for (let i = 1; i < bands.length; i++) expect(bands[i][0]).toBe(bands[i - 1][1] + 1);
  });

  it('never runs a band backwards when two recordings start at the same strength', () => {
    // The claps: six group claps with no strength given at all, alongside four
    // solo claps with strengths. Sorted together, this produced a band running
    // from 128 down to 54 — a range nothing can ever fall in.
    const rows = [
      region({ loVel: 0, hiVel: 127, repoPath: 'a.wav' }),
      region({ loVel: 0, hiVel: 54, repoPath: 'b.wav' }),
      region({ loVel: 55, hiVel: 127, repoPath: 'c.wav' }),
    ];
    for (const r of thinLayers(rows, Infinity)) {
      expect(r.bandHi).toBeGreaterThanOrEqual(r.bandLo);
      expect(r.bandLo).toBeGreaterThanOrEqual(0);
      expect(r.bandHi).toBeLessThanOrEqual(127);
    }
  });

  it('numbers takes so two techniques cannot claim the same file', () => {
    // Takes are numbered per technique in the library, so merging two of them
    // into one voice yields two takes both called 1 — and the second overwrites
    // the first on disk.
    const rows = [
      region({ seq: 1, repoPath: 'down_rr1.wav' }),
      region({ seq: 2, repoPath: 'down_rr2.wav' }),
      region({ seq: 1, repoPath: 'up_rr1.wav' }),
      region({ seq: 2, repoPath: 'up_rr2.wav' }),
    ];
    const takes = thinLayers(rows, Infinity).map((r) => r.take).sort();
    expect(takes).toEqual([1, 2, 3, 4]);
  });
});

describe('validate', () => {
  it('refuses a map with a strength nothing covers', () => {
    const rows = [
      { root: 60, bandLo: 0, bandHi: 54, take: 1 },
      { root: 60, bandLo: 84, bandHi: 127, take: 1 },
    ];
    expect(() => validate('snare', rows)).toThrow(/no recording for strength 55/);
  });

  it('refuses a map that stops short of the hardest hit', () => {
    expect(() => validate('snare', [{ root: 60, bandLo: 0, bandHi: 100, take: 1 }]))
      .toThrow(/only up to strength 100/);
  });

  it('refuses two recordings that would be written as the same file', () => {
    const rows = [
      { root: 60, bandLo: 0, bandHi: 127, take: 1 },
      { root: 60, bandLo: 0, bandHi: 127, take: 1 },
    ];
    expect(() => validate('shaker', rows)).toThrow(/both be written as/);
  });

  it('accepts a map that tiles the whole range', () => {
    const rows = [
      { root: 60, bandLo: 0, bandHi: 63, take: 1 },
      { root: 60, bandLo: 0, bandHi: 63, take: 2 },
      { root: 60, bandLo: 64, bandHi: 127, take: 1 },
    ];
    expect(() => validate('hihat', rows)).not.toThrow();
  });
});

describe('dropSparseRoots', () => {
  it('drops a note the library captured at only one strength', () => {
    // B4 on the Kawai is the only loud-only note on the keyboard. Kept, it
    // plays at that one volume however gently the child hits it, so a tune
    // jumps in loudness on that note alone.
    const rows = [
      region({ root: 82, loVel: 0, hiVel: 63 }),
      region({ root: 82, loVel: 64, hiVel: 127 }),
      region({ root: 83, loVel: 0, hiVel: 127 }),
      region({ root: 84, loVel: 0, hiVel: 63 }),
      region({ root: 84, loVel: 64, hiVel: 127 }),
    ];
    expect([...new Set(dropSparseRoots(rows, 2).map((r) => r.root))]).toEqual([82, 84]);
  });

  it('would rather keep a sparse note than empty the instrument', () => {
    const rows = [region({ root: 60, loVel: 0, hiVel: 127 })];
    expect(dropSparseRoots(rows, 2)).toHaveLength(1);
  });
});

describe('normalise', () => {
  it('files every drum recording under one note, whatever key the library used', () => {
    // A hi-hat's closed, loose, open and pedal hits sit on four different keys
    // in the library. This app has one hi-hat voice, so the key means nothing —
    // and left alone, the engine would look for the nearest "note" among them.
    const set = { sfz: 'X/Hats.sfz', pick: () => true };
    const rows = normalise(set, [
      { sample: 'Hats/close.wav', pitch_keycenter: '42', lovel: '0', hivel: '63' },
      { sample: 'Hats/open.wav', pitch_keycenter: '46', lovel: '64', hivel: '127' },
    ]);
    expect(rows.every((r) => r.root === DRUM_ROOT)).toBe(true);
  });
});
