// The app store: the one place the UI reads state from and sends actions to.
//
// It holds the undo history (whose `present` is the live project), a little
// transient UI state (selection, snap setting, transport mirror), and the
// actions that change them. Every project edit follows the same path: build the
// next project with a pure model helper, commit it to history, and push it to
// the audio engine so what you hear always matches what you see.

import { create } from 'zustand';
import { engine, type PlayMode } from '../audio/AudioEngine';
import * as P from '../model/project';
import type { Project } from '../model/types';
import type { SnapId } from '../model/time';
import { snapBeat } from '../model/time';
import { getVoice, isPitched } from '../model/voices';
import { pitchLadder } from '../model/scales';
import {
  canRedo,
  canUndo,
  commit,
  createHistory,
  DEFAULT_HISTORY_LIMIT,
  redo,
  replacePresent,
  undo,
  type History,
} from './history';
import { openProjectFromFile, saveProjectToFile, saveAudioFile } from '../platform/files';
import { renderProject } from '../audio/render';
import { encodeWav } from '../audio/wav';

export interface Selection {
  /** The track the selected blocks belong to (selection stays within one track). */
  trackId: string | null;
  /** The selected block ids (multi-select). */
  noteIds: string[];
}

export interface StoreState {
  history: History<Project>;
  project: Project; // convenience mirror of history.present
  canUndo: boolean;
  canRedo: boolean;

  isPlaying: boolean;
  isLooping: boolean;
  /** 'song' = play the whole arrangement; 'section' = loop just the edited part. */
  playMode: PlayMode;
  /** Which part the timeline is showing/editing. Always a real section id. */
  currentSectionId: string;
  snap: SnapId;
  selection: Selection;
  status: string | null;
  /** Whether the playable keyboard is open along the bottom. */
  showKeyboard: boolean;

  // lifecycle
  newProject: () => void;
  loadProject: (project: Project) => void;
  saveCurrent: () => Promise<void>;
  openFromFile: () => Promise<void>;
  /** Render the song to a .wav file and save it. */
  exportSong: () => Promise<void>;

  // history
  undo: () => void;
  redo: () => void;
  syncTransport: () => void;

  // transport
  togglePlay: () => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  toggleLoop: () => void;
  setPlayMode: (mode: PlayMode) => void;

  // sections (parts) & arrangement
  setCurrentSection: (sectionId: string) => void;
  addPart: () => void;
  copyPart: (sectionId: string) => void;
  repeatPart: (sectionId: string) => void;
  removeEntry: (entryId: string) => void;
  moveEntry: (fromIndex: number, toIndex: number) => void;
  renamePart: (sectionId: string, name: string) => void;
  /** Change the length (in bars) of the part being edited. */
  setPartBars: (bars: number) => void;

  // editing
  setBpm: (bpm: number) => void;
  addTrackForVoice: (voiceId: string) => string;
  removeTrack: (trackId: string) => void;
  setTrackGain: (trackId: string, gain: number) => void;
  toggleMute: (trackId: string) => void;
  toggleSolo: (trackId: string) => void;
  dropVoiceAt: (voiceId: string, beat: number) => void;
  addNoteAt: (trackId: string, beat: number, opts?: { pitch?: number; velocity?: number }) => void;
  removeNote: (trackId: string, noteId: string) => void;
  moveNote: (fromTrackId: string, noteId: string, toTrackId: string, beat: number) => void;

  // per-block sound + chaining (act on the current selection, plus any chained partners)
  /** Live-update a sound parameter on the selected block(s) while dragging a slider. */
  previewParam: (key: string, value: number) => void;
  /** Live-update the length of the selected block(s) while resizing. */
  previewLength: (lengthBeats: number) => void;
  /** Finalize a live drag (sound or length) into a single undo entry. */
  commitEdit: () => void;
  resetSelected: () => void;
  chainSelected: () => void;
  unchainSelected: () => void;
  removeSelected: () => void;
  auditionSelected: () => void;

