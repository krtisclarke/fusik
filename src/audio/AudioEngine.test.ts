// Engine tests for what actually reaches the speakers.
//
// The scheduler is the one place where a pure-function test isn't enough: the
// bugs live in how the transport sets up each window, not in the window maths.
// So these drive the real AudioEngine and record every note it hands to Web
// Audio, with the audio layer itself stubbed out — no sound card required.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as P from '../model/project';
import { beatsToSeconds } from '../model/time';

/** Every note the engine scheduled: which voice, at what audio-clock time. */
const scheduled: { voiceId: string; when: number }[] = [];

vi.mock('./synth', () => ({
  getTrigger:
    (voiceId: string) =>
    (_ctx: unknown, _dest: unknown, when: number) =>
      void scheduled.push({ voiceId, when }),
}));

vi.mock('./master', () => ({
  createMasterChain: () => ({ input: fakeNode(), output: fakeNode() }),
}));

function fakeNode(): any {
  const node: any = {
    connect: (next: unknown) => next,
    disconnect: () => undefined,
    gain: { value: 1, setTargetAtTime: () => undefined },
    // The per-track echo chain builds a delay and a filter too.
    delayTime: { value: 0 },
    frequency: { value: 0 },
    type: '',
  };
  return node;
}

/** Every recording the engine started, and what happened to it. */
interface FakeSource {
  startedAt: number | null;
  stoppedAt: number | null;
  stopCalls: number;
}
const sources: FakeSource[] = [];

/** A stand-in AudioContext whose clock we advance by hand. */
class FakeAudioContext {
  currentTime = 0;
  state = 'running';
  destination = fakeNode();
  createGain = () => fakeNode();
  createDelay = () => fakeNode();
  createBiquadFilter = () => fakeNode();
  createBufferSource = () => {
    const record: FakeSource = { startedAt: null, stoppedAt: null, stopCalls: 0 };
    sources.push(record);
    const node: any = fakeNode();
    node.buffer = null;
    node.onended = null;
    node.start = (when?: number) => {
      record.startedAt = when ?? 0;
    };
    node.stop = (when?: number) => {
      record.stopCalls++;
      if (record.stoppedAt == null) record.stoppedAt = when ?? -1;
    };
    return node;
  };
  resume = async () => undefined;
  close = async () => undefined;
}

let ctx: FakeAudioContext;

beforeEach(() => {
  scheduled.length = 0;
  sources.length = 0;
  vi.useFakeTimers();
  ctx = new FakeAudioContext();
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        return ctx as unknown as AudioContext;
      }
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Import fresh each time so the module-level engine singleton is clean. */
async function newEngine() {
  vi.resetModules();
  const { AudioEngine } = await import('./AudioEngine');
  return new AudioEngine();
}

/** Run the scheduler forward `seconds` of audio-clock time. */
async function advance(seconds: number) {
  const stepMs = 25;
  for (let elapsed = 0; elapsed < seconds * 1000; elapsed += stepMs) {
    ctx.currentTime += stepMs / 1000;
    await vi.advanceTimersByTimeAsync(stepMs);
  }
}

/** A one-bar song with a single kick on the very first beat. */
function songWithDownbeat() {
  const project = P.createDefaultProject();
  const oneBar = P.setSectionLength(project, project.sections[0].id, 1);
  const kick = oneBar.tracks[0];
  return P.addNote(oneBar, kick.id, P.createNote(oneBar.sections[0].id, 0));
}

describe('the downbeat', () => {
  it('plays on the first pass after pressing Play', async () => {
    // The regression: each scheduling window is (lo, hi], and play() used to
    // open the first one at exactly the beat it starts from — so a note on beat
    // 0 fell outside it. The child drops a kick on the first square, presses
    // Play, and hears nothing until the loop comes round again.
    const engine = await newEngine();
    engine.setProject(songWithDownbeat());
    await engine.play();
    await advance(0.3);

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].voiceId).toBe('kick');
  });

  it('plays even with looping off, where a miss would be permanent', async () => {
    const engine = await newEngine();
    engine.setProject(songWithDownbeat());
    engine.setLooping(false);
    await engine.play();
    await advance(0.3);

    expect(scheduled).toHaveLength(1);
  });

  it('is not scheduled twice as the windows advance', async () => {
    const engine = await newEngine();
    engine.setProject(songWithDownbeat()); // 1 bar = 4 beats = 2s at 120bpm
    await engine.play();
    await advance(1.5); // less than one full loop

    expect(scheduled).toHaveLength(1);
  });
});

