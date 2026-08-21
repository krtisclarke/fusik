import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  deleteSong,
  importLegacyAutosave,
  listSongs,
  readCurrentSongId,
  readSong,
  writeCurrentSongId,
  writeSong,
} from './library';
import type { StorageLike } from './storage';
import { createDefaultProject, createNote, addNote } from '../model/project';

/** A stand-in for localStorage — the tests run in Node, where there isn't one. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  const storage: StorageLike & { data: Record<string, string> } = {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
  return storage;
}

function songWithABeat(name: string) {
  const project = createDefaultProject(name);
  return addNote(project, project.tracks[0].id, createNote(project.sections[0].id, 2, 1, 0.9));
}

// Songs are ordered by when they were written, so the clock has to move.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the songs shelf', () => {
  it('keeps a song and gives it back exactly', () => {
    const storage = fakeStorage();
    const project = songWithABeat('First Song');
    expect(writeSong('s1', project, storage)).toBe('ok');
    expect(readSong('s1', storage)).toEqual(project);
  });

  it('keeps several songs side by side', () => {
    const storage = fakeStorage();
    writeSong('s1', createDefaultProject('One'), storage);
    vi.advanceTimersByTime(1000);
    writeSong('s2', createDefaultProject('Two'), storage);

    expect(listSongs(storage).map((s) => s.name)).toEqual(['Two', 'One']); // newest first
    expect(readSong('s1', storage)!.name).toBe('One');
    expect(readSong('s2', storage)!.name).toBe('Two');
  });

  // The whole reason this replaced the single slot: starting a new song used to
  // be the end of the last one.
  it('does not disturb the other songs when one is written', () => {
    const storage = fakeStorage();
    const first = songWithABeat('Keeper');
    writeSong('s1', first, storage);
    vi.advanceTimersByTime(1000);
    writeSong('s2', createDefaultProject('Brand New'), storage);
    expect(readSong('s1', storage)).toEqual(first);
  });

  it('replaces a song in place rather than piling up copies', () => {
    const storage = fakeStorage();
    writeSong('s1', createDefaultProject('Draft'), storage);
    vi.advanceTimersByTime(1000);
    writeSong('s1', createDefaultProject('Finished'), storage);
    expect(listSongs(storage)).toHaveLength(1);
    expect(listSongs(storage)[0].name).toBe('Finished');
  });

  it('takes a song off the shelf, and only that song', () => {
    const storage = fakeStorage();
    writeSong('s1', createDefaultProject('One'), storage);
    writeSong('s2', createDefaultProject('Two'), storage);
    deleteSong('s1', storage);
    expect(readSong('s1', storage)).toBeNull();
    expect(listSongs(storage).map((s) => s.id)).toEqual(['s2']);
    expect(readSong('s2', storage)).not.toBeNull();
  });

  it('has nothing to show before anything has been made', () => {
    const storage = fakeStorage();
    expect(listSongs(storage)).toEqual([]);
    expect(readSong('nope', storage)).toBeNull();
    expect(readCurrentSongId(storage)).toBeNull();
  });

  it('remembers which song was open, unless it has since been deleted', () => {
    const storage = fakeStorage();
    writeSong('s1', createDefaultProject('One'), storage);
    writeCurrentSongId('s1', storage);
    expect(readCurrentSongId(storage)).toBe('s1');
    deleteSong('s1', storage);
    expect(readCurrentSongId(storage)).toBeNull();
  });

  it('starts fresh instead of throwing on a corrupt shelf', () => {
    expect(listSongs(fakeStorage({ 'beatbox.songs.v1': 'not json' }))).toEqual([]);
    expect(listSongs(fakeStorage({ 'beatbox.songs.v1': '{"not":"an array"}' }))).toEqual([]);
    expect(listSongs(fakeStorage({ 'beatbox.songs.v1': '[{"junk":true}]' }))).toEqual([]);
    expect(readSong('s1', fakeStorage({ 'beatbox.song.s1': 'not json' }))).toBeNull();
  });

  it('refuses a song from a newer version of the app rather than mangling it', () => {
    const future = JSON.stringify({ formatVersion: 99, name: 'Future', tracks: [] });
    expect(readSong('s1', fakeStorage({ 'beatbox.song.s1': future }))).toBeNull();
  });

  it('leaves an unreadable song in place rather than deleting it', () => {
    const storage = fakeStorage({ 'beatbox.song.s1': 'not json' });
    readSong('s1', storage);
    expect(storage.data['beatbox.song.s1']).toBe('not json');
  });

  it('reports a full storage instead of throwing', () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      removeItem: () => {},
    };
    expect(writeSong('s1', createDefaultProject(), storage)).toBe('full');
  });

  it('does nothing at all when there is no storage', () => {
    expect(writeSong('s1', createDefaultProject(), null)).toBe('unavailable');
    expect(readSong('s1', null)).toBeNull();
    expect(listSongs(null)).toEqual([]);
    expect(() => deleteSong('s1', null)).not.toThrow();
    expect(readCurrentSongId(null)).toBeNull();
  });
});

describe('upgrading from the single-slot autosave', () => {
  const legacy = (project = songWithABeat('Work In Progress')) => ({
    'beatbox.autosave.v1': JSON.stringify({
      savedAt: 1,
      name: project.name,
      json: JSON.stringify(project),
    }),
  });

  // Losing the song in progress on an update is the one thing autosave exists
  // to prevent, so the old slot has to be carried over rather than ignored.
  it('brings the song that was in progress onto the shelf', () => {
    const project = songWithABeat('Work In Progress');
    const storage = fakeStorage(legacy(project));
    expect(importLegacyAutosave('s1', storage)).toBe('s1');
    expect(readSong('s1', storage)!.name).toBe('Work In Progress');
    expect(readSong('s1', storage)!.tracks[0].notes).toHaveLength(1);
    expect(listSongs(storage).map((s) => s.id)).toEqual(['s1']);
  });

  // Without this the child lands on a blank song after updating: the work is
  // safely on the shelf, but nothing opens it, which looks just like losing it.
  it('opens the song it rescued, rather than a blank one', () => {
    const storage = fakeStorage(legacy());
    importLegacyAutosave('s1', storage);
    expect(readCurrentSongId(storage)).toBe('s1');
  });

  it('clears the old slot once, so it can never come back over newer work', () => {
    const storage = fakeStorage(legacy());
    importLegacyAutosave('s1', storage);
    expect(storage.data['beatbox.autosave.v1']).toBeUndefined();
    expect(importLegacyAutosave('s2', storage)).toBeNull();
    expect(listSongs(storage).map((s) => s.id)).toEqual(['s1']);
  });

  it('does nothing when there is no old slot, or it is unreadable', () => {
    expect(importLegacyAutosave('s1', fakeStorage())).toBeNull();
    expect(importLegacyAutosave('s1', fakeStorage({ 'beatbox.autosave.v1': 'not json' }))).toBeNull();
    expect(
      importLegacyAutosave('s1', fakeStorage({ 'beatbox.autosave.v1': '{"savedAt":1}' })),
    ).toBeNull();
  });

  it('keeps the old slot if the song could not be stored', () => {
    // Nothing is thrown away until the copy is safely on the shelf.
    const data: Record<string, string> = legacy();
    const storage: StorageLike = {
      getItem: (k) => (k in data ? data[k] : null),
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      removeItem: (k) => {
        delete data[k];
      },
    };
    expect(importLegacyAutosave('s1', storage)).toBeNull();
    expect(data['beatbox.autosave.v1']).toBeDefined();
  });
});