  // ui / selection
  setSnap: (snap: SnapId) => void;
  select: (trackId: string | null, noteId?: string | null) => void;
  toggleNoteSelection: (trackId: string, noteId: string) => void;
  selectTrackNotes: (trackId: string) => void;
  audition: (voiceId: string) => void;
  setStatus: (status: string | null) => void;
  toggleKeyboard: () => void;
}

// The project state captured at the start of a live drag (slider or resize), so
// the whole drag collapses into one undo entry when the user lets go. Transient
// UI state, so it lives outside the reactive store.
let editBaseline: Project | null = null;

/** A pleasant default pitch (middle of the instrument's range) for previews and
 *  freshly-dropped instrument notes. Undefined for drums. */
function middlePitch(voiceId: string, project: Project): number | undefined {
  const voice = getVoice(voiceId);
  if (!voice || !isPitched(voice)) return undefined;
  const ladder = pitchLadder(voice.baseMidi ?? 60, voice.octaves ?? 2, project.scaleRoot, project.scaleId);
  return ladder[Math.floor(ladder.length / 2)];
}

/** The given section id if it still exists, else the song's first part. */
function fixSectionId(project: Project, sectionId: string | null): string {
  if (sectionId && project.sections.some((s) => s.id === sectionId)) return sectionId;
  return project.arrangement[0]?.sectionId ?? project.sections[0]?.id ?? '';
}

/**
 * Drop anything selected that isn't a block of the part now on screen. The
 * timeline only draws the current part, so a selection reaching into another one
 * would let the Sound Editor and the Delete key change blocks the child can't
 * see. Undo/redo make this easy to hit: they restore a project where a
 * previously-deleted block exists again.
 */
function pruneSelection(project: Project, sectionId: string, selection: Selection): Selection {
  if (selection.noteIds.length === 0) return selection;
  const visible = new Set<string>();
  for (const t of project.tracks) {
    for (const n of t.notes) if (n.sectionId === sectionId) visible.add(n.id);
  }
  const noteIds = selection.noteIds.filter((id) => visible.has(id));
  if (noteIds.length === selection.noteIds.length) return selection; // unchanged
  return { trackId: selection.trackId, noteIds };
}

