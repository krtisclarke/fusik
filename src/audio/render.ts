// Render a whole project to an audio buffer, offline (faster than real time).
//
// This is the same sound path as live playback — every block through its voice,
// through per-track gain, through the master chain — but scheduled all at once
// into an OfflineAudioContext. That's what makes Export produce exactly what you
// hear. A short tail is added so reverbs and long decays ring out naturally.

import type { Project } from '../model/types';
import { beatsToSeconds, totalBeats } from '../model/time';
import { resolveParams } from '../model/voices';
import { createMasterChain } from './master';
import { getTrigger } from './synth';

const TAIL_SECONDS = 2.5;

export interface RenderOptions {
  /** How many times to repeat the song's bars. */
  loops?: number;
  sampleRate?: number;
}

export async function renderProject(project: Project, opts: RenderOptions = {}): Promise<AudioBuffer> {
  const loops = Math.max(1, Math.floor(opts.loops ?? 1));
  const sampleRate = opts.sampleRate ?? 44100;

  const beatsPerLoop = totalBeats(project.lengthBars, project.timeSignature);
  const musicSeconds = beatsToSeconds(beatsPerLoop * loops, project.bpm);
  const length = Math.max(1, Math.ceil((musicSeconds + TAIL_SECONDS) * sampleRate));

  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const master = createMasterChain(ctx);
  master.output.connect(ctx.destination);

  const anySolo = project.tracks.some((t) => t.solo);

  for (const track of project.tracks) {
    const gain = track.muted ? 0 : anySolo && !track.solo ? 0 : track.gain;
    if (gain <= 0) continue;

    const node = ctx.createGain();
    node.gain.value = gain;
    node.connect(master.input);

    const trigger = getTrigger(track.instrument.voiceId);
    for (const note of track.notes) {
      if (note.startBeat >= beatsPerLoop) continue;
      const params = resolveParams(track.instrument.voiceId, note.params);
      const durationSec = beatsToSeconds(note.lengthBeats, project.bpm);
      for (let k = 0; k < loops; k++) {
        const when = beatsToSeconds(note.startBeat + k * beatsPerLoop, project.bpm);
        trigger(ctx, node, when, params, note.velocity, { midi: note.pitch, durationSec });
      }
    }
  }

  return ctx.startRendering();
}
