import { useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { getVoice, resolveParams } from '../model/voices';
import { PARAM_SPECS, formatParamValue } from './soundParams';

// The Sound Editor: pick a sound (by clicking its track), then shape it live
// with friendly sliders. Changes are heard immediately — while the song loops
// you hear them sweep; when stopped, each nudge plays a quick preview. Everyday
// controls show first; "Show more" reveals the deeper ones.

export function SoundEditor() {
  const selection = useStore((s) => s.selection);
  const project = useStore((s) => s.project);
  const previewTrackParam = useStore((s) => s.previewTrackParam);
  const commitTrackParamEdit = useStore((s) => s.commitTrackParamEdit);
  const resetTrackParams = useStore((s) => s.resetTrackParams);
  const auditionTrack = useStore((s) => s.auditionTrack);
  const select = useStore((s) => s.select);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const lastAudition = useRef(0);

  const track = project.tracks.find((t) => t.id === selection.trackId) ?? null;

  const { simpleKeys, advancedKeys, resolved } = useMemo(() => {
    if (!track) return { simpleKeys: [], advancedKeys: [], resolved: {} as Record<string, number> };
    const voice = getVoice(track.instrument.voiceId);
    const keys = Object.keys(voice?.defaults ?? {}).filter((k) => PARAM_SPECS[k]);
    return {
      simpleKeys: keys.filter((k) => PARAM_SPECS[k].simple),
      advancedKeys: keys.filter((k) => !PARAM_SPECS[k].simple),
      resolved: resolveParams(track.instrument.voiceId, track.instrument.params),
    };
  }, [track]);

  if (!track) return null;

  function onSlide(key: string, value: number) {
    if (!track) return;
    previewTrackParam(track.id, key, value);
    const now = performance.now();
    if (now - lastAudition.current > 130) {
      lastAudition.current = now;
      auditionTrack(track.id);
    }
  }

  function onRelease() {
    if (!track) return;
    commitTrackParamEdit();
    auditionTrack(track.id);
  }

  function renderControl(key: string) {
    const spec = PARAM_SPECS[key];
    const value = resolved[key] ?? 0;
    return (
      <div className="ctrl" key={key} title={spec.hint}>
        <label>{spec.label}</label>
        <input
          type="range"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={value}
          onChange={(e) => onSlide(key, Number(e.target.value))}
          onPointerUp={onRelease}
          onKeyUp={onRelease}
          onBlur={onRelease}
        />
        <span className="val">{formatParamValue(key, value)}</span>
      </div>
    );
  }

  return (
    <div className="sound-editor">
      <div className="se-head">
        <span className="swatch" style={{ background: track.color }} />
        <span className="se-title">{track.name}</span>
        <span className="se-sub">sound</span>
        <div className="se-spacer" />
        <button className="se-btn" onClick={() => resetTrackParams(track.id)} title="Undo all tweaks to this sound">
          Reset
        </button>
        <button className="se-btn" onClick={() => select(null)} title="Close">
          ✕
        </button>
      </div>

      <div className="se-controls">
        {simpleKeys.map(renderControl)}
        {showAdvanced && advancedKeys.map(renderControl)}
        {advancedKeys.length > 0 && (
          <button className="se-more" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? '‹ Less' : 'More ›'}
          </button>
        )}
      </div>
    </div>
  );
}