export const useStore = create<StoreState>((set, get) => {
  /** Commit a new project to history + engine, keeping mirrors in sync.
   *  Also re-checks the edited part, in case this edit removed it. */
  function apply(next: Project): void {
    const s = get();
    // Model helpers hand back the same project when an edit changes nothing
    // (a stepper at its limit). Committing that would spend an undo step and
    // throw away the redo stack for no reason.
    if (next === s.history.present) return;
    // A discrete edit lands in the middle of a slider or resize drag only when
    // something interrupted it (Delete, a menu command). The drag's starting
    // snapshot is stale from here on — keeping it would let commitEdit push an
    // out-of-order state into the undo history.
    editBaseline = null;
    const history = commit(s.history, next);
    const currentSectionId = fixSectionId(next, s.currentSectionId);
    engine.setProject(next);
    engine.setEditSection(currentSectionId);
    set({
      history,
      project: next,
      currentSectionId,
      selection: pruneSelection(next, currentSectionId, s.selection),
      canUndo: canUndo(history),
      canRedo: canRedo(history),
    });
  }

  /** Point the timeline (and 'section' play mode) at a part. */
  function focusSection(sectionId: string): void {
    engine.setEditSection(sectionId);
    set({ currentSectionId: sectionId, selection: { trackId: null, noteIds: [] } });
  }

  const initialProject = P.createDefaultProject();
  engine.setProject(initialProject);
  const initialSectionId = fixSectionId(initialProject, null);
  engine.setEditSection(initialSectionId);
  const startHistory = createHistory(initialProject);

  return {
    history: startHistory,
    project: initialProject,
    canUndo: false,
    canRedo: false,

    isPlaying: false,
    isLooping: engine.isLoopingOn(),
    playMode: engine.getPlayMode(),
    currentSectionId: initialSectionId,
    snap: 'sixteenth',
    selection: { trackId: null, noteIds: [] },
    status: null,
    showKeyboard: true,

    // ---- lifecycle -------------------------------------------------------
    newProject: () => {
      engine.stop();
      editBaseline = null;
      const project = P.createDefaultProject();
      const history = createHistory(project);
      const currentSectionId = fixSectionId(project, null);
      engine.setProject(project);
      engine.setEditSection(currentSectionId);
      set({
        history,
        project,
        currentSectionId,
        canUndo: false,
        canRedo: false,
        isPlaying: false,
        selection: { trackId: null, noteIds: [] },
        status: 'New song',
      });
    },

    loadProject: (project) => {
      engine.stop();
      editBaseline = null;
      const history = createHistory(project);
      const currentSectionId = fixSectionId(project, null);
      engine.setProject(project);
      engine.setEditSection(currentSectionId);
      set({
        history,
        project,
        currentSectionId,
        canUndo: false,
        canRedo: false,
        isPlaying: false,
        selection: { trackId: null, noteIds: [] },
        status: `Opened "${project.name}"`,
      });
    },

    saveCurrent: async () => {
      try {
        const result = await saveProjectToFile(get().history.present);
        if (result.saved) set({ status: `Saved "${result.name}"` });
      } catch (err) {
        set({ status: `Couldn't save: ${(err as Error).message}` });
      }
    },

    openFromFile: async () => {
      try {
        const result = await openProjectFromFile();
        if (result) get().loadProject(result.project);
      } catch (err) {
        set({ status: `Couldn't open: ${(err as Error).message}` });
      }
    },

    exportSong: async () => {
      const project = get().history.present;
      try {
        set({ status: 'Rendering…' });
        const buffer = await renderProject(project, { loops: 1 });
        const left = buffer.getChannelData(0);
        const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
        const bytes = encodeWav([left, right], buffer.sampleRate);
        const result = await saveAudioFile(project.name, bytes);
        set({ status: result.saved ? `Exported "${project.name}.wav"` : 'Export cancelled' });
      } catch (err) {
        set({ status: `Export failed: ${(err as Error).message}` });
      }
    },

    // ---- history ---------------------------------------------------------
    undo: () => {
      editBaseline = null;
      const s = get();
      const history = undo(s.history);
      const currentSectionId = fixSectionId(history.present, s.currentSectionId);
      engine.setProject(history.present);
      engine.setEditSection(currentSectionId);
      set({
        history,
        project: history.present,
        currentSectionId,
        selection: pruneSelection(history.present, currentSectionId, s.selection),
        canUndo: canUndo(history),
        canRedo: canRedo(history),
      });
    },
    redo: () => {
      editBaseline = null;
      const s = get();
      const history = redo(s.history);
      const currentSectionId = fixSectionId(history.present, s.currentSectionId);
      engine.setProject(history.present);
      engine.setEditSection(currentSectionId);
      set({
        history,
        project: history.present,
        currentSectionId,
        selection: pruneSelection(history.present, currentSectionId, s.selection),
        canUndo: canUndo(history),
        canRedo: canRedo(history),
      });
    },

    syncTransport: () => {
      const t = engine.getTransport();
      const s = get();
      if (t.isPlaying !== s.isPlaying || t.isLooping !== s.isLooping) {
        set({ isPlaying: t.isPlaying, isLooping: t.isLooping });
      }
    },

    // ---- transport -------------------------------------------------------
    togglePlay: () => (get().isPlaying ? get().pause() : get().play()),
    play: () => {
      void engine.play();
      set({ isPlaying: true });
    },
    pause: () => {
      engine.pause();
      set({ isPlaying: false });
    },
    stop: () => {
      engine.stop();
      set({ isPlaying: false });
    },
    toggleLoop: () => {
      const next = !get().isLooping;
      engine.setLooping(next);
      set({ isLooping: next });
    },
    setPlayMode: (mode) => {
      if (mode === get().playMode) return; // pressing the mode you're already in
      engine.setPlayMode(mode); // switching resets the transport
      set({ playMode: mode, isPlaying: false });
    },

    // ---- sections (parts) & arrangement ----------------------------------
    setCurrentSection: (sectionId) => {
      const project = get().history.present;
      if (!project.sections.some((s) => s.id === sectionId)) return;
      focusSection(sectionId);
    },

    addPart: () => {
      const next = P.addSection(get().history.present);
      apply(next);
      focusSection(next.sections[next.sections.length - 1].id);
    },

    copyPart: (sectionId) => {
      const before = get().history.present;
      const next = P.duplicateSection(before, sectionId);
      if (next === before) return;
      apply(next);
      focusSection(next.sections[next.sections.length - 1].id);
    },

    repeatPart: (sectionId) => apply(P.repeatSection(get().history.present, sectionId)),

    removeEntry: (entryId) => apply(P.removeArrangementEntry(get().history.present, entryId)),

    moveEntry: (fromIndex, toIndex) =>
      apply(P.moveArrangementEntry(get().history.present, fromIndex, toIndex)),

    renamePart: (sectionId, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      apply(P.renameSection(get().history.present, sectionId, trimmed.slice(0, 24)));
    },

    setPartBars: (bars) =>
      apply(P.setSectionLength(get().history.present, get().currentSectionId, bars)),

    // ---- editing ---------------------------------------------------------
    setBpm: (bpm) => apply(P.setBpm(get().history.present, bpm)),

    addTrackForVoice: (voiceId) => {
      const track = P.createTrackForVoice(voiceId);
      apply(P.addTrack(get().history.present, track));
      return track.id;
    },

    removeTrack: (trackId) => apply(P.removeTrack(get().history.present, trackId)),
    setTrackGain: (trackId, gain) => apply(P.setTrackGain(get().history.present, trackId, gain)),
    toggleMute: (trackId) => apply(P.toggleTrackMuted(get().history.present, trackId)),
    toggleSolo: (trackId) => apply(P.toggleTrackSolo(get().history.present, trackId)),

    previewParam: (key, value) => {
      const s = get();
      if (s.selection.noteIds.length === 0) return;
      if (!editBaseline) editBaseline = s.history.present;
      const ids = P.expandChain(s.history.present, s.selection.noteIds);
      const next = P.setNotesParam(s.history.present, ids, key, value);
      engine.setProject(next); // heard live if the song is playing
      set({ history: replacePresent(s.history, next), project: next });
    },

    previewLength: (lengthBeats) => {
      const s = get();
      if (s.selection.noteIds.length === 0) return;
      if (!editBaseline) editBaseline = s.history.present;
      const ids = P.expandChain(s.history.present, s.selection.noteIds);
      const next = P.setNotesLength(s.history.present, ids, lengthBeats);
      engine.setProject(next);
      set({ history: replacePresent(s.history, next), project: next });
    },

    commitEdit: () => {
      if (!editBaseline) return;
      const s = get();
      const past = [...s.history.past, editBaseline];
      if (past.length > DEFAULT_HISTORY_LIMIT) past.shift();
      const history = { past, present: s.history.present, future: [] };
      editBaseline = null;
      set({ history, canUndo: canUndo(history), canRedo: canRedo(history) });
    },

    resetSelected: () => {
      editBaseline = null;
      const s = get();
      const ids = P.expandChain(s.history.present, s.selection.noteIds);
      if (ids.size > 0) apply(P.resetNotesParams(s.history.present, ids));
    },

    chainSelected: () => {
      const s = get();
      if (s.selection.noteIds.length < 2) return;
      apply(P.chainNotes(s.history.present, s.selection.noteIds));
    },

    unchainSelected: () => {
      const s = get();
      const ids = [...P.expandChain(s.history.present, s.selection.noteIds)];
      if (ids.length > 0) apply(P.unchainNotes(s.history.present, ids));
    },

    removeSelected: () => {
      const s = get();
      if (s.selection.noteIds.length === 0) return;
      apply(P.removeNotes(s.history.present, new Set(s.selection.noteIds)));
      set({ selection: { trackId: s.selection.trackId, noteIds: [] } });
    },

    auditionSelected: () => {
      const s = get();
      const primaryId = s.selection.noteIds[0];
      if (!primaryId) return;
      const project = s.history.present;
      for (const t of project.tracks) {
        const n = t.notes.find((x) => x.id === primaryId);
        if (n) {
          void engine.audition(t.instrument.voiceId, n.params, Math.max(0.7, n.velocity), n.pitch);
          return;
        }
      }
    },

    /** Drop a library voice onto the song: reuse its track if present, else make one. */
    dropVoiceAt: (voiceId, beat) => {
      const project = get().history.present;
      const snapped = snapBeat(beat, get().snap, project.timeSignature);
      const existing = P.findTrackByVoice(project, voiceId);
      const pitch = middlePitch(voiceId, project);
      const note = P.createNote(get().currentSectionId, snapped, 1, P.DEFAULT_NOTE_VELOCITY, pitch);
      if (existing) {
        apply(P.addNote(project, existing.id, note));
      } else {
        const track = P.createTrackForVoice(voiceId);
        const withTrack = P.addTrack(project, track);
        apply(P.addNote(withTrack, track.id, note));
      }
      void engine.audition(voiceId, {}, 0.9, pitch);
    },

    addNoteAt: (trackId, beat, opts) => {
      const project = get().history.present;
      const track = project.tracks.find((t) => t.id === trackId);
      const snapped = snapBeat(beat, get().snap, project.timeSignature);
      const note = P.createNote(
        get().currentSectionId,
        snapped,
        1,
        opts?.velocity ?? P.DEFAULT_NOTE_VELOCITY,
        opts?.pitch,
      );
      apply(P.addNote(project, trackId, note));
      if (track) {
        void engine.audition(track.instrument.voiceId, note.params, note.velocity, note.pitch);
      }
    },

    removeNote: (trackId, noteId) => apply(P.removeNote(get().history.present, trackId, noteId)),

    moveNote: (fromTrackId, noteId, toTrackId, beat) => {
      const project = get().history.present;
      const snapped = snapBeat(beat, get().snap, project.timeSignature);
      apply(P.moveNote(project, fromTrackId, noteId, toTrackId, snapped));
    },

    // ---- ui / selection --------------------------------------------------
    setSnap: (snap) => set({ snap }),
    select: (trackId, noteId = null) =>
      set({ selection: { trackId, noteIds: noteId ? [noteId] : [] } }),
    toggleNoteSelection: (trackId, noteId) => {
      const s = get();
      // Multi-select stays within one track, so a chain shares a single voice.
      const current = s.selection.trackId === trackId ? s.selection.noteIds : [];
      const noteIds = current.includes(noteId)
        ? current.filter((id) => id !== noteId)
        : [...current, noteId];
      set({ selection: { trackId, noteIds } });
    },
    selectTrackNotes: (trackId) => {
      const track = get().history.present.tracks.find((t) => t.id === trackId);
      // Only the blocks visible right now — the ones in the part being edited.
      const sectionId = get().currentSectionId;
      const noteIds = track
        ? track.notes.filter((n) => n.sectionId === sectionId).map((n) => n.id)
        : [];
      set({ selection: { trackId, noteIds } });
    },
    audition: (voiceId) => {
      const voice = getVoice(voiceId);
      if (!voice) return;
      void engine.audition(voiceId, {}, 0.9, middlePitch(voiceId, get().history.present));
    },
    setStatus: (status) => set({ status }),
    toggleKeyboard: () => {
      const next = !get().showKeyboard;
      if (!next) engine.releaseAllHeld(); // don't leave a note ringing behind it
      set({ showKeyboard: next });
    },
  };
});
