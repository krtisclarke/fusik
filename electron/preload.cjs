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
  saveAudio: (suggestedName, bytes, extension) =>
    ipcRenderer.invoke('audio:save', { suggestedName, bytes, extension }),

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
    write: (songId, clipId, bytes, extension) =>
      ipcRenderer.invoke('clips:write', { songId, clipId, bytes, extension }),
    read: (songId, clipId) => ipcRenderer.invoke('clips:read', { songId, clipId }),
    remove: (songId, clipId) => ipcRenderer.invoke('clips:delete', { songId, clipId }),
    sweep: (songId, keep) => ipcRenderer.invoke('clips:sweep', { songId, keep }),
  },

  /**
   * The instrument recordings that ship with the app. Read here rather than
   * fetched by the renderer because the packaged app runs on a `file://` page,
   * where Chromium will not fetch anything at all.
   */
  samples: {
    read: (setId, file) => ipcRenderer.invoke('samples:read', { setId, file }),
  },

  /**
   * Fetching from the internet on the page's behalf — searching the MIDI
   * archive, and downloading the file a child picked. The main process only
   * allows the one host; see main.cjs.
   */
  web: {
    get: (url) => ipcRenderer.invoke('web:get', url),
  },

  /**
   * Keeping the app current. The app used to do this with no outward sign at
   * all, which made "it didn't update" impossible to look into; these let the
   * toolbar say where it has got to, and hand over the log when it went wrong.
   */
  updates: {
    state: () => ipcRenderer.invoke('update:state'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    log: () => ipcRenderer.invoke('update:log'),
    onStatus: (handler) => {
      const listener = (_event, state) => handler(state);
      ipcRenderer.on('update:status', listener);
      return () => ipcRenderer.removeListener('update:status', listener);
    },
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
