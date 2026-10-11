/**
 * EXTENDED — Robot Conductors: up to four Robots that move Variable Positions, each with its
 * own rate, Variables and personality, choosing among Positions by per-Variable weights.
 * Pure model and algorithms (no Session, no engine); the Session runs them as exact-tick
 * engine actions (app/conductor.ts). See docs/CONDUCTORS.md.
 *
 * A Robot holds one Position (0–5) and applies it to all its Variables, as one Baton cell does
 * for every arrow in M's Conducting Grid. Robot 1 is M's own Robot Conductor: its default
 * personality 'baton' is M's Automatic Conducting in the engine, untouched.
 */
import { NUM_POSITIONS, STEP_ADVANCE, TICKS_PER_WHOLE, TIME_BASE_DENOMINATORS } from '../engine/constants';
import type { Rng } from '../engine/rng';
import type { VariableName } from '../engine/types';

export const NUM_ROBOTS = 4;
export const MAX_WEIGHT = 100;
export const DEFAULT_WEIGHT = 10;

/** The six-Position Variables a Robot may move (Sound Choice has 16 and is not offered). */
export const ROBOT_VARS: VariableName[] = ['patternGroup', 'noteDensity', 'velocityRange', 'noteOrder', 'transposition', 'timeDistortion', 'rhythm', 'legato', 'accent', 'orchestration'];
export type RobotVar = (typeof ROBOT_VARS)[number];

export const VAR_SHORT: Record<VariableName, string> = {
  patternGroup: 'PGrp',
  noteDensity: 'Dens',
  velocityRange: 'Vel',
  noteOrder: 'Ord',
  transposition: 'Trn',
  timeDistortion: 'TDis',
  rhythm: 'Rhy',
  legato: 'Leg',
  accent: 'Acc',
  orchestration: 'Orch',
  soundChoice: 'Snd',
};
export const VAR_LONG: Record<VariableName, string> = {
  patternGroup: 'Pattern Group',
  noteDensity: 'Note Density',
  velocityRange: 'Velocity Range',
  noteOrder: 'Note Order',
  transposition: 'Transposition',
  timeDistortion: 'Time Distortion',
  rhythm: 'Rhythm',
  legato: 'Legato',
  accent: 'Accent',
  orchestration: 'Orchestration',
  soundChoice: 'Sound Choice',
};

export type Personality = 'baton' | 'drunk' | 'tourist' | 'homebody' | 'restless' | 'orbit' | 'pendulum' | 'chaotic' | 'curious' | 'follower' | 'contrarian';

export interface RobotParams {
  /** Drunk / Orbit / Pendulum: Positions per move */
  step: number;
  /** Drunk: % chance of staying */
  stay: number;
  /** Tourist: how many decisions a visit is remembered */
  memory: number;
  /** Homebody: % chance of going Home when away; % chance of leaving when Home; reach */
  pull: number;
  wander: number;
  range: number;
  /** Restless: decisions before a move is certain */
  patience: number;
  /** Orbit: 1 up, -1 down */
  dir: number;
  /** Chaotic: smallest jump */
  minJump: number;
  /** Curious: % chance of exploring */
  explore: number;
  /** Follower: % chance of following; Contrarian 'avoid': smallest distance */
  fidelity: number;
  distance: number;
  /** Follower: copy (same Position) / echo (same move); Contrarian: mirror / avoid */
  mode: 'copy' | 'echo' | 'mirror' | 'avoid';
}

export interface RobotDef {
  /** Robots 2–4. Robot 1's on / off is M's robot button (conducting.robot.enabled). */
  enabled: boolean;
  personality: Personality;
  variables: RobotVar[];
  /** one decision every rateNum / rateDen of a whole note; rateDen 0 = sa (Rules only) */
  rateNum: number;
  rateDen: number;
  /** its own Home Position, or null (then Home of its first Variable, if captured) */
  home: number | null;
  /** Follower / Contrarian: the Robot it watches (0–3), or null */
  target: number | null;
  params: RobotParams;
}

export interface PersonalityInfo {
  id: Personality;
  name: string;
  help: string;
  /** which parameters it uses (for the editor), in order */
  params: (keyof RobotParams)[];
  /** whether weight sizes (not only eligibility) shape its choices */
  weighted: boolean;
}

