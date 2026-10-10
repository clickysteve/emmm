/**
 * EXTENDED — Conditional Rules: "WHEN condition [every Nth] THEN action [at …]".
 * The model, validation and readable summaries. The Session evaluates them inside the
 * engine's render, through a bounded event queue (app/conductor.ts; docs/CONDUCTORS.md §5).
 */
import { NUM_POSITIONS, NUM_SNAPSHOTS, NUM_VOICES, STEP_ADVANCE, TICKS_PER_WHOLE, TIME_BASE_DENOMINATORS } from '../engine/constants';
import type { VariableName } from '../engine/types';
import { NUM_ROBOTS, PERSONALITY_IDS, personalityInfo, ROBOT_VARS, VAR_LONG, type Personality } from './conductors';

export const MAX_RULES = 16;
/** events processed in one pass (one tick) at most */
export const MAX_QUEUE = 64;
/** events caused by rule actions are matched up to this depth */
export const MAX_DEPTH = 3;
/** deferred (quantized) rule actions waiting at most */
export const MAX_DEFERRED = 32;

export type CycleKind = 'pattern' | 'rhythm' | 'legato' | 'accent';

export type Condition =
  | { kind: 'cycle'; voice: number; cycle: CycleKind }
  | { kind: 'robotMoved'; robot: number }
  | { kind: 'robotAt'; robot: number; position: number }
  | { kind: 'robotHome'; robot: number }
  | { kind: 'variableAt'; variable: VariableName; position: number }
  | { kind: 'interval'; num: number; den: number }
  | { kind: 'homeReached' }
  | { kind: 'returnDone' };

export type Action =
  | { kind: 'advance'; robot: number }
  | { kind: 'choose'; robot: number }
  | { kind: 'enable'; robot: number; mode: 'on' | 'off' | 'toggle' }
  | { kind: 'personality'; robot: number; personality: Personality | 'next' }
  | { kind: 'setPosition'; variable: VariableName; position: number }
  | { kind: 'snapshot'; index: number }
  | { kind: 'returnHome'; immediate: boolean }
  | { kind: 'suspend'; robot: number; num: number; den: number };

export type RuleTiming = 'now' | 'quant' | 'beat' | 'bar';

export interface Rule {
  on: boolean;
  when: Condition;
  /** fire on every Nth match (1 = each) */
  every: number;
  then: Action;
  at: RuleTiming;
}

/** Something that happened, as the rule engine sees it. `depth` 0 = from the music. */
export type CondEvent =
  | { kind: 'cycle'; voice: number; cycle: CycleKind }
  | { kind: 'robotMoved'; robot: number; from: number; to: number }
  | { kind: 'robotHome'; robot: number }
  | { kind: 'variableAt'; variable: VariableName; position: number }
  | { kind: 'interval'; rule: number }
  | { kind: 'homeReached' }
  | { kind: 'returnDone' };

export const CONDITION_KINDS: { id: Condition['kind']; name: string }[] = [
  { id: 'cycle', name: 'Voice completes a cycle' },
  { id: 'robotMoved', name: 'Robot moves' },
  { id: 'robotAt', name: 'Robot enters Position' },
  { id: 'robotHome', name: 'Robot returns Home' },
  { id: 'variableAt', name: 'Variable enters Position' },
  { id: 'interval', name: 'Every musical interval' },
  { id: 'homeReached', name: 'Home is reached' },
  { id: 'returnDone', name: 'Return completes' },
];

export const ACTION_KINDS: { id: Action['kind']; name: string }[] = [
  { id: 'advance', name: 'Advance Robot' },
  { id: 'choose', name: 'Robot chooses new Position' },
  { id: 'enable', name: 'Robot on / off' },
  { id: 'personality', name: 'Robot personality' },
  { id: 'setPosition', name: 'Set Variable Position' },
  { id: 'snapshot', name: 'Recall Snapshot' },
  { id: 'returnHome', name: 'Return Home' },
  { id: 'suspend', name: 'Suspend Robot' },
];

export const TIMINGS: { id: RuleTiming; name: string; help: string }[] = [
  { id: 'now', name: 'now', help: 'at the moment of the event' },
  { id: 'quant', name: 'Q', help: 'at the next Snapshot quantization point (now if none)' },
  { id: 'beat', name: 'beat', help: 'at the next beat (quarter note)' },
  { id: 'bar', name: 'bar', help: 'at the next bar (whole note)' },
];

export const CYCLE_NAMES: Record<CycleKind, string> = { pattern: 'Pattern', rhythm: 'Rhythm', legato: 'Legato', accent: 'Accent' };

