import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { engine } from '../audio/AudioEngine';
import { beatToX } from './layout';

/**
 * The take as it is being sung, drawn growing across the block it is filling.
 *
 * Without it a child sings into a block that shows nothing at all until the
 * take is over — no sign it is working, no sign of how much of the bar has
 * gone. Driven straight off the audio clock, like the playhead, so it never
 * costs a re-render.
 */
export function RecordingBlock({ fromAbsBeat }: { fromAbsBeat: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const at = engine.getSongPlayheadBeat();
      if (ref.current) {
        // A loop that comes round mid-take would give a negative width; hold
        // the block at the loop point rather than flickering it inside out.
        const beats = at == null ? 0 : Math.max(0, at - fromAbsBeat);
        ref.current.style.width = `${Math.max(2, beatToX(beats))}px`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fromAbsBeat]);

  return <div ref={ref} className="rec-live" style={{ left: beatToX(fromAbsBeat) }} />;
}

/**
 * Three, two, one.
 *
 * Recording used to begin on the click, which asked a child to press a button
 * and be mid-note at the same instant. This is the whole of the fix, and it is
 * deliberately enormous and in the middle of the screen: it has to be readable
 * from wherever they are actually looking, which is not at the button they
 * just pressed. Click it, or press space, to change your mind.
 */
export function Countdown() {
  const countdown = useStore((s) => s.countdown);
  const cancelCountdown = useStore((s) => s.cancelCountdown);
  const recordTarget = useStore((s) => s.recordTarget);
  if (countdown == null) return null;
  // Both kinds of take count in. A block waiting to be sung into means this is
  // the microphone; otherwise it is the keyboard. So the screen never tells a
  // child to sing when they are about to play.
  const singing = recordTarget != null;
  return (
    <div className="countdown" role="status" aria-label={`Recording in ${countdown}`}>
      <div className="countdown-num" key={countdown}>
        {countdown}
      </div>
      <div className="countdown-hint">
        {singing ? 'get ready to sing…' : 'get ready to play…'}
      </div>
      {/* Its own button rather than the whole screen. The overlay used to
          cancel on any click at all, so a child clicking to look at something
          lost the take they were about to make. */}
      <button className="countdown-cancel" onClick={cancelCountdown}>
        ✕ Never mind (or press space)
      </button>
    </div>
  );
}
