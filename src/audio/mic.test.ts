import { describe, it, expect, vi, afterEach } from 'vitest';
import { MicRecorder } from './mic';

/**
 * A stand-in for the browser's capture machinery. Nothing here opens a real
 * microphone — what is being checked is which device the app *asks* for, and
 * what it does when that device has gone.
 */
function stubCapture(opts: { failExact?: boolean } = {}) {
  const calls: MediaStreamConstraints[] = [];
  const track = { stop: () => {} };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async (c: MediaStreamConstraints) => {
        calls.push(c);
        const audio = c.audio as MediaTrackConstraints | undefined;
        if (opts.failExact && audio && 'deviceId' in audio) {
          throw new Error('device not found');
        }
        return stream;
      },
    },
  });
  class FakeRecorder {
    state = 'inactive';
    ondataavailable: unknown = null;
    onstop: unknown = null;
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
    }
    static isTypeSupported() {
      return true;
    }
  }
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('which microphone a take is recorded from', () => {
  it('asks for the chosen one by name', async () => {
    const calls = stubCapture();
    await new MicRecorder().start('mic-headset');
    expect(calls).toHaveLength(1);
    expect(calls[0].audio).toMatchObject({ deviceId: { exact: 'mic-headset' } });
  });

  it('asks for whatever the computer uses when nothing is chosen', async () => {
    const calls = stubCapture();
    await new MicRecorder().start();
    expect(calls).toHaveLength(1);
    expect(calls[0].audio).not.toHaveProperty('deviceId');
  });

  it('falls back to the computer’s own microphone when the chosen one has gone', async () => {
    // The bug this exists for: device ids are not stable, so a headset chosen
    // last week can simply not be there — and asking for it by name then fails
    // outright. Without the fallback that is a child who cannot record at all.
    const calls = stubCapture({ failExact: true });
    await new MicRecorder().start('mic-that-was-unplugged');
    expect(calls).toHaveLength(2);
    expect(calls[0].audio).toMatchObject({ deviceId: { exact: 'mic-that-was-unplugged' } });
    expect(calls[1].audio).not.toHaveProperty('deviceId');
  });

  it('keeps the noise clean-up on whichever microphone it ends up with', async () => {
    const calls = stubCapture({ failExact: true });
    await new MicRecorder().start('gone');
    for (const call of calls) {
      expect(call.audio).toMatchObject({ echoCancellation: true, noiseSuppression: true });
    }
  });
});
