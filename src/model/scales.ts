// Musical scales and pitch helpers. Pure functions, no audio.
//
// The kid-friendly idea: a melodic instrument doesn't offer all 12 chromatic
// notes — it offers only the notes of a chosen scale. Place notes however you
// like and they sound good together, because "wrong" notes aren't on the menu.
// Major pentatonic (five notes, no semitone clashes) is the default for exactly
// this reason: it's very hard to make it sound bad.

/** Semitone offsets from the root for each scale. */
export const SCALES: Record<string, number[]> = {
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

export const DEFAULT_SCALE_ID = 'majorPentatonic';
export const DEFAULT_SCALE_ROOT = 0; // C

const NOTE_LETTERS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** MIDI note -> frequency in Hz (A4 = 69 = 440 Hz). */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** MIDI note -> name with octave, e.g. 60 -> "C4". */
export function midiToName(midi: number): string {
  const letter = NOTE_LETTERS[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${letter}${octave}`;
}

/** Just the letter, e.g. 60 -> "C". Handy for compact grid labels. */
export function midiToLetter(midi: number): string {
  return NOTE_LETTERS[((midi % 12) + 12) % 12];
}

/**
 * The ladder of pitches an instrument offers: every note of the scale from a
 * starting octave upward, spanning `octaves` octaves, plus the closing root on
 * top. Returned ascending (lowest first).
 */
export function pitchLadder(
  baseMidi: number,
  octaves: number,
  scaleRoot: number,
  scaleId: string,
): number[] {
  const offsets = SCALES[scaleId] ?? SCALES[DEFAULT_SCALE_ID];
  // Anchor the ladder to the scale root within the instrument's base octave.
  const startOctave = Math.floor(baseMidi / 12) * 12;
  const start = startOctave + (((scaleRoot % 12) + 12) % 12);
  const pitches: number[] = [];
  for (let o = 0; o < octaves; o++) {
    for (const off of offsets) pitches.push(start + o * 12 + off);
  }
  pitches.push(start + octaves * 12); // close on the top root
  return pitches;
}
