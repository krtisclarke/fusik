# Beatbox Studio

A music-creation studio for curious kids — drag sounds onto a timeline, build a
beat, tweak it, and hear the result instantly. Built as a cross-platform desktop
app (Windows and macOS) using web technology wrapped in Electron.

> **Status:** Working timeline, transport, a synthesized drum kit **and melodic
> instruments** (piano, synth, bells, bass) with scale-snapped melodies, plus
> save/load and undo/redo. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the
> full picture and roadmap.

## Run it (development)

```bash
npm install
npm run app       # launches the desktop app (Electron)
```

Or run it in a browser — identical app, and it sidesteps macOS's Gatekeeper
entirely (handy on a Mac, where the downloaded Electron binary can get blocked):

```bash
npm run web       # opens your browser to the app automatically
```

> **macOS note:** if `npm run app` is blocked with a "malware" / "revoked"
> message, that's macOS refusing the unsigned Electron binary, not real malware.
> Either use `npm run web` above, or move this project out of your iCloud
> Documents folder and re-sign Electron (`xattr -cr` + `codesign --force --deep
> -s -` on `node_modules/electron/dist/Electron.app`).

## Other commands

```bash
npm test          # run the automated tests
npm run typecheck # TypeScript check, no build
npm run build     # build the web bundle
npm run package:win   # build a Windows installer (needs Windows or CI)
npm run package:mac   # build a macOS app bundle
```

## What you can do right now

- **Drums:** click an empty spot in a track row to drop a beat; click a beat to remove it.
- **Instruments:** drop a Piano, Synth, Bells or Bass in, then click its note-grid to
  write a melody or bassline. The grid only offers notes from a musical scale, so
  whatever you place sounds right together.
- Drag a sound from the left onto the timeline, or click it to hear it.
- Press **Space** to play/stop. The song loops by default.
- Change the tempo, mute/solo/volume per track, and snap to a musical grid.
- **Ctrl/Cmd+Z** to undo, **Ctrl/Cmd+S** to save, **Ctrl/Cmd+O** to open.

Every sound is synthesized by the app itself, so there are no audio files to
license and every sound is fully tweakable.
