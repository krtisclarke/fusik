// The idea helper: for the child who opens the app and freezes.
//
// Summoned by the 💡 button (never offers itself — the walkthrough teaches the
// app; this one un-sticks a song). It asks what kind of song today's is, then
// coaches the *order of building* — mood and speed, then a beat, then the low
// notes, then a tune, then a second part — by pointing at the real controls
// with the same cards and highlights the walkthrough uses, each step ticking
// when the child actually does it.
//
// A line this helper never crosses, from the brief: **it never makes music.**
// It doesn't place a note, set a tempo, or change a mood — it points at the
// control and asks. Its tips teach conventions in words ("in rock the kick and
// snare take turns") the way a person would, and every single sound in the
// song stays the child's own doing.
//
// Everything here is plain data and pure functions, like the walkthrough it
// rides on. Recipes name instruments by their real labels; a test holds those
// labels to the catalog so a renamed voice can't quietly point at nothing.

import type { TourStep, TourContext, TourProgress } from './tour';
import { moreThan } from './tour';

export interface Recipe {
  id: string;
  /** Shown on the choice button, emoji and all. */
  label: string;
  /** The Mood the song wants, as the scale id + the label the box shows. */
  scaleId: string;
  moodLabel: string;
  /** Around this speed, and the word for how it should feel. */
  bpm: number;
  feel: string;
  /** Drum voices to reach for, by their library labels. */
  drums: [string, string, string];
  /** One convention, taught in words. */
  beatTip: string;
  /** The low end and the tune on top, by their library labels. */
  bass: string;
  tune: string;
}

export const RECIPES: Recipe[] = [
  // ---- feelings -----------------------------------------------------------
  { id: 'happy', label: '😄 Happy', scaleId: 'majorPentatonic', moodLabel: 'Happy', bpm: 120, feel: 'bouncy', drums: ['Kick', 'Clap', 'Tambourine'], beatTip: 'claps love beats 2 and 4', bass: 'Bass', tune: 'Marimba' },
  { id: 'chill', label: '😌 Chill', scaleId: 'major', moodLabel: 'Happy — more notes', bpm: 85, feel: 'laid-back', drums: ['Kick', 'Rim', 'Shaker'], beatTip: 'soft and steady — less is more', bass: 'Upright Bass', tune: 'Vibraphone' },
  { id: 'spooky', label: '👻 Spooky', scaleId: 'minor', moodLabel: 'Sad — more notes', bpm: 95, feel: 'creepy', drums: ['Big Drum', 'Rim', 'Triangle'], beatTip: 'leave empty space — quiet is spooky', bass: 'Upright Bass', tune: 'Bells' },
  { id: 'epic', label: '🌋 Epic', scaleId: 'minor', moodLabel: 'Sad — more notes', bpm: 140, feel: 'huge', drums: ['Big Drum', 'Snare', 'Crash'], beatTip: 'big drums, big hits', bass: 'Bass', tune: 'Synth' },
  { id: 'silly', label: '🤪 Silly', scaleId: 'majorPentatonic', moodLabel: 'Happy', bpm: 160, feel: 'bonkers', drums: ['Bongo', 'Cowbell', 'Agogo'], beatTip: 'the cowbell is never wrong', bass: 'Bass', tune: 'Xylophone' },
  { id: 'sad', label: '🌧️ Sad', scaleId: 'minorPentatonic', moodLabel: 'Sad', bpm: 80, feel: 'gentle', drums: ['Kick', 'Rim', 'Hi-Hat'], beatTip: 'slow and gentle, with room to breathe', bass: 'Upright Bass', tune: 'Piano' },
  // ---- styles -------------------------------------------------------------
  { id: 'rock', label: '🤘 Rock', scaleId: 'majorPentatonic', moodLabel: 'Happy', bpm: 130, feel: 'driving', drums: ['Kick', 'Snare', 'Crash'], beatTip: 'the kick and snare take turns — kick, snare, kick, snare', bass: 'Bass', tune: 'Synth' },
  { id: 'pop', label: '🎤 Pop', scaleId: 'majorPentatonic', moodLabel: 'Happy', bpm: 118, feel: 'catchy', drums: ['Kick', 'Clap', 'Hi-Hat'], beatTip: 'a clap on 2 and 4 is the oldest trick in pop', bass: 'Bass', tune: 'Piano' },
  { id: 'hiphop', label: '🧢 Hip-hop', scaleId: 'minorPentatonic', moodLabel: 'Sad', bpm: 90, feel: 'heavy', drums: ['Kick', 'Snare', 'Hi-Hat'], beatTip: 'let the hi-hats tick fast between the big hits', bass: 'Bass', tune: 'Piano' },
  { id: 'dance', label: '🕺 Dance', scaleId: 'minorPentatonic', moodLabel: 'Sad', bpm: 126, feel: 'pumping', drums: ['Kick', 'Open Hat', 'Clap'], beatTip: 'a kick on every beat is the dance-floor heartbeat', bass: 'Bass', tune: 'Synth' },
  { id: 'latin', label: '🌴 Latin', scaleId: 'majorPentatonic', moodLabel: 'Happy', bpm: 110, feel: 'swaying', drums: ['Conga', 'Bongo', 'Claves'], beatTip: 'congas and bongos love talking to each other', bass: 'Upright Bass', tune: 'Marimba' },
  { id: 'country', label: '🤠 Country', scaleId: 'major', moodLabel: 'Happy — more notes', bpm: 104, feel: 'rolling', drums: ['Kick', 'Rim', 'Tambourine'], beatTip: 'a steady tick-tock, like horse hooves', bass: 'Upright Bass', tune: 'Piano' },
];

