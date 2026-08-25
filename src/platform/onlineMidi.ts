// Finding songs to import, from the web rather than from a file on the disk.
//
// The app can already turn a `.mid` file into a Beatbox song. The missing half
// was getting hold of one: a `.mid` is not something a child has lying around,
// and "ask a grown-up to go and find one" is not a feature. This searches
// BitMidi — a long-standing public index of MIDI files, with a plain JSON
// search endpoint and no key, account or terms to agree to — and hands the
// bytes to the same importer the file picker uses.
//
// What comes back is fan-made transcriptions uploaded by the public, which is
// what every MIDI archive on the internet is. They are note-instructions, not
// recordings: nothing of the original recording is in them.

const HOST = 'https://bitmidi.com';

export interface OnlineMidi {
  id: number;
  /** Tidied for reading: "twinkle-twinkle_little-star.mid" → "Twinkle Twinkle Little Star". */
  name: string;
  /** The absolute URL of the .mid itself. */
  downloadUrl: string;
  /** How often it's been played on the site — a rough "is this a good one?". */
  plays: number;
}

/**
 * A file name off a MIDI archive, made readable.
 *
 * These are twenty-year-old file names — hyphens, underscores, stray version
 * numbers, always the extension. A child scanning a list should read song
 * titles, not file names.
 */
export function cleanMidiName(raw: string): string {
  const base = raw.replace(/\.mid(i)?$/i, '');
  const words = base
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!words) return 'Untitled';
  // Leave words that are already mixed-case or shouty alone; only fix the
  // all-lowercase ones, which is what the hyphenated file names give us.
  return words
    .split(' ')
    .map((w) => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Pull the useful shape out of a BitMidi search response. */
export function parseSearchResponse(json: unknown): OnlineMidi[] {
  const results = (json as { result?: { results?: unknown[] } })?.result?.results;
  if (!Array.isArray(results)) return [];
  const out: OnlineMidi[] = [];
  for (const raw of results) {
    const r = raw as { id?: number; name?: string; downloadUrl?: string; plays?: number };
    if (typeof r.downloadUrl !== 'string' || !r.downloadUrl) continue;
    out.push({
      id: typeof r.id === 'number' ? r.id : out.length,
      name: cleanMidiName(String(r.name ?? '')),
      downloadUrl: r.downloadUrl.startsWith('http') ? r.downloadUrl : HOST + r.downloadUrl,
      plays: typeof r.plays === 'number' ? r.plays : 0,
    });
  }
  return out;
}

/**
 * Fetch a URL as bytes.
 *
 * In the desktop app this goes through the main process. Not for CORS — the
 * search host allows anyone — but because the packaged app's page is loaded
 * from `file://`, and Chromium's treatment of cross-origin requests from a
 * `file://` page is its own inconsistent thing that is not worth betting the
 * feature on. The main process only ever fetches from the one host it is given
 * (see the allowlist in electron/main.cjs).
 */
async function getBytes(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const desktop = typeof window !== 'undefined' ? window.desktop : undefined;
  if (desktop?.web) {
    const res = await desktop.web.get(url);
    if (!res.ok || !res.bytes) throw new Error(res.error || 'No answer from the internet');
    return res.bytes;
  }
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`The site answered ${res.status}`);
  return res.arrayBuffer();
}

/** Songs matching what was typed, best-known first. */
export async function searchOnlineMidi(
  query: string,
  signal?: AbortSignal,
): Promise<OnlineMidi[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `${HOST}/api/midi/search?q=${encodeURIComponent(q)}&pageSize=24`;
  const bytes = await getBytes(url, signal);
  const text = new TextDecoder().decode(bytes);
  return parseSearchResponse(JSON.parse(text));
}

/** The chosen song's actual note-instructions. */
export async function downloadOnlineMidi(
  item: OnlineMidi,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const bytes = await getBytes(item.downloadUrl, signal);
  return new Uint8Array(bytes);
}
