// Build the app's sampled instruments from the Versilian Community Sample
// Library (CC0). Run from the project root:
//
//   node tools/build-samples.mjs            # build (uses the download cache)
//   node tools/build-samples.mjs --plan     # print what it would be selected; fetches
//                                           # only the small text maps, no audio
//
// It downloads a named subset of VCSL, trims and levels each recording, encodes
// it, and writes three things: the audio into public/samples/, the map the
// engine reads into src/model/sampleSets.ts, and the licence record into
// docs/asset-manifest.json.
//
// The library is pinned to a commit — two, in fact: one for the recordings and
// one for the maps that say what they are. Downloaded sources are cached outside
// the project; see CACHE below.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  VCSL_REF, VCSL_RAW, VCSL_SFZ_RAW, VCSL_SFZ_REF, VCSL_HOME, VCSL_LICENSE, VCSL_ATTRIBUTION,
  parseSfz, samplePath, decodeWav, encodeFloatWav, cachedFetch, verifyKeyCentre,
} from './vcsl.mjs';
import { normalise, validate, DRUM_ROOT } from './selection.mjs';

/**
 * Escape a repository path for a URL, segment by segment.
 *
 * `encodeURI` is the obvious choice and is wrong here: it deliberately leaves
 * `#` alone, because in a URL `#` starts the fragment. VCSL names its sharps
 * with one — `GPiano_sus_F#2_v1_rr1_Player.wav` — so the request went to
 * `.../GPiano_sus_F` with the rest thrown away as a fragment, and every sharp
 * in the piano and the glockenspiel came back 404. The build could not run from
 * an empty cache at all.
 */
const urlPath = (repoPath) => repoPath.split('/').map(encodeURIComponent).join('/');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/**
 * Where downloaded source recordings are kept between runs — about 270 MB.
 *
 * Deliberately outside the project. This one lives in `~/Documents`, which
 * iCloud syncs, and a quarter of a gigabyte of source audio that only a rebuild
 * ever reads has no business being uploaded, downloaded onto every other Mac,
 * or counted against anybody's storage. Override with VCSL_CACHE.
 */
const CACHE = process.env.VCSL_CACHE
  || path.join(os.homedir(), 'Library', 'Caches', 'beatbox-studio', 'vcsl');

/**
 * Where a downloaded file is kept — under the commit it came from.
 *
 * Keying by path alone would answer a request for a *different* commit out of
 * the old download, so bumping a pin would produce byte-identical instruments
 * while the licence manifest recorded the new commit: the audio would be
 * attributed to something it did not come from, and every test would pass. That
 * is the same reproducibility hole the pinning exists to close, pointing the
 * other way.
 */
const cachePath = (ref, repoPath) => path.join(CACHE, ref, repoPath);
const OUT_AUDIO = path.join(ROOT, 'public', 'samples');
const OUT_MAP = path.join(ROOT, 'src', 'model', 'sampleSets.ts');
const OUT_MANIFEST = path.join(ROOT, 'docs', 'asset-manifest.json');
const PLAN_ONLY = process.argv.includes('--plan');

const has = (name) => (r) => path.posix.basename(r.sample).includes(name);
const matches = (re) => (r) => re.test(path.posix.basename(r.sample));

/**
 * Which VCSL recordings become which voice.
 *
 * `pick` narrows a library instrument to the articulation this app wants — VCSL
 * files rolls, bowed swells, rim shots and stick clicks alongside the plain hit,
 * and a kids' beat-maker wants the plain hit. `tail` caps how long a recording
 * is kept: a grand piano note rings for forty seconds and nothing here needs
 * more than a few.
 */
