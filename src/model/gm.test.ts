// The General MIDI table is data, and data rots one rename at a time — so
// these tests hold every entry to the live voice catalog, the same way the
// idea helper's recipes are held to it. A voice renamed or removed must fail
// here, not silently strand imported songs on a voice that no longer exists.

import { describe, expect, it } from 'vitest';
import {
  mappedMelodicVoices,
  mappedPercussionVoices,
  voiceForPercussion,
  voiceForProgram,
} from './gm';
import { getVoice, isPitched } from './voices';

describe('General MIDI mapping', () => {
  it('sends every instrument somewhere real, except the sound-effects block', () => {
    for (let program = 0; program < 128; program++) {
      const voiceId = voiceForProgram(program);
      if (program >= 120) {
        // Fret noise, seashore, helicopter, gunshot: no honest home.
        expect(voiceId).toBeNull();
      } else {
        expect(voiceId, `program ${program}`).not.toBeNull();
        expect(getVoice(voiceId!), `program ${program} -> ${voiceId}`).toBeDefined();
      }
    }
  });

  it('lands the everyday pop-song instruments where a child would expect', () => {
    expect(voiceForProgram(0)).toBe('piano'); // acoustic grand
    expect(voiceForProgram(25)).toBe('guitar'); // steel guitar
    expect(voiceForProgram(32)).toBe('upright'); // acoustic bass
    expect(voiceForProgram(33)).toBe('bass'); // electric bass
    expect(voiceForProgram(48)).toBe('strings'); // string ensemble
    expect(voiceForProgram(89)).toBe('strings'); // warm pad
    expect(voiceForProgram(11)).toBe('vibraphone');
    expect(voiceForProgram(13)).toBe('xylophone');
  });

  it('maps the whole defined percussion range, with the few honest gaps', () => {
    const allowedGaps = new Set([71, 72, 78, 79]); // whistles and cuica
    for (let note = 35; note <= 81; note++) {
      const voiceId = voiceForPercussion(note);
      if (allowedGaps.has(note)) {
        expect(voiceId, `note ${note}`).toBeNull();
      } else {
        expect(voiceId, `note ${note}`).not.toBeNull();
        const voice = getVoice(voiceId!);
        expect(voice, `note ${note} -> ${voiceId}`).toBeDefined();
        // A percussion note must land on a drum: a pitched voice would demand
        // a pitch these notes don't carry.
        expect(isPitched(voice), `note ${note} -> ${voiceId}`).toBe(false);
      }
    }
    expect(voiceForPercussion(34)).toBeNull(); // outside the defined range
    expect(voiceForPercussion(82)).toBeNull();
  });

  it('names only voices the catalog still has', () => {
    for (const voiceId of [...mappedMelodicVoices(), ...mappedPercussionVoices()]) {
      expect(getVoice(voiceId), voiceId).toBeDefined();
    }
  });
});
