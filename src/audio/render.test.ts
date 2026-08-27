import { describe, it, expect } from 'vitest';
import { clipOverhangSeconds, voiceOverhangSeconds } from './render';
import * as P from '../model/project';
import type { Project } from '../model/types';
import { resolveArrangement, songBeats } from '../model/arrange';
import { secondsToBeats } from '../model/time';

/** A song of one 4-bar part (16 beats = 8s at 120bpm) with one recording in it. */
function songWithRecording(startBeat: number, clipSeconds: number) {
  let project = P.createDefaultProject();
  const track = P.createAudioTrack();
  project = P.addTrack(project, track);
  // The block's length always describes the recording, exactly as recording does.
  const lengthBeats = secondsToBeats(clipSeconds, project.bpm);
  project = P.addNote(
    project,
    track.id,
    P.createClipNote(project.sections[0].id, startBeat, lengthBeats, 'clip_1', clipSeconds),
  );
  return project;
}

const overhang = (project: Project, loops = 1) =>
  clipOverhangSeconds(project, resolveArrangement(project), songBeats(project), loops);

describe('room for a recording that runs past the end', () => {
  it('is nothing when the recording finishes inside the song', () => {
    // 2 seconds starting at the very beginning of an 8-second song.
    expect(overhang(songWithRecording(0, 2))).toBe(0);
  });

  // The bug this exists for: the old measure compared the recording against its
  // own block, and a block is *made* from the recording's length — so it was
  // always zero and an exported file cut the child off mid-word.
  it('covers a long take in a short song', () => {
    // 20 seconds of singing in an 8-second song.
    expect(overhang(songWithRecording(0, 20))).toBeCloseTo(12, 3);
  });

  it('counts where the recording starts, not just how long it is', () => {
    // 4 seconds, but starting at beat 12 of 16 — so it ends at 6s + 4s = 10s.
    expect(overhang(songWithRecording(12, 4))).toBeCloseTo(2, 3);
  });

  it('measures from the last time round, when the song repeats', () => {
    const project = songWithRecording(12, 4);
    // Two passes: 16s of music, the last copy starting at 14s and ending at 18s.
    expect(overhang(project, 2)).toBeCloseTo(2, 3);
  });

  it('ignores ordinary blocks, which end themselves', () => {
    let project = P.createDefaultProject();
    project = P.addNote(project, project.tracks[0].id, P.createNote(project.sections[0].id, 15, 40));
    expect(overhang(project)).toBe(0);
  });

  it('is never negative', () => {
    expect(overhang(songWithRecording(0, 0.1))).toBe(0);
  });
});

describe('voiceOverhangSeconds', () => {
  /** One 4-bar part at 120 bpm — 16 beats, 8 seconds — with one block in it. */
  function songWith(voiceId: string, opts: { startBeat?: number; lengthBeats?: number; params?: Record<string, number>; pitch?: number } = {}) {
    let project = P.createDefaultProject();
    const track = P.createTrackForVoice(voiceId);
    project = P.addTrack(project, track);
    return P.addNote(project, track.id, {
      id: 'note_overhang',
      sectionId: project.sections[0].id,
      startBeat: opts.startBeat ?? 15,
      lengthBeats: opts.lengthBeats ?? 1,
      velocity: 0.8,
      pitch: opts.pitch,
      params: opts.params ?? {},
    });
  }
  const overhang = (project: Project) =>
    voiceOverhangSeconds(project, resolveArrangement(project), songBeats(project), 1);

  it('waits for a cymbal on the last beat that rings for four seconds', () => {
    // A fixed 2.5-second tail was fine while the longest drum was a 1.3-second
    // synthesized crash. A recorded crash rings for four, and the export cut it
    // off mid-ring — with a click, because the recording is still near full
    // level there. Live playback rang it out, so the file was not what the child
    // heard, which is the one thing Export must never be.
    expect(overhang(songWith('crash'))).toBeCloseTo(3.5, 2);
  });

  it('follows the block\'s own Decay, not the voice\'s default', () => {
    expect(overhang(songWith('hihat', { params: { decay: 3.5 } }))).toBeCloseTo(3, 2);
  });

  it('waits for a melodic block dragged past the end of its part', () => {
    // A block's right-hand edge can be dragged anywhere; nothing clamps it to
    // the part. Counting only drums left this one truncated.
    const project = songWith('synth', { startBeat: 8, lengthBeats: 16, pitch: 72 });
    expect(overhang(project)).toBeGreaterThan(4);
  });

  it('asks for nothing when everything finishes inside the song', () => {
    expect(overhang(songWith('perc', { startBeat: 0, params: { decay: 0.2 } }))).toBe(0);
  });

  it('refuses to wait forever', () => {
    expect(overhang(songWith('crash', { params: { decay: 500 } }))).toBe(8);
  });
});

// A block cut out of a take sounds only its own slice, and the export has to
// agree with playback about where that slice ends — otherwise the two halves
// of a cut line overlap each other in the exported file and nowhere else.
describe('room for a recording that has been cut up', () => {
  it('measures from where the block points into the take, not from its start', () => {
    let project = P.createDefaultProject();
    const track = P.createAudioTrack();
    project = P.addTrack(project, track);
    // The tail of a 20-second take, entered 18 seconds in, so only 2 seconds
    // of audio are left — placed at the very end of the 8-second song.
    project = P.addNote(
      project,
      track.id,
      P.createClipNote(project.sections[0].id, 14, 4, 'clip_1', 20, 18),
    );
    // 14 beats in is 7s; 2 seconds of audio left; song is 8s. So 1s over.
    expect(overhang(project)).toBeCloseTo(1, 3);
  });

  it('never claims more room than the block occupies on the grid', () => {
    let project = P.createDefaultProject();
    const track = P.createAudioTrack();
    project = P.addTrack(project, track);
    // A 20-second take squeezed into one beat at the end of the song. Playback
    // stops it at the block's edge, so the export must not ring on for 20s.
    project = P.addNote(
      project,
      track.id,
      P.createClipNote(project.sections[0].id, 15, 1, 'clip_1', 20),
    );
    // 15 beats is 7.5s, plus half a second of block = 8s, exactly the song.
    expect(overhang(project)).toBeCloseTo(0, 3);
  });
});

// A place to sing that hasn't been sung in yet must be silent — in the export
// as much as in playback. The stand-in voice for an unrecognised id is a
// percussion hit, so an empty voice block left in the song would otherwise
// clap once a bar in the exported file.
describe('a place to sing that is still empty', () => {
  it('asks for no room past the end of the song', () => {
    let project = P.createDefaultProject();
    const track = P.createAudioTrack();
    project = P.addTrack(project, track);
    project = P.addNote(project, track.id, P.createVoiceBlock(project.sections[0].id, 14, 8));
    expect(overhang(project)).toBe(0);
  });
});
