// Electron main process — the thin desktop shell around the web app.
//
// Kept deliberately small and in plain CommonJS so it needs no build step.
// Its only jobs are: open a window, load the app (dev server in development,
// bundled files in production), and provide native Save/Open file dialogs to
// the renderer over a locked-down IPC bridge (see preload.cjs).

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const DEV_SERVER_URL = 'http://127.0.0.1:5173';
const PROJECT_EXTENSION = 'beatbox';

// ---- where songs live ----------------------------------------------------
//
// Real files in a real folder, not tucked inside the browser storage the
// renderer happens to have. The desktop app is the actual product: a child's
// songs should be things a grown-up can find, copy to another machine and back
// up, and they should not be capped by a browser's few-megabyte allowance —
// which matters most for the recordings that are coming.
//
// Documents rather than a hidden application-support folder, for exactly that
// findability, and because on a Mac it is already covered by whatever backs the
// machine up.

const fsSync = require('node:fs');
const { uniqueFileName, recordingsDirFor } = require('./songfiles.cjs');
const SONGS_DIR = () => path.join(app.getPath('documents'), 'Beatbox Studio');

function ensureSongsDir() {
  const dir = SONGS_DIR();
  fsSync.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * These are answered synchronously. The renderer needs the song list and the
 * song it was last in *before* it can draw anything, and the alternative — draw
 * an empty song, then swap it out a moment later — is worse than blocking for
 * the millisecond it takes to read a few kilobytes of text. Song files stay
 * small by design: recordings will live beside them as their own files, so this
 * stays cheap even once there is audio in a song.
 */
function handleSongs(channel, handler) {
  ipcMain.on(channel, (event, arg) => {
    try {
      event.returnValue = handler(arg);
    } catch (err) {
      event.returnValue = { ok: false, error: String((err && err.message) || err) };
    }
  });
}

handleSongs('songs:list', () => {
  const dir = ensureSongsDir();
  const songs = [];
  for (const entry of fsSync.readdirSync(dir)) {
    if (!entry.endsWith(`.${PROJECT_EXTENSION}`)) continue;
    const full = path.join(dir, entry);
    let name = entry.slice(0, -(PROJECT_EXTENSION.length + 1));
    try {
      // The name inside the file wins: it is what the app round-trips, and the
      // file may have been renamed from outside.
      const parsed = JSON.parse(fsSync.readFileSync(full, 'utf-8'));
      if (parsed && typeof parsed.name === 'string' && parsed.name.trim()) name = parsed.name;
    } catch {
      // Unreadable or not a song. It still gets listed under its file name
      // rather than vanishing — a child can see it and delete it.
    }
    songs.push({ id: entry, name, savedAt: fsSync.statSync(full).mtimeMs });
  }
  return { ok: true, songs };
});

handleSongs('songs:read', (id) => {
  const full = path.join(ensureSongsDir(), path.basename(String(id || '')));
  if (!fsSync.existsSync(full)) return { ok: false };
  return { ok: true, json: fsSync.readFileSync(full, 'utf-8') };
});

handleSongs('songs:write', ({ id, name, json }) => {
  const dir = ensureSongsDir();
  const current = path.basename(String(id || ''));
  // Renaming the song renames its file, so the folder always reads like the
  // list in the app. The id follows the file.
  const wanted = uniqueFileName(name, (f) => fsSync.existsSync(path.join(dir, f)), current);
  fsSync.writeFileSync(path.join(dir, wanted), json, 'utf-8');
  if (current && current !== wanted && fsSync.existsSync(path.join(dir, current))) {
    fsSync.unlinkSync(path.join(dir, current));
    // The recordings belong to the song, so they move with it. Missing this
    // would leave a renamed song silently unable to find its own voice.
    const from = path.join(dir, recordingsDirFor(current));
    const to = path.join(dir, recordingsDirFor(wanted));
    if (fsSync.existsSync(from) && !fsSync.existsSync(to)) fsSync.renameSync(from, to);
  }
  return { ok: true, id: wanted };
});

handleSongs('songs:delete', (id) => {
  const dir = ensureSongsDir();
  const name = path.basename(String(id || ''));
  const full = path.join(dir, name);
  if (fsSync.existsSync(full)) fsSync.unlinkSync(full);
  // Its recordings go too, or they would sit there for ever with nothing
  // pointing at them and no way for anyone to know what they were.
  const recordings = path.join(dir, recordingsDirFor(name));
  if (name && fsSync.existsSync(recordings)) fsSync.rmSync(recordings, { recursive: true, force: true });
  return { ok: true };
});

handleSongs('songs:folder', () => ({ ok: true, path: ensureSongsDir() }));

// ---- recordings ----------------------------------------------------------
//
// Asynchronous, unlike the song list: a clip can be megabytes, and nothing has
// to wait for one before the app can draw. A block whose recording hasn't
// loaded yet simply doesn't sound until it has.

function clipDir(songId) {
  return path.join(ensureSongsDir(), recordingsDirFor(path.basename(String(songId || ''))));
}

/**
 * The file holding a recording, whatever it was saved as.
 *
 * Found by its id rather than by a fixed extension, because the extension has
 * changed: recordings used to be written as WAV and are now AAC in an `.m4a`.
 * Looking the file up by name means anything already recorded keeps playing
 * with no migration and no lost takes.
 */
async function findClipFile(songId, clipId) {
  const dir = clipDir(songId);
  const id = path.basename(String(clipId || ''));
  if (!id) return null;
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return null;
  }
  const match = entries.find((entry) => entry.slice(0, entry.lastIndexOf('.')) === id);
  return match ? path.join(dir, match) : null;
}

