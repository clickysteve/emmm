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
* `clockIn.ts` — the MIDI clock follower (trimmed-mean tempo, loss after 400 ms, phase re-base
  on recovery, status Internal / Waiting / Running / Lost). Used by `Session.clockRealtime`
  whenever `midi.clockIn.enabled` — independent of Extended (it lived in `extended/` until
  document format 4).
* `smf.ts` — Standard MIDI File writer (Movies, 96 ppq + tempo map) and reader (import into
  Patterns with M's chord/rest/quantize options).
* `src/audio/monitor.ts` — a small internal WebAudio "monitor" and the metronome click. It is a
  test aid: M Output Channels can be routed to it in MIDI Settings.

### Session (`src/app/session.ts`)
The performance controller: everything a gesture can do. Holds Hold/Do state, the current
snapshot and its undo, slideshow recording/playback (playback events are scheduled into the
engine at exact ticks), movie capture, MIDI-input routing per voice (Src channel; Use =
record / keyboard transpose / Input Control / echo map; Echo-Thru-Orchestration), tap tempo /
tap conduct, step advance, mouse advance and output routing.

It also owns **Undo / Redo** (`app/history.ts`): whole-document snapshots taken when an edit
has settled (300 ms after the last change, or when the pointer is released), bounded to 100
steps. `Session.docState()` defines what Undo sees — everything except performance state
(active Positions, tempo, Baton, continuous conducting values, MIDI routing, the clock-input
settings), so undoing never jumps the music and playing never fills the history. Undo writes
back in place (`app/assign.ts`), keeping every object identity, so it is safe while playing.
Changes named in `TRANSIENT` (transport, Baton, view changes…) never create history.

**MIDI clock out** (`Options ▸ Send Clock`): one stream to one device; Start / clock / Stop,
Stop on Pause and Continue on resume; Stop is stamped after the pulses already queued ahead;
changing the device or switching Send Clock off mid-play stops the old device. A Start after a
Stop is always Start (FA), never Continue.

**Transport.** `MEngine.rewind` defines the initial position (tick 0, Voices at step 1 / cycle
step 1 from their Phase, Sequence at its start, Robot timer 0, random streams re-seeded,
nothing pending or sounding). `stop` = note-offs + rewind (Stop returns there at once);
`start` from stopped = rewind + play; `pause` toggles and keeps everything (and the notes);
`halt` = note-offs with the place kept, for an external MIDI Stop. In the Session, `stop` also
ends Slideshows, Trajectories, tap conducting, the Movie recording and clock output and resets
the clock follower and CC Cycles; the performance settings persist. **Clock input**
(`clockRealtime`): FA = Stop if needed, then Start; FC = `externalStop` (halt; menu bar *EXT
STOP*; Space continues, Return stops); FB = continue from a halt or pause, Start when stopped;
F2 Song Position 0 while not playing = Stop (rewind); clocks while stopped are only liveness.

### UI (`src/ui`)
Plain TypeScript + DOM/SVG, no framework. The whole screen is laid out in a fixed **720 × 470
logical-pixel** space (the "M screen") and scaled with a CSS transform to fit the window, so
proportions stay those of a 1-bit Macintosh screen at any size.

* `widgets.ts` — Numerical, RangeBar, ConductArrow, Picture Matrix, MWindow.
* `choice.ts` — Variable Position choice bar; `minis.ts` — miniature representations.
* `mainWindows.ts` — the six main windows; `varEditors.ts`, `cyclicEditor.ts`,
  `patternEditor.ts`, `otherWindows.ts` — edit windows and dialogs.
* Shared controls: `selector.ts` (the emmm pop-up selector that replaces every native
  `<select>`: mouse, keyboard, type-ahead, live choice lists, ARIA combobox/listbox),
  `dialogs.ts` (alert / confirm / text entry instead of the browser's), `tooltip.ts` (one
  layer that shows every control's `title` in emmm's style and suppresses the system
  tooltip), `patternControls.ts` (Output Length, Time Base, Phase — used by both the Patterns
  window and the Pattern Editor, so both are the same controls on the same Pattern state).
* `keys.ts` — the keyboard command table (ids, labels, chords) used by the one window-level
  dispatcher in `main.ts`, the menus' key labels, tooltips and the Keyboard Shortcuts window
  (`shortcutsWindow.ts`). Key routing order: whatever owns typing (a number being typed, a
  pop-up, a dialog, a text field — they stop the event) → a command → the Pattern Editor's
  keys when it is the front window (`PatternEditor.key`) → M's performance keys. Commands only
  prevent the browser's default when they act.
* Direct numerical entry lives in the shared widgets (`Numerical`, `RangeBar` in
  `widgets.ts`): a press focuses the control; typing edits it in place with a caret (no
  native `<input>`); Enter commits one `set(…, final)` (one Undo step), Escape cancels;
  `parse` / `entry` options handle special forms (Time Base `n/d`, `sa`, program numbers).
* `feedbackWindow.ts` — Performance Feedback: reads the engine's existing step events
  (`Session.nowPlaying`), at most ~12 redraws a second, only while open.
* `palette.ts` — colour palettes. All drawing uses CSS custom properties (`--desktop`,
  `--paper`, `--ink`, `--dim`, `--activity`, `--selection`, and the dither fills); a palette is
  turned into one `<style>` element, and windows carry a `data-area` so each functional area can
  redefine `--ink`. Classic (the default) produces exactly the original 1-bit colours.
  Palettes are a browser preference (`localStorage`), never part of the composition;
  `paletteWindow.ts` is the editor. The role/variable/mix approach follows the theme code in
  the author's M8 Librarian and PT Librarian projects.
* The display loop consumes the Session's queue of timestamped events when their time comes
  (pattern bricks flash, cycle steps blink, monitor log) and redraws only when something
  changed.

### Hosting
The build is a static site. `vite.config.ts` uses a relative base by default; the GitHub Pages
workflow builds with `--base=/<repository>/`. A small build-time plugin renders
`docs/QUICK-START.md` (with its images) to `docs/quick-start.html`, which the in-app Help and
About windows link to. No server, no third-party requests.

### Persistence (`src/persistence`)
`format.ts`: `{ format: "emmm", version, mode, savedAt, composition, ui }` JSON (version 4).
`migrate` upgrades old versions and fills missing fields from defaults; `validate` clamps
values. Version 1 → 2: Extended gains Locks, Mutation, A/B and per-voice seeds (filled from
defaults); MIDI Learn mappings leave the document and are handed once to the preferences.
2 → 3: Trajectories. 3 → 4: `extended.clockIn` moves to `midi.clockIn` (on only if it was on
*and* Extended was on, so an old file behaves as before); `scaleLock` arrives, off.

State lives in four separate places:

| What | Where | Examples |
|---|---|---|
| Classic musical document | `Composition` (saved file) | Patterns, Variables, Positions, Snapshots, routing, seed |
| Extended musical / performance state | `Composition.extended` (saved file) | Locks, Mutation amount, A/B states, voice seeds, CC Cycles, Trajectories |
| Pattern editing metadata | `Pattern.scale` (saved file, optional) | each Pattern's Root + Scale |
| emmm Transposition Scale Lock | `Composition.scaleLock` (saved file, default off) | Transposition counts scale degrees |
| Application preferences | `app/prefs.ts` → `emmm.prefs`; `ui/palette.ts` | tips, Performance Feedback, MIDI Learn mappings; palettes |

`storage.ts`: autosave to `localStorage` (every ~1.5 s after a change), a named browser
library, download/upload of `.emmm.json`, and the movie `.mid` download.

## Determinism
A session seed (default 38291) seeds independent sfc32 streams per voice, the robot
conductor and editing (scrambles). Pressing Start from stopped re-seeds the playback streams,
so the same document + seed + gestures reproduce the same output. Tests check that output does
not depend on how finely `render` is called.

## Classic and Extended
Extended features live in `src/extended/` and the `Composition.extended` settings object
(`enabled` is false by default). The Session consults them at the MIDI-input boundary
(`extendedLearn`) and in explicit actions (Reroll, Mutate, A/B); the
engine never reads them, so Classic note generation cannot be affected — tests check this.
The one engine hook is generic: `MEngine.seedOverride` (per-voice seeds, all `null` = the
document seed = Classic), which the Session fills from `extended.voiceSeeds` only when
Extended is on.

* `extended.ts` — settings, MIDI Learn targets / validation / conflict rule (`learnInto`).
* `mutation.ts` — `mutate(comp, amount, locks, rng)`: changes the active Positions' values,
  cycles, active Positions and Cyclic Random order — never Pattern notes, routing, Snapshots or
  options — from a stream seeded by the document seed and a mutation counter.
* `trajectory.ts` — Trajectory: the model (target, values, rate as Time Base n|d, traversal,
  Step / Smooth), the typed target registry (`targetInfo`: range, continuous / integer /
  enumerated, absolute / offset / output, per-Voice), traversal (`nextIndex`), validation.
  The Session runs them as chains of exact-tick engine actions (label `traj`; Slideshows use
  the same mechanism), one action per step, plus Smooth updates at most every 6 ticks with
  repeated controller values suppressed. Note-level targets write `MEngine.mod` (runtime
  modulation, neutral = Classic); Tempo, Baton, Positions and Mutation strength are set the way
  conducting sets them. Controller messages go through `Session.send` (MIDI Settings
  routing) and into the Movie. Runtime state (`Session.traj`) is never saved and never makes
  Undo steps; definitions are in `extended.trajectories` (document v3).
* `perfState.ts` — A/B capture / recall of the performance state (a plain object keyed by
  composition field, ready for interpolation if morphing is added later).

A Pattern's Root + Scale (`Pattern.scale`, `app/scales.ts`) is editing metadata: pitch-class
sets that shade the grid, snap new notes, and — when changed with `Session.setPatternScale` —
transform the Pattern's notes by scale degree (`transformPitch` documents the exact rule;
one Undo step). There is no real-time quantiser. The engine reads it only for the emmm
**Transposition Scale Lock** (`Composition.scaleLock`, off by default): `MEngine.transposePitch`
then moves each note by `shiftDegrees` (degrees of that Voice's current Pattern scale; a note
outside the scale keeps its chromatic offset from the degree below; Chromatic = semitones)
instead of adding semitones, so Positions, conducting, the Robot, Trajectory (`MEngine.mod`)
and Mutation (degree-sized moves, same random draws) all count degrees. Keyboard Transpose stays
chromatic on top. With Scale Lock off the code path is M's `raw + transposition + offset`. New Extended features should follow the same rule:
separate modules, fields added through the migration path, inert when disabled. The Extended
window is clearly labelled "not part of Classic M".
