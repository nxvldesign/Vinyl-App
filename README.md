# Vinyl Studio

A minimal 3D listening room for a curated vinyl collection. Pick a record from
the music menu (top right) and the deck goes through the real ritual: the
acrylic dust cover swings open on its hinge, the record slides out of its
sleeve and drops onto the spindle, the platter spins up, the cue lever lifts
the tonearm, the arm swings over and lowers into the groove, and the lid
closes. Switching albums keeps the lid open between records. Each track plays its **20-second
highlight** in **spatial audio**.

Light (brushed aluminium on paper) and dark (champagne gold on black) themes
are switched with the hi-fi keys in the header; the choice is remembered.

## Run it

```bash
npm install
npm run dev        # opens on http://localhost:5173 (or the next free port)
npm run build      # production build in dist/
```

Wear headphones. Spatial audio uses HRTF (head-related) panning.

## How it works

| Piece | Where |
| --- | --- |
| 3D deck and its physics: hinged lid, cue lever, sprung tonearm, falling record, platter motor | `src/scene/Deck.tsx` |
| Lighting, camera framing (fits any screen shape), soft shadow | `src/scene/Scene.tsx` |
| Grooves, labels, sleeve art, brushed top plate, rubber mat (generated in canvas) | `src/scene/textures.ts` |
| Audio engine: two alternating players, HRTF speakers, reverb, crackle, mechanical sounds | `src/audio/engine.ts` |
| Highlight finder (shared by the catalog script and the browser) | `src/audio/highlight.js` |
| Your own files: decode, find highlights, play locally | `src/audio/local.ts` |
| State: selection, reel, spatial mode | `src/state/store.ts` |
| Header, music menu and up-next nudge, theme keys, dock, sound label | `src/ui/*` |
| Themes (paper and ink tokens) and layout | `src/styles.css` |

**Sound.** The engine models a real turntable:

- *Surface noise:* soft hiss, motor rumble, small ticks and the odd pop, plus
  two groove flaws that click once per revolution (every 1.8 s at 33⅓). It
  only sounds while the stylus is in the groove, a little louder in the
  lead-in before the music starts.
- *Tone:* a gentle treble roll-off and a touch of low-end warmth, and a slight
  wow and flutter (the pitch drifts about 0.1%, once per revolution).
- *Mechanics:* the stylus touching down, a faint squeak as the record starts
  under it, the record settling on the mat, switch clicks, the lid closing.
- *Spatial:* each stereo channel plays from its own virtual speaker beside the
  deck; the camera is your head, so turning the view moves the sound.
  *Stereo* turns the 3D processing off.

The **Sound** panel in the dock sets the output, volume, surface noise and how
much of the room you hear. **Auto next** plays each track's highlight in turn.

**The 20-second highlight.** Each track's start point is the 20-second window
that's loudest and fullest, and preferably starts where the energy jumps (a
chorus or a drop coming in). Intros and outros are skipped. For the catalog
it's worked out ahead of time from Openverse waveform data. For files you add,
it's worked out in the browser.

## The music

The crate is free, Creative Commons music by independent artists on
[Jamendo](https://www.jamendo.com), found through
[Openverse](https://openverse.org). No API key needed. Licenses that forbid
derivative works (ND) are excluded. Every track shows its credit and license
while it plays.

Most tracks are **CC BY-NC-SA**: fine for a personal or portfolio showcase, but
**not for commercial use** without the artist's permission.

To change the albums, edit the `CRATE` list in `scripts/build-catalog.mjs` and run:

```bash
npm run catalog    # rewrites src/data/catalog.json (responses are cached)
```

Jamendo's audio servers don't allow cross-site loading, which the Web Audio
graph needs. So audio is passed through our own server at `/stream/jamendo`:
the Vite proxy in development, and the rewrite in `vercel.json` once deployed.
Other hosts need an equivalent rewrite.

**Your own music.** Open the music menu and use "Your own files" at the end of
the crate, or drop audio files on it. They're decoded and played locally and never uploaded.

## Controls

Space: play/pause · ← →: previous/next track · Esc: put the record away ·
drag to orbit · scroll to zoom.
