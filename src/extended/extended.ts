import { Rng } from '../engine/rng';

/**
 * EXTENDED mode — "what might M have become?" Everything here is OFF unless the document's
 * `extended.enabled` is true, and nothing here changes how Classic computes notes.
 *
 *   1. MIDI clock input: follow an external tempo, Start / Stop / Continue.
 *   2. MIDI Learn: map incoming controllers / notes to emmm controls. The mappings describe
 *      the user's hardware, so they are an application preference (app/prefs.ts), not part
 *      of the document.
 *   3. CC Cycles: cyclic distributions (M's cyclic-variable model) driving MIDI controllers.
 *   4. Seed / Reroll, Locks, Mutation and A/B performance states (mutation.ts, perfState.ts).
 */
import type { Cycle, VariableName } from '../engine/types';

export type LearnTarget =
  /** a controller sweeps the six Positions; a key steps to the next one */
  | { kind: 'variable'; variable: VariableName }
  /** a key (or a controller crossing the middle) selects one Position */
  | { kind: 'position'; variable: VariableName; position: number }
  | { kind: 'tempo' }
  | { kind: 'batonX' }
  | { kind: 'batonY' }
  | { kind: 'start' }
  | { kind: 'stop' }
  | { kind: 'sync' }
  | { kind: 'holdDo' }
  | { kind: 'playEnable'; voice: number }
  | { kind: 'snapshot'; index: number }
  | { kind: 'pause' }
  | { kind: 'mutate' }
  | { kind: 'mutationAmount' }
  | { kind: 'reroll' }
  | { kind: 'abRecall'; slot: 'a' | 'b' }
  | { kind: 'abCapture'; slot: 'a' | 'b' }
  | { kind: 'abToggle' };

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

/** What a Lock protects from Mutation and Reroll (manual editing is never blocked). */
export type LockDim =
  | 'patternGroup'
  | 'material'
  | 'noteDensity'
  | 'velocityRange'
  | 'noteOrder'
  | 'transposition'
  | 'timeDistortion'
  | 'rhythm'
  | 'legato'
  | 'accent'
  | 'orchestration'
  | 'positions';
export const LOCK_DIMS: { id: LockDim; label: string; help: string }[] = [
  { id: 'positions', label: 'Positions', help: 'which Position of each Variable is active' },
  { id: 'patternGroup', label: 'Pat Group', help: 'the active Pattern Group' },
  { id: 'material', label: 'Material', help: 'the Patterns’ scrambled (Cyclic Random) order' },
  { id: 'noteDensity', label: 'Density', help: 'Note Density values' },
  { id: 'velocityRange', label: 'Vel Range', help: 'Velocity Range values' },
  { id: 'noteOrder', label: 'Note Order', help: 'Note Order mixes' },
  { id: 'transposition', label: 'Transpose', help: 'Transposition values' },
  { id: 'timeDistortion', label: 'Time Dist', help: 'Time Distortion maps' },
  { id: 'rhythm', label: 'Rhythm', help: 'Rhythm cycles' },
  { id: 'legato', label: 'Legato', help: 'Legato cycles' },
  { id: 'accent', label: 'Accent', help: 'Accent cycles' },
  { id: 'orchestration', label: 'Orch', help: 'Orchestration (which channels each Voice plays)' },
];

export interface Locks {
  /** a locked Voice keeps its random stream on Reroll and is left alone by Mutation */
  voices: boolean[];
  dims: Record<LockDim, boolean>;
}

/** A captured performance state for the A/B buttons (see perfState.ts). */
export type PerfStateData = Record<string, unknown>;

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
  locks: Locks;
  /** Mutation strength 0 (subtle) … 100 (chaos), and how many mutations so far (for the seed). */
  mutation: { amount: number; count: number };
  /** per-voice seed overrides: a Voice locked during a Reroll keeps its old seed; null = the
   * document seed. All null = exactly Classic. */
  voiceSeeds: (number | null)[];
  ab: { a: PerfStateData | null; b: PerfStateData | null; last: 'a' | 'b' | null };
}

const VARS: VariableName[] = ['patternGroup', 'noteDensity', 'velocityRange', 'noteOrder', 'transposition', 'timeDistortion', 'rhythm', 'legato', 'accent', 'orchestration', 'soundChoice'];
const POS_VARS: VariableName[] = ['patternGroup', 'noteDensity', 'velocityRange', 'noteOrder', 'transposition', 'timeDistortion', 'rhythm', 'legato', 'accent', 'orchestration'];

