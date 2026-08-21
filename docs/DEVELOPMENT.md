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
- **`platform/`** — save/open, abstracted over "desktop (Electron)" vs
  "browser (download/upload)" so the app runs in both.
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
peaks at ~0.97 with zero clipped samples. Gain staging is conservative (velocity
and track volume scale voices down further before the master).

### Synthesis

All sounds are synthesized (`audio/synth.ts`) from a few primitives:

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
pluck. They differ only by their default parameters (waveform, envelope, filter,
octave range). A note's MIDI pitch becomes the oscillator frequency; its length
becomes the envelope gate.

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
  with *Opus* inside an MP4, which nothing outside a browser will open. There is
  no MP3 option; the engine cannot encode it and would need a bundled library to
  offer one. (MP3's patents expired in 2017, so licensing is no longer the
  obstacle an earlier note here claimed.)

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
measuring peak/RMS (all voices produce real signal; kick is fullest at ~1.0
pre-limiter, cymbals/percussion sit lower).

---

## 4. Project file format (`.beatbox`)

Plain, pretty-printed JSON — human-readable and diff-friendly. Shape (v2):

```jsonc
{
  "formatVersion": 3,
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

**There are no third-party audio assets.** Every sound is generated by the app's
own synthesis engine. This sidesteps sample-licensing entirely — nothing to
attribute, nothing that can't be redistributed. If sampled assets are ever
added, they must be CC0 or equivalent and recorded in an asset manifest
(name, source, license, attribution, URL, hash); prefer CC0 so redistribution
stays trivial.

---

## 6. Build, run, test

```bash
npm install
npm run app         # desktop app (Electron) against the dev server
npm run dev         # web UI only, http://localhost:5173
npm test            # unit tests (Vitest)
npm run typecheck   # tsc --noEmit
npm run build       # typecheck + build web bundle to dist/
npm run package:win # NSIS installer (run on Windows or CI)
npm run package:mac # macOS app bundle
```

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

It offers itself once, to a child opening the app with no song to come back to,
and is remembered as seen in local storage (`platform/prefs.ts`). Steps point at
controls by `data-tour` attribute rather than by CSS class, so restyling a
button can't silently leave the walkthrough pointing at nothing — and when a
target genuinely isn't there, the card centres itself instead of vanishing.

### Testing approach

- **Automated (168 tests):** timing/beat math, snapping, scheduling windows,
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
| Synthesized drum kit (12 voices) | ✅ | Membrane / noise / blip primitives. |
| Place / remove / move notes | ✅ | Click to place, click to remove, drag sideways to move in time and up/down to change the note. A dragged note lands on the scale, so it can't be dropped on a wrong one. |
| Drag sound from library | ✅ | Creates or reuses the voice's track. |
| Per-track volume / mute / solo | ✅ | |
| Per-note velocity | ✅ | Played and recorded notes keep how hard they were hit — where on the key you land sets it. Drawn on every block. Editing a block's strength by hand is a later nicety. |
| Save / load (`.beatbox`) | ✅ | Native dialogs on desktop; download/upload in browser. |
| First-song walkthrough | ✅ | Interactive: highlights the real control, advances when the child actually does it. Offers itself once; the **?** button replays it. |
| Autosave & restore | ✅ | Songs are kept in local storage as they're worked on and the last one comes back at the next start. Local only. |
| Several songs, named | ✅ | The song has a name you can type over, and 🎵 Songs lists everything kept on this computer — click one to open it. **New** keeps the one you were on rather than replacing it. On the desktop each song is a real file in `~/Documents/Beatbox Studio/`. |
| Undo / redo | ✅ | Snapshot-based; keyboard + buttons + menu. |
| Master limiter (ear safety) | ✅ | |
| Microphone recording | ✅ | 🎤 records your voice into the song as a block on an audio track. Saved as an `.m4a` beside the song — small, and it plays on a double-click. Reloaded when the song opens, included in Export. Desktop only — see above. |
| Step sequencer, humanize, per-note velocity | ⬜ | Phase 2. |
| Per-block sound editor | ✅ | Every block has its own sound. Select one or several and shape live (volume, pitch, decay, brightness, ADSR, drive…): simple/advanced split, hover hints, one-undo-per-drag, reset. |
| Chaining (link blocks) | ✅ | Multi-select (Shift-click, or a row's name for all) and **Link** blocks into a group that shares sound **and** length; edit or resize any member and the whole chain follows. Unlink to break. |
| Block length / resize | ✅ | Drag a selected block's right edge to change its length (snaps to grid). |
| Per-track echo | ✅ | One slider per track, on the lane header. Tempo-synced (repeats land an eighth note apart at any tempo) and one control drives level, repeats and feedback together, so there's no way to set it to something unmusical. Same chain live and in Export. |
| Other per-track effects (reverb send, filter) | ⬜ | The per-track chain (`audio/trackChain.ts`) is the place to add them. |
| Melodic instruments (piano, synth, bells, bass) | ✅ | Pitched subtractive synth: 2 oscillators, ADSR, low-pass filter. |
| Swap a row's instrument | ✅ | The row's name is a picker. The tune comes with it, landing in the new instrument's own range. Drums stay drums. |
| Scale-snapped note-grid | ✅ | Instrument tracks offer only scale notes (default C major pentatonic), so melodies can't hit a "wrong" note. |
| Change the song's mood | ✅ | Happy / Sad, each with a "more notes" version, from the toolbar. The tune already written moves with it, by scale degree, so it keeps its shape — and flipping between two scales of the same size is exactly reversible. |
| Playable keyboard | ✅ | Play the scale live with mouse/touch (slide across the keys) or two rows of computer keys an octave apart, with an octave shift. Follows the selected melodic track, or pick a voice. |
| Recording a performance | ✅ | Arm ⏺, press play, and what you play on the keyboard is written into the song — tidied to the grid when **Timing** is Tidy, into whichever part is sounding, on the track for that instrument (created if needed). A whole take is one undo step. |
| MIDI input | ⬜ | The keyboard is in; a real MIDI controller would feed the same `noteOn`/`noteOff` and record through the same path. |
| Song sections & arrangement | ✅ | Parts (A/B/…) with their own notes and lengths; a strip of chips shows the running order — click to edit, drag to rearrange, repeat/copy/rename/remove. Song vs. Part play modes. |
| Automation | ⬜ | Phase 6. |
| WAV export | ✅ | Renders the whole song offline through the master chain to a 16-bit stereo `.wav` (native Save dialog on desktop, download in browser). Verified: valid RIFF header, non-silent, no clipping. |
| MP3 export | ⬜ | WAV is in. MP3 needs a bundled encoder — the engine can't make one — though the patents expired in 2017, so it's a size question, not a legal one. Recordings already use AAC, which needs no extra library. |

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
- [ ] Press **?** on a song that already has plenty in it — it still asks for
      new beats rather than skipping ahead.
- [ ] Play the same key near the bottom and near the top — the bottom is
      noticeably louder. Hit the note *name* printed on the key near the bottom:
      still loud.
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
- Multi-select uses Shift/Cmd/Ctrl-click (or a row's name for all of a row).
  A more touch/kid-friendly select (lasso, link-mode) is a candidate follow-up.
- Packaging a signed Windows installer requires a Windows machine or CI; the app
  runs from source on macOS today.
- The dev-only `window.beatbox` debug handle exists in development builds only
  (compiled out of production).

---

## 10. Roadmap

Melodic instruments (originally Phase 4) were brought forward and are now in, as
are song sections & arrangement, a playable keyboard, and recording what's played
into the song. Remaining, roughly following the brief: MIDI input through the
same `noteOn`/`noteOff`, step sequencer & humanize, per-track effect sends,
automation, and polish — more voices, accessibility.
Autosave, the first-song walkthrough and per-note velocity are now in.
