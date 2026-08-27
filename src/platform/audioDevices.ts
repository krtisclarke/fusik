// Which microphone the app listens to, and which speakers it plays out of.
//
// Until now it used whatever the machine's defaults happened to be, which is
// right until it isn't: a headset plugged in, a monitor with speakers that
// grabs the default output, a webcam microphone across the room picked over
// the headset on your head. None of that is fixable from inside the app
// without this, and "go and change it in Windows Settings, then restart the
// app" is not an answer to give a child.
//
// Both lists come from the browser's own device list. Two things about it are
// worth knowing and are handled here rather than at the call sites:
//
//  - Device *labels* are hidden until the machine has granted microphone
//    access at least once. Before that the list is real but anonymous, so
//    there is a way to ask for permission purely to learn the names.
//  - Device ids are not stable for ever. A remembered device can simply be
//    gone next time — unplugged, or renumbered — and asking for it by id then
//    fails. Every use falls back to the system default rather than erroring.

import { browserStorage, type StorageLike } from './storage';

const INPUT_KEY = 'beatbox.audio.input.v1';
const OUTPUT_KEY = 'beatbox.audio.output.v1';

/** One pickable device. `id` empty means "whatever the machine is set to". */
export interface AudioDevice {
  id: string;
  label: string;
}

export interface AudioDeviceLists {
  inputs: AudioDevice[];
  outputs: AudioDevice[];
  /** False when the machine hasn't granted the microphone, so names are hidden. */
  labelled: boolean;
}

export function deviceSelectionSupported(): boolean {
  return (
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.enumerateDevices === 'function'
  );
}

/** Can the app send sound to a chosen device, or only to the default one? */
export function outputSwitchingSupported(): boolean {
  return typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;
}

/**
 * Every microphone and every set of speakers this machine can offer.
 *
 * A device the browser calls "default" is listed under its own plain name, so
 * the list reads like the machine's own list rather than like a browser's.
 */
export async function listAudioDevices(): Promise<AudioDeviceLists> {
  if (!deviceSelectionSupported()) return { inputs: [], outputs: [], labelled: true };
  let devices: MediaDeviceInfo[];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch {
    return { inputs: [], outputs: [], labelled: true };
  }
  const audio = devices.filter((d) => d.kind === 'audioinput' || d.kind === 'audiooutput');
  // Nothing at all is different from "there but nameless": an empty list means
  // no permission has ever been given, and there is nothing to say about names.
  const labelled = audio.length === 0 || audio.some((d) => !!d.label);
  const pick = (kind: MediaDeviceKind, fallback: string): AudioDevice[] =>
    devices
      .filter((d) => d.kind === kind)
      .map((d, i) => ({ id: d.deviceId, label: d.label || `${fallback} ${i + 1}` }));
  return {
    inputs: pick('audioinput', 'Microphone'),
    outputs: pick('audiooutput', 'Speakers'),
    labelled,
  };
}

/**
 * Ask for the microphone once, purely so the device list gains its names, and
 * hand it straight back.
 *
 * Nothing is recorded and nothing is kept; the stream is stopped the moment it
 * arrives. Without this the picker can only offer "Microphone 1, Microphone 2",
 * which is no more use than the guess it replaces.
 */
export async function revealDeviceNames(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    return true;
  } catch {
    return false;
  }
}

function read(key: string, storage: StorageLike | null): string {
  if (!storage) return '';
  try {
    return storage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function write(key: string, value: string, storage: StorageLike | null): void {
  if (!storage) return;
  try {
    if (value) storage.setItem(key, value);
    else storage.removeItem(key);
  } catch {
    // Out of room, or storage denied. The choice holds for this session and is
    // forgotten next time, which is better than refusing to change it at all.
  }
}

export const readInputDevice = (s: StorageLike | null = browserStorage()) => read(INPUT_KEY, s);
export const writeInputDevice = (id: string, s: StorageLike | null = browserStorage()) =>
  write(INPUT_KEY, id, s);
export const readOutputDevice = (s: StorageLike | null = browserStorage()) => read(OUTPUT_KEY, s);
export const writeOutputDevice = (id: string, s: StorageLike | null = browserStorage()) =>
  write(OUTPUT_KEY, id, s);
