import { useEffect } from 'react';
import { useStore } from './state/store';
import { Transport } from './ui/Transport';
import { Library } from './ui/Library';
import { SectionStrip } from './ui/SectionStrip';
import { Timeline } from './ui/Timeline';
import { SoundEditor } from './ui/SoundEditor';
import { Keyboard } from './ui/Keyboard';
import { Tutorial } from './ui/Tutorial';
import { FindOnline } from './ui/FindOnline';
import { getDesktop } from './platform/files';
import { startAutosave } from './state/autosave';

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  // A slider keeps focus after you drag it, but you are not *typing* into it —
  // treating it as a text field would quietly kill the spacebar and the
  // keyboard's note keys until the child thought to click elsewhere.
  if (tag === 'INPUT') return (node as HTMLInputElement).type !== 'range';
  return tag === 'SELECT' || tag === 'TEXTAREA' || node.isContentEditable;
}

export function App() {
  const status = useStore((s) => s.status);
  const setStatus = useStore((s) => s.setStatus);
  const showKeyboard = useStore((s) => s.showKeyboard);

  // Keyboard shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void s.saveCurrent();
        return;
      }
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void s.openFromFile();
        return;
      }
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        s.newProject();
        return;
      }

      if (isTypingTarget(e.target)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        // Mid-take, space ends the take. Finding a small button is the one
        // thing you can't do while singing into the microphone, and stopping
        // the song without closing the recording would leave it running.
        if (s.isMicRecording) {
          void s.toggleMicRecording();
          return;
        }
        s.togglePlay();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selection.noteIds.length > 0) {
          e.preventDefault();
          s.removeSelected();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Native menu commands (desktop only).
  useEffect(() => {
    const desktop = getDesktop();
    if (!desktop) return;
    const s = () => useStore.getState();
    const offs = [
      desktop.onMenu('menu:new', () => s().newProject()),
      desktop.onMenu('menu:open', () => void s().openFromFile()),
      desktop.onMenu('menu:save', () => void s().saveCurrent()),
      desktop.onMenu('menu:undo', () => s().undo()),
      desktop.onMenu('menu:redo', () => s().redo()),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  // Keep the song in the browser's own storage as it's worked on, so closing
  // the tab (or a crash) doesn't take it away. Restoring happens as the store
  // starts up; this is the writing half.
  useEffect(() => startAutosave(useStore), []);

  // Auto-dismiss the status toast.
  useEffect(() => {
    if (!status) return;
    const id = setTimeout(() => setStatus(null), 2200);
    return () => clearTimeout(id);
  }, [status, setStatus]);

  return (
    <div className={`app ${showKeyboard ? 'with-keys' : ''}`}>
      <Transport />
      <Library />
      <div className="stage">
        <SectionStrip />
        <Timeline />
      </div>
      <SoundEditor />
      {showKeyboard && <Keyboard />}
      {status && <div className="toast">{status}</div>}
      <FindOnline />
      <Tutorial />
    </div>
  );
}
