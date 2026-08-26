import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { engine } from '../audio/AudioEngine';
import { beatToX } from './layout';

/**
 * The marker on the voice row that says where the next sung take begins — and
 * the button that starts it.
 *
 * Recording used to begin wherever the playhead happened to be, started from a
 * button in the toolbar, with the song not necessarily playing. Deciding where
 * your voice went was therefore three separate acts in three separate places,
 * and none of them said what they were for. Here it is one: put this where the
 * singing starts, press it, and the song plays from that spot while it listens.
 *
 * Space stops the take, because reaching for a small button is the one thing
 * you cannot do with your mouth full of singing.
 */
export function RecordPointMarker({
  absBeat,
  onMoveTo,
}: {
  absBeat: number;
  /** Put the marker under this page x. The timeline owns the geometry. */
  onMoveTo: (clientX: number) => void;
}) {
  const isMicRecording = useStore((s) => s.isMicRecording);
  const canRecordMic = useStore((s) => s.canRecordMic);
  const startTakeAtMarker = useStore((s) => s.startTakeAtMarker);
  const toggleMicRecording = useStore((s) => s.toggleMicRecording);
  // A press on the marker, until it declares itself: let go without moving and
  // it starts the take, move and it drags the marker. The round red button is
  // the part of this that looks most worth grabbing, so it had better be
  // grabbable — the same "wait and see what this press is" the grid already
  // uses for click-to-place versus drag-a-box.
  const drag = useRef({ active: false, startX: 0, moved: false });

  return (
    <div
      className={`rec-point ${isMicRecording ? 'live' : ''}`}
      style={{ left: beatToX(absBeat) }}
      title={
        canRecordMic
          ? isMicRecording
            ? 'Recording — press space to stop'
            : 'Drag me to where the singing starts, then press the red button'
          : 'Recording your voice needs the desktop app'
      }
      // Dragging it and clicking the row both put it somewhere; taking hold of
      // the thing itself is the one people try first.
      onPointerDown={(e) => {
        if (isMicRecording) return;
        e.stopPropagation();
        // Take the drag first and ask for capture after. Capture is what keeps
        // the pointer aimed here once it leaves the marker, but it is allowed
        // to refuse — and a refusal must cost a smoother drag, not the drag.
        drag.current = { active: true, startX: e.clientX, moved: false };
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          // No capture; the moves still arrive while the pointer is over it.
        }
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d.active) return;
        if (!d.moved && Math.abs(e.clientX - d.startX) <= 4) return; // still a click
        d.moved = true;
        onMoveTo(e.clientX);
      }}
      onPointerUp={(e) => {
        drag.current.active = false;
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {
          // Never captured, or already let go.
        }
      }}
      onPointerCancel={() => {
        drag.current = { active: false, startX: 0, moved: false };
      }}
    >
      <button
        className="rec-go"
        disabled={!canRecordMic}
        onClick={(e) => {
          e.stopPropagation();
          // A press that turned into a drag was aiming the marker, not starting
          // a take. Letting it through would record from wherever the finger
          // happened to stop.
          if (drag.current.moved) {
            drag.current.moved = false;
            return;
          }
          if (isMicRecording) void toggleMicRecording();
          else void startTakeAtMarker();
        }}
      >
        {isMicRecording ? '⏹' : '⏺'}
      </button>
      <span className="rec-label">
        {isMicRecording ? 'Singing… space to stop singing' : 'Sing from here'}
      </span>
    </div>
  );
}

/**
 * The take as it is being sung, drawn growing from where it started.
 *
 * Without it, a child sings into a row that shows nothing at all until the take
 * is over — no sign it is working, no sign of how much of the bar has gone.
 * Driven straight off the audio clock, like the playhead, so it never costs a
 * re-render.
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
