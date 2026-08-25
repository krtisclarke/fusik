# Beatbox Studio — Developer Guide

This document is the map of the project: the decisions, the architecture, how
the audio engine works, the file format, and what is and isn't built yet. It is
kept in sync with the code.

---

## 1. Technology decisions

The brief asked for a Windows desktop music app for kids, with a legitimate
real-time audio engine (synthesis, effects, recording, MIDI, WAV export). The
developer works on a Mac, and values being able to run and test the app during
development. Those two facts drove the stack.

| Choice | What | Why |
| --- | --- | --- |
| **Electron** | Desktop shell (bundled Chromium) | Ships a real Windows `.exe` *and* runs on macOS for development. Bundling Chromium means audio behaves identically everywhere — no surprises from different OS webviews. |
| **Web Audio API** | The audio engine | A genuine, professional real-time engine built into the platform: sample-accurate scheduling, oscillators, filters, delay/reverb/distortion nodes, `AudioParam` automation, `getUserMedia` recording, and `OfflineAudioContext` for WAV export. Not a toy. |
| **Vite + React + TypeScript** | The UI | Fast dev loop; React suits the many interdependent panels; TypeScript keeps a growing DAW maintainable. |
| **Zustand** | App state | Tiny, unopinionated store. Keeps audio and UI decoupled without a heavy framework. |
| **Vitest** | Tests | Shares Vite's config; fast. |
| **electron-builder** | Packaging | Standard, produces NSIS installers for Windows. |

**Trade-off accepted:** an Electron app is larger (~150 MB installed) and starts
slightly slower than a hand-written native app. For a kids' creative tool this
is irrelevant next to sound quality and cross-platform development.

**Keep Electron current — this one bites.** Apple revokes the notarization of
older Electron builds. Once that happens macOS does not merely warn: it SIGKILLs
the binary on launch and XProtect deletes the app bundle from disk, with a
"malware" message that looks nothing like a version problem. Electron 31.7.7 was
revoked this way; 43.4.1 runs fine. `spctl -a -vvv node_modules/electron/dist/Electron.app`
says `notarization indicates this code has been revoked` when this is what's
happening — the fix is a newer Electron, never re-signing or disabling Gatekeeper.

**iCloud Drive damages the bundle too, separately.** This project lives in
`~/Documents`, which iCloud syncs. iCloud strips the app bundle's
`Contents/_CodeSignature` and keeps re-stamping `com.apple.FinderInfo` on the
frameworks, which breaks the signature seal (`code has no resources but
signature indicates they must be present`) and makes re-signing in place
impossible — the attribute is back before `codesign` finishes. A notarized
Electron still launches in that state, so it is survivable, but it is why the
`node_modules` folder here occasionally turns up renamed `node_modules 2`
(an iCloud sync conflict) after an `npm install`. If that happens: delete the
stray, rename it back, and `npm install` again. Moving the project out of
`~/Documents` would end this class of problem for good.

---

## 2. Architecture

Strict one-way dependency flow. Lower layers never import higher ones.

```
          ┌─────────────────────────────────────────┐
   UI  →  │  ui/ (React)   platform/ (files)         │
          └───────────────┬─────────────────────────┘
 state →  │  state/ (Zustand store, undo/redo history)│
          └───────────────┬─────────────────────────┘
 audio →  │  audio/ (AudioEngine, synth)             │
          └───────────────┬─────────────────────────┘
 model →  │  model/ (types, time math, project ops,  │
          │          serialization, voice catalog)   │
          └─────────────────────────────────────────┘
```

- **`model/`** — pure, serializable data and the operations on it. No audio, no
  DOM, no React. This is what gets saved to disk. Every edit is a pure function
  `Project → Project` (immutability makes undo trivially correct).
- **`audio/`** — the real-time engine. Reads the model, makes sound. Knows
  nothing about React.
- **`state/`** — the Zustand store ties the model, the undo history, and the
  engine together. It is the only thing the UI talks to.
- **`ui/`** — React components. Read from the store, dispatch actions.
- **`platform/`** — save/open, and reading the shipped instrument recordings,
  abstracted over "desktop (Electron)" vs "browser (download/upload)" so the app
  runs in both.
- **`public/samples/`** — the instrument recordings themselves, and
  **`tools/`** — the build-time only script that produced them from the sample
  library. Neither is imported by the app; see §5.
- **`electron/`** — the desktop shell (plain CommonJS, no build step). Opens a
  window, provides native Save/Open dialogs over a locked-down IPC bridge, and
  loads the dev server (development) or the built files (production).

### Why the app runs in a plain browser too

The renderer is an ordinary web app. Electron just points a window at it. That's
deliberate: it means the whole thing can be driven and tested in a browser
during development, and the desktop-only bits (native file dialogs) sit behind a
`platform/` abstraction with a browser fallback.

---

## 3. Audio engine design

### The two-clock scheduler

JavaScript timers are jittery; the Web Audio clock is sample-accurate. So the
engine never plays a note *when a timer fires*. Instead
(`audio/AudioEngine.ts`):

1. A coarse timer wakes every ~25 ms.
2. Each wake, it looks ~100 ms into the future and hands every note in that
   window to Web Audio with an **exact** start time.
3. Web Audio plays them precisely, regardless of what the UI is doing.

This is the standard "A Tale of Two Clocks" approach. Result: rock-solid timing
with no drift. Looping is handled by projecting each note's beat forward by the
loop length and scheduling the occurrences that land in the window
(`beatOccurrencesInWindow` in `model/time.ts` — pure, and tested).

**The window is `(lo, hi]`** — open at the bottom, closed at the top — so that
back-to-back windows tile the timeline exactly once and no note is ever
scheduled twice. The cost of that choice: the very first window has to open a
hair *below* the beat playback starts from, or a note sitting exactly on it (the
downbeat, every single time you press Play) falls outside every window and is
never heard. `START_EPSILON_BEATS` is that nudge.

**When the loop length changes mid-play** — a part stretched, a part added, the
song reordered, all normal things to do while it's running — the transport
re-anchors (`reanchorForPeriodChange`). It counts absolute beats and wraps them
by the loop length, so without re-anchoring the wrapped position would jump
somewhere unrelated and take a stretch of silence with it. Re-anchoring keeps
both the wrapped position and the already-scheduled horizon, so nothing is heard
twice.

**When the scheduler is starved.** The look-ahead assumes the timer keeps
waking. When it can't — a modal dialog blocking the main thread, a backgrounded
tab, a machine under load — the audio clock runs on without it, and the next
window spans *everything missed*. Those notes are all in the past, and clamping
each one to "now" (which the scheduler must do, since Web Audio will not start a
source at a time already gone) lands the whole lot on a single instant: several
seconds of drums as one blast. That is an ear-safety problem rather than a
timing one, and the limiter caps its peak but not its existence. So `tick()`
checks how far behind it is, and past `MAX_CATCHUP_S` it abandons the gap and
resumes from the present — silence across the stall, then the song where it has
actually got to. Measured (`AudioEngine.test.ts`): a five-second stall in a
dense three-track loop scheduled 117 notes on one instant before this guard, and
at most three — normal playback's ceiling — after it.

**Two play modes.** In `'song'` mode the engine plays the arrangement: each
slot's section is laid end to end (`model/arrange.ts` resolves slots to absolute
beats), a note is scheduled once per slot its section occupies, and looping
wraps the whole song. In `'section'` mode only the part being edited plays,
looping at that part's length — the editing workflow. Switching modes resets the
transport.

**Live editing:** the scheduler re-reads the current project every wake, so a
note added, moved, muted, or a tempo change is heard on the next ~100 ms window
— the "change it, hear it" feedback that defines the app.

### Per-track echo

Sound lives on the blocks, but an echo is the *space* an instrument sits in
rather than what the instrument is — so it belongs to the track, and
`audio/trackChain.ts` gives every track its own:

```
voices → [ dry ─────────────────────────────────→ ] → master
         [ send → delay → ↺ damp → DC-block → fb ] ↗
```

One kid-facing slider moves three things together — how loud the repeats are,
how many there are, and (from the tempo) how far apart — so there is no way to
set it to something unmusical. It takes a `BaseAudioContext` like the master
chain does, so live playback and the offline render behind Export share one
implementation and cannot drift apart.

**Why there is a high-pass in the feedback loop.** A loop that feeds back into
itself traps any DC offset the sound carries. The audible part of the echo dies
away properly but the offset does not — it sits there as a constant, silent-
but-not-silent lump that eats headroom from everything else and never leaves. A
high-pass has no gain at all at 0 Hz, so one in the loop kills it at the source.

**Where that DC came from (a real bug this uncovered).** A `WaveShaper` maps
input −1 to the first point of its curve and +1 to the last, interpolating
between them. Both shaping curves here were built with an *even* number of
points, so there was no point at exactly input 0: silence landed halfway between
the two either side of centre and came out as a small constant. Every kick left
a permanent −0.0152 offset on the output, and the master saturator added its own
on everything. Both curves now use an odd count, so silence in gives silence
out — worth knowing if any new shaping curve is ever added.

### Master output & ear safety

Everything sums into a master chain (`audio/master.ts`):
`input → [dry + subtle reverb] → gentle saturation → brickwall limiter → speakers`.

- **Reverb** — a synthesized impulse (decaying noise, no audio files) adds a
  little space so sounds aren't bone-dry. Kept subtle; easy to turn up.
- **Saturation** — a mild `tanh` WaveShaper adds harmonic warmth/"glue".
- **Limiter** — a `DynamicsCompressor` as a safety brickwall: no matter how many
  sounds stack up, the output can't spike loud enough to hurt ears or speakers.

Verified by rendering a full beat through the chain in an `OfflineAudioContext`:
the demo song peaks at 0.84, and the worst case a child can build at 0.94, both
with zero clipped samples. See "Ear safety, re-measured" above for what that
worst case actually contains. Gain staging is conservative (velocity
and track volume scale voices down further before the master).