export const PERSONALITIES: PersonalityInfo[] = [
  { id: 'baton', name: 'Baton (M)', help: 'M’s own Robot Conductor: the Baton jumps at random within the jump ranges; the Variables with arrows on follow it. Set its jump and rate in the Conducting window.', params: [], weighted: false },
  { id: 'drunk', name: 'Drunk', help: 'A random walk that prefers nearby Positions (closer = likelier), sometimes staying put.', params: ['step', 'stay'], weighted: true },
  { id: 'tourist', name: 'Tourist', help: 'Prefers Positions it has not visited recently; when it has seen everything, the one it saw longest ago.', params: ['memory'], weighted: true },
  { id: 'homebody', name: 'Homebody', help: 'Strongly drawn to its Home Position: wanders off now and then, and goes back.', params: ['pull', 'wander', 'range'], weighted: true },
  { id: 'restless', name: 'Restless', help: 'The longer it stays, the likelier it moves — certain after “patience” stays.', params: ['patience'], weighted: true },
  { id: 'orbit', name: 'Orbit', help: 'Steps through the eligible Positions in order, wrapping round. Weights only decide which are eligible.', params: ['step', 'dir'], weighted: false },
  { id: 'pendulum', name: 'Pendulum', help: 'Swings back and forth through the eligible Positions (ends not repeated).', params: ['step'], weighted: false },
  { id: 'chaotic', name: 'Chaotic', help: 'Big unpredictable jumps: never closer than “min jump”, larger jumps likelier.', params: ['minJump'], weighted: true },
  { id: 'curious', name: 'Curious', help: 'Mostly returns to familiar Positions; sometimes explores the least-visited ones.', params: ['explore'], weighted: true },
  { id: 'follower', name: 'Follower', help: 'Follows another Robot: goes where it is (copy) or repeats its moves (echo). Holds while that Robot is off or has not moved.', params: ['mode', 'fidelity'], weighted: false },
  { id: 'contrarian', name: 'Contrarian', help: 'Moves away from another Robot: the mirror Position, or anywhere at least “distance” away.', params: ['mode', 'distance'], weighted: true },
];
export const PERSONALITY_IDS = new Set(PERSONALITIES.map((p) => p.id));
export function personalityInfo(p: Personality): PersonalityInfo {
  return PERSONALITIES.find((x) => x.id === p) ?? PERSONALITIES[1];
}

export const PARAM_INFO: Record<keyof RobotParams, { label: string; min: number; max: number; help: string }> = {
  step: { label: 'step', min: 1, max: 5, help: 'Positions per move' },
  stay: { label: 'stay %', min: 0, max: 90, help: 'chance of staying where it is' },
  memory: { label: 'memory', min: 1, max: 12, help: 'decisions a visited Position counts as recent' },
  pull: { label: 'pull %', min: 0, max: 100, help: 'chance of going Home when away' },
  wander: { label: 'wander %', min: 0, max: 100, help: 'chance of leaving Home' },
  range: { label: 'range', min: 1, max: 5, help: 'how far it wanders from Home' },
  patience: { label: 'patience', min: 1, max: 16, help: 'stays before a move is certain' },
  dir: { label: 'dir', min: -1, max: 1, help: 'up or down' },
  minJump: { label: 'min jump', min: 1, max: 5, help: 'smallest jump' },
  explore: { label: 'explore %', min: 0, max: 100, help: 'chance of choosing a least-visited Position' },
  fidelity: { label: 'follow %', min: 0, max: 100, help: 'chance of following at each decision' },
  distance: { label: 'distance', min: 1, max: 5, help: 'how far from the other Robot (avoid)' },
  mode: { label: 'mode', min: 0, max: 0, help: 'how it relates to the other Robot' },
};

export function defaultParams(): RobotParams {
  return { step: 1, stay: 20, memory: 4, pull: 70, wander: 35, range: 2, patience: 4, dir: 1, minJump: 3, explore: 25, fidelity: 100, distance: 2, mode: 'copy' };
}

