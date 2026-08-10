import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { engine } from '../audio/AudioEngine';
import { formatPosition } from '../model/time';
import type { SnapId } from '../model/time';
import { MAX_BPM, MIN_BPM } from '../model/project';

const SNAP_OPTIONS: { id: SnapId; label: string }[] = [
  { id: 'bar', label: 'Bar' },
  { id: 'beat', label: 'Beat' },
  { id: 'half', label: '½ beat' },
  { id: 'quarter', label: '¼ beat' },
  { id: 'eighth', label: '⅛ beat' },
  { id: 'sixteenth', label: '1/16' },
  { id: 'off', label: 'Off' },
];

/** Live "bar.beat" readout, driven by the audio clock via requestAnimationFrame
 *  so it stays perfectly in step with what's playing without re-rendering React. */
function PositionReadout() {
  const ref = useRef<HTMLSpanElement>(null);
  const timeSig = useStore((s) => s.project.timeSignature);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (ref.current) {
        ref.current.textContent = formatPosition(engine.getPositionBeats(), timeSig);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [timeSig]);
  return <span ref={ref} className="big">1.1</span>;
}

export function Transport() {
  const isPlaying = useStore((s) => s.isPlaying);
  const isLooping = useStore((s) => s.isLooping);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const bpm = useStore((s) => s.project.bpm);
  const lengthBars = useStore((s) => s.project.lengthBars);
  const snap = useStore((s) => s.snap);

  const togglePlay = useStore((s) => s.togglePlay);
  const stop = useStore((s) => s.stop);
  const toggleLoop = useStore((s) => s.toggleLoop);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const setBpm = useStore((s) => s.setBpm);
  const setSnap = useStore((s) => s.setSnap);
  const saveCurrent = useStore((s) => s.saveCurrent);
  const openFromFile = useStore((s) => s.openFromFile);
  const newProject = useStore((s) => s.newProject);

  return (
    <div className="transport">
      <div className="brand">
        <span className="logo">🎛️</span>
        <span>
          Beatbox Studio
          <br />
          <small>music you can poke at</small>
        </span>
      </div>

      <div className="divider" />

      <div className="tgroup">
        <button className="tbtn play primary" onClick={togglePlay} title="Play / Pause (Space)">
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button className="tbtn" onClick={stop} title="Stop">
          ⏹
        </button>
        <button
          className={`tbtn ${isLooping ? 'on' : ''}`}
          onClick={toggleLoop}
          title="Loop the song"
        >
          🔁
        </button>
        <button className="tbtn rec" disabled title="Microphone recording arrives in a later update">
          ⏺
        </button>
      </div>

      <div className="divider" />

      <div className="tgroup">
        <button className="tbtn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl/Cmd+Z)">
          ↶
        </button>
        <button className="tbtn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl/Cmd+Shift+Z)">
          ↷
        </button>
      </div>

      <div className="divider" />

      <div className="readout">
        <PositionReadout />
        <span className="lbl">bar.beat</span>
      </div>

      <div className="field">
        <span className="lbl">Tempo</span>
        <div className="stepper">
          <button onClick={() => setBpm(bpm - 1)} aria-label="Slower">
            −
          </button>
          <input
            type="number"
            value={bpm}
            min={MIN_BPM}
            max={MAX_BPM}
            onChange={(e) => setBpm(Number(e.target.value))}
          />
          <button onClick={() => setBpm(bpm + 1)} aria-label="Faster">
            +
          </button>
        </div>
      </div>

      <div className="field">
        <span className="lbl">Snap to</span>
        <select
          className="snap"
          value={snap}
          onChange={(e) => setSnap(e.target.value as SnapId)}
        >
          {SNAP_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="readout">
        <span className="big">{lengthBars}</span>
        <span className="lbl">bars long</span>
      </div>

      <div className="spacer" />

      <div className="tgroup">
        <button className="tbtn" onClick={newProject} title="New song (Ctrl/Cmd+N)">
          New
        </button>
        <button className="tbtn" onClick={openFromFile} title="Open a song (Ctrl/Cmd+O)">
          Open
        </button>
        <button className="tbtn" onClick={saveCurrent} title="Save this song (Ctrl/Cmd+S)">
          💾 Save
        </button>
      </div>
    </div>
  );
}
