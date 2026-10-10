/**
 * EXTENDED — Home State and Return (see docs/CONDUCTORS.md §4).
 *
 * Home is a captured set of Variable Positions (and the Baton). Return guides the included
 * Variables back along *musical paths*: a Variable whose Positions have a size (Density,
 * Velocity, Note Order, Transposition, Rhythm, Legato, Accent) passes through the eligible
 * Positions whose value lies between where it is and Home, in order of value; categorical
 * Variables (Pattern Group, Time Distortion, Orchestration, Sound Choice) go Home in one step.
 * Pure functions; the Session schedules the steps (app/conductor.ts).
 */
import { NUM_POSITIONS, NUM_SOUND_CHOICES, STEP_ADVANCE, TICKS_PER_WHOLE, TIME_BASE_DENOMINATORS } from '../engine/constants';
import type { Composition, Cycle, VariableName } from '../engine/types';
import { eligible, type Weights } from './conductors';

/** Every Variable, in M's order (Home captures all of them). */
export const HOME_VARS: VariableName[] = ['patternGroup', 'noteDensity', 'velocityRange', 'noteOrder', 'transposition', 'timeDistortion', 'rhythm', 'legato', 'accent', 'orchestration', 'soundChoice'];

export interface HomeState {
  /** captured active Positions; null = no Home */
  positions: Partial<Record<VariableName, number>> | null;
  baton: { x: number; y: number } | null;
  /** which Variables Return moves and distance counts */
  include: Record<VariableName, boolean>;
}

export interface ReturnSettings {
  /** gradual Return length: num / den of a whole note */
  num: number;
  den: number;
  immediate: boolean;
  /** Robot decisions skipped after a Return, at Home */
  rest: number;
}

export function defaultInclude(): Record<VariableName, boolean> {
  return Object.fromEntries(HOME_VARS.map((v) => [v, v !== 'patternGroup' && v !== 'soundChoice'])) as Record<VariableName, boolean>;
}

export function defaultHome(): HomeState {
  return { positions: null, baton: null, include: defaultInclude() };
}

export function defaultReturnSettings(): ReturnSettings {
  return { num: 2, den: 1, immediate: false, rest: 1 };
}

export function positionCount(v: VariableName): number {
  return v === 'soundChoice' ? NUM_SOUND_CHOICES : NUM_POSITIONS;
}

export function activeOf(comp: Composition, v: VariableName): number {
  return (comp[v] as { active: number }).active;
}

export function cleanHome(v: unknown): HomeState {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<HomeState>;
  const inc = defaultInclude();
  const ri = (o.include && typeof o.include === 'object' ? o.include : {}) as Record<string, unknown>;
  for (const k of HOME_VARS) if (typeof ri[k] === 'boolean') inc[k] = ri[k] as boolean;
  let positions: HomeState['positions'] = null;
  if (o.positions && typeof o.positions === 'object') {
    positions = {};
    for (const k of HOME_VARS) {
      const p = (o.positions as Record<string, unknown>)[k];
      if (typeof p === 'number' && Number.isInteger(p) && p >= 0 && p < positionCount(k)) positions[k] = p;
    }
    if (!Object.keys(positions).length) positions = null;
  }
  const b = o.baton as { x?: unknown; y?: unknown } | null | undefined;
  const baton = positions && b && typeof b.x === 'number' && typeof b.y === 'number' ? { x: Math.max(0, Math.min(1, b.x)), y: Math.max(0, Math.min(1, b.y)) } : null;
  return { positions, baton, include: inc };
}

export function cleanReturnSettings(v: unknown): ReturnSettings {
  const d = defaultReturnSettings();
  const o = (v && typeof v === 'object' ? v : {}) as Partial<ReturnSettings>;
  const dens = (TIME_BASE_DENOMINATORS as readonly number[]).filter((x) => x !== STEP_ADVANCE);
  return {
    num: typeof o.num === 'number' && Number.isInteger(o.num) && o.num >= 1 && o.num <= 99 ? o.num : d.num,
    den: dens.includes(o.den as number) ? (o.den as number) : d.den,
    immediate: o.immediate === true,
    rest: typeof o.rest === 'number' && Number.isInteger(o.rest) && o.rest >= 0 && o.rest <= 16 ? o.rest : d.rest,
  };
}

