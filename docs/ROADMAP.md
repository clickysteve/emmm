# Roadmap

## Classic — done

* Engine: four voices, six Pattern Groups, all eleven Variables, global Rhythm/Legato tables,
  Time Base (all denominators incl. step advance), Phase, Output Length, Note Order (three
  schemes, mixed), Note Density, Velocity Range × Accent, Transposition (+ keyboard transpose,
  second-order), Orchestration (any voice → any channels), Sound Choice (16 presets),
  Time Distortion maps, cyclic variables with random ranges.
* Transport: Start / Sync, Stop (notes off), Pause (notes held), quantized Sync.
* Conducting: arrows with four directions on all Variables, Tempo and Snapshots; tempo range
  bar; continuous conducting of velocity and legato; Robot Conductor; MIDI Conduct.
* Hold/Do, 26 Snapshots (store, execute, edit, Blink Everything, Restore, forced Sync),
  quantization, 9 Slideshows (record with Record Wait, play, loop, pause, stop).
* MIDI input: Src channels, Record (Single / Chord / Build × Insert / Replace / Overdub, Drum
  Machine mode, Sustain Enters Rests), Keyboard Transpose, Input Control System, Echo-Thru-
  Orchestration, Echo Map, Tap Tempo / Tap Conduct / Freeze / Accel / Decel, Step Advance.
* Pattern Editor with tools; Pattern and Edit menu operations.
* Movies → Standard MIDI File; MIDI File → Patterns, or → a play-along Sequence (Sequence
  Play-Enable mute, Sync Restarts Sequence, snapshot item, Input Control key).
* Web MIDI output with timestamps, Midi Assignment (16 output / input channel maps, first
  program number, latency, MIDI messages, All Notes Off, Panic, MIDI clock out), internal
  monitor and metronome.
* Save/load (versioned JSON), autosave, browser library, Save State As Startup; seeded
  randomness.
* Interface details: zoom rects, slanted transport strips, snapshot "sun" pictures, baton
  cursor, Pattern Editor audition keys (` and ,), Pattern-menu key equivalents, Help window.

## Classic — remaining

1. **Verify against the original** in an emulator (Mini vMac / Basilisk II with M 2.x, or
   Hatari with the Atari 1.25 freeware) — work through UNCERTAINTIES.md, turning [INF]/[UNK]
   into [OBS] and adding regression tests from captured MIDI.
2. Sequence details: looping behaviour, file tempo maps, recording a Movie into a Pattern
   directly ("regurgitated back into a pattern", S2).
3. Modified-mouse details still missing: Shift-Option quantized active-Position choice from
   edit windows is wired; check every documented modifier against Appendix A.
4. Pattern Editor polish: right-hand reference keyboard, MIDI-edit while viewing two patterns.
5. Voice colours (M 2.x colour option) — deliberately left monochrome for now.
6. Accessibility: the pop-up selectors, dialogs, menus and new controls have keyboard
   operation and ARIA roles; the older numericals and choice bars are still mouse-only.
8. Pattern-menu key equivalents that browsers reserve (⌘W, ⌘R, ⌘H, ⌘F) have no shortcut.
9. Conducted Snapshots: quantize and queue them one quantum apart, as S1 ch.9 describes (U23).
10. Movies: decide what arming during playback should do (U24); optional event counter.

## Usability additions — done (do not change M's music)

* Undo / Redo of editing (not of performing), one step per gesture, bounded history.
* Pattern Editor: Output Length (incl. Alt structural change), Time Base, Phase and a
  plain-words speed readout, sharing the Patterns window's controls; Clear Pattern; a Root +
  Scale per Pattern (14 scales × 12 roots) that transforms the notes by scale degree when
  changed.
* Direct numerical entry for every number box and range bar; a shared keyboard command
  layer with shortcuts in the menus and a Keyboard Shortcuts window; Pattern Editor keys.
* emmm-style tooltips for every control (Options ▸ Show Tips), one shared pop-up selector in
  place of every native `<select>`, emmm dialogs in place of the browser's confirm / prompt.
* Windows menu fixed to M's documented behaviour (live list, visible bring-to-front); Full
  Screen; colour palettes.
* **Space = Play / Pause** (Sync moves to ⇧Space), from the shared shortcut table.
* Mouse wheel / trackpad scrolling in the Pattern Editor (pitches, and sideways or ⇧ + wheel
  for steps), never global.
* **MIDI Settings** (File ▸ MIDI Settings…): M's Midi Assignment plus MIDI clock out and
  clock **input** with its status — clock input is no longer Extended
  (`src/midi/clockIn.ts`, `Session.clockRealtime`): follows an external 24-ppq clock's tempo
  with gentle phase correction, optional Start / Stop / Continue, jitter-resistant, loss holds
  the tempo, recovery re-aligns the phase.
* **Transposition Scale Lock** (emmm, off by default): Transposition values count degrees of
  each Voice's Pattern scale (Positions, conducting, Robot, Trajectory, Mutation).
* Snapshot explanations (contents in each box's tip, a status line, pending Snapshots blink)
  and Movie state feedback (visible film icon, state tip, MOVIE / MOVIE● in the menu bar).

## Extended — done (Options ▸ Extended…, off by default)

* (MIDI clock input and its status moved to MIDI Settings in document format 4.)
* **MIDI Learn** (mappings are an application preference): transport, Variables (a CC
  sweeps the six Positions), any single Position, Tempo, Baton X/Y, Play-Enable 1–4, Snapshots
  A–Z, Mutate, Mutation amount, Reroll, A/B recall / capture / toggle; one source → one
  target with clear re-assignment.
* **Seed / Reroll**, **Locks** (Voices and twelve kinds of setting), **Mutation** (subtle →
  chaos, seeded, undoable), **A/B performance states**, **Performance Feedback** inspector.
* **Trajectory**: four slots of value rows moved through at Time Base rates (forward,
  backward, ping-pong, random, random walk; step or smooth) driving MIDI CC or a typed set of
  parameters; tick-exact, seeded, saved, undoable, in the Movie.
* **CC Cycles**: per voice, a cyclic distribution of levels (M's own cyclic-variable model,
  16 steps × levels 0–4, random ranges) sends a controller value before each played note on the
  voice's orchestrated channels; six Positions; a global level → value table. Runs in the
  Session from the engine's step events with its own random stream.
* Tests prove Classic note output is unchanged by Extended settings.

## Extended — further ideas (keep separate from Classic)

* More voices / Pattern Groups; more Positions per Variable.
* Tempo sharing beyond MIDI clock (e.g. Link-style network sync).
* Learnable mappings for every on-screen control (numericals, range bars, edit windows).
* Morphing between A and B (the A/B state format is field-by-field, ready for it).
* Trajectory ideas not in version 1: per-step probability or durations, restart-on-Sync,
  Trajectories driving other Trajectories, MIDI Learn for single Trajectory values.
* Scale-constrained *output* as an explicit Extended option (a Pattern's scale only
  transforms its notes when you change it, and Scale Lock moves by degrees; nothing snaps
  generated notes to a scale).
* Parameter automation lanes recorded from gestures (beyond Slideshows).
* Additional ordering schemes (e.g. Jam Factory-style transition tables) and probability
  systems.
* MPE / per-note expression.

Extended must be opt-in per document (`mode: "extended"`), implemented in separate modules,
and covered by tests proving Classic output is unchanged.
