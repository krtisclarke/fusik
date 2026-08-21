// Choosing which recording to play. Getting this wrong is quiet rather than
// loud: a hit still sounds, it just sounds like the wrong strength, or like the
// note next door, or exactly like the hit before it.

import { describe, it, expect } from 'vitest';
import { chooseRegion, drumEnvelope } from './sampler';
import type { SampleSet } from '../model/sampleSets';

const region = (root: number, lo: number, hi: number, rr = 1) => ({
  f: `${root}_${lo}_${rr}.m4a`,
  root,
  lo,
  hi,
  cents: 0,
  rr,
});

const set = (id: string, regions: ReturnType<typeof region>[]): SampleSet =>
  ({ id, seconds: 1, regions });

describe('chooseRegion', () => {
  it('picks by strength before it picks by note', () => {
    // The trap: a soft recording of the exact note asked for, and a hard
    // recording a tone away. A hard strike must take the hard recording — a
    // struck instrument changes tone with force, and playing the soft one
    // louder sounds like a soft hit turned up, because that is what it is.
    const s = set('piano', [
      region(60, 0, 0.5),
      region(62, 0.51, 1),
    ]);
    expect(chooseRegion(s, 60, 0.9)?.root).toBe(62);
    expect(chooseRegion(s, 60, 0.2)?.root).toBe(60);
  });

  it('picks the nearest note within the strength', () => {
    const s = set('piano', [
      region(48, 0, 1),
      region(60, 0, 1),
      region(72, 0, 1),
    ]);
    expect(chooseRegion(s, 62, 0.8)?.root).toBe(60);
    expect(chooseRegion(s, 70, 0.8)?.root).toBe(72);
    expect(chooseRegion(s, 20, 0.8)?.root).toBe(48);
    expect(chooseRegion(s, 120, 0.8)?.root).toBe(72);
  });

  it('alternates takes instead of repeating one', () => {
    // Two recordings of the same hit exist precisely so eight snares in a row
    // are not bit-for-bit identical. Choosing at random repeats about a third of
    // the time with three takes — which is the rattle they exist to avoid.
    const s = set('snare-alternating', [region(60, 0, 1, 1), region(60, 0, 1, 2)]);
    const heard = Array.from({ length: 6 }, () => chooseRegion(s, 60, 0.8)?.f);
    for (let i = 1; i < heard.length; i++) expect(heard[i]).not.toBe(heard[i - 1]);
    expect(new Set(heard).size).toBe(2);
  });

  it('still answers when no strength band fits', () => {
    // A map with a hole in it should never happen — the build refuses to write
    // one — but silence would be the worst possible way to find out.
    const s = set('gappy', [region(60, 0, 0.4), region(60, 0.8, 1)]);
    expect(chooseRegion(s, 60, 0.6)).toBeDefined();
  });

  it('has nothing to say about an empty set', () => {
    expect(chooseRegion(set('empty', []), 60, 0.8)).toBeUndefined();
  });

  it('keeps each note and strength on its own rotation', () => {
    // Takes rotate per note-and-strength, not per instrument: a melody moving
    // between notes must not leave one of them stuck on the same take.
    const s = set('two-notes', [
      region(60, 0, 1, 1), region(60, 0, 1, 2),
      region(72, 0, 1, 1), region(72, 0, 1, 2),
    ]);
    const low = [chooseRegion(s, 60, 0.8)?.f, chooseRegion(s, 72, 0.8)?.f, chooseRegion(s, 60, 0.8)?.f];
    expect(low[0]).not.toBe(low[2]);
  });
});

describe('drumEnvelope', () => {
  const grid = [0.001, 0.002, 0.05, 0.18, 0.3, 0.5, 0.77, 0.8, 1];

  it('always runs forwards, whatever the sliders are set to', () => {
    // Web Audio sorts automation by time. Any pair of these that comes out in
    // the wrong order pins the level at the envelope's floor for the whole note
    // and the drum makes no sound at all.
    for (const attack of grid) {
      for (const decay of [0.02, 0.18, 0.5, 0.77, 0.8, 1.2, 2, 4]) {
        const e = drumEnvelope(10, attack, decay);
        expect(e.holdFrom, `attack ${attack} decay ${decay}`).toBeGreaterThanOrEqual(10 + attack);
        expect(e.silentAt, `attack ${attack} decay ${decay}`).toBeGreaterThan(e.holdFrom);
        expect(e.stopAt, `attack ${attack} decay ${decay}`).toBeGreaterThan(e.silentAt);
      }
    }
  });

  it('lets a slow attack finish before it silences the drum', () => {
    // A Shaker's Decay is 0.18 and its Attack goes to 1.0. Fixing the end at
    // Decay meant the ramp to silence was scheduled before the ramp to full.
    const e = drumEnvelope(0, 0.5, 0.18);
    expect(e.silentAt).toBeGreaterThan(0.5);
    expect(e.stopAt).toBeGreaterThan(e.silentAt);
  });

  it('leaves a normal drum ringing for its decay', () => {
    const e = drumEnvelope(0, 0.002, 1.2);
    expect(e.silentAt).toBeCloseTo(1.2, 6);
    expect(e.holdFrom).toBeGreaterThan(1);
  });
});

describe('strength bands as generated', () => {
  it('cover every strength of every note, with nothing falling between', async () => {
    // The bands are integers turned into fractions. Dividing each edge by 127
    // left 1/127-wide holes between them, and a strike landing in one matched no
    // band of the note being played — only a band belonging to some *other*
    // note, which then got dragged into tune from up to two octaves away.
    const { SAMPLE_SETS } = await import('../model/sampleSets');
    for (const set of SAMPLE_SETS) {
      const roots = [...new Set(set.regions.map((r) => r.root))];
      for (const root of roots) {
        for (let v = 0; v <= 1.00001; v += 0.001) {
          const chosen = chooseRegion(set, root, Math.min(v, 1));
          expect(chosen, `${set.id} note ${root} at strength ${v.toFixed(3)}`).toBeDefined();
          expect(chosen!.root, `${set.id} note ${root} at strength ${v.toFixed(3)}`).toBe(root);
        }
      }
    }
  });

  it('tile exactly — one band\'s top edge is the next one\'s bottom', async () => {
    const { SAMPLE_SETS } = await import('../model/sampleSets');
    for (const set of SAMPLE_SETS) {
      const byRoot = new Map<number, { lo: number; hi: number }[]>();
      for (const r of set.regions) {
        if (!byRoot.has(r.root)) byRoot.set(r.root, []);
        byRoot.get(r.root)!.push(r);
      }
      for (const [root, regions] of byRoot) {
        const bands = [...new Map(regions.map((r) => [`${r.lo}-${r.hi}`, r])).values()]
          .sort((a, b) => a.lo - b.lo);
        expect(bands[0].lo, `${set.id} note ${root}`).toBe(0);
        expect(bands[bands.length - 1].hi, `${set.id} note ${root}`).toBe(1);
        for (let i = 1; i < bands.length; i++) {
          expect(bands[i].lo, `${set.id} note ${root} boundary ${i}`).toBe(bands[i - 1].hi);
        }
      }
    }
  });
});