### Playing recordings (`audio/sampler.ts`)

Most instruments are now real recordings rather than built sounds. Which one a
voice is, is a single field in the catalog: a `VoiceDef` with a `sampleSet` is
played by the sampler, one without by the synthesizer, and `getTrigger` in
`audio/synth.ts` is the one place that chooses. That matters because live
playback and the offline render behind Export both go through it, so they cannot
drift apart.

**A recording is stretched to the note asked for** by playing it faster or
slower. Past a couple of semitones that stops sounding like the same instrument
and starts sounding like a cartoon, so an instrument is many recordings across
its range and the engine picks the nearest — the piano is 24 notes' worth,
roughly one every two semitones.

The **Bells** were the exception, and are now two instruments on purpose. A
glockenspiel's lowest bar is G5, well above the bottom of the grid, and the
lowest rows used to play that bar stretched down seven semitones — a larger,
duller metallophone. Moving the grid up to meet the recordings sounded better
and broke every song already written: a saved note below the new range keeps
its pitch, has no row to be drawn on, and collapses onto the bottom one. So the
fix went the other way: the bells sample set carries real vibraphone notes
(hard mallets — the closest sound in the library to a glockenspiel) for the
rows below G5, and the engine's nearest-recording rule plays them there without
knowing anything changed. A tune that walks across G5 crosses from one metal
bar instrument to a very similar other one, which beats every note below it
being a stretch.

**Strength bands tile exactly, and that is load-bearing.** The bands are whole
numbers in the library's map and fractions in the app's, and converting each
edge on its own left a 1/127-wide hole between every pair. A strike landing in
one matched no band of the note being played — only a band belonging to some
*other* note, which was then dragged into tune from as much as two octaves away:
middle C at one particular strength came out as a slurred growl. Both edges now
come from the same expression on the same integer, the bands are half-open, and
`sampler.test.ts` sweeps every strength of every note in the shipped map.

**Strength is chosen before pitch, and that order is the point.** How hard a
piano is struck changes its *tone*, not only its loudness, so each note is
recorded two or three times at different strengths. Given a soft recording of
the exact note and a hard recording a tone away, a hard strike must take the
hard one: playing the soft one louder sounds like a soft hit turned up, because
that is what it is.

**Repeated hits alternate between takes** where a note has more than one. Choosing
at random sounds like the right idea and isn't — with three takes it repeats
about a third of the time, which is the machine-gun rattle the takes exist to
avoid.

**Sampled voices offer different controls, and the Sound Editor follows.**
Volume, brightness, drive and attack all still mean what they meant on a
synthesized voice — they shape the sound on its way out. Waveform and detune
describe how a sound is *built*, and there is nothing to build, so they are
absent rather than present and dead. The editor draws whatever is in a voice's
`defaults`, so this needed no special case. A drum gets `decay` (how long it
rings before it is cut); a pitched voice gets `release` instead, because its
length already comes from its block. Brightness deliberately keeps the key each
voice used before — `tone` on the drums, `cutoff` on the melodic ones — so a
block a child had already darkened stays darkened.

**Pitch is offered on drums only.** Tuning a tom up or down is a real thing to
want, and a drum has no scale to violate. On a melodic voice the note-grid *is*
the pitch control, and its one promise is that nothing placed on it can sound
wrong — a slider that moves a block a semitone off the row it is drawn on, with
nothing on screen to show it, breaks exactly that. Where a transpose does apply,
it picks the recording of the note it lands on rather than stretching the
original one that far.

**A held note lasts as long as it actually plays for.** A recording played below
its own note runs slower, so a three-and-a-half second glockenspiel takes over
five at the bottom of the Bells grid. The stop time is divided by the playback
rate for exactly that reason; without it the note was cut a second and a half
early, on a hard edge, with the level still held at full.

**A drum's envelope has to stay in order.** Web Audio sorts automation events by
time, so with a slow attack and a short decay the ramp to silence was scheduled
*before* the ramp to full, and the level sat at the envelope's floor for the
whole note — the drum made no sound at all. A Shaker's Decay is 0.18 against an
Attack that goes to 1.0, so it took one drag to silence a block with nothing to
say why. `drumEnvelope` is that ordering, and it is tested across the whole
range of both sliders.

**A sampled drum ignores how wide its block is**, exactly as a synthesized one
does. A child drawing a narrow hi-hat means "a hi-hat here", not "a hi-hat cut
off after a sixteenth".

**The recordings are fetched and decoded at start-up**, before the first click,
because they are what the sampled instruments *are* — a child who drops a snare
and hears the fallback has been given the wrong impression of the app in its
first second. Nothing there needs a user gesture: decoding goes through an
`OfflineAudioContext`, which needs none, and an `AudioBuffer` is not tied to the
context that made it. The whole set is 302 files and 10.9 MB, in well under a
second. A voice whose recordings never arrive falls back to its
synthesized version, so the app is never silent, only less good — with its
Volume capped on the way, because a sampled voice's Volume sits higher than a
synthesized one's and handing that number straight over would make the stand-in
several times louder than the sound it stands in for.

**Levels were set by measurement, not by ear.** Each sampled voice's Volume was
chosen by rendering one hit and comparing it against the synthesized voice it
replaced, aiming at the same loudness with a peak around 0.72 at a normal
strike. Values above 1 are normal: a levelled recording peaks well below full
scale where a built waveform does not. The synthesized **kick** came down from
1.0 to 0.45 as part of this — at 1.0 it peaked at 1.35 on its own, clipped
before it even reached the limiter, and was loud enough to bury every other drum
now that the rest are recordings.

**Ear safety, re-measured.** The worst case a child can build — every voice
(all 29, since the hand percussion and mallets arrived), a note on every
sixteenth, every slider at the end of its range, every track's echo at maximum,
at 180 bpm, plus a microphone recording at the level a decoded take really
comes back at — renders at peak **0.913–0.925 with zero clipped samples**
across repeated renders. Eleven more voices in the stack did not raise the
ceiling: the limiter is the thing being measured, and it holds.

Getting there took half a decibel off the master's final gain (0.9 → 0.85, in
`audio/master.ts`). Recordings are hotter than synthesis, and the Volume slider's
ceiling went up to make room for them, so the same worst case that used to land
at 0.977 was landing between 0.976 and 0.993 — passing, and far too close. The
voices vary a little from run to run by design (noise offsets, alternating
takes), so "never clips" cannot rest on three parts in a thousand.

### Synthesis

Some voices stay synthesized, on purpose. The **Synth** and the **Bass** are
synthesizers: there is no "real" version of them to be more faithful to. (A
real bass — the **Upright Bass**, a plucked contrabass — now sits beside the
synth Bass as its own voice rather than replacing it, so no saved song changes
sound.) The **Kick** is a drum-machine kick, which is a built sound by
definition, and the only real recording available for it is an orchestral bass
drum — a different, boomier thing, which is in the app as its own voice
(**Big Drum**) rather than in place of it.

All of those sounds are built (`audio/synth.ts`) from a few primitives:

- **membrane** — a pitched sine with a fast pitch-drop envelope (tom).
- **noise burst** — filtered white noise with a shaped decay (snare body,
  cymbals, claps, shaker).
- **blip** — a short tuned oscillator (cowbell, rim, percussion).

The core drums are layered for a fuller, less "'90s" sound: the **kick** stacks
a pitch-dropping body + a pure sub + a beater click; the **snare** combines two
detuned tonal oscillators with a bright noise crack and a mid-body noise; the
**hats** are a metallic cluster of inharmonic square oscillators (the classic
drum-machine technique) rather than plain noise.

Each drum voice in the catalog (`model/voices.ts`) is one of these configured by
a small set of parameters (tune, decay, tone, drive, gain, …). Those same
parameters are what the Phase 3 sound editor will expose to the child.

**Melodic instruments** (piano, synth, bells, bass) share one pitched voice
(`pitchedSynth`): two detuned oscillators through a low-pass filter, shaped by a
real ADSR envelope, so held notes sustain for their length and short notes
pluck. They differ by their default parameters (waveform, envelope, filter,
octave range). A note's MIDI pitch becomes the oscillator frequency; its length
becomes the envelope gate.

**Why they sounded flat, and what a filter envelope is for.** The first version
held the filter cutoff *still*. That is the difference between a note and a
tone: the harmonics present at the attack were still present at the end and the
sound merely got quieter. Measured as spectral centroid over a whole note, the
old piano moved 52 Hz — nothing. Every struck or plucked instrument sheds its
high end far faster than its fundamental, so the cutoff now starts high and
settles as the note does, and how far it opens follows how hard the note was
hit. That is the `bite` parameter ("Twang" in the sound editor), and it applies
to notes played by hand as well as notes on the timeline, so the keyboard sounds
like what it writes.

**A filter envelope needs something to bite on.** Sweeping a low-pass over a
triangle or a sine does almost nothing, because there are barely any harmonics
up there to remove — which is why adding the envelope alone left the piano and
the bells exactly as flat as before, while the saw-based synth and bass came
alive immediately. The piano moved to a sawtooth with a much lower cutoff, which
is how a plucky, percussive sound is actually made subtractively.

**A bell is not a filtered waveform.** No envelope turns a sine into one. What
makes a bell is *inharmonic* partials — overtones at ratios like 2.76 and 5.4
rather than whole multiples, each ringing for a different length — so the bells
voice layers struck partials of its own on top of the shared one.

Measured before and after, as spectral centroid spread across a note: piano
52 Hz → 451, synth → 814, bass → 841, bells 1 Hz → 277. Playing harder now
measurably brightens the tone as well as raising it.

