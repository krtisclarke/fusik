// The first-song walkthrough, drawn over the real app.
//
// Two rules shape this component. It never blocks: the overlay ignores the
// mouse entirely except for its own card, so the child is always working the
// actual controls, not a pretend copy of them. And it advances on what they
// *do* — beats placed, play pressed, keys played — so the thing being taught
// and the thing being done are the same thing. The button is only there for
// getting past a step that isn't going well.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import {
  TOUR_STEPS,
  isStepDone,
  nextCelebration,
  remainingLabel,
  stepApplies,
  type TourContext,
} from '../state/tour';

/** How long the tick stays up before moving on. Long enough to notice. */
const CELEBRATE_MS = 800;
const CARD_WIDTH = 320;
const GAP = 14;

/** What the walkthrough can see, gathered from the store. */
function useTourContext(): TourContext {
  const project = useStore((s) => s.project);
  const sectionId = useStore((s) => s.currentSectionId);
  const isPlaying = useStore((s) => s.isPlaying);
  const playedNotes = useStore((s) => s.playedNotes);
  const canRecordMic = useStore((s) => s.canRecordMic);

  return useMemo(() => {
    let drumNotes = 0;
    let instrumentNotes = 0;
    let instrumentTracks = 0;
    let recordings = 0;
    const drumRows = new Set<string>();
    for (const track of project.tracks) {
      if (track.type === 'instrument') instrumentTracks++;
      for (const note of track.notes) {
        // Recordings count wherever they are. A take made while the song plays
        // lands in whichever part was *sounding*, which needn't be the part on
        // screen — so counting only what's visible would leave a child who did
        // exactly as asked stuck on the step for ever.
        if (note.clipId) {
          recordings++;
          continue;
        }
        // Everything else is placed by hand into the part on screen, which is
        // the only one the child can see.
        if (note.sectionId !== sectionId) continue;
        if (track.type === 'instrument') instrumentNotes++;
        else {
          drumNotes++;
          drumRows.add(track.id);
        }
      }
    }
    return {
      drumNotes,
      drumRows: drumRows.size,
      instrumentTracks,
      instrumentNotes,
      isPlaying,
      playedNotes,
      parts: project.sections.length,
      recordings,
      canRecordMic,
    };
  }, [project, sectionId, isPlaying, playedNotes, canRecordMic]);
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Follow the control this step points at. The layout moves under it constantly
 * — tracks appear, the keyboard opens, the window resizes — so this re-measures
 * rather than assuming the first answer holds.
 */
function useTargetRect(target: string | undefined): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);

  useLayoutEffect(() => {
    if (!target) {
      setRect(null);
      return;
    }
    let raf = 0;
    let last = '';
    const measure = () => {
      const el = document.querySelector(`[data-tour="${target}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        const next = { top: r.top, left: r.left, width: r.width, height: r.height };
        // Only re-render when it actually moved.
        const key = `${r.top}|${r.left}|${r.width}|${r.height}`;
        if (key !== last) {
          last = key;
          setRect(next);
        }
      } else if (last !== '') {
        last = '';
        setRect(null);
      }
      raf = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return rect;
}

/** `*bold*` in the step copy, so a control's name stands out mid-sentence. */
function withEmphasis(body: string) {
  return body.split(/\*([^*]+)\*/g).map((part, i) =>
    i % 2 === 1 ? <b key={i}>{part}</b> : <span key={i}>{part}</span>,
  );
}

/**
 * The highlight, kept inside the window. A lane list taller than the screen
 * would otherwise draw a box with two edges somewhere off in space, which reads
 * as nothing at all rather than as "in here".
 */
function ringRect(rect: Rect | null): Rect | null {
  if (!rect || rect.width === 0) return null;
  const margin = 4;
  const top = Math.max(margin, rect.top - 6);
  const left = Math.max(margin, rect.left - 6);
  const bottom = Math.min(window.innerHeight - margin, rect.top + rect.height + 6);
  const right = Math.min(window.innerWidth - margin, rect.left + rect.width + 6);
  if (bottom <= top || right <= left) return null;
  return { top, left, width: right - left, height: bottom - top };
}

/** Where to put the card so it sits beside the highlight and stays on screen. */
function cardPosition(rect: Rect | null): { top: number; left: number; centred: boolean } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!rect || rect.width === 0) {
    return { top: Math.round(vh / 2 - 110), left: Math.round(vw / 2 - CARD_WIDTH / 2), centred: true };
  }
  const below = rect.top + rect.height + GAP;
  const roomBelow = vh - below;
  // Guess at the card's height for the flip decision; the clamp below catches
  // the cases where the guess is wrong.
  const estimated = 190;
  const top = roomBelow > estimated ? below : Math.max(GAP, rect.top - estimated - GAP);
  const left = Math.min(
    Math.max(GAP, rect.left + rect.width / 2 - CARD_WIDTH / 2),
    vw - CARD_WIDTH - GAP,
  );
  return { top: Math.round(top), left: Math.round(left), centred: false };
}

export function Tutorial() {
  const stepIndex = useStore((s) => s.tourStep);
  const nextTourStep = useStore((s) => s.nextTourStep);
  const endTour = useStore((s) => s.endTour);
  const ctx = useTourContext();

  const step = stepIndex == null ? null : TOUR_STEPS[stepIndex];
  const rect = useTargetRect(step?.target);

  // The snapshot each goal is measured against, tied to the step it belongs to
  // so a stale one can never mark the next step done the instant it opens.
  const [baseline, setBaseline] = useState<{ step: number; ctx: TourContext } | null>(null);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  useEffect(() => {
    if (stepIndex == null) setBaseline(null);
    else setBaseline({ step: stepIndex, ctx: ctxRef.current });
  }, [stepIndex]);

  const ready = baseline != null && stepIndex != null && baseline.step === stepIndex;
  const done = ready && step ? isStepDone(step, ctx, baseline.ctx) : false;

  // Which step is showing its tick. Held as the step's own number rather than a
  // yes/no flag, so it is impossible for a celebration to outlive the step that
  // earned it — see nextCelebration for why that mattered.
  const [celebratingStep, setCelebratingStep] = useState<number | null>(null);
  const celebrating = celebratingStep != null && celebratingStep === stepIndex;

  useEffect(() => {
    setCelebratingStep((current) => nextCelebration(current, stepIndex, done));
  }, [stepIndex, done]);

  // A step that doesn't apply here — recording, in a browser — is passed over
  // rather than left on screen as an instruction that can never be followed.
  useEffect(() => {
    if (step && !stepApplies(step, ctx)) nextTourStep();
  }, [step, ctx, nextTourStep]);

  useEffect(() => {
    if (celebratingStep == null) return;
    const id = setTimeout(nextTourStep, CELEBRATE_MS);
    return () => clearTimeout(id);
  }, [celebratingStep, nextTourStep]);

  useEffect(() => {
    if (stepIndex == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endTour();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stepIndex, endTour]);

  if (stepIndex == null || !step) return null;

  const ring = ringRect(rect);
  const pos = cardPosition(rect);
  const remaining = ready ? remainingLabel(step, ctx, baseline.ctx) : null;

  return (
    <div className="tour">
      {ring && (
        <div
          className={`tour-ring ${celebrating ? 'done' : ''}`}
          style={{ top: ring.top, left: ring.left, width: ring.width, height: ring.height }}
        />
      )}

      <div
        className={`tour-card ${pos.centred ? 'centred' : ''} ${celebrating ? 'done' : ''}`}
        style={{ top: pos.top, left: pos.left, width: CARD_WIDTH }}
        role="dialog"
        aria-live="polite"
        aria-label={step.title}
      >
        <div className="tour-dots">
          {TOUR_STEPS.map((s, i) => (
            <span key={s.id} className={`tour-dot ${i === stepIndex ? 'on' : ''} ${i < stepIndex ? 'past' : ''}`} />
          ))}
        </div>

        <div className="tour-title">
          {celebrating ? 'Nice one!' : step.title}
        </div>
        <div className="tour-body">{celebrating ? <span>✅</span> : withEmphasis(step.body)}</div>

        <div className="tour-actions">
          <button className="tour-skip" onClick={endTour}>
            {stepIndex === 0 ? 'No thanks' : 'Close'}
          </button>
          {remaining && !celebrating && <span className="tour-remaining">{remaining}</span>}
          {step.button ? (
            // Nothing to do but read it, so the button is the way on.
            <button className="tour-next" onClick={nextTourStep} disabled={celebrating}>
              {step.button}
            </button>
          ) : (
            // The child is meant to go and do the thing. Moving on without doing
            // it stays available, but quietly — a big bright button saying Skip
            // is an invitation to press it instead.
            <button className="tour-later" onClick={nextTourStep} disabled={celebrating}>
              Skip this bit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