const SETS = [
  {
    id: 'piano',
    sfz: 'Chordophones/Zithers/Grand Piano, Kawai.sfz',
    instrument: 'Grand Piano, Kawai',
    pick: (r) => r.trigger !== 'release',
    pitched: { keyRange: [45, 96], keyStep: 1, layers: 3 },
    tail: 4.0,
  },
  {
    id: 'bells',
    sfz: 'Idiophones/Struck Idiophones/Glockenspiel.sfz',
    instrument: 'Glockenspiel',
    pick: () => true,
    pitched: { keyRange: [0, 127], keyStep: 1, layers: 3 },
    tail: 3.5,
  },
  // Each `pick` narrows a library instrument down to ONE way of playing it.
  // That matters more than it looks: VCSL files every technique for an
  // instrument under the same folder — a hi-hat's closed hit, loose hit, open
  // hit and pedal close all live together, on different keys. Taking them all
  // would make one voice that changes character at random from hit to hit.
  { id: 'kick',    sfz: 'Membranophones/Struck Membranophones/Bass Drum 1.sfz',          instrument: 'Bass Drum 1 (concert)', pick: () => true,                      tail: 2.0 },
  { id: 'snare',   sfz: 'Membranophones/Struck Membranophones/Snare Drum, Modern 1.sfz', instrument: 'Snare Drum, Modern 1',  pick: has('_HitSN_'),                  tail: 1.2 },
  { id: 'rim',     sfz: 'Membranophones/Struck Membranophones/Snare Drum, Modern 1.sfz', instrument: 'Snare Drum, Modern 1',  pick: has('_stick_'),                  tail: 0.8 },
  { id: 'hihat',   sfz: 'Idiophones/Struck Idiophones/Hi-Hat Cymbal.sfz',                instrument: 'Hi-Hat Cymbal',         pick: has('_HitC_'),                   tail: 1.0 },
  { id: 'openhat', sfz: 'Idiophones/Struck Idiophones/Hi-Hat Cymbal.sfz',                instrument: 'Hi-Hat Cymbal',         pick: has('_HitO_'),                   tail: 2.5 },
  { id: 'tom',     sfz: 'Membranophones/Struck Membranophones/Tom 1.sfz',                instrument: 'Tom 1 (high)',          pick: has('_HitS_'),                   tail: 1.6 },
  { id: 'tomlow',  sfz: 'Membranophones/Struck Membranophones/Tom 2.sfz',                instrument: 'Tom 2 (low)',           pick: has('_HitS_'),                   tail: 1.8 },
  { id: 'crash',   sfz: 'Idiophones/Struck Idiophones/Suspended Cymbal 1.sfz',           instrument: 'Suspended Cymbal 1',    pick: matches(/_hit_(pp|mp|f|fff)\d/), tail: 4.0 },
  { id: 'ride',    sfz: 'Idiophones/Struck Idiophones/Suspended Cymbal 1.sfz',           instrument: 'Suspended Cymbal 1',    pick: has('_hit_stick_'),              tail: 3.0 },
  { id: 'clap',    sfz: 'Idiophones/Struck Idiophones/Claps.sfz',                        instrument: 'Claps (group)',         pick: matches(/^Clap_rr/),             tail: 1.0 },
  { id: 'shaker',  sfz: 'Idiophones/Struck Idiophones/Shaker, Small.sfz',                instrument: 'Shaker, Small',         pick: has('ShakerHighFaster'),         tail: 0.8 },
  { id: 'cowbell', sfz: 'Idiophones/Struck Idiophones/Cowbells.sfz',                     instrument: 'Cowbells',              pick: has('Cowbell1_Hit_'),            tail: 1.2 },
  { id: 'perc',    sfz: 'Idiophones/Struck Idiophones/Woodblock.sfz',                    instrument: 'Woodblock',             pick: matches(/^wood_click_/),         tail: 0.8 },
];


// ---- turning SFZ regions into the app's regions ---------------------------

// ---- audio ----------------------------------------------------------------

/** Where the sound actually starts. Recordings carry a little silence in front;
 *  left in, every hit would land late by a different amount. */
function firstSound(channels, threshold) {
  const frames = channels[0].length;
  for (let i = 0; i < frames; i++) {
    for (const ch of channels) if (Math.abs(ch[i]) >= threshold) return i;
  }
  return 0;
}

function peakOf(channels) {
  let peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) {
    const a = Math.abs(ch[i]);
    if (a > peak) peak = a;
  }
  return peak;
}

/**
 * How much silence to keep in front of the transient.
 *
 * Recordings carry several milliseconds of room before the hit. Left in, every
 * sampled drum lands that much behind a synthesized one, which reads as a flam
 * between the kick and the snare. Kept deliberately tiny rather than zero: the
 * trim point is found at -54 dB, and starting exactly there would cut into the
 * very front of the attack. Measured after this change, a hi-hat's first audible
 * sound lands within a millisecond of where it was asked for.
 */
const LEAD_BACKOFF_S = 0.0005;
const FADE_OUT_S = 0.12;      // no click where a long recording is cut short
const FADE_IN_S = 0.0003;     // nor where the trim lands mid-waveform

/**
 * How loud every recording is made, and how loud it is allowed to peak.
 *
 * Every recording is levelled to the same loudness — measured as the energy in
 * its first 300 ms, which is roughly the window the ear judges a hit over — and
 * how hard the note was struck then supplies all of the loudness difference at
 * playback. That is what the library's own level trims were reaching for, and
 * they don't quite get there: the hi-hat's third-hardest recording came out
 * *quieter* than its second-hardest, which reads as a hit that lands wrong.
 * Levelling here instead makes the strength layers differ in tone only, which is
 * the part a recording can capture and a volume knob can't.
 *
 * The peak cap is below full scale on purpose. Encoded audio decodes back
 * slightly *above* where it went in — an open hi-hat levelled to 0.95 came back
 * at 1.006 — so the ceiling has to leave room for that.
 */
