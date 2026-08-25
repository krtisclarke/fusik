// The release settings that silent auto-update depends on, pinned.
//
// Every assertion here guards against a failure that already happened once or
// would only surface weeks later on a child's machine: an installer filename
// with a space in it that the updater can 404-chases forever, an installer
// that climbs back into Program Files and starts raising admin prompts on
// every update, a release published without the file installed apps read.
// Editing any of these on purpose is fine — this test is here so it can't
// happen by accident, silently.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const workflow = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'windows-installer.yml'),
  'utf8',
);

describe('the shipping pattern', () => {
  it('names the installer without spaces, so the updater can find it', () => {
    // electron-builder writes spaces as dashes into latest.yml; GitHub renames
    // uploaded assets with dots. Only a space-free name means every system
    // agrees, and the updater's download URL actually exists.
    expect(pkg.build.win.artifactName).toBeTruthy();
    expect(pkg.build.win.artifactName).not.toMatch(/\s/);
  });

  it('installs per-user and one-click, so updates stay silent', () => {
    // Program Files is admin territory: an app there raises an elevation
    // prompt on every self-update and broke the pinned taskbar shortcut.
    expect(pkg.build.nsis.oneClick).toBe(true);
    expect(pkg.build.nsis.perMachine).toBe(false);
  });

  it('publishes to the GitHub repo installed apps actually watch', () => {
    expect(pkg.build.publish).toEqual({
      provider: 'github',
      owner: 'krtisclarke',
      repo: 'fusik',
    });
  });

  it('builds for x64 and leaves publishing to the workflow', () => {
    // Unpinned, electron-builder matches the build machine's chip — this Mac
    // would ship Windows-on-ARM. And on CI it tries to publish itself, then
    // fails for want of a token; publishing is the workflow's one job.
    expect(pkg.scripts['package:win']).toContain('--x64');
    expect(pkg.scripts['package:win']).toContain('--publish never');
  });

  it('lets the workflow write releases, and ships all three update files', () => {
    // The default workflow token is read-only (a 403 found that), and a
    // release without latest.yml is invisible to installed apps.
    expect(workflow).toContain('contents: write');
    for (const piece of ['release/*.exe', 'release/*.blockmap', 'release/latest.yml']) {
      expect(workflow).toContain(piece);
    }
  });

  it('keeps the updater wired into the desktop shell', () => {
    const main = fs.readFileSync(path.join(ROOT, 'electron', 'main.cjs'), 'utf8');
    expect(main).toContain("require('electron-updater')");
    expect(pkg.dependencies['electron-updater']).toBeTruthy();
  });
});