**Two things that made the drums sound cheap.** `noiseBurst` carried a comment
saying it randomised its read offset so repeated hits wouldn't sound
mechanically identical — and it didn't. Every snare read the same samples from
the same place, so eight in a row were bit-for-bit identical: the machine-gun
rattle that gives a drum machine away. It now starts at a different offset each
hit, and two rendered snares differ by a measured 0.056 mean absolute sample.
The filter was also static, so a burst read as *noise* rather than as a skin or
a cymbal; it now sheds its high end as it decays, the way a real one does. The
kick's pitch drop was taking up to a fifth of a second to arrive, which reads as
a soft thud rather than a hit — it lands in 55 ms now — and its sub layer sat as
low as 30 Hz, inaudible on a laptop or tablet while still costing headroom the
limiter had to make room for.

**Held notes (the keyboard).** A note on the timeline knows its length up front,
so its whole envelope is scheduled in one go — that's what keeps it
sample-accurate. A finger on a key has no known length, so `startHeldNote`
builds the same voice with the envelope's gate left *open*: attack, decay, then
hold, until `release()` closes it. Two consequences worth knowing:

- Releasing has to *pin* the level the envelope has reached (an explicit
  `setValueAtTime` at that instant) before ramping down. Web Audio interpolates
  a ramp from the previous automation event, so without the pin the note starts
  fading the moment its decay ends and is gone long before the key comes up.
- Voices whose `sustain` is 0 (the piano plucks) would die away under a held
  key, so held notes put a floor under the sustain level.

**How hard a key was hit.** A computer knows nothing about pressure: a keyboard
key is on or off, and a mouse reports none worth the name. So the on-screen keys
take their strength from *where* on the key the press lands — down at the near
edge is a hard hit, up at the far end a gentle one, the convention GarageBand's
on-screen keyboard uses. It is heard live and kept by the recorder, so a played
melody arrives on the timeline with its light and heavy notes intact instead of
forty identical ones. Computer keys have no position to read, so they play at a
fixed comfortable strength (`ui/velocity.ts`).

The depth is measured against the **key's own box**, not the event's `offsetY`.
`offsetY` is relative to whatever node the pointer actually hit, and every key
has a note name and a shortcut label inside it — landing on one of those would
report a depth into the *label* and read as a soft tap wherever on the key it
happened. That bug was live for about ten minutes and is exactly the kind that
survives a reading of the code.

**Recording your own voice.** Everything else in this app is *described* rather
than stored — a few numbers say "kick, here, this hard" and the engine builds
the sound every time. A recording can't be described, only kept, and that one
fact drives every decision here.

- **A recorded block is an ordinary `Note`** carrying a `clipId` instead of a
  pitch, on a track of type `'audio'`. So placing, moving, resizing, selecting,
  deleting, undo and the whole arrangement machinery keep working without
  knowing that some blocks are recordings.
- **The audio is not in the project file.** A minute of sound is a thousand
  times the size of the entire song describing it, and undo keeps a hundred
  copies of the song. Each recording is its own `.wav` in
  `<Song Name>.recordings/` next to the song — beside it rather than in one
  shared pile, so copying a song takes its voice with it. Renaming the song
  moves the folder; deleting the song takes it too.
- **Capture** (`audio/mic.ts`) goes through the browser's own recorder and is
  stored **exactly as captured**, as AAC in an MP4 container — a `.m4a`. That
  format was chosen for two properties at once: it is roughly *forty times*
  smaller than the same audio as WAV (a three-second take is 12 KB rather than
  500 KB), and it opens on a double-click on macOS and Windows alike, which is
  the whole point of keeping songs as files a grown-up can find.

  It has to be asked for by name — `audio/mp4;codecs=mp4a.40.2`. Plain
  `audio/mp4` looks like the same request and is not: this engine answers that
  with *Opus* inside an MP4, which nothing outside a browser will open. The
  engine itself still cannot encode MP3 — captures stay AAC — but Export now
  bundles an encoder of its own for the finished song; see §5 and
  `audio/mp3.ts`.

  The first version decoded the capture and re-encoded it to WAV for
  openability — buying that one property at forty times the size. AAC buys both.

  **Lossy decoding overshoots, which makes the limiter matter more.** Decoded
  AAC comes back slightly *above* full scale: measured at 1.0236, with 6,320
  samples past 1.0 from a single loud take. Through the master chain the worst
  case a child can build still peaks at 0.977 with zero clipped samples, so the
  safety net holds — but nothing upstream of it should be assumed to stay inside
  ±1.

  Recordings are found on disk **by id rather than by extension**, so takes made
  while this was writing WAVs keep playing, with no migration.
- **Playback** is scheduled by the same window, with the same clamp, as every
  other block, through the same track chain — so a recording gets the track's
  volume, mute, echo and the master limiter exactly like a drum. But unlike
  every other block it needs **an end and a handle**. Each synthesised voice
  stops itself when its envelope runs out; a recording plays until told
  otherwise. Started and forgotten, it kept singing after Stop with no control
  that would silence it, every press of Play layered another copy over the one
  still running, and shortening a block changed nothing about the sound. So each
  source is given an explicit end at its block's length and kept in `liveClips`,
  which `stop`, `pause` and opening another song all clear.
- **Tempo can't stretch a voice.** A recording plays at the speed it was made,
  so `setBpm` re-measures the *block* to match the sound rather than the other
  way round; `clipSeconds` is the truth and `lengthBeats` follows it.
- **Export had to learn about it too**, or the exported file would come out with
  the child's voice silently missing — the one part of the song that can't be
  rebuilt from numbers. The render is also made long enough for a recording that
  runs past the last beat (`clipOverhangSeconds`), so nobody is cut off
  mid-word. That measure is **clip end minus song end**, and getting it wrong is
  easy: the first version compared a recording against its own block, which is
  always the same number — the block is created from the recording's length and
  rescaled with the tempo — so it was always zero and the tail never grew.
  Twenty seconds of singing in an eight-second song came out of Export as ten
  and a half.
- **It is a desktop feature.** In a plain browser there is nowhere to put a
  megabyte of audio that survives a reload, and offering it there would mean a
  child records their voice and loses it. The button says so and is disabled.

**A recording outlives the block that used it, on purpose.** Deleting a block
does *not* delete its `.wav` — one press of undo would otherwise bring the block
back to a file that had gone. Instead, unreferenced recordings are swept when a
song is **opened**, and that timing is the whole safety argument: opening a song
starts a fresh undo history, so a recording the song doesn't mention can no
longer be reached by any amount of undoing.

**Leaving a song flushes first.** Autosave runs a second behind, and a second is
long enough to hold an entire take. So New, opening another song and opening a
file all write the current song out before replacing it — otherwise a child who
recorded and immediately switched would find the take gone.

**Replacing the song abandons a take in progress.** A take running when the song
on screen changes has nowhere to land: the part it was being sung into is gone.
Left alone the recorder keeps running with the microphone light on, and the next
press of stop drops that take into whatever song is open by then — someone
else's song, from the child's point of view. `abandonMicTake` stops it and lets
the microphone go.

Silence is treated as a failure, not a result: a take whose peak never gets
above 0.005 almost always means a muted or unplugged microphone, and a silent
block on the timeline looks exactly like the app having lost it.

**Recording a performance.** Arming captures a baseline of the project; every
finished note is folded into the live project with `replacePresent` (so it
appears on the timeline and is heard on the next pass) *without* touching the
undo history; stopping commits the lot as one entry. So a child who records four
bars and hates it presses undo once, not forty times. Where a note lands is
worked out from the transport position taken at key-down: in Part mode that's
already a position in the part being edited, and in Song mode it's an absolute
beat traced back through `songPositionAt` to whichever slot was sounding — which
is what lets one take spill from the verse into the chorus and land correctly in
both. Start and length are quantised whenever **Timing** is set to Tidy, so the
one toggle covers both where blocks land when they're placed and how a
performance is straightened out after it's played.

**Playing a row on a different instrument.** A row's name in the lane header is
a picker: change it and the whole row — blocks and all — plays on the new
instrument. The notes cross over **by their position on the note-grid, not by
their raw pitch**, because instruments sit in different registers. The Bass
lives two octaves below the Piano, so keeping the pitches would draw the tune on
one row of the grid and play it somewhere else entirely; carrying the ladder
position lands it in the new instrument's own range, which is what "play my tune
on the bass" means. A drum row can only become another drum and a melodic row
another melodic one, enforced in `setTrackVoice` rather than in the dropdown, so
no future caller can produce a drum block carrying a pitch nothing can draw.

**Changing the song's mood.** The four scales are offered in the toolbar under
names a child can judge — Happy, Sad, and a "more notes" version of each — and
changing one **brings the tune already written along with it**. Leaving the
notes where they were would be easier and wrong: they would sit off the
note-grid's rows, and the app's one promise, that nothing on the grid can sound
wrong, would quietly stop holding for the song the child already had.

The notes move **by scale degree, not by nearest pitch**, and that distinction
is the whole feature. Nearest-pitch looks perfectly reasonable and destroys the
melody: going from C major pentatonic to minor, both D and E are nearest to E
flat, so *C D E G E D C* comes out as *C E♭ E♭ G E♭ E♭ C* — two notes fused into
one, the shape gone, and pressing Happy again cannot undo it because the
information is gone. By degree, the third note of the old scale becomes the
third note of the new one; between two scales of the same size the change is
exactly reversible, which is what a child flipping between Happy and Sad
expects. A note that already exists in the scale being moved to doesn't move at
all, and since the five-note scales sit inside the seven-note ones, adding notes
to choose from disturbs nothing. Going the other way, to a scale with genuinely
fewer notes, can land two notes together — unavoidable, and one undo away.

That first mapping shipped as nearest-pitch and was caught by playing a tune
through it in the browser, not by reading it.

