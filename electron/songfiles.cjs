// Turning a song's name into a file name, kept apart from Electron so it can be
// tested on its own. The rules are boring but every one of them is a way a
// child's song could otherwise fail to save.

const PROJECT_EXTENSION = 'beatbox';

/** A file name that means the song's name, and that a file system will accept. */
function fileNameFor(name) {
  const cleaned = String(name == null ? '' : name)
    .replace(/[\\/:*?"<>|]+/g, ' ') // characters no file system wants
    .replace(/[\x00-\x1f]+/g, ' ') // control characters, from a pasted name
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '') // a leading dot would hide the file
    .trim()
    .slice(0, 60)
    .trim();
  return `${cleaned || 'My Song'}.${PROJECT_EXTENSION}`;
}

/**
 * `fileNameFor`, but never colliding with a song that already exists.
 * `keepId` is the file the song is in now — writing over itself is not a clash.
 */
function uniqueFileName(name, exists, keepId) {
  const wanted = fileNameFor(name);
  if (wanted === keepId || !exists(wanted)) return wanted;
  const stem = wanted.slice(0, -(PROJECT_EXTENSION.length + 1));
  for (let n = 2; n < 500; n++) {
    const candidate = `${stem} ${n}.${PROJECT_EXTENSION}`;
    if (candidate === keepId || !exists(candidate)) return candidate;
  }
  return `${stem} ${Math.round(Math.random() * 1e9)}.${PROJECT_EXTENSION}`;
}

/**
 * The folder holding a song's recordings, next to the song itself.
 *
 * Recordings can't live inside the .beatbox file: a minute of sound is a
 * thousand times the size of the whole song describing it, and undo keeps a
 * hundred copies of the song. Keeping them beside it — rather than in one
 * shared pile — means a song folder is still the whole song, so copying it to
 * another machine takes the voice with it.
 */
function recordingsDirFor(songFileName) {
  const stem = String(songFileName || '').replace(/\.beatbox$/i, '');
  return `${stem || 'My Song'}.recordings`;
}

module.exports = { PROJECT_EXTENSION, fileNameFor, uniqueFileName, recordingsDirFor };
