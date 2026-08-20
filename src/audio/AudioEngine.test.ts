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

function fakeNode() {
  return {
    connect: () => undefined,
    disconnect: () => undefined,
    gain: { value: 1, setTargetAtTime: () => undefined },
  };
}

/** A stand-in AudioContext whose clock we advance by hand. */
class FakeAudioContext {
  currentTime = 0;
  state = 'running';
  destination = fakeNode();
  createGain = () => fakeNode();
  resume = async () => undefined;
  close = async () => undefined;
}

let ctx: FakeAudioContext;

beforeEach(() => {
  scheduled.length = 0;
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
