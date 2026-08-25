// The .mid parser, fed hand-assembled bytes. Building files byte-by-byte here
// is deliberate: each test documents exactly which corner of the format it
// guards — running status, velocity-0 note-offs, unknown chunks — the corners
// real exporters use and naive parsers miss. A translation test against a
// real-world file belongs alongside these the moment one is captured; these
// prove the format mechanics, not the wild.

import { describe, expect, it } from 'vitest';
import { MidiFileError, parseMidi } from './midi';

// ---- byte assembly --------------------------------------------------------

function vlq(value: number): number[] {
  const out = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    out.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return out;
}

const u16 = (v: number) => [(v >> 8) & 0xff, v & 0xff];
const u32 = (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
const cc = (s: string) => [...s].map((ch) => ch.charCodeAt(0));

/** One track chunk from [delta, ...eventBytes] rows. */
function track(events: number[][]): number[] {
  const body = events.flatMap(([delta, ...bytes]) => [...vlq(delta), ...bytes]);
  body.push(...vlq(0), 0xff, 0x2f, 0x00); // end of track
  return [...cc('MTrk'), ...u32(body.length), ...body];
}

function file(tracks: number[][][], opts: { format?: number; division?: number } = {}): Uint8Array {
  const { format = 1, division = 480 } = opts;
  return new Uint8Array([
    ...cc('MThd'),
    ...u32(6),
    ...u16(format),
    ...u16(tracks.length),
    ...u16(division),
    ...tracks.flatMap(track),
  ]);
}

const TEMPO_120 = [0, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]; // 500000 µs per quarter
const TIMESIG_4_4 = [0, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08];

// ---- tests ----------------------------------------------------------------

describe('parseMidi', () => {
  it('reads notes, tempo, time signature and instrument numbers', () => {
    const parsed = parseMidi(
      file([
        [TEMPO_120, TIMESIG_4_4],
        [
          [0, 0xc0, 0x18], // program 24 on channel 0
          [0, 0x90, 60, 100],
          [480, 0x80, 60, 0],
          [0, 0x90, 64, 80],
          [240, 0x80, 64, 0],
        ],
      ]),
    );
    expect(parsed.quarterBpm).toBeCloseTo(120);
    expect(parsed.timeSignature).toEqual({ numerator: 4, denominator: 4 });
    expect(parsed.ticksPerQuarter).toBe(480);
    expect(parsed.notes).toHaveLength(2);
    expect(parsed.notes[0]).toMatchObject({ pitch: 60, velocity: 100, startTick: 0, lengthTicks: 480, program: 24 });
    expect(parsed.notes[1]).toMatchObject({ pitch: 64, startTick: 480, lengthTicks: 240 });
  });

  it('understands running status and velocity-0 note-offs', () => {
    // One status byte (0x90), then every later event borrows it — including
    // the note-offs, written as note-ons at velocity 0. This is how nearly
    // every real exporter writes files.
    const parsed = parseMidi(
      file([
        [
          [0, 0x90, 60, 100],
          [120, 62, 90], // running status: note-on 62
          [120, 60, 0], //                  note-off 60
          [120, 62, 0], //                  note-off 62
        ],
      ]),
    );
    expect(parsed.notes).toHaveLength(2);
    expect(parsed.notes[0]).toMatchObject({ pitch: 60, startTick: 0, lengthTicks: 240 });
    expect(parsed.notes[1]).toMatchObject({ pitch: 62, startTick: 120, lengthTicks: 240 });
  });

  it('keeps percussion channel notes with their channel', () => {
    const parsed = parseMidi(file([[[0, 0x99, 36, 100], [120, 0x89, 36, 0]]]));
    expect(parsed.notes[0]).toMatchObject({ channel: 9, pitch: 36 });
  });

  it('attaches the program in force when the note starts, across tracks', () => {
    // Format 1: the program change lives in a different track from the notes,
    // and order in the file is not order in time.
    const parsed = parseMidi(
      file([
        [[0, 0xc1, 40]], // channel 1 becomes program 40 at tick 0
        [
          [0, 0x91, 60, 100],
          [240, 0x81, 60, 0],
        ],
      ]),
    );
    expect(parsed.notes[0].program).toBe(40);
  });

  it('skips unknown chunks, sysex and other channel messages', () => {
    const junk = [...cc('XFIC'), ...u32(4), 1, 2, 3, 4];
    const bytes = file([
      [
        [0, 0xf0, ...vlq(3), 1, 2, 3], // sysex
        [0, 0xb0, 7, 100], // controller
        [0, 0xe0, 0, 64], // pitch bend
        [0, 0x90, 60, 100],
        [120, 0x80, 60, 0],
      ],
    ]);
    // Splice the junk chunk between header and track.
    const withJunk = new Uint8Array([...bytes.slice(0, 14), ...junk, ...bytes.slice(14)]);
    const parsed = parseMidi(withJunk);
    expect(parsed.notes).toHaveLength(1);
  });

  it('gives an unclosed note a length instead of losing it', () => {
    const parsed = parseMidi(file([[[0, 0x90, 60, 100]]]));
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.notes[0].lengthTicks).toBeGreaterThan(0);
  });

  it('defaults to 120 bpm and 4/4 when the file says nothing', () => {
    const parsed = parseMidi(file([[[0, 0x90, 60, 100], [120, 0x80, 60, 0]]]));
    expect(parsed.quarterBpm).toBeCloseTo(120);
    expect(parsed.timeSignature).toEqual({ numerator: 4, denominator: 4 });
  });

  it('refuses what it cannot honestly read, each with a plain reason', () => {
    expect(() => parseMidi(new Uint8Array([1, 2, 3]))).toThrow(MidiFileError);
    expect(() => parseMidi(file([[[0, 0x90, 60, 100]]], { format: 2 }))).toThrow(/several separate/);
    expect(() => parseMidi(file([[[0, 0x90, 60, 100]]], { division: 0x8000 | 25 }))).toThrow(/time-code/);
    expect(() => parseMidi(file([[]]))).toThrow(/no notes/);
    const truncated = file([[[0, 0x90, 60, 100], [120, 0x80, 60, 0]]]).slice(0, 20);
    expect(() => parseMidi(truncated)).toThrow(MidiFileError);
  });
});
