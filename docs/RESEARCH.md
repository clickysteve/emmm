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

## Things not yet studied

* Running the original program (emulator) to observe exact timings, defaults and edge cases.
  The Macintosh Repository lists the software (S7). See UNCERTAINTIES for what to check.
* The 1987 M User's Manual (Intelligent Computer Music Systems) — not found online yet.
