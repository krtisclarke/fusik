import { describe, it, expect } from 'vitest';
import * as P from './project';
import { SCALES, pitchLadder } from './scales';
import { getVoice } from './voices';
import {
  createDefaultProject,
  createNote,
  addNote,
  removeNote,
  updateNote,
  moveNote,
  setBpm,
  setSectionLength,
  addSection,
  duplicateSection,
  repeatSection,
  moveArrangementEntry,
  removeArrangementEntry,
  renameSection,
  toggleTrackMuted,
  findTrackByVoice,
  setNotesParam,
  setNotesLength,
  chainNotes,
  unchainNotes,
  expandChain,
  removeNotes,
  setScale,
  setTrackVoice,
  addTrack,
  createTrackForVoice,
  createAudioTrack,
  createClipNote,
  clipIdsIn,
} from './project';

/** The default project's one starting section id. */
const sec = (p: ReturnType<typeof createDefaultProject>) => p.sections[0].id;

describe('default project', () => {
  it('comes with kick, snare and hi-hat ready to go', () => {
    const p = createDefaultProject();
    expect(p.bpm).toBe(120);
    expect(p.tracks.map((t) => t.instrument.voiceId)).toEqual(['kick', 'snare', 'hihat']);
    expect(p.tracks.every((t) => t.notes.length === 0)).toBe(true);
  });

  it('starts as one part, arranged once', () => {
    const p = createDefaultProject();
    expect(p.sections).toHaveLength(1);
    expect(p.arrangement).toHaveLength(1);
    expect(p.arrangement[0].sectionId).toBe(p.sections[0].id);
    expect(p.sections[0].name).toBe('A');
  });
});

describe('note edits are immutable', () => {
  it('adds a note without mutating the original project', () => {
    const p = createDefaultProject();
    const trackId = p.tracks[0].id;
    const p2 = addNote(p, trackId, createNote(sec(p), 0));
    expect(p.tracks[0].notes).toHaveLength(0); // original untouched
    expect(p2.tracks[0].notes).toHaveLength(1);
  });

  it('removes a note', () => {
    let p = createDefaultProject();
    const trackId = p.tracks[0].id;
    const note = createNote(sec(p), 1);
    p = addNote(p, trackId, note);
    p = removeNote(p, trackId, note.id);
    expect(p.tracks[0].notes).toHaveLength(0);
  });

  it('updates and clamps a note', () => {
    let p = createDefaultProject();
    const trackId = p.tracks[0].id;
    const note = createNote(sec(p), 1);
    p = addNote(p, trackId, note);
    p = updateNote(p, trackId, note.id, { velocity: 9, startBeat: -2 });
    expect(p.tracks[0].notes[0].velocity).toBe(1);
    expect(p.tracks[0].notes[0].startBeat).toBe(0);
  });

  it('moves a note between tracks', () => {
    let p = createDefaultProject();
    const from = p.tracks[0].id;
    const to = p.tracks[1].id;
    const note = createNote(sec(p), 0);
    p = addNote(p, from, note);
    p = moveNote(p, from, note.id, to, 3);
    expect(p.tracks[0].notes).toHaveLength(0);
    expect(p.tracks[1].notes[0].startBeat).toBe(3);
  });

  it('moves a note up and down in pitch as well as along in time', () => {
    // Dragging a block up the note-grid: it lands on a different note of the
    // scale without being removed and placed again.
    let p = createDefaultProject();
    const trackId = p.tracks[0].id;
    const note = createNote(sec(p), 0, 1, 0.8, 60);
    p = addNote(p, trackId, note);
    p = moveNote(p, trackId, note.id, trackId, 2, 67);
    expect(p.tracks[0].notes[0].startBeat).toBe(2);
    expect(p.tracks[0].notes[0].pitch).toBe(67);
  });

  it('keeps everything else about the block it moved', () => {
    let p = createDefaultProject();
    const trackId = p.tracks[0].id;
    const note = { ...createNote(sec(p), 0, 2.5, 0.42, 60), groupId: 'grp_1' };
    p = addNote(p, trackId, note);
    p = moveNote(p, trackId, note.id, trackId, 1, 64);
    const moved = p.tracks[0].notes[0];
    expect(moved.id).toBe(note.id);
    expect(moved.lengthBeats).toBe(2.5);
    expect(moved.velocity).toBe(0.42);
    expect(moved.groupId).toBe('grp_1');
  });

  it('refuses to give a drum a pitch it has no row for', () => {
    // Drum blocks have no pitch: the note-grid draws them on a single row and
    // the drum voices don't read one. Handing one a pitch would make a block
    // with nowhere to live.
    let p = createDefaultProject();
    const trackId = p.tracks[0].id;
    const note = createNote(sec(p), 0); // no pitch
    p = addNote(p, trackId, note);
    p = moveNote(p, trackId, note.id, trackId, 1, 72);
    expect(p.tracks[0].notes[0].pitch).toBeUndefined();
  });

  it('leaves the pitch alone when the move does not mention one', () => {
    let p = createDefaultProject();
    const trackId = p.tracks[0].id;
    const note = createNote(sec(p), 0, 1, 0.8, 60);
    p = addNote(p, trackId, note);
    p = moveNote(p, trackId, note.id, trackId, 1);
    expect(p.tracks[0].notes[0].pitch).toBe(60);
  });
});

