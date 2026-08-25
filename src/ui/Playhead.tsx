import { useEffect, useRef } from 'react';
import { engine } from '../audio/AudioEngine';
import { useStore } from '../state/store';
import { beatToX, HEADER_W } from './layout';
import { followPlayhead } from './follow';

/** The moving vertical line. Positions itself every animation frame straight
 *  from the audio clock, so it tracks the sound exactly and never triggers a
 *  React re-render. The timeline shows one part of the song, so the line only
 *  appears while that part is the one sounding (the strip above shows the
 *  rest). It also nudges the store to notice when playback has stopped on its
 *  own (e.g. a non-looping song reaching the end).
 *
 *  It also keeps itself seen: when the line it was showing walks off the edge
 *  of the view, the view turns the page after it (see follow.ts for the rule
 *  and its manners). The check runs on a timer rather than the animation
 *  frame: a flip decision needs a few looks a second, not sixty. */
export function Playhead({
  height,
  scrollRef,
}: {
  height: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const syncTransport = useStore((s) => s.syncTransport);
  const currentSectionId = useStore((s) => s.currentSectionId);

  useEffect(() => {
    let raf = 0;
    let wasPlaying = engine.getTransport().isPlaying;
    const tick = () => {
      const t = engine.getTransport();
      const beat = engine.getPlayheadIn(currentSectionId);
      if (ref.current) {
        if (beat == null) {
          ref.current.style.opacity = '0';
        } else {
          ref.current.style.transform = `translateX(${HEADER_W + beatToX(beat)}px)`;
          ref.current.style.opacity = t.isPlaying ? '1' : '0.28';
        }
      }
      if (t.isPlaying !== wasPlaying) {
        wasPlaying = t.isPlaying;
        syncTransport();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [syncTransport, currentSectionId]);

  // The page-turn. Movement of the view between checks that we didn't cause
  // is the child scrolling, and a line that leaves the view during it is left
  // alone. The flip itself is an instant jump — the convention in grown-up
  // programs, and it means our own move is finished within the same check, so
  // it can never be mistaken for theirs.
  const follow = useRef({ tracking: false, lastScrollLeft: 0 });
  useEffect(() => {
    const id = setInterval(() => {
      const el = scrollRef.current;
      if (!el) return;
      const f = follow.current;
      const beat = engine.getPlayheadIn(currentSectionId);
      if (!engine.getTransport().isPlaying || beat == null) {
        f.tracking = false;
        f.lastScrollLeft = el.scrollLeft;
        return;
      }
      const viewMoved = Math.abs(el.scrollLeft - f.lastScrollLeft) > 2;
      const d = followPlayhead(
        f.tracking,
        beatToX(beat),
        el.scrollLeft,
        el.clientWidth - HEADER_W,
        Math.max(0, el.scrollWidth - el.clientWidth),
        viewMoved,
      );
      f.tracking = d.tracking;
      if (d.scrollTo != null) el.scrollLeft = d.scrollTo;
      f.lastScrollLeft = el.scrollLeft;
    }, 250);
    return () => clearInterval(id);
  }, [scrollRef, currentSectionId]);

  return <div ref={ref} className="playhead" style={{ height }} />;
}