export function defaultRobot(i: number): RobotDef {
  const presets: Pick<RobotDef, 'personality' | 'variables' | 'rateNum' | 'rateDen'>[] = [
    { personality: 'baton', variables: ['noteDensity', 'noteOrder'], rateNum: 1, rateDen: 1 },
    { personality: 'drunk', variables: ['velocityRange', 'legato'], rateNum: 2, rateDen: 1 },
    { personality: 'orbit', variables: ['transposition'], rateNum: 16, rateDen: 1 },
    { personality: 'restless', variables: ['rhythm'], rateNum: 1, rateDen: 1 },
  ];
  return { enabled: false, home: null, target: null, params: defaultParams(), ...structuredClone(presets[i] ?? presets[1]) };
}

export function defaultRobots(): RobotDef[] {
  return Array.from({ length: NUM_ROBOTS }, (_, i) => defaultRobot(i));
}

export type Weights = Record<RobotVar, number[]>;
export function defaultWeights(): Weights {
  return Object.fromEntries(ROBOT_VARS.map((v) => [v, Array.from({ length: NUM_POSITIONS }, () => DEFAULT_WEIGHT)])) as Weights;
}

// ---------------------------------------------------------------------------- validation

const int = (x: unknown, lo: number, hi: number, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d);

/** Weights for one Variable: six integers 0–100, at least one above 0. */
export function cleanWeightRow(v: unknown): number[] {
  const row = Array.from({ length: NUM_POSITIONS }, (_, i) => int(Array.isArray(v) ? v[i] : undefined, 0, MAX_WEIGHT, DEFAULT_WEIGHT));
  return row.some((w) => w > 0) ? row : row.map(() => DEFAULT_WEIGHT);
}

export function cleanWeights(v: unknown): Weights {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return Object.fromEntries(ROBOT_VARS.map((k) => [k, cleanWeightRow(o[k])])) as Weights;
}

export function cleanParams(v: unknown): RobotParams {
  const d = defaultParams();
  const o = (v && typeof v === 'object' ? v : {}) as Partial<RobotParams>;
  const out = { ...d } as unknown as Record<string, unknown>;
  for (const [k, info] of Object.entries(PARAM_INFO)) {
    if (k === 'mode') continue;
    out[k] = int((o as Record<string, unknown>)[k], info.min, info.max, (d as unknown as Record<string, number>)[k]);
  }
  if (out.dir === 0) out.dir = 1;
  out.mode = ['copy', 'echo', 'mirror', 'avoid'].includes(o.mode as string) ? o.mode : d.mode;
  return out as unknown as RobotParams;
}

const RATE_DENS = TIME_BASE_DENOMINATORS as readonly number[];

export function cleanRobot(v: unknown, i: number): RobotDef {
  const d = defaultRobot(i);
  const o = (v && typeof v === 'object' ? v : {}) as Partial<RobotDef>;
  let personality = PERSONALITY_IDS.has(o.personality as Personality) ? (o.personality as Personality) : d.personality;
  if (personality === 'baton' && i !== 0) personality = 'drunk';
  const vars = Array.isArray(o.variables) ? o.variables.filter((x, k, a): x is RobotVar => ROBOT_VARS.includes(x as RobotVar) && a.indexOf(x) === k) : d.variables;
  const target = typeof o.target === 'number' && Number.isInteger(o.target) && o.target >= 0 && o.target < NUM_ROBOTS && o.target !== i ? o.target : null;
  return {
    enabled: o.enabled === true,
    personality,
    variables: vars,
    rateNum: int(o.rateNum, 1, 99, d.rateNum),
    rateDen: RATE_DENS.includes(o.rateDen as number) ? (o.rateDen as number) : d.rateDen,
    home: typeof o.home === 'number' && Number.isInteger(o.home) && o.home >= 0 && o.home < NUM_POSITIONS ? o.home : null,
    target,
    params: cleanParams(o.params),
  };
}

/** Does following `target` from robot `i` create a cycle (i ← … ← i)? */
export function createsCycle(robots: Pick<RobotDef, 'personality' | 'target'>[], i: number, target: number | null): boolean {
  let t = target;
  const seen = new Set<number>([i]);
  while (t !== null && t !== undefined) {
    if (seen.has(t)) return true;
    seen.add(t);
    const r = robots[t];
    if (!r || (r.personality !== 'follower' && r.personality !== 'contrarian')) return false;
    t = r.target;
  }
  return false;
}

