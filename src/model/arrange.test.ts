import { describe, it, expect } from 'vitest';
import { resolveArrangement, songBeats, songPositionAt } from './arrange';
import { addSection, createDefaultProject, repeatSection, setSectionLength } from './project';

/** A A B song in 4/4: A is 4 bars (16 beats), B is 2 bars (8 beats). */
function aabSong() {
  let p = createDefaultProject(); // A (4 bars)
  p = repeatSection(p, p.sections[0].id); // A A
  p = addSection(p); // A A B
  p = setSectionLength(p, p.sections[1].id, 2);
  return p;
}

describe('resolving the arrangement', () => {
  it('lays the slots end to end in beats', () => {
    const entries = resolveArrangement(aabSong());
    expect(entries.map((e) => e.startBeat)).toEqual([0, 16, 32]);
    expect(entries.map((e) => e.lengthBeats)).toEqual([16, 16, 8]);
  });

  it('totals the whole song', () => {
    expect(songBeats(aabSong())).toBe(40);
  });
});

describe('locating a song position', () => {
  it('maps an absolute beat to its slot and beat-within-part', () => {
    const p = aabSong();
    expect(songPositionAt(p, 0)).toMatchObject({ entryIndex: 0, beatInSection: 0 });
    expect(songPositionAt(p, 17)).toMatchObject({ entryIndex: 1, beatInSection: 1 });
    expect(songPositionAt(p, 39.5)).toMatchObject({ entryIndex: 2, beatInSection: 7.5 });
  });

  it('returns null past the end of the song', () => {
    expect(songPositionAt(aabSong(), 40)).toBeNull();
    expect(songPositionAt(aabSong(), 1000)).toBeNull();
  });
});
