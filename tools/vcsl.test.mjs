// The check that a sample library's map is telling the truth about pitch.
//
// This exists because VCSL's glockenspiel is filed an octave below where it
// actually rings. Both cases below are real: the piano, whose second harmonic
// is louder than its fundamental and which must NOT be moved, and the struck
// bar, which has one partial and no fundamental where its map says.

import { describe, it, expect } from 'vitest';
import { verifyKeyCentre, parseSfz, decodeWav, encodeFloatWav } from './vcsl.mjs';

const SR = 44100;
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

/** A tone built from named partials, each a multiple of `fundamental`. */
function tone(fundamental, partials, seconds = 1.5) {
  const n = Math.round(SR * seconds);
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v = 0;
    for (const [mult, amp] of partials) v += amp * Math.sin(2 * Math.PI * fundamental * mult * t);
    ch[i] = v * 0.3 * Math.exp(-t * 0.5);
  }
  return [ch, ch.slice()];
}

describe('verifyKeyCentre', () => {
  it('leaves a correct map alone', () => {
    const r = verifyKeyCentre(tone(hz(60), [[1, 1], [2, 0.6], [3, 0.4]]), SR, 60);
    expect(r.ok).toBe(true);
    expect(r.octaveShift).toBe(0);
  });

  it('does not "correct" a note whose second harmonic is the loudest thing in it', () => {
    // A piano routinely looks like this. Choosing the loudest partial puts it an
    // octave high — every note in the instrument, on a map that was right.
    const r = verifyKeyCentre(tone(hz(60), [[1, 0.3], [2, 1.0], [3, 0.5], [4, 0.4]]), SR, 60);
    expect(r.ok).toBe(true);
    expect(r.octaveShift).toBe(0);
  });

  it('finds a map filed an octave low', () => {
    // A struck bar: one partial, nothing at all where the map says the note is.
    const r = verifyKeyCentre(tone(hz(84), [[1, 1]]), SR, 72);
    expect(r.ok).toBe(true);
    expect(r.octaveShift).toBe(1);
    expect(r.midi).toBeCloseTo(84, 0);
  });

  it('finds a map filed an octave high', () => {
    const r = verifyKeyCentre(tone(hz(60), [[1, 1], [2, 0.6]]), SR, 72);
    expect(r.ok).toBe(true);
    expect(r.octaveShift).toBe(-1);
  });

  it('reports the exact pitch, so an out-of-tune recording can be corrected', () => {
    const r = verifyKeyCentre(tone(hz(72) * 2 ** (0.3 / 12), [[1, 1]]), SR, 72);
    expect(r.ok).toBe(true);
    expect(r.midi - 72).toBeCloseTo(0.3, 1);
  });

  it('refuses to guess when the recording is nowhere near the map', () => {
    const r = verifyKeyCentre(tone(hz(48), [[1, 1]]), SR, 96);
    expect(r.ok).toBe(false);
  });

  it('refuses to guess at an unpitched recording', () => {
    const n = SR;
    const noise = new Float32Array(n);
    for (let i = 0; i < n; i++) noise[i] = (Math.random() * 2 - 1) * 0.3 * Math.exp(-i / SR * 8);
    expect(verifyKeyCentre([noise, noise.slice()], SR, 60).ok).toBe(false);
  });
});

describe('parseSfz', () => {
  it('inherits group settings into each region', () => {
    const rows = parseSfz('<group>\nampeg_release=0.4\n\n<region>\nsample=a.wav\npitch_keycenter=60\n');
    expect(rows).toHaveLength(1);
    expect(rows[0].ampeg_release).toBe('0.4');
    expect(rows[0].pitch_keycenter).toBe('60');
  });

  it('skips a region that has been commented out', () => {
    // VCSL's generated files comment out whole regions. Read as real, such a
    // region inherits the group, names no sample, and looks like a recording
    // that is simply missing from disk.
    const rows = parseSfz(
      '<group>\ntrigger=attack\n\n<region>\nsample=a.wav\npitch_keycenter=60\n\n' +
      '<region>\n//sample=b.wav\n//pitch_keycenter=61\n',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].sample).toBe('a.wav');
  });
});

describe('decodeWav / encodeFloatWav', () => {
  it('round-trips samples exactly', () => {
    const left = Float32Array.from([0, 0.5, -0.5, 0.25]);
    const right = Float32Array.from([1, -1, 0.125, 0]);
    const wav = encodeFloatWav([left, right], SR);
    const back = decodeWav(wav);
    expect(back.sampleRate).toBe(SR);
    expect(back.channels).toHaveLength(2);
    expect([...back.channels[0]]).toEqual([...left]);
    expect([...back.channels[1]]).toEqual([...right]);
  });

  it('reads the 24-bit recordings the library ships', () => {
    // Half the piano arrives as 24-bit. Read as 16-bit it is noise.
    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(36 + 6, 4);
    header.write('WAVE', 8, 'ascii');
    header.write('fmt ', 12, 'ascii');
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(SR, 24);
    header.writeUInt32LE(SR * 3, 28);
    header.writeUInt16LE(3, 32);
    header.writeUInt16LE(24, 34);
    header.write('data', 36, 'ascii');
    header.writeUInt32LE(6, 40);
    const body = Buffer.from([0x00, 0x00, 0x40, 0x00, 0x00, 0xc0]); // +0.5, -0.5
    const back = decodeWav(Buffer.concat([header, body]));
    expect(back.channels[0][0]).toBeCloseTo(0.5, 4);
    expect(back.channels[0][1]).toBeCloseTo(-0.5, 4);
  });
});