export function defaultCondition(kind: Condition['kind']): Condition {
  switch (kind) {
    case 'cycle':
      return { kind, voice: 0, cycle: 'pattern' };
    case 'robotMoved':
      return { kind, robot: 0 };
    case 'robotAt':
      return { kind, robot: 0, position: 5 };
    case 'robotHome':
      return { kind, robot: 1 };
    case 'variableAt':
      return { kind, variable: 'noteDensity', position: 3 };
    case 'interval':
      return { kind, num: 4, den: 1 };
    case 'homeReached':
    case 'returnDone':
      return { kind };
  }
}

export function defaultAction(kind: Action['kind']): Action {
  switch (kind) {
    case 'advance':
    case 'choose':
      return { kind, robot: 1 };
    case 'enable':
      return { kind, robot: 1, mode: 'toggle' };
    case 'personality':
      return { kind, robot: 2, personality: 'next' };
    case 'setPosition':
      return { kind, variable: 'noteDensity', position: 0 };
    case 'snapshot':
      return { kind, index: 0 };
    case 'returnHome':
      return { kind, immediate: false };
    case 'suspend':
      return { kind, robot: 0, num: 2, den: 1 };
  }
}

export function defaultRule(): Rule {
  return { on: true, when: defaultCondition('cycle'), every: 1, then: defaultAction('advance'), at: 'now' };
}

// ---------------------------------------------------------------------------- validation

const int = (x: unknown, lo: number, hi: number, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d);
const DENS = (TIME_BASE_DENOMINATORS as readonly number[]).filter((x) => x !== STEP_ADVANCE);
const den = (x: unknown, d: number) => (DENS.includes(x as number) ? (x as number) : d);
const robot = (x: unknown) => int(x, 0, NUM_ROBOTS - 1, 0);
const anyRobot = (x: unknown) => int(x, -1, NUM_ROBOTS - 1, -1);
const pos = (x: unknown) => int(x, 0, NUM_POSITIONS - 1, 0);
const variable = (x: unknown): VariableName | null => (ROBOT_VARS.includes(x as VariableName) ? (x as VariableName) : null);

export function cleanCondition(v: unknown): Condition | null {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  switch (o.kind) {
    case 'cycle':
      return { kind: 'cycle', voice: int(o.voice, -1, NUM_VOICES - 1, 0), cycle: (['pattern', 'rhythm', 'legato', 'accent'] as const).includes(o.cycle as CycleKind) ? (o.cycle as CycleKind) : 'pattern' };
    case 'robotMoved':
      return { kind: 'robotMoved', robot: anyRobot(o.robot) };
    case 'robotAt':
      return { kind: 'robotAt', robot: robot(o.robot), position: pos(o.position) };
    case 'robotHome':
      return { kind: 'robotHome', robot: anyRobot(o.robot) };
    case 'variableAt': {
      const vn = variable(o.variable);
      return vn ? { kind: 'variableAt', variable: vn, position: pos(o.position) } : null;
    }
    case 'interval':
      return { kind: 'interval', num: int(o.num, 1, 99, 4), den: den(o.den, 1) };
    case 'homeReached':
    case 'returnDone':
      return { kind: o.kind };
  }
  return null;
}

export function cleanAction(v: unknown): Action | null {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  switch (o.kind) {
    case 'advance':
    case 'choose':
      return { kind: o.kind, robot: robot(o.robot) };
    case 'enable':
      return { kind: 'enable', robot: robot(o.robot), mode: o.mode === 'on' || o.mode === 'off' ? o.mode : 'toggle' };
    case 'personality': {
      const r = robot(o.robot);
      let p = o.personality === 'next' || PERSONALITY_IDS.has(o.personality as Personality) ? (o.personality as Personality | 'next') : 'next';
      if (p === 'baton' && r !== 0) p = 'next';
      return { kind: 'personality', robot: r, personality: p };
    }
    case 'setPosition': {
      const vn = variable(o.variable);
      return vn ? { kind: 'setPosition', variable: vn, position: pos(o.position) } : null;
    }
    case 'snapshot':
      return { kind: 'snapshot', index: int(o.index, 0, NUM_SNAPSHOTS - 1, 0) };
    case 'returnHome':
      return { kind: 'returnHome', immediate: o.immediate === true };
    case 'suspend':
      return { kind: 'suspend', robot: robot(o.robot), num: int(o.num, 1, 99, 2), den: den(o.den, 1) };
  }
  return null;
}

