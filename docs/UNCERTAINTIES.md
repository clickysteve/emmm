# Uncertainties

Things about original M that emmm could not establish from documentation. Each has a
conservative choice in emmm, isolated so it can be corrected. Search the code for
`@m-uncertain`. Ordered roughly by musical importance.

| # | Question | emmm's current choice | Where | How to verify |
|---|----------|------------------------|-------|---------------|
| U1 | How do Accent levels 1–4 map into the Velocity Range? The manual says levels correspond to "quarters" of the range. | Level 1 = low end, level 4 = high end, linear between (`spread`). Supporting hint: the reminder diagram in M's Cyclic Editor draws marks 1–4 spread across the filled velocity bar. The literal alternative (`low + range·k/4`) is one constant away. | `ACCENT_MAPPING` in `src/engine/constants.ts`; `MEngine.velocityFor` | Emulator: velocity range 0–127 (or 1–127), accent cycle 1,2,3,4, read velocities from MIDI output. |
| U2 | Default Rhythm Values for levels 2–4. Level 0 = 0.5 and 1 = 1 are documented. | 2, 3, 4 (seen in manual screenshots, possibly a tutorial file's state). | `DEFAULT_RHYTHM_VALUES` | Emulator: New document, open Cyclic Editor. |
| U3 | Does a Cyclic Variable's step counter reset when its active Position changes? | No: the counter belongs to the voice and wraps to the new cycle's length. | `MEngine.cycleRead` | Emulator: two accent Positions of different lengths, switch mid-cycle. |
| U4 | Cyclic Random with Output Length shorter than the pattern: what if the scrambled list points beyond the Output Length? | Fold the index into range (`index mod outputLength`). | `MEngine.chooseStep` | Emulator. |
| U5 | Note Density: is a skipped note's step consumed (melody position advances)? | Yes — skipping produces a rest in place, the pattern position still advances (consistent with "skips" and with S2 Fig. 10). | `MEngine.voiceEvent` | Emulator with an ascending scale at 50 %. |
| U6 | Does M re-attack a note that is already sounding (legato > 100 % on repeated pitches)? | Sends note-off then note-on; drops the stale pending note-off. | `MEngine.noteOn` | Emulator + MIDI monitor. |
| U7 | Is Time Distortion's period measured from Start, from Sync, or from each voice's phase-delayed origin? | From the voice's origin (Sync + Phase). | `MEngine.nextEventTick` | Emulator: phase-offset voice with a swing map. |
| U8 | Is the Time Distortion length per voice or per Position? | Per voice (the Length controls sit next to the per-voice Clear button). | `TimeMap` type | Emulator. |
| U9 | Chord-mode recording: how near-simultaneous must notes be to form a chord? | 40 ms window. | `CHORD_WINDOW_MS` | Emulator with a MIDI keyboard. |
| U10 | Continuous conducting curves: exact shape of the velocity offset and legato multiplier between the documented end points. | Velocity: linear ±127; legato: geometric ×¼…×4. | `src/engine/conducting.ts` | Emulator. |
| U11 | Input Control code keys for Legato and Accent (G#3, A#3) are inferred from the order in S2 Fig. 11. | As stated. | `src/engine/inputControl.ts` | M 2.7 Appendix B template image / emulator. |
| U12 | Tap Affects Velocity: absolute offset (velocity − 64) or cumulative? | Absolute offset `velocity − 64`. | `Session.tapVelocity` | Emulator. |
| U13 | Tap Conduct beat unit and exact waiting behaviour. | Each tap releases one Sync-Ratio note value; tempo = tap interval. | `Session.tapConductKey` | Emulator. |
| U14 | Mouse Advance: exact velocity-from-speed scaling, and whether the voice's clock keeps running while gated. | Clock keeps running (the voice stays "in tempo"); up to ±30 velocity from speed. | `MEngine.voiceEvent`, `Session.setMouseAdvance` | Emulator. |
| U15 | Robot Conductor: distribution of jumps; whether it "may not move" because the random jump is zero or by explicit chance. | Uniform jump in ±range per axis each period. | `MEngine.robotStep` | Emulator. |
| U16 | Drum Machine record: which step receives a note played between two steps? | The nearer of the two (by time). | `Session.drumStep` | Emulator. |
| U17 | Pattern Group Positions: do Time Base / Phase / Output Length snapshot items refer to the pattern in the *current* group at execution time? | Yes. | `MEngine.applySnapshot` | Emulator. |
| U18 | Default contents of the six Positions at startup ("New"). | emmm's own musically useful presets; Position 1 neutral. | `src/engine/defaults.ts` | Emulator. |
| U19 | Rounding of fractional time bases (5, 7, 9, 11, 13, 15) — integer ticks with error diffusion, or something else? | Exact fractional ticks. | engine | Emulator + MIDI timing capture. |
| U20 | Atari ST/early "Direction" variable (backwards playback probability). | Not implemented (not in the 2.x manual). | — | Atari ST 1.x emulator. |
| U22 | Can the Tempo Numerical go outside the Tempo Range Bar's range? | Yes — the range widens to include the new tempo (otherwise a single-value range would freeze the numerical). | `Session.setTempoFree` | Emulator. |
| U23 | **Conducted Snapshots** — S1 ch.9: conducting Snapshots is quantized and a quick drag queues them "a whole note apart, in the order you dragged". | **Known deviation:** emmm executes a conducted Snapshot as soon as the Baton reaches its cell (quantized only with Shift held) and does not queue successive ones. Not changed in the October 2026 pass (explanatory changes only); a fix would queue conducted Snapshots through the Snapshot quantization. | `MEngine.conduct`, `Session.conduct` | Emulator: quantization = whole note, drag quickly through A–D. |
| U24 | **Movies:** what happens when the Movie button is clicked while already playing; whether echoed MIDI input is included; the event limit; how tempo changes are written. | Armed during playback = films from the next Start (from stopped); echo-thru not included; no limit; a tempo map in the file. | `Session.toggleMovie`, `Session.movieAdd` | Emulator + MIDI file inspection. |
| U25 | Incoming MIDI clock and the **Sync Ratio** ("the ratio between an incoming MIDI clock and M's quarter note" — External Clock is "no longer available" in 2.7). | emmm's clock input (MIDI Settings) always reads 24 pulses per quarter note. | `Session.clockRealtime` | Older M version in an emulator. |
| U26 | **Song Position Pointer** other than 0 (a DAW continuing from bar 9), and transport from masters whose exact messages are undocumented (Hermod+: Continue / Song Position not documented). | Song Position 0 while not playing rewinds; any other position is not located — Continue resumes where emmm stopped (M's performance is generative, not a timeline; locating would mean re-running the performance silently up to that point). External Start waits for nothing: emmm starts on FA and counts the first clock as the downbeat. | `Session.clockRealtime` | A MIDI monitor on the real master (Hermod+, a DAW): which of FA / FB / FC / F2 it sends on Play, Stop and Continue. |
| U21 | Does an imported Sequence loop at its end? Which output does a file channel play on? | Plays once per Start (or Sync, with *Sync Restarts Sequence*); file channel *n* plays on M Output Channel *n*; tempo follows M's tempo (file tempo map ignored). | `MEngine.restartSequence`, `ImportWindow` | Emulator. |

## Known simplifications (not uncertainties about M)

* Tempo maps inside imported MIDI files are ignored (notes are placed in beats).
* Long main-thread stalls (> ~60 ms) can make notes late by the excess; raise *Latency* in
  MIDI Settings to absorb this (all output is then delayed by that amount). The Monitor
  window shows a running count of late notes.
* MIDI clock *input* (External Clock) is "no longer available" in M 2.7. emmm has its own
  (File ▸ MIDI Settings…, independent of Extended; see U25). On an external Start emmm starts
  at once rather than waiting for the first clock pulse, and its phase correction is bounded
  (±15 %), so a clock whose pulses begin late is caught up gradually.
* Space is Play / Pause in emmm (stopped → Start, playing → Pause, paused → continue); in M it
  was Start, and Sync while playing. Sync is ⇧Space. A deliberate emmm change, not an
  uncertainty.
* Look-ahead: gestures take effect from the scheduler's render frontier, i.e. up to ~60 ms
  after the click, and a Pause may let the last ≤60 ms of already-scheduled notes sound.