**Scale-snapping (the kid-friendly bit).** A melodic track doesn't offer all 12
chromatic notes — only the notes of the project's scale (`model/scales.ts`),
default C major pentatonic. The note-grid's rows *are* the scale, so a child
places notes freely and they always sound good together; "wrong" notes simply
aren't on the grid. This is what lets an 8-year-old build real melodies without
music theory getting in the way.

Verified non-silent by rendering each voice through an `OfflineAudioContext` and
measuring peak/RMS. All voices produce real signal, and after the levelling
described in §5 they sit within about 5 dB of each other rather than the 24 dB
spread they started at.

---

## 4. Project file format (`.beatbox`)

Plain, pretty-printed JSON — human-readable and diff-friendly. Shape (v4):

```jsonc
{
  "formatVersion": 4,
  "name": "My Song",
  "bpm": 120,
  "timeSignature": { "numerator": 4, "denominator": 4 },
  "scaleRoot": 0,              // 0 = C; the root of the melodic scale
  "scaleId": "majorPentatonic",
  "sections": [                // the song's parts, each its own mini-loop
    { "id": "sec_…", "name": "A", "lengthBars": 4, "color": "#f59e0b" },
    { "id": "sec_…", "name": "B", "lengthBars": 2, "color": "#60a5fa" }
  ],
  "arrangement": [             // the song = parts in this order (repeats allowed)
    { "id": "arr_…", "sectionId": "sec_A…" },
    { "id": "arr_…", "sectionId": "sec_A…" },
    { "id": "arr_…", "sectionId": "sec_B…" }
  ],
  "tracks": [
    {
      "id": "trk_…", "name": "Kick", "type": "drum", "color": "#ef4444",
      "instrument": { "voiceId": "kick", "params": {} },
      "gain": 0.85, "muted": false, "solo": false,
      "notes": [
        { "id": "note_…", "sectionId": "sec_…", "startBeat": 0, "lengthBeats": 1, "velocity": 0.8, "params": { "decay": 0.6 } },
        { "id": "note_…", "sectionId": "sec_…", "startBeat": 2, "lengthBeats": 1, "velocity": 0.8, "params": { "decay": 0.6 }, "groupId": "grp_…" }
      ]
    },
    {
      "id": "trk_…", "name": "Piano", "type": "instrument", "color": "#60a5fa",
      "instrument": { "voiceId": "piano", "params": {} },
      "gain": 0.7, "muted": false, "solo": false,
      "notes": [ { "id": "note_…", "sectionId": "sec_…", "startBeat": 0, "lengthBeats": 1, "velocity": 0.8, "pitch": 72, "params": {} } ]
    }
  ]
}
```

- `type` is `"drum"` or `"instrument"`. Instrument notes carry a `pitch` (MIDI
  number); drum notes omit it.

- **Sections & arrangement (v2).** A section ("part" in the UI) is a mini-loop
  with its own length; the arrangement is the song's running order, and the same
  section may appear in several slots (A A B A). Slots have their own ids so
  repeats can be reordered/removed individually. Every note carries the
  `sectionId` of the part it lives in; `startBeat` is measured from the start of
  that part. Tracks (instrument, volume, mute/solo) span the whole song.
  Invariants, re-established on every load: ids are unique (sections, slots and
  notes alike — duplicates get re-minted, since all three are addressed by id
  and twins would be edited or deleted together), at least one section, at least
  one arrangement slot, every slot points at a real section, every section
  appears in the arrangement (an unreferenced one would be unreachable — never
  heard, edited or deleted, so it gets a slot at the end), and every note lives
  in a real section. Removing a section's last slot deletes the section and its
  notes. Format-1 files are migrated on load: the whole song becomes one part
  "A" of the old `lengthBars`, and every note joins it — including the old
  track-level sound, which is copied onto the blocks. That copy is gated on
  format 1: doing it to a format-2 file would resurrect a sound the child had
  deliberately Reset, every time the song was reopened.

- Each **note** carries its own `params` (sound overrides on the voice's
  defaults); empty means "the plain voice". Notes sharing a `groupId` are
  **chained** — kept at the same sound and length. `instrument.voiceId` selects
  the synth voice; `instrument.params` is retained for compatibility, but sound
  now lives on the blocks. Older files that stored sound on the track are
  migrated onto their notes on load.
- **Version 4 is a change of *meaning*, not of shape.** Most instruments became
  recordings, and a recording sits at a different Volume from the synthesized
  voice it replaced — the piano's normal level moved from 0.34 to 1.6. A block's
  Volume is stored as an absolute number, so without a migration a block a child
  had deliberately turned *up* came back thirteen decibels *below* the untouched
  ones beside it: the emphasis they put on a note, inverted. Loading a format-3
  file rescales any Volume a block carries so the *proportion* the child chose
  survives — half its voice's normal level stays half. Blocks with no Volume of
  their own are left alone, because they already say "however loud this voice
  normally is". `migrateBlockVolume` in `model/voices.ts` keeps the old levels as
  plain data, since they are a fact about files already on disk and must not
  move again the next time a level is retuned.

- **Loading is validated** (`model/serialization.ts`): bad JSON, non-project
  values, or a missing `tracks` array throw a clear `ProjectLoadError`; a file
  from a newer `formatVersion` is refused; imperfect-but-recoverable data is
  repaired (clamped/defaulted). Valid data round-trips exactly.
- The project file is separate from any exported audio (WAV export is a later
  phase).

### Keeping songs between visits (the shelf)

A child does not think to save. So the app keeps its own copies and opens the
last one at the next start. Local only, nothing leaves the machine.

**On the desktop those copies are real files**, in `~/Documents/Beatbox Studio/`,
one `.beatbox` file per song, named after the song. That is the whole point of
shipping a desktop app rather than a web page: a song is a thing a grown-up can
find, copy to another machine and back up, and there is no few-megabyte browser
allowance in the way — which is what makes room for the recordings still to
come. Documents rather than a hidden application-support folder, precisely so
they can be found. `electron/main.cjs` owns the folder and answers four
questions about it — list, read, write, delete.

Those answers are **synchronous** (`ipcRenderer.sendSync`), which is unusual
enough to explain. The renderer needs the song list and the song it was last in
before it can draw anything, and the alternative — draw an empty song, then
swap it out a moment later — is worse than blocking for the millisecond it takes
to read a few kilobytes. Song files are kept small by design; when recordings
arrive they will live beside the song as their own files, so this stays cheap.

A song's **id is its file name**, so renaming the song renames the file and the
id moves with it — `saveSong` hands the new id back and the store follows it.
Names are cleaned up for the file system and made unique (`electron/songfiles.cjs`,
tested on its own): two songs called "Dinosaur Disco" get their own files, and a
song called `AC/DC: best*song?` gets a file a file system will accept while
keeping its real name inside.

In a plain browser — development, and the app's other life — there is no such
folder, and everything falls back to local storage: an index of songs plus one
slot each (`platform/library.ts`).

It started as a **single** slot, which is enough right up until a child makes
something they like and then starts a new one; at that point the first was gone
unless they had thought to save a file. New now leaves the old song on the shelf
under its own id and takes a fresh slot, so it destroys nothing and no longer
asks before it runs. The only thing in the app that ends work for good is
deleting a song from the list, and that is the one place that asks.

Each slot holds **the same text a `.beatbox` file holds**: `serializeProject` on
the way out, `parseProject` on the way back. So a restored song gets the exact
validation, repair and version check a file does, and a half-written or
hand-mangled slot can only ever mean "that song isn't there" — never a broken
app. Reading never throws and never deletes: opening a song must not be the thing
that destroys one it merely couldn't read today.

**The upgrade path is the risky part, and there are two of them.** The first
version kept one song in a single slot; the next kept several in browser
storage; the desktop app now keeps them as files. Both hops run at startup,
oldest first: `importLegacyAutosave` brings the single slot into storage, and
`importBrowserShelf` sweeps storage into the folder. Each clears the old copy
**only after** the new one is safely written, so a failure leaves the original
where it was.

Both hops also carry the *pointer to the song that was open*, which is easy to
miss and looks like data loss when it's missed: the work is safely on the shelf,
but the child lands on a blank song and has no way to know that. Two separate
bugs of exactly that shape turned up here, and both only appeared by running the
real upgrade in the real app — the code read fine.

**When it writes** (`state/autosave.ts`) is the part with a bug in it if you get
it wrong. Dragging a sound slider changes the project on every pointer move, and
a recording take adds a note per key press, so writing on every change is out. A
plain "write once it goes quiet" debounce is worse than it looks: it keeps
pushing the write back for as long as the child keeps working, which is exactly
when there is most to lose. Instead the first change starts a one-second clock
that is *not* restarted, so no more than a second of work is ever at risk. The
page-hidden events (`pagehide`, `visibilitychange`) flush immediately, because
after them there may be no page left to run in.

Storage can be absent (some privacy modes throw on merely touching
`localStorage`) or full. Both are survivable: the song in front of the child is
untouched, and a full shelf says so once in the status line rather than every
second.

---

## 5. Assets & licensing

**Every third-party recording in this app is CC0**, from two libraries by the
same publisher, Versilian Studios LLC: the Versilian Community Sample Library
(VCSL, pinned to commit `c1ea7bc`) and — for the one instrument VCSL doesn't
have, a bass — VSCO 2 Community Edition (pinned to `4403009`). CC0 is a
dedication to the public domain: no royalties, no attribution, no terms — which
matters because an exported song is meant to be shareable without anyone
reading a licence first. "Free for non-commercial use" would have failed
exactly there.

VSCO 2 CE's licence was checked with the same scepticism as VCSL's: the
repository carries the full CC0 1.0 legal text, and Versilian's own site says
"no rules, no royalties, no limits". A readme from 2016 in that repository
*asks* for credit and asks that the raw samples not be resold — polite requests
layered on CC0, not terms, and the current official page drops even the
requests. The recordings are Versilian's own, so the right to apply the label
holds.

