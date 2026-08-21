import { describe, it, expect } from 'vitest';
import {
  midiToFreq,
  midiToName,
  midiToLetter,
  mapPitchBetweenScales,
  pitchLadder,
  SCALES,
} from './scales';

describe('pitch helpers', () => {
  it('converts MIDI to frequency (A4 = 440)', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(60)).toBeCloseTo(261.626, 2);
    expect(midiToFreq(81)).toBeCloseTo(880, 3);
  });

  it('names notes', () => {
    expect(midiToName(60)).toBe('C4');
    expect(midiToName(69)).toBe('A4');
    expect(midiToLetter(62)).toBe('D');
  });
});

describe('pitch ladder', () => {
  it('builds C major pentatonic over two octaves', () => {
    expect(pitchLadder(60, 2, 0, 'majorPentatonic')).toEqual([
      60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84,
    ]);
  });

  it('has one entry per scale note per octave, plus the closing root', () => {
    const ladder = pitchLadder(60, 2, 0, 'majorPentatonic');
    expect(ladder).toHaveLength(2 * SCALES.majorPentatonic.length + 1);
    expect(ladder[0]).toBe(60);
    expect(ladder[ladder.length - 1]).toBe(84); // two octaves up
  });

  it('anchors to the chosen root', () => {
    const ladder = pitchLadder(60, 1, 2, 'majorPentatonic'); // root D
    expect(ladder[0]).toBe(62);
  });

  it('places the bass an octave range lower', () => {
    expect(pitchLadder(36, 2, 0, 'majorPentatonic')[0]).toBe(36);
  });
});

describe('rewriting a tune into another scale', () => {
  const degreesOf = (scaleId: string) => SCALES[scaleId];
  const map = (pitch: number, from: string, to: string) =>
    mapPitchBetweenScales(pitch, 0, from, to);

  it('turns each note into the same note of the new scale', () => {
    // C major pentatonic C D E G A -> C minor pentatonic C Eb F G Bb.
    expect(map(72, 'majorPentatonic', 'minorPentatonic')).toBe(72); // C  -> C
    expect(map(74, 'majorPentatonic', 'minorPentatonic')).toBe(75); // D  -> Eb
    expect(map(76, 'majorPentatonic', 'minorPentatonic')).toBe(77); // E  -> F
    expect(map(79, 'majorPentatonic', 'minorPentatonic')).toBe(79); // G  -> G
    expect(map(81, 'majorPentatonic', 'minorPentatonic')).toBe(82); // A  -> Bb
  });

  // The bug this replaced. Mapping to the nearest pitch sent both D and E to
  // Eb, so "C D E G E D C" came out as "C Eb Eb G Eb Eb C" — the tune's shape
  // gone, and unrecoverable, because two notes had become one.
  it('never fuses two different notes into one', () => {
    const tune = [72, 74, 76, 79, 81];
    const moved = tune.map((p) => map(p, 'majorPentatonic', 'minorPentatonic'));
    expect(new Set(moved).size).toBe(tune.length);
    // and it still runs in the same direction, note for note
    for (let i = 1; i < moved.length; i++) expect(moved[i]).toBeGreaterThan(moved[i - 1]);
  });

  it('comes back exactly when the child changes their mind', () => {
    for (const [a, b] of [
      ['majorPentatonic', 'minorPentatonic'],
      ['major', 'minor'],
    ]) {
      for (const pitch of [60, 62, 64, 67, 69, 72, 74, 76, 79, 84]) {
        const there = map(pitch, a, b);
        expect(map(there, b, a), `${pitch} via ${a}->${b}->${a}`).toBe(pitch);
      }
    }
  });

  it('leaves a note completely alone when the new scale already has it', () => {
    // The five-note scales sit inside the seven-note ones, so adding notes to
    // choose from never disturbs the tune already written.
    for (const pitch of [72, 74, 76, 79, 81]) {
      expect(map(pitch, 'majorPentatonic', 'major')).toBe(pitch);
      expect(map(map(pitch, 'majorPentatonic', 'major'), 'major', 'majorPentatonic')).toBe(pitch);
    }
    for (const pitch of [72, 75, 77, 79, 82]) {
      expect(map(pitch, 'minorPentatonic', 'minor')).toBe(pitch);
      expect(map(map(pitch, 'minorPentatonic', 'minor'), 'minor', 'minorPentatonic')).toBe(pitch);
    }
  });

  it('always lands on a real note of the scale it moved to', () => {
    for (const from of Object.keys(SCALES)) {
      for (const to of Object.keys(SCALES)) {
        for (let pitch = 24; pitch <= 100; pitch++) {
          const mapped = map(pitch, from, to);
          const degree = ((mapped % 12) + 12) % 12;
          expect(degreesOf(to), `${pitch} ${from}->${to} gave ${mapped}`).toContain(degree);
        }
      }
    }
  });

  it('keeps a note roughly where it was, so a tune stays in its own register', () => {
    for (const from of Object.keys(SCALES)) {
      for (const to of Object.keys(SCALES)) {
        for (let pitch = 24; pitch <= 100; pitch++) {
          expect(Math.abs(map(pitch, from, to) - pitch)).toBeLessThanOrEqual(4);
        }
      }
    }
  });

  it('stays inside the range of real notes', () => {
    for (const to of Object.keys(SCALES)) {
      expect(map(0, 'majorPentatonic', to)).toBeGreaterThanOrEqual(0);
      expect(map(127, 'majorPentatonic', to)).toBeLessThanOrEqual(127);
    }
  });
});
