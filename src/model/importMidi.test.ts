// MIDI → project translation. Everything here is the contract the importer
// makes with the rest of the app: the result is a valid project, on the
// detected scale, on the Tidy grid, cut into parts, deterministic, and
// honest about what it left out.

import { describe, expect, it } from 'vitest';
import { projectFromMidi } from './importMidi';
import type { ParsedMidi } from './midi';
import { SCALES } from './scales';
import { serializeProject } from './serialization';
import { totalBeats } from './time';

/** A parsed file, by hand — quarter = 480 ticks, 120 bpm, 4/4 by default. */
function midi(
  notes: Partial<ParsedMidi['notes'][number]>[],
  overrides: Partial<Omit<ParsedMidi, 'notes'>> = {},
): ParsedMidi {
  return {
    ticksPerQuarter: 480,
    quarterBpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    notes: notes.map((n) => ({
      channel: 0,
      pitch: 60,
      velocity: 100,
      startTick: 0,
      lengthTicks: 480,
      program: 0,
      ...n,
    })),
    ...overrides,
  };
}

const beat = (quarters: number) => ({ startTick: quarters * 480 });

describe('projectFromMidi', () => {
  it('keeps a pentatonic tune exactly, and says so in the Mood', () => {
    // C D E G A — C major pentatonic, note for note.
    const { project, dropped } = projectFromMidi(
      midi([60, 62, 64, 67, 69].map((pitch, i) => ({ pitch, ...beat(i) }))),
      'Twinkle',
    );
    expect(project.scaleRoot).toBe(0);
    expect(project.scaleId).toBe('majorPentatonic');
    expect(project.tracks).toHaveLength(1);
    expect(project.tracks[0].notes.map((n) => n.pitch)).toEqual([60, 62, 64, 67, 69]);
    expect(dropped).toEqual({ notes: 0, tracks: 0 });
  });

  it('detects a full scale when the tune needs one, and snaps strays onto it', () => {
    // C major with its semitone notes (F and B) in real weight, plus one F#
    // passing note that has no row anywhere in C major.
    const pitches = [60, 62, 64, 65, 67, 69, 71, 65, 71, 66];
    const { project } = projectFromMidi(midi(pitches.map((pitch, i) => ({ pitch, ...beat(i) }))), 'Scale');
    expect(project.scaleId).toBe('major');
    expect(project.scaleRoot).toBe(0);
    const allowed = new Set(SCALES.major.map((off) => off % 12));
    for (const note of project.tracks[0].notes) {
      expect(allowed.has(((note.pitch! - project.scaleRoot) % 12 + 12) % 12), `pitch ${note.pitch}`).toBe(true);
    }
  });

  it('hears a minor tune as Sad', () => {
    // A natural minor, leaning on A.
    const pitches = [69, 71, 72, 74, 76, 77, 79, 69, 69];
    const { project } = projectFromMidi(midi(pitches.map((pitch, i) => ({ pitch, ...beat(i) }))), 'Sad tune');
    expect(project.scaleRoot).toBe(9);
    expect(project.scaleId === 'minor' || project.scaleId === 'minorPentatonic').toBe(true);
  });

  it('bursts the percussion channel into one row per drum, pitchless', () => {
    const { project } = projectFromMidi(
      midi([
        { channel: 9, pitch: 36, ...beat(0) },
        { channel: 9, pitch: 36, ...beat(1) },
        { channel: 9, pitch: 38, ...beat(1) },
        { channel: 9, pitch: 42, ...beat(0.5) },
      ]),
      'Beat',
    );
    const byVoice = new Map(project.tracks.map((t) => [t.instrument.voiceId, t]));
    expect([...byVoice.keys()].sort()).toEqual(['hihat', 'kick', 'snare']);
    for (const t of project.tracks) {
      expect(t.type).toBe('drum');
      for (const n of t.notes) {
        expect(n.pitch).toBeUndefined();
        expect(n.lengthBeats).toBe(0.25);
      }
    }
    expect(byVoice.get('kick')!.notes).toHaveLength(2);
  });

  it('tidies timing to the sixteenth grid', () => {
    const { project } = projectFromMidi(
      midi([
        { pitch: 60, startTick: 13, lengthTicks: 460 }, // almost on the beat, almost a quarter
        { pitch: 64, startTick: 700, lengthTicks: 20 }, // loose, and very short
      ]),
      'Loose',
    );
    const notes = project.tracks[0].notes;
    expect(notes[0].startBeat).toBe(0);
    expect(notes[0].lengthBeats).toBe(1);
    expect(notes[1].startBeat).toBe(1.5);
    expect(notes[1].lengthBeats).toBe(0.25); // never thinner than one grid cell
  });

  it('cuts a long song into eight-bar parts and re-bases the notes', () => {
    const { project } = projectFromMidi(
      midi([
        { pitch: 60, ...beat(0) },
        { pitch: 62, ...beat(70) }, // bar 18, beat 3
      ]),
      'Long',
    );
    expect(project.sections.map((s) => s.lengthBars)).toEqual([8, 8, 2]);
    expect(project.sections.map((s) => s.name)).toEqual(['A', 'B', 'C']);
    expect(project.arrangement.map((slot) => slot.sectionId)).toEqual(project.sections.map((s) => s.id));
    const late = project.tracks[0].notes[1];
    expect(late.sectionId).toBe(project.sections[2].id);
    expect(late.startBeat).toBe(6);
    // The song's total playing length survives the cut.
    expect(project.sections.reduce((n, s) => n + totalBeats(s.lengthBars, project.timeSignature), 0)).toBe(72);
  });

  it('keeps the ten busiest rows and counts the rest out loud', () => {
    // Eight drums plus four melodic voices = twelve candidate rows; the two
    // quietest melodic rows must go, and their notes must be counted.
    const drums = [36, 38, 42, 46, 49, 51, 54, 75]; // kick snare hat openhat crash ride tamb claves
    const notes = [
      ...drums.flatMap((pitch, d) =>
        Array.from({ length: 8 }, (_, i) => ({ channel: 9, pitch, ...beat(d + i * 4) })),
      ),
      ...Array.from({ length: 6 }, (_, i) => ({ program: 0, pitch: 60, ...beat(i) })), // piano, busy
      ...Array.from({ length: 5 }, (_, i) => ({ program: 33, pitch: 40, ...beat(i) })), // bass
      ...Array.from({ length: 2 }, (_, i) => ({ program: 48, pitch: 72, ...beat(i) })), // strings, quiet
      { program: 11, pitch: 72, ...beat(0) }, // vibraphone, one note
    ];
    const { project, dropped } = projectFromMidi(midi(notes), 'Crowded');
    expect(project.tracks).toHaveLength(10);
    expect(dropped.tracks).toBe(2);
    expect(dropped.notes).toBe(3); // the strings' two and the vibraphone's one
    const voices = project.tracks.map((t) => t.instrument.voiceId);
    expect(voices).not.toContain('strings');
    expect(voices).not.toContain('vibraphone');
    // Drum rows come first, like a song built by hand here.
    expect(project.tracks[0].type).toBe('drum');
    expect(project.tracks.at(-1)!.type).toBe('instrument');
  });

  it('leaves out what has no honest voice, and counts it', () => {
    const { project, dropped } = projectFromMidi(
      midi([
        { pitch: 60, program: 0, ...beat(0) },
        { pitch: 60, program: 125, ...beat(1) }, // helicopter
        { channel: 9, pitch: 78, ...beat(2) }, // mute cuica
      ]),
      'Noisy',
    );
    expect(project.tracks).toHaveLength(1);
    expect(dropped.notes).toBe(2);
  });

  it('carries tempo and time signature across, in the app’s own beat', () => {
    // 6/8 at 120 quarter-bpm: the app counts eighths, so 240 of them a minute.
    const { project } = projectFromMidi(
      midi([{ pitch: 60, startTick: 480, lengthTicks: 480 }], {
        timeSignature: { numerator: 6, denominator: 8 },
      }),
      'Jig',
    );
    expect(project.bpm).toBe(240);
    expect(project.timeSignature).toEqual({ numerator: 6, denominator: 8 });
    // One quarter note = two app beats now.
    expect(project.tracks[0].notes[0].startBeat).toBe(2);
    expect(project.tracks[0].notes[0].lengthBeats).toBe(2);
  });

  it('clamps an absurd tempo into the app’s range', () => {
    const { project } = projectFromMidi(midi([{ pitch: 60 }], { quarterBpm: 900 }), 'Fast');
    expect(project.bpm).toBe(300);
  });

  it('is deterministic: the same file makes the same song, byte for byte', () => {
    const make = () =>
      projectFromMidi(
        midi([
          { pitch: 61, ...beat(0) },
          { channel: 9, pitch: 36, ...beat(1) },
          { pitch: 66, program: 25, ...beat(2) },
        ]),
        'Same',
      ).project;
    expect(serializeProject(make())).toBe(serializeProject(make()));
  });

  it('names the song after the file, with a fallback', () => {
    expect(projectFromMidi(midi([{ pitch: 60 }]), 'My Tune').project.name).toBe('My Tune');
    expect(projectFromMidi(midi([{ pitch: 60 }]), '  ').project.name).toBe('Imported Song');
  });

  it('velocity survives, scaled to the app’s 0..1', () => {
    const { project } = projectFromMidi(
      midi([
        { pitch: 60, velocity: 127, ...beat(0) },
        { pitch: 60, velocity: 32, ...beat(1) },
      ]),
      'Soft and loud',
    );
    const [loud, soft] = project.tracks[0].notes;
    expect(loud.velocity).toBe(1);
    expect(soft.velocity).toBeCloseTo(0.252, 3);
  });
});
