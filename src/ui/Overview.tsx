import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { engine } from '../audio/AudioEngine';
import { getVoice, isPitched } from '../model/voices';
import { PX_PER_BEAT, HEADER_W, beatToX } from './layout';

// The little map of the part: every block in miniature, the playhead, and a
// bright window showing the slice of it the big timeline can see. Click or
// drag anywhere on the map and the timeline pans there — which is how a child
// discovers that there IS more song past the edge, something a scrollbar that
// hides itself never tells them. Grown-up music programs have exactly this
// strip, under the same name (the overview), so the shape transfers.
//
// The map never owns the truth. Dragging it only sets the scroll position of
// the timeline itself; the window then follows the timeline's own scroll
// event. One source of truth, so the two can never disagree — however the
// timeline got scrolled (this map, a trackpad, a future follow-the-playhead).

interface ScrollWindow {
  left: number;
  width: number;
}

export function Overview({
  scrollRef,
  totalBeats,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  totalBeats: number;
}) {
  const project = useStore((s) => s.project);
  const currentSectionId = useStore((s) => s.currentSectionId);
  const [win, setWin] = useState<ScrollWindow>({ left: 0, width: 1 });
  const stripRef = useRef<HTMLDivElement>(null);
  const playRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const gridWidth = totalBeats * PX_PER_BEAT;

  // The window, as fractions of the part: which beats are on screen right now.
  // The grid starts HEADER_W into the scrolled content, so that much is taken
  // off the front. Reads the DOM rather than mirroring it, so it is right on
  // the first paint and after any resize.
  const syncWindow = useCallback(() => {
    const el = scrollRef.current;
    if (!el || gridWidth <= 0) return;
    // The grid sits HEADER_W into the scrolled content, so the visible slice
    // of it is the visible pixel range with that much taken off the front.
    const lo = Math.max(0, el.scrollLeft - HEADER_W);
    const hi = Math.max(0, el.scrollLeft + el.clientWidth - HEADER_W);
    setWin({
      left: Math.min(1, lo / gridWidth),
      width: Math.max(0.02, Math.min(1, hi / gridWidth) - Math.min(1, lo / gridWidth)),
    });
  }, [scrollRef, gridWidth]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    syncWindow();
    el.addEventListener('scroll', syncWindow, { passive: true });
    const ro = new ResizeObserver(syncWindow);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', syncWindow);
      ro.disconnect();
    };
  }, [scrollRef, syncWindow]);

  // The playhead's twin, driven straight from the audio clock like the big
  // one — and only while the part on screen is the part that is sounding.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const beat = engine.getPlayheadIn(currentSectionId);
      if (playRef.current) {
        if (beat == null || totalBeats <= 0) {
          playRef.current.style.opacity = '0';
        } else {
          playRef.current.style.left = `${(beat / totalBeats) * 100}%`;
          playRef.current.style.opacity = engine.getTransport().isPlaying ? '1' : '0.3';
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [currentSectionId, totalBeats]);

  /** Centre the timeline's view on this pointer position of the map. */
  const panTo = useCallback(
    (clientX: number) => {
      const el = scrollRef.current;
      const strip = stripRef.current;
      if (!el || !strip || totalBeats <= 0) return;
      const rect = strip.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const beat = frac * totalBeats;
      const target = HEADER_W + beatToX(beat) - el.clientWidth / 2;
      el.scrollLeft = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, target));
    },
    [scrollRef, totalBeats],
  );

  function onPointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging.current = true;
    panTo(e.clientX);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (dragging.current) panTo(e.clientX);
  }
  function onPointerUp() {
    dragging.current = false;
  }

  const tracks = project.tracks;
  const bandHeight = tracks.length > 0 ? 100 / tracks.length : 100;

  return (
    <div
      className="overview"
      ref={stripRef}
      title="The whole part in miniature — click or drag to move the view below"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {tracks.map((track, i) => {
        const voice = getVoice(track.instrument.voiceId);
        const pitchedTrack = isPitched(voice);
        return track.notes
          .filter((n) => n.sectionId === currentSectionId)
          .map((n) => (
            <div
              key={n.id}
              className="ov-note"
              style={{
                left: `${(n.startBeat / totalBeats) * 100}%`,
                width: `max(2px, ${(n.lengthBeats / totalBeats) * 100}%)`,
                top: `${i * bandHeight + (pitchedTrack ? bandHeight * 0.2 : 0.5)}%`,
                height: `${bandHeight * (pitchedTrack ? 0.6 : 0.9)}%`,
                background: track.color,
              }}
            />
          ));
      })}
      <div
        className="ov-window"
        style={{ left: `${win.left * 100}%`, width: `${win.width * 100}%` }}
      />
      <div className="ov-playhead" ref={playRef} />
    </div>
  );
}
