// Reading the instrument recordings that ship with the app.
//
// Two ways in, for the same reason `platform/` exists at all: in a browser the
// files are served over HTTP and `fetch` gets them, and in the packaged desktop
// app they sit inside the app bundle on a `file://` page, where Chromium
// refuses to fetch at all. So the desktop reads them through the same IPC
// bridge the song files use.
//
// The desktop path is taken whenever the bridge exists — including in
// development, where `fetch` would work fine. That is deliberate: a path only
// exercised in a packaged build is a path nobody finds out is broken until it
// ships.

import { getDesktop } from './files';

/** The bytes of one recording, or null if it isn't there. */
export async function readSampleFile(setId: string, file: string): Promise<ArrayBuffer | null> {
  const samples = getDesktop()?.samples;
  if (samples) {
    try {
      const result = await samples.read(setId, file);
      return result.ok && result.bytes ? result.bytes : null;
    } catch {
      return null;
    }
  }
  try {
    // Relative to the page, so it works on the dev server and from the built
    // files alike (Vite's `base: './'` keeps everything relative).
    const response = await fetch(`samples/${setId}/${file}`);
    if (!response.ok) return null;
    return await response.arrayBuffer();
  } catch {
    return null;
  }
}
