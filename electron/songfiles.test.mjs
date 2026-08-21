import { describe, it, expect } from 'vitest';
import songfiles from './songfiles.cjs';

const { fileNameFor, uniqueFileName } = songfiles;

describe('naming a song’s file', () => {
  it('uses the name the child typed', () => {
    expect(fileNameFor('Dinosaur Disco')).toBe('Dinosaur Disco.beatbox');
  });

  it('drops characters a file system will not take', () => {
    expect(fileNameFor('AC/DC: the *best* song?')).toBe('AC DC the best song.beatbox');
    expect(fileNameFor('one\\two')).toBe('one two.beatbox');
  });

  it('never produces a hidden file or an empty name', () => {
    expect(fileNameFor('...')).toBe('My Song.beatbox');
    expect(fileNameFor('   ')).toBe('My Song.beatbox');
    expect(fileNameFor('')).toBe('My Song.beatbox');
    expect(fileNameFor(null)).toBe('My Song.beatbox');
    expect(fileNameFor('.hidden')).toBe('hidden.beatbox');
  });

  it('keeps a very long name to something a file system will accept', () => {
    expect(fileNameFor('a'.repeat(300)).length).toBeLessThanOrEqual(68);
  });

  it('gives two songs of the same name their own files', () => {
    const taken = new Set(['Song.beatbox']);
    const second = uniqueFileName('Song', (f) => taken.has(f), null);
    expect(second).toBe('Song 2.beatbox');
    taken.add(second);
    expect(uniqueFileName('Song', (f) => taken.has(f), null)).toBe('Song 3.beatbox');
  });

  // Saving a song over itself is not a clash — otherwise every autosave, one a
  // second, would leave another copy behind.
  it('lets a song keep writing to its own file', () => {
    const taken = new Set(['Song.beatbox']);
    expect(uniqueFileName('Song', (f) => taken.has(f), 'Song.beatbox')).toBe('Song.beatbox');
  });

  it('moves a song to a new file when it is renamed', () => {
    const taken = new Set(['Old Name.beatbox']);
    expect(uniqueFileName('New Name', (f) => taken.has(f), 'Old Name.beatbox')).toBe(
      'New Name.beatbox',
    );
  });
});
