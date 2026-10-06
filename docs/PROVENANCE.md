# Provenance

emmm is a from-scratch reimplementation of Intelligent Music's **M**. No original
program code, binaries, disk images, bitmaps, fonts or manuals are included in this
repository. Every visual element is drawn with newly written HTML/CSS/SVG.

This file records the sources used to reconstruct M's behaviour and interface, so that
any particular decision can be traced back and re-checked.

## Primary sources

| # | Source | What it was used for |
|---|--------|----------------------|
| S1 | *M — An Intelligent Musical Instrument*, Version 2.7 manual. David Zicarelli, Joel Chadabe, John Offenhartz, Antony Widoff; manual by Richard Lainhart, Joel Chadabe, David Zicarelli. Cycling '74, © 1997–2007. Free download: <https://cycling74.s3.amazonaws.com/download/M27.pdf> | The main behavioural reference: every window, variable, edit window, option, keyboard command, Input Control System key map, recording modes, Pattern menu operations, snapshots/slideshows, conducting. Its screenshots (Mac, 1-bit) are the main visual reference. |
| S2 | David Zicarelli, "M and Jam Factory", *Computer Music Journal* 11(4), Winter 1987, pp. 13–29 (JSTOR 3680237). Copy consulted at <https://www.modelisationsavoirs.fr/atiam/biblio/Zicarelli_MandJamFactory.pdf> | Internal architecture: 96 ticks per quarter, tick routine, time-base counters, the "cyclic distribution" data structure, Fig. 10 (pitch / timing / velocity computation chain), Fig. 11 (Input Control key assignments), widget design (numerical, range bar, choice bar, button matrix), time-distortion implementation via per-tick tables, drum-machine scramble lists. |
| S3 | "Intelligent Music M" review, *Music Technology*, March 1988. <https://www.muzines.co.uk/articles/intelligent-music-m/1067> | Atari ST port vs Mac ("essentially identical"), user experience, criticisms. |
| S4 | "Intelligent Music", *Sound On Sound*, August 1988. <https://www.muzines.co.uk/articles/intelligent-music/3953> | Version history (0.91 → 2.0), Atari port, 999 notes per pattern, nine slideshows, MIDI File import options. |
| S5 | "Intelligent Music", *Music Technology*, March 1987. <https://www.muzines.co.uk/articles/intelligent-music/272> | Early (v1) description: "Intensity Range", "Tempo Divide", 16-preset Sound Choice, 26 snapshots. |
| S6 | "M: Interactive Composition", *MyAtari* magazine, Jan 2002 (mirror). <https://www.exxosforum.co.uk/atari/mirror/myatari/issues/jan2002/m.htm> and its screenshot `images/m1.gif` | Atari ST 1.x screen layout (Patterns / Note Manipulation / MIDI Variables / Cyclic Editor / snapshot strip), presence of a "Direction" variable in the early version, port by Eric Ameres, freeware release 1.25. |
| S7 | Macintosh Repository entry for M. <https://www.macintoshrepository.org/32690-m-%E2%80%93-the-intelligent-composing-and-performing-system> | Confirms availability of the original software for emulator study (not used yet — see UNCERTAINTIES). |

Local working copies of S1, S2 and S6 (and page renders / crops used for visual study)
were kept in `research-sources/`, which is **git-ignored and not distributed**.

## How sources map to emmm

* Musical engine (`src/engine/`) — S1 chapters 6, 7, 13, 16, 17; S2 "The Algorithms",
  Fig. 10. Specific constants (96 ticks per quarter; 384 ticks per whole note; legato
  defaults 100/75/50/25/6; time base denominator list; phase up to 199 ticks; 999 steps per
  pattern; 26 snapshots; 9 slideshows; 16 Sound Choice positions) come from S1 and S2.
* Input Control System key map (`src/engine/inputControl.ts`) — S1 Ch. 10 and Appendix B,
  cross-checked against S2 Fig. 11.
* Interface (`src/ui/`) — redrawn by hand from the visual language in S1's screenshots:
  black desktop, white 1-bit windows, bold title in a tab with a slanted right edge,
  close triangle, six-box position selectors, conducting-arrow boxes, miniature
  representations, dithered range bars, Picture Matrix pop-ups. No pixels were copied.

## Third-party code / assets actually shipped

| Item | Licence | Notes |
|------|---------|-------|
| Pixelify Sans (via `@fontsource/pixelify-sans`) | SIL OFL 1.1 | Stand-in for the bold Mac system font used in titles. Not a copy of Chicago. |
| Silkscreen (via `@fontsource/silkscreen`) | SIL OFL 1.1 | Small label face. |
| Vite, Vitest, TypeScript (dev only) | MIT / Apache-2.0 | Build and test tooling, not shipped in the bundle. |

## Words

Documentation in `docs/` paraphrases M's behaviour in our own words. Short M
terminology (Variable, Position, Pattern Group, Cyclic Random, Utterly Random,
Hold/Do, Slideshow, Conducting Grid, Echo-Thru-Orchestration …) is used deliberately
because it is how M users think about the instrument.
