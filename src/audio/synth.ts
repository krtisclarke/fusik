// Drum synthesis. Each voice is built from oscillators and filtered noise with
// carefully shaped envelopes — no samples, so nothing to license and every knob
// is real. Trigger functions schedule everything against the Web Audio clock at
// an exact `time`, which is what keeps timing tight regardless of UI activity.
//
// Envelope note: Web Audio's exponential ramps can't touch zero, so decays ramp
// to a tiny epsilon instead. Attacks are near-instant (a few ms) to keep drums
// punchy without the click of a truly instantaneous jump.

import { midiToFreq } from '../model/scales';

const EPS = 0.0001;

/** Extra per-note info for pitched voices (drums ignore it). */
export interface NotePlayback {
  midi?: number;
  durationSec?: number;
}

/** A voice trigger: schedule this sound at `time`, played `velocity` hard. */
export type TriggerFn = (
  ctx: BaseAudioContext,
  destination: AudioNode,
  time: number,
  params: Record<string, number>,
  velocity: number,
  note?: NotePlayback,
) => void;

/** Oscillator waveforms, indexed by the numeric `wave` parameter. */
const WAVES: OscillatorType[] = ['sine', 'triangle', 'sawtooth', 'square'];

/** A note that is still being held down, and can be let go of later. */
export interface HeldNote {
  /** Let the note go: run its release, then free the oscillators. */
  release(at?: number): void;
}

// ---- shared white-noise buffer (one per context, reused) -----------------

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function getNoise(ctx: BaseAudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    const length = Math.floor(ctx.sampleRate * 2);
    buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
  }
  return buffer;
}

/**
 * Number of points in a shaping curve. **Odd on purpose.**
 *
 * A WaveShaper maps input -1 to the first point and +1 to the last, and
 * interpolates between them. With an even count there is no point sitting
 * exactly at input 0, so silence lands halfway between the two either side of
 * the middle and comes out as a small *constant* — a DC offset that never goes
 * away, because the node keeps producing it long after the sound has stopped.
 * It eats headroom from everything else, and inside the echo's feedback loop it
 * accumulates. An odd count puts a real point at dead centre, so silence in
 * gives silence out.
 */
const CURVE_POINTS = 1025;

/** Positions across a shaping curve, from -1 to +1 inclusive, 0 exactly in the middle. */
function curveInput(i: number): number {
  return (i * 2) / (CURVE_POINTS - 1) - 1;
}

function makeDistortionCurve(amount: number) {
  const k = amount * 100;
  // Back the array with an explicit ArrayBuffer so its type satisfies
  // WaveShaperNode.curve under newer TypeScript DOM lib typings.
  const curve = new Float32Array(new ArrayBuffer(CURVE_POINTS * 4));
  for (let i = 0; i < CURVE_POINTS; i++) {
    const x = curveInput(i);
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

// ---- low-level building blocks -------------------------------------------

/** Percussive sine/triangle body with a pitch drop — the heart of kicks/toms. */
function membrane(
  ctx: BaseAudioContext,
  dest: AudioNode,
  time: number,
  p: Record<string, number>,
  vel: number,
) {
  const tune = p.tune ?? 60;
  const pitchDrop = p.pitchDrop ?? 0;
  const decay = Math.max(0.03, p.decay ?? 0.3);
  const drive = p.drive ?? 0;
  const gain = (p.gain ?? 1) * vel;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(tune + pitchDrop, time);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, tune), time + Math.min(decay, 0.22));

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(EPS, time);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.002, gain), time + 0.004);
  amp.gain.exponentialRampToValueAtTime(EPS, time + decay);

  osc.connect(amp);

  let tail: AudioNode = amp;
  if (drive > 0) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeDistortionCurve(drive);
    shaper.oversample = '2x';
    amp.connect(shaper);
    tail = shaper;
  }
  tail.connect(dest);

  osc.start(time);
  osc.stop(time + decay + 0.05);

  // Optional attack "click" — a very short noise blip for extra punch.
  const click = p.click ?? 0;
  if (click > 0) {
    noiseBurst(ctx, dest, time, { type: 'highpass', freq: 2500, decay: 0.02, gain: click * 0.6 }, vel);
  }
}

