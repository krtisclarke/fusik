import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';

/**
 * Look up a song by name and open it, without ever meeting a file.
 *
 * The app could already turn a `.mid` — the note-instructions format keyboards
 * and notation apps write — into a Beatbox song. What it couldn't do was get
 * hold of one, and a `.mid` is not a thing a child has lying around. This
 * searches a public MIDI archive: type "twinkle", press Find, pick one, and it
 * arrives as an ordinary song with the drums on drum rows, ready to be pulled
 * about like anything they built themselves.
 *
 * What comes back is a fan-made transcription, not a recording — nothing of
 * the original record is in it, and what arrives is a starting point to change
 * rather than a finished thing to keep.
 */
export function FindOnline() {
  const showFindOnline = useStore((s) => s.showFindOnline);
  const toggleFindOnline = useStore((s) => s.toggleFindOnline);
  const results = useStore((s) => s.onlineResults);
  const busy = useStore((s) => s.onlineBusy);
  const error = useStore((s) => s.onlineError);
  const searched = useStore((s) => s.onlineSearched);
  const searchOnline = useStore((s) => s.searchOnline);
  const openOnline = useStore((s) => s.openOnline);

  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showFindOnline) inputRef.current?.focus();
  }, [showFindOnline]);

  useEffect(() => {
    if (!showFindOnline) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') toggleFindOnline();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showFindOnline, toggleFindOnline]);

  if (!showFindOnline) return null;

  return (
    <div className="find-backdrop" onPointerDown={toggleFindOnline}>
      <div
        className="find-panel"
        role="dialog"
        aria-label="Find a song"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="find-head">
          <span className="find-title">🌐 Find a song</span>
          <button className="find-close" onClick={toggleFindOnline} aria-label="Close">
            ✕
          </button>
        </div>

        <form
          className="find-form"
          onSubmit={(e) => {
            e.preventDefault();
            void searchOnline(query);
          }}
        >
          <input
            ref={inputRef}
            className="find-input"
            value={query}
            placeholder="Type a song name…"
            onChange={(e) => setQuery(e.target.value)}
            // Enter submits the form on its own in a browser, but only when
            // the form's implicit submission rules line up. Saying it outright
            // costs two lines and means the most obvious key on the keyboard
            // can never quietly do nothing.
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              void searchOnline(query);
            }}
            aria-label="Song name"
          />
          <button className="find-go" type="submit" disabled={busy || !query.trim()}>
            {busy ? 'Looking…' : 'Find'}
          </button>
        </form>

        <p className="find-note">
          These are people's own versions of songs, written out as notes — not the
          real recording. Anything you open here is yours to change.
        </p>

        {error && <div className="find-error">{error}</div>}

        {!error && searched && !busy && results.length === 0 && (
          <div className="find-empty">Nothing came back for that. Try fewer words.</div>
        )}

        <ul className="find-list">
          {results.map((item) => (
            <li key={item.id}>
              <button
                className="find-item"
                disabled={busy}
                onClick={() => void openOnline(item)}
                title={`Open "${item.name}" as a song you can edit`}
              >
                <span className="find-name">{item.name}</span>
                <span className="find-open">Open ›</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
