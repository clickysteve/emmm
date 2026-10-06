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
* Save/load (versioned JSON), autosave, browser library; seeded randomness.

## Classic — remaining

1. **Verify against the original** in an emulator (Mini vMac / Basilisk II with M 2.x, or
   Hatari with the Atari 1.25 freeware) — work through UNCERTAINTIES.md, turning [INF]/[UNK]
   into [OBS] and adding regression tests from captured MIDI.
2. Sequence details: looping behaviour, file tempo maps, recording a Movie into a Pattern
   directly ("regurgitated back into a pattern", S2).
3. Modified-mouse details still missing: Shift-Option quantized active-Position choice from
   edit windows is wired; check every documented modifier against Appendix A.
4. Pattern Editor polish: right-hand reference keyboard, MIDI-edit while viewing two patterns,
   the "~" and "," audition keys.
5. "Save State As Startup" (a user-defined New document).
6. Voice colours (M 2.x colour option) — deliberately left monochrome for now.
7. Undo (M had none; a modern addition would be welcome but is not Classic).
8. Accessibility: keyboard focus for controls, screen-reader labels.

## Extended — started (Options ▸ Extended…, off by default)

* **MIDI clock input**: follow an external 24-ppq clock's tempo with gentle phase
  correction; optional Start / Stop / Continue. (`src/extended/extended.ts`, `Session.extendedRealtime`)
* **MIDI Learn**: map any CC or note to Variable Positions (CC value spreads over the six
  Positions; a key steps to the next), Tempo within its range, Baton X/Y, Start, Stop, Sync,
  Hold/Do, Play-Enable 1–4, Snapshots A–F.
* Tests prove Classic note output is unchanged by Extended settings.

## Extended — further ideas (keep separate from Classic)

* More voices / Pattern Groups; more Positions per Variable.
* MIDI CC "Variables" (a cyclic variable or position set emitting controllers).
* Tempo sharing beyond MIDI clock (e.g. Link-style network sync).
* Learnable mappings for every on-screen control (numericals, range bars, edit windows).
* Parameter automation lanes recorded from gestures (beyond Slideshows).
* Additional ordering schemes (e.g. Jam Factory-style transition tables) and probability
  systems.
* MPE / per-note expression.

Extended must be opt-in per document (`mode: "extended"`), implemented in separate modules,
and covered by tests proving Classic output is unchanged.
