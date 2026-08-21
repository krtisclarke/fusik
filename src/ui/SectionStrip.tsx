import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { engine } from '../audio/AudioEngine';
import { sectionById } from '../model/arrange';

interface ChipDrag {
  pointerId: number;
  index: number;
  startX: number;
  dx: number;
  /** Where the slot would land: how many other chips the pointer is past. */
  dropIndex: number;
  moved: boolean;
}

/**
 * The song's running order: one chip per slot, in play order. Click a chip to
 * edit that part; drag chips sideways to rearrange the song (pointer-based,
 * like dragging blocks on the timeline, so it works with mouse and touch). The
 * chip being edited gets a bright ring; while the whole song plays, the
 * sounding chip lights up.
 */
export function SectionStrip() {
  const project = useStore((s) => s.project);
  const currentSectionId = useStore((s) => s.currentSectionId);
  const setCurrentSection = useStore((s) => s.setCurrentSection);
  const addPart = useStore((s) => s.addPart);
  const copyPart = useStore((s) => s.copyPart);
  const repeatPart = useStore((s) => s.repeatPart);
  const removeEntry = useStore((s) => s.removeEntry);
  const moveEntry = useStore((s) => s.moveEntry);
  const renamePart = useStore((s) => s.renamePart);

  const chipsRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<ChipDrag | null>(null);
  // Keyed by *slot*, not by part: a part played twice has two chips, and keying
  // by part would open a rename box in both — the second one stealing focus from
  // the first, which closes it on blur before a single letter can be typed.
  const [renamingEntryId, setRenamingEntryId] = useState<string | null>(null);

  // Which slot is sounding right now (song mode only). Polled off the audio
  // clock; state only changes on part boundaries, so re-renders are rare.
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const i = engine.getPlayingEntryIndex();
      setPlayingIndex((prev) => (prev === i ? prev : i));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const canRemove = project.arrangement.length > 1;

  // The chip the dragged slot would land in front of, marked with a bar on its
  // left edge. Nothing is marked when it would land at the very end — by then
  // the chip itself is out past the last one, which shows it plainly enough.
  const dropMarkerIndex =
    drag?.moved && drag.dropIndex !== drag.index
      ? project.arrangement.map((_, i) => i).filter((i) => i !== drag.index)[drag.dropIndex] ?? null
      : null;

  /**
   * Where the dragged slot would land: the number of *other* chips the pointer
   * has passed the middle of. The chip being dragged is skipped because it moves
   * with the pointer — measuring it would just re-measure the pointer. Counting
   * the others gives the index in the reordered song directly, which is what
   * moveEntry (remove, then insert) expects.
   */
  function dropIndexAt(clientX: number, dragIndex: number): number {
    const container = chipsRef.current;
    if (!container) return dragIndex;
    const chips = Array.from(container.children) as HTMLElement[];
    let passed = 0;
    for (let i = 0; i < chips.length; i++) {
      if (i === dragIndex) continue;
      const r = chips[i].getBoundingClientRect();
      if (clientX > r.left + r.width / 2) passed++;
    }
    return passed;
  }

  function onChipPointerDown(e: React.PointerEvent, index: number, sectionId: string) {
    if (renamingEntryId != null) return;
    if (drag) return; // a second finger mid-drag would fight the first
    if ((e.target as HTMLElement).closest('.chip-x')) return; // the ✕ handles itself
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setCurrentSection(sectionId);
    setDrag({
      pointerId: e.pointerId,
      index,
      startX: e.clientX,
      dx: 0,
      dropIndex: index,
      moved: false,
    });
  }

  function onChipPointerMove(e: React.PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    setDrag({
      ...drag,
      dx,
      dropIndex: dropIndexAt(e.clientX, drag.index),
      moved: drag.moved || Math.abs(dx) > 5,
    });
  }

  function onChipPointerUp(e: React.PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.moved && drag.dropIndex !== drag.index) moveEntry(drag.index, drag.dropIndex);
    setDrag(null);
  }

  function commitRename(sectionId: string, value: string) {
    setRenamingEntryId(null);
    renamePart(sectionId, value);
  }

  return (
    <div className="section-strip">
      <span className="strip-label">Song</span>
      <div className="strip-chips" ref={chipsRef}>
        {project.arrangement.map((entry, i) => {
          const section = sectionById(project, entry.sectionId);
          if (!section) return null;
          const isCurrent = section.id === currentSectionId;
          const isPlaying = i === playingIndex;
          const isDragging = drag?.moved && drag.index === i;
          const style: React.CSSProperties = { ['--chip' as string]: section.color };
          if (isDragging) {
            style.transform = `translateX(${drag.dx}px)`;
            style.zIndex = 2;
            style.opacity = 0.85;
          }
          return (
            <div
              key={entry.id}
              className={`chip ${isCurrent ? 'current' : ''} ${isPlaying ? 'playing' : ''} ${
                dropMarkerIndex === i ? 'drop-here' : ''
              }`}
              style={style}
              onPointerDown={(e) => onChipPointerDown(e, i, section.id)}
              onPointerMove={onChipPointerMove}
              onPointerUp={onChipPointerUp}
              onDoubleClick={() => setRenamingEntryId(entry.id)}
              title="Click to edit this part · drag to move it · double-click to rename"
            >
              {renamingEntryId === entry.id ? (
                <input
                  className="chip-rename"
                  autoFocus
                  defaultValue={section.name}
                  onFocus={(e) => e.target.select()}
                  onBlur={(e) => commitRename(section.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(section.id, e.currentTarget.value);
                    if (e.key === 'Escape') setRenamingEntryId(null);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <span className="chip-name">{section.name}</span>
                  <span className="chip-bars">{section.lengthBars} bars</span>
                </>
              )}
              {canRemove && (
                <button
                  className="chip-x"
                  title="Take this part out of the song here"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeEntry(entry.id);
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="strip-actions" data-tour="parts">
        <button className="tbtn" onClick={addPart} title="Add a new empty part to the song">
          ＋ New part
        </button>
        <button
          className="tbtn"
          onClick={() => repeatPart(currentSectionId)}
          title="Play this part again at the end — same part, so edits show up everywhere it plays"
        >
          🔁 Play again
        </button>
        <button
          className="tbtn"
          onClick={() => copyPart(currentSectionId)}
          title="Copy this part into a new separate part you can change on its own"
        >
          ⧉ Copy
        </button>
      </div>
    </div>
  );
}
