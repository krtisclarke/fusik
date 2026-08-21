// How each sound parameter is presented in the Sound Editor: a friendly name, a
// sensible slider range, whether it's a "simple" everyday control or an advanced
// one, and a short kid-facing hint (shown on hover). The parameter keys match
// the numbers each voice reads in audio/synth.ts.

export interface ParamSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  /** Shown by default; advanced params hide behind "Show more". */
  simple: boolean;
  hint: string;
}

export const PARAM_SPECS: Record<string, ParamSpec> = {
  gain: { label: 'Volume', min: 0, max: 1, step: 0.01, simple: true, hint: 'How loud this sound is.' },
  tune: { label: 'Pitch', min: 20, max: 2000, step: 1, simple: true, hint: 'How high or low the sound is.' },
  pitchDrop: { label: 'Pitch Drop', min: 0, max: 300, step: 1, simple: false, hint: 'How far the pitch dives at the start — this is what gives a kick its punch.' },
  decay: { label: 'Decay', min: 0.02, max: 2, step: 0.01, simple: true, hint: 'How long the sound rings out before it fades. (A block’s width is its length on the timeline.)' },
  click: { label: 'Click', min: 0, max: 1, step: 0.01, simple: false, hint: 'The sharp tick right at the very start.' },
  drive: { label: 'Buzz', min: 0, max: 1, step: 0.01, simple: true, hint: 'Adds grit and distortion. A little goes a long way.' },
  noise: { label: 'Snappy', min: 0, max: 1, step: 0.01, simple: false, hint: 'How much hiss versus tone — turns a snare from a bongo into a snap.' },
  tone: { label: 'Brightness', min: 200, max: 12000, step: 100, simple: true, hint: 'Keeps or removes the high, bright, sparkly part of the sound.' },
  cutoff: { label: 'Brightness', min: 200, max: 12000, step: 100, simple: true, hint: 'Keeps or removes the high, bright, sparkly part of the sound.' },
  wave: { label: 'Wave', min: 0, max: 3, step: 1, simple: true, hint: 'The basic shape of the sound: soft, warm, buzzy, or hollow.' },
  attack: { label: 'Attack', min: 0.001, max: 1, step: 0.001, simple: true, hint: 'How quickly the sound reaches full volume. Low = punchy, high = a slow swell.' },
  sustain: { label: 'Sustain', min: 0, max: 1, step: 0.01, simple: false, hint: 'The level a note holds while you keep it playing.' },
  release: { label: 'Release', min: 0.02, max: 2, step: 0.01, simple: true, hint: 'How long the sound fades away after a note ends.' },
  bite: { label: 'Twang', min: 0, max: 4, step: 0.1, simple: true, hint: 'How much extra zing the sound has right at the start, before it settles. This is what stops a note sounding flat.' },
  detune: { label: 'Detune', min: 0, max: 30, step: 0.5, simple: false, hint: 'Spreads two copies of the sound slightly apart for a thicker feel.' },
};

/** Friendly names for the numeric "wave" parameter. */
export const WAVE_NAMES = ['Sine', 'Triangle', 'Saw', 'Square'];

export function formatParamValue(key: string, value: number): string {
  if (key === 'wave') return WAVE_NAMES[Math.round(value)] ?? String(value);
  if (key === 'tone' || key === 'cutoff' || key === 'tune' || key === 'pitchDrop') {
    return `${Math.round(value)}`;
  }
  return value.toFixed(2);
}
