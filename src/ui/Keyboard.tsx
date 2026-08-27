import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { strikeVelocity, TYPED_VELOCITY } from './velocity';
import { engine } from '../audio/AudioEngine';
import { pitchLadder, midiToName } from '../model/scales';
import { VOICE_CATALOG, isPitched } from '../model/voices';

// A keyboard you can actually play, rather than a grid you fill in.
//
// The keys are the notes of the song's scale, in order — the same ladder the
// note-grid rows use. That's the whole trick: there are no wrong notes to hit,
// so a child can bash at it and it sounds like music. No sharps and flats to
// understand, no black keys to avoid.

/** Computer keys mapped to the ladder, low to high — two rows, an octave apart. */
const LOWER_ROW = ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/'];
const UPPER_ROW = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';'];

const MELODIC_VOICES = VOICE_CATALOG.filter(isPitched);
const DEFAULT_VOICE_ID = MELODIC_VOICES[0]?.id ?? 'piano';

/**
 * A note being held, and what is holding it. `pressId` is unique per press:
 * starting a note needs a live audio context, which is a promise, so a press
 * that has already been let go of — or been replaced by a *later* press of the
 * same key — must be recognised when that promise finally lands, or its note is
 * left sounding with nothing to stop it.
 */
interface Sounding {
  midi: number;
  pressId: number;
  handle: number;
  /** Where the transport was when the key went down, for recording. */
  startBeats: number;
  /** How hard it was hit — heard live, and kept if it's being recorded. */
  velocity: number;
  /** The instrument as it was at press time — switching voice mid-hold must
   *  not file the note under the instrument it wasn't played on. */
  voiceId: string;
}

/** Notes are held per source: one per finger, one per computer key. */
const pointerSource = (pointerId: number) => `pointer:${pointerId}`;