describe('recorded blocks', () => {
  it('is a block like any other, so the timeline needs no special case', () => {
    let p = createDefaultProject();
    const track = createAudioTrack();
    p = addTrack(p, track);
    const note = createClipNote(sec(p), 2, 4, 'clip_1', 2.0);
    p = addNote(p, track.id, note);
    // moved, resized and deleted by exactly the same operations as a drum
    p = moveNote(p, track.id, note.id, track.id, 6);
    expect(p.tracks[3].notes[0].startBeat).toBe(6);
    expect(p.tracks[3].notes[0].clipId).toBe('clip_1');
    p = updateNote(p, track.id, note.id, { lengthBeats: 8 });
    expect(p.tracks[3].notes[0].lengthBeats).toBe(8);
  });

  it('refuses to be given a pitch — a recording has no note to be', () => {
    let p = createDefaultProject();
    const track = createAudioTrack();
    p = addTrack(p, track);
    const note = createClipNote(sec(p), 0, 4, 'clip_1', 2.0);
    p = addNote(p, track.id, note);
    p = moveNote(p, track.id, note.id, track.id, 0, 72);
    expect(p.tracks[3].notes[0].pitch).toBeUndefined();
  });

  // A recording plays at the speed it was made: the song's tempo can't stretch
  // a voice. So the block has to be re-measured, or it would stop matching the
  // sound coming out of it.
  it('keeps its block matching the sound when the tempo changes', () => {
    let p = createDefaultProject(); // 120bpm
    const track = createAudioTrack();
    p = addTrack(p, track);
    p = addNote(p, track.id, createClipNote(sec(p), 0, 4, 'clip_1', 2.0)); // 2s = 4 beats
    p = setBpm(p, 240); // twice as fast: the same 2 seconds is now 8 beats
    expect(p.tracks[3].notes[0].lengthBeats).toBeCloseTo(8);
    expect(p.tracks[3].notes[0].clipSeconds).toBe(2.0); // the sound itself is untouched
    p = setBpm(p, 120);
    expect(p.tracks[3].notes[0].lengthBeats).toBeCloseTo(4);
  });

  it('leaves ordinary blocks alone when the tempo changes', () => {
    let p = createDefaultProject();
    p = addNote(p, p.tracks[0].id, createNote(sec(p), 0, 1));
    p = setBpm(p, 240);
    expect(p.tracks[0].notes[0].lengthBeats).toBe(1);
  });

  it('counts a recording wherever in the song it sits', () => {
    // A take made while the song plays lands in whichever part was sounding,
    // which needn't be the part on screen.
    let p = createDefaultProject();
    p = addSection(p); // a second part
    const track = createAudioTrack();
    p = addTrack(p, track);
    p = addNote(p, track.id, createClipNote(p.sections[0].id, 0, 2, 'clip_a', 1));
    p = addNote(p, track.id, createClipNote(p.sections[1].id, 0, 2, 'clip_b', 1));
    expect(clipIdsIn(p).size).toBe(2);
  });

  it('knows every recording the song refers to', () => {
    let p = createDefaultProject();
    const track = createAudioTrack();
    p = addTrack(p, track);
    p = addNote(p, track.id, createClipNote(sec(p), 0, 2, 'clip_a', 1));
    p = addNote(p, track.id, createClipNote(sec(p), 4, 2, 'clip_b', 1));
    p = addNote(p, track.id, createClipNote(sec(p), 8, 2, 'clip_a', 1)); // used twice
    p = addNote(p, p.tracks[0].id, createNote(sec(p), 0));
    expect([...clipIdsIn(p)].sort()).toEqual(['clip_a', 'clip_b']);
  });
});

