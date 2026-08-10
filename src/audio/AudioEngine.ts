// The real-time audio engine: transport, scheduling, and the master output.
//
// Timing strategy (the important bit): the Web Audio clock is sample-accurate,
// but JavaScript timers are not. So we never rely on a timer to play a note *at*
// the right moment. Instead a coarse timer (~every 25ms) looks ~100ms into the
// future and hands every note in that window to Web Audio with an exact start
// time. Web Audio then plays them precisely. This is the standard "two clocks"
// approach and it keeps rhythm tight no matter what the UI is doing.
//
// The engine reads the current project fresh on every tick, so edits made while
// the song plays are heard on the very next loop — that immediate "change it,
// hear it" feedback is the whole point of the app.

import type { Project, Track } from '../model/types';
import { secondsToBeats, beatsToSeconds, totalBeats } from '../model/time';
import { resolveParams } from '../model/voices';
import { getTrigger } from './synth';

const LOOK_AHEAD_S = 0.1; // how far ahead we schedule
const TICK_MS = 25; // how often the scheduler wakes up
const START_LEAD_S = 0.06; // tiny delay before the first note so it isn't late

export interface TransportSnapshot {
  isPlaying: boolean;
  isLooping: boolean;
  positionBeats: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private trackNodes = new Map<string, GainNode>();

  private project: Project | null = null;

  private isPlaying = false;
  private looping = true;
  private pausedBeat = 0;

  // Mapping between musical beats and the audio clock for the current run.
  private startTime = 0; // ctx time that corresponds to startBeat
  private startBeat = 0;
  private lastScheduledBeat = 0; // exclusive lower bound already scheduled

  private timer: ReturnType<typeof setInterval> | null = null;

  // ---- context / master chain -------------------------------------------

  /** Create the AudioContext and master bus on first use (needs a user gesture). */
  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext({ latencyHint: 'interactive' });

    // Master chain: everything -> masterGain -> limiter -> speakers.
    // The limiter is a safety brickwall so stacked sounds can never produce a
    // runaway, speaker-or-ear-damaging peak.
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.9;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;

    masterGain.connect(limiter);
    limiter.connect(ctx.destination);

