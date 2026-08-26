import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { Note, Track } from '../model/types';
import { beatsPerBar, snapBeat, snapStepInBeats } from '../model/time';
import { getVoice, isPitched, VOICE_CATALOG } from '../model/voices';
import { pitchLadder, midiToLetter, nearestLadderIndex } from '../model/scales';
import { clamp } from '../model/project';
import { resolveArrangement, songBeats, type ResolvedEntry } from '../model/arrange';
import { PX_PER_BEAT, ROW_H, PITCH_ROW_H, HEADER_W, beatToX, xToBeat } from './layout';
import { Playhead, ScrubHandle } from './Playhead';
import { Overview } from './Overview';
import { PartBands } from './PartBands';
import { RecordPointMarker, RecordingBlock } from './RecordPoint';

/**
 * The timeline shows the WHOLE SONG, left to right — every part laid end to
 * end, the way a video editor or GarageBand does it.
 *
 * It used to show one part at a time, with the running order as a separate row
 * of chips above. That split was the single biggest thing standing between a
 * person and this app: the grid showed four bars with no clue what came before
 * or after them, the chips said "A A B A" with no clue what that meant, and
 * while the song played the line simply vanished whenever a part other than
 * the one on screen was sounding. Laying the song out end to end makes every
 * one of those questions stop existing.
 *
 * The song data hasn't changed at all. A part is still written once and played
 * as many times as the running order says — so a block edited in one playing
 * of part A changes in all of them, which is the whole point of a part and is
 * exactly what the 🔁 on a repeated band is there to warn about.
 */

interface DragState {
  noteId: string;
  trackId: string;
  /** The part the block belongs to right now. */
  sectionId: string;
  /** Where it started, as an absolute beat in the song. */
  origAbsBeat: number;
  startX: number;
  /** Where it would land: absolute beat, and the part that beat falls in. */
  previewAbsBeat: number;
  previewSectionId: string;
  previewLocalBeat: number;
  moved: boolean;
  /** Vertical half of the gesture — absent for drums, which have no pitch. */
  startY: number;
  /** The scale the block's track offers, so the drag can step down its rows. */
  pitches: number[] | null;
  /** Where it started, so each move is measured from there and can't compound. */
  origPitch: number | null;
  previewPitch: number | null;
}

/**
 * A press on empty grid, until it declares itself: stay put and it's a click
 * that places a block; move and it's a box being dragged over blocks to select
 * them — the rubber band every grown-up music program uses, and a gesture a
 * child finds by accident. Shift-click still works; it just stopped being the
 * only way.
 */
interface LassoState {
  trackId: string;
  pointerId: number;
  /** Where the press landed, in grid-local pixels — a click places here. */
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
}