**One piece of bundled code carries its own licence: the MP3 encoder.**
Export's MP3 comes from lamejs (`@breezystack/lamejs`), a pure-JavaScript port
of the LAME encoder, under the **LGPL-3.0**. That is a code licence, not a
music one — it puts no terms of any kind on the songs the app exports, so the
"share it with anybody, nobody reads a licence first" promise holds untouched.
What the LGPL asks is about the library itself: keep its licence text and
attribution with the app, and don't pretend the encoder is ours. Every MP3
encoder worth having traces back to LAME, so this is the honest floor for the
format — and the alternative (the operating system's AAC encoder) is different
on every platform and absent in tests.

Every shipped file is recorded in **`docs/asset-manifest.json`**: which library
and which recording it came from, the hash of that recording, the hash of the
file we ship, its size and length, plus each library's licence, publisher, URL
and the hash of its licence text. `tools/manifest.test.mjs` holds the two halves
together — every shipped file is in the manifest, every manifest entry is on
disk, and the hashes match. That test earns its keep: this project lives in an
iCloud-synced folder, which leaves duplicate `… 2.m4a` copies behind after a
rebuild, and without the check they would have been committed with no licence
record attached.

**A CC0 label is only as good as the right to apply it.** VCSL is Versilian's
own recordings, released by the people who made them — a chain that holds up.
Several "CC0 drum kit" repositories on GitHub are re-uploads of other people's
commercial content with a licence file added on top, and none of those are used
here.

### Building the recordings (`tools/`)

`node tools/build-samples.mjs` goes from "two pinned library commits" to "the
files in `public/samples/` and the map in `src/model/sampleSets.ts`" — 396 MB
of source recordings in, 10.9 MB shipped out. `--plan` prints the selection,
fetching only the small text maps. Source recordings are cached outside the
project, in `~/Library/Caches/beatbox-studio/vcsl`, keyed by the commit they
came from — about 380 MB now, and this project lives in an iCloud-synced
folder, which is no place for it.

**A set is usually one instrument from one map; the Bells are two.** Each set
can name several `sources`, each with its own map, its own pick and its own key
range, and the selection, the octave check and the tuning correction all run
per source — which is the point, because the glockenspiel's map is filed an
octave out and the vibraphone's is correct, and a whole-set "do these agree
about the octave" guard would have refused exactly the merge it was guarding.
After the corrections move the roots, the merged set is validated again: no
note claimed twice, no strength uncovered.

**The library ships its own map, and reading it beats guessing.** Alongside the
audio, VCSL publishes SFZ files saying which recording is which note, which
strike strength it covers, how far out of tune it is, and how much to turn it up
so it sits level with the others. Those numbers were measured by the people who
made the recordings.

**But the map is not always right, and the failure is silent.** VCSL's
glockenspiel *and* its xylophone are filed an octave below where they actually
ring — there is no energy whatsoever at the notes their maps name. Believed,
every note would have come out an octave low, and nobody would have found that
by reading code. So `verifyKeyCentre` checks each pitched recording against its
map before the map is used, and the build *fails* rather than guessing when the
two can't be reconciled.

That check is a measurement with traps in it, and the mallets and the bass each
sprang one. The obvious test — "which partial is loudest?" — is wrong three
ways over: a piano's second harmonic is routinely louder than its fundamental;
a high marimba bar's overtones out-power its fundamental by design (its true
note measures 6–9% of its loudest partial — real, and nowhere near loudest);
and on a softly-struck top bar, *20–30 Hz room rumble* was the loudest thing in
the whole recording. A plucked upright adds the other direction: real body
thump and sympathetic ringing an octave *below* its own note, at up to 60% of
the fundamental.

The rule that survives all of that: **believe the map unless the recording
clearly outvotes it.** The spectrum is judged from just below the lowest
candidate octave up, so subsonic rumble can't set the bar; a candidate below
24 Hz — under the bottom of any instrument — is never considered at all. The
claim is re-filed *down* only when the octave below holds a real fundamental
louder than the claimed note (a map filed an octave high puts the claim on the
true note's second harmonic, so only the louder fundamental underneath gives it
away — and a thump is never louder than its note). It is re-filed *up* only
when the claim is essentially empty (the glockenspiel shape: 0.1% at the claim,
everything an octave above; the faintest real fundamentals accepted measure
4–9%, more than a factor of forty away). And a claim two octaves from the truth
leaves only window leakage near the candidates — under 0.001% of the
recording's real content, a thousand times below the faintest accepted note —
so it is refused outright. Every threshold sits in a measured gap, and all 199
pitched recordings across both libraries verify at their expected octave with
no exceptions.

**The tuning correction's sign is load-bearing.** A measurement says how far the
recording *is* from the note; the number stored says how far to *move* it.
Getting that backwards doubles the error instead of removing it — the
glockenspiel first came out a third of a semitone sharp, which is enough to
sound wrong against everything else in the song. Verified after the fix by
rendering each note and measuring: bells land within 1 cent across their whole
range.

**Every recording is levelled to one loudness**, measured over its first 300 ms,
and how hard the note was struck supplies all of the loudness difference at
playback. That is what VCSL's own level trims are reaching for, and they don't
quite get there — the hi-hat's third-hardest recording came out *quieter* than
its second-hardest, which reads as a hit that lands wrong. Peaks are capped at
0.89 rather than full scale, because encoded audio decodes back slightly above
where it went in: an open hi-hat levelled to 0.95 came back at 1.006.

**What gets thrown away, and why.** VCSL records every technique for an
instrument in one folder — a hi-hat's closed, loose, open and pedal hits all
together, on different keys — so each voice takes exactly one of them, or it
would change character at random from hit to hit. Rolls, bowed swells and
crescendos are dropped. Where a note was recorded at four strengths and only
three are kept, the survivors are stretched to cover the whole range: dropping
one leaves a hole, and a strike landing in it finds no recording at all. And a
note the library captured at only one strength is dropped entirely — B4 on the
Kawai is the only loud-only note on the keyboard, and kept, it would play at
that one volume however gently a child hit it. The upright bass is the
deliberate exception (`minLayers: 1`): its lower notes carry two strengths and
its upper ones one, so dropping the single-strength notes would leave the top
of the grid stretched twenty semitones from the nearest survivor — far worse
than a note whose tone doesn't change with the strike, which on a plucked bass
is barely a change to begin with.

**Rebuilding produces the same sound, and almost always the same bytes.** The
encoder stamps the current date into three MP4 headers, so the same audio encoded
twice differed in six bytes — enough to make every rebuild look like 6.8 MB of
changed binaries to git and to change every hash in the licence manifest for no
reason. Those fields are zeroed after encoding.

What remains is the system encoder itself, which is not quite bit-exact: measured
at eleven identical encodes out of twelve for one input, and about one file in
eight across a full rebuild. The audio is the same either way — this is the
encoder making a marginally different choice, not the tool making a different
decision — but it does mean a rebuild is not a no-op in git, and it is why the
licence manifest is regenerated by the same run that writes the files rather than
being checked against an older one.

Both the audio commit *and* the commit the maps come from are pinned:
everything that decides mapping rather than sound — root notes, strength bands,
tunings, take numbers, which recordings exist at all — lives in those maps, so a
branch name there would have meant a regenerated upstream could silently produce
a different instrument from byte-identical audio and report success.

**Format: AAC in an MP4 container (`.m4a`), stereo, 44.1 kHz.** 396 MB of source
recordings become 10.9 MB shipped. Stereo rather than mono because these were
recorded with a spaced pair, and for the piano and the cymbals that width *is*
the realism — mono saves about 3 MB and makes a piano sit at a point rather than
in a room. AAC was checked for the one thing that would have ruled it out:
compressed audio can decode a few milliseconds late, which would put every
sampled drum behind every synthesized one. Measured in Electron, the transient
lands on exactly the same frame as the source WAV.

**Timing was measured, not assumed.** Recordings carry several milliseconds of
room before the hit; left in, every sampled drum lands that much behind a
synthesized one, which reads as a flam between the kick and the snare. The build
trims to just before the transient, and four hi-hats rendered a beat apart now
start within 1.1–1.7 ms of where they were asked for — most of which is the
instrument's own attack.

---

## 6. Build, run, test

```bash
npm install
npm run app         # desktop app (Electron) against the dev server
npm run dev         # web UI only, http://localhost:5173
npm test            # unit tests (Vitest)
npm run typecheck   # tsc --noEmit
npm run build       # typecheck + build web bundle to dist/
npm run package:win # NSIS installer for x64 (cross-builds fine from this Mac; CI builds it on real Windows)
npm run package:mac # macOS app bundle
```

### Shipping an update

Installed Windows copies watch the GitHub Releases page and update themselves
silently (download in the background at launch, install on quit). To ship:

```bash
npm version patch        # bumps package.json and makes the vX.Y.Z tag
git push && git push --tags
```

The tag makes GitHub build the installer on a real Windows machine, run the
whole test suite there, and publish the Release. Three files must land on
every Release, and the workflow uploads all three: the installer, its
`.blockmap` (so updates download only what changed), and `latest.yml` — the
file installed apps actually read to learn a new version exists. A Release
missing `latest.yml` is invisible to installed apps.

Two name traps, both already hit and fixed. The artifact name must contain
**no spaces**: electron-builder writes spaces as dashes into `latest.yml`
while GitHub renames uploaded assets with dots, and an updater chasing the
dash-name 404s silently forever. And `electron-builder --publish never` stays
in the package script — publishing is the workflow's job, and on CI the
builder would otherwise try (and fail) to do it itself.

### A blank Electron window is almost always a stale dependency cache

