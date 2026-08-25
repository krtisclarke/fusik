// Encode raw audio (float samples per channel) into an MP3 file.
//
// Pure and platform-free like wav.ts beside it: plain Float32Arrays in, bytes
// out, so it runs in a test as easily as in the browser. The compression is
// done by lamejs (the maintained @breezystack build), a pure-JavaScript port
// of the LAME encoder — bundled with the app, nothing external, and fast
// enough that a whole song encodes in well under a second.
//
// Why MP3 and not the AAC the recordings use: the app can *decode* AAC
// everywhere, but encoding it needs either the operating system (different on
// every platform, absent in tests) or real time (a MediaRecorder can only eat
// a live stream). One small library that behaves identically on every machine
// beats both. lamejs is LGPL-licensed — noted in the licensing section of
// docs/DEVELOPMENT.md alongside the CC0 recordings.

import { Mp3Encoder } from '@breezystack/lamejs';

/** How many samples lamejs likes to chew per call — its own frame multiple. */
const CHUNK = 1152;

/** The bitrate a song is shipped at. Plenty for a phone speaker or a laptop,
 *  and about a tenth the size of the same song as WAV. */
export const MP3_KBPS = 192;

/** Float sample (−1..1, may overshoot) to the int16 lamejs eats. */
function toInt16(channel: Float32Array): Int16Array {
  const out = new Int16Array(channel.length);
  for (let i = 0; i < channel.length; i++) {
    const v = Math.max(-1, Math.min(1, channel[i]));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

/** Encode channel sample data into an MP3 byte array. */
export function encodeMp3(
  channels: Float32Array[],
  sampleRate: number,
  kbps: number = MP3_KBPS,
): Uint8Array<ArrayBuffer> {
  const left = toInt16(channels[0] ?? new Float32Array(0));
  const right = channels.length > 1 ? toInt16(channels[1]) : left;
  const encoder = new Mp3Encoder(2, sampleRate, kbps);

  const parts: Uint8Array[] = [];
  for (let at = 0; at < left.length; at += CHUNK) {
    const l = left.subarray(at, at + CHUNK);
    const r = right.subarray(at, at + CHUNK);
    const frame = encoder.encodeBuffer(l, r);
    if (frame.length > 0) parts.push(frame);
  }
  const tail = encoder.flush();
  if (tail.length > 0) parts.push(tail);

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(new ArrayBuffer(total));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