export function Keyboard() {
  const project = useStore((s) => s.project);
  const selectedTrackId = useStore((s) => s.selection.trackId);
  const recordPlayedNote = useStore((s) => s.recordPlayedNote);
  const isRecording = useStore((s) => s.isRecording);
  const notePlayed = useStore((s) => s.notePlayed);
  const isPlaying = useStore((s) => s.isPlaying);
  const toggleRecording = useStore((s) => s.toggleRecording);
  const isMicRecording = useStore((s) => s.isMicRecording);
  const canRecordMic = useStore((s) => s.canRecordMic);
  const toggleMicRecording = useStore((s) => s.toggleMicRecording);
  const addVoiceBlockAtPlayhead = useStore((s) => s.addVoiceBlockAtPlayhead);

  // The picker is the single source of truth for which instrument the keys
  // play. Selecting a melodic track on the timeline *moves* the picker, rather
  // than overriding it invisibly — so every button always does what it looks
  // like it does, and picking a voice takes effect immediately.
  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE_ID);

  // Read through a ref so this only fires when the *selection* changes. Reading
  // project.tracks directly would re-run it on every edit to the song and snap
  // the keyboard back to the selected track's voice mid-play.
  const tracksRef = useRef(project.tracks);
  tracksRef.current = project.tracks;
  useEffect(() => {
    const track = tracksRef.current.find((t) => t.id === selectedTrackId);
    const trackVoice = track && VOICE_CATALOG.find((v) => v.id === track.instrument.voiceId);
    if (trackVoice && isPitched(trackVoice)) setVoiceId(trackVoice.id);
  }, [selectedTrackId]);

  const voice = VOICE_CATALOG.find((v) => v.id === voiceId) ?? MELODIC_VOICES[0];
  const [octaveShift, setOctaveShift] = useState(0);

  const pitches = useMemo(() => {
    const ladder = pitchLadder(
      voice?.baseMidi ?? 60,
      voice?.octaves ?? 2,
      project.scaleRoot,
      project.scaleId,
    );
    return ladder.map((p) => p + octaveShift * 12);
  }, [voice, project.scaleRoot, project.scaleId, octaveShift]);

  // How many keys make up one octave of this scale. The ladder is N octaves of
  // the scale plus a closing root on top, so the octave is what's left once that
  // extra note is taken off. The two computer-key rows are an octave apart.
  const stepsPerOctave = Math.max(1, Math.round((pitches.length - 1) / (voice?.octaves ?? 2)));

  // What's sounding right now, keyed by what's holding it. Held in a ref because
  // these change on every keypress and the audio must not wait for a re-render.
  const sounding = useRef(new Map<string, Sounding>());
  const nextPressId = useRef(1);
  const [litPitches, setLitPitches] = useState<number[]>([]);

  const refreshLit = useCallback(() => {
    setLitPitches([...sounding.current.values()].map((s) => s.midi));
  }, []);

  const pressNote = useCallback(
    (source: string, midi: number, velocity: number = TYPED_VELOCITY) => {
      if (sounding.current.has(source)) return; // already down (key auto-repeat)
      const pressId = nextPressId.current++;
      // Claim the slot before the engine answers, so the key lights up at once
      // and a repeat can't start the same note twice while audio wakes up.
      // Take the transport's position now, not when the note finally starts.
      sounding.current.set(source, {
        midi,
        pressId,
        handle: 0,
        startBeats: engine.getPositionBeats(),
        velocity,
        voiceId,
      });
      refreshLit();
      notePlayed(); // the walkthrough watches this; nothing else does
      void engine.noteOn(voiceId, midi, {}, velocity).then((handle) => {
        const live = sounding.current.get(source);
        // Still the same press? Keep the handle so releasing can stop it.
        // Otherwise this note belongs to a press that is already over.
        if (live?.pressId === pressId) live.handle = handle;
        else engine.noteOff(handle);
      });
    },
    [voiceId, refreshLit, notePlayed],
  );

  const releaseNote = useCallback(
    (source: string) => {
      const live = sounding.current.get(source);
      if (!live) return;
      sounding.current.delete(source);
      refreshLit();
      // A handle of 0 means the note is still starting; the promise above sees
      // the press has gone and stops it as soon as it exists.
      if (live.handle) engine.noteOff(live.handle);
      // The store ignores this unless recording is armed and the song is running.
      recordPlayedNote({
        voiceId: live.voiceId,
        midi: live.midi,
        startBeats: live.startBeats,
        endBeats: engine.getPositionBeats(),
        velocity: live.velocity,
      });
    },
    [refreshLit, recordPlayedNote],
  );

  const activePointers = useRef(new Set<number>());

  const releaseEverything = useCallback(() => {
    // Go through releaseNote so anything played is still kept if a take is
    // running — losing focus shouldn't cost the child the note they just played.
    for (const source of [...sounding.current.keys()]) releaseNote(source);
    sounding.current.clear();
    activePointers.current.clear();
    refreshLit();
    engine.releaseAllHeld();
  }, [refreshLit, releaseNote]);

  // ---- computer keys ------------------------------------------------------

  useEffect(() => {
    function keyIndex(key: string): number | null {
      const lower = LOWER_ROW.indexOf(key);
      if (lower >= 0 && lower < stepsPerOctave) return lower;
      const upper = UPPER_ROW.indexOf(key);
      // The upper row picks up one octave higher than the lower one.
      if (upper >= 0) return upper + stepsPerOctave;
      return null;
    }

    function isTyping(target: EventTarget | null): boolean {
      const node = target as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName;
      // A slider keeps focus after you drag it, but you are not *typing* into it —
      // treating it as a text field would quietly kill the spacebar and the
      // keyboard's note keys until the child thought to click elsewhere.
      if (tag === 'INPUT') return (node as HTMLInputElement).type !== 'range';
      return tag === 'SELECT' || tag === 'TEXTAREA' || node.isContentEditable;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isTyping(e.target)) return;
      const index = keyIndex(e.key.toLowerCase());
      if (index == null) return;
      const midi = pitches[index];
      if (midi == null) return;
      e.preventDefault();
      pressNote(e.key.toLowerCase(), midi);
    }

    function onKeyUp(e: KeyboardEvent) {
      // macOS doesn't deliver keyup for ordinary keys while Command is held, so
      // a note played and let go during a ⌘Z / ⌘S would sustain forever with
      // nothing pressed. When Command itself comes up, let everything go.
      if (e.key === 'Meta') {
        releaseEverything();
        return;
      }
      releaseNote(e.key.toLowerCase());
    }

    // Losing the window — or the whole tab — with keys down would leave notes
    // ringing with no way to stop them.
    function onHidden() {
      if (document.visibilityState === 'hidden') releaseEverything();
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseEverything);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseEverything);
      document.removeEventListener('visibilitychange', onHidden);
      releaseEverything();
    };
  }, [pitches, stepsPerOctave, pressNote, releaseNote, releaseEverything]);

  // ---- mouse / touch ------------------------------------------------------

  useEffect(() => {
    function up(e: PointerEvent) {
      activePointers.current.delete(e.pointerId);
      releaseNote(pointerSource(e.pointerId));
    }
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [releaseNote]);

  function onKeyPointerDown(e: React.PointerEvent, midi: number) {
    e.preventDefault();
    // Touch and pen get *implicit* pointer capture on the element the press
    // started on: every later event for that finger is re-aimed at that one key,
    // so sliding along the keyboard would never reach the keys underneath. Hand
    // the capture back and the keys get their own enter events. (Mouse pointers
    // are the one kind that never get this, which is exactly why sliding can
    // look fine on a desktop and do nothing at all on a tablet.)
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    activePointers.current.add(e.pointerId);
    pressNote(pointerSource(e.pointerId), midi, strikeAt(e));
  }

    /**
   * How hard this press counts as, from where on the key it landed.
   *
   * Measured against the key's own box, deliberately. The obvious `offsetY` is
   * relative to whatever node the pointer actually hit — and every key has a
   * note name and a shortcut label sitting inside it, so landing on one of
   * those would report a depth into *the label* and read as a soft tap
   * wherever on the key it happened.
   */
  function strikeAt(e: React.PointerEvent): number {
    const rect = e.currentTarget.getBoundingClientRect();
    return strikeVelocity(e.clientY - rect.top, rect.height);
  }

  /** Sliding onto a key with that finger still down plays it. */
  function onKeyPointerEnter(e: React.PointerEvent, midi: number) {
    if (!activePointers.current.has(e.pointerId)) return;
    const source = pointerSource(e.pointerId);
    releaseNote(source);
    // Slide along the near edge for a run of hard notes, along the far end for
    // a soft one — the same rule as a single press, kept consistent.
    pressNote(source, midi, strikeAt(e));
  }

  /** The computer key that plays this rung of the ladder, if any. */
  const shortcutFor = (index: number): string | null => {
    if (index < stepsPerOctave) return LOWER_ROW[index] ?? null;
    return UPPER_ROW[index - stepsPerOctave] ?? null;
  };

  return (
    <div className={`keyboard ${isRecording ? 'recording' : ''}`}
      data-tour="keyboard">
      <div className="kb-side">
        {/*
          The one question this row could never answer: what happens to a note
          once you have played it? Nothing did, unless you had already found a
          ⏺ at the far end of the toolbar and pressed it — and there was no
          reason to look. So the way in sits here, on the thing being played,
          and says in words what state it is in and what to do next.
        */}
        <div className="kb-capture">
          <button
            className={`kb-arm ${isRecording ? 'armed' : ''}`}
            // Arming and then having to go and press play elsewhere is one
            // step too many for the thing this button is trying to teach — so
            // the store starts the song too, at the end of the count. Starting
            // it here instead ran three seconds of music past the child before
            // anything was being written down.
            onClick={toggleRecording}
            title={
              isRecording
                ? 'Stop writing what you play into the song'
                : 'Play along and it gets written into the song'
            }
          >
            {isRecording ? '⏹ Stop writing' : '⏺ Write what I play into the song'}
          </button>
          {/* One way in, whether or not there is a voice row yet: put a place
              to sing on the timeline and open its controls. Pressing this used
              to start recording on the spot, which is the thing the count of
              three exists to stop happening. */}
          <button
            className={`kb-arm mic ${isMicRecording ? 'armed' : ''}`}
            onClick={() => {
              if (isMicRecording) void toggleMicRecording();
              else addVoiceBlockAtPlayhead();
            }}
            disabled={!canRecordMic}
            title={
              canRecordMic
                ? isMicRecording
                  ? 'Stop — what you sang becomes a block in the song'
                  : 'Put a place to sing on the timeline, then press Record on it'
                : 'Recording your voice needs the desktop app'
            }
          >
            {isMicRecording ? '⏹ Stop singing' : '🎤 Add a place to sing'}
          </button>
          <span className="kb-capture-note">
            {isMicRecording
              ? 'Listening — press stop and it becomes a block.'
              : isRecording
                ? isPlaying
                  ? 'Writing it down — every note you play lands on the timeline.'
                  : 'Press ▶ and play — what you play lands on the timeline.'
                : 'Play freely — nothing is kept until you press one of these.'}
          </span>
        </div>
        <span className="kb-divider" />
        <div className="kb-voices">
          {MELODIC_VOICES.map((v) => (
            <button
              key={v.id}
              className={`kb-voice ${v.id === voiceId ? 'on' : ''}`}
              style={{ ['--kb' as string]: v.color }}
              onClick={() => setVoiceId(v.id)}
              title={v.label}
            >
              <span>{v.emoji}</span>
              {v.label}
            </button>
          ))}
        </div>
        <div className="kb-octave">
          <button onClick={() => setOctaveShift((o) => Math.max(-2, o - 1))} title="Lower">
            −
          </button>
          <span title="Shift the whole keyboard up or down">
            {octaveShift === 0 ? 'octave' : octaveShift > 0 ? `+${octaveShift}` : octaveShift}
          </span>
          <button onClick={() => setOctaveShift((o) => Math.min(2, o + 1))} title="Higher">
            +
          </button>
        </div>
      </div>

      <div className="kb-keys">
        {pitches.map((midi, i) => {
          const isRoot = (((midi % 12) + 12) % 12) === project.scaleRoot;
          const shortcut = shortcutFor(i);
          return (
            <button
              key={`${midi}-${i}`}
              className={`kb-key ${litPitches.includes(midi) ? 'down' : ''} ${isRoot ? 'root' : ''}`}
              style={{ ['--kb' as string]: voice?.color ?? '#60a5fa' }}
              onPointerDown={(e) => onKeyPointerDown(e, midi)}
              onPointerEnter={(e) => onKeyPointerEnter(e, midi)}
              onContextMenu={(e) => e.preventDefault()}
              title={`${midiToName(midi)} — hit low on the key for a loud note, high for a soft one`}
            >
              <span className="kb-note">{midiToName(midi)}</span>
              {shortcut && <span className="kb-shortcut">{shortcut}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
