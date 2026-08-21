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

/** Kid-facing names for the scales, in the order they're offered. */
export const SCALE_CHOICES: { id: string; label: string }[] = [
  { id: 'majorPentatonic', label: 'Happy' },
  { id: 'minorPentatonic', label: 'Sad' },
  { id: 'major', label: 'Happy — more notes' },
  { id: 'minor', label: 'Sad — more notes' },
];

/**
 * The same note of a tune, rewritten into another scale.
 *
 * This maps by **scale degree**, not by nearest pitch, and the difference is
 * the whole feature. Nearest-pitch looks reasonable and quietly destroys the
 * melody: going from C major pentatonic to minor, both D and E are nearest to
 * E flat, so "C D E G E D C" flattens to "C Eb Eb G Eb Eb C" — two different
 * notes fused into one, the tune's shape gone, and pressing Happy again cannot
 * bring it back because the information has been thrown away.
 *
 * By degree, the third note of the old scale becomes the third note of the new
 * one. Distinct notes stay distinct, the tune keeps its shape, and between two
 * scales of the same size — Happy and Sad, the two a child will actually swap
 * between — it is exactly reversible.
 *
 * Where the scales are different sizes the degree is scaled across, keeping the
 * octave and the order. Going to a bigger scale loses nothing; going to a
 * smaller one can land two notes together, which is unavoidable when there are
 * fewer notes to land on.
 */
export function mapPitchBetweenScales(
  pitch: number,
  scaleRoot: number,
  fromScaleId: string,
  toScaleId: string,
): number {
  const from = SCALES[fromScaleId] ?? SCALES[DEFAULT_SCALE_ID];
  const to = SCALES[toScaleId] ?? SCALES[DEFAULT_SCALE_ID];
  const root = ((scaleRoot % 12) + 12) % 12;

  const relative = pitch - root;
  let octave = Math.floor(relative / 12);
  const semitones = relative - octave * 12; // 0..11

  // Already a note of the scale we're moving to: leave it exactly where it is.
  // The five-note scales are subsets of the seven-note ones, so this alone makes
  // "more notes" and back completely lossless — only the notes that genuinely
  // don't exist in the new scale have to move at all.
  if (to.includes(semitones)) return pitch;

  // Which note of the old scale this is. A pitch that isn't exactly on one —
  // from a hand-edited file, or an earlier squeeze into a smaller scale — takes
  // the closest.
  let degree = 0;
  let closest = Infinity;
  from.forEach((offset, i) => {
    const distance = Math.abs(offset - semitones);
    if (distance < closest) {
      closest = distance;
      degree = i;
    }
  });
  // Nearer to the root above than to anything in this octave: it belongs to the
  // next one up, and calling it the top note of this one would drag it down.
  if (12 - semitones < closest) {
    octave += 1;
    degree = 0;
  }

  const mappedDegree =
    from.length === to.length
      ? degree
      : Math.min(to.length - 1, Math.round((degree * to.length) / from.length));

  const mapped = root + octave * 12 + to[mappedDegree];
  return Math.max(0, Math.min(127, mapped));
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
