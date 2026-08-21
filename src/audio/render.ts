// Render a whole project to an audio buffer, offline (faster than real time).
//
// This is the same sound path as live playback — every block through its voice,
// through per-track gain, through the master chain — but scheduled all at once
// into an OfflineAudioContext. That's what makes Export produce exactly what you
// hear. The full arrangement is rendered: each slot's section at its absolute
// position, so A A B A comes out as A A B A. A short tail is added so reverbs
// and long decays ring out naturally.

import type { Project } from '../model/types';
import { beatsToSeconds } from '../model/time';
import { resolveArrangement, songBeats } from '../model/arrange';
import { resolveParams } from '../model/voices';
import { createMasterChain } from './master';
import { createTrackChain } from './trackChain';
import { getTrigger } from './synth';

const TAIL_SECONDS = 2.5;

export interface RenderOptions {
  /** How many times to repeat the whole song. */
  loops?: number;
  sampleRate?: number;
}

export async function renderProject(project: Project, opts: RenderOptions = {}): Promise<AudioBuffer> {
  const loops = Math.max(1, Math.floor(opts.loops ?? 1));
  const sampleRate = opts.sampleRate ?? 44100;

  const entries = resolveArrangement(project);
  const beatsPerLoop = songBeats(project);
  const musicSeconds = beatsToSeconds(beatsPerLoop * loops, project.bpm);
  // Leave room for the last notes to ring out — and for echo repeats, which
  // outlast the note that made them, so a song ending on an echo doesn't get
  // its tail chopped off in the exported file.
  const echoSeconds = project.tracks.some((t) => t.echo > 0) ? (30 / Math.max(1, project.bpm)) * 8 : 0;
  const tail = TAIL_SECONDS + echoSeconds;
  const length = Math.max(1, Math.ceil((musicSeconds + tail) * sampleRate));

  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const master = createMasterChain(ctx);
  master.output.connect(ctx.destination);

  const anySolo = project.tracks.some((t) => t.solo);

  for (const track of project.tracks) {
    const gain = track.muted ? 0 : anySolo && !track.solo ? 0 : track.gain;
    if (gain <= 0) continue;

    // Same per-track chain as live playback (volume + its own echo), so the
    // exported file is what the child actually heard.
    const chain = createTrackChain(ctx, master.input);
    chain.gain.value = gain;
    chain.setEcho(track.echo, project.bpm);

    const trigger = getTrigger(track.instrument.voiceId);
    for (const note of track.notes) {
      const params = resolveParams(track.instrument.voiceId, note.params);
      const durationSec = beatsToSeconds(note.lengthBeats, project.bpm);
      for (const entry of entries) {
        if (entry.sectionId !== note.sectionId || note.startBeat >= entry.lengthBeats) continue;
        const baseBeat = entry.startBeat + note.startBeat;
        for (let k = 0; k < loops; k++) {
          const when = beatsToSeconds(baseBeat + k * beatsPerLoop, project.bpm);
          trigger(ctx, chain.input, when, params, note.velocity, { midi: note.pitch, durationSec });
        }
      }
    }
  }

  return ctx.startRendering();
}
