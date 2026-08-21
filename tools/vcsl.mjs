// Reading the Versilian Community Sample Library (VCSL): its SFZ maps, its
// WAV files, and the small set of them this app actually ships.
//
// VCSL publishes, alongside the recordings, a map saying which recording is
// which note, how hard the strike was, and how much to turn each one up so they
// all sit at the same level. Reading that map is far better than guessing: the
// tuning corrections and level trims in it were measured by the people who made
// the recordings.
//
// Everything here is build-time only. Nothing in this file ships.

import fs from 'node:fs';
import path from 'node:path';

/** The exact VCSL commit these assets come from. Pinned so a rebuild is identical. */
export const VCSL_REF = 'c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e';
export const VCSL_RAW = `https://raw.githubusercontent.com/sgossner/VCSL/${VCSL_REF}/`;
/**
 * The maps live on their own branch, pinned to a commit like the audio is.
 *
 * A branch name would have been the obvious thing to write and would have
 * quietly broken reproducibility: everything that decides *mapping* rather than
 * sound comes from these files — root notes, strength bands, tunings, take
 * numbers, which recordings exist at all — so a regenerated branch plus an empty
 * cache would produce a different instrument from byte-identical audio, and
 * report success.
 */
export const VCSL_SFZ_REF = 'dfcf4a4918771eee884b96ad4493de82ef84daf6';
export const VCSL_SFZ_RAW = `https://raw.githubusercontent.com/sgossner/VCSL/${VCSL_SFZ_REF}/`;
export const VCSL_HOME = 'https://github.com/sgossner/VCSL';
export const VCSL_LICENSE = 'CC0-1.0';
export const VCSL_ATTRIBUTION =
  'Versilian Community Sample Library by Versilian Studios LLC (CC0 1.0 — no attribution required)';

// ---- SFZ ------------------------------------------------------------------

/**
 * Parse the subset of SFZ this needs: `<group>` headers carrying defaults and
 * `<region>` bodies naming a sample. Everything is `key=value`, one per line,
 * and `//` starts a comment — VCSL's generated files comment *out* whole
 * regions, which is why a region with no opcodes is skipped rather than
 * inheriting the group and looking real.
 */
export function parseSfz(text) {
  const parts = [...text.matchAll(/<(group|region|global|master|control)>([^<]*)/g)];
  const readBody = (body) => {
    const out = {};
    for (const raw of body.split('\n')) {
      const line = raw.split('//')[0].trim();
      if (!line || !line.includes('=')) continue;
      const at = line.indexOf('=');
      out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
    return out;
  };
  let group = {};
  const regions = [];
  for (const [, kind, body] of parts) {
    const opcodes = readBody(body);
    if (kind === 'region') {
      if (opcodes.sample) regions.push({ ...group, ...opcodes });
    } else {
      group = opcodes;
    }
  }
  return regions;
}

/** Resolve a region's `sample=` against the folder its SFZ file lives in. */
export function samplePath(sfzRepoPath, region) {
  const dir = path.posix.dirname(sfzRepoPath);
  return path.posix.normalize(path.posix.join(dir, region.sample.replace(/\\/g, '/')));
}

// ---- WAV ------------------------------------------------------------------

/** Decode a PCM WAV (16/24/32-bit int, 32-bit float) into planar Float32. */
export function decodeWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      fmt = {
        tag: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
      // WAVE_FORMAT_EXTENSIBLE hides the real tag in its sub-format GUID.
      if (fmt.tag === 0xfffe && size >= 40) fmt.tag = buf.readUInt16LE(body + 24);
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(body + size, buf.length));
    }
    pos = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('missing fmt or data chunk');

  const bytesPerSample = fmt.bits >> 3;
  const frames = Math.floor(data.length / (bytesPerSample * fmt.channels));
  const planes = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  const read = pcmReader(fmt);
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < fmt.channels; c++) {
      planes[c][f] = read(data, (f * fmt.channels + c) * bytesPerSample);
    }
  }
  return { sampleRate: fmt.sampleRate, channels: planes };
}

