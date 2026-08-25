import { useState } from 'react';
import { useStore } from '../state/store';
import { VOICE_CATALOG, type VoiceCategory, type VoiceDef } from '../model/voices';

// One family open at a time, every family's name always on screen. The panel
// used to be one long list, and at an ordinary window height more than half the
// sounds sat below the fold with no scrollbar to say so — a sound a child can't
// see is a sound the app doesn't have. Headers stay put; only the open family
// spends any height, so the panel never scrolls and never hides a family.
// Beat-makers first, tune-makers after — the order a song tends to get built.
const CATEGORY_ORDER: VoiceCategory[] = ['Drums', 'Cymbals', 'Percussion', 'Mallets', 'Keys', 'Strings', 'Bass'];

const CATEGORY_EMOJI: Record<VoiceCategory, string> = {
  Drums: '🥁',
  Cymbals: '💥',
  Percussion: '👏',
  Mallets: '🎐',
  Keys: '🎹',
  Strings: '🎻',
  Bass: '🎸',
};

function groupByCategory(): Record<VoiceCategory, VoiceDef[]> {
  const groups = {} as Record<VoiceCategory, VoiceDef[]>;
  for (const c of CATEGORY_ORDER) groups[c] = [];
  for (const v of VOICE_CATALOG) groups[v.category].push(v);
  return groups;
}

export function Library() {
  const audition = useStore((s) => s.audition);
  const startVoiceDrag = useStore((s) => s.startVoiceDrag);
  const voiceDrag = useStore((s) => s.voiceDrag);
  const [open, setOpen] = useState<VoiceCategory>('Drums');
  const groups = groupByCategory();

  return (
    <div className="library" data-tour="library">
      <h2>Sounds</h2>
      <p className="lib-hint">
        Drag a sound onto a row, or under the last row to give it a row of its own.
        Click one to hear it.
      </p>

      {CATEGORY_ORDER.map((cat) => {
        const isOpen = cat === open;
        return (
          <div key={cat} className={`cat-group ${isOpen ? 'open' : ''}`}>
            <button
              type="button"
              className={`cat ${isOpen ? 'open' : ''}`}
              aria-expanded={isOpen}
              onClick={() => setOpen(cat)}
            >
              <span className="cat-emoji">{CATEGORY_EMOJI[cat]}</span>
              <span className="cat-name">{cat}</span>
              <span className="cat-chevron">{isOpen ? '▾' : '▸'}</span>
            </button>
            {isOpen && (
              <div className="tiles">
                {groups[cat].map((voice) => (
                  <div
                    key={voice.id}
                    className={`tile ${
                      voiceDrag?.voiceId === voice.id && voiceDrag.moved ? 'lifted' : ''
                    }`}
                    // Plain pointer events rather than the browser's own
                    // drag-and-drop. Its ghost is a photograph of whatever was
                    // pressed — this whole row — so a sound used to trail a
                    // long grey rectangle behind it, nothing like the small
                    // block it was about to become. The timeline owns the rest
                    // of the gesture and draws the block where it will land;
                    // see the drag section of ui/Timeline.tsx.
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      startVoiceDrag(voice.id, e.pointerId, e.clientX, e.clientY);
                    }}
                    onPointerUp={() => {
                      // A press that never went anywhere is a click: hear it.
                      if (!useStore.getState().voiceDrag?.moved) audition(voice.id);
                    }}
                    title={`${voice.label} — drag onto the timeline, or click to hear it`}
                  >
                    <span className="dot" style={{ background: voice.color }}>
                      {voice.emoji}
                    </span>
                    <span className="name">{voice.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
