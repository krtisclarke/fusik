import { describe, it, expect } from 'vitest';
import {
  createDefaultProject,
  createNote,
  addNote,
  removeNote,
  updateNote,
  moveNote,
  setBpm,
  setLengthBars,
  toggleTrackMuted,
  findTrackByVoice,
  setTrackParam,
  resetTrackParams,
} from './project';

describe('default project', () => {
  it('comes with kick, snare and hi-hat ready to go', () => {
    const p = createDefaultProject();
    expect(p.bpm).toBe(120);
    expect(p.tracks.map((t) => t.instrument.voiceId)).toEqual(['kick', 'snare', 'hihat']);
    expect(p.tracks.every((t) => t.notes.length === 0)).toBe(true);
  });
});

describe('note edits are immutable', () => {
  it('adds a note without mutating the original project', () => {
    const p = createDefaultProject();
    const trackId = p.tracks[0].id;
    const p2 = addNote(p, trackId, createNote(0));
    expect(p.tracks[0].notes).toHaveLength(0); // original untouched
    expect(p2.tracks[0].notes).toHaveLength(1);
  });

  it('removes a note', () => {
    let p = createDefaultProject();
    const trackId = p.tracks[0].id;
    const note = createNote(1);
    p = addNote(p, trackId, note);
    p = removeNote(p, trackId, note.id);
    expect(p.tracks[0].notes).toHaveLength(0);
  });

  it('updates and clamps a note', () => {
    let p = createDefaultProject();
    const trackId = p.tracks[0].id;
    const note = createNote(1);
    p = addNote(p, trackId, note);
    p = updateNote(p, trackId, note.id, { velocity: 9, startBeat: -2 });
    expect(p.tracks[0].notes[0].velocity).toBe(1);
    expect(p.tracks[0].notes[0].startBeat).toBe(0);
  });

  it('moves a note between tracks', () => {
    let p = createDefaultProject();
    const from = p.tracks[0].id;
    const to = p.tracks[1].id;
    const note = createNote(0);
    p = addNote(p, from, note);
    p = moveNote(p, from, note.id, to, 3);
    expect(p.tracks[0].notes).toHaveLength(0);
    expect(p.tracks[1].notes[0].startBeat).toBe(3);
  });
});

describe('song settings', () => {
  it('clamps tempo to a sane range', () => {
    expect(setBpm(createDefaultProject(), 5).bpm).toBe(20);
    expect(setBpm(createDefaultProject(), 9000).bpm).toBe(300);
  });

  it('clamps song length', () => {
    expect(setLengthBars(createDefaultProject(), 0).lengthBars).toBe(1);
  });

  it('toggles mute', () => {
    const p = createDefaultProject();
    const id = p.tracks[0].id;
    expect(toggleTrackMuted(p, id).tracks[0].muted).toBe(true);
  });
});

describe('lookups', () => {
  it('finds a track by its voice', () => {
    const p = createDefaultProject();
    expect(findTrackByVoice(p, 'snare')?.instrument.voiceId).toBe('snare');
    expect(findTrackByVoice(p, 'nope')).toBeUndefined();
  });
});

describe('sound parameter edits', () => {
  it('sets an override without mutating the original', () => {
    const p = createDefaultProject();
    const id = p.tracks[0].id;
    const p2 = setTrackParam(p, id, 'decay', 0.9);
    expect(p.tracks[0].instrument.params).toEqual({}); // original untouched
    expect(p2.tracks[0].instrument.params.decay).toBe(0.9);
  });

  it('keeps existing overrides when setting another', () => {
    let p = createDefaultProject();
    const id = p.tracks[0].id;
    p = setTrackParam(p, id, 'decay', 0.9);
    p = setTrackParam(p, id, 'gain', 0.5);
    expect(p.tracks[0].instrument.params).toEqual({ decay: 0.9, gain: 0.5 });
  });

  it('resets all overrides back to defaults', () => {
    let p = createDefaultProject();
    const id = p.tracks[0].id;
    p = setTrackParam(p, id, 'decay', 0.9);
    p = resetTrackParams(p, id);
    expect(p.tracks[0].instrument.params).toEqual({});
  });
});