function pcmReader(fmt) {
  if (fmt.tag === 3 && fmt.bits === 32) return (b, o) => b.readFloatLE(o);
  if (fmt.tag !== 1) throw new Error(`unsupported WAV format tag ${fmt.tag}`);
  if (fmt.bits === 16) return (b, o) => b.readInt16LE(o) / 32768;
  if (fmt.bits === 24) {
    return (b, o) => {
      const v = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
      return (v & 0x800000 ? v - 0x1000000 : v) / 8388608;
    };
  }
  if (fmt.bits === 32) return (b, o) => b.readInt32LE(o) / 2147483648;
  if (fmt.bits === 8) return (b, o) => (b[o] - 128) / 128;
  throw new Error(`unsupported WAV bit depth ${fmt.bits}`);
}

/** Encode planar Float32 as a 32-bit float WAV — the lossless hand-off to the encoder. */
export function encodeFloatWav(channels, sampleRate) {
  const nch = channels.length;
  const frames = channels[0].length;
  const dataBytes = frames * nch * 4;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20); // IEEE float
  buf.writeUInt16LE(nch, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * nch * 4, 28);
  buf.writeUInt16LE(nch * 4, 32);
  buf.writeUInt16LE(32, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  let at = 44;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < nch; c++) {
      buf.writeFloatLE(channels[c][f], at);
      at += 4;
    }
  }
  return buf;
}

// ---- fetching -------------------------------------------------------------

export async function cachedFetch(url, cachePath) {
  if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 0) {
    return fs.readFileSync(cachePath);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  // Written beside the real name and moved into place, so the cache only ever
  // holds whole files. A download of 270 MB is long enough to be interrupted,
  // and a half-written one is worse than none: it has a size above zero, so the
  // next run treats it as complete and builds an instrument out of it.
  const partial = `${cachePath}.part`;
  fs.writeFileSync(partial, bytes);
  fs.renameSync(partial, cachePath);
  return bytes;
}

// ---- checking a map against the recordings --------------------------------

const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);

/** How much of a recording's loudest partial must sit at a candidate note for
 *  that note to be its fundamental. Measured margins: 0.28 (worst real
 *  fundamental) above, 0.10 (worst false one) below. */
const FUNDAMENTAL_SHARE = 0.2;

/**
 * How far a candidate note must stand above the general noise in the recording
 * to count as a real partial rather than a lucky bump.
 *
 * Without this, broadband noise passes: the loudest bin in a narrow window round
 * *any* frequency is a decent fraction of the loudest bin overall, so a cymbal
 * or a rattle would be handed a confident, meaningless pitch. A tone stands
 * enormously further above its own noise floor than this asks for.
 */
const PROMINENCE = 6;

/**
 * Check a map's key centre against the recording, and say which octave is
 * actually right.
 *
 * This exists because a sample library's map can be wrong, and one here is:
 * VCSL's glockenspiel is filed an octave below where it actually rings, with no
 * energy whatsoever at the note its map names. Left alone, every Bells note
 * would have come out an octave low, and nothing but a measurement finds that.
 *
 * The test is: of the octave below the claim, the claim, and the octave above,
 * take the lowest that has real energy *at its own fundamental*. Three things
 * make it trustworthy rather than a guess:
 *
 * - Measured across this whole selection the two cases are nowhere near each
 *   other. Every piano recording has at least 28% of its loudest partial
 *   sitting at its fundamental; every glockenspiel recording has 0.1% or less
 *   at the note its map names, and 100% an octave up. The threshold below sits
 *   in a very wide gap.
 * - Walking upward is what makes a map that is too *high* fail as well. A piano
 *   note filed an octave high would find its second harmonic at the claimed
 *   note and look fine — but the octave below is tested first, and its
 *   fundamental is there.
 * - Only one octave either way is considered. The realistic mistake is a naming
 *   convention out by twelve semitones, and looking further afield costs
 *   accuracy for nothing: two octaves below a soft low piano note is 50 Hz,
 *   where room rumble alone reached a tenth of the peak on one recording here.
 *
 * "The loudest partial" is emphatically not the test to use: a piano's second
 * harmonic is routinely louder than its fundamental, so that answer is an
 * octave high on notes that are perfectly correct.
 */
