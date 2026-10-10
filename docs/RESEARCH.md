# Research notes on M

Working notes from studying Intelligent Music's **M**. Sources are listed in
[PROVENANCE.md](PROVENANCE.md) (S1–S7). The reconstructed behaviour is in
[M-BEHAVIOUR.md](M-BEHAVIOUR.md); open questions are in [UNCERTAINTIES.md](UNCERTAINTIES.md).

## History and versions

* M was designed in early 1986 by Joel Chadabe, David Zicarelli, John Offenhartz and Antony
  Widoff, and sold by Intelligent Music (Albany, NY) from December 1986 for the Macintosh
  (S2). Zicarelli describes the programs' "control panel" as modelled partly on a
  Macintosh flight simulator (*Fokker Triplane*) — a useful key to M's look: dense,
  instrument-like, everything visible at once.
* Versions: 0.91 → 1.x → 2.0 (1988) → … → 2.7 (Cycling '74, Mac OS X, 2007) (S1, S4).
* Platforms: Macintosh; Atari ST port by Eric Ameres (S6); also Amiga and Windows versions
  are reported. The Atari ST version 1.25 was later released as freeware (S6).
* Cycling '74 (Zicarelli's later company) republished M 2.7 for OS X with a free manual (S1).

## The core idea, as the authors put it

S2 ("The Algorithms") makes three design decisions explicit, and they explain almost every
behaviour:

1. **Pitch is changed by re-ordering**, not by generating new pitches. The musician supplies
   the notes (tonality); M varies their order. Hence Note Order (Original / Cyclic Random /
   Utterly Random) and the separate scrambled list.
2. **Rhythm works on two levels**: a master tempo divided into 96 ticks per quarter, and a
   per-voice Time Base expressed as a fraction of a whole note. Everything above that is a
   simple multiple of the time base (Rhythm values), plus "micro timing" (Time Distortion).
3. **Variation through controlled randomness**: the *cyclic distribution* — a short cycle
   whose steps are single values or random ranges — drives duration, articulation and
   accent. Fixed steps give repetition, ranges give variation, mixtures give both.

The UI writes directly into the same global variables the timer interrupt reads (S2, Fig. 4),
so every change is heard at the next note. emmm keeps that architecture: the engine reads the
Composition live.

## Screen and widgets

* Six always-open windows: Patterns, Conducting, Variables, Cyclic Variables, Midi, Snapshot
  (S1 ch.2). The "four by six" theme: four voices (rows inside every box), six Positions per
  Variable.
* Widgets designed for the program (S2 Fig. 3): the **numerical** (top half = up, bottom half
  = down, drag outside = slider with the cursor hidden), the **range bar** (drag out a range,
  click for a single value), the **choice bar** (Variable Positions; drag to copy/swap), the
  **button matrix**, plus the **Picture Matrix** pop-up and the rotating **Conducting
  Arrow** (S1 ch.2).
* 1-bit graphics: inverted selection, 50 % dither for "grey", polka dots for Utterly Random,
  diagonal hatching in the Orchestration editor, bold window titles in a tab with a slanted
  right edge, a close *triangle* at the top left of edit windows (S1 screenshots).
* The Atari ST 1.x screen is arranged differently (Patterns / Note Manipulation / MIDI
  Variables / Cyclic Editor / a snapshot strip along the bottom) and had a "Direction"
  (backwards-playback probability) control that the Mac 2.x manual no longer mentions (S3, S6).
  emmm follows the Mac 2.x layout, which is the best documented.

## Details worth remembering

* M calls MIDI note 60 **C3** (Transposition "C3 = no transposition"; ICS "middle C (C3)").
* Patterns contain **no durations** — duration is computed (rhythm × legato).
* Accent level 0 is a **rest**; a step range including 0 makes occasional rests (the manual
  says about 20 % for a 0–4 range, i.e. uniform choice among five levels).
