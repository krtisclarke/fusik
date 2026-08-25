// The shipped recordings and the licence record must agree, exactly.
//
// Two failures this catches, both of which have happened here. A build that
// stops half way leaves the map describing files that aren't there, and every
// note of that instrument falls back to synthesis with nothing to say why. And
// this project lives in an iCloud-synced folder, which quietly leaves duplicate
// copies named "… 2.m4a" behind after a rebuild — files nothing refers to,
// carrying no licence record, heading for the repository.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/asset-manifest.json'), 'utf8'));
const listed = manifest.sets.flatMap((s) => s.files);

function onDisk() {
  const dir = path.join(ROOT, 'public/samples');
  const out = [];
  for (const set of fs.readdirSync(dir)) {
    const setDir = path.join(dir, set);
    if (!fs.statSync(setDir).isDirectory()) continue;
    for (const file of fs.readdirSync(setDir)) out.push(`public/samples/${set}/${file}`);
  }
  return out.sort();
}

describe('shipped recordings', () => {
  it('are all recorded in the licence manifest', () => {
    const known = new Set(listed.map((f) => f.file));
    expect(onDisk().filter((f) => !known.has(f))).toEqual([]);
  });

  it('are all actually present', () => {
    expect(listed.filter((f) => !fs.existsSync(path.join(ROOT, f.file))).map((f) => f.file)).toEqual([]);
  });

  it('match the manifest byte for byte', () => {
    const wrong = listed.filter((f) => {
      const bytes = fs.readFileSync(path.join(ROOT, f.file));
      return bytes.length !== f.bytes
        || crypto.createHash('sha256').update(bytes).digest('hex') !== f.sha256;
    });
    expect(wrong.map((f) => f.file)).toEqual([]);
  });

  it('name their source and licence', () => {
    const libraries = Object.entries(manifest.libraries);
    expect(libraries.length).toBeGreaterThan(0);
    for (const [id, lib] of libraries) {
      expect(lib.license, id).toBe('CC0-1.0');
      expect(lib.commit, id).toMatch(/^[0-9a-f]{40}$/);
      expect(lib.mapCommit, id).toMatch(/^[0-9a-f]{40}$/);
      expect(lib.licenseTextSha256, id).toMatch(/^[0-9a-f]{64}$/);
    }
    for (const set of manifest.sets) {
      // Every set must name a library that is actually recorded above — an
      // unknown key would mean recordings shipping with no licence behind them.
      expect(manifest.libraries[set.library], set.id).toBeTruthy();
      expect(set.sources.length, set.id).toBeGreaterThan(0);
    }
    for (const f of listed) {
      expect(f.source, f.file).toBeTruthy();
      expect(f.sourceSha256, f.file).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

// How the map's strength bands must tile is checked where it is used, against
// the real generated data: src/audio/sampler.test.ts.
describe('the map the engine reads', () => {
  it('names only files the manifest ships', async () => {
    const { SAMPLE_SETS } = await import('../src/model/sampleSets.ts');
    const shipped = new Set(listed.map((f) => f.file));
    const wanted = SAMPLE_SETS.flatMap((s) => s.regions.map((r) => `public/samples/${s.id}/${r.f}`));
    expect(wanted.filter((f) => !shipped.has(f))).toEqual([]);
    expect(wanted).toHaveLength(listed.length);
  });

});