Vite pre-bundles dependencies into `node_modules/.vite/deps` and serves them
with hashed, immutable URLs. Rebuild `node_modules` while a dev server is
running and that folder goes with it: the server keeps handing out the old
hashed URLs, which now 504. A browser tab that already has them cached carries
on working, which is what makes this so confusing — a fresh Electron window has
an empty cache, fails to fetch React, and renders nothing at all, with no error
in the renderer console (a module that never loads throws nowhere).

Symptom: an empty window, `#root` with zero children, `[vite] connected` in the
log and no errors. Check with
`curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:5173/node_modules/.vite/deps/react.js?v=<hash>"`
(take the hash from `curl -s http://127.0.0.1:5173/src/main.tsx`). The fix is to
restart the dev server, which re-optimizes the dependencies.

### One decision a child can actually make

The timeline's grid resolution used to be a seven-way menu — Bar, Beat, ½, ¼,
⅛, 1/16, Off. That is studio vocabulary an eight-year-old has no way to judge,
and it was not decorative: it decided where blocks land when they're placed
*and* how a recorded performance is straightened out. A child who idly moved it
to "Bar" would find their beats jumping to places they hadn't clicked, with
nothing on screen connecting cause to effect.

It is now one toggle — **Tidy** or **Free** — and the underlying `SnapId` keeps
its full range for the model and the tests. The general rule this stands for:
where a control's options can't be judged by the person using it, the app should
make the choice and offer only the one that changes what they get.

The same pressure shows up as sheer count. Every feature so far has added a
control to the toolbar, and at 1150px wide — an ordinary laptop — the last six
had scrolled off the right edge of a bar with no scrollbar, unreachable. So the
things you do to a song *as a whole* (New, Open, Save, Export) now live in the
🎵 Songs panel next to the list of songs, which is what they were always about,
and the bar wraps rather than putting a control out of reach.

**A control has to look like what it does, and show what it did.** A pass over
the app against that bar (the "shape-sorter test": could a child discover this
by poking, with no instruction?) found the failures were never structure —
the app's shapes already mirror grown-up music software — but discovery:
good features hidden behind hover tooltips and keyboard chords. What changed,
and why:

- The row's name is a menu (pick a different instrument), and it was styled as
  bare text — the app's best-hidden feature. It now looks like a soft button
  with a ▾ arrow, which is the entire difference between hidden and found.
- Mute and Solo keep their M/S letters — they are what every real mixer says,
  and worth learning — but pressing them now *shows* the result: a silenced
  row (muted, or talked over by another row's Solo, mirroring exactly what the
  engine plays) goes grey, and the pressed button fills with colour. The
  control teaches itself on first press.
- Selecting several blocks needed Shift-click, a chord no child uses — and
  Link only appears once several are selected, so it was hidden behind hidden.
  Dragging a box on empty grid now selects what it touches, live, with the
  band drawn as it grows. A press that doesn't move still places a block
  exactly where it landed (placement moved from press to release to make room
  for the gesture — and as a bonus, a touch scroll that starts on empty grid
  no longer plants a stray block).
- The resize grip on a selected block was a 9px invisible strip; it now draws
  a bright handle.
- The sound editor's numbers ("12000", "1.05") are engineer units and the ear
  is the real readout, so the everyday view hides them; "More" shows them with
  the advanced sliders. Wave keeps its word ("Saw") — there the value *is* the
  information.
- The part being edited shows a ✏️; double-click-to-rename still works but is
  no longer the only way in.

**The overview strip.** Above the timeline sits the whole part in miniature —
every block as a coloured mark, the playhead, and a bright window showing the
slice the timeline can currently see. Click or drag anywhere on it and the
timeline pans there. It exists because the timeline scrolls sideways on longer
parts and nothing said so: the scrollbar hides itself on a Mac, so past the
right edge the song simply didn't exist. (Grown-up music programs carry this
exact strip, so the shape transfers.) The map never owns the truth: dragging
it only sets the timeline's own scroll position and the window follows the
scroll event, so the two cannot disagree however the scrolling happened.
Making sideways scrolling an everyday thing surfaced two dormant bugs, both
fixed: the lane boxes were only as wide as the window (their grids overflowed
on, so a scroll ran out of background and the sticky row headers vanished with
their parent — `.lanes` now spans `max-content`), and the playhead drew on top
of the pinned headers instead of sliding under them.

**The view follows the playhead — with manners.** While the song plays, the
timeline turns pages after the line: the grid holds still (a child places
blocks while it plays, and a grid always sliding under the pointer would make
that a fairground game), and when a line the view was showing walks off the
edge — or wraps home on loop — the view jumps to the page it went to, the
instant flip grown-up programs use. The rule with the manners in it lives in
`ui/follow.ts`, pure and tested: **the view follows a line it was showing,
and never chases one the child scrolled away from.** Scroll elsewhere
mid-play and the view stays put; when the loop carries the line back into
whatever is on screen, following quietly resumes. No toggle to understand —
the behaviour is the manners. Verified by tracing a 12-bar loop live: pages
turned at beats ~18 and ~36, home on the wrap; a view dragged away mid-play
held still for eighteen seconds until the line walked into it and out the
far side. (The flip is deliberately instant rather than animated — smooth
scrolling rides the same animation frames a hidden window suspends, which a
trace caught as a flip that never landed.)

The Sounds panel hit the same wall vertically at 29 sounds: one long list put
more than half the library below the fold at an ordinary window height, with no
scrollbar to say so — and a sound a child can't see is a sound the app doesn't
have. It is now six family headers that are *always* on screen, with one family
open at a time. The panel itself never scrolls, by construction: the open
family flexes into whatever height is left and only its own tile list scrolls
when that runs short, so no window height can ever hide a family. Finding a
sound you don't know exists is six clicks, one per header.

### The first-song walkthrough

`state/tour.ts` holds the steps as plain data and pure functions; `ui/Tutorial.tsx`
draws them. Two rules shape it, and both are load-bearing:

- **It never blocks.** The overlay ignores the mouse entirely (`pointer-events:
  none`) apart from its own card, so the child is always working the real
  controls rather than a pretend copy of them. Nothing is modal, and Escape or
  Close ends it at any point.
- **It advances on what they do**, not on a Next button: beats placed, play
  pressed, keys played. The thing being taught and the thing being done are the
  same thing. Moving on without doing the step stays possible but is styled
  quietly — a big bright *Skip* is an invitation to press it instead.

The "Nice one!" tick between steps is **latched to the step that earned it**,
not to the goal still being met. That distinction is load-bearing: plenty of
goals can un-complete — a child on "Hear it" presses play, sees the tick, and
presses play again to stop, all inside the same second. Tying the tick to the
live goal cancelled it mid-flight along with the timer that moves the
walkthrough on, and left the card frozen on "Nice one!" with its buttons
disabled, permanently, because nothing would ever complete that step again.
Closing the card in that state stranded it for the whole session: pressing **?**
later reopened a dead card with a greyed-out Start. `nextCelebration` in
`state/tour.ts` is that rule, and it is tested directly.

Every goal is measured against a snapshot taken **when that step began**, never
against zero. Otherwise replaying it later (the **?** button) on a song that
already has forty blocks in it would tick six steps off instantly and teach
nothing. The snapshot is tied to its step index so a stale one can't complete
the next step the moment it opens.

**A step can decline to apply.** Recording needs the desktop app, and a step
telling a child in a browser to press a disabled button is worse than no step:
it can never be followed and the walkthrough would sit on it. `stepApplies`
lets the recording step stand down where it makes no sense, and the card moves
straight past it.

**Recordings are counted across the whole song, not just the part on screen** —
unlike every other goal, which counts what the child can see. A take made while
the song plays lands in whichever part was *sounding*, which needn't be the part
being looked at, so counting only the visible one left a child who had done
exactly as asked stuck on the step. That only showed up by walking the
walkthrough with several parts in the song.

It offers itself once, to a child opening the app with no song to come back to,
and is remembered as seen in local storage (`platform/prefs.ts`). Steps point at
controls by `data-tour` attribute rather than by CSS class, so restyling a
button can't silently leave the walkthrough pointing at nothing — and when a
target genuinely isn't there, the card centres itself instead of vanishing.

### The idea helper (💡)

For the child who opens the app and freezes. The 💡 button — it never offers
itself; the walkthrough teaches the app, this one un-sticks a song — asks what
kind of song today's is (a feeling, a style, or "surprise me"), lands on one
of twelve recipes, and then coaches the *order of building*: mood and speed,
then a beat, then the low end, then a tune, then a second part. It rides the
walkthrough's own machinery — the same cards, the same highlight ring on the
real control, the same do-the-thing goals — so each step ticks when the child
actually does it, and the whole flow is plain data in `state/helper.ts`,
tested beside the walkthrough's.

**The line it never crosses, from the brief: it makes no music.** It places no
note, sets no tempo, changes no mood — it points at the control and asks, and
its tips teach conventions in words ("in rock the kick and snare take turns";
"a kick on every beat is the dance-floor heartbeat") the way a person would.
A test enforces the shape: a step is titles, bodies, targets and goals, with
no way to reach the project at all. Recipes name instruments by their library
labels, and a test holds those to the catalog so a renamed voice can't leave
the helper pointing at nothing.

### Testing approach

- **Automated (222 tests):** timing/beat math, snapping, scheduling windows,
  project serialization (round-trip, invalid input, repair, format-1
  migration), arrangement math, undo/redo history, and the pure project edit
  operations, and autosave (round-trip through the slot, corrupt/newer-version
  slots, and the write timing under a continuous stream of edits). Run headlessly
  with Vitest.
- **The scheduler** (`AudioEngine.test.ts`) is driven for real — the engine
  against a stubbed AudioContext and a fake clock, recording every note it hands
  to Web Audio. Pure-function tests can't catch the bugs that live here, which
  are about how each window is *set up*: the downbeat playing on the first pass,
  a note never scheduled twice, a part appearing once per slot it occupies, the
  playhead surviving a length change mid-play, and a starved scheduler declining
  to fire everything it missed at once.
