import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { engine } from '../audio/AudioEngine';
import { formatPosition } from '../model/time';
import { MAX_BARS, MAX_BPM, MIN_BARS, MIN_BPM } from '../model/project';
import { SCALE_CHOICES } from '../model/scales';
import { SongName, SongsPanel } from './Songs';

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
  const tidyTiming = useStore((s) => s.snap !== 'off');
  const scaleId = useStore((s) => s.project.scaleId);

  const togglePlay = useStore((s) => s.togglePlay);
  const stop = useStore((s) => s.stop);
  const toggleLoop = useStore((s) => s.toggleLoop);
  const setPlayMode = useStore((s) => s.setPlayMode);
  const setPartBars = useStore((s) => s.setPartBars);
  const showKeyboard = useStore((s) => s.showKeyboard);
  const toggleKeyboard = useStore((s) => s.toggleKeyboard);
  const isRecording = useStore((s) => s.isRecording);
  const toggleRecording = useStore((s) => s.toggleRecording);
  const isMicRecording = useStore((s) => s.isMicRecording);
  const canRecordMic = useStore((s) => s.canRecordMic);
  const toggleMicRecording = useStore((s) => s.toggleMicRecording);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const setBpm = useStore((s) => s.setBpm);
  const setTidyTiming = useStore((s) => s.setTidyTiming);
  const setScale = useStore((s) => s.setScale);
  const startTour = useStore((s) => s.startTour);
  const startHelper = useStore((s) => s.startHelper);
  const showSongs = useStore((s) => s.showSongs);
  const toggleSongs = useStore((s) => s.toggleSongs);

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
        <button
          className="tbtn play primary"
          data-tour="play"
          onClick={togglePlay}
          title="Play / Pause (Space)"
        >
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
        <button
          className={`tbtn mic ${isMicRecording ? 'armed' : ''}`}
          data-tour="mic"
          onClick={() => void toggleMicRecording()}
          disabled={!canRecordMic}
          title={
            canRecordMic
              ? isMicRecording
                ? 'Stop recording'
                : 'Record your voice with the microphone'
              : 'Recording your voice needs the desktop app'
          }
        >
          🎤
        </button>
        <button
          className={`tbtn rec ${isRecording ? 'armed' : ''}`}
          onClick={toggleRecording}
          title="Record what you play on the keyboard into the song"
        >
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

      <div className="field" data-tour="tempo">
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

      <div className="field" data-tour="mood">
        <span className="lbl">Mood</span>
        <select
          className="snap"
          value={scaleId}
          onChange={(e) => setScale(e.target.value)}
          title="The notes the whole song is built from. Change it and your tune comes with you."
        >
          {SCALE_CHOICES.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <span className="lbl">Timing</span>
        <button
          className={`tbtn wide ${tidyTiming ? 'on' : ''}`}
          onClick={() => setTidyTiming(!tidyTiming)}
          title={
            tidyTiming
              ? 'Blocks line up with the beat, and what you play is tidied up. Click for free timing.'
              : 'Blocks go exactly where you put them. Click to line everything up with the beat.'
          }
        >
          {tidyTiming ? 'Tidy' : 'Free'}
        </button>
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

      <div className="field song-field">
        <span className="lbl">Song</span>
        <SongName />
      </div>

      <div className="spacer" />

      <div className="tgroup">
        <div className="songs-anchor">
          <button
            className={`tbtn ${showSongs ? 'on' : ''}`}
            onClick={toggleSongs}
            title="The songs you've made"
          >
            🎵 Songs
          </button>
          <SongsPanel />
        </div>
        <button
          className="tbtn"
          onClick={startHelper}
          title="Stuck? Get an idea for a song"
          aria-label="Stuck? Get an idea for a song"
        >
          💡
        </button>
        <button
          className="tbtn"
          onClick={startTour}
          title="Show me how to make a song"
          aria-label="Show me how to make a song"
        >
          ?
        </button>
      </div>
    </div>
  );
}
