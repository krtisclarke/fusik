import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { engine } from '../audio/AudioEngine';
import {
  deviceSelectionSupported,
  listAudioDevices,
  outputSwitchingSupported,
  revealDeviceNames,
  type AudioDeviceLists,
} from '../platform/audioDevices';

/**
 * Which microphone the app listens to, and which speakers it plays out of.
 *
 * The app used to take whatever the machine's defaults happened to be, and the
 * only way to change either was Windows Settings and a restart. That is fine
 * until a headset goes on, or a monitor with speakers in it quietly takes over
 * the output, or a webcam microphone on the other side of the room wins over
 * the one on your head — and none of those is a thing to hand a child.
 *
 * A grown-up setting, so it sits behind its own small button rather than in
 * the way. Both lists offer the machine's own default at the top, which is
 * where the app has always been and the setting to come back to if a choice
 * turns out wrong.
 */
export function SoundSettings() {
  const showSound = useStore((s) => s.showSound);
  const toggleSound = useStore((s) => s.toggleSound);
  const audioInputId = useStore((s) => s.audioInputId);
  const audioOutputId = useStore((s) => s.audioOutputId);
  const setAudioInput = useStore((s) => s.setAudioInput);
  const setAudioOutput = useStore((s) => s.setAudioOutput);
  const setStatus = useStore((s) => s.setStatus);

  const [lists, setLists] = useState<AudioDeviceLists>({
    inputs: [],
    outputs: [],
    labelled: true,
  });
  const panelRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    void listAudioDevices().then(setLists);
  }, []);

  useEffect(() => {
    if (!showSound) return;
    refresh();
    // Plugging a headset in while the panel is open should show it, rather than
    // needing the panel closed and opened again to notice.
    const onChange = () => refresh();
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
  }, [showSound, refresh]);

  useEffect(() => {
    if (!showSound) return;
    function onDown(e: PointerEvent) {
      if (!panelRef.current?.contains(e.target as Node)) toggleSound();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') toggleSound();
    }
    // On the way down, so a click that dismisses the panel doesn't also land on
    // whatever was underneath it.
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [showSound, toggleSound]);

  if (!showSound) return null;

  const supported = deviceSelectionSupported();
  const canSwitchOutput = outputSwitchingSupported();

  /** Play something through the chosen speakers, so "is this the right one?"
   *  is answered by listening rather than by reading a name. */
  async function testOutput() {
    setStatus('Testing the speakers…');
    await engine.audition('bells', {}, 0.9, 72);
  }

  async function askForNames() {
    const ok = await revealDeviceNames();
    if (!ok) {
      setStatus("Can't see the microphones — is one plugged in?");
      return;
    }
    refresh();
  }

  return (
    <div className="sound-panel" ref={panelRef} role="dialog" aria-label="Sound settings">
      <div className="sound-head">Sound</div>

      {!supported ? (
        <div className="sound-note">
          This copy of the app can't choose devices. It uses whatever the computer
          is set to.
        </div>
      ) : (
        <>
          {!lists.labelled && (
            <div className="sound-note">
              The names are hidden until the computer lets the app hear a
              microphone.{' '}
              <button className="sound-link" onClick={() => void askForNames()}>
                Show me the names
              </button>
            </div>
          )}

          <label className="sound-row">
            <span className="sound-label">🎤 Microphone</span>
            <select
              value={audioInputId}
              onChange={(e) => setAudioInput(e.target.value)}
              title="Which microphone your singing is recorded from"
            >
              <option value="">Whatever the computer uses</option>
              {lists.inputs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          <label className="sound-row">
            <span className="sound-label">🔊 Speakers</span>
            <select
              value={audioOutputId}
              onChange={(e) => setAudioOutput(e.target.value)}
              disabled={!canSwitchOutput}
              title={
                canSwitchOutput
                  ? 'Which speakers or headphones the song plays out of'
                  : "This copy of the app can't change where sound comes out"
              }
            >
              <option value="">Whatever the computer uses</option>
              {lists.outputs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          <div className="sound-actions">
            <button className="sound-test" onClick={() => void testOutput()}>
              ♪ Test the sound
            </button>
            <button className="sound-test" onClick={refresh} title="Look for devices again">
              ⟳ Look again
            </button>
          </div>

          <div className="sound-note quiet">
            A new take uses the microphone chosen here. If something is unplugged
            later, the app goes back to the computer's own choice on its own.
          </div>
        </>
      )}
    </div>
  );
}
