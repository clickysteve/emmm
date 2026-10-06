/**
 * The Input Control System key map (M-BEHAVIOUR §14). M names MIDI 60 "C3", so C1 = 36.
 *
 * White keys from C1 upward are numbered 0,1,2… and double as letters A,B,C… for
 * Snapshots. White keys are one-step controls; black keys are "code" keys which wait for one
 * white value key. Sources: S1 ch.10 + Appendix B, S2 Fig. 11. Two code keys (G#3 Legato,
 * A#3 Accent) are inferred from the order in S2 Fig. 11. @m-uncertain
 */
import type { VariableName } from './types';

export type OneStep =
  | { kind: 'playToggle'; voice: number }
  | { kind: 'clearPattern'; voice: number }
  | { kind: 'stepAdvance'; voice: number } // voice -1 = all "sa" voices
  | { kind: 'tapTempo' }
  | { kind: 'start' }
  | { kind: 'stop' }
  | { kind: 'sync' }
  | { kind: 'holdDo' }
  | { kind: 'sequenceToggle' }
  | { kind: 'stopSlideshow' }
  | { kind: 'decelerando' }
  | { kind: 'freezeTempo' }
  | { kind: 'accelerando' }
  | { kind: 'tapConduct' };

export type Code =
  | { kind: 'variable'; variable: VariableName }
  | { kind: 'timeBase'; voice: number }
  | { kind: 'snapshot' }
  | { kind: 'playSlideshow' }
  | { kind: 'recordSlideshow' }
  | { kind: 'editSnapshot' };

const C1 = 36;
const WHITE = [0, 2, 4, 5, 7, 9, 11];

/** White key → value number (C1 = 0), or null for black keys / out of range. */
export function whiteIndex(note: number): number | null {
  const rel = note - C1;
  if (rel < 0) return null;
  const oct = Math.floor(rel / 12);
  const pc = rel % 12;
  const i = WHITE.indexOf(pc);
  return i < 0 ? null : oct * 7 + i;
}

const name = (s: string): number => {
  const m = /^([A-G])(#?)(\d)$/.exec(s)!;
  const pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]]!;
  return (Number(m[3]) + 2) * 12 + pc + (m[2] ? 1 : 0);
};

/** One-step controls by white-key value number (0 = C1). */
export const ONE_STEP: Record<number, OneStep> = {
  0: { kind: 'playToggle', voice: 0 }, // C1
  1: { kind: 'playToggle', voice: 1 }, // D1
  2: { kind: 'playToggle', voice: 2 }, // E1
  3: { kind: 'playToggle', voice: 3 }, // F1
  4: { kind: 'clearPattern', voice: 0 }, // G1
  5: { kind: 'clearPattern', voice: 1 }, // A1
  6: { kind: 'clearPattern', voice: 2 }, // B1
  7: { kind: 'clearPattern', voice: 3 }, // C2
  8: { kind: 'stepAdvance', voice: 0 }, // D2
  9: { kind: 'stepAdvance', voice: 0 }, // E2
  10: { kind: 'tapTempo' }, // F2
  11: { kind: 'stepAdvance', voice: 1 }, // G2
  12: { kind: 'stepAdvance', voice: 1 }, // A2
  13: { kind: 'stop' }, // B2
  14: { kind: 'start' }, // C3 middle C
  15: { kind: 'stepAdvance', voice: -1 }, // D3
  16: { kind: 'stepAdvance', voice: -1 }, // E3
  17: { kind: 'sync' }, // F3
  18: { kind: 'stepAdvance', voice: 2 }, // G3
  19: { kind: 'stepAdvance', voice: 2 }, // A3
  20: { kind: 'holdDo' }, // B3
  21: { kind: 'sequenceToggle' }, // C4
  22: { kind: 'stepAdvance', voice: 3 }, // D4
  23: { kind: 'stepAdvance', voice: 3 }, // E4
  24: { kind: 'stopSlideshow' }, // F4
  25: { kind: 'decelerando' }, // G4
  26: { kind: 'freezeTempo' }, // A4
  27: { kind: 'accelerando' }, // B4
  28: { kind: 'tapConduct' }, // C5
};

/** Code (black) keys by MIDI note. */
export const CODES: Record<number, Code> = {
  [name('C#1')]: { kind: 'snapshot' },
  [name('D#1')]: { kind: 'timeBase', voice: 0 },
  [name('F#1')]: { kind: 'timeBase', voice: 1 },
  [name('G#1')]: { kind: 'timeBase', voice: 2 },
  [name('A#1')]: { kind: 'timeBase', voice: 3 },
  [name('C#2')]: { kind: 'variable', variable: 'patternGroup' },
  [name('D#2')]: { kind: 'variable', variable: 'noteOrder' },
  [name('F#2')]: { kind: 'variable', variable: 'soundChoice' },
  [name('G#2')]: { kind: 'variable', variable: 'orchestration' },
  [name('A#2')]: { kind: 'variable', variable: 'transposition' },
  [name('C#3')]: { kind: 'variable', variable: 'velocityRange' },
  [name('D#3')]: { kind: 'variable', variable: 'noteDensity' },
  [name('F#3')]: { kind: 'variable', variable: 'rhythm' },
  [name('G#3')]: { kind: 'variable', variable: 'legato' },
  [name('A#3')]: { kind: 'variable', variable: 'accent' },
  [name('C#4')]: { kind: 'snapshot' },
  [name('D#4')]: { kind: 'playSlideshow' },
  [name('F#4')]: { kind: 'recordSlideshow' },
  [name('G#4')]: { kind: 'editSnapshot' },
};

export type IcsAction =
  | { kind: 'oneStep'; action: OneStep }
  | { kind: 'code'; code: Code }
  | { kind: 'value'; code: Code; value: number }
  | { kind: 'release'; action: OneStep }
  | { kind: 'none' };

/** Two-step state machine: feed note-ons (and note-offs for step advance). */
export class InputControl {
  pending: Code | null = null;

  noteOn(note: number): IcsAction {
    const code = CODES[note];
    if (code) {
      this.pending = code;
      return { kind: 'code', code };
    }
    const w = whiteIndex(note);
    if (w === null) return { kind: 'none' };
    if (this.pending) {
      const c = this.pending;
      this.pending = null;
      return { kind: 'value', code: c, value: w };
    }
    const a = ONE_STEP[w];
    return a ? { kind: 'oneStep', action: a } : { kind: 'none' };
  }

  noteOff(note: number): IcsAction {
    const w = whiteIndex(note);
    if (w === null) return { kind: 'none' };
    const a = ONE_STEP[w];
    return a && a.kind === 'stepAdvance' ? { kind: 'release', action: a } : { kind: 'none' };
  }
}

/** Time Base denominator chosen by a value key: the value is the denominator itself when
 * legal; 0 = sa. [INF: S1 example "value key number 2" → denominator 2] */
export const TIME_BASE_FROM_VALUE = (value: number, legal: readonly number[]): number | null => (legal.includes(value) ? value : null);
