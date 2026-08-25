// The songs a child has made, and the name of the one they're in.
//
// Two small controls that only make sense together: a title you can type over,
// and a list to get back to everything else. Before this the song had no name
// anywhere in the app — every file saved was "My Song.beatbox" — and starting a
// new one left the last with nowhere to go.

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';

/** "just now", "12 minutes ago", "yesterday" — no clocks, no dates to parse. */
function whenText(savedAt: number, now: number): string {
  const minutes = Math.floor((now - savedAt) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/** The song's name, typed over in place. */
export function SongName() {
  const name = useStore((s) => s.project.name);
  const renameSong = useStore((s) => s.renameSong);
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    const text = draft;
    setDraft(null);
    if (text != null) renameSong(text); // a blank name is refused by the model
  }

  return (
    <input
      className="song-name"
      value={draft ?? name}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
      title="The name of this song — click to change it"
      aria-label="Song name"
    />
  );
}

export function SongsPanel() {
  const showSongs = useStore((s) => s.showSongs);
  const songs = useStore((s) => s.songs);
  const currentSongId = useStore((s) => s.currentSongId);
  const openSong = useStore((s) => s.openSong);
  const deleteSong = useStore((s) => s.deleteSong);
  const toggleSongs = useStore((s) => s.toggleSongs);
  // Everything you can do to a song as a whole lives here, rather than as four
  // more buttons in a toolbar that had already outgrown a laptop screen.
  const newProject = useStore((s) => s.newProject);
  const openFromFile = useStore((s) => s.openFromFile);
  const importMidi = useStore((s) => s.importMidi);
  const saveCurrent = useStore((s) => s.saveCurrent);
  const exportSong = useStore((s) => s.exportSong);
  const panelRef = useRef<HTMLDivElement>(null);
  // Fixed at open time: a list that silently rewrote "just now" every render
  // would be the only moving thing on a still screen.
  const [openedAt] = useState(() => Date.now());

  useEffect(() => {
    if (!showSongs) return;
    function onDown(e: PointerEvent) {
      if (!panelRef.current?.contains(e.target as Node)) toggleSongs();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') toggleSongs();
    }
    // Listen on the way down so a click that dismisses the list doesn't also
    // land on whatever was underneath it.
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [showSongs, toggleSongs]);

  if (!showSongs) return null;

  return (
    <div className="songs-panel" ref={panelRef} role="dialog" aria-label="My songs">
      <div className="songs-actions">
        <button onClick={newProject}>✚ New song</button>
        <button onClick={() => void openFromFile()}>📂 Open a file…</button>
        <button
          onClick={() => void importMidi()}
          title="Turn a .mid music file into a Beatbox song you can edit"
        >
          🎼 Import a song…
        </button>
        <button onClick={() => void saveCurrent()}>💾 Save to a file</button>
        <button onClick={() => void exportSong()} title="A small MP3 that plays and sends anywhere">
          ⬇ Export as audio
        </button>
        <button
          className="songs-wav"
          onClick={() => void exportSong('wav')}
          title="The full uncompressed audio — big, for grown-up audio tools"
        >
          as WAV
        </button>
      </div>
      <div className="songs-head">Kept on this computer</div>
      {songs.length === 0 && <div className="songs-empty">Nothing kept yet.</div>}
      <ul className="songs-list">
        {songs.map((song) => (
          <li key={song.id} className={song.id === currentSongId ? 'on' : ''}>
            <button className="songs-open" onClick={() => openSong(song.id)}>
              <span className="songs-name">{song.name}</span>
              <span className="songs-when">{whenText(song.savedAt, openedAt)}</span>
            </button>
            <button
              className="songs-del"
              title={`Delete "${song.name}" for good`}
              aria-label={`Delete ${song.name}`}
              onClick={() => {
                // The one place in the app that destroys work with no undo, so
                // it is the one place that asks.
                if (
                  typeof window === 'undefined' ||
                  typeof window.confirm !== 'function' ||
                  window.confirm(`Delete "${song.name}"? This can't be undone.`)
                ) {
                  deleteSong(song.id);
                }
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
