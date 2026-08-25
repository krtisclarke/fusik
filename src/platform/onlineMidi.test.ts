import { describe, it, expect } from 'vitest';
import { cleanMidiName, parseSearchResponse } from './onlineMidi';

// The fixture below is a real answer from the search endpoint, trimmed to two
// results — captured rather than invented, because the whole risk in this
// module is the shape of somebody else's JSON, and a fixture I wrote myself
// would only encode what I assumed that shape to be.
const REAL_RESPONSE = {
  result: {
    query: { q: 'twinkle', page: 0, pageSize: 15 },
    results: [
      {
        id: 35393,
        name: 'twinkle-twinkle-little-star.mid',
        slug: 'twinkle-twinkle-little-star-mid',
        alternateNames: null,
        views: 79467,
        plays: 24469,
        createdAt: '2018-07-13 20:10:09',
        updatedAt: '2026-08-25 15:03:44',
        url: '/twinkle-twinkle-little-star-mid',
        downloadUrl: '/uploads/35393.mid',
      },
      {
        id: 39941,
        name: 'DJ Astrid & Tommy Pulse - Twinkle.mid',
        slug: 'dj-astrid-and-tommy-pulse-twinkle-mid',
        alternateNames: ['DJ_Astrid__Tommy_Pulse_-_Twinkle__PhaniaX_20061003233128.mid'],
        views: 6548,
        plays: 973,
        createdAt: '2018-07-13 20:10:09',
        updatedAt: '2026-08-24 22:48:48',
        url: '/dj-astrid-and-tommy-pulse-twinkle-mid',
        downloadUrl: '/uploads/39941.mid',
      },
    ],
  },
};

describe('cleanMidiName', () => {
  it('turns a twenty-year-old file name into something readable', () => {
    expect(cleanMidiName('twinkle-twinkle-little-star.mid')).toBe('Twinkle Twinkle Little Star');
  });

  it('handles underscores and doubled separators', () => {
    expect(cleanMidiName('super__mario_-_theme.midi')).toBe('Super Mario Theme');
  });

  it('leaves words that already carry their own capitals alone', () => {
    expect(cleanMidiName('DJ Astrid & Tommy Pulse - Twinkle.mid')).toBe(
      'DJ Astrid & Tommy Pulse Twinkle',
    );
  });

  it('never hands back an empty name', () => {
    expect(cleanMidiName('.mid')).toBe('Untitled');
    expect(cleanMidiName('')).toBe('Untitled');
  });
});

describe('parseSearchResponse', () => {
  it('pulls name, absolute download URL and play count out of a real answer', () => {
    const items = parseSearchResponse(REAL_RESPONSE);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      id: 35393,
      name: 'Twinkle Twinkle Little Star',
      downloadUrl: 'https://bitmidi.com/uploads/35393.mid',
      plays: 24469,
    });
  });

  it('leaves an already-absolute download URL alone', () => {
    const items = parseSearchResponse({
      result: { results: [{ id: 1, name: 'a.mid', downloadUrl: 'https://elsewhere/x.mid' }] },
    });
    expect(items[0].downloadUrl).toBe('https://elsewhere/x.mid');
  });

  it('skips entries with nothing to download', () => {
    const items = parseSearchResponse({
      result: { results: [{ id: 1, name: 'a.mid' }, { id: 2, name: 'b.mid', downloadUrl: '/b.mid' }] },
    });
    expect(items.map((i) => i.id)).toEqual([2]);
  });

  it('gives back an empty list rather than throwing on a shape it has never seen', () => {
    expect(parseSearchResponse(null)).toEqual([]);
    expect(parseSearchResponse({})).toEqual([]);
    expect(parseSearchResponse({ result: { results: 'nope' } })).toEqual([]);
  });
});
