/**
 * Conducting (M-BEHAVIOUR §10): mapping the Baton position in the Conducting Grid onto
 * Variable Positions, Tempo, Snapshots and continuous velocity / legato.
 */
import { NUM_POSITIONS, NUM_VOICES } from './constants';
import type { ArrowDir, Composition, ConductTarget, VariableName } from './types';

/** Position of the baton along an arrow's direction, 0..1. Grid y = 0 is the bottom. */
export function along(dir: ArrowDir, x: number, y: number): number {
  switch (dir) {
    case 'right':
      return x;
    case 'left':
      return 1 - x;
    case 'up':
      return y;
    case 'down':
      return 1 - y;
  }
}

/** The six grid units map to Positions 1..6 (index 0..5). */
export function cellIndex(t: number, n = NUM_POSITIONS): number {
  return Math.max(0, Math.min(n - 1, Math.floor(t * n)));
}

/** §10 [INF]: continuous velocity offset −127..+127, centre 0. */
export function continuousVelocityOffset(t: number): number {
  return Math.round((2 * t - 1) * 127);
}
/** §10 [DOC endpoints ×4 / ×¼, INF curve]: geometric so the centre is ×1. */
export function continuousLegatoMultiplier(t: number): number {
  return Math.pow(4, 2 * t - 1);
}

export interface BatonResult {
  positions: { variable: VariableName; position: number }[];
  tempo: number | null;
  snapshot: number | null;
}

const VARIABLE_TARGETS: VariableName[] = [
  'patternGroup',
  'noteDensity',
  'velocityRange',
  'noteOrder',
  'transposition',
  'timeDistortion',
  'accent',
  'legato',
  'rhythm',
  'orchestration',
  'soundChoice',
];

export function activePosition(comp: Composition, v: VariableName): number {
  return (comp[v] as { active: number }).active;
}

/**
 * Compute what the baton at (x,y) asks for. Does not mutate positions (the caller applies
 * them, possibly quantized); it does update the baton and continuous-conducting values.
 * Snapshots are triggered on entering a new cell, or on a fresh click (`fresh`).
 */
export function conductAt(comp: Composition, x: number, y: number, fresh = false): BatonResult {
  const c = comp.conducting;
  const prev = { ...c.baton };
  c.baton = { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  const res: BatonResult = { positions: [], tempo: null, snapshot: null };
  for (const v of VARIABLE_TARGETS) {
    const a = c.arrows[v];
    if (!a.enabled) continue;
    if (v === 'velocityRange' && c.continuousMode.velocityRange) continue;
    if (v === 'legato' && c.continuousMode.legato) continue;
    const n = v === 'soundChoice' ? 16 : NUM_POSITIONS;
    const idx = cellIndex(along(a.dir, c.baton.x, c.baton.y), n);
    if (idx !== activePosition(comp, v)) res.positions.push({ variable: v, position: idx });
  }
  const ta = c.arrows.tempo;
  if (ta.enabled) {
    const t = along(ta.dir, c.baton.x, c.baton.y);
    res.tempo = Math.round(comp.tempo.lo + t * (comp.tempo.hi - comp.tempo.lo));
  }
  const sa = c.arrows.snapshot;
  if (sa.enabled) {
    const idx = cellIndex(along(sa.dir, c.baton.x, c.baton.y));
    const prevIdx = cellIndex(along(sa.dir, prev.x, prev.y));
    if ((idx !== prevIdx || fresh) && comp.snapshots[idx]) res.snapshot = idx;
  }
  // continuous conducting
  if (c.arrows.velocityRange.enabled && c.continuousMode.velocityRange) {
    const cc = c.continuousVelocity;
    for (let v = 0; v < NUM_VOICES; v++)
      cc.values[v] = cc.voices[v] ? continuousVelocityOffset(along(cc.dirs[v], c.baton.x, c.baton.y)) : null;
  }
  if (c.arrows.legato.enabled && c.continuousMode.legato) {
    const cc = c.continuousLegato;
    for (let v = 0; v < NUM_VOICES; v++)
      cc.values[v] = cc.voices[v] ? continuousLegatoMultiplier(along(cc.dirs[v], c.baton.x, c.baton.y)) : null;
  }
  return res;
}

/** Option-click in the grid / manual Position choice: cancel continuous conducting. */
export function clearContinuous(comp: Composition, which?: 'velocity' | 'legato'): void {
  const c = comp.conducting;
  if (!which || which === 'velocity') c.continuousVelocity.values = c.continuousVelocity.values.map(() => null);
  if (!which || which === 'legato') c.continuousLegato.values = c.continuousLegato.values.map(() => null);
}

export const ARROW_ORDER: ArrowDir[] = ['right', 'down', 'left', 'up'];
export function rotateArrow(dir: ArrowDir): ArrowDir {
  return ARROW_ORDER[(ARROW_ORDER.indexOf(dir) + 1) % 4];
}
export function arrowFromAngle(dx: number, dy: number): ArrowDir {
  // screen coordinates: dy positive = down
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

export type { ConductTarget };
