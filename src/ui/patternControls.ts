/**
 * The per-Pattern timing numericals — Output Length, Time Base (n | d) and Phase — built
 * once here and used by both the Patterns window and the Pattern Editor, so the two are
 * always the same controls on the same Pattern state (they are stored in the Pattern, in
 * the active Pattern Group: see docs/M-BEHAVIOUR.md §2–3).
 */
import { STEP_ADVANCE, TIME_BASE_DENOMINATORS, TICKS_PER_QUARTER } from '../engine/constants';
import type { Pattern } from '../engine/types';
import type { UiContext } from './context';
import { el } from './dom';
import { Numerical } from './widgets';

export const TIPS = {
  outputLength:
    'Output Length: how many steps of this Pattern the Voice plays (the rest stay in the Pattern). Alt-drag: change the Pattern itself — add rests or delete steps at the end.',
  tbNum: 'Time Base numerator. The Voice moves one step every n / d of a whole note: 1|8 = eighth notes, 1|4 = quarters, 3|8 = dotted quarters. Rhythm multiplies this; Tempo sets the speed of everything.',
  tbDen: 'Time Base denominator: 1 whole · 2 half · 4 quarter · 8 eighth · 16 sixteenth; 3, 6, 12, 24 are triplets; sa = step advance (moves only on MIDI input).',
  phase: 'Phase: delay this Voice’s first step after Start or Sync by 0–199 ticks (96 = one quarter note), to set it against the others.',
};

export type TimingKey = 'outputLength' | 'tbNum' | 'tbDen' | 'phase';
type Rect = [number, number, number, number];

export interface TimingControls {
  len: Numerical;
  num: Numerical;
  den: Numerical;
  phase: Numerical;
  update(): void;
}

/**
 * Build the four numericals for the voice `voice()` (a function, so the Pattern Editor can
 * follow the voice it is viewing). `hold` lets the Patterns window collect them for Hold/Do.
 */
export function timingControls(
  ctx: UiContext,
  parent: HTMLElement,
  voice: () => number,
  at: Record<'len' | 'num' | 'den' | 'phase', Rect>,
  hold?: (k: TimingKey) => (ev: PointerEvent) => boolean,
): TimingControls {
  const s = ctx.s;
  const pat = (): Pattern => s.pattern(voice());
  const len = new Numerical(parent, ...at.len, {
    get: () => pat().outputLength,
    set: (x, i) => {
      if (i.alt) {
        if (i.final) s.setOutputLength(voice(), x, true);
      } else s.setOutputLength(voice(), x, false);
    },
    min: 0,
    max: 999,
    deferWithAlt: true,
    intercept: hold?.('outputLength'),
    title: TIPS.outputLength,
  });
  const num = new Numerical(parent, ...at.num, {
    get: () => pat().tbNum,
    set: (x) => s.setTimeBase(voice(), x, pat().tbDen),
    min: 1,
    max: 99,
    intercept: hold?.('tbNum'),
    title: TIPS.tbNum,
  });
  const bar = el('div', 'label', parent, [at.num[0] + at.num[2], at.num[1] + Math.round(at.num[3] / 2) - 5, 4, 10], '|');
  bar.setAttribute('aria-hidden', 'true');
  const den = new Numerical(parent, ...at.den, {
    get: () => pat().tbDen,
    set: (x) => s.setTimeBase(voice(), pat().tbNum, x),
    values: TIME_BASE_DENOMINATORS,
    format: (x) => (x === STEP_ADVANCE ? 'sa' : String(x)),
    intercept: hold?.('tbDen'),
    title: TIPS.tbDen,
  });
  const phase = new Numerical(parent, ...at.phase, {
    get: () => pat().phase,
    set: (x) => ((pat().phase = x), s.changed('patterns')),
    min: 0,
    max: 199,
    intercept: hold?.('phase'),
    title: TIPS.phase,
  });
  for (const [n, name] of [
    [len, 'Output Length'],
    [num, 'Time Base numerator'],
    [den, 'Time Base denominator'],
    [phase, 'Phase'],
  ] as const) {
    n.el.setAttribute('role', 'spinbutton');
    n.el.setAttribute('aria-label', name);
  }
  return {
    len,
    num,
    den,
    phase,
    update: () => [len, num, den, phase].forEach((n) => n.update()),
  };
}

/** A plain-words reading of a Time Base, e.g. "1 step = ⅛ note" or "step advance". */
export function timeBaseWords(p: Pattern, tempo: number): string {
  if (p.tbDen === STEP_ADVANCE) return 'step advance: moves on MIDI input';
  const ticks = (p.tbNum * TICKS_PER_QUARTER * 4) / p.tbDen;
  const perMin = (tempo * TICKS_PER_QUARTER) / ticks;
  return `step = ${p.tbNum}/${p.tbDen} note · ${perMin < 10 ? perMin.toFixed(1) : Math.round(perMin)}/min × Rhythm`;
}
