// Saving and opening projects, working in two worlds:
//  - As the desktop app, `window.desktop` (from Electron's preload) gives us
//    real native Save/Open dialogs.
//  - In a plain browser (used for development and testing), we fall back to a
//    normal file download and a hidden file picker.
// The rest of the app calls these two functions and never worries which it is.

import { serializeProject, parseProject } from '../model/serialization';
import type { Project } from '../model/types';

const EXTENSION = 'beatbox';

interface DesktopBridge {
  isDesktop: boolean;
  saveProject: (
    suggestedName: string,
    json: string,
  ) => Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
  openProject: () => Promise<{ ok: boolean; canceled?: boolean; path?: string; json?: string }>;
  saveAudio?: (
    suggestedName: string,
    bytes: Uint8Array<ArrayBuffer>,
    extension: string,
  ) => Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
  /** The songs folder. Synchronous — see the handlers in electron/main.cjs. */
  songs?: {
    list: () => { ok: boolean; songs?: { id: string; name: string; savedAt: number }[] };
    read: (id: string) => { ok: boolean; json?: string };
    write: (id: string, name: string, json: string) => { ok: boolean; id?: string };
    remove: (id: string) => { ok: boolean };
    folder: () => { ok: boolean; path?: string };
  };
  /** A song's recordings, kept beside it on disk. */
  clips?: {
    write: (
      songId: string,
      clipId: string,
      bytes: Uint8Array,
      extension: string,
    ) => Promise<{ ok: boolean }>;
    read: (songId: string, clipId: string) => Promise<{ ok: boolean; bytes?: ArrayBuffer }>;
    remove: (songId: string, clipId: string) => Promise<{ ok: boolean }>;
    sweep: (songId: string, keep: string[]) => Promise<{ ok: boolean; removed?: number }>;
  };
  /** The instrument recordings that ship inside the app bundle. */
  samples?: {
    read: (setId: string, file: string) => Promise<{ ok: boolean; bytes?: ArrayBuffer }>;
  };
  onMenu: (channel: string, handler: () => void) => () => void;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

export function getDesktop(): DesktopBridge | undefined {
  return typeof window !== 'undefined' ? window.desktop : undefined;
}

export interface SaveResult {
  saved: boolean;
  name?: string;
}

export async function saveProjectToFile(project: Project): Promise<SaveResult> {
  const json = serializeProject(project);
  const desktop = getDesktop();

  if (desktop?.isDesktop) {
    const result = await desktop.saveProject(project.name, json);
    return { saved: result.ok, name: project.name };
  }

  // Browser fallback: trigger a download.
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitize(project.name)}.${EXTENSION}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { saved: true, name: project.name };
}

export type AudioFormat = 'mp3' | 'wav';

const AUDIO_MIME: Record<AudioFormat, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

/** Save rendered audio bytes — native dialog on desktop, download in the browser. */
export async function saveAudioFile(
  name: string,
  bytes: Uint8Array<ArrayBuffer>,
  format: AudioFormat,
): Promise<{ saved: boolean }> {
  const desktop = getDesktop();
  if (desktop?.isDesktop && desktop.saveAudio) {
    const result = await desktop.saveAudio(name, bytes, format);
    return { saved: result.ok };
  }
  const blob = new Blob([bytes], { type: AUDIO_MIME[format] });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitize(name)}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { saved: true };
}

export interface OpenResult {
  project: Project;
}

/** Returns the opened project, or null if the user cancelled. Throws on a bad file. */
export async function openProjectFromFile(): Promise<OpenResult | null> {
  const desktop = getDesktop();

  if (desktop?.isDesktop) {
    const result = await desktop.openProject();
    if (!result.ok || !result.json) return null;
    return { project: parseProject(result.json) };
  }

  // Browser fallback: a hidden file input.
  const text = await pickFileText();
  if (text == null) return null;
  return { project: parseProject(text) };
}

function pickFileText(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `.${EXTENSION},application/json`;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    // If the dialog is dismissed there is no reliable cancel event; that's fine,
    // the promise simply never resolves and no project is loaded.
    input.click();
  });
}

function sanitize(name: string): string {
  return name.replace(/[^\w\- ]+/g, '').trim() || 'My Song';
}
