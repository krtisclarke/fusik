import { describe, it, expect } from 'vitest';
import { serializeProject, parseProject, ProjectLoadError } from './serialization';
import { createDefaultProject, createNote, addNote, createTrackForVoice, addTrack } from './project';
import { PROJECT_FORMAT_VERSION } from './types';

const sec = (p: ReturnType<typeof createDefaultProject>) => p.sections[0].id;

describe('project serialization', () => {
  it('round-trips a project exactly', () => {
    let project = createDefaultProject('Test Song');
    project = addNote(project, project.tracks[0].id, createNote(sec(project), 0, 1, 0.9));
    project = addNote(project, project.tracks[0].id, createNote(sec(project), 2, 1, 0.5));

    const restored = parseProject(serializeProject(project));
    expect(restored).toEqual(project);
  });

  it('produces human-readable JSON', () => {
    const json = serializeProject(createDefaultProject());
    expect(json).toContain('\n'); // pretty-printed
    expect(JSON.parse(json).formatVersion).toBe(PROJECT_FORMAT_VERSION);
  });

  it('round-trips a melodic instrument track with pitched notes', () => {
    let project = createDefaultProject('Tune');
    const piano = createTrackForVoice('piano');
    project = addTrack(project, piano);
    project = addNote(project, piano.id, createNote(sec(project), 0, 1, 0.8, 67));
    project = addNote(project, piano.id, createNote(sec(project), 1, 2, 0.6, 72));

    const restored = parseProject(serializeProject(project));
    expect(restored).toEqual(project);
    const restoredPiano = restored.tracks.find((t) => t.id === piano.id)!;
    expect(restoredPiano.type).toBe('instrument');
    expect(restoredPiano.notes.map((n) => n.pitch)).toEqual([67, 72]);
  });
});

