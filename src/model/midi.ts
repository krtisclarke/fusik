// Reading a .mid file. Pure parsing, no audio, no DOM — bytes in, notes out.
//
// A MIDI file contains no sound at all: it is a list of instructions — play
// this note, at this time, this long, this hard — plus an instrument number
// per track from one universal list (General MIDI). That makes it the same
// kind of thing as a .beatbox file, which is why translating one into the
// other (model/importMidi.ts) is clean. This file only turns the bytes into
// those instructions; it decides nothing about how they become a song.
//
// The format details that matter, learned from the spec and guarded by tests:
//  - Numbers are big-endian; event times are "variable-length quantities".
//  - A file is chunks: one MThd header, then MTrk tracks. Unknown chunk types
//    must be skipped, not refused — real exporters add their own.
//  - "Running status": a channel event may omit its status byte, meaning "same
//    as the last one". Files from real exporters use this everywhere; a parser
//    without it reads garbage from most files in the wild.
//  - A note-on with velocity 0 is a note-off. Also everywhere in real files.
//  - Channel 10 (index 9) is percussion: each note number is a fixed drum,
//    and the channel's instrument number is meaningless.

export class MidiFileError extends Error {}

/** One sounding note, in absolute ticks from the start of the song. */
export interface MidiNote {
  /** 0-15; 9 is the percussion channel. */
  channel: number;
  pitch: number;
  /** 1-127 as played. */
  velocity: number;
  startTick: number;
  lengthTicks: number;
  /** The General MIDI instrument number (0-127) governing this note. */
  program: number;
}

export interface ParsedMidi {
  /** Timing resolution: how many ticks one quarter note lasts. */
  ticksPerQuarter: number;
  /** Quarter notes per minute, from the file's first tempo (default 120). */
  quarterBpm: number;
  timeSignature: { numerator: number; denominator: number };
  /** Every note from every track, sorted by start time. */
  notes: MidiNote[];
}

/**
 * More notes than any real song carries — a runaway or malicious file. The
 * limit exists because every note becomes a block in a project that undo
 * keeps a hundred snapshots of; importing a million-note file would not
 * produce a song, only a frozen app.
 */
const MAX_NOTES = 20000;

