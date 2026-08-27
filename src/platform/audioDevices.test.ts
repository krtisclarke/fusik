import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  listAudioDevices,
  readInputDevice,
  readOutputDevice,
  writeInputDevice,
  writeOutputDevice,
} from './audioDevices';
import type { StorageLike } from './storage';

/** A stand-in for the browser's own store, so nothing here touches a real one. */
function fakeStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function withDevices(devices: Partial<MediaDeviceInfo>[]) {
  vi.stubGlobal('navigator', {
    mediaDevices: { enumerateDevices: async () => devices as MediaDeviceInfo[] },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('remembering the chosen devices', () => {
  it('round-trips a choice', () => {
    const s = fakeStorage();
    writeInputDevice('mic-abc', s);
    writeOutputDevice('spk-xyz', s);
    expect(readInputDevice(s)).toBe('mic-abc');
    expect(readOutputDevice(s)).toBe('spk-xyz');
  });

  it('an empty choice means "whatever the computer uses", and is not stored', () => {
    const s = fakeStorage();
    writeInputDevice('mic-abc', s);
    writeInputDevice('', s);
    expect(readInputDevice(s)).toBe('');
    expect(s.map.size).toBe(0);
  });

  it('survives storage being unavailable', () => {
    expect(readInputDevice(null)).toBe('');
    expect(() => writeInputDevice('mic-abc', null)).not.toThrow();
  });

  it('survives storage that throws', () => {
    const angry: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(readInputDevice(angry)).toBe('');
    expect(() => writeOutputDevice('spk-xyz', angry)).not.toThrow();
  });
});

describe('listing devices', () => {
  it('splits microphones from speakers and keeps their names', async () => {
    withDevices([
      { kind: 'audioinput', deviceId: 'in1', label: 'Headset Mic' },
      { kind: 'videoinput', deviceId: 'cam', label: 'Webcam' },
      { kind: 'audiooutput', deviceId: 'out1', label: 'Headphones' },
    ]);
    const lists = await listAudioDevices();
    expect(lists.inputs).toEqual([{ id: 'in1', label: 'Headset Mic' }]);
    expect(lists.outputs).toEqual([{ id: 'out1', label: 'Headphones' }]);
    expect(lists.labelled).toBe(true);
  });

  it('says so when the names are hidden, and numbers them instead', async () => {
    // What the browser hands back before the machine has granted a microphone.
    withDevices([
      { kind: 'audioinput', deviceId: '', label: '' },
      { kind: 'audiooutput', deviceId: '', label: '' },
    ]);
    const lists = await listAudioDevices();
    expect(lists.labelled).toBe(false);
    expect(lists.inputs[0].label).toBe('Microphone 1');
    expect(lists.outputs[0].label).toBe('Speakers 1');
  });

  it('gives back empty lists rather than throwing when the browser refuses', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: async () => {
          throw new Error('nope');
        },
      },
    });
    await expect(listAudioDevices()).resolves.toEqual({ inputs: [], outputs: [], labelled: true });
  });

  it('gives back empty lists where the browser has no device list at all', async () => {
    vi.stubGlobal('navigator', {});
    await expect(listAudioDevices()).resolves.toEqual({ inputs: [], outputs: [], labelled: true });
  });
});
