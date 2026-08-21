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
//
// Two play modes:
// - 'song'    — the arrangement start to finish: every slot's section at its
//               absolute position. Loop wraps the whole song.
// - 'section' — just the part being edited, looping. The editing workflow.

import type { Project, Track } from '../model/types';
import { secondsToBeats, beatsToSeconds, beatOccurrencesInWindow } from '../model/time';
import { resolveArrangement, sectionBeats, sectionById, songPositionAt } from '../model/arrange';
import { resolveParams } from '../model/voices';
import { getTrigger, startHeldNote, type HeldNote } from './synth';
import { getVoice, isPitched } from '../model/voices';
import { createMasterChain } from './master';
import { createTrackChain, type TrackChain } from './trackChain';

const LOOK_AHEAD_S = 0.1; // how far ahead we schedule
const TICK_MS = 25; // how often the scheduler wakes up
const START_LEAD_S = 0.06; // tiny delay before the first note so it isn't late
// Each scheduling window is (lo, hi] — half-open at the bottom so a note is
// never scheduled twice. That would drop a note sitting exactly on the beat we
// start from (the downbeat, every time you press Play), so the very first window
// starts a hair below it.
const START_EPSILON_BEATS = 1e-6;
/**
 * How far behind the scheduler may fall before it gives up on what it missed.
 * Comfortably longer than any normal hitch (it wakes every 25 ms), short enough
 * that a real stall never turns into a pile-up. See the stall guard in tick().
 */
const MAX_CATCHUP_S = 0.5;

export type PlayMode = 'song' | 'section';

export interface TransportSnapshot {
  isPlaying: boolean;
  isLooping: boolean;
  positionBeats: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private trackNodes = new Map<string, TrackChain>();

  private project: Project | null = null;

  private isPlaying = false;
  private looping = true;
  private pausedBeat = 0;
  private playMode: PlayMode = 'song';
  private editSectionId: string | null = null;

  // Mapping between musical beats and the audio clock for the current run.
  private startTime = 0; // ctx time that corresponds to startBeat
  private startBeat = 0;
  private lastScheduledBeat = 0; // exclusive lower bound already scheduled
  private lastPeriod: number | null = null; // loop length as of the last tick

  private timer: ReturnType<typeof setInterval> | null = null;

  // ---- context / master chain -------------------------------------------

  /** Create the AudioContext and master bus on first use (needs a user gesture). */
  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext({ latencyHint: 'interactive' });

    // Everything flows through the master chain (reverb + warmth + safety
    // limiter) on its way to the speakers. See audio/master.ts.
    const master = createMasterChain(ctx);
    master.output.connect(ctx.destination);

    this.ctx = ctx;
    this.masterGain = master.input;
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

  /** Which part the timeline is editing — what 'section' mode plays. */
  setEditSection(sectionId: string | null): void {
    this.editSectionId = sectionId;
  }

  /** Switching between whole-song and one-part playback resets the transport. */
  setPlayMode(mode: PlayMode): void {
    if (mode === this.playMode) return;
    this.stop();
    this.playMode = mode;
  }

  getPlayMode(): PlayMode {
    return this.playMode;
  }

