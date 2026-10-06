/**
 * Seeded fuzzing of the engine: random compositions and random gestures while playing.
 * Invariants: events in time order, valid MIDI values, no NaN, all notes eventually off,
 * render always terminates.
 */
import { describe, expect, it } from 'vitest';
import { TIME_BASE_DENOMINATORS } from '../src/engine/constants';
import { defaultComposition } from '../src/engine/defaults';
import { MEngine, type EngineEvent } from '../src/engine/engine';
import { newPattern } from '../src/engine/patternOps';
import { Rng } from '../src/engine/rng';
import { sanitizePoints } from '../src/engine/timeDistortion';
import type { Composition, Cycle, VariableName } from '../src/engine/types';

function randomComposition(seed: number): Composition {
  const r = new Rng(seed, 7);
  const c = defaultComposition(seed);
  const pick = <T>(xs: readonly T[]) => xs[r.int(0, xs.length - 1)];
  for (const g of c.patternGroups)
    for (let v = 0; v < 4; v++) {
      const n = r.int(0, 20);
      const steps = Array.from({ length: n }, () => (r.chance(25) ? [] : Array.from({ length: r.int(1, 4) }, () => r.int(20, 110))));
      const p = newPattern(steps, r);
      p.tbNum = r.chance(80) ? 1 : r.int(1, 5);
      p.tbDen = pick(TIME_BASE_DENOMINATORS.filter((d) => d !== 0));
      p.phase = r.int(0, 199);
      p.outputLength = r.int(0, n);
      g.patterns[v] = p;
    }
  const randCycle = (): Cycle => Array.from({ length: r.int(1, 16) }, () => {
    const a = r.int(0, 4);
    const b = r.int(0, 4);
    return { lo: Math.min(a, b), hi: Math.max(a, b) };
  });
  for (let pos = 0; pos < 6; pos++) {
    for (let v = 0; v < 4; v++) {
      c.noteDensity.positions[pos][v] = r.int(0, 100);
      const lo = r.int(1, 127);
      c.velocityRange.positions[pos][v] = { lo, hi: r.int(lo, 127) };
      const o = r.int(0, 100);
      c.noteOrder.positions[pos][v] = { original: o, cyclic: r.int(0, 100 - o) };
      c.transposition.positions[pos][v] = r.int(-36, 36);
      c.accent.positions[pos][v] = randCycle();
      c.legato.positions[pos][v] = randCycle();
      c.rhythm.positions[pos][v] = randCycle();
      c.orchestration.positions[pos][v] = Array.from({ length: r.int(0, 3) }, () => r.int(1, 16));
      c.timeDistortion.positions[pos][v] = {
        points: sanitizePoints(Array.from({ length: r.int(0, 4) }, () => [r.next(), r.next()] as [number, number])),
        count: r.int(1, 8),
        unit: pick([1, 2, 4, 8, 16]),
      };
    }
  }
  c.rhythmValues = c.rhythmValues.map(() => pick([0.25, 0.5, 1, 1.5, 2, 3, 4]));
  c.legatoValues = c.legatoValues.map(() => r.int(1, 400));
  c.voices.forEach((v) => (v.playEnable = r.chance(80)));
  c.options.secondOrderTranspose = r.chance(50);
  return c;
}

const VARS: VariableName[] = ['patternGroup', 'noteDensity', 'velocityRange', 'noteOrder', 'transposition', 'timeDistortion', 'accent', 'legato', 'rhythm', 'orchestration'];

describe('engine fuzz', () => {
  it('300 random compositions keep the invariants', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const c = randomComposition(seed);
      const e = new MEngine(c);
      const r = new Rng(seed, 9);
      e.start();
      const all: EngineEvent[] = [];
      let t = 0;
      for (let k = 0; k < 40; k++) {
        t += r.int(1, 200);
        all.push(...e.render(t));
        // random gestures while playing
        if (r.chance(30)) all.push(...e.selectPosition(VARS[r.int(0, VARS.length - 1)], r.int(0, 5), e.tick));
        if (r.chance(5)) all.push(...e.sync(e.tick));
        if (r.chance(5)) e.keyboardTranspose(r.int(0, 3), r.int(30, 90));
        if (r.chance(3)) e.pause(), e.pause();
      }
      all.push(...e.stop());
      let last = -Infinity;
      const open = new Map<number, boolean>();
      for (const ev of all) {
        expect(Number.isFinite(ev.tick)).toBe(true);
        if (ev.kind !== 'change') {
          // stop()'s offs are stamped with the frontier; everything else is ordered
          expect(ev.tick).toBeGreaterThanOrEqual(last - 1e-9);
          last = Math.max(last, ev.tick);
        }
        if (ev.kind === 'on') {
          expect(ev.pitch).toBeGreaterThanOrEqual(0);
          expect(ev.pitch).toBeLessThanOrEqual(127);
          expect(ev.velocity).toBeGreaterThanOrEqual(1);
          expect(ev.velocity).toBeLessThanOrEqual(127);
          expect(ev.channel).toBeGreaterThanOrEqual(1);
          expect(ev.channel).toBeLessThanOrEqual(16);
          open.set(ev.id, true);
        }
        if (ev.kind === 'off') open.delete(ev.id);
      }
      expect([...open.keys()]).toEqual([]); // every note was turned off
    }
  }, 30_000); // ~4 s locally, ~6 s on GitHub's runners: more than Vitest's 5 s default
});
