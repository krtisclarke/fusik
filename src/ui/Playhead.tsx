import { useEffect, useRef } from 'react';
import { engine } from '../audio/AudioEngine';
import { useStore } from '../state/store';
import { beatToX, HEADER_W } from './layout';

/** The moving vertical line. Positions itself every animation frame straight
 *  from the audio clock, so it tracks the sound exactly and never triggers a
 *  React re-render. It also nudges the store to notice when playback has stopped
 *  on its own (e.g. a non-looping song reaching the end). */
export function Playhead({ height }: { height: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const syncTransport = useStore((s) => s.syncTransport);

  useEffect(() => {
    let raf = 0;
    let wasPlaying = engine.getTransport().isPlaying;
    const tick = () => {
      const t = engine.getTransport();
      if (ref.current) {
        ref.current.style.transform = `translateX(${HEADER_W + beatToX(t.positionBeats)}px)`;
        ref.current.style.opacity = t.isPlaying ? '1' : '0.28';
      }
      if (t.isPlaying !== wasPlaying) {
        wasPlaying = t.isPlaying;
        syncTransport();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [syncTransport]);

  return <div ref={ref} className="playhead" style={{ height }} />;
}