export function cleanRobots(v: unknown): RobotDef[] {
  const list = Array.isArray(v) ? v : [];
  const robots = Array.from({ length: NUM_ROBOTS }, (_, i) => cleanRobot(list[i], i));
  // break dependency cycles: the later Robot in a cycle loses its target
  for (let i = NUM_ROBOTS - 1; i >= 0; i--) {
    const r = robots[i];
    if ((r.personality === 'follower' || r.personality === 'contrarian') && createsCycle(robots, i, r.target)) r.target = null;
  }
  return robots;
}

// ---------------------------------------------------------------------------- weights

export function weightRow(weights: Weights, v: VariableName): number[] {
  return (weights as Record<string, number[]>)[v] ?? Array.from({ length: NUM_POSITIONS }, () => DEFAULT_WEIGHT);
}

export function eligible(weights: Weights, v: VariableName, p: number): boolean {
  return (weightRow(weights, v)[p] ?? 0) > 0;
}

/** The nearest eligible Position of a Variable to `p` (ties → the lower); `p` itself if eligible. */
export function resolvePosition(weights: Weights, v: VariableName, p: number): number {
  const row = weightRow(weights, v);
  if (row[p] > 0) return p;
  for (let d = 1; d < NUM_POSITIONS; d++) {
    if (p - d >= 0 && row[p - d] > 0) return p - d;
    if (p + d < NUM_POSITIONS && row[p + d] > 0) return p + d;
  }
  return p;
}

export interface Candidate {
  pos: number;
  w: number;
}

/**
 * The Positions a Robot over `vars` may choose, with weights. Eligible for every Variable →
 * geometric mean of the normalised weights; none → the union with the arithmetic mean
 * (each Variable then resolves to its nearest eligible Position). No Variables → all six, equal.
 */
export function candidates(weights: Weights, vars: readonly VariableName[]): Candidate[] {
  if (!vars.length) return Array.from({ length: NUM_POSITIONS }, (_, pos) => ({ pos, w: 1 }));
  const rows = vars.map((v) => {
    const r = weightRow(weights, v);
    const sum = r.reduce((a, b) => a + b, 0) || 1;
    return r.map((w) => w / sum);
  });
  const all: Candidate[] = [];
  for (let pos = 0; pos < NUM_POSITIONS; pos++) {
    if (rows.every((r) => r[pos] > 0)) all.push({ pos, w: Math.pow(rows.reduce((a, r) => a * r[pos], 1), 1 / rows.length) });
  }
  if (all.length) return all;
  for (let pos = 0; pos < NUM_POSITIONS; pos++) {
    const w = rows.reduce((a, r) => a + r[pos], 0) / rows.length;
    if (w > 0) all.push({ pos, w });
  }
  return all;
}

/** One draw: a weighted choice (all weights 0 → uniform). Always consumes exactly one draw. */
export function weightedPick(items: Candidate[], rng: Rng): number | null {
  const r = rng.next();
  if (!items.length) return null;
  const total = items.reduce((a, c) => a + Math.max(0, c.w), 0);
  if (total <= 0) return items[Math.min(items.length - 1, Math.floor(r * items.length))].pos;
  let x = r * total;
  for (const c of items) {
    x -= Math.max(0, c.w);
    if (x < 0) return c.pos;
  }
  return items[items.length - 1].pos;
}

// ---------------------------------------------------------------------------- personalities

/** What a Robot remembers while playing (runtime, never saved). */
export interface RobotMemory {
  pos: number;
  /** decisions made since Start */
  decisions: number;
  /** decisions it has stayed at `pos` */
  dwell: number;
  visits: number[];
  /** decision index of the last visit to each Position (-1 = never) */
  lastVisit: number[];
  /** Pendulum direction */
  dir: number;
  /** last move (new - old), 0 if it stayed */
  lastDelta: number;
  /** moves made (Position changes) since Start */
  moves: number;
  /** where it was at Start (Homebody without a Home) */
  startPos: number;
}

export function freshMemory(pos: number): RobotMemory {
  const visits = Array.from({ length: NUM_POSITIONS }, () => 0);
  const lastVisit = Array.from({ length: NUM_POSITIONS }, () => -1);
  visits[pos] = 1;
  lastVisit[pos] = 0;
  return { pos, decisions: 0, dwell: 0, visits, lastVisit, dir: 1, lastDelta: 0, moves: 0, startPos: pos };
}

/** The Robot a Follower / Contrarian watches, as it decides. */
export interface TargetView {
  pos: number;
  lastDelta: number;
  /** its moves count, to tell whether it moved since this Robot last looked */
  moves: number;
}

