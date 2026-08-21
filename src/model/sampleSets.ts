// GENERATED FILE — do not edit by hand.
// Rebuild with: node tools/build-samples.mjs
//
// Which recording covers which note and which strength, for every sampled
// voice. The audio lives in public/samples/<id>/; this is only the map.
// Provenance and licensing for every file: docs/asset-manifest.json.

/** One recording, and the notes and strengths it covers. */
export interface SampleRegion {
  /** File name under `samples/<setId>/`. */
  f: string;
  /** The MIDI note this recording actually is. Playback is stretched from here. */
  root: number;
  /** Strength band this recording covers, 0..1 inclusive. */
  lo: number;
  hi: number;
  /** Tuning correction in cents, measured by the library's own authors. */
  cents: number;
  /** Which take this is, where a note has several. Alternating them stops
   *  repeated hits sounding bit-for-bit identical. */
  rr: number;
}

export interface SampleSet {
  id: string;
  /** The longest recording in the set, in seconds. */
  seconds: number;
  regions: SampleRegion[];
}

export const SAMPLE_SETS: SampleSet[] = [
  {
    id: 'piano',
    seconds: 4,
    regions: [
    { f: '45_0_1.m4a', root: 45, lo: 0, hi: 0.429688, cents: 5, rr: 1 },
    { f: '45_55_1.m4a', root: 45, lo: 0.429688, hi: 0.835938, cents: 0, rr: 1 },
    { f: '45_107_1.m4a', root: 45, lo: 0.835938, hi: 1, cents: 0, rr: 1 },
    { f: '48_0_1.m4a', root: 48, lo: 0, hi: 0.429688, cents: 8, rr: 1 },
    { f: '48_55_1.m4a', root: 48, lo: 0.429688, hi: 0.835938, cents: -12, rr: 1 },
    { f: '48_107_1.m4a', root: 48, lo: 0.835938, hi: 1, cents: -10, rr: 1 },
    { f: '50_0_1.m4a', root: 50, lo: 0, hi: 0.429688, cents: 5, rr: 1 },
    { f: '50_55_1.m4a', root: 50, lo: 0.429688, hi: 0.835938, cents: -3, rr: 1 },
    { f: '50_107_1.m4a', root: 50, lo: 0.835938, hi: 1, cents: -4, rr: 1 },
    { f: '52_0_1.m4a', root: 52, lo: 0, hi: 0.429688, cents: 5, rr: 1 },
    { f: '52_55_1.m4a', root: 52, lo: 0.429688, hi: 0.835938, cents: 0, rr: 1 },
    { f: '52_107_1.m4a', root: 52, lo: 0.835938, hi: 1, cents: -2, rr: 1 },
    { f: '54_0_1.m4a', root: 54, lo: 0, hi: 0.429688, cents: 1, rr: 1 },
    { f: '54_55_1.m4a', root: 54, lo: 0.429688, hi: 0.835938, cents: -4, rr: 1 },
    { f: '54_107_1.m4a', root: 54, lo: 0.835938, hi: 1, cents: -5, rr: 1 },
    { f: '56_0_1.m4a', root: 56, lo: 0, hi: 0.429688, cents: 0, rr: 1 },
    { f: '56_55_1.m4a', root: 56, lo: 0.429688, hi: 0.835938, cents: -4, rr: 1 },
    { f: '56_107_1.m4a', root: 56, lo: 0.835938, hi: 1, cents: -5, rr: 1 },
    { f: '58_0_1.m4a', root: 58, lo: 0, hi: 0.429688, cents: 4, rr: 1 },
    { f: '58_55_1.m4a', root: 58, lo: 0.429688, hi: 0.835938, cents: -1, rr: 1 },
    { f: '58_107_1.m4a', root: 58, lo: 0.835938, hi: 1, cents: -7, rr: 1 },
    { f: '60_0_1.m4a', root: 60, lo: 0, hi: 0.429688, cents: 4, rr: 1 },
    { f: '60_55_1.m4a', root: 60, lo: 0.429688, hi: 0.835938, cents: 0, rr: 1 },
    { f: '60_107_1.m4a', root: 60, lo: 0.835938, hi: 1, cents: -3, rr: 1 },
    { f: '62_0_1.m4a', root: 62, lo: 0, hi: 0.429688, cents: 7, rr: 1 },
    { f: '62_55_1.m4a', root: 62, lo: 0.429688, hi: 0.835938, cents: 0, rr: 1 },
    { f: '62_107_1.m4a', root: 62, lo: 0.835938, hi: 1, cents: -2, rr: 1 },
    { f: '64_0_1.m4a', root: 64, lo: 0, hi: 0.429688, cents: -1, rr: 1 },
    { f: '64_55_1.m4a', root: 64, lo: 0.429688, hi: 0.835938, cents: -3, rr: 1 },
    { f: '64_107_1.m4a', root: 64, lo: 0.835938, hi: 1, cents: -3, rr: 1 },
    { f: '66_0_1.m4a', root: 66, lo: 0, hi: 0.429688, cents: 4, rr: 1 },
    { f: '66_55_1.m4a', root: 66, lo: 0.429688, hi: 0.835938, cents: 1, rr: 1 },
    { f: '66_107_1.m4a', root: 66, lo: 0.835938, hi: 1, cents: -2, rr: 1 },
    { f: '68_0_1.m4a', root: 68, lo: 0, hi: 0.429688, cents: 3, rr: 1 },
    { f: '68_55_1.m4a', root: 68, lo: 0.429688, hi: 0.835938, cents: -2, rr: 1 },
    { f: '68_107_1.m4a', root: 68, lo: 0.835938, hi: 1, cents: -5, rr: 1 },
    { f: '70_0_1.m4a', root: 70, lo: 0, hi: 0.429688, cents: 18, rr: 1 },
    { f: '70_55_1.m4a', root: 70, lo: 0.429688, hi: 0.835938, cents: -8, rr: 1 },
    { f: '70_107_1.m4a', root: 70, lo: 0.835938, hi: 1, cents: -13, rr: 1 },
    { f: '72_0_1.m4a', root: 72, lo: 0, hi: 0.429688, cents: 4, rr: 1 },
    { f: '72_55_1.m4a', root: 72, lo: 0.429688, hi: 0.835938, cents: 1, rr: 1 },
    { f: '72_107_1.m4a', root: 72, lo: 0.835938, hi: 1, cents: -2, rr: 1 },
    { f: '74_0_1.m4a', root: 74, lo: 0, hi: 0.429688, cents: 1, rr: 1 },
    { f: '74_55_1.m4a', root: 74, lo: 0.429688, hi: 0.835938, cents: -3, rr: 1 },
    { f: '74_107_1.m4a', root: 74, lo: 0.835938, hi: 1, cents: -8, rr: 1 },
    { f: '76_0_1.m4a', root: 76, lo: 0, hi: 0.429688, cents: 3, rr: 1 },
    { f: '76_55_1.m4a', root: 76, lo: 0.429688, hi: 0.835938, cents: -1, rr: 1 },
    { f: '76_107_1.m4a', root: 76, lo: 0.835938, hi: 1, cents: -6, rr: 1 },
    { f: '78_0_1.m4a', root: 78, lo: 0, hi: 0.429688, cents: 13, rr: 1 },
    { f: '78_55_1.m4a', root: 78, lo: 0.429688, hi: 0.835938, cents: -2, rr: 1 },
    { f: '78_107_1.m4a', root: 78, lo: 0.835938, hi: 1, cents: -5, rr: 1 },
    { f: '80_0_1.m4a', root: 80, lo: 0, hi: 0.429688, cents: 0, rr: 1 },
    { f: '80_55_1.m4a', root: 80, lo: 0.429688, hi: 0.835938, cents: -13, rr: 1 },
    { f: '80_107_1.m4a', root: 80, lo: 0.835938, hi: 1, cents: -18, rr: 1 },
    { f: '82_0_1.m4a', root: 82, lo: 0, hi: 0.515625, cents: -1, rr: 1 },
    { f: '82_66_1.m4a', root: 82, lo: 0.515625, hi: 0.78125, cents: -1, rr: 1 },
    { f: '82_100_1.m4a', root: 82, lo: 0.78125, hi: 1, cents: -2, rr: 1 },
    { f: '84_0_1.m4a', root: 84, lo: 0, hi: 0.429688, cents: 0, rr: 1 },
    { f: '84_55_1.m4a', root: 84, lo: 0.429688, hi: 0.835938, cents: -1, rr: 1 },
    { f: '84_107_1.m4a', root: 84, lo: 0.835938, hi: 1, cents: -2, rr: 1 },
    { f: '87_0_1.m4a', root: 87, lo: 0, hi: 0.65625, cents: -9, rr: 1 },
    { f: '87_84_1.m4a', root: 87, lo: 0.65625, hi: 0.835938, cents: -12, rr: 1 },
    { f: '87_107_1.m4a', root: 87, lo: 0.835938, hi: 1, cents: -19, rr: 1 },
    { f: '90_0_1.m4a', root: 90, lo: 0, hi: 0.65625, cents: 0, rr: 1 },
    { f: '90_84_1.m4a', root: 90, lo: 0.65625, hi: 0.835938, cents: -4, rr: 1 },
    { f: '90_107_1.m4a', root: 90, lo: 0.835938, hi: 1, cents: -7, rr: 1 },
    { f: '93_0_1.m4a', root: 93, lo: 0, hi: 0.65625, cents: 3, rr: 1 },
    { f: '93_84_1.m4a', root: 93, lo: 0.65625, hi: 0.835938, cents: 2, rr: 1 },
    { f: '93_107_1.m4a', root: 93, lo: 0.835938, hi: 1, cents: -1, rr: 1 },
    { f: '96_0_1.m4a', root: 96, lo: 0, hi: 0.429688, cents: 0, rr: 1 },
    { f: '96_55_1.m4a', root: 96, lo: 0.429688, hi: 0.835938, cents: 1, rr: 1 },
    { f: '96_107_1.m4a', root: 96, lo: 0.835938, hi: 1, cents: 0, rr: 1 },
    ],
  },
  {
    id: 'bells',
    seconds: 3.5,
    regions: [
    { f: '79_0_1.m4a', root: 79, lo: 0, hi: 0.335938, cents: -8, rr: 1 },
    { f: '79_43_1.m4a', root: 79, lo: 0.335938, hi: 0.835938, cents: -8, rr: 1 },
    { f: '79_107_1.m4a', root: 79, lo: 0.835938, hi: 1, cents: -8, rr: 1 },
    { f: '84_0_1.m4a', root: 84, lo: 0, hi: 0.335938, cents: -12, rr: 1 },
    { f: '84_43_1.m4a', root: 84, lo: 0.335938, hi: 0.835938, cents: -12, rr: 1 },
    { f: '84_107_1.m4a', root: 84, lo: 0.835938, hi: 1, cents: -12, rr: 1 },
    { f: '91_0_1.m4a', root: 91, lo: 0, hi: 0.335938, cents: -12, rr: 1 },
    { f: '91_43_1.m4a', root: 91, lo: 0.335938, hi: 0.835938, cents: -12, rr: 1 },
    { f: '91_107_1.m4a', root: 91, lo: 0.835938, hi: 1, cents: -12, rr: 1 },
    { f: '96_0_1.m4a', root: 96, lo: 0, hi: 0.335938, cents: -16, rr: 1 },
    { f: '96_43_1.m4a', root: 96, lo: 0.335938, hi: 0.835938, cents: -15, rr: 1 },
    { f: '96_107_1.m4a', root: 96, lo: 0.835938, hi: 1, cents: -15, rr: 1 },
    { f: '103_0_1.m4a', root: 103, lo: 0, hi: 0.507813, cents: -16, rr: 1 },
    { f: '103_65_1.m4a', root: 103, lo: 0.507813, hi: 1, cents: -16, rr: 1 },
    { f: '108_0_1.m4a', root: 108, lo: 0, hi: 0.335938, cents: -24, rr: 1 },
    { f: '108_43_1.m4a', root: 108, lo: 0.335938, hi: 0.835938, cents: -24, rr: 1 },
    { f: '108_107_1.m4a', root: 108, lo: 0.835938, hi: 1, cents: -24, rr: 1 },
    ],
  },
  {
    id: 'kick',
    seconds: 2,
    regions: [
    { f: '60_0_1.m4a', root: 60, lo: 0, hi: 0.429688, cents: 0, rr: 1 },
    { f: '60_0_2.m4a', root: 60, lo: 0, hi: 0.429688, cents: 0, rr: 2 },
    { f: '60_55_1.m4a', root: 60, lo: 0.429688, hi: 0.65625, cents: 0, rr: 1 },
    { f: '60_55_2.m4a', root: 60, lo: 0.429688, hi: 0.65625, cents: 0, rr: 2 },
    { f: '60_84_1.m4a', root: 60, lo: 0.65625, hi: 0.835938, cents: 0, rr: 1 },
    { f: '60_84_2.m4a', root: 60, lo: 0.65625, hi: 0.835938, cents: 0, rr: 2 },
    { f: '60_107_1.m4a', root: 60, lo: 0.835938, hi: 1, cents: 0, rr: 1 },
    { f: '60_107_2.m4a', root: 60, lo: 0.835938, hi: 1, cents: 0, rr: 2 },
    ],
  },
  {
    id: 'snare',
    seconds: 1.2,
    regions: [
    { f: '60_0_1.m4a', root: 60, lo: 0, hi: 0.375, cents: 0, rr: 1 },
    { f: '60_0_2.m4a', root: 60, lo: 0, hi: 0.375, cents: 0, rr: 2 },
    { f: '60_48_1.m4a', root: 60, lo: 0.375, hi: 0.570313, cents: 0, rr: 1 },
    { f: '60_48_2.m4a', root: 60, lo: 0.375, hi: 0.570313, cents: 0, rr: 2 },
    { f: '60_73_1.m4a', root: 60, lo: 0.570313, hi: 0.734375, cents: 0, rr: 1 },
    { f: '60_73_2.m4a', root: 60, lo: 0.570313, hi: 0.734375, cents: 0, rr: 2 },
    { f: '60_94_1.m4a', root: 60, lo: 0.734375, hi: 0.867188, cents: 0, rr: 1 },
    { f: '60_94_2.m4a', root: 60, lo: 0.734375, hi: 0.867188, cents: 0, rr: 2 },
    { f: '60_111_1.m4a', root: 60, lo: 0.867188, hi: 1, cents: 0, rr: 1 },
    { f: '60_111_2.m4a', root: 60, lo: 0.867188, hi: 1, cents: 0, rr: 2 },
    ],
  },
  {
    id: 'rim',
    seconds: 0.8,
    regions: [
    { f: '60_0_1.m4a', root: 60, lo: 0, hi: 1, cents: 0, rr: 1 },
    { f: '60_0_2.m4a', root: 60, lo: 0, hi: 1, cents: 0, rr: 2 },
    ],
  },
  {
    id: 'hihat',
    seconds: 1,
    regions: [
    { f: '60_0_1.m4a', root: 60, lo: 0, hi: 0.429688, cents: 0, rr: 1 },
    { f: '60_0_2.m4a', root: 60, lo: 0, hi: 0.429688, cents: 0, rr: 2 },
    { f: '60_55_1.m4a', root: 60, lo: 0.429688, hi: 0.65625, cents: 0, rr: 1 },
    { f: '60_55_2.m4a', root: 60, lo: 0.429688, hi: 0.65625, cents: 0, rr: 2 },
    { f: '60_84_1.m4a', root: 60, lo: 0.65625, hi: 0.835938, cents: 0, rr: 1 },
    { f: '60_84_2.m4a', root: 60, lo: 0.65625, hi: 0.835938, cents: 0, rr: 2 },
    { f: '60_107_1.m4a', root: 60, lo: 0.835938, hi: 1, cents: 0, rr: 1 },
    { f: '60_107_2.m4a', root: 60, lo: 0.835938, hi: 1, cents: 0, rr: 2 },
    ],
  },
  {
    id: 'openhat',
    seconds: 2.5,
    regions: [
    { f: '60_0_1.m4a', root: 60, lo: 0, hi: 1, cents: 0, rr: 1 },
    { f: '60_0_2.m4a', root: 60, lo: 0, hi: 1, cents: 0, rr: 2 },
    ],
  },
  {
    id: 'tom',
    seconds: 1.6,
    regions: [
    { f: '60_0_1.m4a', root: 60, lo: 0, hi: 0.515625, cents: 0, rr: 1 },
    { f: '60_0_2.m4a', root: 60, lo: 0, hi: 0.515625, cents: 0, rr: 2 },
    { f: '60_66_1.m4a', root: 60, lo: 0.515625, hi: 0.78125, cents: 0, rr: 1 },
    { f: '60_66_2.m4a', root: 60, lo: 0.515625, hi: 0.78125, cents: 0, rr: 2 },
    { f: '60_100_1.m4a', root: 60, lo: 0.78125, hi: 1, cents: 0, rr: 1 },
    { f: '60_100_2.m4a', root: 60, lo: 0.78125, hi: 1, cents: 0, rr: 2 },
    ],
  },
  {
    id: 'tomlow',
    seconds: 1.8,
    regions: [
    { f: '60_0_1.m4a', root: 60, lo: 0, hi: 0.515625, cents: 0, rr: 1 },
    { f: '60_0_2.m4a', root: 60, lo: 0, hi: 0.515625, cents: 0, rr: 2 },
    { f: '60_66_1.m4a', root: 60, lo: 0.515625, hi: 0.78125, cents: 0, rr: 1 },
    { f: '60_66_2.m4a', root: 60, lo: 0.515625, hi: 0.78125, cents: 0, rr: 2 },
    { f: '60_100_1.m4a', root: 60, lo: 0.78125, hi: 1, cents: 0, rr: 1 },
    { f: '60_100_2.m4a', root: 60, lo: 0.78125, hi: 1, cents: 0, rr: 2 },
    ],
  },
  {
    id: 'crash',
    seconds: 4,
    regions: [
    { f: '60_0_1.m4a', root: 60, lo: 0, hi: 0.429688, cents: 0, rr: 1 },
    { f: '60_55_1.m4a', root: 60, lo: 0.429688, hi: 0.65625, cents: 0, rr: 1 },
    { f: '60_84_1.m4a', root: 60, lo: 0.65625, hi: 0.835938, cents: 0, rr: 1 },
    { f: '60_107_1.m4a', root: 60, lo: 0.835938, hi: 1, cents: 0, rr: 1 },
    ],
  },
  {
    id: 'ride',
    seconds: 3,
    regions: [
    { f: '60_0_1.m4a', root: 60, lo: 0, hi: 0.515625, cents: 0, rr: 1 },
    { f: '60_66_1.m4a', root: 60, lo: 0.515625, hi: 0.78125, cents: 0, rr: 1 },
    { f: '60_100_1.m4a', root: 60, lo: 0.78125, hi: 1, cents: 0, rr: 1 },
    ],
  },
  {
    id: 'clap',
    seconds: 0.769,
    regions: [
    { f: '60_0_1.m4a', root: 60, lo: 0, hi: 1, cents: 0, rr: 1 },
    { f: '60_0_2.m4a', root: 60, lo: 0, hi: 1, cents: 0, rr: 2 },
    { f: '60_0_3.m4a', root: 60, lo: 0, hi: 1, cents: 0, rr: 3 },
    { f: '60_0_4.m4a', root: 60, lo: 0, hi: 1, cents: 0, rr: 4 },
    { f: '60_0_5.m4a', root: 60, lo: 0, hi: 1, cents: 0, rr: 5 },
    { f: '60_0_6.m4a', root: 60, lo: 0, hi: 1, cents: 0, rr: 6 },
    ],
  },
  {
    id: 'shaker',
    seconds: 0.182,
    regions: [
    { f: '60_0_1.m4a', root: 60, lo: 0, hi: 1, cents: 0, rr: 1 },
    { f: '60_0_2.m4a', root: 60, lo: 0, hi: 1, cents: 0, rr: 2 },
    { f: '60_0_3.m4a', root: 60, lo: 0, hi: 1, cents: 0, rr: 3 },
    { f: '60_0_4.m4a', root: 60, lo: 0, hi: 1, cents: 0, rr: 4 },
    ],
  },
  {
    id: 'cowbell',
    seconds: 1.151,
    regions: [
    { f: '60_0_1.m4a', root: 60, lo: 0, hi: 0.515625, cents: 0, rr: 1 },
    { f: '60_66_1.m4a', root: 60, lo: 0.515625, hi: 0.78125, cents: 0, rr: 1 },
    { f: '60_100_1.m4a', root: 60, lo: 0.78125, hi: 1, cents: 0, rr: 1 },
    ],
  },
  {
    id: 'perc',
    seconds: 0.8,
    regions: [
    { f: '60_0_1.m4a', root: 60, lo: 0, hi: 0.429688, cents: 0, rr: 1 },
    { f: '60_0_2.m4a', root: 60, lo: 0, hi: 0.429688, cents: 0, rr: 2 },
    { f: '60_0_3.m4a', root: 60, lo: 0, hi: 0.429688, cents: 0, rr: 3 },
    { f: '60_55_1.m4a', root: 60, lo: 0.429688, hi: 0.65625, cents: 0, rr: 1 },
    { f: '60_84_1.m4a', root: 60, lo: 0.65625, hi: 0.835938, cents: 0, rr: 1 },
    { f: '60_84_2.m4a', root: 60, lo: 0.65625, hi: 0.835938, cents: 0, rr: 2 },
    { f: '60_107_1.m4a', root: 60, lo: 0.835938, hi: 1, cents: 0, rr: 1 },
    ],
  },
];

const BY_ID = new Map(SAMPLE_SETS.map((s) => [s.id, s]));

export function getSampleSet(id: string): SampleSet | undefined {
  return BY_ID.get(id);
}