/** A shaped burst of filtered noise — hats, snares, cymbals, claps. */
function noiseBurst(
  ctx: BaseAudioContext,
  dest: AudioNode,
  time: number,
  opts: { type: BiquadFilterType; freq: number; Q?: number; decay: number; gain: number },
  vel: number,
) {
  const src = ctx.createBufferSource();
  src.buffer = getNoise(ctx);
  // Randomise the read offset so repeated hits don't sound mechanically identical.
  src.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = opts.type;
  filter.frequency.value = opts.freq;
  if (opts.Q != null) filter.Q.value = opts.Q;

  const amp = ctx.createGain();
  const peak = Math.max(0.002, opts.gain * vel);
  amp.gain.setValueAtTime(peak, time);
  amp.gain.exponentialRampToValueAtTime(EPS, time + opts.decay);

  src.connect(filter);
  filter.connect(amp);
  amp.connect(dest);

  src.start(time);
  src.stop(time + opts.decay + 0.05);
}

/** A short tuned blip (square/triangle) — cowbell, rim, generic percussion. */
function blip(
  ctx: BaseAudioContext,
  dest: AudioNode,
  time: number,
  opts: { freq: number; type: OscillatorType; decay: number; gain: number },
  vel: number,
) {
  const osc = ctx.createOscillator();
  osc.type = opts.type;
  osc.frequency.value = opts.freq;

  const amp = ctx.createGain();
  const peak = Math.max(0.002, opts.gain * vel);
  amp.gain.setValueAtTime(EPS, time);
  amp.gain.exponentialRampToValueAtTime(peak, time + 0.003);
  amp.gain.exponentialRampToValueAtTime(EPS, time + opts.decay);

  osc.connect(amp);
  amp.connect(dest);
  osc.start(time);
  osc.stop(time + opts.decay + 0.05);
}

/**
 * A melodic voice: two detuned oscillators through a low-pass filter, shaped by
 * a real ADSR envelope. Held notes sustain for their length then release; short
 * notes pluck. This is the same shape a "real" subtractive synth uses, kept
 * small. Parameters (all overridable): wave, attack, decay, sustain, release,
 * cutoff, detune, gain.
 */
function pitchedSynth(
  ctx: BaseAudioContext,
  dest: AudioNode,
  time: number,
  p: Record<string, number>,
  vel: number,
  note: NotePlayback | undefined,
) {
  const midi = note?.midi ?? 60;
  const durationSec = Math.max(0.05, note?.durationSec ?? 0.4);
  const freq = midiToFreq(midi);

  const wave = WAVES[Math.round(p.wave ?? 1)] ?? 'triangle';
  const attack = Math.max(0.001, p.attack ?? 0.01);
  const decay = Math.max(0.01, p.decay ?? 0.2);
  const sustain = Math.min(1, Math.max(0, p.sustain ?? 0.5));
  const release = Math.max(0.02, p.release ?? 0.2);

  const osc1 = ctx.createOscillator();
  osc1.type = wave;
  osc1.frequency.value = freq;
  const osc2 = ctx.createOscillator();
  osc2.type = wave;
  osc2.frequency.value = freq;
  osc2.detune.value = p.detune ?? 0;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = p.cutoff ?? 4000;
  filter.Q.value = 0.7;

  const amp = ctx.createGain();
  const peak = Math.max(0.0002, (p.gain ?? 0.5) * vel);
  const susLevel = Math.max(0.0002, peak * sustain);

  // ADSR, with times kept strictly increasing so very short notes stay valid.
  const attackEnd = time + attack;
  const gateOff = Math.max(time + durationSec, attackEnd + 0.02);
  const decayEnd = Math.min(attackEnd + decay, gateOff);

  amp.gain.setValueAtTime(EPS, time);
  amp.gain.linearRampToValueAtTime(peak, attackEnd);
  amp.gain.exponentialRampToValueAtTime(susLevel, decayEnd);
  amp.gain.setValueAtTime(susLevel, gateOff);
  amp.gain.exponentialRampToValueAtTime(EPS, gateOff + release);

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(amp);
  amp.connect(dest);

  const stopAt = gateOff + release + 0.05;
  osc1.start(time);
  osc2.start(time);
  osc1.stop(stopAt);
  osc2.stop(stopAt);
}