describe('playing a row on another instrument', () => {
  it('carries the tune into the new instrument’s range', () => {
    let p = createDefaultProject();
    const piano = createTrackForVoice('piano');
    p = addTrack(p, piano);
    const ladder = pitchLadder(60, 2, p.scaleRoot, p.scaleId);
    // the first, middle and last rungs of the piano's grid
    for (const [i, idx] of [0, 5, ladder.length - 1].entries()) {
      p = addNote(p, piano.id, createNote(sec(p), i, 1, 0.8, ladder[idx]));
    }

    p = setTrackVoice(p, piano.id, 'bass');
    const track = p.tracks.find((t) => t.id === piano.id)!;
    expect(track.instrument.voiceId).toBe('bass');
    expect(track.name).toBe('Bass');

    // Same rungs, on the bass's own ladder — so it is the same tune, played low.
    const bassLadder = pitchLadder(getVoice('bass')!.baseMidi!, getVoice('bass')!.octaves!, p.scaleRoot, p.scaleId);
    const pitches = track.notes.map((n) => n.pitch!);
    expect(pitches[0]).toBe(bassLadder[0]);
    expect(pitches[1]).toBe(bassLadder[5]);
    // ...and it really did move, rather than staying where the piano had it.
    expect(pitches[0]).toBeLessThan(ladder[0]);
  });

  it('keeps the shape of the tune — the order of the notes is untouched', () => {
    let p = createDefaultProject();
    const piano = createTrackForVoice('piano');
    p = addTrack(p, piano);
    const ladder = pitchLadder(60, 2, p.scaleRoot, p.scaleId);
    for (const [i, idx] of [0, 3, 1, 6, 2].entries()) {
      p = addNote(p, piano.id, createNote(sec(p), i, 1, 0.8, ladder[idx]));
    }
    const before = p.tracks.find((t) => t.id === piano.id)!.notes.map((n) => n.pitch!);
    p = setTrackVoice(p, piano.id, 'bells');
    const after = p.tracks.find((t) => t.id === piano.id)!.notes.map((n) => n.pitch!);
    // every rise stays a rise and every fall a fall
    for (let i = 1; i < after.length; i++) {
      expect(Math.sign(after[i] - after[i - 1])).toBe(Math.sign(before[i] - before[i - 1]));
    }
  });

  it('keeps everything else about the blocks', () => {
    let p = createDefaultProject();
    const piano = createTrackForVoice('piano');
    p = addTrack(p, piano);
    const note = { ...createNote(sec(p), 2, 1.5, 0.42, 72), groupId: 'grp_1', params: { cutoff: 900 } };
    p = addNote(p, piano.id, note);
    p = setTrackVoice(p, piano.id, 'synth');
    const moved = p.tracks.find((t) => t.id === piano.id)!.notes[0];
    expect(moved.id).toBe(note.id);
    expect(moved.startBeat).toBe(2);
    expect(moved.lengthBeats).toBe(1.5);
    expect(moved.velocity).toBe(0.42);
    expect(moved.groupId).toBe('grp_1');
    expect(moved.params).toEqual({ cutoff: 900 });
  });

  it('refuses to turn a drum row into a tune, or the other way', () => {
    let p = createDefaultProject();
    const drumId = p.tracks[0].id; // kick
    expect(setTrackVoice(p, drumId, 'piano')).toBe(p);

    const piano = createTrackForVoice('piano');
    p = addTrack(p, piano);
    expect(setTrackVoice(p, piano.id, 'kick')).toBe(p);
  });

  it('does nothing for an unknown voice, a missing row, or the voice already on it', () => {
    const p = createDefaultProject();
    expect(setTrackVoice(p, p.tracks[0].id, 'kazoo')).toBe(p);
    expect(setTrackVoice(p, 'trk_nope', 'snare')).toBe(p);
    expect(setTrackVoice(p, p.tracks[0].id, p.tracks[0].instrument.voiceId)).toBe(p);
  });

  it('swaps one drum for another, blocks and all', () => {
    let p = createDefaultProject();
    const kick = p.tracks[0].id;
    p = addNote(p, kick, createNote(sec(p), 0));
    p = addNote(p, kick, createNote(sec(p), 2));
    p = setTrackVoice(p, kick, 'tom');
    const track = p.tracks[0];
    expect(track.instrument.voiceId).toBe('tom');
    expect(track.notes).toHaveLength(2);
    expect(track.notes.every((n) => n.pitch == null)).toBe(true);
  });
});