describe('pressing Play after the song got shorter', () => {
  it('starts over instead of running off the end in silence', async () => {
    // Pause near the end of a two-part song, delete the part you were in, then
    // press Play. The saved position now sits past the end of the song.
    const engine = await newEngine();
    let project = P.addSection(songWithDownbeat()); // A B, 2 bars total
    engine.setProject(project);
    engine.setLooping(false);
    await engine.play();
    await advance(3.5); // into part B
    engine.pause();
    scheduled.length = 0;

    project = P.removeArrangementEntry(project, project.arrangement[1].id); // drop B
    engine.setProject(project);

    await engine.play();
    await advance(0.3);

    expect(scheduled).toHaveLength(1); // the downbeat, heard again
  });
});

describe('changing the song while it plays', () => {
  it('carries the playhead straight on when a part is made longer', async () => {
    // Stretching the part you're in is a normal thing to do mid-play. The
    // transport counts absolute beats and wraps them by the loop length, so
    // without re-anchoring the wrapped position lands somewhere unrelated —
    // the playhead teleports and takes a stretch of silence with it.
    const engine = await newEngine();
    const project = songWithDownbeat(); // 1 bar = 4 beats
    engine.setProject(project);
    await engine.play();
    await advance(5); // ~10 beats absolute: two and a half loops in

    const before = engine.getPositionBeats();
    engine.setProject(P.setSectionLength(project, project.sections[0].id, 4)); // 16 beats
    await advance(0.1); // one tick re-anchors

    const elapsedBeats = 0.1 * 2; // 120bpm
    expect(engine.getPositionBeats()).toBeCloseTo(before + elapsedBeats, 1);
  });

  it('does not replay notes it has already scheduled when re-anchoring', async () => {
    const engine = await newEngine();
    const project = songWithDownbeat();
    engine.setProject(project);
    await engine.play();
    await advance(0.3);
    const before = scheduled.length;

    engine.setProject(P.setSectionLength(project, project.sections[0].id, 4));
    await advance(0.1);

    expect(scheduled.length).toBe(before); // no duplicate downbeat
  });
});

describe('arrangement playback', () => {
  it('plays a part once per slot it occupies in the song', async () => {
    // A A: one note, in one part, played twice per pass through the song.
    const engine = await newEngine();
    let project = songWithDownbeat(); // A, 1 bar, kick on beat 0
    project = P.repeatSection(project, project.sections[0].id); // A A
    engine.setProject(project);
    await engine.play();
    await advance(beatsToSeconds(8, 120) - 0.2); // just under one full pass

    expect(scheduled).toHaveLength(2);
  });
});

/** A busy one-bar loop: three tracks, a hit on every sixteenth. */
function busyBar() {
  let project = P.createDefaultProject();
  project = P.setSectionLength(project, project.sections[0].id, 1);
  const sectionId = project.sections[0].id;
  for (const track of [...project.tracks]) {
    for (let i = 0; i < 16; i++) {
      project = P.addNote(project, track.id, P.createNote(sectionId, i * 0.25, 0.25));
    }
  }
  return project;
}

/** How many notes share their loudest single instant. */
function worstStack(): number {
  const byTime = new Map<number, number>();
  for (const s of scheduled) byTime.set(s.when, (byTime.get(s.when) ?? 0) + 1);
  return Math.max(0, ...byTime.values());
}

describe('a stalled scheduler', () => {
  it('does not fire every missed note at once when the main thread was blocked', async () => {
    // The scheduler hands notes to Web Audio ahead of time, in windows of
    // (lastScheduled, horizon]. If the timer can't run for a while — a modal
    // dialog, a background tab, a slow machine — the audio clock keeps going
    // and that window grows to cover everything missed. Each of those notes is
    // then clamped to `now`, so they all land on the same instant: several
    // seconds of drums as one blast. On a kids' app that is an ear-safety
    // problem, not a timing one, and the limiter only caps the peak.
    const engine = await newEngine();
    engine.setProject(busyBar());
    await engine.play();
    await advance(0.5);

    const ceiling = worstStack(); // what normal playback looks like
    expect(ceiling).toBeLessThanOrEqual(3); // three tracks, one sixteenth

    // The main thread is blocked for five seconds. The audio clock runs on; the
    // scheduler's timer cannot fire.
    scheduled.length = 0;
    ctx.currentTime += 5;
    await vi.advanceTimersByTimeAsync(25); // the first tick after the stall

    expect(worstStack()).toBeLessThanOrEqual(ceiling);
  });

  it('carries on from where the song has got to, rather than replaying the gap', async () => {
    const engine = await newEngine();
    engine.setProject(busyBar()); // 1 bar = 4 beats = 2s at 120bpm
    await engine.play();
    await advance(0.5);

    scheduled.length = 0;
    ctx.currentTime += 5;
    await vi.advanceTimersByTimeAsync(25);

    // One tick covers 25ms plus the 100ms look-ahead: at 120bpm that is a
    // quarter of a beat, so one sixteenth per track at most.
    expect(scheduled.length).toBeLessThanOrEqual(6);
    // And it keeps playing afterwards.
    await advance(0.5);
    expect(scheduled.length).toBeGreaterThan(6);
  });
});

