import { useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { getVoice, resolveParams } from '../model/voices';
import { PARAM_SPECS, formatParamValue } from './soundParams';

// The Sound Editor shapes the selected block(s). Each block has its own sound;
// select several (Shift-click, or click a row's name for all of them) and edits
// apply to all of them. "Link" chains the selected blocks so they permanently
// keep the same sound and length; "Unlink" breaks the chain.

export function SoundEditor() {
  const selection = useStore((s) => s.selection);
  const project = useStore((s) => s.project);
  const previewParam = useStore((s) => s.previewParam);
  const commitEdit = useStore((s) => s.commitEdit);
  const resetSelected = useStore((s) => s.resetSelected);
  const auditionSelected = useStore((s) => s.auditionSelected);
  const chainSelected = useStore((s) => s.chainSelected);
  const unchainSelected = useStore((s) => s.unchainSelected);
  const select = useStore((s) => s.select);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const lastAudition = useRef(0);

  // The block whose values the sliders show (the first selected).
  const { track, note } = useMemo(() => {
    const id = selection.noteIds[0];
    if (!id) return { track: null, note: null };
    for (const t of project.tracks) {
      const n = t.notes.find((x) => x.id === id);
      if (n) return { track: t, note: n };
    }
    return { track: null, note: null };
  }, [selection, project]);

  const { simpleKeys, advancedKeys, resolved } = useMemo(() => {
    if (!track || !note) return { simpleKeys: [], advancedKeys: [], resolved: {} as Record<string, number> };
    const voice = getVoice(track.instrument.voiceId);
    const keys = Object.keys(voice?.defaults ?? {}).filter((k) => PARAM_SPECS[k]);
    return {
      simpleKeys: keys.filter((k) => PARAM_SPECS[k].simple),
      advancedKeys: keys.filter((k) => !PARAM_SPECS[k].simple),
      resolved: resolveParams(track.instrument.voiceId, note.params),
    };
  }, [track, note]);

  if (!track || !note) return null;

  const count = selection.noteIds.length;
  const selectedNotes = track.notes.filter((n) => selection.noteIds.includes(n.id));
  const anyGrouped = selectedNotes.some((n) => !!n.groupId);
  const groupIds = new Set(selectedNotes.map((n) => n.groupId).filter(Boolean));
  const allOneGroup =
    selectedNotes.length >= 2 && groupIds.size === 1 && selectedNotes.every((n) => n.groupId);
  const canLink = count >= 2 && !allOneGroup;

  function onSlide(key: string, value: number) {
    previewParam(key, value);
    const now = performance.now();
    if (now - lastAudition.current > 130) {
      lastAudition.current = now;
      auditionSelected();
    }
  }

  function onRelease() {
    commitEdit();
    auditionSelected();
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
        <span className="se-sub">
          {count === 1 ? 'block' : `${count} blocks`}
          {anyGrouped ? ' · linked' : ''}
        </span>
        <div className="se-spacer" />
        {canLink && (
          <button className="se-btn link" onClick={chainSelected} title="Link these blocks: same sound & length">
            🔗 Link
          </button>
        )}
        {anyGrouped && (
          <button className="se-btn" onClick={unchainSelected} title="Break the chain">
            Unlink
          </button>
        )}
        <button className="se-btn" onClick={resetSelected} title="Undo all tweaks to the selected block(s)">
          Reset
        </button>
        <button className="se-btn" onClick={() => select(null)} title="Close">
          ✕
        </button>
      </div>

      <div className="se-hint">
        {count === 1 ? (
          <>Shaping <strong>one {track.name} block</strong> — the others stay as they are.</>
        ) : (
          <>Shaping <strong>{count} {track.name} blocks</strong> together.</>
        )}
        {anyGrouped && ' They’re linked, so they keep the same sound and length.'}
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
