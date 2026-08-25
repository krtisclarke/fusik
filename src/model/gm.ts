// General MIDI → this app's voices. Pure reference data.
//
// A MIDI file names its instruments from one universal numbered list (General
// MIDI, fixed since 1991): 128 melodic instruments, plus a percussion channel
// where each note number is a fixed drum. This file is the many-to-few table
// from that list onto the voices this app actually has.
//
// Collapsing is the point, not a shortcut. GM's 128 exists so studio gear can
// interoperate — eight nearly-identical pianos, eight organs, eight synth
// pads. A child can't judge between those and shouldn't be asked to; what
// they need is that a piano part arrives on the Piano and a bass part lands
// on a bass. Where an instrument has no honest home here (a distorted guitar,
// a helicopter), the nearest voice that carries the tune stands in — and
// every imported row keeps the app's instrument picker, so any stand-in is
// one click from changed.
//
// Kept as data rather than clever code so a test can hold every entry to the
// voice catalog: a renamed voice must not leave imports pointing at nothing.

/** Melodic buckets: [firstProgram, lastProgram, voiceId] — inclusive, 0-based. */
const MELODIC_BUCKETS: [number, number, string][] = [
  [0, 7, 'piano'],        // pianos, of which GM has eight
  [8, 10, 'bells'],       // celesta, glockenspiel, music box
  [11, 11, 'vibraphone'],
  [12, 12, 'marimba'],
  [13, 13, 'xylophone'],
  [14, 14, 'bells'],      // tubular bells
  [15, 15, 'piano'],      // dulcimer: struck strings
  [16, 23, 'synth'],      // organs and accordions: held keyboard notes
  [24, 25, 'guitar'],     // acoustic guitars
  [26, 31, 'guitar'],     // electric guitars — the plucked shape still carries
  [32, 32, 'upright'],    // acoustic bass
  [33, 39, 'bass'],       // electric and synth basses
  [40, 44, 'strings'],    // solo strings, bowed
  [45, 45, 'guitar'],     // pizzicato strings: plucked
  [46, 46, 'bells'],      // harp: plucked and ringing
  [47, 47, 'bassdrum'],   // timpani: a pitched drum, honestly a drum here
  [48, 52, 'strings'],    // string ensembles and synth strings
  [53, 55, 'strings'],    // choir and voice: a sustained wash
  [56, 63, 'synth'],      // brass
  [64, 71, 'synth'],      // saxes and reeds
  [72, 79, 'synth'],      // flutes, recorders, whistles
  [80, 87, 'synth'],      // synth leads
  [88, 95, 'strings'],    // synth pads: sustained washes
  [96, 103, 'synth'],     // synth effects
  [104, 107, 'guitar'],   // sitar, banjo, shamisen, koto: plucked strings
  [108, 108, 'marimba'],  // kalimba
  [109, 109, 'synth'],    // bagpipe
  [110, 110, 'strings'],  // fiddle
  [111, 111, 'synth'],    // shanai
  [112, 112, 'bells'],    // tinkle bell
  [113, 113, 'agogo'],
  [114, 114, 'marimba'],  // steel drums
  [115, 115, 'perc'],     // woodblock
  [116, 116, 'bassdrum'], // taiko
  [117, 117, 'tom'],      // melodic tom
  [118, 118, 'kick'],     // synth drum
  [119, 119, 'crash'],    // reverse cymbal
  // 120-127 are sound effects — fret noise, seashore, helicopter, gunshot.
  // No voice is an honest home for those; their notes are left out, counted.
];

/**
 * The app voice a GM melodic program lands on, or null for the sound-effects
 * block at the top of the list (left out rather than turned into noise).
 * Note the target may be a drum voice (timpani, taiko): the importer turns
 * those notes into drum blocks, which is what the instrument is.
 */
export function voiceForProgram(program: number): string | null {
  for (const [lo, hi, voice] of MELODIC_BUCKETS) {
    if (program >= lo && program <= hi) return voice;
  }
  return null;
}

/**
 * GM percussion: on channel 10, the note number *is* the drum. 35-81 is the
 * defined range; null entries are the handful with no honest stand-in (the
 * cuica's rising whine, the long whistle) — left out rather than faked.
 */
const PERCUSSION: Record<number, string | null> = {
  35: 'bassdrum', // acoustic bass drum
  36: 'kick',
  37: 'rim',      // side stick
  38: 'snare',
  39: 'clap',
  40: 'snare',    // electric snare
  41: 'tomlow',   // low floor tom
  42: 'hihat',    // closed hi-hat
  43: 'tomlow',   // high floor tom
  44: 'hihat',    // pedal hi-hat
  45: 'tomlow',   // low tom
  46: 'openhat',  // open hi-hat
  47: 'tom',      // low-mid tom
  48: 'tom',      // hi-mid tom
  49: 'crash',
  50: 'tom',      // high tom
  51: 'ride',
  52: 'crash',    // china cymbal
  53: 'ride',     // ride bell
  54: 'tambourine',
  55: 'crash',    // splash
  56: 'cowbell',
  57: 'crash',    // crash 2
  58: 'perc',     // vibraslap: a rattle, wood block is the nearest dry hit
  59: 'ride',     // ride 2
  60: 'bongo',    // high bongo
  61: 'bongolow', // low bongo
  62: 'conga',    // mute high conga
  63: 'conga',    // open high conga
  64: 'conga',    // low conga
  65: 'tom',      // high timbale
  66: 'tomlow',   // low timbale
  67: 'agogo',    // high agogo
  68: 'agogo',    // low agogo
  69: 'shaker',   // cabasa
  70: 'shaker',   // maracas
  71: null,       // short whistle
  72: null,       // long whistle
  73: 'perc',     // short guiro
  74: 'perc',     // long guiro
  75: 'claves',
  76: 'perc',     // high wood block
  77: 'perc',     // low wood block
  78: null,       // mute cuica
  79: null,       // open cuica
  80: 'triangle', // mute triangle
  81: 'triangle', // open triangle
};

/** The drum voice a GM percussion note lands on, or null to leave it out. */
export function voiceForPercussion(note: number): string | null {
  return PERCUSSION[note] ?? null;
}

/** Every GM program the mapping sends somewhere (for tests). */
export function mappedMelodicVoices(): Set<string> {
  return new Set(MELODIC_BUCKETS.map(([, , voice]) => voice));
}

/** Every drum voice the percussion table names (for tests). */
export function mappedPercussionVoices(): Set<string> {
  return new Set(Object.values(PERCUSSION).filter((v): v is string => v != null));
}
