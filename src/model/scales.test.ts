import { describe, it, expect } from 'vitest';
import { midiToFreq, midiToName, midiToLetter, pitchLadder, SCALES } from './scales';

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
