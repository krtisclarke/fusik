import { useEffect, useRef } from 'react';
import { engine } from '../audio/AudioEngine';
import { useStore } from '../state/store';
import { beatToX, HEADER_W } from './layout';

/** The moving vertical line. Positions itself every animation frame straight
 *  from the audio clock, so it tracks the sound exactly and never triggers a
 *  React re-render. The timeline shows one part of the song, so the line only
 *  appears while that part is the one sounding (the strip above shows the
 *  rest). It also nudges the store to notice when playback has stopped on its
 *  own (e.g. a non-looping song reaching the end). */
export function Playhead({ height }: { height: number }) {
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

  return <div ref={ref} className="playhead" style={{ height }} />;
}
