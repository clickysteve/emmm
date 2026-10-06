/**
 * Recording MIDI notes into a Pattern (M-BEHAVIOUR §9).
 *
 * Notes land at the MIDI Edit Counter. Record mode decides how simultaneous notes group
 * (Single / Chord / Build); insertion mode decides whether a step is inserted, replaced or
 * added to. The recorder is a small state machine fed with note-on/off and time in ms.
 */
import { CHORD_WINDOW_MS, MAX_PATTERN_STEPS } from './constants';
import { insertSteps, repairScrambled } from './patternOps';
import type { Rng } from './rng';
import type { Pattern } from './types';

export interface EditRange {
  /** inclusive start, exclusive end; end may be steps.length + 1 */
  start: number;
  end: number;
}

export class PatternRecorder {
  /** MIDI Edit Counter: the step new notes affect. */
  counter = 0;
  range: EditRange | null = null;
  private held = new Set<number>();
  /** chord grouping (Chord mode): step index and time of the group being collected */
  private chordStep = -1;
  private chordTime = -Infinity;
  /** Build mode: the step being built */
  private buildStep = -1;

  constructor(private rng: Rng, private dontScrambleRests: () => boolean) {}

  reset(counter = 0): void {
    this.counter = counter;
    this.held.clear();
    this.chordStep = -1;
    this.buildStep = -1;
  }

  private clampCounter(p: Pattern): void {
    const max = this.range ? Math.min(this.range.end - 1, p.steps.length) : p.steps.length;
    const min = this.range ? this.range.start : 0;
    if (this.counter > max) this.counter = this.range ? min : max;
    if (this.counter < min) this.counter = min;
  }

  /** Place `pitch` according to the insertion mode at the counter; returns the step used. */
  private place(p: Pattern, pitch: number, mode: Pattern['insertMode'], newStep: boolean): number {
    this.clampCounter(p);
    const at = this.counter;
    const wasFull = p.outputLength === p.steps.length;
    if (!newStep && at < p.steps.length) {
      // continue an existing chord / build at this step
      if (!p.steps[at].includes(pitch)) p.steps[at].push(pitch);
      return at;
    }
    if (mode === 'insert' || at >= p.steps.length) {
      if (p.steps.length >= MAX_PATTERN_STEPS) return -1;
      insertSteps(p, at, [[pitch]], this.rng, this.dontScrambleRests());
      if (wasFull) p.outputLength = p.steps.length;
    } else if (mode === 'replace') {
      p.steps[at] = [pitch];
    } else {
      if (!p.steps[at].includes(pitch)) p.steps[at].push(pitch);
    }
    return at;
  }

  /** Note-on while recording. `t` in ms. Returns true if the pattern changed. */
  noteOn(p: Pattern, pitch: number, t: number): boolean {
    this.held.add(pitch);
    if (p.chordMode === 'build') {
      if (this.buildStep < 0) {
        const at = this.place(p, pitch, p.insertMode, true);
        this.buildStep = at;
        // a fresh build step contains only what is played into it
        if (at >= 0 && p.insertMode !== 'overdub') p.steps[at] = [pitch];
      } else {
        const s = p.steps[this.buildStep];
        // replaying a note already in the building chord removes it [DOC]
        if (s.includes(pitch)) s.splice(s.indexOf(pitch), 1);
        else s.push(pitch);
      }
      return true;
    }
    if (p.chordMode === 'chord' && this.chordStep >= 0 && t - this.chordTime <= CHORD_WINDOW_MS) {
      if (!p.steps[this.chordStep].includes(pitch)) p.steps[this.chordStep].push(pitch);
      return true;
    }
    const at = this.place(p, pitch, p.insertMode, true);
    if (at < 0) return false;
    this.chordStep = at;
    this.chordTime = t;
    // Drum Machine mode: the counter is driven by playback (follow), not by input.
    if (!p.drumMachine) this.advance(p);
    return true;
  }

  noteOff(p: Pattern, pitch: number): boolean {
    this.held.delete(pitch);
    if (p.chordMode === 'build' && this.held.size === 0 && this.buildStep >= 0) {
      this.counter = this.buildStep;
      this.buildStep = -1;
      this.advance(p);
      return true;
    }
    return false;
  }

  /** Sustain pedal down with "Sustain Enters Rests". */
  rest(p: Pattern): void {
    this.clampCounter(p);
    const at = this.counter;
    const wasFull = p.outputLength === p.steps.length;
    if (p.insertMode === 'insert' || at >= p.steps.length) {
      insertSteps(p, at, [[]], this.rng, this.dontScrambleRests());
      if (wasFull) p.outputLength = p.steps.length;
    } else if (p.insertMode === 'replace') p.steps[at] = [];
    this.advance(p);
  }

  private advance(p: Pattern): void {
    this.counter++;
    const end = this.range ? this.range.end : p.steps.length + 1;
    if (this.counter >= end) this.counter = this.range ? this.range.start : end - 1;
  }

  /** Drum Machine mode: the counter follows the playing position. */
  follow(stepIndex: number): void {
    this.counter = Math.max(0, stepIndex);
    this.chordStep = -1;
  }

  /** Clear Current Pattern (Input Control): steps become rests, length kept. */
  static clearToRests(p: Pattern, rng: Rng, dontScrambleRests: boolean): void {
    p.steps = p.steps.map(() => []);
    repairScrambled(p, rng, dontScrambleRests);
  }
}