export interface DecideContext {
  /** the Robot's Home Position (resolved), or null */
  home: number | null;
  /** null = no usable target (off, never moved, none set) */
  target: TargetView | null;
  /** the target's move count when this Robot last decided */
  seenTargetMoves: number;
}

function nearest(cands: Candidate[], p: number, exclude = -1): number | null {
  let best: number | null = null;
  let bd = Infinity;
  for (const c of cands) {
    if (c.pos === exclude) continue;
    const d = Math.abs(c.pos - p);
    if (d < bd) (bd = d), (best = c.pos);
  }
  return best;
}

function farthest(cands: Candidate[], p: number): Candidate[] {
  let bd = -1;
  for (const c of cands) if (c.pos !== p) bd = Math.max(bd, Math.abs(c.pos - p));
  return cands.filter((c) => c.pos !== p && Math.abs(c.pos - p) === bd);
}

/**
 * One decision: the Robot's next Position (may be the same). Never loops over draws; every
 * branch is O(6). `cands` must be sorted by Position. Returns `mem.pos` when nothing is
 * eligible.
 */
export function decide(p: Personality, prm: RobotParams, mem: RobotMemory, cands: Candidate[], ctx: DecideContext, rng: Rng): number {
  const c = mem.pos;
  if (!cands.length) return c;
  if (cands.length === 1) return cands[0].pos;
  const others = cands.filter((x) => x.pos !== c);
  switch (p) {
    case 'baton':
      return c; // M's Baton robot runs in the engine
    case 'drunk': {
      const u = rng.next();
      if (u * 100 < prm.stay && cands.some((x) => x.pos === c)) {
        rng.next();
        return c;
      }
      const near = others.filter((x) => Math.abs(x.pos - c) <= prm.step).map((x) => ({ pos: x.pos, w: x.w * Math.pow(2, -(Math.abs(x.pos - c) - 1)) }));
      const pick = weightedPick(near, rng);
      return pick ?? nearest(cands, c, c) ?? c;
    }
    case 'tourist': {
      const recent = (pos: number) => pos === c || (mem.lastVisit[pos] >= 0 && mem.decisions - mem.lastVisit[pos] < prm.memory);
      const fresh = others.filter((x) => !recent(x.pos));
      if (fresh.length) return weightedPick(fresh, rng) ?? c;
      // everything is recent: the one seen longest ago (ties → weighted)
      const oldest = Math.min(...others.map((x) => mem.lastVisit[x.pos]));
      return weightedPick(others.filter((x) => mem.lastVisit[x.pos] === oldest), rng) ?? c;
    }
    case 'homebody': {
      const home = nearest(cands, ctx.home ?? mem.startPos) ?? c;
      const u = rng.next();
      if (c === home) {
        if (u * 100 >= prm.wander) {
          rng.next();
          return c;
        }
        const out = others.filter((x) => Math.abs(x.pos - home) <= prm.range);
        return weightedPick(out, rng) ?? nearest(cands, c, c) ?? c;
      }
      if (u * 100 < prm.pull) {
        rng.next();
        return home;
      }
      return weightedPick(cands.filter((x) => Math.abs(x.pos - c) <= 1), rng) ?? c;
    }
    case 'restless': {
      const pMove = Math.min(1, (mem.dwell + 1) / Math.max(1, prm.patience));
      const u = rng.next();
      if (u >= pMove && cands.some((x) => x.pos === c)) {
        rng.next();
        return c;
      }
      return weightedPick(others, rng) ?? c;
    }
    case 'orbit': {
      const E = cands.map((x) => x.pos);
      const n = E.length;
      const dir = prm.dir < 0 ? -1 : 1;
      let i = E.indexOf(c);
      if (i < 0) {
        // not eligible here: the next eligible one in the direction of travel
        i = dir > 0 ? E.findIndex((x) => x > c) : E.length - 1 - [...E].reverse().findIndex((x) => x < c);
        if (i < 0 || i >= n) i = dir > 0 ? 0 : n - 1;
        return E[i];
      }
      return E[(((i + dir * prm.step) % n) + n) % n];
    }
    case 'pendulum': {
      const E = cands.map((x) => x.pos);
      const n = E.length;
      let i = E.indexOf(c);
      if (i < 0) i = E.indexOf(nearest(cands, c) ?? E[0]);
      const span = n - 1;
      // a step past an end stops at the end (and turns), so the ends are always reached
      if (i >= span) mem.dir = -1;
      else if (i <= 0) mem.dir = 1;
      const j = Math.max(0, Math.min(span, i + (mem.dir >= 0 ? 1 : -1) * prm.step));
      if (j === span) mem.dir = -1;
      if (j === 0) mem.dir = 1;
      return E[Math.max(0, Math.min(span, j))];
    }
    case 'chaotic': {
      const far = others.filter((x) => Math.abs(x.pos - c) >= prm.minJump).map((x) => ({ pos: x.pos, w: x.w * Math.abs(x.pos - c) }));
      if (far.length) return weightedPick(far, rng) ?? c;
      return weightedPick(farthest(cands, c), rng) ?? c;
    }
    case 'curious': {
      const u = rng.next();
      if (u * 100 < prm.explore && others.length) {
        const least = Math.min(...others.map((x) => mem.visits[x.pos]));
        return weightedPick(others.filter((x) => mem.visits[x.pos] === least), rng) ?? c;
      }
      return weightedPick(cands.map((x) => ({ pos: x.pos, w: x.w * (1 + mem.visits[x.pos]) })), rng) ?? c;
    }
    case 'follower': {
      const t = ctx.target;
      if (!t) return c;
      const u = rng.next();
      if (u * 100 >= prm.fidelity) return c;
      if (prm.mode === 'echo') {
        if (t.moves === ctx.seenTargetMoves || !t.lastDelta) return c;
        return nearest(cands, Math.max(0, Math.min(NUM_POSITIONS - 1, c + t.lastDelta))) ?? c;
      }
      return nearest(cands, t.pos) ?? c;
    }
    case 'contrarian': {
      const t = ctx.target;
      if (!t) return c;
      if (prm.mode === 'mirror') return nearest(cands, NUM_POSITIONS - 1 - t.pos) ?? c;
      const away = cands.filter((x) => Math.abs(x.pos - t.pos) >= prm.distance).map((x) => ({ pos: x.pos, w: x.w * Math.abs(x.pos - t.pos) }));
      if (away.length) return weightedPick(away, rng) ?? c;
      return weightedPick(farthest(cands, t.pos), rng) ?? c;
    }
  }
}

