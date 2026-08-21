// Recording the child's own voice.
//
// Everything else this app makes is described rather than stored: a few numbers
// say "kick, here, this hard", and the engine builds the sound every time. A
// recording can't be described, only kept — so this is the one place the app
// takes in audio from outside itself.
//
// The path is deliberately plain. The browser's own recorder captures the
// microphone; the result is decoded once into raw samples, and written out as a
// 16-bit WAV through the same encoder Export already uses. That means what
// lands next to a song is an ordinary .wav file anyone can open, rather than
// whatever compressed format the browser happened to prefer.

import { encodeWav } from './wav';

export interface Recording {
  /** A finished 16-bit WAV, ready to be written to a file. */
  wav: Uint8Array<ArrayBuffer>;
  /** How long it actually is. The timeline needs this to draw the block. */
  seconds: number;
  /** Loudest sample, 0..1 — used to tell a silent take from a real one. */
  peak: number;
}

export class MicRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  /** Is a take running right now. */
  isRecording(): boolean {
    return this.recorder?.state === 'recording';
  }

  /**
   * Ask for the microphone and start capturing. Throws if permission is
   * refused or there is no microphone — the caller turns that into something a
   * child can read.
   *
   * Echo cancellation and noise suppression are left on: this is a laptop
   * microphone in a room with the song playing, not a studio, and the browser's
   * own clean-up is far better than nothing.
   */
  async start(): Promise<void> {
    if (this.isRecording()) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.stream = stream;
    this.chunks = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder = recorder;
    recorder.start();
  }

  /**
   * Finish the take and hand back a WAV. Returns null if nothing was captured.
   * The microphone is released either way — a recording light left on after the
   * child has stopped is its own kind of alarming.
   */
  async stop(ctx: BaseAudioContext): Promise<Recording | null> {
    const recorder = this.recorder;
    if (!recorder) {
      this.release();
      return null;
    }
    const finished = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    if (recorder.state !== 'inactive') recorder.stop();
    await finished;
    this.recorder = null;
    this.release();

    if (this.chunks.length === 0) return null;
    const blob = new Blob(this.chunks, { type: this.chunks[0].type || 'audio/webm' });
    this.chunks = [];
    const bytes = await blob.arrayBuffer();
    if (bytes.byteLength === 0) return null;

    const decoded = await ctx.decodeAudioData(bytes);
    const channels: Float32Array[] = [];
    let peak = 0;
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const data = decoded.getChannelData(c);
      channels.push(data);
      for (let i = 0; i < data.length; i++) {
        const a = data[i] < 0 ? -data[i] : data[i];
        if (a > peak) peak = a;
      }
    }
    if (channels.length === 0) return null;
    return {
      wav: encodeWav(channels, decoded.sampleRate),
      seconds: decoded.duration,
      peak,
    };
  }

  /** Drop the microphone. Safe to call at any time, including twice. */
  release(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
  }
}

/** Is recording from a microphone possible here at all? */
export function micAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'
  );
}
