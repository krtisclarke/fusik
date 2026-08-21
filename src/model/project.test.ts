import { describe, it, expect } from 'vitest';
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
