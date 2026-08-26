import { useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { getVoice, resolveParams } from '../model/voices';
import { beatsPerBar } from '../model/time';
import { PARAM_SPECS, formatParamValue } from './soundParams';

// The Sound Editor shapes the selected block(s). Each block has its own sound;
// select several (drag a box over them, Shift-click, or click a row's name for
// all of them) and edits apply to all of them. "Link" chains the selected
// blocks so they permanently keep the same sound and length; "Unlink" breaks
// the chain.

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
  const repeatSelectedEvery = useStore((s) => s.repeatSelectedEvery);
  const alignSelected = useStore((s) => s.alignSelected);
  const spreadSelected = useStore((s) => s.spreadSelected);
  const splitSelectedAtPlayhead = useStore((s) => s.splitSelectedAtPlayhead);
  const duplicateSelected = useStore((s) => s.duplicateSelected);

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
  const perBar = beatsPerBar(project.timeSignature);
  const isClip = !!note.clipId;
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
    // The numbers under the sliders are engineer units — "12000", "1.05" —
    // and the ear is the real readout: drag it and hear it. So the everyday
    // view hides them, and "More" shows them along with the advanced sliders.
    // Wave is the exception because its value is a word ("Saw"), and the word
    // is the information.
    const showValue = showAdvanced || key === 'wave';
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
        {showValue && <span className="val">{formatParamValue(key, value)}</span>}
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

      {/* Timing, before sound — because "why does it sound off?" is nearly
          always spacing, and spacing is arithmetic rather than a steady hand.
          One press turns a single block into a whole part's worth of them,
          exactly a beat (or a bar) apart. */}
      {/* A recording is the one block whose insides matter: it is a thing that
          was sung, with a beginning and an end you may have got wrong. Cutting
          it copies no audio — the second half just points further into the
          same take — so cut, copy and drag are enough to move a line, repeat
          it, or throw away the bit before the singing started. */}
      {isClip && (
        <div className="se-timing">
          <span className="se-timing-label">Recording</span>
          <span className="se-timing-lead">Put the line where you want to cut, then:</span>
          <button
            className="se-btn"
            onClick={splitSelectedAtPlayhead}
            disabled={count !== 1}
            title="Cut this recording in two where the playing line is"
          >
            ✂ Cut here
          </button>
          <button
            className="se-btn"
            onClick={duplicateSelected}
            title="Another copy, straight after this one — drag it wherever you want it"
          >
            ⧉ Copy
          </button>
        </div>
      )}

      <div className="se-timing">
        <span className="se-timing-label">Timing</span>
        {count === 1 ? (
          <>
            <span className="se-timing-lead">Repeat it right across this part:</span>
            <button className="se-btn" onClick={() => repeatSelectedEvery(0.5)} title="A copy every half beat, all the way across this part">
              every ½ beat
            </button>
            <button className="se-btn" onClick={() => repeatSelectedEvery(1)} title="A copy on every beat, all the way across this part">
              every beat
            </button>
            <button className="se-btn" onClick={() => repeatSelectedEvery(2)} title="A copy every two beats, all the way across this part">
              every 2 beats
            </button>
            <button className="se-btn" onClick={() => repeatSelectedEvery(perBar)} title="A copy at the start of every bar of this part">
              every bar
            </button>
          </>
        ) : (
          <>
            <button className="se-btn" onClick={() => alignSelected(1)} title="Pull each of these onto the nearest beat">
              ⇥ On the beat
            </button>
            <button className="se-btn" onClick={() => alignSelected(0.5)} title="Pull each of these onto the nearest half beat">
              ⇥ On the half beat
            </button>
            {count >= 3 && (
              <button className="se-btn" onClick={spreadSelected} title="Same gap between every one of them — the first and last stay put">
                ⇹ Same gaps
              </button>
            )}
          </>
        )}
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
