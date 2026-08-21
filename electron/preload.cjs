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

  /**
   * The songs folder on this machine. Answered synchronously because the app
   * needs the list and the last song open before it draws anything; see the
   * handlers in main.cjs.
   */
  songs: {
    list: () => ipcRenderer.sendSync('songs:list'),
    read: (id) => ipcRenderer.sendSync('songs:read', id),
    write: (id, name, json) => ipcRenderer.sendSync('songs:write', { id, name, json }),
    remove: (id) => ipcRenderer.sendSync('songs:delete', id),
    folder: () => ipcRenderer.sendSync('songs:folder'),
  },

  /** A song's recordings. Asynchronous — a clip can be megabytes. */
  clips: {
    write: (songId, clipId, bytes) => ipcRenderer.invoke('clips:write', { songId, clipId, bytes }),
    read: (songId, clipId) => ipcRenderer.invoke('clips:read', { songId, clipId }),
    remove: (songId, clipId) => ipcRenderer.invoke('clips:delete', { songId, clipId }),
  },

  /** Subscribe to native menu commands. Returns an unsubscribe function. */
  onMenu: (channel, handler) => {
    const allowed = ['menu:new', 'menu:open', 'menu:save', 'menu:undo', 'menu:redo'];
    if (!allowed.includes(channel)) return () => {};
    const listener = () => handler();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