/** A forced new Position (Rule "choose"): a weighted different eligible Position. */
export function chooseOther(mem: RobotMemory, cands: Candidate[], rng: Rng): number {
  const others = cands.filter((x) => x.pos !== mem.pos);
  return weightedPick(others, rng) ?? (cands[0]?.pos ?? mem.pos);
}

/** Record a decision's result in the Robot's memory. */
export function remember(mem: RobotMemory, next: number): void {
  mem.decisions++;
  const moved = next !== mem.pos;
  mem.lastDelta = next - mem.pos;
  if (moved) {
    mem.moves++;
    mem.dwell = 0;
  } else mem.dwell++;
  mem.pos = next;
  mem.visits[next]++;
  mem.lastVisit[next] = mem.decisions;
}

/** Ticks per decision (Time Base n / d of a whole note); Infinity = sa (Rules only). */
export function robotStepTicks(d: Pick<RobotDef, 'rateNum' | 'rateDen'>): number {
  if (d.rateDen === STEP_ADVANCE) return Infinity;
  return (Math.max(1, d.rateNum) * TICKS_PER_WHOLE) / d.rateDen;
}

export function rateLabel(d: Pick<RobotDef, 'rateNum' | 'rateDen'>): string {
  return d.rateDen === STEP_ADVANCE ? 'sa' : `${d.rateNum}|${d.rateDen}`;
}

/** A rate in words: "every 2 bars", "every beat" (4/4 bars of quarter notes). */
export function rateWords(d: Pick<RobotDef, 'rateNum' | 'rateDen'>): string {
  const t = robotStepTicks(d);
  if (!Number.isFinite(t)) return 'only when a Rule advances it';
  const beats = t / 96;
  if (beats % 4 === 0) return beats === 4 ? 'every bar' : `every ${beats / 4} bars`;
  if (Number.isInteger(beats)) return beats === 1 ? 'every beat' : `every ${beats} beats`;
  return `every ${Math.round(beats * 100) / 100} beat`;
}