describe('changing the song’s mood', () => {
  it('brings the tune with it, every note landing in the new scale', () => {
    let p = createDefaultProject();
    const track = createTrackForVoice('piano');
    p = addTrack(p, track);
    // A tune in C major pentatonic: C D E G A.
    for (const [i, pitch] of [60, 62, 64, 67, 69].entries()) {
      p = addNote(p, track.id, createNote(sec(p), i, 1, 0.8, pitch));
    }
    const before = p.tracks.find((t) => t.id === track.id)!.notes.map((n) => n.pitch);

    p = setScale(p, 0, 'minorPentatonic'); // C Eb F G Bb
    const after = p.tracks.find((t) => t.id === track.id)!.notes.map((n) => n.pitch!);

    expect(p.scaleId).toBe('minorPentatonic');
    // Every note now belongs to the new scale...
    for (const pitch of after) {
      expect(SCALES.minorPentatonic).toContain(((pitch % 12) + 12) % 12);
    }
    // ...and none of them travelled far, so it is still the same tune.
    after.forEach((pitch, i) => expect(Math.abs(pitch - before[i]!)).toBeLessThanOrEqual(2));
    // It did actually change something — a test that passes either way is no test.
    expect(after).not.toEqual(before);
  });

  it('leaves drums alone — they have no pitch to move', () => {
    let p = createDefaultProject();
    const kick = p.tracks[0].id;
    p = addNote(p, kick, createNote(sec(p), 0));
    p = setScale(p, 0, 'minor');
    expect(p.tracks[0].notes[0].pitch).toBeUndefined();
  });

  it('does nothing at all for a scale it does not know, or the one already set', () => {
    const p = createDefaultProject();
    expect(setScale(p, 0, 'lydianBebopWhatever')).toBe(p);
    expect(setScale(p, p.scaleRoot, p.scaleId)).toBe(p);
  });
});

describe('song settings', () => {
  it('clamps tempo to a sane range', () => {
    expect(setBpm(createDefaultProject(), 5).bpm).toBe(20);
    expect(setBpm(createDefaultProject(), 9000).bpm).toBe(300);
  });

  it('clamps a part’s length', () => {
    const p = createDefaultProject();
    expect(setSectionLength(p, sec(p), 0).sections[0].lengthBars).toBe(1);
    expect(setSectionLength(p, sec(p), 999).sections[0].lengthBars).toBe(64);
  });

  it('toggles mute', () => {
    const p = createDefaultProject();
    const id = p.tracks[0].id;
    expect(toggleTrackMuted(p, id).tracks[0].muted).toBe(true);
  });
});

describe('sections & arrangement', () => {
  it('adds a new empty part to the end of the song', () => {
    const p = addSection(createDefaultProject());
    expect(p.sections).toHaveLength(2);
    expect(p.sections[1].name).toBe('B');
    expect(p.arrangement.map((e) => e.sectionId)).toEqual([p.sections[0].id, p.sections[1].id]);
  });

  it('repeats a part: same section, another slot', () => {
    let p = createDefaultProject();
    p = repeatSection(p, sec(p));
    expect(p.sections).toHaveLength(1);
    expect(p.arrangement).toHaveLength(2);
    expect(p.arrangement[0].sectionId).toBe(p.arrangement[1].sectionId);
    expect(p.arrangement[0].id).not.toBe(p.arrangement[1].id);
  });

  it('copies a part with independent copies of its notes', () => {
    let p = createDefaultProject();
    const trk = p.tracks[0].id;
    const a = createNote(sec(p), 0);
    const b = createNote(sec(p), 1);
    p = addNote(p, trk, a);
    p = addNote(p, trk, b);
    p = chainNotes(p, [a.id, b.id]);

    p = duplicateSection(p, sec(p));
    const copyId = p.sections[1].id;
    const originals = p.tracks[0].notes.filter((n) => n.sectionId === sec(p));
    const copies = p.tracks[0].notes.filter((n) => n.sectionId === copyId);
    expect(copies).toHaveLength(2);
    expect(copies.map((n) => n.startBeat)).toEqual([0, 1]);
    // fresh ids, and the chain is re-linked among the copies only
    expect(copies.every((c) => !originals.some((o) => o.id === c.id))).toBe(true);
    expect(copies[0].groupId).toBe(copies[1].groupId);
    expect(copies[0].groupId).not.toBe(originals[0].groupId);
  });

  it('reorders the song', () => {
    let p = addSection(createDefaultProject()); // A B
    p = moveArrangementEntry(p, 1, 0); // B A
    expect(p.arrangement.map((e) => e.sectionId)).toEqual([p.sections[1].id, p.sections[0].id]);
  });

  it('removing a repeated slot keeps the part; removing its last slot deletes it and its notes', () => {
    let p = createDefaultProject();
    const aId = sec(p);
    p = addNote(p, p.tracks[0].id, createNote(aId, 0));
    p = repeatSection(p, aId); // A A
    p = addSection(p); // A A B

    p = removeArrangementEntry(p, p.arrangement[1].id); // A B — section A survives
    expect(p.sections).toHaveLength(2);
    expect(p.tracks[0].notes).toHaveLength(1);

    p = removeArrangementEntry(p, p.arrangement[0].id); // B — A gone, notes gone
    expect(p.sections.map((s) => s.name)).toEqual(['B']);
    expect(p.tracks[0].notes).toHaveLength(0);
  });

  it('never removes the last remaining slot', () => {
    const p = createDefaultProject();
    expect(removeArrangementEntry(p, p.arrangement[0].id)).toBe(p);
  });

  it('renames a part', () => {
    const p = createDefaultProject();
    expect(renameSection(p, sec(p), 'Chorus').sections[0].name).toBe('Chorus');
  });
});

