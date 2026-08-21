import { describe, it, expect } from 'vitest';
import { AUTOSAVE_KEY, clearAutosave, readAutosave, writeAutosave } from './autosave';
import type { StorageLike } from './autosave';
import { createDefaultProject, createNote, addNote } from '../model/project';

/** A stand-in for localStorage — the tests run in Node, where there isn't one. */
function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

function songWithABeat() {
  const project = createDefaultProject('Kept Song');
  const section = project.sections[0];
  const track = project.tracks[0];
  return addNote(project, track.id, createNote(section.id, 2, 1, 0.9));
}

describe('autosave slot', () => {
  it('brings the song back exactly as it was', () => {
    const storage = fakeStorage();
    const project = songWithABeat();

    expect(writeAutosave(project, storage)).toBe('ok');
    const restored = readAutosave(storage);

    expect(restored).not.toBeNull();
    expect(restored!.project).toEqual(project);
    expect(restored!.savedAt).toBeGreaterThan(0);
  });

  it('has nothing to restore before anything has been written', () => {
    expect(readAutosave(fakeStorage())).toBeNull();
  });

  it('replaces the previous song rather than piling up', () => {
    const storage = fakeStorage();
    writeAutosave(createDefaultProject('First'), storage);
    writeAutosave(createDefaultProject('Second'), storage);

    expect(Object.keys(storage.data)).toEqual([AUTOSAVE_KEY]);
    expect(readAutosave(storage)!.project.name).toBe('Second');
  });

  it('starts fresh instead of throwing when the slot is corrupt', () => {
    expect(readAutosave(fakeStorage({ [AUTOSAVE_KEY]: 'not json at all' }))).toBeNull();
    expect(readAutosave(fakeStorage({ [AUTOSAVE_KEY]: '{"savedAt":1}' }))).toBeNull();
    expect(readAutosave(fakeStorage({ [AUTOSAVE_KEY]: '{"json":"{}"}' }))).toBeNull();
  });

  it('starts fresh when the saved song is from a newer version of the app', () => {
    const future = JSON.stringify({ formatVersion: 99, name: 'Future', tracks: [] });
    const storage = fakeStorage({ [AUTOSAVE_KEY]: JSON.stringify({ savedAt: 1, json: future }) });
    expect(readAutosave(storage)).toBeNull();
  });

  it('leaves an unreadable slot in place rather than deleting it', () => {
    const storage = fakeStorage({ [AUTOSAVE_KEY]: 'not json at all' });
    readAutosave(storage);
    expect(storage.data[AUTOSAVE_KEY]).toBe('not json at all');
  });

  it('reports a full storage instead of throwing', () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      removeItem: () => {},
    };
    expect(writeAutosave(createDefaultProject(), storage)).toBe('full');
  });

  it('does nothing at all when there is no storage', () => {
    expect(writeAutosave(createDefaultProject(), null)).toBe('unavailable');
    expect(readAutosave(null)).toBeNull();
    expect(() => clearAutosave(null)).not.toThrow();
  });

  it('clears the slot for a new song', () => {
    const storage = fakeStorage();
    writeAutosave(createDefaultProject(), storage);
    clearAutosave(storage);
    expect(readAutosave(storage)).toBeNull();
  });
});