/**
 * The same melodic voice, but played by hand rather than from the timeline: the
 * envelope's gate is left *open* — attack, decay, then hold at the sustain level
 * for as long as the key is down — and closes only when `release()` is called.
 *
 * Timeline notes can't work this way because their length is known up front, and
 * scheduling the whole envelope in one go is what keeps them sample-accurate.
 * A finger on a key has no known length, so the note has to be held instead.
 */
export function startHeldNote(
  ctx: BaseAudioContext,
  dest: AudioNode,
  time: number,
  p: Record<string, number>,
  vel: number,
  midi: number,
): HeldNote {
  const freq = midiToFreq(midi);
  const wave = WAVES[Math.round(p.wave ?? 1)] ?? 'triangle';
  const attack = Math.max(0.001, p.attack ?? 0.01);
  const decay = Math.max(0.01, p.decay ?? 0.2);
  const sustain = Math.min(1, Math.max(0, p.sustain ?? 0.5));
  const release = Math.max(0.02, p.release ?? 0.2);

  const osc1 = ctx.createOscillator();
  osc1.type = wave;
  osc1.frequency.value = freq;
  const osc2 = ctx.createOscillator();
  osc2.type = wave;
  osc2.frequency.value = freq;
  osc2.detune.value = p.detune ?? 0;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = p.cutoff ?? 4000;
  filter.Q.value = 0.7;

  const amp = ctx.createGain();
  const peak = Math.max(0.0002, (p.gain ?? 0.5) * vel);
  // A voice whose sustain is 0 (a plucky one) would die away to nothing and the
  // key would feel dead. Held notes keep a floor under the sustain level.
  const susLevel = Math.max(peak * 0.25, peak * sustain);

  const attackEnd = time + attack;
  const decayEnd = attackEnd + decay;
  amp.gain.setValueAtTime(EPS, time);
  amp.gain.linearRampToValueAtTime(peak, attackEnd);
  amp.gain.exponentialRampToValueAtTime(susLevel, decayEnd);

  /** The level the envelope has reached at `t`, following the curve above. */
  function levelAt(t: number): number {
    if (t <= time) return EPS;
    if (t < attackEnd) return Math.max(EPS, peak * ((t - time) / attack));
    if (t < decayEnd) {
      const through = (t - attackEnd) / Math.max(1e-6, decayEnd - attackEnd);
      return Math.max(EPS, peak * Math.pow(susLevel / peak, through));
    }
    return susLevel;
  }

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(amp);
  amp.connect(dest);
  osc1.start(time);
  osc2.start(time);

  let released = false;
  return {
    release(at?: number) {
      if (released) return;
      released = true;
      const when = Math.max(at ?? ctx.currentTime, time);
      // Pin the level the envelope has reached at `when` before ramping down.
      // Without that explicit point, a ramp is interpolated from the *previous*
      // automation event — the end of the decay — so the note would start
      // fading the moment its decay finished and be gone long before the key
      // came up.
      amp.gain.cancelScheduledValues(when);
      amp.gain.setValueAtTime(levelAt(when), when);
      amp.gain.exponentialRampToValueAtTime(EPS, when + release);
      const stopAt = when + release + 0.05;
      osc1.stop(stopAt);
      osc2.stop(stopAt);
    },
  };
}