export function Timeline() {
  const project = useStore((s) => s.project);
  const currentSectionId = useStore((s) => s.currentSectionId);
  const playMode = useStore((s) => s.playMode);
  const selection = useStore((s) => s.selection);
  const snap = useStore((s) => s.snap);
  const voiceDrag = useStore((s) => s.voiceDrag);
  const addNoteAt = useStore((s) => s.addNoteAt);
  const removeNote = useStore((s) => s.removeNote);
  const moveNote = useStore((s) => s.moveNote);
  const dropVoiceAt = useStore((s) => s.dropVoiceAt);
  const select = useStore((s) => s.select);
  const toggleNoteSelection = useStore((s) => s.toggleNoteSelection);
  const selectNotes = useStore((s) => s.selectNotes);
  const selectTrackNotes = useStore((s) => s.selectTrackNotes);
  const previewLength = useStore((s) => s.previewLength);
  const commitEdit = useStore((s) => s.commitEdit);
  const previewTrackGain = useStore((s) => s.previewTrackGain);
  const previewTrackEcho = useStore((s) => s.previewTrackEcho);
  const toggleMute = useStore((s) => s.toggleMute);
  const toggleSolo = useStore((s) => s.toggleSolo);
  const removeTrack = useStore((s) => s.removeTrack);
  const setTrackVoice = useStore((s) => s.setTrackVoice);
  const seekTo = useStore((s) => s.seekTo);
  const recordAt = useStore((s) => s.recordAt);
  const setRecordAt = useStore((s) => s.setRecordAt);
  const isMicRecording = useStore((s) => s.isMicRecording);
  const moveVoiceDrag = useStore((s) => s.moveVoiceDrag);
  const endVoiceDrag = useStore((s) => s.endVoiceDrag);

  const lanesRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [resize, setResize] = useState<{ startX: number; origLength: number } | null>(null);
  const [lasso, setLasso] = useState<LassoState | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

  // ---- song geometry -----------------------------------------------------

  const ts = project.timeSignature;
  const perBar = beatsPerBar(ts);
  const entries = useMemo(() => resolveArrangement(project), [project]);
  const total = songBeats(project);
  const gridWidth = total * PX_PER_BEAT;
  const barWidth = perBar * PX_PER_BEAT;
  const totalBars = Math.round(total / perBar);

  /** Which part an absolute beat in the song falls in. Past the end, the last. */
  function entryAt(absBeat: number): ResolvedEntry | null {
    if (entries.length === 0) return null;
    for (const e of entries) {
      if (absBeat >= e.startBeat && absBeat < e.startBeat + e.lengthBeats) return e;
    }
    return absBeat < 0 ? entries[0] : entries[entries.length - 1];
  }

  const noteCount = project.tracks.reduce(
    (n, t) => n + t.notes.filter((x) => x.sectionId).length,
    0,
  );

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

  // Show silence where silence is: a muted row — or any row talked over by
  // someone else's Solo — goes visibly grey, so M and S teach themselves the
  // first time they're pressed. Mirrors exactly what the engine plays.
  const anySolo = project.tracks.some((t) => t.solo);

  /** Every drawing of every block on this row: one per playing of its part. */
  function occurrences(track: Track): { entry: ResolvedEntry; note: Note }[] {
    const out: { entry: ResolvedEntry; note: Note }[] = [];
    for (const entry of entries) {
      for (const note of track.notes) {
        if (note.sectionId !== entry.sectionId) continue;
        if (note.startBeat >= entry.lengthBeats) continue; // past the end of its part
        out.push({ entry, note });
      }
    }
    return out;
  }

  // ---- moving the playhead ------------------------------------------------
  //
  // Dragging the line along the ruler was the first thing tried and the first
  // thing that didn't work, because it was never built. It is the ordinary way
  // to hear a particular bit of a song and there is no substitute for it.

  function scrubTo(clientX: number, rulerEl: HTMLElement) {
    const rect = rulerEl.getBoundingClientRect();
    seekTo(Math.max(0, Math.min(total, xToBeat(clientX - rect.left))));
  }

  function onRulerPointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setScrubbing(true);
    scrubTo(e.clientX, e.currentTarget as HTMLElement);
  }
  function onRulerPointerMove(e: React.PointerEvent) {
    if (!scrubbing) return;
    scrubTo(e.clientX, e.currentTarget as HTMLElement);
  }
  function onRulerPointerUp() {
    setScrubbing(false);
  }

  // ---- placing notes, and the drag-a-box select --------------------------
  //
  // A press on empty grid waits to see what the press *is*: let go without
  // moving and a block lands exactly where the press did, or drag and a box
  // sweeps up every block it touches. Selected blocks light up live as the box
  // grows, so the gesture teaches itself.

  function onLanePointerDown(e: React.PointerEvent, track: Track) {
    if (e.target !== e.currentTarget) return; // ignore presses that land on a note
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setLasso({
      trackId: track.id,
      pointerId: e.pointerId,
      startX: e.nativeEvent.offsetX,
      startY: e.nativeEvent.offsetY,
      x: e.nativeEvent.offsetX,
      y: e.nativeEvent.offsetY,
      moved: false,
    });
  }

  /** The blocks the box currently covers — overlapping in time and, on a
   *  note-grid, in rows. Measured against where each block is *drawn*, so a
   *  box thrown over the second playing of a part picks up that part's blocks. */
  function notesInBox(track: Track, box: LassoState): string[] {
    const pitches = pitchesFor(track);
    const loBeat = xToBeat(Math.min(box.startX, box.x));
    const hiBeat = xToBeat(Math.max(box.startX, box.x));
    const loRow = Math.floor(Math.min(box.startY, box.y) / PITCH_ROW_H);
    const hiRow = Math.floor(Math.max(box.startY, box.y) / PITCH_ROW_H);
    const ids = new Set<string>();
    for (const { entry, note } of occurrences(track)) {
      const start = entry.startBeat + note.startBeat;
      if (start + note.lengthBeats <= loBeat || start >= hiBeat) continue;
      if (pitches && note.pitch != null) {
        const row = pitches.length - 1 - nearestLadderIndex(pitches, note.pitch);
        if (row < loRow || row > hiRow) continue;
      }
      ids.add(note.id);
    }
    return [...ids];
  }

  function onLanePointerMove(e: React.PointerEvent, track: Track) {
    if (!lasso || lasso.pointerId !== e.pointerId || lasso.trackId !== track.id) return;
    const x = e.nativeEvent.offsetX;
    const y = e.nativeEvent.offsetY;
    const moved =
      lasso.moved || Math.abs(x - lasso.startX) > 5 || Math.abs(y - lasso.startY) > 5;
    const next = { ...lasso, x, y, moved };
    setLasso(next);
    if (moved) selectNotes(track.id, notesInBox(track, next));
  }

  function onLanePointerUp(e: React.PointerEvent, track: Track) {
    if (!lasso || lasso.pointerId !== e.pointerId) return;
    setLasso(null);
    if (lasso.moved) return; // the box already did the selecting
    // A plain click: place a block where the press landed, in whichever part
    // that stretch of the song belongs to.
    const absBeat = xToBeat(lasso.startX);
    const entry = entryAt(absBeat);
    if (!entry) return;
    const beat = absBeat - entry.startBeat;
    // The voice row is the one row where a click cannot place a block: there
    // is no recording yet to place. It moves the marker that says where the
    // next one starts instead — the same gesture, meaning the same thing.
    if (track.type === 'audio') {
      if (isMicRecording) return;
      const snapped = snapBeat(beat, snap, ts);
      setRecordAt({
        sectionId: entry.sectionId,
        beat: snapped,
        absBeat: entry.startBeat + snapped,
      });
      return;
    }

    const pitches = pitchesFor(track);
    if (pitches) {
      const rowFromTop = clamp(Math.floor(lasso.startY / PITCH_ROW_H), 0, pitches.length - 1);
      const pitch = pitches[pitches.length - 1 - rowFromTop];
      addNoteAt(track.id, beat, { pitch, sectionId: entry.sectionId });
    } else {
      addNoteAt(track.id, beat, { sectionId: entry.sectionId });
    }
  }

  // ---- selecting + moving a block ---------------------------------------

  function onNotePointerDown(e: React.PointerEvent, track: Track, note: Note, entry: ResolvedEntry) {
    e.stopPropagation();
    // Shift / Cmd / Ctrl-click adds or removes from a multi-selection.
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      toggleNoteSelection(track.id, note.id);
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    select(track.id, note.id);
    const pitches = pitchesFor(track);
    const origAbsBeat = entry.startBeat + note.startBeat;
    setDrag({
      noteId: note.id,
      trackId: track.id,
      sectionId: note.sectionId,
      origAbsBeat,
      startX: e.clientX,
      previewAbsBeat: origAbsBeat,
      previewSectionId: note.sectionId,
      previewLocalBeat: note.startBeat,
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
    const step = snap === 'off' ? 0.0625 : snapStepInBeats(snap, ts);
    // Keep the block inside the song. Dragged past the end it would still exist
    // but never play, which just looks like the app ate it.
    const rawAbs = clamp(drag.origAbsBeat + xToBeat(dx), 0, Math.max(0, total - step));
    const snappedAbs = Math.min(snapBeat(rawAbs, snap, ts), Math.max(0, total - step));
    const entry = entryAt(snappedAbs);
    const previewSectionId = entry ? entry.sectionId : drag.sectionId;
    const localRaw = entry ? snappedAbs - entry.startBeat : snappedAbs;
    // The last landing spot inside *this* part, so a block nudged over a
    // boundary lands at the start of the next part rather than off the end of
    // the one it came from.
    const localMax = entry ? Math.max(0, entry.lengthBeats - step) : localRaw;
    const previewLocalBeat = clamp(localRaw, 0, localMax);

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
      const origRow = pitches.length - 1 - nearestLadderIndex(pitches, origPitch);
      const row = clamp(origRow + Math.round(dy / PITCH_ROW_H), 0, pitches.length - 1);
      previewPitch = pitches[pitches.length - 1 - row];
    }

    setDrag({
      ...drag,
      previewAbsBeat: (entry?.startBeat ?? 0) + previewLocalBeat,
      previewSectionId,
      previewLocalBeat,
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
        drag.previewLocalBeat,
        drag.previewPitch ?? undefined,
        drag.previewSectionId,
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

  // ---- carrying a sound in from the library ------------------------------
  //
  // The browser's own drag-and-drop used to do this, and it had two problems
  // that were really the same problem: the picture it drags is a snapshot of
  // whatever was pressed (so a sound trailed a long library row behind it,
  // nothing like the small block it was about to become), and the only place
  // that accepted a drop was the strip of grid belonging to a row that already
  // existed. Everywhere else — the space under the last row, most of the
  // window — silently refused. This does it with plain pointer events instead:
  // the block-shaped preview appears in the lane it would land in, snapped to
  // where it would actually go, and the empty space below the rows means "make
  // a new row for this", which is what dropping there always looked like it
  // meant.

  /**
   * Where a sound being carried over the timeline would actually land.
   *
   * One sound, one row — that is the app's rule, and it is the voice that
   * picks the row, not whatever the pointer happens to be over. So a Conga
   * dragged across the Snare row previews on the *Conga* row if there is one,
   * and on the "new row" strip if there isn't. Previewing under the pointer
   * instead would be a straightforward lie: the block would appear somewhere
   * else the moment it was let go.
   *
   * The pointer's height still means something in the one case where it can:
   * over a melodic row that this sound already owns, it picks the note.
   */
  function dropTargetAt(clientX: number, clientY: number, voiceId: string) {
    const el = lanesRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (clientY < rect.top - 40 || clientY > rect.bottom + 40) return null;
    const gridX = clientX - rect.left - HEADER_W;
    if (gridX < 0) return null; // over the row headers, not the music
    const absBeat = clamp(xToBeat(gridX), 0, Math.max(0, total - 0.0001));
    const entry = entryAt(absBeat);
    if (!entry) return null;
    const beat = snapBeat(absBeat - entry.startBeat, snap, ts);

    const track = project.tracks.find((t) => t.instrument.voiceId === voiceId) ?? null;
    if (!track) {
      return { track: null, pitches: null, pitch: undefined, entry, beat, newRow: true };
    }

    const pitches = pitchesFor(track);
    let pitch = pitches ? pitches[Math.floor(pitches.length / 2)] : undefined;
    if (pitches) {
      // Is the pointer inside this row? If so, its height picks the note.
      let top = rect.top;
      for (const t of project.tracks) {
        const h = laneHeight(t);
        if (t.id === track.id) {
          if (clientY >= top && clientY < top + h) {
            const row = clamp(Math.floor((clientY - top) / PITCH_ROW_H), 0, pitches.length - 1);
            pitch = pitches[pitches.length - 1 - row];
          }
          break;
        }
        top += h;
      }
    }
    return { track, pitches, pitch, entry, beat, newRow: false };
  }

  // A song with a voice row and no marker — one loaded from disk, or one whose
  // first take has just landed — gets the marker put at the start, so the row
  // never sits there with no way to add to it.
  useEffect(() => {
    if (recordAt) return;
    if (!project.tracks.some((t) => t.type === 'audio')) return;
    const first = entries[0];
    if (!first) return;
    setRecordAt({ sectionId: first.sectionId, beat: 0, absBeat: first.startBeat });
  }, [recordAt, project.tracks, entries, setRecordAt]);

  // A marker pointing at a part that has been taken out of the song would sit
  // at a place that no longer exists.
  useEffect(() => {
    if (!recordAt) return;
    if (entries.some((e) => e.sectionId === recordAt.sectionId)) return;
    setRecordAt(null);
  }, [recordAt, entries, setRecordAt]);

  /** Put the "sing from here" marker under this page x. */
  function moveRecordPoint(clientX: number) {
    const el = lanesRef.current;
    if (!el) return;
    const absRaw = xToBeat(clientX - el.getBoundingClientRect().left - HEADER_W);
    const absBeat = clamp(absRaw, 0, Math.max(0, total - 0.0001));
    const entry = entryAt(absBeat);
    if (!entry) return;
    const beat = snapBeat(absBeat - entry.startBeat, snap, ts);
    setRecordAt({ sectionId: entry.sectionId, beat, absBeat: entry.startBeat + beat });
  }

  const dropTarget = voiceDrag?.moved
    ? dropTargetAt(voiceDrag.clientX, voiceDrag.clientY, voiceDrag.voiceId)
    : null;

  // One owner for the whole gesture: the library only picks the sound up. The
  // moves and the drop are read here, where the geometry lives.
  useEffect(() => {
    if (!voiceDrag) return;
    const onMove = (e: PointerEvent) => moveVoiceDrag(e.clientX, e.clientY);
    const onUp = (e: PointerEvent) => {
      const state = useStore.getState().voiceDrag;
      if (state?.moved) {
        const target = dropTargetAt(e.clientX, e.clientY, state.voiceId);
        if (target) dropVoiceAt(state.voiceId, target.beat, target.entry.sectionId, target.pitch);
      }
      endVoiceDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    // dropTargetAt closes over the current project geometry; re-binding on
    // every change keeps the drop landing where the preview said it would.
  });

  // ---- rendering a single block -----------------------------------------

  function renderNote(track: Track, note: Note, entry: ResolvedEntry, pitches: number[] | null) {
    const isDragged = drag?.noteId === note.id;
    // Every playing of a part moves together, because they are the same part.
    // Showing that while the drag is happening is the clearest possible way to
    // say so — and a block leaving its part simply stops being drawn in the
    // parts it is leaving.
    if (isDragged && drag!.moved && drag!.previewSectionId !== entry.sectionId) return null;
    const absBeat =
      isDragged && drag!.moved
        ? entry.startBeat + drag!.previewLocalBeat
        : entry.startBeat + note.startBeat;
    const selected = selection.noteIds.includes(note.id);
    const width = Math.max(10, beatToX(note.lengthBeats) - 2);

    const style: React.CSSProperties = {
      left: beatToX(absBeat),
      width,
      background: track.color,
      opacity: isDragged ? 0.8 : 1,
    };

    let label = note.clipId ? '🎤' : (getVoice(track.instrument.voiceId)?.emoji ?? '●');
    let pitched = false;
    const shownPitch = isDragged && drag!.previewPitch != null ? drag!.previewPitch : note.pitch;
    if (pitches && shownPitch != null) {
      pitched = true;
      const idx = nearestLadderIndex(pitches, shownPitch);
      const rowFromTop = pitches.length - 1 - idx;
      style.top = rowFromTop * PITCH_ROW_H + 1;
      style.height = PITCH_ROW_H - 2;
      label = midiToLetter(shownPitch);
    }

    return (
      <div
        key={`${entry.entryId}:${note.id}`}
        className={`note ${pitched ? 'pitched' : ''} ${note.clipId ? 'clip' : ''} ${selected ? 'sel' : ''}`}
        style={style}
        onPointerDown={(e) => onNotePointerDown(e, track, note, entry)}
        onPointerMove={onNotePointerMove}
        onPointerUp={onNotePointerUp}
        title={
          pitched
            ? 'Click to select · drag sideways to move it in time, up and down to change the note'
            : 'Click to select · drag to move · drag a box on empty grid to select several'
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

  const dragVoice = voiceDrag ? getVoice(voiceDrag.voiceId) : null;

  return (
    <div className="timeline">
      <Overview scrollRef={scrollRef} totalBeats={total} entries={entries} />
      <div className="timeline-scroll" ref={scrollRef}>
        {/* the song's own header: parts on top, bars underneath, both to scale */}
        <div className="timeline-head">
          <div className="head-corner">
            <span className="head-title">Song</span>
            <span className="head-sub">{totalBars} bars</span>
          </div>
          <div
            className="head-track"
            style={{ width: gridWidth }}
            onPointerDown={onRulerPointerDown}
            onPointerMove={onRulerPointerMove}
            onPointerUp={onRulerPointerUp}
            onPointerCancel={onRulerPointerUp}
            title="Drag along here to move through the song"
          >
            <PartBands entries={entries} gridWidth={gridWidth} />
            <div className="bars">
              {Array.from({ length: totalBars }, (_, i) => (
                <div key={i} className="bar-mark" style={{ left: i * barWidth }}>
                  {i + 1}
                </div>
              ))}
            </div>
            <ScrubHandle />
          </div>
        </div>

        {/* lanes */}
        <div className="lanes" data-tour="lanes" ref={lanesRef}>
          {project.tracks.map((track) => {
            const pitches = pitchesFor(track);
            const laneH = laneHeight(track);
            const isSelectedTrack = selection.trackId === track.id;
            const silenced = track.muted || (anySolo && !track.solo);
            const isDropRow = dropTarget?.track?.id === track.id;
            return (
              <div className={`lane ${silenced ? 'silent' : ''}`} key={track.id} style={{ height: laneH }}>
                <div
                  className={`lane-header ${isSelectedTrack ? 'selected' : ''}`}
                  onClick={() => selectTrackNotes(track.id)}
                  title="Click to select all of this row's blocks and shape them"
                >
                  <div className="top">
                    <span className="swatch" style={{ background: track.color }} />
                    {/* A recording is not a voice the app can make, so it has
                        no place in the instrument picker — and the picker had
                        been showing this row as "Kick" and offering to turn a
                        child's singing into a drum, which it cannot do. */}
                    {track.type === 'audio' ? (
                      <span className="tname static" title="What you sang">
                        🎤 {track.name}
                      </span>
                    ) : (
                      <select
                        className="tname"
                        value={track.instrument.voiceId}
                        title="Play this whole row on a different instrument — your tune comes with it"
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          e.stopPropagation();
                          setTrackVoice(track.id, e.target.value);
                        }}
                      >
                        {VOICE_CATALOG.filter(
                          (v) => isPitched(v) === (track.type === 'instrument'),
                        ).map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.emoji} {v.label}
                          </option>
                        ))}
                      </select>
                    )}
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
                      title="Mute — turn this row off"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleMute(track.id);
                      }}
                    >
                      M
                    </button>
                    <button
                      className={`mini ${track.solo ? 'on-s' : ''}`}
                      title="Solo — hear only this row"
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
                  onPointerMove={(e) => onLanePointerMove(e, track)}
                  onPointerUp={(e) => onLanePointerUp(e, track)}
                  onPointerCancel={() => setLasso(null)}
                >
                  {/* where one part ends and the next begins */}
                  {entries.map((e, i) =>
                    i === 0 ? null : (
                      <div
                        key={e.entryId}
                        className="part-edge"
                        style={{ left: beatToX(e.startBeat) }}
                      />
                    ),
                  )}

                  {/* in Part mode only one part is looping — say which */}
                  {playMode === 'section' &&
                    entries
                      .filter((e) => e.sectionId !== currentSectionId)
                      .map((e) => (
                        <div
                          key={`off-${e.entryId}`}
                          className="part-off"
                          style={{ left: beatToX(e.startBeat), width: beatToX(e.lengthBeats) }}
                        />
                      ))}

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

                  {occurrences(track).map(({ entry, note }) =>
                    renderNote(track, note, entry, pitches),
                  )}

                  {/* The voice row's "sing from here" marker, and the take as
                      it is actually being sung. */}
                  {track.type === 'audio' && recordAt && (
                    <>
                      <RecordPointMarker absBeat={recordAt.absBeat} onMoveTo={moveRecordPoint} />
                      {isMicRecording && <RecordingBlock fromAbsBeat={recordAt.absBeat} />}
                    </>
                  )}

                  {/* the sound being carried in, exactly where and how big it
                      will land */}
                  {isDropRow && dropTarget && (
                    <div
                      className={`note drop-ghost ${dropTarget.pitches ? 'pitched' : ''}`}
                      style={{
                        left: beatToX(dropTarget.entry.startBeat + dropTarget.beat),
                        width: Math.max(10, beatToX(1) - 2),
                        background: dragVoice?.color,
                        ...(dropTarget.pitches
                          ? {
                              top:
                                (dropTarget.pitches.length -
                                  1 -
                                  nearestLadderIndex(dropTarget.pitches, dropTarget.pitch ?? 60)) *
                                  PITCH_ROW_H +
                                1,
                              height: PITCH_ROW_H - 2,
                            }
                          : {}),
                      }}
                    >
                      <span className="emoji">{dragVoice?.emoji}</span>
                    </div>
                  )}

                  {lasso?.moved && lasso.trackId === track.id && (
                    <div
                      className="lasso"
                      style={{
                        left: Math.min(lasso.startX, lasso.x),
                        top: Math.min(lasso.startY, lasso.y),
                        width: Math.abs(lasso.x - lasso.startX),
                        height: Math.abs(lasso.y - lasso.startY),
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}

          {/* Below the last row: where a sound that hasn't got a row yet is
              going. It used to be dead space that silently swallowed a drop —
              and since a sound always gets its own row, this is the honest
              place to show one arriving. */}
          <div
            className={`new-row-zone ${dropTarget?.newRow ? 'armed' : ''}`}
            style={{ width: gridWidth + HEADER_W }}
          >
            <span className="new-row-label">
              {dropTarget?.newRow
                ? `Let go — ${dragVoice?.label ?? 'this sound'} gets a row of its own, right here`
                : 'A sound with no row yet lands here'}
            </span>
            {dropTarget?.newRow && dragVoice && (
              <div
                className="note drop-ghost"
                style={{
                  left: HEADER_W + beatToX(dropTarget.entry.startBeat + dropTarget.beat),
                  width: Math.max(10, beatToX(1) - 2),
                  background: dragVoice.color,
                }}
              >
                <span className="emoji">{dragVoice.emoji}</span>
              </div>
            )}
          </div>

          <Playhead height={totalHeight} scrollRef={scrollRef} />

          {noteCount === 0 && (
            <div className="empty-stage">
              Drag a sound from the left onto a row — or click an empty spot in a row.
            </div>
          )}
        </div>
      </div>

      {/* the sound in mid-air, block-shaped, only while it is over nothing that
          can show it in place */}
      {voiceDrag?.moved && !dropTarget && dragVoice && (
        <div
          className="voice-ghost"
          style={{
            left: voiceDrag.clientX,
            top: voiceDrag.clientY,
            background: dragVoice.color,
          }}
        >
          <span className="emoji">{dragVoice.emoji}</span>
        </div>
      )}
    </div>
  );
}
