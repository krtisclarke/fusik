import { describe, it, expect } from 'vitest';
import { HELPER_START, RECIPES, nextHelperSteps } from './helper';
import { isStepDone, type TourContext, type TourStep } from './tour';
import { VOICE_CATALOG } from '../model/voices';
import { SCALES, SCALE_CHOICES } from '../model/scales';

const CTX: TourContext = {
  drumNotes: 0,
  drumRows: 0,
  instrumentTracks: 0,
  instrumentNotes: 0,
  isPlaying: false,
  playedNotes: 0,
  parts: 1,
  recordings: 0,
  canRecordMic: true,
  bpm: 120,
  scaleId: 'majorPentatonic',
};

const labels = new Set(VOICE_CATALOG.map((v) => v.label));

describe('the idea helper', () => {
  it('opens with a question, not a lecture', () => {
    expect(HELPER_START.choices?.length).toBe(3);
    expect(HELPER_START.goal).toBeUndefined();
    expect(HELPER_START.button).toBeUndefined();
  });

  it('branches its questions into recipes', () => {
    for (const branch of ['vibe', 'genre']) {
      const steps = nextHelperSteps(branch, () => 0)!;
      expect(steps).toHaveLength(1);
      const q = steps[0];
      expect(q.choices!.length).toBeGreaterThanOrEqual(5);
      // Every answer offered leads to a real coaching flow.
      for (const c of q.choices!) {
        const flow = nextHelperSteps(c.id, () => 0);
        expect(flow, c.id).not.toBeNull();
        expect(flow!.length).toBeGreaterThan(5);
      }
    }
  });

  it('rolls a real recipe for "surprise me"', () => {
    const first = nextHelperSteps('surprise', () => 0)!;
    const last = nextHelperSteps('surprise', () => 0.999)!;
    expect(first.length).toBeGreaterThan(5);
    expect(last.length).toBeGreaterThan(5);
    expect(first[0].id).not.toBe(last[0].id); // the roll actually varies
  });

  it('answers nothing for an answer it never offered', () => {
    expect(nextHelperSteps('polka-metal', () => 0)).toBeNull();
  });

  it('names only instruments the library actually has', () => {
    for (const r of RECIPES) {
      for (const name of [...r.drums, r.bass, r.tune]) {
        expect(labels.has(name), `${r.id} names "${name}"`).toBe(true);
      }
    }
  });

  it('asks for moods exactly as the Mood box spells them', () => {
    const byId = new Map(SCALE_CHOICES.map((c) => [c.id, c.label]));
    for (const r of RECIPES) {
      expect(SCALES[r.scaleId], r.id).toBeTruthy();
      expect(byId.get(r.scaleId), r.id).toBe(r.moodLabel);
    }
  });

  const flowFor = (id: string): TourStep[] => nextHelperSteps(id, () => 0)!;

  it('ticks the mood step when the child sets that mood', () => {
    const steps = flowFor('spooky');
    const mood = steps.find((s) => s.id.endsWith('-mood'))!;
    expect(isStepDone(mood, CTX, CTX)).toBe(false);
    expect(isStepDone(mood, { ...CTX, scaleId: 'minor' }, CTX)).toBe(true);
  });

  it('accepts a tempo near the mark, not only the exact number', () => {
    const steps = flowFor('hiphop'); // wants 90
    const tempo = steps.find((s) => s.id.endsWith('-tempo'))!;
    expect(isStepDone(tempo, { ...CTX, bpm: 120 }, CTX)).toBe(false);
    expect(isStepDone(tempo, { ...CTX, bpm: 100 }, CTX)).toBe(true);
    expect(isStepDone(tempo, { ...CTX, bpm: 78 }, CTX)).toBe(true);
  });

  it('coaches with goals the child completes by doing, and closes with a read', () => {
    for (const r of RECIPES) {
      const steps = flowFor(r.id);
      const last = steps[steps.length - 1];
      expect(last.button, r.id).toBeTruthy();
      expect(last.goal, r.id).toBeUndefined();
      // Every step between the settings and the close asks for real new work.
      for (const s of steps.slice(2, -1)) {
        expect(s.goal, s.id).toBeTruthy();
        expect(isStepDone(s, CTX, CTX), s.id).toBe(false);
      }
    }
  });

  it('never touches the song itself — coaching is words and pointers only', () => {
    // The whole flow is plain data: titles, bodies, targets, goals. Nothing in
    // a step can edit the project, because a step has no way to reach it — the
    // brief's no-composing rule, enforced by shape.
    for (const r of RECIPES) {
      for (const s of flowFor(r.id)) {
        expect(Object.keys(s).every((k) =>
          ['id', 'title', 'body', 'target', 'button', 'goal', 'applies', 'choices'].includes(k),
        ), s.id).toBe(true);
      }
    }
  });
});