/** A layered kick: a pitch-dropping body + a pure sub for weight + a beater
 *  click for attack. Beefier and more modern than a single sine. */
function kickVoice(
  ctx: BaseAudioContext,
  dest: AudioNode,
  time: number,
  p: Record<string, number>,
  vel: number,
) {
  const tune = p.tune ?? 50;
  const pitchDrop = p.pitchDrop ?? 110;
  const decay = Math.max(0.05, p.decay ?? 0.34);
  const drive = p.drive ?? 0.15;
  const gain = (p.gain ?? 1) * vel;

  // Body: sine with a fast pitch drop, optionally saturated.
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(tune + pitchDrop, time);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, tune), time + Math.min(0.16, decay * 0.6));
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(EPS, time);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.002, gain), time + 0.005);
  amp.gain.exponentialRampToValueAtTime(EPS, time + decay);
  osc.connect(amp);
  let body: AudioNode = amp;
  if (drive > 0) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeDistortionCurve(drive);
    shaper.oversample = '2x';
    amp.connect(shaper);
    body = shaper;
  }
  body.connect(dest);
  osc.start(time);
  osc.stop(time + decay + 0.05);

  // Sub layer: a low, steady sine for weight under the body.
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = Math.max(30, tune * 0.6);
  const subAmp = ctx.createGain();
  subAmp.gain.setValueAtTime(EPS, time);
  subAmp.gain.exponentialRampToValueAtTime(Math.max(0.002, gain * 0.7), time + 0.01);
  subAmp.gain.exponentialRampToValueAtTime(EPS, time + decay * 1.1);
  sub.connect(subAmp);
  subAmp.connect(dest);
  sub.start(time);
  sub.stop(time + decay * 1.1 + 0.05);

  // Beater click for attack.
  const click = p.click ?? 0.4;
  if (click > 0) {
    noiseBurst(ctx, dest, time, { type: 'highpass', freq: 2000, decay: 0.02, gain: click * 0.5 }, vel);
  }
}

/** A metallic hi-hat: a cluster of inharmonic square oscillators through band-
 *  and high-pass filters. The classic drum-machine hat — far richer than plain
 *  filtered noise. */
function metallicHat(
  ctx: BaseAudioContext,
  dest: AudioNode,
  time: number,
  opts: { decay: number; tone: number; gain: number },
  vel: number,
) {
  const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
  const base = 40;

  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.value = opts.tone;
  bandpass.Q.value = 0.7;

  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = Math.max(4000, opts.tone * 0.8);

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(Math.max(0.002, opts.gain * vel), time);
  amp.gain.exponentialRampToValueAtTime(EPS, time + opts.decay);

  for (const r of ratios) {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = base * r;
    osc.connect(bandpass);
    osc.start(time);
    osc.stop(time + opts.decay + 0.05);
  }
  bandpass.connect(highpass);
  highpass.connect(amp);
  amp.connect(dest);
}

// ---- the voices ----------------------------------------------------------

