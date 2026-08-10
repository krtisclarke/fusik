// The app store: the one place the UI reads state from and sends actions to.
//
// It holds the undo history (whose `present` is the live project), a little
// transient UI state (selection, snap setting, transport mirror), and the
// actions that change them. Every project edit follows the same path: build the
// next project with a pure model helper, commit it to history, and push it to
// the audio engine so what you hear always matches what you see.

import { create } from 'zustand';
import { engine } from '../audio/AudioEngine';
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
  redo,
  undo,
  type History,
} from './history';
import { openProjectFromFile, saveProjectToFile } from '../platform/files';

export interface Selection {
  trackId: string | null;
  noteId: string | null;
}

export interface StoreState {
  history: History<Project>;
  project: Project; // convenience mirror of history.present
  canUndo: boolean;
  canRedo: boolean;

  isPlaying: boolean;
  isLooping: boolean;
  snap: SnapId;
  selection: Selection;
  status: string | null;

  // lifecycle
  newProject: () => void;
  loadProject: (project: Project) => void;
  saveCurrent: () => Promise<void>;
  openFromFile: () => Promise<void>;

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

  // editing
  setBpm: (bpm: number) => void;
  setLengthBars: (bars: number) => void;
  addTrackForVoice: (voiceId: string) => string;
  removeTrack: (trackId: string) => void;
  setTrackGain: (trackId: string, gain: number) => void;
  toggleMute: (trackId: string) => void;
  toggleSolo: (trackId: string) => void;
  dropVoiceAt: (voiceId: string, beat: number) => void;
  addNoteAt: (trackId: string, beat: number, opts?: { pitch?: number; velocity?: number }) => void;
  removeNote: (trackId: string, noteId: string) => void;
  moveNote: (fromTrackId: string, noteId: string, toTrackId: string, beat: number) => void;

  // ui
  setSnap: (snap: SnapId) => void;
  select: (trackId: string | null, noteId?: string | null) => void;
  audition: (voiceId: string) => void;
  setStatus: (status: string | null) => void;
}

/** A pleasant default pitch (middle of the instrument's range) for previews and
 *  freshly-dropped instrument notes. Undefined for drums. */
function middlePitch(voiceId: string, project: Project): number | undefined {
  const voice = getVoice(voiceId);
  if (!voice || !isPitched(voice)) return undefined;
  const ladder = pitchLadder(voice.baseMidi ?? 60, voice.octaves ?? 2, project.scaleRoot, project.scaleId);
  return ladder[Math.floor(ladder.length / 2)];
}

export const useStore = create<StoreState>((set, get) => {
  /** Commit a new project to history + engine, keeping mirrors in sync. */
  function apply(next: Project): void {
    const history = commit(get().history, next);
    engine.setProject(next);
    set({ history, project: next, canUndo: canUndo(history), canRedo: canRedo(history) });
  }

  const initialProject = P.createDefaultProject();
  engine.setProject(initialProject);
  const startHistory = createHistory(initialProject);

  return {
    history: startHistory,
    project: initialProject,
    canUndo: false,
    canRedo: false,

    isPlaying: false,
    isLooping: engine.isLoopingOn(),
    snap: 'sixteenth',
    selection: { trackId: null, noteId: null },
    status: null,

    // ---- lifecycle -------------------------------------------------------
    newProject: () => {
      engine.stop();
      const project = P.createDefaultProject();
      const history = createHistory(project);
      engine.setProject(project);
      set({
        history,
        project,
        canUndo: false,
        canRedo: false,
        isPlaying: false,
        selection: { trackId: null, noteId: null },
        status: 'New song',
      });
    },

    loadProject: (project) => {
      engine.stop();
      const history = createHistory(project);
      engine.setProject(project);
      set({
        history,
        project,
        canUndo: false,
        canRedo: false,
        isPlaying: false,
        selection: { trackId: null, noteId: null },
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

    // ---- history ---------------------------------------------------------
    undo: () => {
      const history = undo(get().history);
      engine.setProject(history.present);
      set({ history, project: history.present, canUndo: canUndo(history), canRedo: canRedo(history) });
    },
    redo: () => {
      const history = redo(get().history);
      engine.setProject(history.present);
      set({ history, project: history.present, canUndo: canUndo(history), canRedo: canRedo(history) });
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

    // ---- editing ---------------------------------------------------------
    setBpm: (bpm) => apply(P.setBpm(get().history.present, bpm)),
    setLengthBars: (bars) => apply(P.setLengthBars(get().history.present, bars)),

    addTrackForVoice: (voiceId) => {
      const track = P.createTrackForVoice(voiceId);
      apply(P.addTrack(get().history.present, track));
      return track.id;
    },

    removeTrack: (trackId) => apply(P.removeTrack(get().history.present, trackId)),
    setTrackGain: (trackId, gain) => apply(P.setTrackGain(get().history.present, trackId, gain)),
    toggleMute: (trackId) => apply(P.toggleTrackMuted(get().history.present, trackId)),
    toggleSolo: (trackId) => apply(P.toggleTrackSolo(get().history.present, trackId)),

    /** Drop a library voice onto the song: reuse its track if present, else make one. */
    dropVoiceAt: (voiceId, beat) => {
      const project = get().history.present;
      const snapped = snapBeat(beat, get().snap, project.timeSignature);
      const existing = P.findTrackByVoice(project, voiceId);
      const pitch = middlePitch(voiceId, project);
      const note = P.createNote(snapped, 1, P.DEFAULT_NOTE_VELOCITY, pitch);
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
      const note = P.createNote(snapped, 1, opts?.velocity ?? P.DEFAULT_NOTE_VELOCITY, opts?.pitch);
      apply(P.addNote(project, trackId, note));
      if (track) {
        void engine.audition(track.instrument.voiceId, track.instrument.params, note.velocity, note.pitch);
      }
    },

    removeNote: (trackId, noteId) => apply(P.removeNote(get().history.present, trackId, noteId)),

    moveNote: (fromTrackId, noteId, toTrackId, beat) => {
      const project = get().history.present;
      const snapped = snapBeat(beat, get().snap, project.timeSignature);
      apply(P.moveNote(project, fromTrackId, noteId, toTrackId, snapped));
    },

    // ---- ui --------------------------------------------------------------
    setSnap: (snap) => set({ snap }),
    select: (trackId, noteId = null) => set({ selection: { trackId, noteId } }),
    audition: (voiceId) => {
      const voice = getVoice(voiceId);
      if (!voice) return;
      void engine.audition(voiceId, {}, 0.9, middlePitch(voiceId, get().history.present));
    },
    setStatus: (status) => set({ status }),
  };
});