/** Every target MIDI Learn offers, in display order, grouped. */
export function allLearnTargets(): { group: string; targets: LearnTarget[] }[] {
  return [
    { group: 'Transport', targets: [{ kind: 'start' }, { kind: 'stop' }, { kind: 'pause' }, { kind: 'sync' }, { kind: 'holdDo' }, { kind: 'tempo' }] },
    { group: 'Variables (controller sweeps Positions)', targets: VARS.map((variable) => ({ kind: 'variable', variable }) as LearnTarget) },
    { group: 'Positions', targets: POS_VARS.flatMap((variable) => [0, 1, 2, 3, 4, 5].map((position) => ({ kind: 'position', variable, position }) as LearnTarget)) },
    { group: 'Conducting', targets: [{ kind: 'batonX' }, { kind: 'batonY' }] },
    { group: 'Voices', targets: [0, 1, 2, 3].map((voice) => ({ kind: 'playEnable', voice }) as LearnTarget) },
    { group: 'Snapshots', targets: Array.from({ length: 26 }, (_, index) => ({ kind: 'snapshot', index }) as LearnTarget) },
    {
      group: 'Extended',
      targets: [
        { kind: 'mutate' },
        { kind: 'mutationAmount' },
        { kind: 'reroll' },
        { kind: 'abRecall', slot: 'a' },
        { kind: 'abRecall', slot: 'b' },
        { kind: 'abToggle' },
        { kind: 'abCapture', slot: 'a' },
        { kind: 'abCapture', slot: 'b' },
      ],
    },
  ];
}

export function targetKey(t: LearnTarget): string {
  return JSON.stringify(t, Object.keys(t).sort());
}

function cleanTarget(v: unknown): LearnTarget | null {
  if (!v || typeof v !== 'object') return null;
  const key = targetKey(v as LearnTarget);
  for (const g of allLearnTargets()) for (const t of g.targets) if (targetKey(t) === key) return t;
  return null;
}

function cleanSource(v: unknown): LearnSource | null {
  const s = v as LearnSource | null;
  if (!s || (s.type !== 'cc' && s.type !== 'note')) return null;
  if (!Number.isInteger(s.channel) || s.channel < 1 || s.channel > 16) return null;
  if (!Number.isInteger(s.number) || s.number < 0 || s.number > 127) return null;
  return { type: s.type, channel: s.channel, number: s.number };
}

/** Validate stored mappings: drop unknown targets and unlearnt rows. */
export function cleanLearnMappings(v: unknown): LearnMapping[] {
  if (!Array.isArray(v)) return [];
  const out: LearnMapping[] = [];
  for (const m of v) {
    const target = cleanTarget((m as LearnMapping)?.target);
    const source = cleanSource((m as LearnMapping)?.source);
    if (target && source) out.push({ target, source });
  }
  return out;
}