const TARGET_RMS = 0.12;
const LOUDNESS_WINDOW_S = 0.3;
const PEAK_CAP = 0.89;

function rmsOf(channels, frames) {
  let sum = 0;
  let count = 0;
  for (const ch of channels) {
    const n = Math.min(frames, ch.length);
    for (let i = 0; i < n; i++) sum += ch[i] * ch[i];
    count += n;
  }
  return count ? Math.sqrt(sum / count) : 0;
}

/**
 * Trim, cut to length and level one recording.
 *
 * The library's own per-recording level trim is deliberately *not* used. It
 * would cancel out anyway — levelling to a target loudness divides straight
 * back out whatever was multiplied in — and the trims are not what this engine
 * needs: they aim for a loudness the player then re-scales by its own velocity
 * curve, and they are uneven enough that the hi-hat's third-hardest recording
 * came out quieter than its second-hardest. Levelling here instead makes the
 * strength layers differ in tone only, and how hard the note was struck supplies
 * every bit of the loudness difference.
 */
function shape(decoded, { tailSeconds }) {
  const { sampleRate, channels } = decoded;
  const peak = peakOf(channels);
  const start = Math.max(0, firstSound(channels, Math.max(1e-5, peak * 0.002))
    - Math.round(LEAD_BACKOFF_S * sampleRate));
  const maxFrames = Math.round(tailSeconds * sampleRate);
  const frames = Math.max(1, Math.min(channels[0].length - start, maxFrames));
  const cut = channels[0].length - start > maxFrames;

  const fadeIn = Math.min(Math.round(FADE_IN_S * sampleRate), frames);
  const fadeOut = cut ? Math.min(Math.round(FADE_OUT_S * sampleRate), Math.floor(frames / 3)) : 0;
  const out = channels.map((ch) => {
    const dst = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      let v = ch[start + i];
      if (i < fadeIn) v *= i / fadeIn;
      if (fadeOut && i >= frames - fadeOut) v *= (frames - i) / fadeOut;
      dst[i] = v;
    }
    return dst;
  });

  const loudness = rmsOf(out, Math.round(LOUDNESS_WINDOW_S * sampleRate));
  const shapedPeak = peakOf(out);
  let level = loudness > 0 ? TARGET_RMS / loudness : 1;
  const capped = shapedPeak * level > PEAK_CAP;
  if (capped) level = shapedPeak > 0 ? PEAK_CAP / shapedPeak : 1;
  for (const ch of out) for (let i = 0; i < ch.length; i++) ch[i] *= level;

  return {
    sampleRate,
    channels: out,
    seconds: frames / sampleRate,
    peak: peakOf(out),
    rms: rmsOf(out, Math.round(LOUDNESS_WINDOW_S * sampleRate)),
    capped,
  };
}

/**
 * Zero the clock out of an MP4 file.
 *
 * The encoder stamps the current date into three headers, so encoding the same
 * audio twice produces two files differing in six bytes. That is enough to make
 * every rebuild look like 6.8 MB of changed binaries to git, and enough to make
 * the hashes in the licence manifest change for no reason. The audio is
 * identical either way; the clock is the only thing moving.
 */
function stripTimestamps(buf) {
  const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'edts', 'minf', 'stbl', 'udta']);
  const TIMED = new Set(['mvhd', 'tkhd', 'mdhd']);
  const walk = (start, end) => {
    let at = start;
    while (at + 8 <= end) {
      let size = buf.readUInt32BE(at);
      const type = buf.toString('ascii', at + 4, at + 8);
      let header = 8;
      if (size === 1) {
        if (at + 16 > end) return;
        // 64-bit size; the high word is always zero for anything this small.
        size = Number(buf.readBigUInt64BE(at + 8));
        header = 16;
      } else if (size === 0) {
        size = end - at;
      }
      if (size < header || at + size > end) return;
      if (TIMED.has(type)) {
        const version = buf[at + header];
        const times = at + header + 4;
        const width = version === 1 ? 8 : 4;
        if (times + width * 2 <= at + size) buf.fill(0, times, times + width * 2);
      } else if (CONTAINERS.has(type)) {
        walk(at + header, at + size);
      }
      at += size;
    }
  };
  walk(0, buf.length);
  return buf;
}

