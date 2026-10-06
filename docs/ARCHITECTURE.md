# emmm architecture

```
 ┌──────────────── UI (src/ui, src/main.ts) ────────────────┐
 │ M's six windows, edit windows, menus, keyboard, display   │
 │ loop (requestAnimationFrame) — draws, never schedules      │
 └───────────────┬───────────────────────────────▲──────────┘
                 │ calls                          │ change notifications,
                 ▼                                │ visual event queue
 ┌──────────────── Session (src/app/session.ts) ────────────┐
 │ transport · Hold/Do · Snapshots · Slideshows · conducting │
 │ Input Control System · recording · echo · Movies          │
 │ output routing: M Output Channel → device + MIDI channel  │
 └───┬─────────────────┬─────────────────────┬──────────────┘
     │                 │                     │
     ▼                 ▼                     ▼
 Engine           Scheduler              MIDI layer
 src/engine       src/scheduler          src/midi
 pure, ticks      ticks ↔ ms, look-ahead  Web MIDI, messages, SMF
     ▲                                        │
     └──── Composition (plain data) ◄──── Persistence (src/persistence)
```

## Layers

### Composition (`src/engine/types.ts`)
All musical state as plain, JSON-serialisable data: six Pattern Groups of four Patterns,
the Variables (each `{ active, positions[6], marked[6] }`), the global Rhythm/Legato value
tables, per-voice Patterns-window settings, tempo, conducting state, snapshots, slideshows,
options, MIDI assignment and the random **seed**. Nothing in it refers to the DOM or to time.

### Engine (`src/engine/engine.ts`)
`MEngine` turns the Composition into events. It works in **M ticks** (96 per quarter) on a
master timeline that starts at 0 on Start and stops advancing while paused.

* `render(toTick)` returns every event up to `toTick`, in time order: note-ons, note-offs,
  program changes, per-voice **step** events (for display) and **change** events (when a
  quantized action changed the composition).
* Each voice keeps runtime state (`VoiceRuntime`): its origin (sync tick + phase), its own
  clock (time before time distortion), the pattern read position, three cycle counters, a
  seeded RNG, and keyboard transposition.
* The engine reads the Composition **live** at each event, so edits are heard at the next note
  — the same design as M's interrupt routine reading global variables.
* The event routine is `voiceEvent` (M-BEHAVIOUR §4): rhythm → legato → accent cycle reads,
  note-order choice, density coin, velocity, transposition, orchestration, duration. The order
  of random draws is fixed so results are reproducible.
* Time Distortion (`timeDistortion.ts`): events are placed in voice clock time and warped to
  real ticks through the inverse of the user's map.
* Quantized actions (`perform`/`schedule`) run inside `render` at their exact tick, so a
  quantized Snapshot lands precisely on the bar even though the UI click happened earlier.
* Note overlap: re-attacking a sounding pitch on the same channel sends a note-off first and
  cancels the stale pending off.

Other engine modules: `patternOps` (Pattern/Edit menu operations), `recorder` (record modes),
`conducting` (baton → Positions/tempo/continuous values), `snapshots`, `inputControl`
(key map + two-step state machine), `rng` (sfc32), `defaults`, `constants`.

The engine has no dependencies on browser APIs and is tested directly with Vitest.

### Scheduler (`src/scheduler`)
`TickClock` maps ticks to `performance.now()` milliseconds piecewise-linearly (each tempo
change re-anchors). `Scheduler` runs a timer in a **Web Worker** (not throttled in background
tabs) every 10 ms; each wake-up renders events up to *now + 60 ms* and hands them over with
exact timestamps. MIDI output uses `MIDIOutput.send(data, timestamp)`, so timing accuracy is
set by the timestamps, not by when JavaScript runs. It also generates MIDI clock (24 ppq ×
sync ratio) and metronome clicks. `limitTick` lets Tap Conduct hold the music until the next
tap. The worker is created when the app loads (it can take a moment to boot on a cold page),
and until its first tick arrives a main-thread timer stands in, so the first notes after Start
are never held up.

Rendering cost matters for timing too, because Web MIDI sends happen on the main thread: each
window is its own compositing layer (`will-change: transform`), so a flashing control repaints
only its window.

### MIDI (`src/midi`)
* `webmidi.ts` — device discovery, hot-plug, input listeners, graceful fallback when Web MIDI
  is missing or denied.
* `messages.ts` — encoders/parser.
* `smf.ts` — Standard MIDI File writer (Movies, 96 ppq + tempo map) and reader (import into
  Patterns with M's chord/rest/quantize options).
* `src/audio/monitor.ts` — a small internal WebAudio "monitor" and the metronome click. It is a
  test aid: M Output Channels can be routed to it in Midi Assignment.

### Session (`src/app/session.ts`)
The performance controller: everything a gesture can do. Holds Hold/Do state, the current
snapshot and its undo, slideshow recording/playback (playback events are scheduled into the
engine at exact ticks), movie capture, MIDI-input routing per voice (Src channel; Use =
record / keyboard transpose / Input Control / echo map; Echo-Thru-Orchestration), tap tempo /
tap conduct, step advance, mouse advance and output routing.

### UI (`src/ui`)
Plain TypeScript + DOM/SVG, no framework. The whole screen is laid out in a fixed **720 × 470
logical-pixel** space (the "M screen") and scaled with a CSS transform to fit the window, so
proportions stay those of a 1-bit Macintosh screen at any size.

* `widgets.ts` — Numerical, RangeBar, ConductArrow, Picture Matrix, MWindow.
* `choice.ts` — Variable Position choice bar; `minis.ts` — miniature representations.
* `mainWindows.ts` — the six main windows; `varEditors.ts`, `cyclicEditor.ts`,
  `patternEditor.ts`, `otherWindows.ts` — edit windows and dialogs.
* The display loop consumes the Session's queue of timestamped events when their time comes
  (pattern bricks flash, cycle steps blink, monitor log) and redraws only when something
  changed.

### Hosting
The build is a static site. `vite.config.ts` uses a relative base by default; the GitHub Pages
workflow builds with `--base=/<repository>/`. A small build-time plugin renders
`docs/QUICK-START.md` (with its images) to `docs/quick-start.html`, which the in-app Help and
About windows link to. No server, no third-party requests.

### Persistence (`src/persistence`)
`format.ts`: `{ format: "emmm", version, mode, savedAt, composition, ui }` JSON. `migrate`
upgrades old versions and fills missing fields from defaults; `validate` clamps values.
`storage.ts`: autosave to `localStorage` (every ~1.5 s after a change), a named browser
library, download/upload of `.emmm.json`, and the movie `.mid` download.

## Determinism
A session seed (default 38291) seeds independent sfc32 streams per voice, the robot
conductor and editing (scrambles). Pressing Start from stopped re-seeds the playback streams,
so the same document + seed + gestures reproduce the same output. Tests check that output does
not depend on how finely `render` is called.

## Classic and Extended
Extended features live in `src/extended/` and the `Composition.extended` settings object
(`enabled` is false by default). The Session consults them only at the MIDI-input boundary
(`extendedRealtime`, `extendedLearn`); the engine never reads them, so Classic note generation
cannot be affected — a test checks this. New Extended features should follow the same rule:
separate modules, fields added through the migration path, inert when disabled. The Extended
window is clearly labelled "not part of Classic M".