export function returnTicks(r: ReturnSettings): number {
  return (Math.max(1, r.num) * TICKS_PER_WHOLE) / (r.den || 1);
}

/** Capture the current Positions (all eleven Variables) and the Baton as Home. */
export function captureHome(comp: Composition, prev: HomeState): HomeState {
  const positions: Partial<Record<VariableName, number>> = {};
  for (const v of HOME_VARS) positions[v] = activeOf(comp, v);
  return { positions, baton: { ...comp.conducting.baton }, include: { ...prev.include } };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const cycleMean = (cy: Cycle, table?: number[]) => mean(cy.map((s) => (table ? mean([table[s.lo] ?? 0, table[s.hi] ?? 0]) : (s.lo + s.hi) / 2)));

/**
 * The musical size of a Position (mean over the four Voices), or null for categorical
 * Variables whose Positions have no order.
 */
export function positionValue(comp: Composition, v: VariableName, p: number): number | null {
  switch (v) {
    case 'noteDensity':
      return mean(comp.noteDensity.positions[p] ?? []);
    case 'velocityRange':
      return mean((comp.velocityRange.positions[p] ?? []).map((r) => (r.lo + r.hi) / 2));
    case 'noteOrder':
      return mean((comp.noteOrder.positions[p] ?? []).map((o) => o.original + o.cyclic / 2));
    case 'transposition':
      return mean(comp.transposition.positions[p] ?? []);
    case 'rhythm':
      return mean((comp.rhythm.positions[p] ?? []).map((c) => cycleMean(c, comp.rhythmValues)));
    case 'legato':
      return mean((comp.legato.positions[p] ?? []).map((c) => cycleMean(c, comp.legatoValues)));
    case 'accent':
      return mean((comp.accent.positions[p] ?? []).map((c) => cycleMean(c)));
    default:
      return null;
  }
}

/** Is a Position available as a Return stop? Weight 0 excludes intermediate stops (never Home). */
function stopOk(weights: Weights, v: VariableName, p: number): boolean {
  if (v === 'soundChoice') return true;
  return eligible(weights, v, p);
}

/**
 * The Positions a Variable passes through from `from` to `home` (ending with `home`; empty if
 * already there). Ordered by value toward Home; each stop strictly between the two values.
 */
export function returnPath(comp: Composition, weights: Weights, v: VariableName, from: number, home: number): number[] {
  if (from === home) return [];
  const a = positionValue(comp, v, from);
  const b = positionValue(comp, v, home);
  if (a === null || b === null || a === b) return [home];
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const stops: { p: number; d: number }[] = [];
  for (let p = 0; p < positionCount(v); p++) {
    if (p === from || p === home || !stopOk(weights, v, p)) continue;
    const x = positionValue(comp, v, p)!;
    if (x > lo && x < hi) stops.push({ p, d: Math.abs(x - a) });
  }
  // nearest in value to where it is first; equal values once each (by Position number)
  stops.sort((s, t) => s.d - t.d || Math.abs(s.p - from) - Math.abs(t.p - from) || s.p - t.p);
  const seen = new Set<number>();
  const path: number[] = [];
  for (const s of stops) {
    if (seen.has(s.d)) continue;
    seen.add(s.d);
    path.push(s.p);
  }
  path.push(home);
  return path;
}

/** The included Variables that have a Home. */
export function homeVars(home: HomeState): VariableName[] {
  if (!home.positions) return [];
  return HOME_VARS.filter((v) => home.include[v] && home.positions![v] !== undefined);
}

/** Return steps still needed (0 = at Home). Per Variable and total. */
export function homeDistance(comp: Composition, weights: Weights, home: HomeState): { total: number; away: VariableName[]; per: Partial<Record<VariableName, number>> } {
  const per: Partial<Record<VariableName, number>> = {};
  const away: VariableName[] = [];
  let total = 0;
  for (const v of homeVars(home)) {
    const n = returnPath(comp, weights, v, activeOf(comp, v), home.positions![v]!).length;
    per[v] = n;
    if (n) away.push(v);
    total += n;
  }
  return { total, away, per };
}