export function parseMidi(bytes: Uint8Array): ParsedMidi {
  const r = new Reader(bytes);

  // ---- header ----
  if (r.fourCC() !== 'MThd') throw new MidiFileError("This isn't a MIDI file");
  const headerLength = r.u32();
  if (headerLength < 6) throw new MidiFileError('This file is damaged');
  const format = r.u16();
  const trackCount = r.u16();
  const division = r.u16();
  r.skip(headerLength - 6); // a longer header is legal; the extra is ignorable
  if (format === 2) {
    // Format 2 is several unrelated songs in one file — vanishingly rare, and
    // there is no honest way to pick one. Refuse plainly rather than guess.
    throw new MidiFileError("This file holds several separate pieces — save it as a normal (type 0 or 1) MIDI file");
  }
  if (division & 0x8000) {
    // SMPTE time-code division: frames and subframes, film-studio territory.
    throw new MidiFileError('This file uses studio time-code timing, which songs almost never do');
  }
  const ticksPerQuarter = division & 0x7fff;
  if (ticksPerQuarter === 0) throw new MidiFileError('This file is damaged');

  // ---- tracks ----
  // Everything is collected with absolute ticks and resolved after all tracks
  // are read, because format 1 spreads one song across tracks: the tempo in
  // track 0, the piano in track 2, its program change wherever the exporter
  // felt like. Order within the file is not order in time.
  const tempos: { tick: number; usPerQuarter: number }[] = [];
  const timeSigs: { tick: number; numerator: number; denominator: number }[] = [];
  const programChanges: { tick: number; channel: number; program: number }[] = [];
  const ons: { tick: number; seq: number; channel: number; pitch: number; velocity: number }[] = [];
  const offs: { tick: number; seq: number; channel: number; pitch: number }[] = [];
  let seq = 0; // file order, to break ties deterministically at equal ticks

  for (let t = 0; t < trackCount && !r.atEnd(); t++) {
    const type = r.fourCC();
    const length = r.u32();
    const trackEnd = r.at + length;
    if (trackEnd > bytes.length) throw new MidiFileError('This file is damaged');
    if (type !== 'MTrk') {
      r.skip(length); // unknown chunk: legal, skip it
      t--; // it wasn't a track; don't let it use up a track slot
      continue;
    }

    let tick = 0;
    let runningStatus = 0;
    while (r.at < trackEnd) {
      tick += r.vlq();
      let status = r.u8();
      if (status < 0x80) {
        // Running status: this byte was already the first data byte.
        if (runningStatus === 0) throw new MidiFileError('This file is damaged');
        status = runningStatus;
        r.at--;
      }

      if (status === 0xff) {
        // Meta event. Metas never set running status.
        const metaType = r.u8();
        const len = r.vlq();
        const dataAt = r.at;
        if (metaType === 0x51 && len >= 3) {
          tempos.push({ tick, usPerQuarter: (r.u8() << 16) | (r.u8() << 8) | r.u8() });
          r.at = dataAt;
        } else if (metaType === 0x58 && len >= 2) {
          const nn = r.u8();
          const dd = r.u8();
          timeSigs.push({ tick, numerator: nn, denominator: 2 ** dd });
          r.at = dataAt;
        }
        r.skip(len);
        if (metaType === 0x2f) break; // end of track
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        // Sysex: skip its payload. Sysex cancels running status.
        runningStatus = 0;
        r.skip(r.vlq());
        continue;
      }
      if (status < 0x80 || status >= 0xf0) throw new MidiFileError('This file is damaged');

      runningStatus = status;
      const kind = status & 0xf0;
      const channel = status & 0x0f;
      if (kind === 0x90) {
        const pitch = r.u8();
        const velocity = r.u8();
        if (velocity > 0) ons.push({ tick, seq: seq++, channel, pitch, velocity });
        else offs.push({ tick, seq: seq++, channel, pitch });
      } else if (kind === 0x80) {
        const pitch = r.u8();
        r.u8(); // release velocity, unused
        offs.push({ tick, seq: seq++, channel, pitch });
      } else if (kind === 0xc0) {
        programChanges.push({ tick, channel, program: r.u8() & 0x7f });
      } else if (kind === 0xd0) {
        r.skip(1); // channel aftertouch
      } else {
        r.skip(2); // controller, poly aftertouch, pitch bend — two data bytes each
      }
    }
    r.at = trackEnd; // trust the chunk length over the event stream
  }

  // ---- resolve notes ----
  // Pair each note-on with the earliest matching note-off after it. Both
  // lists are sorted by time (file order breaks ties), so a plain sweep works.
  const byTime = (a: { tick: number; seq: number }, b: { tick: number; seq: number }) =>
    a.tick - b.tick || a.seq - b.seq;
  ons.sort(byTime);
  offs.sort(byTime);
  programChanges.sort((a, b) => a.tick - b.tick);

  if (ons.length > MAX_NOTES) {
    throw new MidiFileError('This file is too big to become a song');
  }

  const offsUsed = new Uint8Array(offs.length);
  // Index note-offs by channel+pitch so each on-note scans only its own.
  const offsByKey = new Map<number, number[]>();
  offs.forEach((off, i) => {
    const key = off.channel * 128 + off.pitch;
    const list = offsByKey.get(key);
    if (list) list.push(i);
    else offsByKey.set(key, [i]);
  });

  let lastTick = 0;
  for (const on of ons) lastTick = Math.max(lastTick, on.tick);
  for (const off of offs) lastTick = Math.max(lastTick, off.tick);

  const programAt = (channel: number, tick: number): number => {
    let program = 0;
    for (const change of programChanges) {
      if (change.tick > tick) break;
      if (change.channel === channel) program = change.program;
    }
    return program;
  };

  const notes: MidiNote[] = [];
  for (const on of ons) {
    const key = on.channel * 128 + on.pitch;
    const candidates = offsByKey.get(key) ?? [];
    let lengthTicks = 0;
    for (const i of candidates) {
      const off = offs[i];
      if (offsUsed[i] || off.tick < on.tick || (off.tick === on.tick && off.seq < on.seq)) continue;
      offsUsed[i] = 1;
      lengthTicks = Math.max(1, off.tick - on.tick);
      break;
    }
    if (lengthTicks === 0) {
      // A note the file never releases. Real files have these at truncated
      // ends; give it a quarter note or the rest of the song, whichever is
      // shorter, rather than throwing the note away.
      lengthTicks = Math.max(1, Math.min(ticksPerQuarter, lastTick - on.tick || ticksPerQuarter));
    }
    notes.push({
      channel: on.channel,
      pitch: on.pitch,
      velocity: on.velocity,
      startTick: on.tick,
      lengthTicks,
      program: programAt(on.channel, on.tick),
    });
  }

  if (notes.length === 0) throw new MidiFileError('There are no notes in this file');

  tempos.sort((a, b) => a.tick - b.tick);
  timeSigs.sort((a, b) => a.tick - b.tick);
  const usPerQuarter = tempos[0]?.usPerQuarter ?? 500000; // the spec's default: 120 bpm
  const rawSig = timeSigs[0] ?? { numerator: 4, denominator: 4 };
  const timeSignature =
    rawSig.numerator >= 1 &&
    rawSig.numerator <= 16 &&
    [1, 2, 4, 8, 16].includes(rawSig.denominator)
      ? { numerator: rawSig.numerator, denominator: rawSig.denominator }
      : { numerator: 4, denominator: 4 };

  return {
    ticksPerQuarter,
    quarterBpm: 60_000_000 / Math.max(1, usPerQuarter),
    timeSignature,
    notes,
  };
}

/** Bounds-checked big-endian reads; every overrun is one clear error. */
class Reader {
  at = 0;
  constructor(private bytes: Uint8Array) {}

  private need(count: number) {
    if (this.at + count > this.bytes.length) throw new MidiFileError('This file is damaged');
  }
  atEnd(): boolean {
    return this.at >= this.bytes.length;
  }
  u8(): number {
    this.need(1);
    return this.bytes[this.at++];
  }
  u16(): number {
    this.need(2);
    return (this.bytes[this.at++] << 8) | this.bytes[this.at++];
  }
  u32(): number {
    this.need(4);
    return ((this.bytes[this.at++] << 24) | (this.bytes[this.at++] << 16) | (this.bytes[this.at++] << 8) | this.bytes[this.at++]) >>> 0;
  }
  fourCC(): string {
    this.need(4);
    return String.fromCharCode(this.bytes[this.at++], this.bytes[this.at++], this.bytes[this.at++], this.bytes[this.at++]);
  }
  skip(count: number) {
    this.need(count);
    this.at += count;
  }
  /** Variable-length quantity: 7 bits per byte, high bit says "more". */
  vlq(): number {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const byte = this.u8();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new MidiFileError('This file is damaged');
  }
}
