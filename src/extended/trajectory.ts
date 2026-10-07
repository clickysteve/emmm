/**
 * EXTENDED — Trajectory: a small musical process that moves through a sequence of values.
 *
 * A Trajectory is a list of values (e.g. 20 40 80 127 60), a target (Note Density, a MIDI
 * controller …), a rate in M's own Time Base terms (one step every n/d of a whole note), a way
 * of moving through the list (forward, backward, ping-pong, random, random walk) and Step or
 * Smooth (linear) movement. It runs for as long as the music plays, beside Patterns, Variables
 * and Cyclic Variables — not a timeline of automation events.
 *
 * How it differs from Cyclic Variables: a Cyclic Variable is read once per Voice *event*, as a
 * level (0–4) into a table, and is part of how M computes each note. A Trajectory has its own
 * clock (its rate), is independent of the notes, and sets a parameter or sends a controller.
 *
 * Timing: every step (and every Smooth update) is an engine action at an exact tick, the same
 * mechanism Slideshows use. So Trajectories are tick-exact, deterministic, independent of how
 * finely the scheduler renders, frozen by Pause, follow tempo changes and external MIDI clock,
 * and never depend on screen animation.
 *
 * Effect: note-level targets (Density, Transposition, Velocity, Legato) go through the
 * engine's runtime modulation (`MEngine.mod`) — the document's Positions are never
 * overwritten; with no Trajectory running the modulation is neutral and Classic is unchanged.
 * Tempo, the Baton, Positions and Mutation strength are moved the way conducting moves them.
 *
 * Rules:
 * - Manual control: for absolute targets, the last touch wins — a hand on the same parameter
 *   takes effect at once and the Trajectory takes over again at its next step. Offset targets
 *   (Transposition, Velocity, Legato) simply add to whatever the hand sets.
 * - Locks protect against Mutate / Reroll only; they do not stop a Trajectory you assigned.
 * - A/B states do not capture Trajectories (they keep running through a recall).
 * - Transport: Start = from the first step; Stop = reset and release control; Pause freezes;
 *   Continue resumes; Sync does not restart them.
 * - Random traversals use the document seed (stream 4000 + slot): same document + seed = same
 *   path from Start; Reroll gives a new one.
 */
import { STEP_ADVANCE, TICKS_PER_WHOLE, TIME_BASE_DENOMINATORS } from '../engine/constants';
import { Rng } from '../engine/rng';
import type { VariableName } from '../engine/types';

export const TRAJECTORY_SLOTS = 4;
export const MAX_TRAJECTORY_VALUES = 16;
/** Smooth updates at most every 6 ticks (a 64th note): ≤ 32 a second per Trajectory at 120. */
export const SMOOTH_TICKS = 6;

export type TrajMode = 'forward' | 'backward' | 'pingpong' | 'random' | 'walk';
export const TRAJ_MODES: { id: TrajMode; name: string; help: string }[] = [
  { id: 'forward', name: 'Forward', help: '1 2 3 4 1 2 …' },
  { id: 'backward', name: 'Backward', help: '4 3 2 1 4 3 …' },
  { id: 'pingpong', name: 'Ping-Pong', help: '1 2 3 4 3 2 1 2 … (the ends are not repeated)' },
  { id: 'random', name: 'Random', help: 'any value next, from the seed' },
  { id: 'walk', name: 'Random Walk', help: 'a neighbouring value next (up or down), from the seed' },
];

export type TrajTarget =
  | { kind: 'none' }
  | { kind: 'density' }
  | { kind: 'transpose' }
  | { kind: 'velocity' }
  | { kind: 'legato' }
  | { kind: 'tempo' }
  | { kind: 'batonX' }
  | { kind: 'batonY' }
  | { kind: 'mutation' }
  | { kind: 'position'; variable: VariableName }
  | { kind: 'cc'; channel: number; cc: number };

export interface Trajectory {
  on: boolean;
  target: TrajTarget;
  /** which Voices a per-Voice target affects */
  voices: boolean[];
  values: number[];
  /** rate: one step every rateNum / rateDen of a whole note (M's Time Base) */
  rateNum: number;
  rateDen: number;
  mode: TrajMode;
  smooth: boolean;
}

/** How a target behaves: its range, whether it can glide, whether it adds or replaces. */
export interface TargetInfo {
  id: string;
  name: string;
  min: number;
  max: number;
  /** continuous: may glide (Smooth); enumerated / trigger: Step only */
  kind: 'continuous' | 'integer' | 'enumerated';
  /** absolute: replaces the value; offset: adds to it (or multiplies, for Legato) */
  mode: 'absolute' | 'offset' | 'output';
  perVoice: boolean;
  unit: string;
  help: string;
  /** safe to change while playing (all are; discrete jumps are quantized to the step) */
  liveSafe: boolean;
}