const VIBES = ['happy', 'chill', 'spooky', 'epic', 'silly', 'sad'];
const GENRES = ['rock', 'pop', 'hiphop', 'dance', 'latin', 'country'];

const recipeById = new Map(RECIPES.map((r) => [r.id, r]));

/** The opening question — what startHelper puts on screen. */
export const HELPER_START: TourStep = {
  id: 'helper-start',
  title: 'Stuck? Let’s find an idea',
  body: 'Every song starts somewhere. What kind are we making today?',
  choices: [
    { id: 'vibe', label: '🎨 I want a feeling' },
    { id: 'genre', label: '🎸 I want a style' },
    { id: 'surprise', label: '🎲 Surprise me!' },
  ],
};

const pickStep = (id: string, title: string, body: string, ids: string[]): TourStep => ({
  id,
  title,
  body,
  choices: ids.map((rid) => {
    const r = recipeById.get(rid)!;
    return { id: r.id, label: r.label };
  }),
});

/** How close the tempo has to land. Nobody is asked to hit a number exactly. */
const BPM_SLACK = 15;

function recipeSteps(r: Recipe): TourStep[] {
  const goalScale = (now: TourContext): TourProgress => ({
    done: now.scaleId === r.scaleId ? 1 : 0,
    total: 1,
  });
  const goalBpm = (now: TourContext): TourProgress => ({
    done: Math.abs(now.bpm - r.bpm) <= BPM_SLACK ? 1 : 0,
    total: 1,
  });
  return [
    {
      id: `${r.id}-mood`,
      title: 'Set the mood',
      body: `In the *Mood* box up top, pick *${r.moodLabel}*. That chooses the notes the whole song is built from.`,
      target: 'mood',
      goal: goalScale,
    },
    {
      id: `${r.id}-tempo`,
      title: 'Set the speed',
      body: `Take *Tempo* to about *${r.bpm}* — that's where ${r.label.replace(/^\S+ /, '').toLowerCase()} songs feel ${r.feel}.`,
      target: 'tempo',
      goal: goalBpm,
    },
    {
      id: `${r.id}-beat`,
      title: 'Start with the beat',
      body: `From the list on the left, drag in a *${r.drums[0]}* and put some beats down. A tip: ${r.beatTip}.`,
      target: 'library',
      goal: (now, start) => moreThan(now.drumNotes, start.drumNotes, 3),
    },
    {
      id: `${r.id}-layer`,
      title: 'Make the beat talk',
      body: `Add a second drum — try the *${r.drums[1]}* or the *${r.drums[2]}* — and put its beats in the gaps.`,
      target: 'library',
      goal: (now, start) => moreThan(now.drumRows, start.drumRows, 1),
    },
    {
      id: `${r.id}-bass`,
      title: 'Now the low end',
      body: `Open *Bass* and drag the *${r.bass}* in — a few long, low notes under the beat make it feel real.`,
      target: 'library',
      goal: (now, start) => moreThan(now.instrumentTracks, start.instrumentTracks, 1),
    },
    {
      id: `${r.id}-tune`,
      title: 'The tune on top',
      body: `Time for the melody: try the *${r.tune}*. Place notes on its grid — every square fits the mood you picked.`,
      target: 'library',
      goal: (now, start) => moreThan(now.instrumentNotes, start.instrumentNotes, 3),
    },
    {
      id: `${r.id}-part`,
      title: 'Give it a chorus',
      body: 'Real songs change halfway. Press *＋ New part* and make something different in it — then play the whole *Song*.',
      target: 'parts',
      goal: (now, start) => moreThan(now.parts, start.parts, 1),
    },
    {
      id: `${r.id}-done`,
      title: "You're rolling!",
      body: 'That’s a real song shape — keep stacking, or press *💡* any time for a fresh idea.',
      button: 'Finish',
    },
  ];
}

/**
 * The steps that follow an answer. A branch answer opens the next question; a
 * recipe answer opens its coaching; "surprise" rolls a recipe with the random
 * the caller hands in (injected so tests can pin it).
 */
export function nextHelperSteps(answerId: string, random: () => number): TourStep[] | null {
  if (answerId === 'vibe') {
    return [pickStep('helper-vibe', 'Pick your feeling', 'What should this song feel like?', VIBES)];
  }
  if (answerId === 'genre') {
    return [pickStep('helper-genre', 'Pick your style', 'What kind of music are we in the mood for?', GENRES)];
  }
  if (answerId === 'surprise') {
    const all = RECIPES;
    const r = all[Math.min(all.length - 1, Math.floor(random() * all.length))];
    return recipeSteps(r);
  }
  const recipe = recipeById.get(answerId);
  return recipe ? recipeSteps(recipe) : null;
}