describe('opening format-1 files (before sections existed)', () => {
  it('migrates the whole song into one part', () => {
    const v1 = JSON.stringify({
      formatVersion: 1,
      name: 'Old Song',
      bpm: 100,
      lengthBars: 8,
      tracks: [
        {
          id: 'trk_1',
          name: 'Kick',
          instrument: { voiceId: 'kick', params: {} },
          notes: [
            { id: 'note_1', startBeat: 0, lengthBeats: 1, velocity: 0.8, params: {} },
            { id: 'note_2', startBeat: 2, lengthBeats: 1, velocity: 0.8, params: {} },
          ],
        },
      ],
    });
    const p = parseProject(v1);
    expect(p.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    expect(p.sections).toHaveLength(1);
    expect(p.sections[0].name).toBe('A');
    expect(p.sections[0].lengthBars).toBe(8); // the old song length
    expect(p.arrangement).toHaveLength(1);
    expect(p.arrangement[0].sectionId).toBe(p.sections[0].id);
    // every note joined the one part
    expect(p.tracks[0].notes.every((n) => n.sectionId === p.sections[0].id)).toBe(true);
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

  it('drops arrangement slots pointing at missing parts, and never ends up empty', () => {
    const parsed = parseProject(
      JSON.stringify({
        formatVersion: 2,
        sections: [{ id: 'sec_a', name: 'A', lengthBars: 4, color: '#fff' }],
        arrangement: [
          { id: 'arr_1', sectionId: 'sec_a' },
          { id: 'arr_2', sectionId: 'sec_GONE' },
        ],
        tracks: [],
      }),
    );
    expect(parsed.arrangement).toHaveLength(1);
    expect(parsed.arrangement[0].sectionId).toBe('sec_a');
  });

  it('rebuilds a missing arrangement from the parts list', () => {
    const parsed = parseProject(
      JSON.stringify({
        formatVersion: 2,
        sections: [
          { id: 'sec_a', name: 'A', lengthBars: 4, color: '#fff' },
          { id: 'sec_b', name: 'B', lengthBars: 2, color: '#fff' },
        ],
        tracks: [],
      }),
    );
    expect(parsed.arrangement.map((e) => e.sectionId)).toEqual(['sec_a', 'sec_b']);
  });

  it('reassigns notes pointing at a missing part to the first part', () => {
    const parsed = parseProject(
      JSON.stringify({
        formatVersion: 2,
        sections: [{ id: 'sec_a', name: 'A', lengthBars: 4, color: '#fff' }],
        arrangement: [{ id: 'arr_1', sectionId: 'sec_a' }],
        tracks: [
          {
            instrument: { voiceId: 'kick' },
            notes: [{ id: 'note_1', sectionId: 'sec_GONE', startBeat: 0 }],
          },
        ],
      }),
    );
    expect(parsed.tracks[0].notes[0].sectionId).toBe('sec_a');
  });
});

describe('repairing broken ids and unreachable parts', () => {
  it('re-ids duplicate arrangement slots so removing one does not remove its twin', () => {
    // Slots are removed by id. Two slots sharing an id would vanish together —
    // and if that emptied the song, the whole project would go with it.
    const parsed = parseProject(
      JSON.stringify({
        formatVersion: 2,
        sections: [{ id: 'sec_a', name: 'A', lengthBars: 4, color: '#fff' }],
        arrangement: [
          { id: 'arr_dup', sectionId: 'sec_a' },
          { id: 'arr_dup', sectionId: 'sec_a' },
        ],
        tracks: [],
      }),
    );
    expect(parsed.arrangement).toHaveLength(2);
    expect(parsed.arrangement[0].id).not.toBe(parsed.arrangement[1].id);
  });

  it('re-ids duplicate parts so they can be told apart', () => {
    const parsed = parseProject(
      JSON.stringify({
        formatVersion: 2,
        sections: [
          { id: 'sec_dup', name: 'A', lengthBars: 4, color: '#fff' },
          { id: 'sec_dup', name: 'B', lengthBars: 2, color: '#fff' },
        ],
        arrangement: [],
        tracks: [],
      }),
    );
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[0].id).not.toBe(parsed.sections[1].id);
    // and each one still has a slot in the song
    expect(new Set(parsed.arrangement.map((e) => e.sectionId)).size).toBe(2);
  });

  it('re-ids duplicate blocks — selection and sound edits address blocks by id', () => {
    const parsed = parseProject(
      JSON.stringify({
        formatVersion: 2,
        sections: [{ id: 'sec_a', name: 'A', lengthBars: 4, color: '#fff' }],
        arrangement: [{ id: 'arr_1', sectionId: 'sec_a' }],
        tracks: [
          {
            instrument: { voiceId: 'kick' },
            notes: [
              { id: 'note_dup', sectionId: 'sec_a', startBeat: 0 },
              { id: 'note_dup', sectionId: 'sec_a', startBeat: 2 },
            ],
          },
        ],
      }),
    );
    const ids = parsed.tracks[0].notes.map((n) => n.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('gives a slot to a part the arrangement never mentions, so it can be reached', () => {
    const parsed = parseProject(
      JSON.stringify({
        formatVersion: 2,
        sections: [
          { id: 'sec_a', name: 'A', lengthBars: 4, color: '#fff' },
          { id: 'sec_b', name: 'B', lengthBars: 2, color: '#fff' },
        ],
        arrangement: [{ id: 'arr_1', sectionId: 'sec_a' }],
        tracks: [],
      }),
    );
    expect(parsed.arrangement.map((e) => e.sectionId)).toEqual(['sec_a', 'sec_b']);
  });

  it('leaves a format-2 block with no sound of its own alone', () => {
    // Format 1 kept the sound on the track, so loading one copies it onto the
    // blocks. Doing that to a format-2 file would undo a child's Reset every
    // time the song was reopened.
    const parsed = parseProject(
      JSON.stringify({
        formatVersion: 2,
        sections: [{ id: 'sec_a', name: 'A', lengthBars: 4, color: '#fff' }],
        arrangement: [{ id: 'arr_1', sectionId: 'sec_a' }],
        tracks: [
          {
            instrument: { voiceId: 'kick', params: { decay: 0.9 } },
            notes: [{ id: 'note_1', sectionId: 'sec_a', startBeat: 0, params: {} }],
          },
        ],
      }),
    );
    expect(parsed.tracks[0].notes[0].params).toEqual({});
  });

  it('still moves a format-1 track sound onto its blocks', () => {
    const parsed = parseProject(
      JSON.stringify({
        formatVersion: 1,
        lengthBars: 4,
        tracks: [
          {
            instrument: { voiceId: 'kick', params: { decay: 0.9 } },
            notes: [{ id: 'note_1', startBeat: 0, params: {} }],
          },
        ],
      }),
    );
    expect(parsed.tracks[0].notes[0].params).toEqual({ decay: 0.9 });
  });
});