describe('lookups', () => {
  it('finds a track by its voice', () => {
    const p = createDefaultProject();
    expect(findTrackByVoice(p, 'snare')?.instrument.voiceId).toBe('snare');
    expect(findTrackByVoice(p, 'nope')).toBeUndefined();
  });
});

describe('per-block sound & chaining', () => {
  function twoKicks() {
    let p = createDefaultProject();
    const trk = p.tracks[0].id;
    const a = createNote(sec(p), 0);
    const b = createNote(sec(p), 1);
    p = addNote(p, trk, a);
    p = addNote(p, trk, b);
    const notes = () => p.tracks[0].notes;
    return { p, trk, aId: a.id, bId: b.id, notes };
  }
  const noteById = (p: ReturnType<typeof createDefaultProject>, id: string) =>
    p.tracks.flatMap((t) => t.notes).find((n) => n.id === id)!;

  it('sets a sound param on the given blocks only', () => {
    const t = twoKicks();
    const p = setNotesParam(t.p, new Set([t.aId]), 'decay', 0.9);
    expect(noteById(p, t.aId).params.decay).toBe(0.9);
    expect(noteById(p, t.bId).params.decay).toBeUndefined();
  });

  it('chains blocks so they share the first block’s sound and length', () => {
    let p = twoKicks().p;
    const [a, b] = p.tracks[0].notes.map((n) => n.id);
    p = setNotesParam(p, new Set([a]), 'decay', 0.9);
    p = setNotesLength(p, new Set([a]), 2);
    p = chainNotes(p, [a, b]);
    const na = noteById(p, a);
    const nb = noteById(p, b);
    expect(na.groupId).toBeTruthy();
    expect(nb.groupId).toBe(na.groupId);
    expect(nb.params.decay).toBe(0.9); // took a's sound
    expect(nb.lengthBeats).toBe(2); // took a's length
  });

  it('expands a selection to its chained partners, so editing one edits all', () => {
    let p = twoKicks().p;
    const [a, b] = p.tracks[0].notes.map((n) => n.id);
    p = chainNotes(p, [a, b]);
    const ids = expandChain(p, [a]);
    expect(ids.has(b)).toBe(true);
    p = setNotesParam(p, ids, 'gain', 0.4);
    expect(noteById(p, b).params.gain).toBe(0.4);
  });

  it('unchains blocks', () => {
    let p = twoKicks().p;
    const [a, b] = p.tracks[0].notes.map((n) => n.id);
    p = chainNotes(p, [a, b]);
    p = unchainNotes(p, [a]);
    expect(noteById(p, a).groupId).toBeUndefined();
  });

  it('removes multiple blocks by id', () => {
    const t = twoKicks();
    const p = removeNotes(t.p, new Set([t.aId, t.bId]));
    expect(p.tracks[0].notes).toHaveLength(0);
  });
});

describe('edits that change nothing', () => {
  // The store commits whatever these return, so a fresh-but-identical project
  // would spend an undo step doing nothing — and clear the redo stack with it.
  it('returns the same project when a part is already that length', () => {
    const p = createDefaultProject();
    expect(setSectionLength(p, sec(p), p.sections[0].lengthBars)).toBe(p);
    expect(setSectionLength(p, sec(p), 0)).not.toBe(p); // 4 -> clamped 1: a real change

    // Pressing − again once the part is down to one bar: nothing left to do.
    const atMinimum = setSectionLength(p, sec(p), 1);
    expect(setSectionLength(atMinimum, sec(p), 0)).toBe(atMinimum);
  });

  it('returns the same project when a part is renamed to its own name', () => {
    const p = createDefaultProject();
    expect(renameSection(p, sec(p), 'A')).toBe(p);
    expect(renameSection(p, sec(p), 'Verse')).not.toBe(p);
  });

  it('returns the same project when the tempo is already there', () => {
    const p = createDefaultProject();
    expect(setBpm(p, 120)).toBe(p);

    const atMaximum = setBpm(p, 300);
    expect(setBpm(atMaximum, 9000)).toBe(atMaximum); // pinned at the top
  });
});

// ---- getting blocks on the beat -----------------------------------------

