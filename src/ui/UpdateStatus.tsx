import { useEffect, useState } from 'react';
import { getDesktop, type UpdateState } from '../platform/files';
import { useStore } from '../state/store';

/**
 * The version number in the toolbar, which doubles as the app's report on
 * keeping itself current.
 *
 * It used to be only a number, and the updater behind it said nothing at all —
 * so an update that silently failed looked exactly like one that had never
 * been needed. There was nothing to see and nothing to ask. Now the number
 * grows a short line when something is happening ("Getting the newest
 * version… 40%", "Ready — close and reopen"), turns red when it went wrong,
 * and clicking it looks again straight away. A child never has to read any of
 * it: nothing blocks, nothing pops up, and it is back to a plain version
 * number the moment there is nothing to say.
 */
export function UpdateStatus() {
  const [state, setState] = useState<UpdateState | null>(null);
  const setStatus = useStore((s) => s.setStatus);
  const updates = getDesktop()?.updates;

  useEffect(() => {
    if (!updates) return;
    void updates.state().then(setState);
    return updates.onStatus(setState);
  }, [updates]);

  async function onClick() {
    if (!updates) return;
    if (state?.stage === 'ready') {
      // The one step nobody has ever watched happen is the swap at shutdown.
      // This does it now instead, while somebody is looking.
      setStatus('Restarting into the new version…');
      await updates.install();
      return;
    }
    if (state?.stage === 'error') {
      // The one case worth handing a grown-up: what actually went wrong, and
      // where the rest of it is written down.
      const log = await updates.log();
      setStatus(log.ok ? `Update log: ${log.path}` : 'No update log yet.');
      return;
    }
    setStatus('Looking for a newer version…');
    await updates.check();
  }

  const stage = state?.stage;
  const shows = stage === 'downloading' || stage === 'ready' || stage === 'error';

  return (
    <span className="version-block">
      <button
        type="button"
        className={`version ${shows ? `upd-${stage}` : ''}`}
        onClick={() => void onClick()}
        title={
          updates
            ? state?.message || 'Click to look for a newer version'
            : 'Version — updates run in the installed app'
        }
      >
        v{__APP_VERSION__}
      </button>
      {shows && (
        <span className={`upd-line upd-${stage}`}>
          {stage === 'error' ? "Update didn't work — click for details" : state?.message}
        </span>
      )}
    </span>
  );
}
