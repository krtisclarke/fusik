import { Fragment, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { Note, Track } from '../model/types';
import { beatsPerBar, snapBeat, snapStepInBeats } from '../model/time';
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
  /** Vertical half of the gesture — absent for drums, which have no pitch. */
  startY: number;
  /** The scale the block's track offers, so the drag can step down its rows. */
  pitches: number[] | null;
  /** Where it started, so each move is measured from there and can't compound. */
  origPitch: number | null;
  previewPitch: number | null;
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
  const currentSectionId = useStore((s) => s.currentSectionId);
  const selection = useStore((s) => s.selection);
  const snap = useStore((s) => s.snap);
  const addNoteAt = useStore((s) => s.addNoteAt);
  const removeNote = useStore((s) => s.removeNote);
  const moveNote = useStore((s) => s.moveNote);
  const dropVoiceAt = useStore((s) => s.dropVoiceAt);
  const select = useStore((s) => s.select);
  const toggleNoteSelection = useStore((s) => s.toggleNoteSelection);
  const selectTrackNotes = useStore((s) => s.selectTrackNotes);
  const previewLength = useStore((s) => s.previewLength);
  const commitEdit = useStore((s) => s.commitEdit);
  const previewTrackGain = useStore((s) => s.previewTrackGain);
  const previewTrackEcho = useStore((s) => s.previewTrackEcho);
  const toggleMute = useStore((s) => s.toggleMute);
  const toggleSolo = useStore((s) => s.toggleSolo);
  const removeTrack = useStore((s) => s.removeTrack);

  const lanesRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [resize, setResize] = useState<{ startX: number; origLength: number } | null>(null);

  // The timeline shows one part of the song at a time (pick parts in the strip
  // above). Only the current part's blocks are drawn and edited here.
  const section =
    project.sections.find((s) => s.id === currentSectionId) ?? project.sections[0];
  const sectionNotes = (t: Track) => t.notes.filter((n) => n.sectionId === section.id);

  const ts = project.timeSignature;
  const perBar = beatsPerBar(ts);
  const total = section.lengthBars * perBar;
  const gridWidth = total * PX_PER_BEAT;
  const barWidth = perBar * PX_PER_BEAT;

  const noteCount = project.tracks.reduce((n, t) => n + sectionNotes(t).length, 0);

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

  // ---- placing notes ----------------------------------------------------

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

  // ---- selecting + moving a block ---------------------------------------

  function onNotePointerDown(e: React.PointerEvent, track: Track, note: Note) {
    e.stopPropagation();
    // Shift / Cmd / Ctrl-click adds or removes from a multi-selection.
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      toggleNoteSelection(track.id, note.id);
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    select(track.id, note.id);
    const pitches = pitchesFor(track);
    setDrag({
      noteId: note.id,
      trackId: track.id,
      origBeat: note.startBeat,
      startX: e.clientX,
      previewBeat: note.startBeat,
      moved: false,
      startY: e.clientY,
      pitches: note.pitch != null ? pitches : null,
      origPitch: note.pitch ?? null,
      previewPitch: note.pitch ?? null,
    });
  }

  function onNotePointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const raw = Math.max(0, drag.origBeat + xToBeat(dx));
    // Keep the block inside its part. A block dragged past the end would still
    // exist but never play, which just looks like the app ate it.
    const step = snap === 'off' ? 0.0625 : snapStepInBeats(snap, ts);
    const lastStart = Math.max(0, total - step);
    const previewBeat = Math.min(snapBeat(raw, snap, ts), lastStart);

    // Up and down moves the note through the scale, one row per row. The rows
    // *are* the scale, so a dragged note lands on a real note of it and can't
    // be dropped somewhere that sounds wrong — the same promise the note-grid
    // makes when a block is first placed.
    let previewPitch = drag.previewPitch;
    const { pitches, origPitch } = drag;
    if (pitches && origPitch != null) {
      // Measured from where the drag started, never from the last preview —
      // otherwise every move event would step again from the step before and
      // the note would run away up the scale.
      const origRow = pitches.length - 1 - nearestIndex(pitches, origPitch);
      const row = clamp(origRow + Math.round(dy / PITCH_ROW_H), 0, pitches.length - 1);
      previewPitch = pitches[pitches.length - 1 - row];
    }

    setDrag({
      ...drag,
      previewBeat,
      previewPitch,
      // A drag straight up or down moves nothing sideways, and must still count
      // as a move or letting go would throw the new pitch away.
      moved: drag.moved || Math.abs(dx) > 4 || Math.abs(dy) > 4,
    });
  }

  function onNotePointerUp() {
    if (!drag) return;
    if (drag.moved) {
      moveNote(
        drag.trackId,
        drag.noteId,
        drag.trackId,
        drag.previewBeat,
        drag.previewPitch ?? undefined,
      );
    }
    // A click with no drag just selects (done on pointer-down). Remove via the ✕
    // on the block or the Delete key — no accidental deletes.
    setDrag(null);
  }

  // ---- resizing a block's length (chained blocks resize together) -------

  function onResizePointerDown(e: React.PointerEvent, track: Track, note: Note) {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    select(track.id, note.id);
    setResize({ startX: e.clientX, origLength: note.lengthBeats });
  }

  function onResizePointerMove(e: React.PointerEvent) {
    if (!resize) return;
    const dx = e.clientX - resize.startX;
    const step = snap === 'off' ? 0.0625 : snapStepInBeats(snap, ts);
    const raw = resize.origLength + xToBeat(dx);
    const snapped = snap === 'off' ? raw : snapBeat(raw, snap, ts);
    previewLength(Math.max(step, snapped));
  }

  function onResizePointerUp() {
    if (!resize) return;
    commitEdit();
    setResize(null);
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

  // ---- rendering a single block -----------------------------------------

  function renderNote(track: Track, note: Note, pitches: number[] | null) {
    const isDragging = drag?.noteId === note.id;
    const beat = isDragging ? drag!.previewBeat : note.startBeat;
    const selected = selection.noteIds.includes(note.id);
    const width = Math.max(10, beatToX(note.lengthBeats) - 2);

    const style: React.CSSProperties = {
      left: beatToX(beat),
      width,
      background: track.color,
      opacity: isDragging ? 0.8 : 1,
    };

    let label = getVoice(track.instrument.voiceId)?.emoji ?? '●';
    let pitched = false;
    const shownPitch = isDragging && drag!.previewPitch != null ? drag!.previewPitch : note.pitch;
    if (pitches && shownPitch != null) {
      pitched = true;
      const idx = nearestIndex(pitches, shownPitch);
      const rowFromTop = pitches.length - 1 - idx;
      style.top = rowFromTop * PITCH_ROW_H + 1;
      style.height = PITCH_ROW_H - 2;
      label = midiToLetter(shownPitch);
    }

    return (
      <div
        key={note.id}
        className={`note ${pitched ? 'pitched' : ''} ${selected ? 'sel' : ''}`}
        style={style}
        onPointerDown={(e) => onNotePointerDown(e, track, note)}
        onPointerMove={onNotePointerMove}
        onPointerUp={onNotePointerUp}
        title={
          pitched
            ? 'Click to select · drag sideways to move it in time, up and down to change the note'
            : 'Click to select · Shift-click to add · drag to move'
        }
      >
        <span className="vel" style={{ height: `${note.velocity * 100}%` }} />
        {(!pitched || width >= 22) && <span className="emoji">{label}</span>}
        {note.groupId && (
          <span className="note-link" title="Linked — shares sound & length with its chain">
            🔗
          </span>
        )}
        {selected && (
          <button
            className="note-x"
            title="Remove this block (or press Delete)"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              removeNote(track.id, note.id);
            }}
          >
            ✕
          </button>
        )}
        {selected && (
          <span
            className="note-resize"
            title="Drag to change length"
            onPointerDown={(e) => onResizePointerDown(e, track, note)}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
          />
        )}
      </div>
    );
  }

  return (
    <div className="timeline">
      <div className="timeline-scroll">
        {/* ruler */}
        <div className="ruler">
          <div className="corner">Part {section.name}</div>
          <div className="bars" style={{ width: gridWidth }}>
            {Array.from({ length: section.lengthBars }, (_, i) => (
              <div key={i} className="bar-mark" style={{ left: i * barWidth }}>
                {i + 1}
              </div>
            ))}
          </div>
        </div>

        {/* lanes */}
        <div
          className="lanes"
          data-tour="lanes"
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
                  onClick={() => selectTrackNotes(track.id)}
                  title="Click to select all of this row's blocks and shape them"
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
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleMute(track.id);
                      }}
                    >
                      M
                    </button>
                    <button
                      className={`mini ${track.solo ? 'on-s' : ''}`}
                      title="Solo"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSolo(track.id);
                      }}
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
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => previewTrackGain(track.id, Number(e.target.value))}
                      onPointerUp={commitEdit}
                      onKeyUp={commitEdit}
                    />
                  </div>
                  <div className="controls echo-row">
                    <span className={`echo-lbl ${track.echo > 0 ? 'on' : ''}`}>🔁</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={track.echo}
                      title="Echo — how much this sound repeats. All the way left is off."
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => previewTrackEcho(track.id, Number(e.target.value))}
                      onPointerUp={commitEdit}
                      onKeyUp={commitEdit}
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

                  {sectionNotes(track).map((note) => renderNote(track, note, pitches))}
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
