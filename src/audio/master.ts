// The master bus — the final polish every sound passes through on its way out.
//
// Three stages, each doing one job:
//   1. Reverb (a little space, so sounds don't feel bone-dry and "boxy").
//   2. Gentle saturation (a touch of harmonic warmth / "glue").
//   3. A brickwall limiter (safety: no stacked sounds can ever spike loud
//      enough to hurt ears or speakers).
//
// Built as `createMasterChain(ctx)` returning { input, output } so it works with
// a live AudioContext *and* an OfflineAudioContext — which means the whole chain
// can be rendered and measured in a test, not just trusted.

/** A synthesized reverb impulse: stereo decaying noise. No audio files needed. */
export function createReverbImpulse(ctx: BaseAudioContext, seconds = 1.3, decay = 3): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(seconds * rate));
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buffer;
}

/** A gentle tanh saturation curve — warmth without obvious distortion. */
function createSaturationCurve(amount: number) {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const drive = 1 + amount * 3;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return curve;
}

export interface MasterChain {
  /** Connect every track/voice here. */
  input: GainNode;
  /** Connect this to the context's destination (or an offline destination). */
  output: AudioNode;
}

export function createMasterChain(ctx: BaseAudioContext): MasterChain {
  const input = ctx.createGain();
  input.gain.value = 0.9;

  // --- dry + reverb send, summed ---
  const sum = ctx.createGain();
  const dry = ctx.createGain();
  dry.gain.value = 1;

  const reverbSend = ctx.createGain();
  reverbSend.gain.value = 0.1; // subtle — easy to turn up if wanted
  const convolver = ctx.createConvolver();
  convolver.buffer = createReverbImpulse(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.85;

  input.connect(dry).connect(sum);
  input.connect(reverbSend).connect(convolver).connect(wet).connect(sum);

  // --- warmth ---
  const saturation = ctx.createWaveShaper();
  saturation.curve = createSaturationCurve(0.15);
  saturation.oversample = '2x';

  // --- safety limiter ---
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.1;

  // A final touch of headroom so a fast transient slipping past the limiter's
  // attack still can't reach full scale and clip.
  const output = ctx.createGain();
  output.gain.value = 0.9;

  sum.connect(saturation).connect(limiter).connect(output);

  return { input, output };
}
