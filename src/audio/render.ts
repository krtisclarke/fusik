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
  /**
   * The song's recordings, decoded, by clip id. Without these an exported file
   * would come out with the child's voice silently missing — the one part of
   * the song the app can't rebuild from numbers.
   */
  clips?: Map<string, AudioBuffer>;
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
  // A recording near the end of a part can run past the end of the song — it
  // plays for as long as it was recorded, whatever the grid says. Without room
  // for that, an exported file would cut a child off mid-word.
  let clipOverhang = 0;
  for (const track of project.tracks) {
    for (const note of track.notes) {
      if (!note.clipId || !note.clipSeconds) continue;
      const beyond = note.clipSeconds - beatsToSeconds(note.lengthBeats, project.bpm);
      if (beyond > clipOverhang) clipOverhang = beyond;
    }
  }
  const tail = TAIL_SECONDS + echoSeconds + Math.max(0, clipOverhang);
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
      const clip = note.clipId ? opts.clips?.get(note.clipId) : undefined;
      const params = clip ? {} : resolveParams(track.instrument.voiceId, note.params);
      const durationSec = beatsToSeconds(note.lengthBeats, project.bpm);
      for (const entry of entries) {
        if (entry.sectionId !== note.sectionId || note.startBeat >= entry.lengthBeats) continue;
        const baseBeat = entry.startBeat + note.startBeat;
        for (let k = 0; k < loops; k++) {
          const when = beatsToSeconds(baseBeat + k * beatsPerLoop, project.bpm);
          if (note.clipId) {
            // A recording plays back rather than being built. Through the same
            // track chain as everything else, so it gets the same volume, echo
            // and — via the master — the same limiter.
            if (!clip) continue;
            const source = ctx.createBufferSource();
            source.buffer = clip;
            const level = ctx.createGain();
            level.gain.value = note.velocity;
            source.connect(level).connect(chain.input);
            source.start(when);
            continue;
          }
          trigger(ctx, chain.input, when, params, note.velocity, { midi: note.pitch, durationSec });
        }
      }
    }
  }

  return ctx.startRendering();
}
