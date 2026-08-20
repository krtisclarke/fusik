// Encode raw audio (float samples per channel) into a 16-bit PCM WAV file.
//
// Pure and platform-free — takes plain Float32Arrays, not an AudioBuffer — so it
// runs in a test as easily as in the browser. The render step (render.ts) hands
// it the channel data from an OfflineAudioContext.

/** Encode channel sample data into a standard 16-bit PCM WAV byte array. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array<ArrayBuffer> {
  const numChannels = Math.max(1, channels.length);
  const numFrames = channels[0]?.length ?? 0;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  let p = 0;
  const str = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(p++, s.charCodeAt(i));
  };
  const u32 = (v: number) => {
    view.setUint32(p, v, true);
    p += 4;
  };
  const u16 = (v: number) => {
    view.setUint16(p, v, true);
    p += 2;
  };

  // RIFF header
  str('RIFF');
  u32(36 + dataSize);
  str('WAVE');
  // fmt chunk
  str('fmt ');
  u32(16); // PCM chunk size
  u16(1); // audio format = PCM
  u16(numChannels);
  u32(sampleRate);
  u32(sampleRate * blockAlign); // byte rate
  u16(blockAlign);
  u16(16); // bits per sample
  // data chunk
  str('data');
  u32(dataSize);

  // Interleave channels, clamp, convert float [-1,1] to signed 16-bit.
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i] ?? 0));
      view.setInt16(p, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      p += 2;
    }
  }

  return new Uint8Array(buffer);
}
