// Playing recordings instead of building sounds.
//
// A synthesised voice makes a fresh sound for every note. A sampled voice plays
// a recording of a real instrument and stretches it to the note asked for. That
// one difference drives everything here:
//
// - **Several recordings per instrument.** Stretching is done by playing the
//   recording faster or slower, and past a couple of semitones that stops
//   sounding like the same instrument and starts sounding like a cartoon. So a
//   piano is thirty-odd recordings across the keyboard and the engine picks the
//   nearest.
// - **Several recordings per note.** How hard a piano is struck changes its
//   tone, not just its loudness, so each note is recorded two or three times at
//   different strengths and the strike picks between them.
// - **The recordings have to arrive first.** They are files, fetched and decoded
//   at startup. Until a voice's recordings are in, its notes fall back to the
//   synthesised version rather than falling silent.
//
// What survives from the synthesised voices is the shaping: brightness, drive,
// attack, and how long it rings are all still real controls, applied to the
// recording on its way out. What doesn't survive is anything about how the sound
// was *built* — waveform and detune mean nothing here, and the Sound Editor
// leaves them out rather than showing dead sliders.

import { getSampleSet, type SampleRegion, type SampleSet } from '../model/sampleSets';
import type { HeldNote, NotePlayback } from './synth';

const EPS = 0.0001;

/** Decoded recordings, keyed `${setId}/${file}`. */
const buffers = new Map<string, AudioBuffer>();

/** Which take each note last used, so a repeated hit doesn't repeat exactly. */
const lastTake = new Map<string, number>();

const key = (setId: string, file: string) => `${setId}/${file}`;

/** Hand the sampler a decoded recording. */
export function setSample(setId: string, file: string, buffer: AudioBuffer): void {
  buffers.set(key(setId, file), buffer);
}

/** Whether every recording a voice needs has arrived. */
export function sampleSetReady(setId: string): boolean {
  const set = getSampleSet(setId);
  if (!set) return false;
  return set.regions.every((r) => buffers.has(key(setId, r.f)));
}

/** One decoded recording, by set and file name. For tests and measurement. */
export function sampleBuffer(setId: string, file: string): AudioBuffer | undefined {
  return buffers.get(key(setId, file));
}

/** Every file a set needs, for whatever is doing the loading. */
export function sampleSetFiles(setId: string): string[] {
  return getSampleSet(setId)?.regions.map((r) => r.f) ?? [];
}

/** Forget everything. Tests only — the app loads once and keeps them. */
export function clearSamples(): void {
  buffers.clear();
  lastTake.clear();
}

/**
 * Decode a recording without needing a user gesture.
 *
 * A live `AudioContext` can't be started until the child clicks something, but
 * the recordings should be ready *before* the first click, or the first drum
 * they place is the one that doesn't sound right. An `OfflineAudioContext`
 * needs no gesture, and an `AudioBuffer` isn't tied to the context that made it
 * — so this decodes them early and the live engine plays them later.
 */
let decoder: OfflineAudioContext | null = null;
export function decodeSample(bytes: ArrayBuffer): Promise<AudioBuffer> {
  if (!decoder) decoder = new OfflineAudioContext(1, 1, 44100);
  return decoder.decodeAudioData(bytes);
}

// ---- choosing a recording -------------------------------------------------

/**
 * The recording to play for this note, this hard.
 *
 * Strength first, then nearest note: a hard strike must not quietly become a
 * soft recording just because the soft one was sampled closer by. Where a note
 * was recorded more than once at the same strength, the takes alternate.
 */
export function chooseRegion(set: SampleSet, midi: number, velocity: number): SampleRegion | undefined {
  if (!set.regions.length) return undefined;
  // Bands are half-open, [lo, hi), and tile 0..1 exactly — so every strength
  // lands in exactly one of them and the comparison can't fall between two.
  // The clamp keeps a full-strength strike inside the top band rather than off
  // the end of it, and is the one place the closed upper edge is handled.
  const v = Math.min(Math.max(velocity, 0), 1 - 1e-9);
  const inBand = set.regions.filter((r) => v >= r.lo && v < r.hi);
  const pool = inBand.length ? inBand : set.regions;

  let nearest = Infinity;
  for (const r of pool) nearest = Math.min(nearest, Math.abs(r.root - midi));
  const takes = pool.filter((r) => Math.abs(r.root - midi) === nearest);
  if (takes.length === 1) return takes[0];

  // Alternate, rather than choosing at random: random repeats itself about a
  // third of the time with three takes, which is exactly the machine-gun effect
  // the takes exist to avoid.
  const cell = `${set.id}:${takes[0].root}:${takes[0].lo}`;
  const next = ((lastTake.get(cell) ?? -1) + 1) % takes.length;
  lastTake.set(cell, next);
  return takes[next];
}

