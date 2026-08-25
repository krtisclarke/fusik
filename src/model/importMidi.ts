// A parsed MIDI file becomes a Beatbox project. Pure, deterministic — the
// same file always makes the same song. Nothing here composes: every note in
// the result is a note from the file, translated. (The one hard rule of this
// app is that no software writes music in it; an importer that "improved" the
// song would be that, quietly.)
//
// What translation means, decided here:
//  - The song's key is *detected* from the notes, and the Mood (scale) is set
//    to match — then every melodic note is snapped onto that scale. That
//    keeps the app's one promise, that nothing on the note-grid can sound
//    wrong, true for imported songs too: the tune lands on rows a child can
//    then drag around safely.
//  - Instruments land on this app's voices through the General MIDI table in
//    model/gm.ts — many-to-few on purpose. The percussion channel bursts into
//    one row per drum, which is how beats are built here.
//  - Time is tidied to the same 1/16 grid the Tidy toggle uses, and the song
//    is cut into parts of eight bars — the length of a verse or chorus in
//    most songs — so it arrives as A B C… chips a child can rearrange, not
//    one endless strip.
//  - What can't come along is counted, not hidden: notes with no honest voice
//    (helicopters), rows beyond what a child can read at once.

import { MidiFileError, type ParsedMidi } from './midi';
import { voiceForPercussion, voiceForProgram } from './gm';
import { getVoice, isPitched } from './voices';
import { SCALES } from './scales';
import { MAX_BPM, MIN_BPM } from './project';
import { parseProject } from './serialization';
import type { Project } from './types';

export interface MidiImportResult {
  project: Project;
  /** What was left out: notes with no voice to land on, rows past the cap. */
  dropped: { notes: number; tracks: number };
}

/** Parts the song is cut into. Eight bars is a verse or a chorus, usually. */
const PART_BARS = 8;
/**
 * The most rows an import keeps. Ten is already a full screen of lanes; past
 * that a song stops being something a child can read, and the rows dropped
 * are the quietest ones. Never silent: the count is reported back.
 */
const MAX_TRACKS = 10;
/** The Tidy grid: sixteenth notes, in app beats. */
const GRID = 0.25;

const quantize = (beats: number) => Math.round(beats / GRID) * GRID;

export function projectFromMidi(midi: ParsedMidi, name: string): MidiImportResult {
  const { numerator, denominator } = midi.timeSignature;
  // MIDI counts time in quarter notes; this app counts the time signature's
  // own beat (in 6/8, six beats to the bar). One quarter = denominator/4 beats.
  const appBeatsPerQuarter = denominator / 4;
  const bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(midi.quarterBpm * appBeatsPerQuarter)));

  // ---- place every note on the grid, in app beats ----
  interface Placed {
    voiceId: string;
    drum: boolean;
    startBeat: number;
    lengthBeats: number;
    velocity: number;
    pitch: number;
  }
  const placed: Placed[] = [];
  let droppedNotes = 0;
  for (const note of midi.notes) {
    const voiceId =
      note.channel === 9 ? voiceForPercussion(note.pitch) : voiceForProgram(note.program);
    if (!voiceId) {
      droppedNotes++;
      continue;
    }
    const voice = getVoice(voiceId);
    if (!voice) {
      droppedNotes++;
      continue;
    }
    // A melodic program can honestly land on a drum (timpani); the pitch goes,
    // the hits stay.
    const drum = !isPitched(voice);
    const startBeat = quantize((note.startTick / midi.ticksPerQuarter) * appBeatsPerQuarter);
    const lengthBeats = drum
      ? GRID
      : Math.max(GRID, quantize((note.lengthTicks / midi.ticksPerQuarter) * appBeatsPerQuarter));
    placed.push({
      voiceId,
      drum,
      startBeat,
      lengthBeats,
      velocity: Math.min(1, Math.max(0.05, +(note.velocity / 127).toFixed(3))),
      pitch: note.pitch,
    });
  }
  if (placed.length === 0) throw new MidiFileError('There are no notes in this file');

  // ---- detect the key, choose the Mood ----
  const melodic = placed.filter((p) => !p.drum);
  const { scaleRoot, scaleId } = detectScale(melodic);
  const offsets = SCALES[scaleId];
  for (const p of melodic) p.pitch = snapToScale(p.pitch, scaleRoot, offsets);

  // ---- group into rows, cap what a child can read ----
  const groups = new Map<string, Placed[]>();
  for (const p of placed) {
    const list = groups.get(p.voiceId);
    if (list) list.push(p);
    else groups.set(p.voiceId, [p]);
  }
  const ranked = [...groups.entries()].sort(
    (a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1),
  );
  const kept = ranked.slice(0, MAX_TRACKS);
  const droppedTracks = ranked.length - kept.length;
  for (const [, notes] of ranked.slice(MAX_TRACKS)) droppedNotes += notes.length;
  // Drums above melodics, loudest-worked first in each — the shape of the
  // app's own default song, so an import reads like something built here.
  kept.sort((a, b) => {
    const aDrum = a[1][0].drum ? 0 : 1;
    const bDrum = b[1][0].drum ? 0 : 1;
    return aDrum - bDrum || b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1);
  });

  // ---- cut the song into parts ----
  const beatsPerBar = numerator;
  const partBeats = PART_BARS * beatsPerBar;
  let endBeat = 0;
  for (const [, notes] of kept)
    for (const p of notes) endBeat = Math.max(endBeat, p.startBeat + p.lengthBeats);
  const totalBars = Math.max(1, Math.ceil((endBeat || 1) / beatsPerBar));
  const partCount = Math.max(1, Math.ceil(totalBars / PART_BARS));
  const sections = Array.from({ length: partCount }, (_, i) => ({
    id: `sec_import_${i}`,
    name: partName(i),
    lengthBars: i === partCount - 1 ? totalBars - PART_BARS * (partCount - 1) : PART_BARS,
    color: SECTION_COLORS[i % SECTION_COLORS.length],
  }));

  const tracks = kept.map(([voiceId, notes], t) => {
    const voice = getVoice(voiceId)!;
    return {
      id: `trk_import_${t}`,
      name: voice.label,
      type: notes[0].drum ? 'drum' : 'instrument',
      color: voice.color,
      instrument: { voiceId, params: {} },
      gain: 0.8,
      muted: false,
      solo: false,
      notes: notes.map((p, n) => {
        const section = Math.min(partCount - 1, Math.floor(p.startBeat / partBeats));
        return {
          id: `note_import_${t}_${n}`,
          sectionId: sections[section].id,
          startBeat: p.startBeat - section * partBeats,
          lengthBeats: p.lengthBeats,
          velocity: p.velocity,
          params: {},
          ...(p.drum ? {} : { pitch: p.pitch }),
        };
      }),
    };
  });

  // The raw shape goes through the same validation and repair a .beatbox file
  // gets, so an import can only ever produce a project the rest of the app
  // already knows how to hold — every invariant enforced in one place.
  const project = parseProject(
    JSON.stringify({
      formatVersion: 4,
      name: name.trim() || 'Imported Song',
      bpm,
      timeSignature: { numerator, denominator },
      scaleRoot,
      scaleId,
      sections,
      arrangement: sections.map((s, i) => ({ id: `arr_import_${i}`, sectionId: s.id })),
      tracks,
    }),
  );
  return { project, dropped: { notes: droppedNotes, tracks: droppedTracks } };
}

