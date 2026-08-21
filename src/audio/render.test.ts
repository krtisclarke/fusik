import { describe, it, expect } from 'vitest';
import { clipOverhangSeconds } from './render';
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