/**
 * The instrument recordings that ship with the app.
 *
 * They live in `public/samples/` in the source tree and are copied to
 * `dist/samples/` by the build, so a packaged app finds them under `dist` and a
 * development one finds them under `public`. Names are checked rather than
 * trusted: the renderer is ordinary web code, and a set or file name with a
 * path in it must not be able to read anything else on the machine.
 */
const SAFE_NAME = /^[A-Za-z0-9_.-]+$/;

function sampleFilePath(setId, file) {
  if (!SAFE_NAME.test(String(setId || '')) || !SAFE_NAME.test(String(file || ''))) return null;
  if (String(file).includes('..') || String(setId).includes('..')) return null;
  const roots = app.isPackaged
    ? [path.join(__dirname, '..', 'dist', 'samples')]
    : [path.join(__dirname, '..', 'public', 'samples'), path.join(__dirname, '..', 'dist', 'samples')];
  for (const root of roots) {
    const full = path.join(root, setId, file);
    if (!full.startsWith(root + path.sep)) continue;
    if (fsSync.existsSync(full)) return full;
  }
  return null;
}

ipcMain.handle('samples:read', async (_event, { setId, file }) => {
  const full = sampleFilePath(setId, file);
  if (!full) return { ok: false };
  try {
    const data = await fs.readFile(full);
    return { ok: true, bytes: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle('clips:write', async (_event, { songId, clipId, bytes, extension }) => {
  const dir = clipDir(songId);
  await fs.mkdir(dir, { recursive: true });
  const safe = /^\.[a-z0-9]{1,5}$/i.test(String(extension || '')) ? String(extension) : '.webm';
  const file = path.join(dir, `${path.basename(String(clipId || ''))}${safe}`);
  await fs.writeFile(file, Buffer.from(bytes));
  return { ok: true, path: file };
});

ipcMain.handle('clips:read', async (_event, { songId, clipId }) => {
  const file = await findClipFile(songId, clipId);
  if (!file) return { ok: false };
  try {
    const data = await fs.readFile(file);
    // A plain ArrayBuffer crosses the bridge; the renderer decodes it.
    return { ok: true, bytes: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
  } catch {
    return { ok: false };
  }
});

/**
 * Delete recordings this song no longer refers to.
 *
 * Only ever called just after a song is opened, and that timing is the whole
 * safety argument: opening a song starts a fresh undo history, so a recording
 * the song doesn't mention can no longer be reached by any amount of undoing.
 * Deleting a clip the moment its block is removed would look tidier and be
 * wrong — one press of undo would bring the block back to a file that had gone.
 */
ipcMain.handle('clips:sweep', async (_event, { songId, keep }) => {
  const dir = path.join(ensureSongsDir(), recordingsDirFor(path.basename(String(songId || ''))));
  const kept = new Set(Array.isArray(keep) ? keep : []);
  let removed = 0;
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return { ok: true, removed: 0 }; // no recordings folder: nothing to tidy
  }
  for (const entry of entries) {
    const dot = entry.lastIndexOf('.');
    if (dot <= 0) continue; // not a recording we wrote
    if (kept.has(entry.slice(0, dot))) continue;
    try {
      await fs.unlink(path.join(dir, entry));
      removed++;
    } catch {
      // Someone else has it open, or it is already gone. Leave it.
    }
  }
  return { ok: true, removed };
});

ipcMain.handle('clips:delete', async (_event, { songId, clipId }) => {
  const file = await findClipFile(songId, clipId);
  if (!file) return { ok: true };
  try {
    await fs.unlink(file);
  } catch {
    // Already gone. Nothing to put right.
  }
  return { ok: true };
});

/** @type {BrowserWindow | null} */
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#12131a',
    show: false,
    title: 'Beatbox Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Open external links in the user's real browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (!app.isPackaged) {
    mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---- Native file dialogs, exposed to the renderer via IPC ----------------

ipcMain.handle('project:save', async (_event, { suggestedName, json }) => {
  const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
    title: 'Save Project',
    defaultPath: `${suggestedName || 'My Song'}.${PROJECT_EXTENSION}`,
    filters: [{ name: 'Beatbox Project', extensions: [PROJECT_EXTENSION] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  await fs.writeFile(result.filePath, json, 'utf-8');
  return { ok: true, path: result.filePath };
});

ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: 'Open Project',
    properties: ['openFile'],
    filters: [{ name: 'Beatbox Project', extensions: [PROJECT_EXTENSION] }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, canceled: true };
  }
  const filePath = result.filePaths[0];
  const json = await fs.readFile(filePath, 'utf-8');
  return { ok: true, path: filePath, json };
});

ipcMain.handle('audio:save', async (_event, { suggestedName, bytes, extension }) => {
  // Older renderers sent no extension and always meant WAV.
  const ext = extension === 'mp3' ? 'mp3' : 'wav';
  const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
    title: `Export ${ext.toUpperCase()}`,
    defaultPath: `${suggestedName || 'My Song'}.${ext}`,
    filters: [{ name: `${ext.toUpperCase()} Audio`, extensions: [ext] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  await fs.writeFile(result.filePath, Buffer.from(bytes));
  return { ok: true, path: result.filePath };
});

// -------------------------------------------------------------------------

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Song',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu:new'),
        },
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:open'),
        },
        {
          label: 'Save…',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu:save'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => mainWindow?.webContents.send('menu:undo'),
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: () => mainWindow?.webContents.send('menu:redo'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
