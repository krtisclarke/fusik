import { useStore } from '../state/store';
import { VOICE_CATALOG, type VoiceCategory, type VoiceDef } from '../model/voices';

const CATEGORY_ORDER: VoiceCategory[] = ['Drums', 'Bass', 'Keys', 'Cymbals', 'Percussion'];

export const VOICE_DRAG_TYPE = 'application/x-beatbox-voice';

function groupByCategory(): Record<VoiceCategory, VoiceDef[]> {
  const groups: Record<VoiceCategory, VoiceDef[]> = {
    Drums: [],
    Bass: [],
    Keys: [],
    Cymbals: [],
    Percussion: [],
  };
  for (const v of VOICE_CATALOG) groups[v.category].push(v);
  return groups;
}

export function Library() {
  const audition = useStore((s) => s.audition);
  const groups = groupByCategory();

  return (
    <div className="library">
      <h2>Sounds</h2>
      <p className="lib-hint">
        Drag a sound onto the timeline, or click it to hear it. Drums drop beats; Piano, Synth and
        Bass play notes you place on their grid. Click a block to select it (then the ✕ removes it);
        click a row's name to shape its sound.
      </p>

      {CATEGORY_ORDER.map((cat) => (
        <div key={cat}>
          <div className="cat">{cat}</div>
          <div className="tiles">
            {groups[cat].map((voice) => (
              <div
                key={voice.id}
                className="tile"
                draggable
                onClick={() => audition(voice.id)}
                onDragStart={(e) => {
                  e.dataTransfer.setData(VOICE_DRAG_TYPE, voice.id);
                  e.dataTransfer.setData('text/plain', voice.id);
                  e.dataTransfer.effectAllowed = 'copy';
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
        </div>
      ))}
    </div>
  );
}