    this.ctx = ctx;
    this.masterGain = masterGain;
    if (this.project) this.syncTrackNodes(this.project);
    return ctx;
  }

  private async ensureRunning(): Promise<AudioContext> {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') await ctx.resume();
    return ctx;
  }

  // ---- project wiring ----------------------------------------------------

  setProject(project: Project): void {
    const prev = this.project;
    // If tempo changes mid-play, re-anchor the beat/time mapping so playback
    // continues smoothly at the new speed instead of jumping.
    if (prev && this.isPlaying && this.ctx && prev.bpm !== project.bpm) {
      const now = this.ctx.currentTime;
      const currentBeat = this.beatAtTime(now, prev.bpm);
      this.project = project;
      this.startBeat = currentBeat;
      this.startTime = now;
    } else {
      this.project = project;
    }
    if (this.ctx) this.syncTrackNodes(project);
  }

  /** Ensure one gain node per track and apply volume/mute/solo. */
  private syncTrackNodes(project: Project): void {
    const ctx = this.ctx;
    const master = this.masterGain;
    if (!ctx || !master) return;

    const liveIds = new Set(project.tracks.map((t) => t.id));
    for (const [id, node] of this.trackNodes) {
      if (!liveIds.has(id)) {
        node.disconnect();
        this.trackNodes.delete(id);
      }
    }
    for (const track of project.tracks) {
      let node = this.trackNodes.get(track.id);
      if (!node) {
        node = ctx.createGain();
        node.connect(master);
        this.trackNodes.set(track.id, node);
      }
      node.gain.value = this.effectiveGain(track, project.tracks);
    }
  }

  private effectiveGain(track: Track, tracks: Track[]): number {
    if (track.muted) return 0;
    const anySolo = tracks.some((t) => t.solo);
    if (anySolo && !track.solo) return 0;
    return track.gain;
  }

  // ---- beat <-> time -----------------------------------------------------

  private beatAtTime(t: number, bpm: number): number {
    return this.startBeat + secondsToBeats(t - this.startTime, bpm);
  }

  private timeAtBeat(beat: number, bpm: number): number {
    return this.startTime + beatsToSeconds(beat - this.startBeat, bpm);
  }

  /** Current playhead position in beats (wrapped within the loop). */
  getPositionBeats(): number {
    if (!this.project || !this.ctx || !this.isPlaying) return this.pausedBeat;
    const abs = this.beatAtTime(this.ctx.currentTime, this.project.bpm);
    const len = totalBeats(this.project.lengthBars, this.project.timeSignature);
    if (this.looping && len > 0) return ((abs % len) + len) % len;
    return Math.max(0, Math.min(abs, len));
  }

  getTransport(): TransportSnapshot {
    return {
      isPlaying: this.isPlaying,
      isLooping: this.looping,
      positionBeats: this.getPositionBeats(),
    };
  }

  // ---- transport ---------------------------------------------------------

  async play(fromBeat?: number): Promise<void> {
    if (!this.project) return;
    const ctx = await this.ensureRunning();
    if (this.isPlaying) return;

    this.isPlaying = true;
    this.startTime = ctx.currentTime + START_LEAD_S;
    this.startBeat = fromBeat ?? this.pausedBeat;
    this.lastScheduledBeat = this.startBeat;
    this.syncTrackNodes(this.project);

    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  pause(): void {
    if (!this.isPlaying) return;
    this.pausedBeat = this.getPositionBeats();
    this.stopTimer();
    this.isPlaying = false;
  }

  stop(): void {
    this.stopTimer();
    this.isPlaying = false;
    this.pausedBeat = 0;
  }

  setLooping(looping: boolean): void {
    this.looping = looping;
  }

  isLoopingOn(): boolean {
    return this.looping;
  }

  private stopTimer(): void {
    if (this.timer != null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ---- the scheduler -----------------------------------------------------

  private tick(): void {
    const ctx = this.ctx;
    const project = this.project;
    if (!ctx || !project || !this.isPlaying) return;

    const bpm = project.bpm;
    const now = ctx.currentTime;
    const horizonBeat = this.beatAtTime(now + LOOK_AHEAD_S, bpm);
    const len = totalBeats(project.lengthBars, project.timeSignature);

    // Non-looping playback: stop once we've passed the end.
    if (!this.looping && this.beatAtTime(now, bpm) >= len) {
      this.stop();
      return;
    }

    const lo = this.lastScheduledBeat;
    const hi = horizonBeat;
    const period = this.looping ? len : Infinity;

    for (const track of project.tracks) {
      const node = this.trackNodes.get(track.id);
      if (!node) continue;
      // Re-apply gain each tick so mute/solo/volume edits take effect live.
      node.gain.setTargetAtTime(this.effectiveGain(track, project.tracks), now, 0.01);
      if (this.effectiveGain(track, project.tracks) <= 0) continue;

      const trigger = getTrigger(track.instrument.voiceId);
      const params = resolveParams(track.instrument.voiceId, track.instrument.params);

      for (const note of track.notes) {
        if (period !== Infinity && note.startBeat >= period) continue;
        this.forEachOccurrence(lo, hi, note.startBeat, period, (absBeat) => {
          const when = this.timeAtBeat(absBeat, bpm);
          trigger(ctx, node, Math.max(when, now), params, note.velocity);
        });
      }
    }

    this.lastScheduledBeat = hi;
  }

  /** Call `cb` for each occurrence of `base` (repeating every `period`) in (lo, hi]. */
  private forEachOccurrence(
    lo: number,
    hi: number,
    base: number,
    period: number,
    cb: (beat: number) => void,
  ): void {
    if (period === Infinity) {
      if (base > lo && base <= hi) cb(base);
      return;
    }
    if (period <= 0) return;
    const k0 = Math.max(0, Math.ceil((lo - base) / period));
    for (let k = k0; ; k++) {
      const beat = base + k * period;
      if (beat > hi) break;
      if (beat > lo) cb(beat);
    }
  }

  // ---- one-shot preview --------------------------------------------------

  /** Play a voice immediately — used for click/drag "hear it now" feedback. */
  async audition(voiceId: string, overrides: Record<string, number> = {}, velocity = 0.9): Promise<void> {
    const ctx = await this.ensureRunning();
    if (!this.masterGain) return;
    const trigger = getTrigger(voiceId);
    const params = resolveParams(voiceId, overrides);
    trigger(ctx, this.masterGain, ctx.currentTime + 0.02, params, velocity);
  }

  dispose(): void {
    this.stopTimer();
    this.ctx?.close();
    this.ctx = null;
  }
}

// A single shared engine for the app.
export const engine = new AudioEngine();

// During development, tear the engine down when this module is hot-swapped so we
// never leave a zombie AudioContext playing in the background. No effect in prod.
if (import.meta.hot) {
  import.meta.hot.dispose(() => engine.dispose());
}