- **The walkthrough** is tested through its pure step functions: that a step
  completes on the right amount of new work, that read-only steps never complete
  themselves, and — the one that matters — that replaying it on a song already
  full of blocks still asks for new work rather than racing to the end.
- **Audio:** verified by offline-rendering each voice and asserting non-silent
  output (done interactively via the dev console; see the debug handle exposed
  on `window.beatbox` in development builds).
- **Manual QA checklist** — see §8.

---

## 7. Feature status

Phase 1 is the foundation slice. Legend: ✅ implemented · 🟡 partial · ⬜ not yet.

| Area | Status | Notes |
| --- | --- | --- |
| Electron desktop shell | ✅ | Window, native menu, Save/Open dialogs. |
| Timeline (bars/beats/grid, snapping) | ✅ | One **Timing** toggle: Tidy (a 1/16 grid) or Free. The finer resolutions still exist in `model/time.ts` and are tested — they just aren't a choice a child is asked to make. |
| Transport (play/pause/stop/loop, BPM, position) | ✅ | Two-clock scheduler; live tempo change. |
| Drum kit (21 voices) | ✅ | Drums, cymbals and hand percussion — bongos, conga, triangle, tambourine, claves, agogo included. All real recordings (CC0 — see §5) except the Kick, which stays synthesized because a drum-machine kick is a built sound. |
| Sampled instruments | ✅ | 26 of the 29 voices play real recordings, pitch-shifted per note with several strengths each. Sampled and synthesized voices sit in the same song and behave identically everywhere else. |
| Place / remove / move notes | ✅ | Click to place, click to remove, drag sideways to move in time and up/down to change the note. A dragged note lands on the scale, so it can't be dropped on a wrong one. |
| Drag sound from library | ✅ | Creates or reuses the voice's track. |
| Per-track volume / mute / solo | ✅ | |
| Per-note velocity | ✅ | Played and recorded notes keep how hard they were hit — where on the key you land sets it. Drawn on every block. Editing a block's strength by hand is a later nicety. |
| Save / load (`.beatbox`) | ✅ | Native dialogs on desktop; download/upload in browser. |
| First-song walkthrough | ✅ | Interactive: highlights the real control, advances when the child actually does it. Offers itself once; the **?** button replays it. |
| Idea helper (💡) | ✅ | For creative block: asks what kind of song (feeling / style / surprise), then coaches the build order — mood, speed, beat, bass, tune, second part — with the walkthrough's cards and highlights. Words and pointers only; it never places a note or touches a setting. |
| Autosave & restore | ✅ | Songs are kept in local storage as they're worked on and the last one comes back at the next start. Local only. |
| Several songs, named | ✅ | The song has a name you can type over, and 🎵 Songs lists everything kept on this computer — click one to open it. **New** keeps the one you were on rather than replacing it. On the desktop each song is a real file in `~/Documents/Beatbox Studio/`. |
| Undo / redo | ✅ | Snapshot-based; keyboard + buttons + menu. |
| Master limiter (ear safety) | ✅ | |
| Microphone recording | ✅ | 🎤 records your voice into the song as a block on an audio track. Saved as an `.m4a` beside the song — small, and it plays on a double-click. Reloaded when the song opens, included in Export. Desktop only — see above. |
| Step sequencer, humanize, per-note velocity | ⬜ | Phase 2. |
| Per-block sound editor | ✅ | Every block has its own sound. Select one or several and shape live (volume, pitch, decay, brightness, ADSR, drive…): simple/advanced split, hover hints, one-undo-per-drag, reset. |
| Chaining (link blocks) | ✅ | Multi-select (drag a box over blocks, Shift-click, or a row's name for all) and **Link** blocks into a group that shares sound **and** length; edit or resize any member and the whole chain follows. Unlink to break. |
| Block length / resize | ✅ | Drag a selected block's right edge to change its length (snaps to grid). |
| Per-track echo | ✅ | One slider per track, on the lane header. Tempo-synced (repeats land an eighth note apart at any tempo) and one control drives level, repeats and feedback together, so there's no way to set it to something unmusical. Same chain live and in Export. |
| Other per-track effects (reverb send, filter) | ⬜ | The per-track chain (`audio/trackChain.ts`) is the place to add them. |
| Melodic instruments (8 voices) | ✅ | Piano (Kawai grand), Bells (glockenspiel, backed low down by vibraphone), Marimba, Vibraphone, Xylophone and Upright Bass are recordings; Synth and Bass stay a pitched subtractive synth — 2 oscillators, ADSR, low-pass filter — because that is what they are. |
| Swap a row's instrument | ✅ | The row's name is a picker. The tune comes with it, landing in the new instrument's own range. Drums stay drums. |
| Scale-snapped note-grid | ✅ | Instrument tracks offer only scale notes (default C major pentatonic), so melodies can't hit a "wrong" note. |
| Change the song's mood | ✅ | Happy / Sad, each with a "more notes" version, from the toolbar. The tune already written moves with it, by scale degree, so it keeps its shape — and flipping between two scales of the same size is exactly reversible. |
| Playable keyboard | ✅ | Play the scale live with mouse/touch (slide across the keys) or two rows of computer keys an octave apart, with an octave shift. Follows the selected melodic track, or pick a voice. |
| Recording a performance | ✅ | Arm ⏺, press play, and what you play on the keyboard is written into the song — tidied to the grid when **Timing** is Tidy, into whichever part is sounding, on the track for that instrument (created if needed). A whole take is one undo step. |
| MIDI input | ⬜ | The keyboard is in; a real MIDI controller would feed the same `noteOn`/`noteOff` and record through the same path. |
| Song sections & arrangement | ✅ | Parts (A/B/…) with their own notes and lengths; a strip of chips shows the running order — click to edit, drag to rearrange, repeat/copy/rename/remove. Song vs. Part play modes. |
| Automation | ⬜ | Phase 6. |
| WAV export | ✅ | Renders the whole song offline through the master chain to a 16-bit stereo `.wav` (native Save dialog on desktop, download in browser). Verified: valid RIFF header, non-silent, no clipping. |
| MP3 export | ✅ | Export's everyday output: about a tenth the size of the WAV, plays anywhere, small enough to send. Encoded in the app by a bundled pure-JS LAME port (lamejs, LGPL — see §5); measured round-trip on a real song: duration intact, level within a third of a decibel. "as WAV" stays beneath it for the full uncompressed audio. |
| Silent auto-update (Windows) | ✅ | At launch the installed app quietly asks the GitHub Releases page for a newer version, downloads in the background, installs on quit. No pop-ups — a child is never handed an update decision. Windows + packaged builds only; offline is treated as normal, never an error. See "Shipping an update" below. |

Nothing above is faked: the disabled Record button is visibly disabled, and
"partial" means exactly what the note says.

---

## 8. Manual QA checklist

- [ ] Play/stop with Space and the transport buttons; playhead tracks audio.
- [ ] Place beats by clicking; remove by clicking a beat.
- [ ] Drag a sound from the library onto the timeline.
- [ ] Drag a beat left/right to move it in time (snaps to grid).
- [ ] Drag a piano block up and down — it changes note, follows the pointer as
      it goes, stops at the ends of the scale, and one undo puts it back.
- [ ] Drag a *drum* block up and down — it stays put and keeps working.
- [ ] Write a tune, switch **Mood** to Sad — the same tune comes back in a minor
      key, every note still distinct. Switch back to Happy: it is exactly the
      tune you wrote.
- [ ] Switch to a "more notes" mood and back — the tune is untouched.
- [ ] Write a tune on the Piano row, then change that row's name box to Bass —
      the same tune plays two octaves down, and the row turns the bass's colour.
- [ ] A drum row's picker offers only drums; a melodic row's offers only
      instruments.
- [ ] Change tempo while playing — song speeds up/slows smoothly.
- [ ] Mute / solo / volume per track behave correctly.
- [ ] Press **M** on a row — the row's grid goes grey and the button fills.
      Press **S** on another — every row but that one goes grey. The grey
      always matches what you can hear.
- [ ] Drag a box on empty grid across several blocks — they light up as the
      box grows, and the editor offers **Link**. A plain click still places a
      block exactly where you clicked.
- [ ] Start a drag on empty grid and release without moving more than a few
      pixels: one block, where you pressed. No stray block after a lasso.
- [ ] The row's name looks like a menu (border and ▾), and picking from it
      swaps the instrument.
- [ ] A selected block shows a bright grip on its right edge; dragging it
      resizes.
- [ ] The current part's chip shows ✏️ — clicking it opens the rename box, and
      double-click still works.
- [ ] The sound editor shows no numbers under the everyday sliders; **More ›**
      reveals them (and Wave always shows its name).
- [ ] Make a part 12 bars long: the strip above the timeline shows its blocks
      in miniature with a bright window over the visible slice. Drag the strip
      — the timeline pans live and the window follows. Scroll the timeline
      with the trackpad — the window follows that too.
- [ ] Scrolled deep into a long part, every row still shows its name, M/S and
      sliders, pinned at the left — and the playhead slides *under* them, not
      across them.
- [ ] While a long part plays, the strip's own playhead crosses it, so the
      line is visible even when the big one is past the edge of the window.
- [ ] Play a 12-bar part and just watch: when the line reaches the right
      edge, the view flips a page after it — and jumps home when the loop
      wraps. The grid never slides while the line is on screen.
- [ ] While it plays, drag the map to a different stretch of the part: the
      view stays where you put it — no snapping back — until the line walks
      into your view and off its far edge, when the pages resume.
- [ ] Undo/redo across add, remove, move, tempo.
- [ ] Save a song, start a new one, reopen the saved file — it returns identical.
- [ ] Switch **Timing** to Free and place a block between two grid lines — it
      stays exactly where you put it. Switch back to Tidy and it lines up again.
- [ ] Loop toggle; song wraps at the end of the last bar.
- [ ] Add a part, put a different beat in it, and switch between parts — each
      shows only its own blocks.
- [ ] "Play again" a part, then edit it: the change is heard everywhere it plays.
      "Copy" a part, then edit the copy: the original is untouched.
- [ ] Drag chips to reorder the song; the slot lands where you dropped it.
- [ ] Rename a part that plays twice (double-click either chip) — one box opens,
      and both chips take the new name.
- [ ] Song vs. Part play modes; the playhead only shows on the part being heard.
- [ ] Stretch the part you're editing *while it plays* — no jump, no silence.
- [ ] Play the keyboard with the mouse and with the computer keys; hold a note
      and it holds. Slide along the keys and they play in turn.
- [ ] Hold keys and then click away / hide the keyboard — nothing keeps ringing.
- [ ] Select a Bass block: the keyboard becomes a bass, low notes and all.
- [ ] Arm ⏺, play the song, play a melody: the notes appear as you play and are
      heard on the next pass round. One undo removes the whole take.
- [ ] Record in Song mode across a part boundary — the notes land in both parts.
- [ ] Arm ⏺ but don't press play: playing the keyboard writes nothing.
- [ ] Turn a track's 🔁 echo up while the song plays — the repeats come in on
      the beat, and turning it back down removes them.
- [ ] Export a song with echo: the repeats are in the file and aren't cut off.
- [ ] Put a few beats in, close the tab, open it again — the song is back and
      the status line says so.
- [ ] Name a song, press **New**, name that one too — 🎵 Songs lists both, and
      clicking the first brings it back exactly.
- [ ] Delete a song you are *not* in: it goes, yours is untouched. Delete the one
      you *are* in: the screen clears to a fresh song and the deleted one stays
      deleted (it must not reappear a second later).
- [ ] In the desktop app: name a song, and a `.beatbox` file of that name
      appears in `~/Documents/Beatbox Studio/`. Rename it — the file moves
      rather than a second one appearing.
- [ ] Name two songs the same thing: both get their own file. Give one a name
      full of `/ : * ?` — it saves, and keeps its real name in the app.
- [ ] Quit and reopen the desktop app: it opens the song you were on.
- [ ] Press 🎤, say something, press it again — a striped block appears, plays
      back in time with the song, and an `.m4a` turns up in the song's
      `.recordings` folder. Double-click that file: it plays.
- [ ] A song recorded by an older build, whose recordings are `.wav`, still
      plays.
- [ ] Quit and reopen: the recording is still there and still sounds.
- [ ] Rename the song — the recordings folder moves with it and the block still
      plays. Delete the song — the folder goes too.
- [ ] Export a song with a recording in it: the voice is in the file — including
      a take that runs well past the end of the song.
- [ ] **Export as audio** produces a `.mp3` a fraction of the WAV's size that
      plays in a normal player; the quiet **as WAV** beneath it still produces
      the full `.wav`. The desktop save dialog offers the right extension for
      each.
- [ ] Press play with a recording in the song, then Stop part-way through: the
      voice stops with it. Press play again: one copy, not two.
- [ ] Delete a recorded block and press undo — it comes back and still sounds.
      Reopen the song afterwards and the file for a block you really did delete
      is gone from the `.recordings` folder.
- [ ] Record, then immediately press New or open another song — come back and
      the take is still there.
- [ ] Press 🎤 and, while it is recording, press New: the microphone stops, and
      the abandoned take does not turn up in the new song.
- [ ] Refuse microphone permission, or record with the microphone muted: the app
      says so plainly and adds no block.
- [ ] Upgrade paths: seed `beatbox.autosave.v1` (oldest) or `beatbox.songs.v1`
      (browser shelf) and restart the desktop app — the songs become files, and
      the one that was open is the one that opens.
- [ ] Press **New** while the song is playing and leave the question on screen
      for a few seconds, then Cancel — the song picks up quietly, with no burst.
- [ ] Open the app with no saved song: the walkthrough offers itself. Work
      through it — each step ticks off when you do the thing, not when you press
      a button, and the app stays fully usable underneath the card.
- [ ] Finish it, reload: it doesn't come back. Press **?**: it does.
- [ ] The walkthrough teaches the microphone, and its last card points at
      something that exists. In a browser, where recording isn't possible, that
      step is passed over rather than shown.
- [ ] Press **?** on a song that already has plenty in it — it still asks for
      new beats rather than skipping ahead.
- [ ] Press **💡** — a question card, not a lecture. Pick a feeling or a
      style: the Mood box lights up and the card asks for that recipe's mood.
      Set it — the step ticks and moves to Tempo; set that — it moves to the
      beat, and placing three beats moves it on again.
- [ ] "Surprise me!" lands on a real recipe, not always the same one.
- [ ] Nothing in the helper ever changes the song by itself: mood, tempo and
      every block are still the child's own clicks.
- [ ] Close the helper mid-flow and press **?** — the walkthrough opens from
      its own first step, unconfused.
- [ ] Play the same key near the bottom and near the top — the bottom is
      noticeably louder. Hit the note *name* printed on the key near the bottom:
      still loud.
- [ ] Every sound in the library makes a noise when you click it, including
      **Big Drum**, **Low Tom**, **Wood Block**, **Conga**, **Claves**,
      **Marimba** and **Upright Bass**.
- [ ] Every family header in the Sounds panel (Drums, Cymbals, Percussion,
      Mallets, Keys, Bass) is visible without scrolling, at any window height.
      Open **Percussion** — the other five headers stay on screen; on a short
      window the tiles scroll inside the open family instead.
- [ ] Play the Bells' bottom three rows and walk up across G5 — the low notes
      ring like real bars now (they are a vibraphone), and the crossover
      doesn't jump in loudness.
- [ ] Write a bassline on the Bass row, then switch the row to **Upright
      Bass** — same tune, now on a plucked real bass.
- [ ] Select a Piano block: the Sound Editor offers Volume, Pitch, Release,
      Brightness, Buzz and Attack — and **no Wave or Detune**. A Snare block
      offers Decay where the Piano offers Release.
- [ ] A Piano block has no **Pitch** slider; a Snare block does. Turn a Snare's
      Pitch down 12 — it plays an octave lower.
- [ ] Drag a Shaker block's **Attack** all the way up: it swells in and gets
      quieter, but it never goes silent.
- [ ] Play the same piano key at every depth from top to bottom, slowly. Every
      strike sounds like a piano — none of them drops into a slurred growl.
- [ ] Put a Crash on the last beat and Export: the file rings the cymbal out
      fully and ends in silence, not with a click.
- [ ] Play a tune high up on the Bells and low down on the Piano — neither turns
      into a chipmunk or a growl.
- [ ] Hit a Piano key gently and hard: the hard one is brighter, not just
      louder.
- [ ] Put eight snares in a row and listen: they are not identical.
- [ ] A drum block one sixteenth wide still rings out naturally rather than
      being chopped off.
- [ ] Put a Kick and a Snare on the same beat: they land together, with no flam.
- [ ] Export a song with sampled instruments in it and play the file — the
      instruments are the real ones, not the synthesized fallbacks.
- [ ] Stretch a Piano block's right edge past the end of its part and Export:
      the note is complete in the file, not cut off part-way.
- [ ] Hold the lowest Bells key for five seconds — it rings out and fades,
      rather than stopping dead part-way.
- [ ] Open a song saved before this change in which a block's Volume had been
      turned up: that block is still louder than the ones beside it, not
      quieter.
- [ ] Open a song saved before the recordings arrived: it plays, with its blocks
      and any sound tweaks intact, and a Bells row still shows its tune spread
      across the grid rather than stacked on the bottom row.
- [ ] In the packaged desktop app (not just `npm run dev`), every instrument
      sounds — that is where the recordings are read a different way.
- [ ] Record a phrase played at different depths — the blocks come back with
      different heights in their strength bar, not all identical.

---

## 9. Known limitations

- Blocks can be moved in **time**, dragged up and down to change the note, and
  resized (right edge) — but not dragged **between tracks**. Handing a whole
  tune to another instrument is covered by the row's instrument picker; what's
  still missing is moving *one* block across, along with the decisions that come
  with it — a drum block has no pitch to land on, and a chained block would have
  to take its chain with it.
- Multi-select: drag a box over blocks on empty grid (the rubber band every
  grown-up music program uses), Shift/Cmd/Ctrl-click one at a time, or click a
  row's name for all of it.
- The Windows installer is **unsigned**: SmartScreen shows its "protected your
  PC" notice on first run (More info → Run anyway, once). Signing needs a paid,
  identity-verified certificate — a decision for later, not a build step.
- `npm run package:win` is pinned to `--x64` on purpose: electron-builder
  silently matches the build machine's chip, and this Mac's is ARM — the
  unpinned build produced a Windows-on-ARM installer most PCs can't run.
- The installer has been built and its contents verified (all 302 recordings,
  byte-identical), but running it needs a real Windows machine — the last
  manual QA step whenever it changes.
- The dev-only `window.beatbox` debug handle exists in development builds only
  (compiled out of production).

---

## 10. Roadmap

Melodic instruments (originally Phase 4) were brought forward and are now in, as
are song sections & arrangement, a playable keyboard, and recording what's played
into the song. The sound library is now full: drums, mallets and keys as the
brief asked, hand percussion, and a real upright bass — 29 voices, 26 of them
recordings. Remaining, roughly following the brief: MIDI input through the
same `noteOn`/`noteOff`, step sequencer & humanize, per-track effect sends,
automation, and polish — accessibility.
Autosave, the first-song walkthrough and per-note velocity are now in.