describe('repeatNoteEvenly', () => {
  function drumProject() {
    let p = P.createDefaultProject();
    const track = P.createTrackForVoice('kick');
    p = P.addTrack(p, track);
    return { p, trackId: track.id, sectionId: p.arrangement[0].sectionId };
  }

  it('fills the whole part on the block’s own offset, not just after it', () => {
    const { p, trackId, sectionId } = drumProject();
    // A 4-bar part in 4/4 is 16 beats. A block on beat 2, every beat, should
    // fill 0..15 — including the beats *before* where the child clicked.
    const note = P.createNote(sectionId, 2, 1);
    const withNote = P.addNote(p, trackId, note);
    const filled = P.repeatNoteEvenly(withNote, trackId, note.id, 1);
    const starts = filled.tracks
      .find((t) => t.id === trackId)!
      .notes.map((n) => n.startBeat)
      .sort((a, b) => a - b);
    expect(starts).toEqual(Array.from({ length: 16 }, (_, i) => i));
  });

  it('every 4 beats lands one per bar', () => {
    const { p, trackId, sectionId } = drumProject();
    const note = P.createNote(sectionId, 0, 1);
    const filled = P.repeatNoteEvenly(P.addNote(p, trackId, note), trackId, note.id, 4);
    const starts = filled.tracks.find((t) => t.id === trackId)!.notes.map((n) => n.startBeat);
    expect([...starts].sort((a, b) => a - b)).toEqual([0, 4, 8, 12]);
  });

  it('keeps the block’s own offset — a backbeat stays a backbeat', () => {
    const { p, trackId, sectionId } = drumProject();
    // On beat 3 of the bar (index 2), repeating every bar: 2, 6, 10, 14 —
    // the offbeat it was placed on, in every bar, not shunted onto the downbeat.
    const note = P.createNote(sectionId, 2, 1);
    const filled = P.repeatNoteEvenly(P.addNote(p, trackId, note), trackId, note.id, 4);
    const starts = filled.tracks.find((t) => t.id === trackId)!.notes.map((n) => n.startBeat);
    expect([...starts].sort((a, b) => a - b)).toEqual([2, 6, 10, 14]);
  });

  it('pressing it twice does not stack a second copy on every beat', () => {
    const { p, trackId, sectionId } = drumProject();
    const note = P.createNote(sectionId, 0, 1);
    const once = P.repeatNoteEvenly(P.addNote(p, trackId, note), trackId, note.id, 4);
    const twice = P.repeatNoteEvenly(once, trackId, note.id, 4);
    expect(twice).toBe(once); // nothing to add, so the same project back
  });

  it('leaves the song alone for a nonsense interval', () => {
    const { p, trackId, sectionId } = drumProject();
    const note = P.createNote(sectionId, 0, 1);
    const withNote = P.addNote(p, trackId, note);
    expect(P.repeatNoteEvenly(withNote, trackId, note.id, 0)).toBe(withNote);
  });
});

describe('alignNotes', () => {
  it('pulls off-beat blocks onto the nearest beat', () => {
    let p = P.createDefaultProject();
    const track = P.createTrackForVoice('kick');
    p = P.addTrack(p, track);
    const sectionId = p.arrangement[0].sectionId;
    const a = P.createNote(sectionId, 0.9, 1);
    const b = P.createNote(sectionId, 2.2, 1);
    p = P.addNote(P.addNote(p, track.id, a), track.id, b);
    const tidy = P.alignNotes(p, new Set([a.id, b.id]), 1);
    const notes = tidy.tracks.find((t) => t.id === track.id)!.notes;
    expect(notes.find((n) => n.id === a.id)!.startBeat).toBe(1);
    expect(notes.find((n) => n.id === b.id)!.startBeat).toBe(2);
  });

  it('returns the same project when everything is already on the beat', () => {
    let p = P.createDefaultProject();
    const track = P.createTrackForVoice('kick');
    p = P.addTrack(p, track);
    const note = P.createNote(p.arrangement[0].sectionId, 3, 1);
    p = P.addNote(p, track.id, note);
    expect(P.alignNotes(p, new Set([note.id]), 1)).toBe(p);
  });

  it('never pushes a block past the end of its part', () => {
    let p = P.createDefaultProject();
    const track = P.createTrackForVoice('kick');
    p = P.addTrack(p, track);
    const sectionId = p.arrangement[0].sectionId;
    const note = P.createNote(sectionId, 15.8, 1); // a 4-bar part ends at 16
    p = P.addNote(p, track.id, note);
    const tidy = P.alignNotes(p, new Set([note.id]), 1);
    expect(tidy.tracks.find((t) => t.id === track.id)!.notes[0].startBeat).toBe(15);
  });
});