const POS_VARS: VariableName[] = ['patternGroup', 'noteDensity', 'velocityRange', 'noteOrder', 'transposition', 'timeDistortion', 'rhythm', 'legato', 'accent', 'orchestration'];
const VAR_NAME: Partial<Record<VariableName, string>> = { patternGroup: 'Pattern Group', noteDensity: 'Note Density', velocityRange: 'Velocity Range', noteOrder: 'Note Order', transposition: 'Transposition', timeDistortion: 'Time Distortion', rhythm: 'Rhythm', legato: 'Legato', accent: 'Accent', orchestration: 'Orchestration' };

/** The typed registry of what a Trajectory may drive. Nothing else can be reached.
 * `scaleLock`: the document's Transposition Scale Lock — Transposition + then counts scale
 * degrees (same range and values; only their meaning and labels change). */
export function targetInfo(t: TrajTarget, scaleLock = false): TargetInfo {
  switch (t.kind) {
    case 'none':
      return { id: 'none', name: '— off —', min: 0, max: 127, kind: 'integer', mode: 'output', perVoice: false, unit: '', help: 'No target', liveSafe: true };
    case 'density':
      return { id: 'density', name: 'Note Density', min: 0, max: 100, kind: 'integer', mode: 'absolute', perVoice: true, unit: '%', help: 'Note Density in % (replaces the active Position’s value while it runs)', liveSafe: true };
    case 'transpose':
      return scaleLock
        ? { id: 'transpose', name: 'Transposition + (deg)', min: -24, max: 24, kind: 'integer', mode: 'offset', perVoice: true, unit: 'degrees', help: 'Scale degrees added to the active Transposition (Scale Lock: in each Voice’s Pattern scale)', liveSafe: true }
        : { id: 'transpose', name: 'Transposition +', min: -24, max: 24, kind: 'integer', mode: 'offset', perVoice: true, unit: 'st', help: 'Semitones added to the active Transposition', liveSafe: true };
    case 'velocity':
      return { id: 'velocity', name: 'Velocity +', min: -64, max: 64, kind: 'integer', mode: 'offset', perVoice: true, unit: '', help: 'Added to every velocity (as continuous velocity conducting does)', liveSafe: true };
    case 'legato':
      return { id: 'legato', name: 'Legato ×', min: 10, max: 400, kind: 'integer', mode: 'offset', perVoice: true, unit: '%', help: 'Note lengths scaled by this % (100 = as set)', liveSafe: true };
    case 'tempo':
      return { id: 'tempo', name: 'Tempo', min: 20, max: 300, kind: 'continuous', mode: 'absolute', perVoice: false, unit: 'bpm', help: 'Tempo in quarter notes per minute', liveSafe: true };
    case 'batonX':
      return { id: 'batonX', name: 'Baton ↔', min: 0, max: 100, kind: 'continuous', mode: 'absolute', perVoice: false, unit: '%', help: 'The Baton across the Conducting Grid (moves the Variables whose arrows are on)', liveSafe: true };
    case 'batonY':
      return { id: 'batonY', name: 'Baton ↕', min: 0, max: 100, kind: 'continuous', mode: 'absolute', perVoice: false, unit: '%', help: 'The Baton up the Conducting Grid', liveSafe: true };
    case 'mutation':
      return { id: 'mutation', name: 'Mutation strength', min: 0, max: 100, kind: 'integer', mode: 'absolute', perVoice: false, unit: '', help: 'Extended Mutation strength (subtle 0 … chaos 100)', liveSafe: true };
    case 'position':
      return {
        id: 'position:' + t.variable,
        name: `${VAR_NAME[t.variable] ?? t.variable} Position`,
        min: 1,
        max: 6,
        kind: 'enumerated',
        mode: 'absolute',
        perVoice: false,
        unit: '',
        help: t.variable === 'patternGroup' ? 'Pattern Group a–f (1–6); each change restarts the Voices, as in M' : 'Which Position (1–6) is active',
        liveSafe: true,
      };
    case 'cc':
      return { id: 'cc', name: 'MIDI controller', min: 0, max: 127, kind: 'integer', mode: 'output', perVoice: false, unit: '', help: `Controller ${t.cc} sent on M Output Channel ${t.channel} (routed by MIDI Settings)`, liveSafe: true };
  }
}

/** Targets offered in the window, in order. */
export function targetChoices(): TrajTarget[] {
  return [
    { kind: 'none' },
    { kind: 'cc', channel: 1, cc: 74 },
    { kind: 'density' },
    { kind: 'transpose' },
    { kind: 'velocity' },
    { kind: 'legato' },
    { kind: 'tempo' },
    { kind: 'batonX' },
    { kind: 'batonY' },
    { kind: 'mutation' },
    ...POS_VARS.map((variable) => ({ kind: 'position', variable }) as TrajTarget),
  ];
}

export function defaultTrajectory(): Trajectory {
  return { on: false, target: { kind: 'none' }, voices: [true, true, true, true], values: [0, 50, 100, 50], rateNum: 1, rateDen: 4, mode: 'forward', smooth: false };
}

