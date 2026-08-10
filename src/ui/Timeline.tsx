import { Fragment, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { Note, Track } from '../model/types';
import { beatsPerBar, snapBeat } from '../model/time';
import { getVoice } from '../model/voices';
import { pitchLadder, midiToLetter } from '../model/scales';
import { clamp } from '../model/project';
import { PX_PER_BEAT, ROW_H, PITCH_ROW_H, HEADER_W, beatToX, xToBeat } from './layout';
import { Playhead } from './Playhead';
import { VOICE_DRAG_TYPE } from './Library';

interface DragState {
  noteId: string;
  trackId: string;
  origBeat: number;
  startX: number;
  previewBeat: number;
  moved: boolean;
}

/** Index of the ladder pitch closest to `pitch` (for laying out loaded notes). */
function nearestIndex(pitches: number[], pitch: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < pitches.length; i++) {
    const d = Math.abs(pitches[i] - pitch);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

export function Timeline() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const snap = useStore((s) => s.snap);
  const addNoteAt = useStore((s) => s.addNoteAt);
  const removeNote = useStore((s) => s.removeNote);
  const moveNote = useStore((s) => s.moveNote);
  const dropVoiceAt = useStore((s) => s.dropVoiceAt);
  const select = useStore((s) => s.select);
  const setTrackGain = useStore((s) => s.setTrackGain);
  const toggleMute = useStore((s) => s.toggleMute);
  const toggleSolo = useStore((s) => s.toggleSolo);
  const removeTrack = useStore((s) => s.removeTrack);

  const lanesRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const ts = project.timeSignature;
  const perBar = beatsPerBar(ts);
  const total = project.lengthBars * perBar;
  const gridWidth = total * PX_PER_BEAT;
  const barWidth = perBar * PX_PER_BEAT;

  const noteCount = project.tracks.reduce((n, t) => n + t.notes.length, 0);

  const verticalLines = `repeating-linear-gradient(90deg, var(--line) 0 1px, transparent 1px ${PX_PER_BEAT}px), repeating-linear-gradient(90deg, var(--line-strong) 0 2px, transparent 2px ${barWidth}px)`;
  const horizontalLines = `repeating-linear-gradient(0deg, var(--line) 0 1px, transparent 1px ${PITCH_ROW_H}px)`;

  /** The scale pitches an instrument track offers, or null for drum tracks. */
  function pitchesFor(track: Track): number[] | null {
    if (track.type !== 'instrument') return null;
    const voice = getVoice(track.instrument.voiceId);
    return pitchLadder(voice?.baseMidi ?? 60, voice?.octaves ?? 2, project.scaleRoot, project.scaleId);
  }

  function laneHeight(track: Track): number {
    const pitches = pitchesFor(track);
    return pitches ? pitches.length * PITCH_ROW_H : ROW_H;
  }

  const totalHeight = project.tracks.reduce((h, t) => h + laneHeight(t), 0);

  // ---- placing / removing notes -----------------------------------------

  function onLanePointerDown(e: React.PointerEvent, track: Track) {
    if (e.target !== e.currentTarget) return; // ignore presses that land on a note
    const beat = xToBeat(e.nativeEvent.offsetX);
    const pitches = pitchesFor(track);
    if (pitches) {
      const rowFromTop = clamp(Math.floor(e.nativeEvent.offsetY / PITCH_ROW_H), 0, pitches.length - 1);
      const pitch = pitches[pitches.length - 1 - rowFromTop];
      addNoteAt(track.id, beat, { pitch });
    } else {
      addNoteAt(track.id, beat);
    }
  }

  // ---- dragging a note in time ------------------------------------------

  function onNotePointerDown(e: React.PointerEvent, track: Track, note: Note) {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    select(track.id, note.id);
    setDrag({
      noteId: note.id,
      trackId: track.id,
      origBeat: note.startBeat,
      startX: e.clientX,
      previewBeat: note.startBeat,
      moved: false,
    });
  }

  function onNotePointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const raw = Math.max(0, drag.origBeat + xToBeat(dx));
    const previewBeat = snapBeat(raw, snap, ts);
    setDrag({ ...drag, previewBeat, moved: drag.moved || Math.abs(dx) > 4 });
  }

  function onNotePointerUp() {
    if (!drag) return;
    if (drag.moved) {
      moveNote(drag.trackId, drag.noteId, drag.trackId, drag.previewBeat);
    } else {
      removeNote(drag.trackId, drag.noteId); // a click with no drag = remove
    }
    setDrag(null);
  }

  // ---- dropping a sound from the library --------------------------------

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const voiceId = e.dataTransfer.getData(VOICE_DRAG_TYPE) || e.dataTransfer.getData('text/plain');
    if (!voiceId) return;
    const rect = lanesRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gridX = e.clientX - rect.left - HEADER_W;
    dropVoiceAt(voiceId, Math.max(0, xToBeat(gridX)));
  }

  // ---- rendering a single note ------------------------------------------

  function renderNote(track: Track, note: Note, pitches: number[] | null) {
    const isDragging = drag?.noteId === note.id;
    const beat = isDragging ? drag!.previewBeat : note.startBeat;
    const selected = selection.noteId === note.id;
    const width = Math.max(10, beatToX(note.lengthBeats) - 2);

    const style: React.CSSProperties = {
      left: beatToX(beat),
      width,
      background: track.color,
      opacity: isDragging ? 0.8 : 1,
    };

    let label = getVoice(track.instrument.voiceId)?.emoji ?? '●';
    let pitched = false;
    if (pitches && note.pitch != null) {
      pitched = true;
      const idx = nearestIndex(pitches, note.pitch);
      const rowFromTop = pitches.length - 1 - idx;
      style.top = rowFromTop * PITCH_ROW_H + 1;
      style.height = PITCH_ROW_H - 2;
      label = midiToLetter(note.pitch);
    }

    return (
      <div
        key={note.id}
        className={`note ${pitched ? 'pitched' : ''} ${selected ? 'sel' : ''}`}
        style={style}
        onPointerDown={(e) => onNotePointerDown(e, track, note)}
        onPointerMove={onNotePointerMove}
        onPointerUp={onNotePointerUp}
        title="Drag to move · click to remove"
      >
        <span className="vel" style={{ height: `${note.velocity * 100}%` }} />
        {(!pitched || width >= 22) && <span className="emoji">{label}</span>}
      </div>
    );
  }

  return (
    <div className="timeline">
      <div className="timeline-scroll">
        {/* ruler */}
        <div className="ruler">
          <div className="corner">Timeline</div>
          <div className="bars" style={{ width: gridWidth }}>
            {Array.from({ length: project.lengthBars }, (_, i) => (
              <div key={i} className="bar-mark" style={{ left: i * barWidth }}>
                {i + 1}
              </div>
            ))}
          </div>
        </div>

        {/* lanes */}
        <div
          className="lanes"
          ref={lanesRef}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={onDrop}
        >
          {project.tracks.map((track) => {
            const pitches = pitchesFor(track);
            const laneH = laneHeight(track);
            const isSelectedTrack = selection.trackId === track.id;
            return (
              <div className="lane" key={track.id} style={{ height: laneH }}>
                <div
                  className={`lane-header ${isSelectedTrack ? 'selected' : ''}`}
                  onClick={() => select(track.id, selection.noteId)}
                  title="Click to edit this sound"
                >
                  <div className="top">
                    <span className="swatch" style={{ background: track.color }} />
                    <span className="tname">{track.name}</span>
                    <button
                      className="mini del"
                      title="Delete track"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeTrack(track.id);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="controls">
                    <button
                      className={`mini ${track.muted ? 'on-m' : ''}`}
                      title="Mute"
                      onClick={() => toggleMute(track.id)}
                    >
                      M
                    </button>
                    <button
                      className={`mini ${track.solo ? 'on-s' : ''}`}
                      title="Solo"
                      onClick={() => toggleSolo(track.id)}
                    >
                      S
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={track.gain}
                      title="Volume"
                      onChange={(e) => setTrackGain(track.id, Number(e.target.value))}
                    />
                  </div>
                </div>

                <div
                  className="lane-grid"
                  style={{
                    backgroundImage: pitches ? `${verticalLines}, ${horizontalLines}` : verticalLines,
                    width: gridWidth,
                  }}
                  onPointerDown={(e) => onLanePointerDown(e, track)}
                >
                  {/* instrument pitch guides: highlight root rows, label every row */}
                  {pitches?.map((p, i) => {
                    const rowFromTop = pitches.length - 1 - i;
                    const y = rowFromTop * PITCH_ROW_H;
                    const isRoot = (((p % 12) + 12) % 12) === project.scaleRoot;
                    return (
                      <Fragment key={p}>
                        {isRoot && <div className="rootrow" style={{ top: y, height: PITCH_ROW_H }} />}
                        <div
                          className="pitchlabel"
                          style={{ top: y, height: PITCH_ROW_H, lineHeight: `${PITCH_ROW_H}px` }}
                        >
                          {midiToLetter(p)}
                        </div>
                      </Fragment>
                    );
                  })}

                  {track.notes.map((note) => renderNote(track, note, pitches))}
                </div>
              </div>
            );
          })}

          <Playhead height={totalHeight} />

          {noteCount === 0 && (
            <div className="empty-stage">
              Drag a sound or instrument from the left onto a row — or click an empty spot in a row.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