describe('spreadNotes', () => {
  it('evens out the gaps, leaving the first and last where they were', () => {
    let p = P.createDefaultProject();
    const track = P.createTrackForVoice('kick');
    p = P.addTrack(p, track);
    const sectionId = p.arrangement[0].sectionId;
    const notes = [0, 1, 1.5, 12].map((b) => P.createNote(sectionId, b, 1));
    for (const n of notes) p = P.addNote(p, track.id, n);
    const spread = P.spreadNotes(p, new Set(notes.map((n) => n.id)));
    const starts = spread.tracks
      .find((t) => t.id === track.id)!
      .notes.map((n) => n.startBeat)
      .sort((a, b) => a - b);
    expect(starts).toEqual([0, 4, 8, 12]);
  });

  it('needs three blocks to mean anything', () => {
    let p = P.createDefaultProject();
    const track = P.createTrackForVoice('kick');
    p = P.addTrack(p, track);
    const sectionId = p.arrangement[0].sectionId;
    const a = P.createNote(sectionId, 0, 1);
    const b = P.createNote(sectionId, 5, 1);
    p = P.addNote(P.addNote(p, track.id, a), track.id, b);
    expect(P.spreadNotes(p, new Set([a.id, b.id]))).toBe(p);
  });
});

// ---- cutting up a recording ---------------------------------------------
//
// Cutting copies no audio: the second half points further into the same take.
// That offset is the whole feature, so these check the arithmetic on it.

describe('splitNote', () => {
  function voiceProject() {
    let p = P.createDefaultProject(); // 120bpm, so one beat is half a second
    const track = P.createAudioTrack();
    p = P.addTrack(p, track);
    const sectionId = p.arrangement[0].sectionId;
    // Eight beats of grid holding a four-second take.
    const note = P.createClipNote(sectionId, 0, 8, 'clip_1', 4);
    p = P.addNote(p, track.id, note);
    return { p, trackId: track.id, noteId: note.id, sectionId };
  }

  it('cuts into two blocks, the second starting further into the take', () => {
    const { p, trackId, noteId } = voiceProject();
    const cut = P.splitNote(p, trackId, noteId, 2); // two beats in = one second
    const notes = cut.tracks.find((t) => t.id === trackId)!.notes;
    expect(notes).toHaveLength(2);
    const head = notes.find((n) => n.id === noteId)!;
    const tail = notes.find((n) => n.id !== noteId)!;
    expect(head.startBeat).toBe(0);
    expect(head.lengthBeats).toBe(2);
    expect(head.clipStartSeconds).toBeUndefined(); // still from the beginning
    expect(tail.startBeat).toBe(2);
    expect(tail.lengthBeats).toBe(6);
    expect(tail.clipStartSeconds).toBeCloseTo(1, 6);
    expect(tail.clipId).toBe('clip_1'); // the same recording, not a copy
  });

  it('cutting a second time adds the offsets up', () => {
    const { p, trackId, noteId } = voiceProject();
    const once = P.splitNote(p, trackId, noteId, 2);
    const tailId = once.tracks
      .find((t) => t.id === trackId)!
      .notes.find((n) => n.id !== noteId)!.id;
    const twice = P.splitNote(once, trackId, tailId, 4); // two more beats in
    const last = twice.tracks
      .find((t) => t.id === trackId)!
      .notes.find((n) => n.startBeat === 4)!;
    expect(last.clipStartSeconds).toBeCloseTo(2, 6); // one second, then another
  });

  it('does nothing when the cut lands outside the block', () => {
    const { p, trackId, noteId } = voiceProject();
    expect(P.splitNote(p, trackId, noteId, 0)).toBe(p);
    expect(P.splitNote(p, trackId, noteId, 8)).toBe(p);
    expect(P.splitNote(p, trackId, noteId, 99)).toBe(p);
  });

  it('breaks the chain, so the halves do not keep each other’s length', () => {
    let { p, trackId, noteId } = voiceProject();
    const second = P.createClipNote(p.arrangement[0].sectionId, 8, 4, 'clip_1', 4);
    p = P.addNote(p, trackId, second);
    p = P.chainNotes(p, [noteId, second.id]);
    expect(p.tracks.find((t) => t.id === trackId)!.notes[0].groupId).toBeTruthy();
    const cut = P.splitNote(p, trackId, noteId, 2);
    const halves = cut.tracks
      .find((t) => t.id === trackId)!
      .notes.filter((n) => n.startBeat < 8);
    expect(halves).toHaveLength(2);
    expect(halves.every((n) => !n.groupId)).toBe(true);
  });
});