export function verifyKeyCentre(channels, sampleRate, claimedMidi) {
  const spec = spectrumOf(channels, sampleRate);
  if (!spec || spec.peak <= 0) return { ok: false, midi: null, octaveShift: 0 };
  for (let k = -1; k <= 1; k++) {
    const hz = midiToHz(claimedMidi + 12 * k);
    const floor = Math.max(spec.peak * FUNDAMENTAL_SHARE, spec.median * PROMINENCE);
    if (energyNear(spec, hz) >= floor) {
      return { ok: true, midi: 69 + 12 * Math.log2(peakHzNear(spec, hz) / 440), octaveShift: k };
    }
  }
  return { ok: false, midi: null, octaveShift: 0 };
}

/** Magnitude spectrum of a window taken just after the attack. */
export function spectrumOf(channels, sampleRate, { skipSeconds = 0.06 } = {}) {
  const N = 1 << 15;
  const start = Math.round(skipSeconds * sampleRate);
  const src = channels[0];
  const usable = Math.min(N, Math.max(0, src.length - start));
  if (usable < N / 8) return null;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < usable; i++) {
    re[i] = src[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (usable - 1)));
  }
  fft(re, im);
  const bins = N >> 1;
  const mags = new Float64Array(bins);
  let peak = 0;
  for (let k = 1; k < bins; k++) {
    mags[k] = Math.hypot(re[k], im[k]);
    if (mags[k] > peak) peak = mags[k];
  }
  // The typical magnitude, for judging whether a candidate stands out at all.
  // Sampled rather than fully sorted: 32k bins sorted per recording is a lot of
  // work for a number that only needs to be roughly right.
  const sample = [];
  for (let k = 1; k < bins; k += 16) sample.push(mags[k]);
  sample.sort((a, b) => a - b);
  const median = sample[sample.length >> 1] || 0;

  return { mags, peak, median, binHz: sampleRate / N };
}

function binRange(spec, hz, cents) {
  return [
    Math.max(1, Math.floor((hz * 2 ** (-cents / 1200)) / spec.binHz)),
    Math.min(spec.mags.length - 2, Math.ceil((hz * 2 ** (cents / 1200)) / spec.binHz)),
  ];
}

/** The loudest magnitude within +/- `cents` of `hz`. */
function energyNear(spec, hz, cents = 60) {
  const [lo, hi] = binRange(spec, hz, cents);
  let best = 0;
  for (let k = lo; k <= hi; k++) if (spec.mags[k] > best) best = spec.mags[k];
  return best;
}

/** Where exactly, in Hz, that peak sits — interpolated, so the answer isn't
 *  quantised to the bin width. */
function peakHzNear(spec, hz, cents = 60) {
  const [lo, hi] = binRange(spec, hz, cents);
  let bestK = lo;
  for (let k = lo; k <= hi; k++) if (spec.mags[k] > spec.mags[bestK]) bestK = k;
  const y0 = spec.mags[bestK - 1] ?? 0;
  const y1 = spec.mags[bestK];
  const y2 = spec.mags[bestK + 1] ?? 0;
  const denom = y0 - 2 * y1 + y2;
  const shift = denom === 0 ? 0 : (0.5 * (y0 - y2)) / denom;
  return (bestK + shift) * spec.binHz;
}

/** In-place iterative radix-2 FFT. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const c = Math.cos(ang * k);
        const s = Math.sin(ang * k);
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + half] * c - im[i + k + half] * s;
        const vi = re[i + k + half] * s + im[i + k + half] * c;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + half] = ur - vr;
        im[i + k + half] = ui - vi;
      }
    }
  }
}
