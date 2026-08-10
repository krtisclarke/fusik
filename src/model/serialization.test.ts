import { describe, it, expect } from 'vitest';
import { serializeProject, parseProject, ProjectLoadError } from './serialization';
import { createDefaultProject, createNote, addNote } from './project';
import { PROJECT_FORMAT_VERSION } from './types';

describe('project serialization', () => {
  it('round-trips a project exactly', () => {
    let project = createDefaultProject('Test Song');
    project = addNote(project, project.tracks[0].id, createNote(0, 1, 0.9));
    project = addNote(project, project.tracks[0].id, createNote(2, 1, 0.5));

    const restored = parseProject(serializeProject(project));
    expect(restored).toEqual(project);
  });

  it('produces human-readable JSON', () => {
    const json = serializeProject(createDefaultProject());
    expect(json).toContain('\n'); // pretty-printed
    expect(JSON.parse(json).formatVersion).toBe(PROJECT_FORMAT_VERSION);
  });
});

describe('parsing invalid input', () => {
  it('rejects non-JSON', () => {
    expect(() => parseProject('not json {')).toThrow(ProjectLoadError);
  });

  it('rejects a JSON value that is not a project object', () => {
    expect(() => parseProject('42')).toThrow(ProjectLoadError);
    expect(() => parseProject('[]')).toThrow(ProjectLoadError);
  });

  it('rejects a project with no tracks array', () => {
    expect(() => parseProject('{"name":"x"}')).toThrow(ProjectLoadError);
  });

  it('rejects a project from a newer format version', () => {
    const future = JSON.stringify({ formatVersion: 999, tracks: [] });
    expect(() => parseProject(future)).toThrow(/newer version/i);
  });
});

describe('repairing imperfect input', () => {
  it('clamps an out-of-range tempo and fills a missing name', () => {
    const parsed = parseProject(JSON.stringify({ bpm: 9000, tracks: [] }));
    expect(parsed.bpm).toBeLessThanOrEqual(300);
    expect(parsed.name).toBeTruthy();
  });

  it('defaults and clamps malformed notes', () => {
    const parsed = parseProject(
      JSON.stringify({
        tracks: [
          {
            instrument: { voiceId: 'kick' },
            notes: [{ startBeat: -3, velocity: 5 }, {}],
          },
        ],
      }),
    );
    const notes = parsed.tracks[0].notes;
    expect(notes).toHaveLength(2);
    expect(notes[0].startBeat).toBe(0);
    expect(notes[0].velocity).toBe(1);
    expect(notes[0].lengthBeats).toBeGreaterThan(0);
    expect(notes[0].id).toBeTruthy();
  });
});
