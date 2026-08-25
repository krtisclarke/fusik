// Choosing which recordings become which voice, and checking the result.
//
// Separated from the build itself so it can be tested: every rule in here came
// from a real mistake, and each one is quiet rather than loud when it goes
// wrong — a strength with no recording behind it, two recordings claiming the
// same file, a note captured only once playing at one volume however gently it
// is hit.

import path from 'node:path';
import { samplePath } from './vcsl.mjs';

/** MIDI note a drum's recordings are filed under. Drums have no pitch; this is
 *  only so pitched and unpitched sets can share one lookup. */
export const DRUM_ROOT = 60;

const num = (v, fallback) => (v == null || v === '' ? fallback : Number(v));

/**
 * The strength band a recording covers, 0..127.
 *
 * Most VCSL maps say this outright (`lovel`/`hivel`). The glockenspiel instead
 * *crossfades* between its soft, medium and loud recordings, and names only
 * where each fade starts and ends. This engine switches rather than crossfades,
 * so a fade is read as a hard boundary at its midpoint. Without this the
 * glockenspiel's three strengths all read as "the whole range" and every note
 * would play three recordings at once.
 */
export function velocityBand(r) {
  let lo = num(r.lovel, null);
  let hi = num(r.hivel, null);
  if (lo == null) {
    lo = r.xfin_lovel != null ? Math.round((num(r.xfin_lovel, 0) + num(r.xfin_hivel, 127)) / 2) : 0;
  }
  if (hi == null) {
    hi = r.xfout_lovel != null ? Math.round((num(r.xfout_lovel, 0) + num(r.xfout_hivel, 127)) / 2) : 127;
  }
  return [lo, hi];
}

export function normalise(set, regions) {
  let rows = regions.filter(set.pick).map((r, i) => {
    const [loVel, hiVel] = velocityBand(r);
    return {
      repoPath: samplePath(set.sfz, r),
      // `key=` is SFZ shorthand for lokey+hikey+pitch_keycenter in one; the
      // FreePats maps use it for almost every region.
      root: set.pitched ? num(r.pitch_keycenter ?? r.key, 60) : DRUM_ROOT,
      loVel,
      hiVel,
      cents: num(r.tune, 0),
      volumeDb: num(r.volume, 0),
      seq: num(r.seq_position, i + 1),
    };
  });
  // One file may be named by several regions; keep the first.
  const seen = new Set();
  rows = rows.filter((r) => (seen.has(r.repoPath) ? false : (seen.add(r.repoPath), true)));

  if (set.pitched) {
    const { keyRange, keyStep, layers } = set.pitched;
    const roots = new Set(
      [...new Set(rows.map((r) => r.root))]
        .filter((k) => k >= keyRange[0] && k <= keyRange[1])
        .sort((a, b) => a - b)
        .filter((_, i) => i % keyStep === 0),
    );
    rows = rows.filter((r) => roots.has(r.root));
    rows = dropSparseRoots(rows, set.pitched.minLayers ?? 2);
    rows = thinLayers(rows, layers);
  } else {
    rows = thinLayers(rows, Infinity);
  }
  return rows.sort((a, b) => a.root - b.root || a.bandLo - b.bandLo || a.take - b.take);
}

/**
 * Keep at most `layers` strength levels per note, stretch what's left to cover
 * the whole range, and number the takes within each cell.
 *
 * The stretching is the part that matters. Dropping one of four recorded
 * strengths leaves a hole in the middle, and a strike landing in that hole would
 * find no recording at all — silence, on some notes and not others. Re-banding
 * makes the survivors tile 0..127 exactly.
 *
 * Renumbering matters for a duller reason: takes are numbered per *technique* in
 * the library, so merging two techniques into one voice can yield two takes both
 * called 1 — and the files they produce would overwrite each other.
 */