export function defaultTrajectories(): Trajectory[] {
  return Array.from({ length: TRAJECTORY_SLOTS }, defaultTrajectory);
}

const MODES = new Set(TRAJ_MODES.map((m) => m.id));

/** Validate one stored Trajectory (hand-edited or older files). */
export function cleanTrajectory(v: unknown): Trajectory {
  const d = defaultTrajectory();
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Trajectory>;
  const target = cleanTarget(o.target);
  const info = targetInfo(target);
  const values = Array.isArray(o.values) ? o.values.filter((x) => typeof x === 'number' && Number.isFinite(x)).slice(0, MAX_TRAJECTORY_VALUES) : d.values;
  return {
    on: o.on === true,
    target,
    voices: [0, 1, 2, 3].map((i) => (Array.isArray(o.voices) ? o.voices[i] !== false : true)),
    values: (values.length ? values : [info.min]).map((x) => clampTo(info, x)),
    rateNum: Number.isInteger(o.rateNum) && (o.rateNum as number) >= 1 && (o.rateNum as number) <= 99 ? (o.rateNum as number) : 1,
    rateDen: (TIME_BASE_DENOMINATORS as readonly number[]).includes(o.rateDen as number) && o.rateDen !== STEP_ADVANCE ? (o.rateDen as number) : 4,
    mode: MODES.has(o.mode as TrajMode) ? (o.mode as TrajMode) : 'forward',
    smooth: o.smooth === true && info.kind !== 'enumerated',
  };
}

function cleanTarget(v: unknown): TrajTarget {
  const t = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  switch (t.kind) {
    case 'density':
    case 'transpose':
    case 'velocity':
    case 'legato':
    case 'tempo':
    case 'batonX':
    case 'batonY':
    case 'mutation':
      return { kind: t.kind };
    case 'position':
      return POS_VARS.includes(t.variable as VariableName) ? { kind: 'position', variable: t.variable as VariableName } : { kind: 'none' };
    case 'cc': {
      const ch = Number(t.channel);
      const cc = Number(t.cc);
      return { kind: 'cc', channel: Number.isInteger(ch) && ch >= 1 && ch <= 16 ? ch : 1, cc: Number.isInteger(cc) && cc >= 0 && cc <= 127 ? cc : 74 };
    }
  }
  return { kind: 'none' };
}

export function clampTo(info: TargetInfo, x: number): number {
  const v = Math.max(info.min, Math.min(info.max, x));
  return info.kind === 'continuous' ? Math.round(v * 10) / 10 : Math.round(v);
}

/** Ticks per step (M Time Base n / d of a whole note). */
export function stepTicks(t: Trajectory): number {
  return (Math.max(1, t.rateNum) * TICKS_PER_WHOLE) / (t.rateDen || 4);
}

/** The next index and direction. Deterministic given the random stream. */
export function nextIndex(mode: TrajMode, i: number, dir: number, n: number, rng: Rng): { i: number; dir: number } {
  if (n <= 1) return { i: 0, dir: 1 };
  switch (mode) {
    case 'forward':
      return { i: (i + 1) % n, dir: 1 };
    case 'backward':
      return { i: (i - 1 + n) % n, dir: -1 };
    case 'pingpong': {
      let d = dir >= 0 ? 1 : -1;
      let j = i + d;
      if (j >= n || j < 0) {
        d = -d;
        j = i + d;
      }
      return { i: j, dir: d };
    }
    case 'random':
      return { i: rng.int(0, n - 1), dir: 1 };
    case 'walk': {
      if (i <= 0) return { i: 1, dir: 1 };
      if (i >= n - 1) return { i: n - 2, dir: -1 };
      const d = rng.chance(50) ? 1 : -1;
      return { i: i + d, dir: d };
    }
  }
}

/** Where a running Trajectory is (runtime only, never saved). */
export interface TrajState {
  index: number;
  next: number;
  dir: number;
  /** tick the current step started, and when the next one starts */
  start: number;
  end: number;
  /** last value applied, and (for CC) last value sent */
  value: number | null;
  sent: number | null;
  /** a hand moved the target: leave it alone until the next step */
  held: boolean;
  gen: number;
}

export function freshState(): TrajState {
  return { index: 0, next: 0, dir: 1, start: 0, end: 0, value: null, sent: null, held: false, gen: 0 };
}

/** The value at `tick` within the current step (Smooth glides from this value to the next). */
export function valueAt(t: Trajectory, st: TrajState, tick: number): number {
  const info = targetInfo(t.target);
  const a = t.values[st.index] ?? t.values[0] ?? info.min;
  if (!t.smooth || info.kind === 'enumerated') return clampTo(info, a);
  const b = t.values[st.next] ?? a;
  const f = st.end > st.start ? Math.max(0, Math.min(1, (tick - st.start) / (st.end - st.start))) : 0;
  return clampTo(info, a + (b - a) * f);
}

export function trajRng(seed: number, slot: number): Rng {
  return new Rng(seed, 4000 + slot);
}