export function cleanRule(v: unknown): Rule | null {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Rule>;
  const when = cleanCondition(o.when);
  const then = cleanAction(o.then);
  if (!when || !then) return null;
  return { on: o.on !== false, when, every: int(o.every, 1, 64, 1), then, at: (['now', 'quant', 'beat', 'bar'] as const).includes(o.at as RuleTiming) ? (o.at as RuleTiming) : 'now' };
}

export function cleanRules(v: unknown): Rule[] {
  if (!Array.isArray(v)) return [];
  const out: Rule[] = [];
  for (const r of v) {
    const c = cleanRule(r);
    if (c) out.push(c);
    if (out.length >= MAX_RULES) break;
  }
  return out;
}

// ---------------------------------------------------------------------------- matching

export function matches(c: Condition, e: CondEvent, ruleIndex: number): boolean {
  switch (c.kind) {
    case 'cycle':
      return e.kind === 'cycle' && e.cycle === c.cycle && (c.voice < 0 || c.voice === e.voice);
    case 'robotMoved':
      return e.kind === 'robotMoved' && (c.robot < 0 || c.robot === e.robot);
    case 'robotAt':
      return e.kind === 'robotMoved' && e.robot === c.robot && e.to === c.position;
    case 'robotHome':
      return e.kind === 'robotHome' && (c.robot < 0 || c.robot === e.robot);
    case 'variableAt':
      return e.kind === 'variableAt' && e.variable === c.variable && e.position === c.position;
    case 'interval':
      return e.kind === 'interval' && e.rule === ruleIndex;
    case 'homeReached':
      return e.kind === 'homeReached';
    case 'returnDone':
      return e.kind === 'returnDone';
  }
}

export function intervalTicks(c: { num: number; den: number }): number {
  return (Math.max(1, c.num) * TICKS_PER_WHOLE) / (c.den || 1);
}

// ---------------------------------------------------------------------------- words

const R = (i: number) => (i < 0 ? 'any Robot' : `Robot ${i + 1}`);
const P = (p: number) => `Position ${p + 1}`;
const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
export const durationWords = (num: number, d: number) => {
  const beats = intervalTicks({ num, den: d }) / 96;
  if (beats % 4 === 0) return beats === 4 ? '1 bar' : `${beats / 4} bars`;
  return beats === 1 ? '1 beat' : `${Math.round(beats * 100) / 100} beats`;
};

export function conditionWords(c: Condition): string {
  switch (c.kind) {
    case 'cycle':
      return `${c.voice < 0 ? 'any Voice' : `Voice ${c.voice + 1}`} completes a ${CYCLE_NAMES[c.cycle]} cycle`;
    case 'robotMoved':
      return `${R(c.robot)} moves`;
    case 'robotAt':
      return `${R(c.robot)} enters ${P(c.position)}`;
    case 'robotHome':
      return `${R(c.robot)} returns Home`;
    case 'variableAt':
      return `${VAR_LONG[c.variable]} enters ${P(c.position)}`;
    case 'interval':
      return `every ${durationWords(c.num, c.den)}`;
    case 'homeReached':
      return 'Home is reached';
    case 'returnDone':
      return 'Return completes';
  }
}

export function actionWords(a: Action): string {
  switch (a.kind) {
    case 'advance':
      return `${R(a.robot)} advances`;
    case 'choose':
      return `${R(a.robot)} chooses a new Position`;
    case 'enable':
      return `${R(a.robot)} ${a.mode === 'toggle' ? 'switches on/off' : a.mode === 'on' ? 'switches on' : 'switches off'}`;
    case 'personality':
      return `${R(a.robot)} becomes ${a.personality === 'next' ? 'its next personality' : personalityInfo(a.personality).name}`;
    case 'setPosition':
      return `${VAR_LONG[a.variable]} → ${P(a.position)}`;
    case 'snapshot':
      return `recall Snapshot ${String.fromCharCode(65 + a.index)}`;
    case 'returnHome':
      return a.immediate ? 'jump Home' : 'Return Home';
    case 'suspend':
      return `${R(a.robot)} pauses for ${durationWords(a.num, a.den)}`;
  }
}

export function ruleSummary(r: Rule): string {
  const every = r.every > 1 && r.when.kind !== 'interval' ? ` (every ${ord(r.every)} time)` : r.every > 1 ? ` (every ${ord(r.every)})` : '';
  const at = r.at === 'now' ? '' : r.at === 'quant' ? ' · at Q' : ` · next ${r.at}`;
  return `WHEN ${conditionWords(r.when)}${every} THEN ${actionWords(r.then)}${at}`;
}