function encodeAac(floatWav, outPath) {
  const tmp = path.join(os.tmpdir(), `beatbox-${crypto.randomBytes(6).toString('hex')}.wav`);
  fs.writeFileSync(tmp, floatWav);
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    execFileSync('afconvert', [
      '-f', 'm4af',        // AAC in an MP4 container — what Chromium decodes, and small
      '-d', 'aac@44100',
      '-b', '192000',
      '-s', '3',           // true VBR: spends bits on transients, saves them on tails
      '-q', '127',
      '-r', '127',         // best sample-rate conversion, for the 48 kHz sources
      tmp, outPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    fs.writeFileSync(outPath, stripTimestamps(fs.readFileSync(outPath)));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ---- the build ------------------------------------------------------------

async function main() {
  const manifest = {
    generatedBy: 'tools/build-samples.mjs',
    library: {
      name: 'Versilian Community Sample Library (VCSL)',
      publisher: 'Versilian Studios LLC',
      license: VCSL_LICENSE,
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      attribution: VCSL_ATTRIBUTION,
      url: VCSL_HOME,
      commit: VCSL_REF,
      mapCommit: VCSL_SFZ_REF,
      licenseTextSha256: null,
    },
    sets: [],
  };

  if (!PLAN_ONLY) {
    const licenseText = await cachedFetch(VCSL_RAW + 'LICENSE', cachePath(VCSL_REF, 'LICENSE'));
    manifest.library.licenseTextSha256 = sha256(licenseText);
  }

  const built = [];
  let shippedBytes = 0;
  let sourceBytes = 0;

  for (const set of SETS) {
    const sfzBytes = await cachedFetch(
      VCSL_SFZ_RAW + urlPath(set.sfz),
      cachePath(VCSL_SFZ_REF, set.sfz),
    );
    const rows = normalise(set, parseSfz(sfzBytes.toString('utf8')));
    if (!rows.length) throw new Error(`${set.id}: selection matched no recordings`);
    validate(set.id, rows);

    if (PLAN_ONLY) {
      const roots = [...new Set(rows.map((r) => r.root))];
      console.log(
        `  ${set.id.padEnd(8)} ${String(rows.length).padStart(3)} files, ` +
        `${roots.length} note${roots.length === 1 ? '' : 's'}, ` +
        `strengths ${[...new Set(rows.map((r) => `${r.bandLo}-${r.bandHi}`))].join(' ')}`,
      );
      continue;
    }

    // Pass one: decode and level, so the whole set can be scaled together.
    const shaped = [];
    const shifts = new Set();
    const mapHasTuning = rows.some((r) => r.cents !== 0);
    for (const row of rows) {
      const wav = await cachedFetch(VCSL_RAW + urlPath(row.repoPath), cachePath(VCSL_REF, row.repoPath));
      sourceBytes += wav.length;
      const decoded = decodeWav(wav);

      // Check the map against the recording before believing it. VCSL's
      // glockenspiel is filed an octave below where it rings.
      if (set.pitched) {
        const check = verifyKeyCentre(decoded.channels, decoded.sampleRate, row.root);
        if (!check.ok) {
          throw new Error(
            `${set.id}: cannot place ${path.posix.basename(row.repoPath)} — its map says MIDI ` +
            `${row.root} and the recording measures ${check.midi == null ? 'no clear pitch' : check.midi.toFixed(2)}`,
          );
        }
        shifts.add(check.octaveShift);
        row.root += 12 * check.octaveShift;
        // Where the map carries no tuning of its own, take it from the
        // measurement rather than leaving the note sharp or flat.
        //
        // Negated, and that sign is the whole point: the measurement says how
        // far the recording *is* from the note, and the number stored here is
        // how far to move it. Getting that backwards doubles the error instead
        // of removing it — the glockenspiel came out a third of a semitone
        // sharp, which is enough to sound wrong against everything else.
        if (!mapHasTuning) {
          row.cents = Math.max(-100, Math.min(100, -Math.round((check.midi - row.root) * 100)));
        }
      }

      shaped.push({ row, sourceSha: sha256(wav), audio: shape(decoded, { tailSeconds: set.tail }) });
    }
    if (shifts.size > 1) {
      throw new Error(`${set.id}: its recordings disagree about the octave (${[...shifts].join(', ')})`);
    }
    const shift = [...shifts][0] ?? 0;
    if (shift) console.log(`  ${set.id.padEnd(8)} map was ${Math.abs(shift)} octave(s) ${shift > 0 ? 'low' : 'high'} — corrected against the recordings`);
    const dir = path.join(OUT_AUDIO, set.id);
    fs.rmSync(dir, { recursive: true, force: true });

    const regions = [];
    const files = [];
    let longest = 0;
    for (const { row, sourceSha, audio } of shaped) {
      const name = `${row.root}_${row.bandLo}_${row.take}.m4a`;
      const outPath = path.join(dir, name);
      encodeAac(encodeFloatWav(audio.channels, audio.sampleRate), outPath);
      const outBytes = fs.readFileSync(outPath);
      shippedBytes += outBytes.length;
      longest = Math.max(longest, audio.seconds);
      regions.push({
        file: name,
        root: row.root,
        // Divided by 128, and the top edge from `bandHi + 1`, so that one
        // band's top edge is the *same expression on the same integer* as the
        // next band's bottom edge and the two land on the same float. Dividing
        // both edges by 127 looks equivalent and is not: 54/127 = 0.4252 and
        // 55/127 = 0.4331 leave a hole between them, and a strike landing in
        // that hole matched no band of the note being played — only a band of
        // some *other* note, which was then dragged into tune from up to two
        // octaves away. Bands here are half-open, [lo, hi).
        loVel: +(row.bandLo / 128).toFixed(6),
        hiVel: +((row.bandHi + 1) / 128).toFixed(6),
        cents: row.cents,
        take: row.take,
      });
      files.push({
        file: `public/samples/${set.id}/${name}`,
        source: row.repoPath,
        sourceSha256: sourceSha,
        sha256: sha256(outBytes),
        bytes: outBytes.length,
        seconds: +audio.seconds.toFixed(3),
      });
    }
    built.push({ id: set.id, regions, seconds: +longest.toFixed(3) });
    manifest.sets.push({
      id: set.id,
      instrument: set.instrument,
      sourceMap: set.sfz,
      files,
    });
    const cappedCount = shaped.filter((s) => s.audio.capped).length;
    const peaks = shaped.map((s) => s.audio.peak);
    console.log(
      `  ${set.id.padEnd(8)} ${String(regions.length).padStart(3)} files  ` +
      `${(files.reduce((n, f) => n + f.bytes, 0) / 1e6).toFixed(2)} MB  ` +
      `peak ${Math.min(...peaks).toFixed(2)}–${Math.max(...peaks).toFixed(2)}` +
      (cappedCount ? `  (${cappedCount} held back by the peak cap)` : ''),
    );
  }

  if (PLAN_ONLY) return;

  fs.writeFileSync(OUT_MAP, renderMap(built));
  fs.mkdirSync(path.dirname(OUT_MANIFEST), { recursive: true });
  fs.writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(
    `\n  ${(sourceBytes / 1e6).toFixed(0)} MB of recordings -> ` +
    `${(shippedBytes / 1e6).toFixed(2)} MB shipped\n` +
    `  wrote ${path.relative(ROOT, OUT_MAP)} and ${path.relative(ROOT, OUT_MANIFEST)}`,
  );
}

function renderMap(sets) {
  const body = sets
    .map((s) => {
      const regions = s.regions
        .map((r) => `    { f: '${r.file}', root: ${r.root}, lo: ${r.loVel}, hi: ${r.hiVel}, cents: ${r.cents}, rr: ${r.take} },`)
        .join('\n');
      return `  {\n    id: '${s.id}',\n    seconds: ${s.seconds},\n    regions: [\n${regions}\n    ],\n  },`;
    })
    .join('\n');
  return `// GENERATED FILE — do not edit by hand.
// Rebuild with: node tools/build-samples.mjs
//
// Which recording covers which note and which strength, for every sampled
// voice. The audio lives in public/samples/<id>/; this is only the map.
// Provenance and licensing for every file: docs/asset-manifest.json.

/** One recording, and the notes and strengths it covers. */
export interface SampleRegion {
  /** File name under \`samples/<setId>/\`. */
  f: string;
  /** The MIDI note this recording actually is. Playback is stretched from here. */
  root: number;
  /** Strength band this recording covers, 0..1 inclusive. */
  lo: number;
  hi: number;
  /** Tuning correction in cents, measured by the library's own authors. */
  cents: number;
  /** Which take this is, where a note has several. Alternating them stops
   *  repeated hits sounding bit-for-bit identical. */
  rr: number;
}

export interface SampleSet {
  id: string;
  /** The longest recording in the set, in seconds. */
  seconds: number;
  regions: SampleRegion[];
}

export const SAMPLE_SETS: SampleSet[] = [
${body}
];

const BY_ID = new Map(SAMPLE_SETS.map((s) => [s.id, s]));

export function getSampleSet(id: string): SampleSet | undefined {
  return BY_ID.get(id);
}
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