export function thinLayers(rows, layers) {
  const out = [];
  const byRoot = new Map();
  for (const r of rows) {
    if (!byRoot.has(r.root)) byRoot.set(r.root, []);
    byRoot.get(r.root).push(r);
  }
  for (const group of byRoot.values()) {
    const bandKey = (r) => `${r.loVel}-${r.hiVel}`;
    const bands = [...new Map(group.map((r) => [bandKey(r), r])).values()]
      .sort((a, b) => a.loVel - b.loVel || a.hiVel - b.hiVel);
    let keep = bands;
    if (Number.isFinite(layers) && bands.length > layers) {
      const idx = [...new Set(
        Array.from({ length: layers }, (_, i) => Math.round((i * (bands.length - 1)) / (layers - 1))),
      )];
      keep = idx.map((i) => bands[i]);
    }
    const keepKeys = new Set(keep.map(bandKey));
    let lo = 0;
    keep.forEach((band, i) => {
      // Every band gets at least one strength value, and they run in order.
      // Without the reserve, a library band that already claims the whole range
      // swallows everything after it and the next band comes out running
      // backwards — from 128 down to 54, a range no hit can ever land in.
      const stillToPlace = keep.length - i - 1;
      const hi = i === keep.length - 1
        ? 127
        : Math.min(Math.max(band.hiVel, lo), 127 - stillToPlace);
      const cell = group.filter((r) => bandKey(r) === bandKey(band));
      cell.sort((a, b) => a.seq - b.seq || a.repoPath.localeCompare(b.repoPath));
      cell.forEach((r, take) => {
        r.bandLo = lo;
        r.bandHi = hi;
        r.take = take + 1;
      });
      out.push(...cell);
      lo = hi + 1;
    });
    void keepKeys;
  }
  return out;
}

/**
 * Drop a note the library recorded at only one strength.
 *
 * VCSL has the odd note captured once where its neighbours were captured three
 * or four times — B4 on the Kawai is the only loud-only note in the whole
 * keyboard. Kept, it would play at that one strength however gently the child
 * hit it, so a tune would jump in loudness on that note alone. Dropped, the
 * note is covered by its neighbour a semitone away, which nobody can hear.
 */
export function dropSparseRoots(rows, minLayers) {
  const bandsPerRoot = new Map();
  for (const r of rows) {
    if (!bandsPerRoot.has(r.root)) bandsPerRoot.set(r.root, new Set());
    bandsPerRoot.get(r.root).add(`${r.loVel}-${r.hiVel}`);
  }
  const keep = [...bandsPerRoot].filter(([, b]) => b.size >= minLayers).map(([k]) => k);
  if (keep.length < 2) return rows; // never thin a set down to nothing
  const keepSet = new Set(keep);
  return rows.filter((r) => keepSet.has(r.root));
}

/** Refuse to ship a map with a hole in it, or two recordings claiming one file. */
export function validate(setId, rows) {
  const files = new Set();
  for (const r of rows) {
    const name = `${r.root}_${r.bandLo}_${r.take}`;
    if (files.has(name)) throw new Error(`${setId}: two recordings would both be written as ${name}`);
    files.add(name);
  }
  const byRoot = new Map();
  for (const r of rows) {
    if (!byRoot.has(r.root)) byRoot.set(r.root, []);
    byRoot.get(r.root).push(r);
  }
  for (const [root, group] of byRoot) {
    const bands = [...new Map(group.map((r) => [`${r.bandLo}-${r.bandHi}`, r])).values()]
      .sort((a, b) => a.bandLo - b.bandLo);
    let expect = 0;
    for (const b of bands) {
      if (b.bandLo !== expect) {
        throw new Error(`${setId}: note ${root} has no recording for strength ${expect}..${b.bandLo - 1}`);
      }
      expect = b.bandHi + 1;
    }
    if (expect !== 128) throw new Error(`${setId}: note ${root} covers only up to strength ${expect - 1}`);
  }
}