// ---- playing --------------------------------------------------------------

interface Built {
  source: AudioBufferSourceNode;
  amp: GainNode;
  peak: number;
  /** How fast the recording is playing, so callers can work out how long it lasts. */
  rate: number;
}

/** How fast to play a recording so it lands on the note asked for. */
function rateFor(region: SampleRegion, midi: number): number {
  return 2 ** ((midi - region.root) / 12 + region.cents / 1200);
}

function build(
  ctx: BaseAudioContext,
  dest: AudioNode,
  time: number,
  set: SampleSet,
  region: SampleRegion,
  p: Record<string, number>,
  vel: number,
  midi: number,
): Built | null {
  const buffer = buffers.get(key(set.id, region.f));
  if (!buffer) return null;

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rateFor(region, midi);

  let tail: AudioNode = source;

  // A low-pass only where it does something. At its default the slider sits at
  // the top of its range, which is above everything in the recording, so a node
  // there would cost CPU on every note to change nothing.
  // `tone` on a drum, `cutoff` on a melodic voice — the names the synthesized
  // versions used, kept so a child's saved tweak still means what it meant.
  const cutoff = p.cutoff ?? p.tone ?? 12000;
  if (cutoff < 11500) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.max(120, cutoff);
    filter.Q.value = 0.7;
    tail.connect(filter);
    tail = filter;
  }

  const drive = p.drive ?? 0;
  if (drive > 0) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = driveCurve(drive);
    shaper.oversample = '2x';
    tail.connect(shaper);
    tail = shaper;
  }

  const amp = ctx.createGain();
  const peak = Math.max(0.0002, (p.gain ?? 0.6) * vel);
  const attack = Math.max(0.0005, p.attack ?? 0.002);
  amp.gain.setValueAtTime(EPS, time);
  amp.gain.linearRampToValueAtTime(peak, time + attack);

  tail.connect(amp);
  amp.connect(dest);
  return { source, amp, peak, rate: source.playbackRate.value };
}

/**
 * Shaping curve for the drive control. Odd number of points on purpose: with an
 * even count there is no point at exactly zero, so silence comes out as a small
 * constant offset that never goes away. See the same note in synth.ts.
 */
