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
import { snapBeat, snapStepInBeats } from '../model/time';
import { songPositionAt } from '../model/arrange';
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
import { clearAutosave, readAutosave } from '../platform/autosave';
import { hasSeenTutorial, markTutorialSeen } from '../platform/prefs';
import { TOUR_STEPS } from './tour';
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
  /** Recording is armed: anything played while the song runs is kept. */
  isRecording: boolean;
  /**
   * Which step of the first-song walkthrough is showing, or null when it isn't
   * running. See state/tour.ts.
   */
  tourStep: number | null;
  /**
   * How many notes have been played by hand on the keyboard since the app
   * opened. The walkthrough watches this to know the child has actually played
   * something; nothing else uses it, and it is deliberately not part of the
   * song.
   */
  playedNotes: number;

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
  /** Change the song's mood. Every note already written moves with it. */
  setScale: (scaleId: string) => void;
  addTrackForVoice: (voiceId: string) => string;
  removeTrack: (trackId: string) => void;
  setTrackGain: (trackId: string, gain: number) => void;
  toggleMute: (trackId: string) => void;
  toggleSolo: (trackId: string) => void;
  /** How much echo the whole track gets, 0..1. */
  setTrackEcho: (trackId: string, echo: number) => void;
  /** Live-drag the echo slider; one undo step per drag via commitEdit. */
  previewTrackEcho: (trackId: string, echo: number) => void;
  /** Live-drag the volume slider; one undo step per drag via commitEdit. */
  previewTrackGain: (trackId: string, gain: number) => void;
  dropVoiceAt: (voiceId: string, beat: number) => void;
  addNoteAt: (trackId: string, beat: number, opts?: { pitch?: number; velocity?: number }) => void;
  removeNote: (trackId: string, noteId: string) => void;
  /** Move a block in time, and — for a block that has a pitch — up or down the scale. */
  moveNote: (
    fromTrackId: string,
    noteId: string,
    toTrackId: string,
    beat: number,
    pitch?: number,
  ) => void;

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

  // recording a performance
  /** Arm/disarm recording. Armed + playing = what you play is kept. */
  toggleRecording: () => void;
  /**
   * Write a note played on the keyboard into the song. `startBeats`/`endBeats`
   * are transport positions taken when the key went down and came back up.
   */
  recordPlayedNote: (played: {
    voiceId: string;
    midi: number;
    startBeats: number;
    endBeats: number;
    velocity: number;
  }) => void;

  // ui / selection
  setSnap: (snap: SnapId) => void;
  select: (trackId: string | null, noteId?: string | null) => void;
  toggleNoteSelection: (trackId: string, noteId: string) => void;
  selectTrackNotes: (trackId: string) => void;
  audition: (voiceId: string) => void;
  setStatus: (status: string | null) => void;
  toggleKeyboard: () => void;

  // the first-song walkthrough
  /** Start it from the beginning (the ? button, or first run). */
  startTour: () => void;
  /** Move on a step; past the last one it finishes. */
  nextTourStep: () => void;
  /** Close it, and don't offer it again on its own. */
  endTour: () => void;
  /** A key was pressed on the playable keyboard. */
  notePlayed: () => void;
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

  /**
   * Fold everything since the baseline into a single undo entry. Used when a
   * live gesture ends: a slider released, a block finished resizing, a recording
   * take stopped.
   */
  function closeBaseline(): void {
    if (!editBaseline) return;
    const s = get();
    const baseline = editBaseline;
    editBaseline = null;
    // Nothing actually happened between picking the thing up and putting it
    // down: a record button armed and disarmed without playing, a slider
    // dragged and returned to where it started. Committing that would spend an
    // undo step that undoes nothing, so the child's *next* undo appears to do
    // nothing and they have to press it twice to get their work back.
    //
    // Compared by value, not identity: a drag builds a new project object per
    // step, so the one it ends on is always a different object even when it
    // holds exactly the same song. A project is plain JSON by definition — it's
    // the save format — so stringifying is a sound comparison, and this runs
    // once when a gesture ends, not while it moves.
    if (baseline === s.history.present) return;
    if (JSON.stringify(baseline) === JSON.stringify(s.history.present)) return;
    const past = [...s.history.past, baseline];
    if (past.length > DEFAULT_HISTORY_LIMIT) past.shift();
    const history = { past, present: s.history.present, future: [] };
    set({ history, canUndo: canUndo(history), canRedo: canRedo(history) });
  }

  /** Point the timeline (and 'section' play mode) at a part. */
  function focusSection(sectionId: string): void {
    engine.setEditSection(sectionId);
    set({ currentSectionId: sectionId, selection: { trackId: null, noteIds: [] } });
  }

  // The song from last time, if the app was closed with one in progress. It
  // comes back through the same validation a file does, and anything unreadable
  // simply means "start fresh" — the app must never fail to open.
  const restored = readAutosave();
  const initialProject = restored?.project ?? P.createDefaultProject();
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
    status: restored ? 'Picked up where you left off' : null,
    showKeyboard: true,
    isRecording: false,
    // Offered once, unasked, to a child opening the app for the first time —
    // and only when there is no song to come back to, so it can never appear
    // over work already in progress.
    tourStep: restored || hasSeenTutorial() ? null : 0,
    playedNotes: 0,

    // ---- lifecycle -------------------------------------------------------
    newProject: () => {
      // With autosave in, the song on screen is the only copy unless the child
      // chose to save a file — and New sits right next to Open and Save. Undo
      // can't bring it back either, because a new song starts a new history. So
      // this is the one control here that can destroy work outright: ask first,
      // but only when there is something to lose.
      const hasWork = get().history.present.tracks.some((t) => t.notes.length > 0);
      if (hasWork && typeof window !== 'undefined' && typeof window.confirm === 'function') {
        if (!window.confirm('Start a new song? This one will be cleared.')) return;
      }
      engine.stop();
      editBaseline = null;
      // Nothing to come back to any more. The autosave of the *new* song lands
      // a moment later on its own; clearing here means that even if writing
      // fails (storage full), the old song can't reappear at the next start.
      clearAutosave();
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
        isRecording: false,
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
        isRecording: false,
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
      // Close the take when the music stops, so what was just played is one
      // undo step. Recording stays armed — pressing play again starts a new one.
      if (get().isRecording) closeBaseline();
      set({ isPlaying: false });
    },
    stop: () => {
      engine.stop();
      if (get().isRecording) closeBaseline();
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

    setScale: (scaleId) => {
      const project = get().history.present;
      apply(P.setScale(project, project.scaleRoot, scaleId));
    },

    addTrackForVoice: (voiceId) => {
      const track = P.createTrackForVoice(voiceId);
      apply(P.addTrack(get().history.present, track));
      return track.id;
    },

    removeTrack: (trackId) => apply(P.removeTrack(get().history.present, trackId)),
    setTrackGain: (trackId, gain) => apply(P.setTrackGain(get().history.present, trackId, gain)),
    toggleMute: (trackId) => apply(P.toggleTrackMuted(get().history.present, trackId)),
    toggleSolo: (trackId) => apply(P.toggleTrackSolo(get().history.present, trackId)),
    setTrackEcho: (trackId, echo) => apply(P.setTrackEcho(get().history.present, trackId, echo)),

    previewTrackGain: (trackId, gain) => {
      const s = get();
      const next = P.setTrackGain(s.history.present, trackId, gain);
      if (next === s.history.present) return;
      if (!editBaseline) editBaseline = s.history.present;
      engine.setProject(next);
      set({ history: replacePresent(s.history, next), project: next });
    },

    previewTrackEcho: (trackId, echo) => {
      const s = get();
      const next = P.setTrackEcho(s.history.present, trackId, echo);
      if (next === s.history.present) return;
      if (!editBaseline) editBaseline = s.history.present;
      engine.setProject(next); // heard immediately, even mid-song
      set({ history: replacePresent(s.history, next), project: next });
    },

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
      // Mid-take, everything the child does belongs to that take: it is all one
      // undo step, closed when recording stops. A slider let go of in the middle
      // must not close it early and split the take in two. Closing the take
      // itself goes through closeBaseline() below, which has no such guard.
      if (get().isRecording) return;
      closeBaseline();
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

    moveNote: (fromTrackId, noteId, toTrackId, beat, pitch) => {
      const project = get().history.present;
      const snapped = snapBeat(beat, get().snap, project.timeSignature);
      apply(P.moveNote(project, fromTrackId, noteId, toTrackId, snapped, pitch));
    },

    // ---- recording a performance -----------------------------------------
    //
    // A whole take collapses into one undo step: arming captures a baseline,
    // each finished note is folded into the live project without touching the
    // history, and disarming (or stopping) commits the lot. So a child who
    // records four bars and hates it presses undo once, not forty times.

    toggleRecording: () => {
      const wasRecording = get().isRecording;
      if (wasRecording) {
        closeBaseline(); // close the take into a single undo step
        set({ isRecording: false, status: 'Recording stopped' });
        return;
      }
      editBaseline = get().history.present;
      set({ isRecording: true, status: 'Recording — play the keyboard' });
    },

    recordPlayedNote: ({ voiceId, midi, startBeats, endBeats, velocity }) => {
      const s = get();
      if (!s.isRecording || !s.isPlaying) return; // armed but parked: just a preview
      const project = s.history.present;

      // Where the song was when the key went down. In Part mode the transport
      // position *is* the position in the part being edited; playing the whole
      // song, it's an absolute beat that has to be traced back to whichever
      // part was sounding — so a take spanning A into B lands in both.
      let sectionId: string;
      let beatInSection: number;
      if (s.playMode === 'section') {
        sectionId = s.currentSectionId;
        beatInSection = startBeats;
      } else {
        const at = songPositionAt(project, startBeats);
        if (!at) return;
        sectionId = at.entry.sectionId;
        beatInSection = at.beatInSection;
      }
      const section = project.sections.find((x) => x.id === sectionId);
      if (!section) return;

      const ts = project.timeSignature;
      const sectionBeats = section.lengthBars * ts.numerator;
      const step = s.snap === 'off' ? 0.25 : snapStepInBeats(s.snap, ts);
      const start = Math.min(snapBeat(beatInSection, s.snap, ts), Math.max(0, sectionBeats - step));

      // Held past the end of the pass, so the release wrapped around to a
      // smaller number than the press. Run it to the end of the part instead.
      let lengthBeats = endBeats - startBeats;
      if (lengthBeats <= 0) lengthBeats = sectionBeats - beatInSection;
      lengthBeats = Math.max(step, s.snap === 'off' ? lengthBeats : snapBeat(lengthBeats, s.snap, ts));
      lengthBeats = Math.min(lengthBeats, sectionBeats - start);

      const note = P.createNote(sectionId, start, lengthBeats, velocity, midi);
      const existing = P.findTrackByVoice(project, voiceId);
      let next: Project;
      if (existing) {
        next = P.addNote(project, existing.id, note);
      } else {
        const track = P.createTrackForVoice(voiceId);
        next = P.addNote(P.addTrack(project, track), track.id, note);
      }

      // Straight into the live project, not the history — the note appears on
      // the timeline at once and is heard on the next pass, but the take stays
      // a single undo step until it's finished.
      if (!editBaseline) editBaseline = project;
      engine.setProject(next);
      set({ history: replacePresent(s.history, next), project: next });
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
    startTour: () => set({ tourStep: 0 }),
    nextTourStep: () => {
      const step = get().tourStep;
      if (step == null) return;
      if (step + 1 >= TOUR_STEPS.length) {
        get().endTour();
        return;
      }
      set({ tourStep: step + 1 });
    },
    endTour: () => {
      markTutorialSeen();
      set({ tourStep: null });
    },
    notePlayed: () => set({ playedNotes: get().playedNotes + 1 }),

    toggleKeyboard: () => {
      const next = !get().showKeyboard;
      if (!next) engine.releaseAllHeld(); // don't leave a note ringing behind it
      set({ showKeyboard: next });
    },
  };
});