export const VOICE_SYNTHS: Record<string, TriggerFn> = {
  kick: (ctx, dest, time, p, vel) => kickVoice(ctx, dest, time, p, vel),

  tom: (ctx, dest, time, p, vel) => membrane(ctx, dest, time, p, vel),

  snare: (ctx, dest, time, p, vel) => {
    const tune = p.tune ?? 180;
    const decay = p.decay ?? 0.2;
    const noiseMix = p.noise ?? 0.7;
    const tone = p.tone ?? 2200;
    const gain = p.gain ?? 0.9;
    // Tonal body: two detuned triangles for a fuller ring.
    blip(ctx, dest, time, { freq: tune, type: 'triangle', decay: decay * 0.6, gain: gain * (1 - noiseMix) }, vel);
    blip(ctx, dest, time, { freq: tune * 1.5, type: 'triangle', decay: decay * 0.5, gain: gain * (1 - noiseMix) * 0.5 }, vel);
    // Bright crack (short, high) plus body noise (longer, mid) = the "snares".
    noiseBurst(ctx, dest, time, { type: 'highpass', freq: tone * 1.4, decay: decay * 0.5, gain: gain * noiseMix }, vel);
    noiseBurst(ctx, dest, time, { type: 'bandpass', freq: tone * 0.8, Q: 0.8, decay, gain: gain * noiseMix * 0.7 }, vel);
  },

  hihat: (ctx, dest, time, p, vel) => {
    metallicHat(ctx, dest, time, { decay: p.decay ?? 0.05, tone: p.tone ?? 8000, gain: p.gain ?? 0.55 }, vel);
  },

  openhat: (ctx, dest, time, p, vel) => {
    metallicHat(ctx, dest, time, { decay: p.decay ?? 0.32, tone: p.tone ?? 8000, gain: p.gain ?? 0.5 }, vel);
  },

  crash: (ctx, dest, time, p, vel) => {
    noiseBurst(ctx, dest, time, {
      type: 'highpass',
      freq: p.tone ?? 5000,
      decay: p.decay ?? 1.3,
      gain: p.gain ?? 0.5,
    }, vel);
  },

  ride: (ctx, dest, time, p, vel) => {
    noiseBurst(ctx, dest, time, {
      type: 'bandpass',
      freq: p.tone ?? 7000,
      Q: 1.5,
      decay: p.decay ?? 0.85,
      gain: p.gain ?? 0.45,
    }, vel);
  },

  clap: (ctx, dest, time, p, vel) => {
    const tone = p.tone ?? 1500;
    const decay = p.decay ?? 0.18;
    const gain = p.gain ?? 0.8;
    // Three quick bursts + a slightly longer tail — the classic clap "spread".
    for (const offset of [0, 0.01, 0.02]) {
      noiseBurst(ctx, dest, time + offset, { type: 'bandpass', freq: tone, Q: 1, decay: 0.04, gain }, vel);
    }
    noiseBurst(ctx, dest, time + 0.03, { type: 'bandpass', freq: tone, Q: 1, decay, gain: gain * 0.8 }, vel);
  },

  rim: (ctx, dest, time, p, vel) => {
    blip(ctx, dest, time, { freq: p.tune ?? 1700, type: 'square', decay: 0.02, gain: (p.gain ?? 0.7) * 0.6 }, vel);
    noiseBurst(ctx, dest, time, { type: 'bandpass', freq: 3000, Q: 2, decay: p.decay ?? 0.05, gain: p.gain ?? 0.7 }, vel);
  },

  shaker: (ctx, dest, time, p, vel) => {
    noiseBurst(ctx, dest, time, {
      type: 'highpass',
      freq: p.tone ?? 6500,
      decay: p.decay ?? 0.06,
      gain: p.gain ?? 0.5,
    }, vel);
  },

  cowbell: (ctx, dest, time, p, vel) => {
    const tune = p.tune ?? 540;
    const decay = p.decay ?? 0.35;
    const gain = (p.gain ?? 0.6) * 0.5;
    blip(ctx, dest, time, { freq: tune, type: 'square', decay, gain }, vel);
    blip(ctx, dest, time, { freq: tune * 1.5, type: 'square', decay, gain }, vel);
  },

  perc: (ctx, dest, time, p, vel) => {
    blip(ctx, dest, time, { freq: p.tune ?? 420, type: 'triangle', decay: p.decay ?? 0.22, gain: p.gain ?? 0.6 }, vel);
  },

  // Pitched instruments all share the subtractive synth, differing only in
  // their default parameters (waveform, envelope, filter) from the catalog.
  piano: pitchedSynth,
  synth: pitchedSynth,
  bells: pitchedSynth,
  bass: pitchedSynth,
};

/** Look up a voice's trigger, falling back to a plain blip for unknown ids. */
export function getTrigger(voiceId: string): TriggerFn {
  return VOICE_SYNTHS[voiceId] ?? VOICE_SYNTHS.perc;
}
