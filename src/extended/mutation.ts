/**
 * EXTENDED — controlled Mutation.
 *
 * Mutation changes M's *settings* — the values in the active Positions, the cycles, which
 * Positions are active — not the notes M has already generated, and never the Patterns'
 * notes themselves (Material only reshuffles the Cyclic Random order). Strength runs from
 * 0 (subtle: small nudges to a few values) to 100 (chaos: most values move a long way).
 * Locked dimensions and locked Voices are left alone. The random choices come from a
 * stream derived from the document seed and a mutation counter, so the same document and
 * seed mutate the same way.
 */
import { NUM_POSITIONS, NUM_VOICES } from '../engine/constants';
import * as ops from '../engine/patternOps';
import { Rng } from '../engine/rng';
import { sanitizePoints } from '../engine/timeDistortion';
import type { Composition, Cycle, VariableName } from '../engine/types';
import type { Locks, LockDim } from './extended';
import { CHROMATIC, degreesPerOctave } from '../app/scales';

export interface MutationResult {
  /** which dimensions actually changed */
  changed: LockDim[];
  /** Position changes to perform through the Session (so Pattern Group syncs etc. happen) */
  positions: { variable: VariableName; position: number }[];
}

export function mutationRng(seed: number, count: number): Rng {
  return new Rng((seed ^ Math.imul(count + 1, 0x9e3779b1)) >>> 0, 3000);
}

const POSITION_VARS: VariableName[] = ['noteDensity', 'velocityRange', 'noteOrder', 'transposition', 'timeDistortion', 'rhythm', 'legato', 'accent', 'orchestration'];

/**
 * Mutate `comp` in place. `amount` is 0..100. Values are changed in the *active* Position
 * of each Variable (the one being heard). Returns what changed.
 */
