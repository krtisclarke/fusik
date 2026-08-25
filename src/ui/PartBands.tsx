import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { engine } from '../audio/AudioEngine';
import { sectionById, type ResolvedEntry } from '../model/arrange';
import { beatToX } from './layout';

/**
 * The song's running order, drawn *over the music it describes*.
 *
 * It used to be a row of chips floating above the timeline, in no particular
 * relation to anything below them: the chips said A A B A, the grid showed one
 * part, and nothing joined the two. You could see the parts were clickable
 * without ever working out what clicking one did. Sitting them on the ruler,
 * each band exactly as wide as the music it covers, answers the question by
 * being the answer — this stretch of song is called B, and it runs from here
 * to here.
 *
 * Click a band to work on that part. Drag one sideways to change the running
 * order. Double-click to rename. The band that is sounding lights up, so the
 * question "which bit am I listening to?" is answered without being asked.
 */
export function PartBands({
  entries,
  gridWidth,
}: {
  entries: ResolvedEntry[];
  gridWidth: number;
}) {
  const project = useStore((s) => s.project);
  const currentSectionId = useStore((s) => s.currentSectionId);
  const playMode = useStore((s) => s.playMode);
  const setCurrentSection = useStore((s) => s.setCurrentSection);
  const removeEntry = useStore((s) => s.removeEntry);
  const moveEntry = useStore((s) => s.moveEntry);
  const renamePart = useStore((s) => s.renamePart);

  const [drag, setDrag] = useState<{
    pointerId: number;
    index: number;
    startX: number;
    dx: number;
    dropIndex: number;
    moved: boolean;
  } | null>(null);
  // Keyed by *slot*, not by part: a part played twice has two bands, and keying
  // by part would open a rename box in both — the second stealing focus from
  // the first, which closes it on blur before a letter can be typed.
  const [renamingEntryId, setRenamingEntryId] = useState<string | null>(null);

  // Which slot is sounding. Polled off the audio clock; the value only changes
  // on part boundaries, so re-renders are rare.
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

  const canRemove = entries.length > 1;

  /** How many bands a part occupies — a repeat says so on its face. */
  const timesPlayed = new Map<string, number>();
  for (const e of entries) timesPlayed.set(e.sectionId, (timesPlayed.get(e.sectionId) ?? 0) + 1);

  /**
   * Where the dragged slot would land: the number of *other* bands whose middle
   * the pointer has passed. The dragged band is skipped because it moves with
   * the pointer — measuring it would just re-measure the pointer.
   */
  function dropIndexAt(clientX: number, dragIndex: number, container: HTMLElement): number {
    const bands = Array.from(container.querySelectorAll('.part-band')) as HTMLElement[];
    let passed = 0;
    for (let i = 0; i < bands.length; i++) {
      if (i === dragIndex) continue;
      const r = bands[i].getBoundingClientRect();
      if (clientX > r.left + r.width / 2) passed++;
    }
    return passed;
  }

  const wrapRef = useRef<HTMLDivElement>(null);

  function onPointerDown(e: React.PointerEvent, index: number, sectionId: string) {
    if (renamingEntryId != null) return;
    if (drag) return; // a second finger mid-drag would fight the first
    if ((e.target as HTMLElement).closest('.band-x')) return; // the ✕ handles itself
    e.stopPropagation(); // never let a band press scrub the ruler underneath
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setCurrentSection(sectionId);
    setDrag({ pointerId: e.pointerId, index, startX: e.clientX, dx: 0, dropIndex: index, moved: false });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId || !wrapRef.current) return;
    const dx = e.clientX - drag.startX;
    setDrag({
      ...drag,
      dx,
      dropIndex: dropIndexAt(e.clientX, drag.index, wrapRef.current),
      moved: drag.moved || Math.abs(dx) > 5,
    });
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.moved && drag.dropIndex !== drag.index) moveEntry(drag.index, drag.dropIndex);
    setDrag(null);
  }

  function commitRename(sectionId: string, value: string) {
    setRenamingEntryId(null);
    renamePart(sectionId, value);
  }

  return (
    <div className="part-bands" ref={wrapRef} style={{ width: gridWidth }}>
      {entries.map((entry, i) => {
        const section = sectionById(project, entry.sectionId);
        if (!section) return null;
        const isCurrent = section.id === currentSectionId;
        const isPlaying = i === playingIndex;
        const isDragging = drag?.moved && drag.index === i;
        const repeats = timesPlayed.get(section.id) ?? 1;
        // In Part mode only the part being worked on is looping. Saying so here
        // is what stops "why can't I hear the rest of my song?" from ever
        // needing to be asked.
        const dimmed = playMode === 'section' && !isCurrent;
        const style: React.CSSProperties = {
          left: beatToX(entry.startBeat),
          width: Math.max(2, beatToX(entry.lengthBeats) - 2),
          ['--band' as string]: section.color,
        };
        if (isDragging) {
          style.transform = `translateX(${drag.dx}px)`;
          style.zIndex = 6;
          style.opacity = 0.85;
        }
        return (
          <div
            key={entry.entryId}
            className={`part-band ${isCurrent ? 'current' : ''} ${isPlaying ? 'playing' : ''} ${
              dimmed ? 'dimmed' : ''
            }`}
            style={style}
            onPointerDown={(e) => onPointerDown(e, i, section.id)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDrag(null)}
            onDoubleClick={() => setRenamingEntryId(entry.entryId)}
            title={`Part ${section.name}, ${section.lengthBars} bars${
              repeats > 1 ? ` — played ${repeats} times in this song` : ''
            } · click to work on it · drag to move it · double-click to rename`}
          >
            {renamingEntryId === entry.entryId ? (
              <input
                className="band-rename"
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
                <span className="band-name">{section.name}</span>
                {repeats > 1 && (
                  <span className="band-repeat" title={`This part plays ${repeats} times`}>
                    🔁
                  </span>
                )}
              </>
            )}
            {canRemove && (
              <button
                className="band-x"
                title="Take this part out of the song here"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  removeEntry(entry.entryId);
                }}
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