describe('duplicateNotes', () => {
  it('puts the copy straight after the original, carrying its clip offset', () => {
    let p = P.createDefaultProject();
    const track = P.createAudioTrack();
    p = P.addTrack(p, track);
    const sectionId = p.arrangement[0].sectionId;
    const note = P.createClipNote(sectionId, 2, 2, 'clip_1', 4, 1.5);
    p = P.addNote(p, track.id, note);
    const copied = P.duplicateNotes(p, new Set([note.id]));
    const notes = copied.tracks.find((t) => t.id === track.id)!.notes;
    expect(notes).toHaveLength(2);
    const copy = notes.find((n) => n.id !== note.id)!;
    expect(copy.startBeat).toBe(4);
    expect(copy.lengthBeats).toBe(2);
    expect(copy.clipId).toBe('clip_1');
    expect(copy.clipStartSeconds).toBe(1.5);
    expect(copy.id).not.toBe(note.id);
  });

  it('leaves out a copy with no room after it, rather than piling it at the end', () => {
    let p = P.createDefaultProject();
    const track = P.createTrackForVoice('kick');
    p = P.addTrack(p, track);
    // A 4-bar part is 16 beats; a block on the last beat has nowhere to go.
    const note = P.createNote(p.arrangement[0].sectionId, 15, 1);
    p = P.addNote(p, track.id, note);
    expect(P.duplicateNotes(p, new Set([note.id]))).toBe(p);
  });

  it('the copy is its own block, not a link in the original’s chain', () => {
    let p = P.createDefaultProject();
    const track = P.createTrackForVoice('kick');
    p = P.addTrack(p, track);
    const sectionId = p.arrangement[0].sectionId;
    const a = P.createNote(sectionId, 0, 1);
    const b = P.createNote(sectionId, 4, 1);
    p = P.addNote(P.addNote(p, track.id, a), track.id, b);
    p = P.chainNotes(p, [a.id, b.id]);
    const copied = P.duplicateNotes(p, new Set([a.id]));
    const copy = copied.tracks.find((t) => t.id === track.id)!.notes.find((n) => n.startBeat === 1)!;
    expect(copy.groupId).toBeUndefined();
  });
});

// ---- a place to sing, and filling it -------------------------------------

describe('createVoiceBlock', () => {
  it('is an ordinary block with no recording in it', () => {
    const p = P.createDefaultProject();
    const block = P.createVoiceBlock(p.arrangement[0].sectionId, 4);
    expect(block.clipId).toBeUndefined();
    expect(block.clipSeconds).toBeUndefined();
    expect(block.startBeat).toBe(4);
    expect(block.lengthBeats).toBeGreaterThan(0);
  });
});

describe('fillVoiceBlock', () => {
  function withPlace() {
    let p = P.createDefaultProject(); // 120bpm: one beat is half a second
    const track = P.createAudioTrack();
    p = P.addTrack(p, track);
    const block = P.createVoiceBlock(p.arrangement[0].sectionId, 4, 4);
    p = P.addNote(p, track.id, block);
    return { p, trackId: track.id, noteId: block.id };
  }

  it('puts the take into the block that was chosen, keeping its id and place', () => {
    const { p, trackId, noteId } = withPlace();
    const filled = P.fillVoiceBlock(p, trackId, noteId, 'clip_a', 3, 6);
    const notes = filled.tracks.find((t) => t.id === trackId)!.notes;
    expect(notes).toHaveLength(1); // filled, not joined by a second block
    expect(notes[0].id).toBe(noteId);
    expect(notes[0].startBeat).toBe(4); // still where it was put
    expect(notes[0].clipId).toBe('clip_a');
    expect(notes[0].clipSeconds).toBe(3);
    expect(notes[0].lengthBeats).toBe(6); // now as long as what was sung
  });

  it('recording again over a trimmed block starts the new take at its beginning', () => {
    // The block had been cut out of the middle of an older take, so it carried
    // an offset. Keeping that offset would play the new take from part-way in.
    let { p, trackId, noteId } = withPlace();
    p = P.fillVoiceBlock(p, trackId, noteId, 'clip_a', 8, 16);
    p = P.splitNote(p, trackId, noteId, 6);
    const tail = p.tracks.find((t) => t.id === trackId)!.notes.find((n) => n.id !== noteId)!;
    expect(tail.clipStartSeconds).toBeGreaterThan(0);

    const again = P.fillVoiceBlock(p, trackId, tail.id, 'clip_b', 2, 4);
    const after = again.tracks.find((t) => t.id === trackId)!.notes.find((n) => n.id === tail.id)!;
    expect(after.clipId).toBe('clip_b');
    expect(after.clipStartSeconds).toBeUndefined();
  });

  it('leaves the song alone when the block has gone', () => {
    const { p, trackId } = withPlace();
    expect(P.fillVoiceBlock(p, trackId, 'note_gone', 'clip_a', 1, 2)).toBe(p);
  });
});