* The Rhythm cycle paces the Legato and Accent cycles (they advance per event, not per tick).
* Pause does not send note-offs; Stop does.
* Pattern Group selection does a Sync (unless Option-clicked).
* A Snapshot stores *Position numbers*, never Position contents.
* Slideshows store snapshot *locations*; editing a snapshot changes what a slideshow plays.
* Shift-click = quantized (and recorded into a slideshow); Option-drag = copy; drag = swap.
* The Input Control System's white keys from C1 double as numbers 0… and letters A…Z.
* Zicarelli notes the drum-machine record mode keeps rest positions fixed in the scrambled
  order (a "third list") — the same idea as the *Don't Scramble Rests* option.
* Time distortion is implemented in M as a per-tick table of "ticks to simulate" (0, 1, 2…)
  derived from the user's map (S2). emmm computes the same mapping analytically.
* M precomputed random numbers into cyclic tables for speed (S2). emmm uses a seeded PRNG.

## Movies (studied October 2026)

Tags as in M-BEHAVIOUR: **[DOC]** documented (S1 = M 2.7 manual, S2 = Zicarelli 1987),
**[OBS]** observed in the original program (none — no emulator session yet), **[INF]**
inferred, **[UNK]** unknown.

**What M called a Movie.** "A record of the MIDI output generated by an M performance"
[DOC S1 ch.12]. Zicarelli: "every MIDI event that occurs in a performance is captured, along
with the time it occurred"; the authors "call the capture of a performance a movie" [DOC S2].
So a Movie is a timed MIDI *output* recording — a MIDI sequence of what M played. It is not a
recording of gestures or an automation of M's controls: that is what Slideshows are (they
record Snapshot executions and quantized Position changes) [INF from DOC: the two are
described separately and Slideshows replay *actions*].

**What it contained.** MIDI events with their times [DOC S2]. Which events exactly is not
listed: notes certainly (the tutorial imports the Movie back as notes) [DOC S1]; program
changes and other output [INF from "the MIDI output"]. Whether MIDI echoed through from input
(Echo-Thru) counts as "output generated by an M performance" [UNK]. How tempo changes were
written (tempo map or absolute time) [UNK].

