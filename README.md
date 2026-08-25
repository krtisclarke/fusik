# Beatbox Studio

A music-creation studio for curious kids — drag sounds onto a timeline, build a
beat, tweak it, and hear the result instantly. Built as a cross-platform desktop
app (Windows and macOS) using web technology wrapped in Electron.

> **Status:** Working timeline, transport, and **29 sounds** — a full drum kit,
> hand percussion (bongos, conga, triangle, tambourine, claves, agogo),
> mallets (marimba, vibraphone, xylophone, bells), piano, synth, and two
> basses including a real plucked upright — **26 of them real recordings** of
> real instruments, with scale-snapped melodies, **song parts you can arrange**
> (verse/chorus-style, A A B A), per-block sound editing, MP3/WAV export, plus
> save/load, **autosave**, an **interactive walkthrough** for first-timers, and
> undo/redo. See
> [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the full picture and roadmap.

## Install it on Windows

Grab the newest **Beatbox Studio Setup** from the
[Releases page](https://github.com/krtisclarke/fusik/releases) (or, for a
build of any commit, the Actions tab → "Windows installer" → the run's
artifact). Run the installer; because it isn't code-signed, Windows will show
a **"Windows protected your PC"** notice the first time — click **More info**,
then **Run anyway**. That happens once. New installers can be built any time
from the repo's Actions tab ("Run workflow"), or by pushing a `v*` tag, which
also publishes a Release. After that first install the app keeps itself
current on its own: it checks this Releases page quietly at launch and
installs updates in the background.

## Run it (development)

```bash
npm install
npm run app       # launches the desktop app (Electron)
```

Or run it in a browser — identical app, and it sidesteps macOS's Gatekeeper
entirely (handy on a Mac, where the downloaded Electron binary can get blocked):

```bash
npm run dev       # then open Google Chrome to http://127.0.0.1:5173
```

Use **Chrome** (or Edge/Firefox), not Safari: Safari's "HTTPS-Only" setting
refuses plain `http://` local pages. Chrome treats `http://127.0.0.1` as secure,
so everything (including audio) works.

> **macOS note — "Electron is malware":** if macOS kills the app on launch (or
> deletes it outright), it is not malware and not your Mac being broken. Apple
> revokes the notarization of old Electron builds; macOS then treats every copy
> of that exact build as known-bad and removes it. The fix is to move to a
> current Electron — `npm install --save-dev electron@latest`, then
> `node node_modules/electron/install.js` if the binary didn't download. This is
> why the project requires Electron 43 or newer.

## Other commands

```bash
npm test          # run the automated tests
npm run typecheck # TypeScript check, no build
npm run build     # build the web bundle
npm run samples   # rebuild the instrument recordings from the sample library
npm run package:win   # build the Windows installer (works from the Mac; CI also builds it)
npm run package:mac   # build a macOS app bundle
```

## What you can do right now

- **Never used it before?** It shows you. The first time you open it, a short
  walkthrough takes you through making a real song — a drum beat, a tune, playing
  it yourself, and a second part — and each step ticks off when you actually do
  it, not when you press Next. The **?** button in the toolbar starts it again
  any time.
- **Stuck for an idea?** Press **💡**. It asks what kind of song today's is —
  a feeling (happy, spooky, epic…), a style (rock, hip-hop, latin…), or
  "surprise me" — then walks you through building it in the right order: mood,
  speed, beat, bass, tune, chorus. It points at the real buttons and waits for
  you; every note is still yours.

- **Real instruments.** The Piano is a recording of a real grand piano, the
  Bells a real glockenspiel, the Marimba, Vibraphone and Xylophone real mallet
  instruments, the Upright Bass a real plucked contrabass, and most of the
  drums are real drums — recorded properly, several times over, so hitting a
  key harder doesn't just make it louder, it makes it *brighter*, the way a
  real instrument does. Eight snares in a row don't sound like eight copies of
  one snare, because they aren't.
- **Sounds live in families.** The list on the left shows every family —
  Drums, Cymbals, Percussion, Mallets, Keys, Bass — all the time; click a
  family to open it. Nothing hides below the fold, so a sound you've never
  met is one click from being found.
- **Drums:** click an empty spot in a track row to drop a beat; click a beat to
  remove it. Bongos, conga, triangle, tambourine, claves and agogo included.
- **Instruments:** drop a Piano, Marimba, Bells or either Bass in, then click
  its note-grid to write a melody or bassline. The grid only offers notes from
  a musical scale, so whatever you place sounds right together.
- Drag a sound from the left onto the timeline, or click it to hear it.
- **Wrong note?** Drag the block up or down to change it — it slides through the
  scale, so wherever you drop it still sounds right. Drag sideways to move it in
  time.
- **Grab a bunch at once.** Drag a box over blocks on empty grid and they all
  select — shape them together, or **Link** them so they keep the same sound
  and length. Each row's **M** turns it off (it goes grey so you can see it's
  off) and **S** plays it alone.