export function mutate(comp: Composition, amount: number, locks: Locks, rng: Rng): MutationResult {
  const a = Math.max(0, Math.min(1, amount / 100));
  const changed = new Set<LockDim>();
  const free = (d: LockDim) => !locks.dims[d];
  const voices = Array.from({ length: NUM_VOICES }, (_, v) => v).filter((v) => !locks.voices[v]);
  const touch = () => rng.next() < 0.25 + 0.65 * a; // how many values move
  const gauss = () => (rng.next() + rng.next() + rng.next() - 1.5) / 1.5; // −1..1, centred
  const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

  if (free('noteDensity')) {
    const pos = comp.noteDensity.positions[comp.noteDensity.active];
    for (const v of voices)
      if (touch()) {
        const nv = clamp(Math.round(pos[v] + gauss() * (8 + 60 * a)), 0, 100);
        if (nv !== pos[v]) (pos[v] = nv), changed.add('noteDensity');
      }
  }
  if (free('velocityRange')) {
    const pos = comp.velocityRange.positions[comp.velocityRange.active];
    for (const v of voices)
      if (touch()) {
        const r = pos[v];
        const shift = Math.round(gauss() * (6 + 50 * a));
        const width = Math.round(gauss() * (4 + 40 * a));
        const lo = clamp(r.lo + shift - Math.round(width / 2), 1, 127);
        const hi = clamp(r.hi + shift + Math.round(width / 2), lo, 127);
        if (lo !== r.lo || hi !== r.hi) (r.lo = lo), (r.hi = hi), changed.add('velocityRange');
      }
  }
  if (free('noteOrder')) {
    const pos = comp.noteOrder.positions[comp.noteOrder.active];
    for (const v of voices)
      if (touch()) {
        const o = pos[v];
        const original = clamp(Math.round(o.original + gauss() * (10 + 70 * a)), 0, 100);
        const cyclic = clamp(Math.round(o.cyclic + gauss() * (10 + 70 * a)), 0, 100 - original);
        if (original !== o.original || cyclic !== o.cyclic) (o.original = original), (o.cyclic = cyclic), changed.add('noteOrder');
      }
  }
  if (free('transposition')) {
    const pos = comp.transposition.positions[comp.transposition.active];
    // subtle: neighbouring scale-ish steps; chaos: anything within an octave and a half
    const small = [-2, -1, 1, 2];
    const mid = [-7, -5, -3, 3, 5, 7];
    const big = [-12, -10, -9, 9, 10, 12, -19, 19];
    for (const v of voices)
      if (rng.next() < 0.15 + 0.55 * a) {
        const pool = a < 0.34 ? small : a < 0.67 ? [...small, ...mid] : [...small, ...mid, ...big];
        let step = pool[rng.int(0, pool.length - 1)];
        let lim = 36;
        if (comp.scaleLock) {
          // emmm Scale Lock: the values are scale degrees — the same musical moves (a step, a
          // 4th or 5th, an octave…) counted in this Voice's scale; the random draws are as
          // without Scale Lock, so a seed mutates the same way in both
          const n = degreesPerOctave(comp.patternGroups[comp.patternGroup.active].patterns[v].scale ?? CHROMATIC);
          if (Math.abs(step) > 2) step = Math.sign(step) * Math.max(1, Math.round((Math.abs(step) * n) / 12));
          lim = 3 * n;
        }
        const nv = clamp(pos[v] + step, -lim, lim);
        if (nv !== pos[v]) (pos[v] = nv), changed.add('transposition');
      }
  }
  if (free('timeDistortion')) {
    const pos = comp.timeDistortion.positions[comp.timeDistortion.active];
    for (const v of voices)
      if (rng.next() < 0.1 + 0.6 * a) {
        const m = pos[v];
        let pts = m.points.map(([x, y]) => [clamp(x + gauss() * 0.12 * a, 0.02, 0.98), clamp(y + gauss() * 0.12 * a, 0.02, 0.98)] as [number, number]);
        if (a > 0.5 && rng.next() < a - 0.4) pts.push([rng.next(), rng.next()]);
        pts = sanitizePoints(pts);
        if (JSON.stringify(pts) !== JSON.stringify(m.points)) (m.points = pts), changed.add('timeDistortion');
      }
  }
  for (const k of ['rhythm', 'legato', 'accent'] as const) {
    if (!free(k)) continue;
    const pos = comp[k].positions[comp[k].active];
    for (const v of voices) {
      const before = JSON.stringify(pos[v]);
      pos[v] = mutateCycle(pos[v], a, rng, k === 'accent');
      if (JSON.stringify(pos[v]) !== before) changed.add(k);
    }
  }
  if (free('orchestration') && a > 0.3) {
    // only re-uses channels the document already plays on, so nothing new is addressed
    const used = [...new Set(comp.orchestration.positions.flat(2))].sort((x, y) => x - y);
    const pos = comp.orchestration.positions[comp.orchestration.active];
    if (used.length > 1)
      for (const v of voices)
        if (rng.next() < (a - 0.3) * 0.6) {
          const ch = used[rng.int(0, used.length - 1)];
          const set = new Set(pos[v]);
          if (set.has(ch) && set.size > 1) set.delete(ch);
          else set.add(ch);
          pos[v] = [...set].sort((x, y) => x - y);
          changed.add('orchestration');
        }
  }
  if (free('material')) {
    const g = comp.patternGroups[comp.patternGroup.active];
    for (const v of voices)
      if (g.patterns[v].steps.length > 1 && rng.next() < 0.1 + 0.5 * a) {
        ops.rescramble(g.patterns[v], rng, comp.options.dontScrambleRests);
        changed.add('material');
      }
  }
  const positions: MutationResult['positions'] = [];
  if (free('positions')) {
    for (const variable of POSITION_VARS) {
      if (!free(variable as LockDim)) continue;
      if (rng.next() < 0.1 + 0.4 * a) {
        const cur = (comp[variable] as { active: number }).active;
        const to = (cur + rng.int(1, NUM_POSITIONS - 1)) % NUM_POSITIONS;
        positions.push({ variable, position: to });
        changed.add('positions');
      }
    }
  }
  if (free('patternGroup') && free('positions') && rng.next() < 0.6 * a) {
    const withNotes = comp.patternGroups.map((g, i) => (g.patterns.some((p) => p.steps.some((s) => s.length)) ? i : -1)).filter((i) => i >= 0 && i !== comp.patternGroup.active);
    if (withNotes.length) {
      positions.push({ variable: 'patternGroup', position: withNotes[rng.int(0, withNotes.length - 1)] });
      changed.add('patternGroup');
    }
  }
  return { changed: [...changed], positions };
}

/** Nudge a cyclic distribution: levels move, ranges widen or narrow, the length may change. */
export function mutateCycle(cycle: Cycle, a: number, rng: Rng, isAccent: boolean): Cycle {
  const c = cycle.map((s) => ({ ...s }));
  const lvl = (x: number) => Math.max(isAccent ? 0 : 0, Math.min(4, x));
  for (const s of c) {
    if (rng.next() >= 0.12 + 0.6 * a) continue;
    const d = rng.chance(50) ? 1 : -1;
    const jump = a > 0.7 && rng.next() < a - 0.5 ? 2 : 1;
    if (rng.next() < 0.25 + 0.4 * a) {
      // widen or narrow the range
      if (rng.chance(50)) s.hi = lvl(s.hi + d * jump);
      else s.lo = lvl(s.lo + d * jump);
    } else {
      s.lo = lvl(s.lo + d * jump);
      s.hi = lvl(s.hi + d * jump);
    }
    if (s.lo > s.hi) [s.lo, s.hi] = [s.hi, s.lo];
    // an accent cycle that would only ever rest is not useful
  }
  if (isAccent && c.every((s) => s.hi === 0)) c[0] = { lo: 2, hi: 3 };
  if (rng.next() < 0.3 * a) {
    if (rng.chance(50) && c.length < 16) c.push({ ...c[rng.int(0, c.length - 1)] });
    else if (c.length > 1) c.splice(rng.int(0, c.length - 1), 1);
  }
  return c;
}
