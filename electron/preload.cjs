// Preload script — the only bridge between the web app and the desktop.
//
// contextIsolation is on, so the renderer cannot touch Node or Electron
// directly. We expose a tiny, explicit `window.desktop` surface: just the
// handful of file operations the app needs, nothing more. Everything else
// (audio, UI, project logic) is plain web code that also runs in a browser.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,

  /** Save project JSON via a native dialog. */
  saveProject: (suggestedName, json) =>
    ipcRenderer.invoke('project:save', { suggestedName, json }),

  /** Open a project file via a native dialog; returns its JSON text. */
  openProject: () => ipcRenderer.invoke('project:open'),

  /** Save rendered WAV bytes via a native dialog. */
  saveAudio: (suggestedName, bytes) => ipcRenderer.invoke('audio:save', { suggestedName, bytes }),

  /** Subscribe to native menu commands. Returns an unsubscribe function. */
  onMenu: (channel, handler) => {
    const allowed = ['menu:new', 'menu:open', 'menu:save', 'menu:undo', 'menu:redo'];
    if (!allowed.includes(channel)) return () => {};
    const listener = () => handler();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