export function defaultLocks(): Locks {
  return { voices: [false, false, false, false], dims: Object.fromEntries(LOCK_DIMS.map((d) => [d.id, false])) as Record<LockDim, boolean> };
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
  return {
    enabled: false,
    ccCycles: defaultCcCycles(),
    clockIn: { enabled: false, port: '*', transport: true },
    locks: defaultLocks(),
    mutation: { amount: 25, count: 0 },
    voiceSeeds: [null, null, null, null],
    ab: { a: null, b: null, last: null },
  };
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

const VAR_NAMES: Record<VariableName, string> = { patternGroup: 'Pattern Group', noteDensity: 'Note Density', velocityRange: 'Velocity Range', noteOrder: 'Note Order', transposition: 'Transposition', timeDistortion: 'Time Distortion', rhythm: 'Rhythm', legato: 'Legato', accent: 'Accent', orchestration: 'Orchestration', soundChoice: 'Sound Choice' };

export function targetLabel(t: LearnTarget): string {
  switch (t.kind) {
    case 'variable':
      return VAR_NAMES[t.variable];
    case 'position':
      return `${VAR_NAMES[t.variable]} ${t.variable === 'patternGroup' ? 'abcdef'[t.position] : t.position + 1}`;
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
      return `Snapshot ${String.fromCharCode(65 + t.index)}`;
    case 'pause':
      return 'Pause';
    case 'mutate':
      return 'Mutate';
    case 'mutationAmount':
      return 'Mutation amount';
    case 'reroll':
      return 'Reroll';
    case 'abRecall':
      return `Recall ${t.slot.toUpperCase()}`;
    case 'abCapture':
      return `Capture ${t.slot.toUpperCase()}`;
    case 'abToggle':
      return 'A ⇄ B';
  }
}

export function sourceLabel(s: LearnSource | null): string {
  if (!s) return '—';
  return `${s.type === 'cc' ? 'CC' : 'note'} ${s.number} ch${s.channel}`;
}

/** Add or re-assign a mapping. One source drives one target: a source learnt for a new
 * target is taken away from any old one. Returns the label of the target it replaced. */
export function learnInto(list: LearnMapping[], target: LearnTarget, source: LearnSource, replaceIndex: number | null): string | null {
  let replaced: string | null = null;
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (i !== replaceIndex && m.source && sameSource(m.source, source)) {
      replaced = targetLabel(m.target);
      list.splice(i, 1);
      if (replaceIndex !== null && i < replaceIndex) replaceIndex--;
    }
  }
  if (replaceIndex !== null && list[replaceIndex]) list[replaceIndex] = { target, source };
  else list.push({ target, source });
  return replaced;
}

export function sameSource(a: LearnSource, b: LearnSource): boolean {
  return a.type === b.type && a.channel === b.channel && a.number === b.number;
}

/** External-clock sync status, for display. */
export type SyncStatus = 'internal' | 'waiting' | 'running' | 'lost';

/** A gap this long between clock pulses means the clock has stopped or been unplugged
 * (24 ppq at 20 bpm is one pulse every 125 ms). */
export const CLOCK_LOST_MS = 400;

/**
 * MIDI clock follower: estimates tempo from 24-ppq pulses and nudges it to stay in phase
 * with the pulse count (a gentle, bounded proportional correction).
 *
 * The estimate is a trimmed mean of the last 24 pulse intervals, so jittery USB/IAC timing
 * does not make the tempo wobble. A gap longer than CLOCK_LOST_MS marks the clock lost:
 * the tempo then simply stays where it was (no runaway), and when pulses return the
 * estimate starts again from fresh intervals.
 */
export class ClockFollower {
  private intervals: number[] = [];
  private last = -Infinity;
  pulses = 0;
  running = false;
  lastPulseMs = -Infinity;
  /** set when pulses resume after a loss; the owner re-aligns the phase (rebase) */
  recovered = false;

  reset(): void {
    this.intervals = [];
    this.last = -Infinity;
    this.pulses = 0;
    this.lastPulseMs = -Infinity;
    this.recovered = false;
  }

  /** Feed one 0xF8 pulse at time `ms`. Returns the bpm estimate (or null while warming up). */
  pulse(ms: number): number | null {
    this.pulses++;
    this.lastPulseMs = ms;
    const gap = ms - this.last;
    this.last = ms;
    if (!(gap > 0) || gap > CLOCK_LOST_MS) {
      // first pulse, or recovering after a loss: start the estimate again
      this.intervals = [];
      if (gap > CLOCK_LOST_MS && gap !== Infinity) this.recovered = true;
      return null;
    }
    this.intervals.push(gap);
    if (this.intervals.length > 24) this.intervals.shift();
    if (this.intervals.length < 6) return null;
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const cut = Math.floor(sorted.length / 5);
    const mid = sorted.slice(cut, sorted.length - cut);
    const mean = mid.reduce((a, b) => a + b, 0) / mid.length;
    return 60000 / (mean * 24);
  }

  /** Status at time `now` (ms), given that clock input is enabled. */
  status(now: number, playing: boolean): SyncStatus {
    if (this.lastPulseMs === -Infinity) return 'waiting';
    if (now - this.lastPulseMs > CLOCK_LOST_MS) return playing ? 'lost' : 'waiting';
    return playing ? 'running' : 'waiting';
  }

  /** After a loss, count pulses from where emmm is now instead of chasing the gap. */
  rebase(nowTick: number): void {
    this.pulses = Math.round(nowTick / 4);
    this.recovered = false;
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