- **Parts:** the strip above the timeline is your song's running order. Add a
  new part, play a part again (A A B A!), copy one to tweak, drag chips to
  rearrange, double-click to rename. Play the whole **Song** or loop just the
  **Part** you're working on.
- **The little map.** Above the timeline is the whole part in miniature, with
  a bright window showing the bit you're looking at. On a long part, drag the
  map and the timeline follows — so nothing is ever lost past the edge of the
  screen.
- **The view follows the song.** While it plays, the timeline turns the page
  when the playhead reaches the edge, and jumps back to the start when the
  loop comes round. Scroll somewhere else to work and it politely stays where
  you put it until the line comes back to you.
- **Play it yourself:** the keyboard along the bottom plays the notes of the
  scale, so nothing you hit sounds wrong. Use the mouse (hold and slide along the
  keys) or the computer keys — `z x c v b…` for the lower octave, `a s d f g…`
  for the upper. Pick any melodic instrument — Piano, Bells, Marimba,
  Vibraphone, Xylophone, Synth or either Bass — or select a block on the
  timeline and the keyboard follows it. The 🎹 button hides it.
- **Hit it hard or gently.** Where you land on a key decides how strong the note
  is — near the bottom is a hard hit, near the top a soft one. Record a melody
  and it keeps every light and heavy note exactly as you played it.
- **Record your own voice.** Press 🎤, sing or beatbox, press it again. What you
  sang becomes a block in your song that plays along with everything else — and
  it's saved as an ordinary sound file next to the song. (Desktop app only.)
- **Record what you play:** press ⏺ so it glows red, press play, and whatever you
  play on the keyboard is written into the song, tidied up to the grid. Press ⏺
  again to stop. One undo takes the whole take back.
- **Try it on something else.** Click a row's name and pick a different
  instrument — your tune moves over as it is, so the melody you wrote on the
  piano comes out on the bells, or way down low on the bass.
- **Change the mood.** The Mood box turns the whole song Happy or Sad — and your
  tune comes with it, note for note, so it's still your tune in a new mood.
  Switch back and you get exactly what you wrote.
- Press **Space** to play/stop. The song loops by default.
- Change the tempo, and mute/solo/volume per track.
- **Timing** is either **Tidy** — blocks line up with the beat and what you play
  gets straightened out — or **Free**, where everything lands exactly where you
  put it.
- **Echo:** each row has a 🔁 slider. Turn it up and that sound repeats in time
  with the song — great on a hi-hat or a bass note. All the way left is off.
- **Your songs keep themselves.** Close the tab or shut the laptop and your song
  is there when you come back — no saving needed. Give it a name in the box at
  the top, and **🎵 Songs** lists everything you've made: click one to open it.
  Starting a new song doesn't lose the old one. **Save to a file** still puts a
  copy somewhere you choose, to keep or to share.
- **Where your songs live.** In the desktop app they're ordinary files in
  `Documents/Beatbox Studio` — one per song, named after it. You can copy them,
  back them up, or move them to another computer.
- **Ctrl/Cmd+Z** to undo, **Ctrl/Cmd+S** to save, **Ctrl/Cmd+O** to open.
- **Export** turns the song into an `.mp3` — small enough to text or email, and
  it plays anywhere. (A quiet "as WAV" option underneath gives the full
  uncompressed file for grown-up audio tools.)

## Where the sounds come from

Most instruments are real recordings, from two libraries by the same people:
the **Versilian Community Sample Library** and — for the upright bass —
**VSCO 2 Community Edition**, both released by Versilian Studios under **CC0**,
which puts them in the public domain. No royalties, no attribution, no terms: a
song you export from here is yours to share with anybody, and nobody has to
read a licence first. Every file that ships is listed in
[docs/asset-manifest.json](docs/asset-manifest.json) with where it came from
and a hash of it.

The Synth, the Bass and the Kick are still built by the app rather than
recorded, because that is genuinely what those instruments are — a synth is a
synth, and a drum-machine kick is a made sound, not a recorded one. Both kinds
sit in the same song and work exactly the same way.

Every sound stays fully tweakable either way: pick a block and shape its volume,
pitch, brightness, decay and grit.