const CURVE_POINTS = 1025;
function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const k = amount * 100;
  const curve = new Float32Array(new ArrayBuffer(CURVE_POINTS * 4));
  for (let i = 0; i < CURVE_POINTS; i++) {
    const x = (i * 2) / (CURVE_POINTS - 1) - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

/**
 * When a drum's level is pinned, when it reaches silence, and when the source is
 * freed — always in that order, whatever the sliders say.
 *
 * The ordering is the whole point, and it was wrong. Web Audio sorts automation
 * events by time, so with a slow attack and a short decay the ramp-to-silence
 * landed *before* the ramp-to-full: the level sat at the envelope's floor for
 * the note's entire life and the drum made no sound at all. Attack and Decay are
 * both sliders on every sampled drum, and a Shaker's Decay is 0.18 against an
 * Attack that goes up to 1.0 — so it took one drag to silence a block, with
 * nothing on screen to say why.
 */
export function drumEnvelope(time: number, attack: number, decay: number) {
  const rings = Math.max(0.02, decay);
  const attackEnd = time + attack;
  const silentAt = Math.max(time + rings, attackEnd + 0.02);
  const holdFrom = Math.max(attackEnd, silentAt - Math.max(0.02, (silentAt - time) * 0.15));
  return { holdFrom, silentAt, stopAt: silentAt + 0.02 };
}

/**
 * Play a sampled voice at an exact time. Returns false when the recordings
 * haven't arrived, so the caller can fall back to synthesis rather than
 * producing silence.
 */
export function triggerSample(
  setId: string,
  pitched: boolean,
  ctx: BaseAudioContext,
  dest: AudioNode,
  time: number,
  p: Record<string, number>,
  vel: number,
  note: NotePlayback | undefined,
): boolean {
  const set = getSampleSet(setId);
  if (!set) return false;
  // A transpose picks the recording of the note it lands on, rather than
  // stretching the original one that far. On a drum, where every recording is
  // filed under the same note, this changes nothing and the shift is all
  // stretch — which is what tuning a drum means.
  const base = pitched ? note?.midi ?? 60 : set.regions[0].root;
  const midi = base + (p.pitch ?? 0);
  const region = chooseRegion(set, midi, vel);
  if (!region) return false;
  const built = build(ctx, dest, time, set, region, p, vel, midi);
  if (!built) return false;

  const { source, amp, peak } = built;
  const attack = Math.max(0.0005, p.attack ?? 0.002);
  let stopAt: number;

  if (pitched) {
    // A note on the timeline knows how long it is, so its whole envelope is
    // scheduled up front — same as a synthesised note, and for the same reason:
    // that is what keeps it sample-accurate.
    const release = Math.max(0.02, p.release ?? 0.25);
    const gateOff = Math.max(time + Math.max(0.05, note?.durationSec ?? 0.4), time + attack + 0.02);
    amp.gain.setValueAtTime(peak, gateOff);
    amp.gain.exponentialRampToValueAtTime(EPS, gateOff + release);
    stopAt = gateOff + release + 0.02;
  } else {
    // A drum ignores how wide its block is, exactly as the synthesised drums do
    // — a child drawing a narrow hi-hat means "a hi-hat here", not "a hi-hat cut
    // off after a sixteenth". How long it rings is the Decay control instead.
    const env = drumEnvelope(time, attack, p.decay ?? set.seconds);
    amp.gain.setValueAtTime(peak, env.holdFrom);
    amp.gain.exponentialRampToValueAtTime(EPS, env.silentAt);
    stopAt = env.stopAt;
  }

  source.start(time);
  source.stop(stopAt);
  return true;
}

/**
 * The same voice played by hand: the recording runs on with the level held,
 * and only fades when the key comes up. Returns null when the recordings
 * haven't arrived.
 */
export function startHeldSample(
  setId: string,
  ctx: BaseAudioContext,
  dest: AudioNode,
  time: number,
  p: Record<string, number>,
  vel: number,
  midi: number,
): HeldNote | null {
  const set = getSampleSet(setId);
  if (!set) return null;
  const pitched = set.regions.some((r) => r.root !== set.regions[0].root);
  const want = (pitched ? midi : set.regions[0].root) + (p.pitch ?? 0);
  const region = chooseRegion(set, want, vel);
  if (!region) return null;
  const built = build(ctx, dest, time, set, region, p, vel, want);
  if (!built) return null;

  const { source, amp, peak, rate } = built;
  const release = Math.max(0.02, p.release ?? 0.25);
  source.start(time);
  // Long enough for any key that is still down; release() brings it in sooner.
  //
  // Divided by the playback rate, because that is the only thing that turns the
  // recording's own length into wall-clock seconds. A note played below its
  // recording runs slower and lasts longer — the bottom of the Bells is seven
  // semitones under the lowest bar, so a three-and-a-half second recording takes
  // over five — and stopping at the un-stretched length cut it off a second and
  // a half early, on a hard edge, with the level still held at full.
  let stopAt = time + set.seconds / Math.max(0.01, rate) + release + 0.05;
  source.stop(stopAt);

  let released = false;
  return {
    release(at?: number) {
      if (released) return;
      released = true;
      const when = Math.max(at ?? ctx.currentTime, time);
      // Pin the level before ramping, or the ramp is interpolated from the
      // attack's end and the note fades from the wrong place. Same trap as the
      // synthesised held note.
      amp.gain.cancelScheduledValues(when);
      amp.gain.setValueAtTime(peak, when);
      amp.gain.exponentialRampToValueAtTime(EPS, when + release);
      stopAt = when + release + 0.02;
      try {
        source.stop(stopAt);
      } catch {
        // Already stopped, or never started. Nothing to silence.
      }
    },
  };
}
