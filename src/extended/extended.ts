import { Rng } from '../engine/rng';

/**
 * EXTENDED mode — "what might M have become?" Everything here is OFF unless the document's
 * `extended.enabled` is true, and nothing here changes how Classic computes notes.
 *
 *   1. MIDI clock input: follow an external tempo, Start / Stop / Continue.
 *   2. MIDI Learn: map incoming controllers / notes to emmm controls.
 *   3. CC Cycles: cyclic distributions (M's cyclic-variable model) driving MIDI controllers.
 */
import type { Cycle, VariableName } from '../engine/types';

export type LearnTarget =
  | { kind: 'variable'; variable: VariableName }
  | { kind: 'tempo' }
  | { kind: 'batonX' }
  | { kind: 'batonY' }
  | { kind: 'start' }
  | { kind: 'stop' }
  | { kind: 'sync' }
  | { kind: 'holdDo' }
  | { kind: 'playEnable'; voice: number }
  | { kind: 'snapshot'; index: number };

export interface LearnSource {
  type: 'cc' | 'note';
  channel: number; // 1..16
  number: number;
}

export interface LearnMapping {
  target: LearnTarget;
  source: LearnSource | null;
}

/** A CC Cycle for one voice: which controller, and a cyclic distribution of levels. */
export interface CcVoice {
  /** controller number 0..127, or -1 = off */
  cc: number;
  cycle: Cycle;
}
export interface CcCycles {
  active: number;
  positions: CcVoice[][]; // 6 × 4
  /** global table: level 0..4 → controller value */
  values: number[];
}

export interface ExtendedSettings {
  enabled: boolean;
  ccCycles: CcCycles;
  clockIn: {
    enabled: boolean;
    /** Web MIDI input port id, '*' = any */
    port: string;
    /** follow Start / Stop / Continue messages */
    transport: boolean;
  };
  learn: LearnMapping[];
}

const VARS: VariableName[] = ['patternGroup', 'noteDensity', 'velocityRange', 'noteOrder', 'transposition', 'timeDistortion', 'rhythm', 'legato', 'accent', 'orchestration', 'soundChoice'];

export function defaultLearnTargets(): LearnMapping[] {
  const t: LearnTarget[] = [
    ...VARS.map((variable) => ({ kind: 'variable', variable }) as LearnTarget),
    { kind: 'tempo' },
    { kind: 'batonX' },
    { kind: 'batonY' },
    { kind: 'start' },
    { kind: 'stop' },
    { kind: 'sync' },
    { kind: 'holdDo' },
    ...[0, 1, 2, 3].map((voice) => ({ kind: 'playEnable', voice }) as LearnTarget),
    ...[0, 1, 2, 3, 4, 5].map((index) => ({ kind: 'snapshot', index }) as LearnTarget),
  ];
  return t.map((target) => ({ target, source: null }));
}

export function defaultCcCycles(): CcCycles {
  const ramp = (): CcVoice => ({ cc: 74, cycle: [0, 1, 2, 3, 4, 3, 2, 1].map((l) => ({ lo: l, hi: l })) });
  const off = (): CcVoice => ({ cc: -1, cycle: [{ lo: 2, hi: 2 }] });
  return {
    active: 0,
    positions: [
      [off(), off(), off(), off()],
      [ramp(), ramp(), ramp(), ramp()],
      Array.from({ length: 4 }, () => ({ cc: 74, cycle: [{ lo: 0, hi: 4 }] })),
      Array.from({ length: 4 }, () => ({ cc: 1, cycle: [{ lo: 4, hi: 4 }, { lo: 0, hi: 0 }] })),
      [off(), off(), off(), off()],
      [off(), off(), off(), off()],
    ],
    values: [0, 32, 64, 96, 127],
  };
}

export function defaultExtended(): ExtendedSettings {
  return { enabled: false, ccCycles: defaultCcCycles(), clockIn: { enabled: false, port: '*', transport: true }, learn: defaultLearnTargets() };
}

