import { useEffect } from 'react';
import { useStore } from './state/store';
import { Transport } from './ui/Transport';
import { Library } from './ui/Library';
import { Timeline } from './ui/Timeline';
import { SoundEditor } from './ui/SoundEditor';
import { getDesktop } from './platform/files';

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || node.isContentEditable;
}

export function App() {
  const status = useStore((s) => s.status);
  const setStatus = useStore((s) => s.setStatus);

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

  // Auto-dismiss the status toast.
  useEffect(() => {
    if (!status) return;
    const id = setTimeout(() => setStatus(null), 2200);
    return () => clearTimeout(id);
  }, [status, setStatus]);

  return (
    <div className="app">
      <Transport />
      <Library />
      <div className="stage">
        <Timeline />
      </div>
      <SoundEditor />
      {status && <div className="toast">{status}</div>}
    </div>
  );
}
