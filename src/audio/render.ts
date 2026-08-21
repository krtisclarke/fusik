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
import { getVoice, isPitched, resolveParams } from '../model/voices';
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

/**
 * How far past the end of the song its recordings run.
 *
 * A recording plays for as long as it was recorded, wherever it sits — so one
 * started near the end of a part carries on after the last beat. Without room
 * for that, an exported file cuts the child off mid-word, silently, while live
 * playback plays the whole thing.
 *
 * Measured as *clip end minus song end*. An earlier version compared the clip's
 * length against its own block, which is always the same number — the block is
 * created from the recording's length and rescaled with the tempo — so it was
 * always zero and the tail never grew.
 */
export function clipOverhangSeconds(
  project: Project,
  entries: { sectionId: string; startBeat: number; lengthBeats: number }[],
  beatsPerLoop: number,
  loops: number,
): number {
  const musicSeconds = beatsToSeconds(beatsPerLoop * loops, project.bpm);
  let overhang = 0;
  for (const track of project.tracks) {
    for (const note of track.notes) {
      if (!note.clipId || !note.clipSeconds) continue;
      for (const entry of entries) {
        if (entry.sectionId !== note.sectionId || note.startBeat >= entry.lengthBeats) continue;
        // The last pass is the one that runs latest.
        const startBeat = entry.startBeat + note.startBeat + (loops - 1) * beatsPerLoop;
        const endsAt = beatsToSeconds(startBeat, project.bpm) + note.clipSeconds;
        if (endsAt - musicSeconds > overhang) overhang = endsAt - musicSeconds;
      }
    }
  }
  return Math.max(0, overhang);
}

/** However long a block is asked to ring, the render won't wait past this. */
const MAX_VOICE_OVERHANG_SECONDS = 8;

/**
 * How far past the end of the song its *blocks* keep sounding.
 *
 * Measured the same way as `clipOverhangSeconds` above, and for the same
 * reason: a fixed tail was fine while every drum was synthesized and the
 * longest was a 1.3-second crash. A recorded crash rings for four seconds by
 * default, a child can take any drum to four with the Decay slider, and a
 * melodic block's right-hand edge can be dragged past the end of its part — all
 * of which live playback rings out and a fixed tail cut off mid-sound, with a
 * click, because the recording is still near full level there. An exported file
 * that isn't what the child heard is the one thing Export must never produce.
 *
 * A drum rings for its Decay however wide its block is; a melodic note rings for
 * its block plus its release. Recordings the child made are counted separately.
 */
export function voiceOverhangSeconds(
  project: Project,
  entries: { sectionId: string; startBeat: number; lengthBeats: number }[],
  beatsPerLoop: number,
  loops: number,
): number {
  const musicSeconds = beatsToSeconds(beatsPerLoop * loops, project.bpm);
  let overhang = 0;
  for (const track of project.tracks) {
    const voice = getVoice(track.instrument.voiceId);
    if (!voice) continue;
    const pitched = isPitched(voice);
    for (const note of track.notes) {
      if (note.clipId) continue;
      const params = resolveParams(track.instrument.voiceId, note.params);
      const rings = pitched
        ? beatsToSeconds(note.lengthBeats, project.bpm) + (params.release ?? 0)
        : params.decay ?? 0;
      for (const entry of entries) {
        if (entry.sectionId !== note.sectionId || note.startBeat >= entry.lengthBeats) continue;
        // The last pass is the one that runs latest.
        const startBeat = entry.startBeat + note.startBeat + (loops - 1) * beatsPerLoop;
        const endsAt = beatsToSeconds(startBeat, project.bpm) + rings;
        if (endsAt - musicSeconds > overhang) overhang = endsAt - musicSeconds;
      }
    }
  }
  return Math.min(Math.max(0, overhang), MAX_VOICE_OVERHANG_SECONDS);
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
  const tail =
    TAIL_SECONDS
    + echoSeconds
    + Math.max(
        clipOverhangSeconds(project, entries, beatsPerLoop, loops),
        voiceOverhangSeconds(project, entries, beatsPerLoop, loops),
      );
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