/**
 * Runs CC Cycles from the engine's step events, outside the Classic engine. Uses its own
 * seeded random stream, so Classic note output is untouched.
 */
export class CcCycleRunner {
  private counters = [0, 0, 0, 0];
  private rng: Rng;
  constructor(seed: number) {
    this.rng = new Rng(seed, 2000);
  }
  reset(seed?: number): void {
    this.counters = [0, 0, 0, 0];
    if (seed !== undefined) this.rng.reseed(seed, 2000);
  }
  /** Next controller value for a voice event, or null when the voice has no CC Cycle. */
  next(settings: CcCycles, voice: number): { cc: number; value: number } | null {
    const vc = settings.positions[settings.active]?.[voice];
    if (!vc || vc.cc < 0 || !vc.cycle.length) return null;
    const i = this.counters[voice] % vc.cycle.length;
    this.counters[voice] = (i + 1) % vc.cycle.length;
    const st = vc.cycle[i];
    const level = this.rng.int(Math.min(st.lo, st.hi), Math.max(st.lo, st.hi));
    return { cc: vc.cc, value: Math.max(0, Math.min(127, Math.round(settings.values[level] ?? 64))) };
  }
}

export function targetLabel(t: LearnTarget): string {
  switch (t.kind) {
    case 'variable':
      return { patternGroup: 'Pattern Group', noteDensity: 'Note Density', velocityRange: 'Velocity Range', noteOrder: 'Note Order', transposition: 'Transposition', timeDistortion: 'Time Distortion', rhythm: 'Rhythm', legato: 'Legato', accent: 'Accent', orchestration: 'Orchestration', soundChoice: 'Sound Choice' }[t.variable];
    case 'tempo':
      return 'Tempo (in range)';
    case 'batonX':
      return 'Baton ↔';
    case 'batonY':
      return 'Baton ↕';
    case 'start':
      return 'Start';
    case 'stop':
      return 'Stop';
    case 'sync':
      return 'Sync';
    case 'holdDo':
      return 'Hold/Do';
    case 'playEnable':
      return `Play-Enable ${t.voice + 1}`;
    case 'snapshot':
      return `Snapshot ${'ABCDEF'[t.index]}`;
  }
}

export function sourceLabel(s: LearnSource | null): string {
  if (!s) return '—';
  return `${s.type === 'cc' ? 'CC' : 'note'} ${s.number} ch${s.channel}`;
}

export function sameSource(a: LearnSource, b: LearnSource): boolean {
  return a.type === b.type && a.channel === b.channel && a.number === b.number;
}

/**
 * MIDI clock follower: estimates tempo from 24-ppq pulses with a moving average, and
 * nudges it to stay in phase with the pulse count (a gentle proportional correction).
 */
export class ClockFollower {
  private times: number[] = [];
  pulses = 0;
  running = false;

  reset(): void {
    this.times = [];
    this.pulses = 0;
  }

  /** Feed one 0xF8 pulse at time `ms`. Returns the bpm estimate (or null while warming up). */
  pulse(ms: number): number | null {
    this.pulses++;
    this.times.push(ms);
    if (this.times.length > 25) this.times.shift();
    if (this.times.length < 7) return null;
    const span = this.times[this.times.length - 1] - this.times[0];
    const n = this.times.length - 1;
    if (span <= 0) return null;
    return 60000 / ((span / n) * 24);
  }

  /** Expected M tick for the pulses received since Start (96 ticks per quarter). */
  expectedTick(): number {
    return this.pulses * 4;
  }

  /** Tempo with phase correction: `nowTick` is where emmm is; gain is per beat of error. */
  corrected(bpm: number, nowTick: number, gain = 0.1): number {
    const errBeats = (this.expectedTick() - nowTick) / 96;
    const k = Math.max(-0.15, Math.min(0.15, errBeats * gain));
    return bpm * (1 + k);
  }
}
