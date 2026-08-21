// Reading and writing recordings, which live beside their song on disk.
//
// Recording is a desktop feature. In a plain browser there is nowhere to put a
// megabyte of audio that survives a reload — local storage is far too small —
// and offering it there would mean a child records their voice and loses it.
// `clipsAvailable()` is what the UI asks before showing the button.

import { getDesktop } from './files';

export function clipsAvailable(): boolean {
  return !!getDesktop()?.clips;
}

/** Save a recording next to its song. Returns false if it couldn't be written. */
export async function writeClip(
  songId: string,
  clipId: string,
  wav: Uint8Array,
): Promise<boolean> {
  const clips = getDesktop()?.clips;
  if (!clips) return false;
  try {
    const result = await clips.write(songId, clipId, wav);
    return !!result.ok;
  } catch {
    return false;
  }
}

/** The raw bytes of a recording, or null if it isn't there. */
export async function readClip(songId: string, clipId: string): Promise<ArrayBuffer | null> {
  const clips = getDesktop()?.clips;
  if (!clips) return null;
  try {
    const result = await clips.read(songId, clipId);
    return result.ok && result.bytes ? result.bytes : null;
  } catch {
    return null;
  }
}

export async function deleteClip(songId: string, clipId: string): Promise<void> {
  const clips = getDesktop()?.clips;
  if (!clips) return;
  try {
    await clips.remove(songId, clipId);
  } catch {
    // Already gone, or unreachable. Nothing to put right.
  }
}
