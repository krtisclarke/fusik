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
loop length and scheduling the occurrences that land in the window.

**Live editing:** the scheduler re-reads the current project every wake, so a
note added, moved, muted, or a tempo change is heard on the next ~100 ms window
— the "change it, hear it" feedback that defines the app.

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

Plain, pretty-printed JSON — human-readable and diff-friendly. Shape (v1):

```jsonc
{
  "formatVersion": 1,
  "name": "My Song",
  "bpm": 120,
  "timeSignature": { "numerator": 4, "denominator": 4 },
  "lengthBars": 4,
  "scaleRoot": 0,              // 0 = C; the root of the melodic scale
  "scaleId": "majorPentatonic",
  "tracks": [
    {
      "id": "trk_…", "name": "Kick", "type": "drum", "color": "#ef4444",
      "instrument": { "voiceId": "kick", "params": {} },
      "gain": 0.85, "muted": false, "solo": false,
      "notes": [
        { "id": "note_…", "startBeat": 0, "lengthBeats": 1, "velocity": 0.8, "params": { "decay": 0.6 } },
        { "id": "note_…", "startBeat": 2, "lengthBeats": 1, "velocity": 0.8, "params": { "decay": 0.6 }, "groupId": "grp_…" }
      ]
    },
    {
      "id": "trk_…", "name": "Piano", "type": "instrument", "color": "#60a5fa",
      "instrument": { "voiceId": "piano", "params": {} },
      "gain": 0.7, "muted": false, "solo": false,
      "notes": [ { "id": "note_…", "startBeat": 0, "lengthBeats": 1, "velocity": 0.8, "pitch": 72, "params": {} } ]
    }
  ]
}
```

- `type` is `"drum"` or `"instrument"`. Instrument notes carry a `pitch` (MIDI
  number); drum notes omit it.

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

### Testing approach

- **Automated (30 tests):** timing/beat math, snapping, project serialization
  (round-trip, invalid input, repair), undo/redo history, and the pure project
  edit operations. Run headlessly with Vitest.
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
| Timeline (bars/beats/grid, snapping) | ✅ | Snap bar→1/16, or off. |
| Transport (play/pause/stop/loop, BPM, position) | ✅ | Two-clock scheduler; live tempo change. |
| Synthesized drum kit (12 voices) | ✅ | Membrane / noise / blip primitives. |
| Place / remove / move notes | ✅ | Click to place, click to remove, drag to move in time. |
| Drag sound from library | ✅ | Creates or reuses the voice's track. |
| Per-track volume / mute / solo | ✅ | |
| Velocity (visual) | 🟡 | Shown per note; per-note velocity **editing** is Phase 2. |
| Save / load (`.beatbox`) | ✅ | Native dialogs on desktop; download/upload in browser. |
| Undo / redo | ✅ | Snapshot-based; keyboard + buttons + menu. |
| Master limiter (ear safety) | ✅ | |
| Microphone recording | ⬜ | Button present but disabled (Phase 5). |
| Step sequencer, humanize, per-note velocity | ⬜ | Phase 2. |
| Per-block sound editor | ✅ | Every block has its own sound. Select one or several and shape live (volume, pitch, decay, brightness, ADSR, drive…): simple/advanced split, hover hints, one-undo-per-drag, reset. |
| Chaining (link blocks) | ✅ | Multi-select (Shift-click, or a row's name for all) and **Link** blocks into a group that shares sound **and** length; edit or resize any member and the whole chain follows. Unlink to break. |
| Block length / resize | ✅ | Drag a selected block's right edge to change its length (snaps to grid). |
| Per-track effects rack (echo/delay/reverb sends) | ⬜ | Master reverb exists; per-sound effect chains are the next Phase-3 step. |
| Melodic instruments (piano, synth, bells, bass) | ✅ | Pitched subtractive synth: 2 oscillators, ADSR, low-pass filter. |
| Scale-snapped note-grid | ✅ | Instrument tracks offer only scale notes (default C major pentatonic), so melodies can't hit a "wrong" note. |
| Playable keyboard + MIDI input | ⬜ | Play live, not just place notes — the natural next step. |
| Sections / arrangement / automation | ⬜ | Phase 6. |
| WAV/MP3 export | ⬜ | Phase 7 (via OfflineAudioContext). |

Nothing above is faked: the disabled Record button is visibly disabled, and
"partial" means exactly what the note says.

---

## 8. Manual QA checklist

- [ ] Play/stop with Space and the transport buttons; playhead tracks audio.
- [ ] Place beats by clicking; remove by clicking a beat.
- [ ] Drag a sound from the library onto the timeline.
- [ ] Drag a beat left/right to move it in time (snaps to grid).
- [ ] Change tempo while playing — song speeds up/slows smoothly.
- [ ] Mute / solo / volume per track behave correctly.
- [ ] Undo/redo across add, remove, move, tempo.
- [ ] Save a song, start a new one, reopen the saved file — it returns identical.
- [ ] Change snap resolution; placement follows it.
- [ ] Loop toggle; song wraps at the end of the last bar.

---

## 9. Known limitations

- Blocks can be moved in **time** and resized (right edge), but not yet dragged
  vertically to change pitch, nor between tracks — to change a note's pitch,
  remove it and click the row you want. A planned nicety.
- Multi-select uses Shift/Cmd/Ctrl-click (or a row's name for all of a row).
  A more touch/kid-friendly select (lasso, link-mode) is a candidate follow-up.
- Packaging a signed Windows installer requires a Windows machine or CI; the app
  runs from source on macOS today.
- The dev-only `window.beatbox` debug handle exists in development builds only
  (compiled out of production).

---

## 10. Roadmap

Melodic instruments (originally Phase 4) were brought forward and are now in.
Remaining, roughly following the brief: a playable on-screen/MIDI keyboard so
notes can be performed live, not just placed; step sequencer & humanize; the
sound editor (ADSR/filters/effects with waveform views — the instrument
parameters already exist, they just need UI); microphone recording; song
sections, arrangement & automation; and polish — onboarding, more voices,
accessibility, export, autosave.
