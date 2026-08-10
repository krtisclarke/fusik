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