  /** Ensure one chain per track and apply volume/mute/solo and echo. */
  private syncTrackNodes(project: Project): void {
    const ctx = this.ctx;
    const master = this.masterGain;
    if (!ctx || !master) return;

    const liveIds = new Set(project.tracks.map((t) => t.id));
    for (const [id, chain] of this.trackNodes) {
      if (!liveIds.has(id)) {
        chain.disconnect();
        this.trackNodes.delete(id);
      }
    }
    for (const track of project.tracks) {
      let chain = this.trackNodes.get(track.id);
      if (!chain) {
        chain = createTrackChain(ctx, master);
        this.trackNodes.set(track.id, chain);
      }
      chain.gain.value = this.effectiveGain(track, project.tracks);
      chain.setEcho(track.echo, project.bpm);
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

  /** What one full pass of the current mode spans, in beats. */
  private periodBeats(project: Project): number {
    if (this.playMode === 'section') {
      const section =
        (this.editSectionId && sectionById(project, this.editSectionId)) ||
        sectionById(project, project.arrangement[0]?.sectionId ?? '') ||
        project.sections[0];
      return section ? sectionBeats(section, project) : 0;
    }
    return resolveArrangement(project).reduce((sum, e) => sum + e.lengthBeats, 0);
  }

  /**
   * Current playhead position in beats (wrapped within the loop). In 'song'
   * mode this is absolute within the whole song; in 'section' mode it is
   * within the edited part.
   */
  getPositionBeats(): number {
    if (!this.project || !this.ctx || !this.isPlaying) return this.pausedBeat;
    const abs = this.beatAtTime(this.ctx.currentTime, this.project.bpm);
    const len = this.periodBeats(this.project);
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

  /**
   * Where the playhead sits *inside a given part*, or null when the playing
   * position is in some other part. Lets the timeline (which shows one part)
   * draw the playhead only when that part is actually sounding.
   */
  getPlayheadIn(sectionId: string): number | null {
    const project = this.project;
    if (!project) return null;
    const pos = this.getPositionBeats();
    if (this.playMode === 'section') {
      const editing = this.editSectionId ?? project.arrangement[0]?.sectionId;
      return editing === sectionId ? pos : null;
    }
    const at = songPositionAt(project, pos);
    if (!at) return sectionId === project.arrangement[0]?.sectionId ? 0 : null;
    return at.entry.sectionId === sectionId ? at.beatInSection : null;
  }

  /** Which arrangement slot is sounding right now (song mode + playing only). */
  getPlayingEntryIndex(): number | null {
    if (!this.project || !this.isPlaying || this.playMode !== 'song') return null;
    return songPositionAt(this.project, this.getPositionBeats())?.entryIndex ?? null;
  }

  // ---- transport ---------------------------------------------------------

  async play(fromBeat?: number): Promise<void> {
    if (!this.project) return;
    const ctx = await this.ensureRunning();
    if (this.isPlaying) return;

    const period = this.periodBeats(this.project);
    let from = fromBeat ?? this.pausedBeat;
    // The song may have got shorter while paused (a part shortened or taken
    // out), leaving the saved position past the end. Start over rather than
    // letting Play run straight off the end and produce nothing.
    if (period > 0 && from >= period) from = 0;

    this.isPlaying = true;
    this.startTime = ctx.currentTime + START_LEAD_S;
    this.startBeat = from;
    this.lastScheduledBeat = this.startBeat - START_EPSILON_BEATS;
    this.lastPeriod = period;
    this.syncTrackNodes(this.project);

    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  pause(): void {
    if (!this.isPlaying) return;
    this.pausedBeat = this.getPositionBeats();
    this.stopTimer();
    this.isPlaying = false;
    this.lastPeriod = null;
  }

  stop(): void {
    this.stopTimer();
    this.isPlaying = false;
    this.pausedBeat = 0;
    this.lastPeriod = null;
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

  /**
   * Everything schedulable this pass: each note of each playing slot, at its
   * absolute beat. In 'section' mode that's just the edited part's notes at
   * their own positions; in 'song' mode a note appears once per slot its
   * section occupies (A A B A plays A's notes three times per pass).
   */
  private *occurrences(
    project: Project,
    track: Track,
  ): Generator<{ note: Track['notes'][number]; baseBeat: number }> {
    if (this.playMode === 'section') {
      const editing =
        (this.editSectionId && sectionById(project, this.editSectionId)) ||
        sectionById(project, project.arrangement[0]?.sectionId ?? '') ||
        project.sections[0];
      if (!editing) return;
      const len = sectionBeats(editing, project);
      for (const note of track.notes) {
        if (note.sectionId !== editing.id || note.startBeat >= len) continue;
        yield { note, baseBeat: note.startBeat };
      }
      return;
    }
    const entries = resolveArrangement(project);
    for (const note of track.notes) {
      for (const entry of entries) {
        if (entry.sectionId !== note.sectionId || note.startBeat >= entry.lengthBeats) continue;
        yield { note, baseBeat: entry.startBeat + note.startBeat };
      }
    }
  }

  /**
   * Keep the playhead where it is when the loop length changes underneath it —
   * a part made longer or shorter, a part added or removed, the song reordered,
   * all of which are normal things to do *while it plays*. The transport counts
   * absolute beats and wraps them by the loop length, so without this the
   * wrapped position would jump somewhere unrelated (and take a chunk of silence
   * with it). Re-anchoring keeps the same wrapped position and the same
   * already-scheduled horizon, so nothing is heard twice.
   */
  private reanchorForPeriodChange(): void {
    const project = this.project;
    const ctx = this.ctx;
    if (!project || !ctx || !this.isPlaying) return;

    const period = this.periodBeats(project);
    const previous = this.lastPeriod;
    this.lastPeriod = period;
    if (previous == null || period === previous) return;
    if (!this.looping || previous <= 0 || period <= 0) return;

    const now = ctx.currentTime;
    const abs = this.beatAtTime(now, project.bpm);
    const wrapped = ((abs % previous) + previous) % previous;
    const position = ((wrapped % period) + period) % period;
    const scheduledAhead = Math.max(0, this.lastScheduledBeat - abs);

    this.startTime = now;
    this.startBeat = position;
    this.lastScheduledBeat = position + scheduledAhead;
  }

  private tick(): void {
    const ctx = this.ctx;
    const project = this.project;
    if (!ctx || !project || !this.isPlaying) return;

    this.reanchorForPeriodChange();

    const bpm = project.bpm;
    const now = ctx.currentTime;
    const horizonBeat = this.beatAtTime(now + LOOK_AHEAD_S, bpm);
    const len = this.periodBeats(project);

    // Non-looping playback: stop once we've passed the end.
    if (!this.looping && this.beatAtTime(now, bpm) >= len) {
      this.stop();
      return;
    }

    let lo = this.lastScheduledBeat;
    const hi = horizonBeat;

    // The scheduler couldn't run for a while — a dialog blocking the main
    // thread, a backgrounded tab, a machine under load. The audio clock kept
    // going without it, so this window now spans everything that was missed.
    // Every one of those notes is already in the past, and the `Math.max(when,
    // now)` below would clamp the lot onto this single instant: seconds of
    // drums as one blast. On a kids' app that is an ear-safety problem rather
    // than a timing one, and the limiter only caps its peak. Their moment has
    // gone, so skip to the present — silence across the gap, then the song from
    // where it has actually got to.
    if (beatsToSeconds(hi - lo, bpm) - LOOK_AHEAD_S > MAX_CATCHUP_S) {
      lo = this.beatAtTime(now, bpm) - START_EPSILON_BEATS;
    }

    const period = this.looping ? len : Infinity;

    for (const track of project.tracks) {
      const chain = this.trackNodes.get(track.id);
      if (!chain) continue;
      // Re-apply gain each tick so mute/solo/volume edits take effect live.
      chain.gain.setTargetAtTime(this.effectiveGain(track, project.tracks), now, 0.01);
      if (this.effectiveGain(track, project.tracks) <= 0) continue;

      const trigger = getTrigger(track.instrument.voiceId);

      for (const { note, baseBeat } of this.occurrences(project, track)) {
        if (period !== Infinity && baseBeat >= period) continue;
        const params = resolveParams(track.instrument.voiceId, note.params); // each block its own sound
        const durationSec = beatsToSeconds(note.lengthBeats, bpm);
        for (const absBeat of beatOccurrencesInWindow(lo, hi, baseBeat, period)) {
          const when = this.timeAtBeat(absBeat, bpm);
          trigger(ctx, chain.input, Math.max(when, now), params, note.velocity, {
            midi: note.pitch,
            durationSec,
          });
        }
      }
    }

    this.lastScheduledBeat = hi;
  }

  // ---- one-shot preview --------------------------------------------------

  // ---- live playing (the keyboard) ---------------------------------------
  //
  // Notes played by hand, outside the timeline. A melodic voice is held open
  // until the key comes back up; a drum has nothing to hold, so it just fires.

  private held = new Map<number, HeldNote>();
  private nextHeldId = 1;

  /**
   * Where a hand-played note should go: the chain of the track that owns this
   * voice, so playing a Piano with the Piano row's echo turned up sounds like
   * the Piano row — with its echo, its volume, its mute. Falling straight to the
   * master would make the Echo slider look broken for the most direct "play it
   * and hear it" thing in the app, and would mean a recorded take sounded dry
   * while playing and drenched the moment it came round again.
   */
  private destinationForVoice(voiceId: string): AudioNode | null {
    const track = this.project?.tracks.find((t) => t.instrument.voiceId === voiceId);
    const chain = track ? this.trackNodes.get(track.id) : undefined;
    return chain?.input ?? this.masterGain;
  }

  /**
   * Start a note now and keep it sounding. Returns a handle to pass to
   * `noteOff`. Safe to call before any audio exists — it starts the context.
   */
  async noteOn(
    voiceId: string,
    midi: number,
    overrides: Record<string, number> = {},
    velocity = 0.85,
  ): Promise<number> {
    const ctx = await this.ensureRunning();
    const dest = this.destinationForVoice(voiceId);
    if (!dest) return 0;
    const params = resolveParams(voiceId, overrides);
    const id = this.nextHeldId++;

    if (!isPitched(getVoice(voiceId))) {
      getTrigger(voiceId)(ctx, dest, ctx.currentTime, params, velocity, {
        durationSec: 0.5,
      });
      return id; // nothing to hold; noteOff is a no-op for this id
    }
    this.held.set(id, startHeldNote(ctx, dest, ctx.currentTime, params, velocity, midi));
    return id;
  }

  /** Let a held note go. Unknown or already-released handles are ignored. */
  noteOff(id: number): void {
    const note = this.held.get(id);
    if (!note) return;
    this.held.delete(id);
    note.release();
  }

  /** Let go of everything — for losing focus, or closing the keyboard. */
  releaseAllHeld(): void {
    for (const note of this.held.values()) note.release();
    this.held.clear();
  }

  /** Play a voice immediately — used for click/drag "hear it now" feedback.
   *  `midi` sets the pitch for melodic voices (ignored by drums). */
  async audition(
    voiceId: string,
    overrides: Record<string, number> = {},
    velocity = 0.9,
    midi?: number,
  ): Promise<void> {
    const ctx = await this.ensureRunning();
    const dest = this.destinationForVoice(voiceId);
    if (!dest) return;
    const trigger = getTrigger(voiceId);
    const params = resolveParams(voiceId, overrides);
    trigger(ctx, dest, ctx.currentTime + 0.02, params, velocity, { midi, durationSec: 0.5 });
  }

  dispose(): void {
    this.stopTimer();
    this.held.clear();
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