/** A, B, … Z, then A2, B2 — the same single-letter style parts use here. */
function partName(index: number): string {
  const letter = String.fromCharCode(65 + (index % 26));
  const round = Math.floor(index / 26);
  return round === 0 ? letter : `${letter}${round + 1}`;
}

const SECTION_COLORS = ['#f59e0b', '#60a5fa', '#34d399', '#f472b6', '#a78bfa', '#fb923c'];

/**
 * Which of the app's four scales the song already lives in.
 *
 * Every pitch class is weighed by how long it sounds; each of the twelve
 * roots of major and minor is scored by how much of that weight it can hold.
 * The pentatonic variant is chosen when it alone holds nearly everything —
 * fewer rows for the same tune. Deterministic ties: earlier root, major
 * before minor.
 */
function detectScale(notes: { pitch: number; lengthBeats: number }[]): {
  scaleRoot: number;
  scaleId: string;
} {
  if (notes.length === 0) return { scaleRoot: 0, scaleId: 'majorPentatonic' };
  const weight = new Array(12).fill(0);
  let total = 0;
  for (const n of notes) {
    weight[((n.pitch % 12) + 12) % 12] += n.lengthBeats;
    total += n.lengthBeats;
  }
  let best = { score: -1, root: 0, id: 'major' };
  for (const id of ['major', 'minor'] as const) {
    const offsets = SCALES[id];
    for (let root = 0; root < 12; root++) {
      let score = 0;
      for (const off of offsets) score += weight[(root + off) % 12];
      // The tonic should carry weight in its own key; without this nudge,
      // C major and A minor tie on identical notes and the coin lands on
      // whichever came first rather than on where the song leans.
      score += weight[root] * 0.1;
      if (score > best.score + 1e-9) best = { score, root, id };
    }
  }
  const penta = best.id === 'major' ? 'majorPentatonic' : 'minorPentatonic';
  const pentaOffsets = SCALES[penta];
  let pentaWeight = 0;
  for (const off of pentaOffsets) pentaWeight += weight[(best.root + off) % 12];
  return {
    scaleRoot: best.root,
    scaleId: total > 0 && pentaWeight / total >= 0.9 ? penta : best.id,
  };
}

/** The nearest pitch whose class is in the scale; ties resolve downward. */
function snapToScale(pitch: number, root: number, offsets: number[]): number {
  let bestPitch = pitch;
  let bestDistance = Infinity;
  for (const off of offsets) {
    const pc = (root + off) % 12;
    // The candidate with this pitch class nearest to the note, above or below.
    const base = pitch - (((pitch % 12) - pc + 12) % 12);
    for (const candidate of [base, base + 12]) {
      const distance = Math.abs(candidate - pitch);
      if (
        candidate >= 0 &&
        candidate <= 127 &&
        (distance < bestDistance || (distance === bestDistance && candidate < bestPitch))
      ) {
        bestDistance = distance;
        bestPitch = candidate;
      }
    }
  }
  return bestPitch;
}
