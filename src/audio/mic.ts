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

export interface Recording {
  /** The recording exactly as it was captured, ready to be written to a file. */
  bytes: Uint8Array<ArrayBuffer>;
  /** File extension for those bytes, including the dot. */
  extension: string;
  /** Decoded, so it can be played straight away without re-reading the file. */
  buffer: AudioBuffer;
  /** How long it actually is. The timeline needs this to draw the block. */
  seconds: number;
  /** Loudest sample, 0..1 — used to tell a silent take from a real one. */
  peak: number;
}

/**
 * What to record in, best first.
 *
 * AAC in an MP4 container — a `.m4a` — is the one worth asking for by name.
 * It is what makes a recording both small and *openable*: a thirty-fold saving
 * on raw WAV, and a file that plays on a double-click on macOS and Windows
 * alike, which matters when the whole point of keeping songs as files is that a
 * grown-up can find them. Asking for plain `audio/mp4` is not the same thing —
 * this engine answers that with Opus inside an MP4, which nothing outside a
 * browser will open.
 */
const PREFERRED_FORMATS = [
  { mime: 'audio/mp4;codecs=mp4a.40.2', extension: '.m4a' },
  { mime: 'audio/webm;codecs=opus', extension: '.webm' },
  { mime: 'audio/webm', extension: '.webm' },
];

function bestFormat(): { mime?: string; extension: string } {
  for (const format of PREFERRED_FORMATS) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(format.mime)) {
      return format;
    }
  }
  // Whatever the browser picks for itself. `.webm` is the near-certain answer,
  // and a wrong extension still plays in the app — only double-clicking suffers.
  return { extension: '.webm' };
}

export class MicRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private extension = '.webm';

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
  async start(deviceId = ''): Promise<void> {
    if (this.isRecording()) return;
    const shaping = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    // A chosen microphone is asked for by name; if it has been unplugged since
    // it was chosen, that request fails outright, so fall back to whatever the
    // machine is set to rather than leaving the child unable to record at all.
    let stream: MediaStream | null = null;
    if (deviceId) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { ...shaping, deviceId: { exact: deviceId } },
        });
      } catch {
        stream = null;
      }
    }
    if (!stream) {
      stream = await navigator.mediaDevices.getUserMedia({ audio: shaping });
    }
    this.stream = stream;
    this.chunks = [];
    const format = bestFormat();
    this.extension = format.extension;
    const recorder = format.mime
      ? new MediaRecorder(stream, { mimeType: format.mime })
      : new MediaRecorder(stream);
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

    // Decoded only to measure it and to play it back straight away. What gets
    // *stored* is the capture itself: re-encoding it to WAV would inflate a
    // recording more than thirtyfold for no gain a child would ever notice.
    // decodeAudioData takes ownership of the buffer it is given, so it gets a
    // copy and the original survives to be written to disk.
    const decoded = await ctx.decodeAudioData(bytes.slice(0));
    let peak = 0;
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const data = decoded.getChannelData(c);
      for (let i = 0; i < data.length; i++) {
        const a = data[i] < 0 ? -data[i] : data[i];
        if (a > peak) peak = a;
      }
    }
    if (decoded.numberOfChannels === 0) return null;
    return {
      bytes: new Uint8Array(bytes),
      extension: this.extension,
      buffer: decoded,
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
