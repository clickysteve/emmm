# emmm

**emmm** is a modern recreation and continuation of **M**, the interactive composing and
performing system by David Zicarelli, Joel Chadabe, John Offenhartz and Antony Widoff
(Intelligent Music, 1986–87). It runs in the browser and plays external MIDI hardware
through Web MIDI.

It is not a generic generative sequencer: it reproduces M's model — four Patterns of notes,
transformed into Voices by Variables with six Positions each, performed by switching
Positions, conducting, Snapshots and Slideshows — and M's 1-bit, control-panel look.

emmm is independent, newly written code. It contains no code, bitmaps, fonts or manuals from
M. See [docs/PROVENANCE.md](docs/PROVENANCE.md).

## Run it

Requires Node 18+.

```bash
npm install
```

```bash
npm run dev
```

Open <http://localhost:5199> in Chrome, Edge, Opera or Firefox (browsers with Web MIDI).
Allow MIDI access when asked. Safari has no Web MIDI; emmm still runs there using the
internal monitor.

Other commands:

```bash
npm test
```

```bash
npm run build
```

`npm run build` writes a static site to `dist/` (any static web server will do; Web MIDI
needs `https` or `localhost`).

## First steps

1. **Start** (Space, or ▶ in the Conducting window). The demo document "Jumping In" plays
   four voices.
2. Click Positions in the **Variables** and **Cyclic Variables** windows while it plays.
   Double-click a Position to open its edit window; edits are heard immediately.
3. **Midi Assignment…** (File menu): choose your MIDI device for the 16 M Output Channels
   ("All outputs →" sets them all at once). With no device, channels go to the internal
   *emmm monitor* so you can still hear something.
4. **Orchestration** (Midi window) decides which output channels each voice plays on.
5. Double-click a voice's **Select** box (Patterns window) to open the **Pattern Editor** and
   click in notes. Or set a voice's **Use** to **R** and play into it from a MIDI keyboard.
6. **Snapshots**: press Hold/Do (camera, or Backspace), click some Positions, then click a
   Snapshot box (or type a letter A–Z). Type the letter later to recall it.
7. **File ▸ Save** downloads a `.emmm.json` document; **Open…** loads one. Work is also
   autosaved in the browser.

Keyboard: Space Start/Sync · Return Stop · Tab Pause · Backspace Hold/Do · A–Z Snapshots
(Shift: with Sync) · 1–9 Slideshows (Alt: record) · 0 stop Slideshow · `\` loop · Caps Lock or
⌘⌥ + mouse movement = Mouse Advance · ⌘. All Notes Off · ⌘S save · ⌘O open.

Mouse: numericals — press in the top half to increase, bottom half to decrease, or drag
outside the box; Shift-click copies the last value. Range bars — drag out a range, click for a
single value. Conducting arrows — click to enable, hold to rotate, or drag around them.
Positions — drag onto another to swap, Alt-drag to copy, Shift-click to quantize.

URL options: `?demo` loads the demo, `?new` an empty document, `?seed=12345` sets the seed.

## Status

The Classic engine and interface are functional: all of M's Variables, cyclic variables, Time
Distortion, conducting (incl. continuous and robot), Hold/Do, Snapshots, Slideshows, the Input
Control System, recording modes, Pattern Editor and menus, Movies (MIDI file export), MIDI
file import (into Patterns or as a play-along Sequence), Web MIDI I/O with timestamped scheduling, save/load and seeded randomness.
117 automated tests (incl. a seeded fuzz test and worked examples) cover the engine, timing maths, persistence, session logic and Extended features.

**Extended** (Options ▸ Extended…, off by default) has begun: MIDI clock input, MIDI Learn
for controllers, and CC Cycles (M-style cyclic distributions driving MIDI controllers). It
never changes how Classic generates notes.

Not yet: verification against the original program in an emulator
(several behaviours are reasoned from documentation — see
[docs/UNCERTAINTIES.md](docs/UNCERTAINTIES.md)), and the Extended mode.

## Documentation

* [docs/RESEARCH.md](docs/RESEARCH.md) — what we learnt about M, and from where
* [docs/M-BEHAVIOUR.md](docs/M-BEHAVIOUR.md) — the reconstructed behavioural specification
* [docs/EXAMPLES.md](docs/EXAMPLES.md) — worked input → output examples (also tests)
* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how emmm works
* [docs/UNCERTAINTIES.md](docs/UNCERTAINTIES.md) — what still needs checking against M
* [docs/ROADMAP.md](docs/ROADMAP.md) — remaining Classic work and Extended ideas
* [docs/PROVENANCE.md](docs/PROVENANCE.md) — sources and licensing notes
