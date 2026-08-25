import { useStore } from '../state/store';
import { sectionById } from '../model/arrange';

/**
 * The bar of things you can do to the song's parts.
 *
 * It used to *be* the running order — a row of chips, A A B A, floating above
 * a timeline that showed only one of them. Two pictures of the same song, side
 * by side, agreeing about nothing: the chips didn't line up with anything and
 * the grid didn't say where in the song it was. The running order now lives on
 * the timeline itself, drawn over the music it describes (see PartBands), so
 * all that's left here is the handful of actions — and a plain sentence naming
 * the part being worked on, because "New part" and "Play again" have to say
 * which part they mean.
 */
export function SectionStrip() {
  const project = useStore((s) => s.project);
  const currentSectionId = useStore((s) => s.currentSectionId);
  const playMode = useStore((s) => s.playMode);
  const addPart = useStore((s) => s.addPart);
  const copyPart = useStore((s) => s.copyPart);
  const repeatPart = useStore((s) => s.repeatPart);

  const section = sectionById(project, currentSectionId) ?? project.sections[0];
  const plays = project.arrangement.filter((e) => e.sectionId === section?.id).length;

  return (
    <div className="section-strip">
      <span className="strip-label">Working on</span>
      <span className="strip-current" style={{ ['--chip' as string]: section?.color }}>
        Part {section?.name}
      </span>
      <span className="strip-note">
        {plays > 1
          ? `plays ${plays} times — a change here changes all of them`
          : `${section?.lengthBars} bars`}
        {playMode === 'section' && ' · only this part is playing'}
      </span>

      <div className="strip-actions" data-tour="parts">
        <button className="tbtn" onClick={addPart} title="Add a new empty part to the end of the song">
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