**How it was made.** Click the **Movie button** in the Conducting window *before* Start; it
highlights; perform; Stop un-highlights it [DOC S1 ch.12, ch.15 "Movie: Click on this button
before hitting Start"]. The Movie is held in memory; there is a limit to the number of events,
and "the filming will stop automatically" when it is reached, the Movie intact so far
("Running out of Film") [DOC S1]; the main loop checks for running out of memory while
capturing [DOC S2]. The size of the limit [UNK]. What happens if the button is clicked while
the music is already playing [UNK — the manual only describes clicking before Start].

**How it was used.** **File ▸ Save Movie As Midi File…** — "highlighted only after you have
captured an M performance as a Movie" — writes a Standard MIDI File, default name "M Movie"
[DOC S1 ch.12, ch.19]. The stated purpose: material for another program, typically a
sequencer [DOC S1, S2: people used M "to make movies of … texture to be used as tracks in their
sequences"]. The tutorial then reads the saved Movie back with **Open Midi File…** into a
Pattern or as a play-along Sequence [DOC S1]. S2 adds that in M a Movie could be
"regurgitated back into a pattern" [DOC] — whether directly or only through a MIDI file [UNK;
S1 shows only the file route]. M itself does not play a Movie back as such: no Movie playback
control is documented [INF].

**What emmm implements.** The film button arms a Movie; filming starts at the next Start from
stopped and captures every note on / off, program change and controller emmm sends (Voices,
the Sequence, CC Cycles, Trajectory), with a tempo map; Stop ends it and disarms the button;
**File ▸ Save Movie As Midi File…** (enabled only when a Movie exists) downloads
`<document> Movie.mid` (SMF, 96 ppq). Not implemented: an event limit (memory is no longer a
constraint), direct Movie → Pattern without a file, echoed MIDI input in the Movie.

**Why it seemed to do nothing.** The behaviour worked, but the button did not show it: the
film icon's frames were drawn in the paper colour, so when the button was highlighted the
whole icon became a blank white box (armed) or a black block (recording, blinking) — the state
was unreadable. And, as in M, the only result of a Movie appears in the File menu after Stop;
a Movie armed during playback silently waits for the next Start. Fixed in emmm (UI only, no
behaviour change): the icon stays visible in both states; the film button's tip says what it is
doing (armed / recording *n* events / *n* events ready to save); the menu bar shows **MOVIE**
when armed and **MOVIE●** while filming.

**What a fuller implementation would need** (not done): a decision on arming while playing
(start filming at once, or keep M's "arm before Start"); a direct "Movie → Pattern" command
(S2) using the existing MIDI import; optionally an event counter or limit display.

## Snapshots (studied October 2026)

Tags as above.

**What a Snapshot stores** [DOC S1 ch.9, ch.18]: only the controls that were blinking when it
was stored — gathered with Hold/Do, Blink Everything or Edit Snapshot — from this list:

* all Variable **Positions** — *which* Position (1–6; the Pattern Group letter a–f; one of
  the sixteen Sound Choices) [DOC];
* the settings of all **Conducting Arrows** (on/off and direction; this includes the Tempo and
  Snapshot arrows) [DOC "Settings of all Conducting Arrows"; INF that Tempo's and the Snapshot
  window's own arrows are among them];
* per Voice, from the Patterns window: **Src** channel, **Play-Enable**,
  **Echo-Thru-Orchestration**, **Mouse Advance**, **Output Length**, **Time Base** and
  **Phase** [DOC];
* **Sync**, as an action (clicked while gathering) [DOC];
* the **Sequence Play-Enable** [DOC].

**What it does NOT store.** "A Snapshot only stores the Position (1-6) of the Variable, not
the contents at that Position" — not a Pattern's notes, only the Pattern Group letter [DOC].
So editing a Position after storing changes what the Snapshot produces [DOC by consequence].
Also not in the list, so not stored: the tempo *value* ("Tempo, which isn't really a Variable")
[INF], the Use / record-mode column, Options, MIDI assignment, the Snapshot quantization, the
Baton's position [INF from the list].

**Recalling one during a performance.** Clicking its box or typing its letter executes all
its items together; the musical change can precede the screen redraw [DOC]. It is quantized
to the Snapshot Quantization [DOC]. Shift-click or a capital letter forces a Sync even if
none is stored [DOC]. The music does not stop; nothing outside the Snapshot changes [INF].
**Restore From Snapshot** puts back what the last executed Snapshot changed, itself
quantized [DOC]. The current Snapshot (black mark in the sun) changes whenever one is stored or
executed; Edit Snapshot and Erase Snapshot act on it [DOC].

**Quantization.** One numerical in the Snapshot window: wave = none, or a note value [DOC].
Execution waits for the next multiple of that value "some multiple of four beats away from
the point in time that you hit the Start button" (for a whole note) [DOC]. It applies to
executing Snapshots (clicked, typed or conducted), Sync, starting Slideshows, Shift-clicked
Position changes and Shift-conducting [DOC]. Anticipate the beat: quantization can only delay
[DOC]. Conducted Snapshots in quick succession are queued "a whole note apart, corresponding
to the order in which you dragged" [DOC S1 ch.9].

**Positions, Variables and Conducting.** A Snapshot is a stored set of Position *choices* —
in effect "a record of a Hold/Do action" [DOC] — across Variables and a few Voice controls.
Variables keep their contents in their Positions; Snapshots only move between them [DOC].
Conducting is the other way to move several Variables at once; Snapshots extend it (S2: "to
enhance the gestural capability of the user, which is otherwise limited to … conducting, or
selecting variable positions one at a time") [DOC]. Snapshots can themselves be conducted: the
Snapshot window's Conducting Arrow lets the Baton execute Snapshots **A–F** (only the first six)
[DOC].

**The 26 slots.** Locations A–Z, two columns in the Snapshot window, typed letters execute (or
store, while holding) [DOC]. Storing over a slot replaces it; Edit Snapshot then clicking
another letter copies [DOC]. They have no order or meaning beyond their letter, except that A–F
are the conductable ones [DOC].

**Slideshows.** Nine slots (1–9) [DOC]. A Slideshow is a recorded, timed sequence of Snapshot
executions and quantized (Shift-clicked) Position changes; the time recorded is the quantized
execution time [DOC]. Conducted Snapshots are always recorded [DOC]. Option-click (Option-1–9)
records, a click (1–9) plays, start quantized; Stop (0), Pause, Loop (\ or |; Option removes
the loop) [DOC]. *Slideshow Record Wait* starts timing at the first event [DOC]. A Slideshow
stores which *slot* was executed [INF: it records "which Snapshot you've executed"], so
editing a Snapshot changes what the Slideshow plays.

**emmm against this.** Storage, Hold/Do, Blink Everything, Edit, Restore, Erase, typed letters,
Shift / capital Sync, quantization of executing / Sync / Slideshow / Shift-click, conducting
A–F and Slideshows match [checked against the code and tests]. One deviation found:
**conducted Snapshots** are executed at once in emmm (quantized only with Shift held), and a
quick drag through the grid is not queued one quantum apart as S1 describes — see U23. emmm
changes nothing in the model; what was missing was explanation, so (emmm, UI only): each
Snapshot box's tip lists exactly what that Snapshot holds and says it stores Positions, not
their contents; an empty box explains how to store one; the Hold/Do, quantization, Edit,
Restore and Blink Everything tips say what they do; a status line at the bottom of the Snap
window says what is happening (holding *n* items, editing, *C waits for the next whole note*,
or the current Snapshot); and a Snapshot waiting for the quantization point blinks, as pending
items do everywhere in M.

## MIDI clock (checked October 2026)

M 2.7 sends MIDI clock (Options ▸ Send Clock, to the device chosen under *Send Sync* in Midi
Assignment) [DOC]. Its *External Clock* option "is no longer available" in 2.7 [DOC], but the
Sync Ratio's arrow still describes a mode setting "the ratio between an incoming MIDI clock and
M's quarter note" [DOC] — so earlier versions followed external clock [INF]. emmm's clock input
is an emmm addition; it now lives in **MIDI Settings** with clock out, independent of Extended,
and follows the incoming clock at 24 ppq per quarter note (it does not apply the Sync Ratio to
incoming clock — U25).

**External transport (October 2026).** The MIDI meaning of the real-time messages: Start (FA)
= from the beginning (Song Position 0 + Continue); Stop (FC) = halt, keeping the position;
Continue (FB) = resume from that position; Song Position Pointer (F2) = a position in 16ths
(six clocks each); the first clock after Start is the downbeat. Squarp's Hermod+ manual: Play
starts; "Press play again to stop the sequencer and return to the beginning of the sequence";
the SYNC OUT settings send "CLOCK+TRANSPORT", "ONLY CLOCK" or "ONLY TRANSPORT" per port, and
**CLOCK ON STOP** sends clock while stopped. It does not say whether it ever sends Continue or
Song Position (so a Hermod+ master is expected to send FA … FC … FA). emmm now follows these
meanings (FC no longer rewinds — a DAW's Stop / Continue resumes; Song Position 0 rewinds; other
positions are not located, U26) and counts the first clock after Start as tick 0 (it used to
count it as tick 4, which put emmm one pulse — 1/24 beat — ahead of its master). Tested with
simulated message streams; no Hermod+ was attached.

## Things not yet studied

* Running the original program (emulator) to observe exact timings, defaults and edge cases.
  The Macintosh Repository lists the software (S7). See UNCERTAINTIES for what to check.
* The 1987 M User's Manual (Intelligent Computer Music Systems) — not found online yet.
