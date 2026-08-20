import { describe, it, expect } from 'vitest';
import { encodeWav } from './wav';

const ascii = (b: Uint8Array, o: number, n: number) =>
  String.fromCharCode(...Array.from(b.slice(o, o + n)));
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const i16 = (b: Uint8Array, o: number) => {
  const v = u16(b, o);
  return v >= 0x8000 ? v - 0x10000 : v;
};

describe('WAV encoder', () => {
  it('writes a valid 16-bit stereo PCM header', () => {
    const wav = encodeWav([new Float32Array(3), new Float32Array(3)], 44100);
    expect(wav.length).toBe(44 + 3 * 2 * 2);
    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(ascii(wav, 8, 4)).toBe('WAVE');
    expect(ascii(wav, 12, 4)).toBe('fmt ');
    expect(ascii(wav, 36, 4)).toBe('data');
    expect(u16(wav, 20)).toBe(1); // PCM
    expect(u16(wav, 22)).toBe(2); // channels
    expect(u32(wav, 24)).toBe(44100); // sample rate
    expect(u16(wav, 34)).toBe(16); // bits per sample
    expect(u32(wav, 40)).toBe(3 * 2 * 2); // data size
  });

  it('converts floats to signed 16-bit and interleaves channels', () => {
    const wav = encodeWav([new Float32Array([1, -1]), new Float32Array([-1, 1])], 8000);
    expect(i16(wav, 44)).toBe(32767); // frame 0 L (+1 clamped)
    expect(i16(wav, 46)).toBe(-32768); // frame 0 R (-1)
    expect(i16(wav, 48)).toBe(-32768); // frame 1 L
    expect(i16(wav, 50)).toBe(32767); // frame 1 R
  });

  it('clamps out-of-range samples', () => {
    const wav = encodeWav([new Float32Array([2, -2])], 8000);
    expect(i16(wav, 44)).toBe(32767);
    expect(i16(wav, 46)).toBe(-32768);
  });
});
