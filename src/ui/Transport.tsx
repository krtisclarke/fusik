import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { engine } from '../audio/AudioEngine';
import { formatPosition } from '../model/time';
import type { SnapId } from '../model/time';
import { MAX_BARS, MAX_BPM, MIN_BARS, MIN_BPM } from '../model/project';

const SNAP_OPTIONS: { id: SnapId; label: string }[] = [
  { id: 'bar', label: 'Bar' },
  { id: 'beat', label: 'Beat' },
  { id: 'half', label: '½ beat' },
  { id: 'quarter', label: '¼ beat' },
  { id: 'eighth', label: '⅛ beat' },
  { id: 'sixteenth', label: '1/16' },
  { id: 'off', label: 'Off' },
];

/**
 * A number box that only reports a value when the child has finished typing one
 * (Enter, or clicking away). Typing straight through to the store would commit
 * an undo step per keystroke, and an empty box — mid-edit, on the way to "12" —
 * reads as 0 and would snap the part to its minimum under the child's fingers.
 */
function NumberField({
  value,
  min,
  max,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    const text = draft;
    setDraft(null);
    if (text == null || text.trim() === '') return; // left empty: keep what it was
    const parsed = Number(text);
    if (Number.isFinite(parsed)) onCommit(parsed);
  }

  return (
    <input
      type="number"
      value={draft ?? String(value)}
      min={min}
      max={max}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

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
  const playMode = useStore((s) => s.playMode);
  const currentSection = useStore(
    (s) => s.project.sections.find((x) => x.id === s.currentSectionId) ?? s.project.sections[0],
  );
  const snap = useStore((s) => s.snap);

  const togglePlay = useStore((s) => s.togglePlay);
  const stop = useStore((s) => s.stop);
  const toggleLoop = useStore((s) => s.toggleLoop);
  const setPlayMode = useStore((s) => s.setPlayMode);
  const setPartBars = useStore((s) => s.setPartBars);
  const showKeyboard = useStore((s) => s.showKeyboard);
  const toggleKeyboard = useStore((s) => s.toggleKeyboard);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const setBpm = useStore((s) => s.setBpm);
  const setSnap = useStore((s) => s.setSnap);
  const saveCurrent = useStore((s) => s.saveCurrent);
  const openFromFile = useStore((s) => s.openFromFile);
  const newProject = useStore((s) => s.newProject);
  const exportSong = useStore((s) => s.exportSong);

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
        <button
          className={`tbtn ${showKeyboard ? 'on' : ''}`}
          onClick={toggleKeyboard}
          title="Show or hide the keyboard you can play"
        >
          🎹
        </button>
      </div>

      <div className="tgroup seg">
        <button
          className={`tbtn ${playMode === 'song' ? 'on' : ''}`}
          onClick={() => setPlayMode('song')}
          title="Play the whole song — every part in order"
        >
          Song
        </button>
        <button
          className={`tbtn ${playMode === 'section' ? 'on' : ''}`}
          onClick={() => setPlayMode('section')}
          title="Play just the part you're editing"
        >
          Part
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

      <div className="field">
        <span className="lbl">Part {currentSection.name}</span>
        <div className="stepper">
          <button
            onClick={() => setPartBars(currentSection.lengthBars - 1)}
            aria-label="Shorter"
          >
            −
          </button>
          <NumberField
            value={currentSection.lengthBars}
            min={MIN_BARS}
            max={MAX_BARS}
            onCommit={setPartBars}
          />
          <button onClick={() => setPartBars(currentSection.lengthBars + 1)} aria-label="Longer">
            +
          </button>
        </div>
        <span className="lbl">bars</span>
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
        <button
          className="tbtn"
          onClick={() => void exportSong()}
          title="Export the song as a .wav audio file"
        >
          ⬇ Export
        </button>
      </div>
    </div>
  );
}