/** A one-bar song with a single recorded block on an audio track. */
function songWithARecording(clipSeconds = 20) {
  let project = P.createDefaultProject();
  project = P.setSectionLength(project, project.sections[0].id, 1); // 4 beats = 2s at 120bpm
  const track = P.createAudioTrack();
  project = P.addTrack(project, track);
  const lengthBeats = clipSeconds * 2; // 120bpm: 2 beats per second
  project = P.addNote(
    project,
    track.id,
    P.createClipNote(project.sections[0].id, 0, lengthBeats, 'clip_1', clipSeconds),
  );
  return project;
}

/** Something buffer-shaped for the engine to play. */
const fakeBuffer = { duration: 20, length: 20 * 44100, numberOfChannels: 1 } as unknown as AudioBuffer;

describe('a recording that is playing', () => {
  // Everything else the engine makes ends itself when its envelope runs out. A
  // recording has no envelope, so without an explicit end and a handle it plays
  // on after Stop — and every press of Play layers another copy over it.
  it('is silenced by Stop', async () => {
    const engine = await newEngine();
    engine.setClip('clip_1', fakeBuffer);
    engine.setProject(songWithARecording());
    await engine.play();
    await advance(0.3);

    expect(sources).toHaveLength(1);
    expect(sources[0].startedAt).not.toBeNull();
    expect(sources[0].stopCalls).toBe(1); // given an end when it started

    engine.stop();
    expect(sources[0].stopCalls).toBeGreaterThanOrEqual(2); // and cut short now
  });

  it('is silenced by Pause', async () => {
    const engine = await newEngine();
    engine.setClip('clip_1', fakeBuffer);
    engine.setProject(songWithARecording());
    await engine.play();
    await advance(0.3);
    engine.pause();
    expect(sources[0].stopCalls).toBeGreaterThanOrEqual(2);
  });

  it('does not pile up a second copy when Play is pressed again', async () => {
    const engine = await newEngine();
    engine.setClip('clip_1', fakeBuffer);
    engine.setProject(songWithARecording());
    await engine.play();
    await advance(0.3);
    engine.stop();
    const stoppedFirst = sources[0].stopCalls;
    await engine.play();
    await advance(0.3);

    expect(sources).toHaveLength(2); // a new one, as expected
    expect(stoppedFirst).toBeGreaterThanOrEqual(2); // with the old one already silenced
  });

  it('stops when a different song is opened', async () => {
    const engine = await newEngine();
    engine.setClip('clip_1', fakeBuffer);
    engine.setProject(songWithARecording());
    await engine.play();
    await advance(0.3);
    engine.clearClips(); // what opening another song does
    expect(sources[0].stopCalls).toBeGreaterThanOrEqual(2);
  });

  it('lasts as long as its block, so shortening one shortens the sound', async () => {
    const engine = await newEngine();
    engine.setClip('clip_1', fakeBuffer);
    // A 20-second recording, but its block has been dragged down to 1 beat.
    let project = P.createDefaultProject();
    project = P.setSectionLength(project, project.sections[0].id, 1);
    const track = P.createAudioTrack();
    project = P.addTrack(project, track);
    project = P.addNote(
      project,
      track.id,
      P.createClipNote(project.sections[0].id, 0, 1, 'clip_1', 20),
    );
    engine.setProject(project);
    await engine.play();
    await advance(0.3);

    // one beat at 120bpm = half a second after it started
    expect(sources[0].stoppedAt).toBeCloseTo((sources[0].startedAt ?? 0) + 0.5, 3);
  });
});
