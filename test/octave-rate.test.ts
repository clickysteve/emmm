/**
 * emmm Octave Note Rate: each Voice cycle of each Octave Position holds every step for 1, 2,
 * 3, 4, 8 or 16 note events before advancing. Rate 1 is the Octave that was there before.
 */
import { describe, expect, it } from 'vitest';
import { Session } from '../src/app/session';
import { cyc, defaultComposition, demoComposition } from '../src/engine/defaults';
import { MEngine, type EngineEvent, type NoteOnEvent, type StepEvent } from '../src/engine/engine';
import type { Composition, Step } from '../src/engine/types';
import { deserialize, serialize } from '../src/persistence/format';

/** The four Voices each play C3 on every event, Octave cycle 0 → +1 → 0 → −1 on Position 1. */
function quartet(rates = [1, 1, 1, 1], octave = cyc(2, 3, 2, 1), steps: Step[] = [[60]]): Composition {
  const c = defaultComposition(7);
  c.extended.enabled = true;
  for (let v = 0; v < 4; v++) {
    const p = c.patternGroups[0].patterns[v];
    p.steps = steps.map((s) => [...s]);
    p.scrambled = steps.map((_, i) => i);
    p.outputLength = steps.length;
    c.noteDensity.positions[0][v] = 100;
    c.noteOrder.positions[0][v] = { original: 100, cyclic: 0 };
    c.accent.positions[0][v] = cyc(4);
    c.rhythm.positions[0][v] = cyc(2);
    c.transposition.positions[0][v] = 0;
    c.orchestration.positions[0][v] = [v + 1];
    c.octave.positions[0][v] = structuredClone(octave);
    c.octave.rates[0][v] = rates[v];
  }
  return c;
}
const steps = (evs: EngineEvent[], v = 0) => evs.filter((e): e is StepEvent => e.kind === 'step' && e.voice === v);
/** Octave levels as octaves (−2…+2) of a Voice's first n events */
const octs = (evs: EngineEvent[], v = 0, n = 16) => steps(evs, v).slice(0, n).map((e) => e.levels.octave - 2);
const play = (c: Composition, ticks = 80000) => {
  const e = new MEngine(c);
  e.start();
  return { e, evs: e.render(ticks) };
};
const rep = (n: number, ...xs: number[]) => xs.flatMap((x) => Array(n).fill(x));

describe('Octave Note Rate: playback', () => {
  it('Rate 1 is the Octave as before: one step per event; a document without rates plays identically', () => {
    expect(octs(play(quartet()).evs, 0, 8)).toEqual([0, 1, 0, -1, 0, 1, 0, -1]);
    const c = demoComposition(5);
    c.extended.enabled = true;
    c.octave.positions[0] = [cyc(2, 3, [1, 3]), cyc(4, 0), cyc([0, 4]), cyc(1, 2, 3)];
    const old = JSON.parse(serialize(c));
    delete old.composition.octave.rates;
    const back = deserialize(JSON.stringify(old)).composition;
    expect(back.octave.rates).toEqual(Array(6).fill([1, 1, 1, 1]));
    const sig = (x: Composition) => ons(play(x, 6000).evs).map((n) => `${n.tick}:${n.pitch}:${n.velocity}`).join();
    expect(sig(back)).toBe(sig(c));
  });
  it('Rate 2, 3, 4 and 16 hold each step for that many events, then wrap normally', () => {
    expect(octs(play(quartet([2, 2, 2, 2])).evs, 0, 10)).toEqual([0, 0, 1, 1, 0, 0, -1, -1, 0, 0]);
    expect(octs(play(quartet([3, 3, 3, 3])).evs, 0, 13)).toEqual([...rep(3, 0, 1, 0, -1), 0]);
    expect(octs(play(quartet([4, 4, 4, 4])).evs, 0, 20)).toEqual([...rep(4, 0, 1, 0, -1), ...rep(4, 0)]);
    const r16 = play(quartet([16, 16, 16, 16]), 300000).evs;
    expect(octs(r16, 0, 80)).toEqual([...rep(16, 0, 1, 0, -1), ...rep(16, 0)]);
    // the cycle-restart flag marks the first event of each pass only
    expect(steps(r16).slice(0, 80).flatMap((e, i) => (e.cycleRestart.octave ? [i] : []))).toEqual([0, 64]);
  });
  it('each Voice counts with its own rate', () => {
    const { evs } = play(quartet([1, 4, 8, 2]), 120000);
    expect(octs(evs, 0, 8)).toEqual([0, 1, 0, -1, 0, 1, 0, -1]);
    expect(octs(evs, 1, 16)).toEqual(rep(4, 0, 1, 0, -1));
    expect(octs(evs, 2, 32)).toEqual(rep(8, 0, 1, 0, -1));
    expect(octs(evs, 3, 8)).toEqual(rep(2, 0, 1, 0, -1));
  });
  it('the rate belongs to the Position: each Position plays its own, and choosing another Position uses its rate', () => {
    const c = quartet();
    for (let p = 0; p < 6; p++) c.octave.positions[p] = structuredClone(c.octave.positions[0]);
    c.octave.rates = [[1, 1, 1, 1], [2, 1, 1, 1], [3, 1, 1, 1], [4, 1, 1, 1], [8, 1, 1, 1], [16, 1, 1, 1]];
    for (let p = 0; p < 6; p++) {
      c.octave.active = p;
      const r = c.octave.rates[p][0];
      expect(octs(play(structuredClone(c), 200000).evs, 0, 4 * r)).toEqual(rep(r, 0, 1, 0, -1));
    }
    // during playback: Position 1 (rate 1) → Position 4 (rate 4) after two events
    c.octave.active = 0;
    const { e, evs } = play(c, 0);
    const t = steps(play(structuredClone(c), 80000).evs).map((x) => x.tick);
    evs.push(...e.render(t[1] + 1));
    e.selectPosition('octave', 3, t[1] + 1);
    evs.push(...e.render(80000));
    expect(octs(evs, 0, 12)).toEqual([0, 1, ...rep(4, 0, -1), 0, 0]);
  });
  it('changing a rate during playback restarts that Voice’s count on the step it is on; other Voices go on', () => {
    const c = quartet([4, 4, 4, 4]);
    const t = steps(play(structuredClone(c)).evs).map((x) => x.tick);
    const { e, evs } = play(c, 0);
    evs.push(...e.render(t[1] + 1)); // two events on step 1 so far
    c.octave.rates[0][0] = 2;
    evs.push(...e.render(80000));
    expect(octs(evs, 0, 10)).toEqual([0, 0, /* restarted */ 0, 0, 1, 1, 0, 0, -1, -1]);
    expect(octs(evs, 1, 12)).toEqual(rep(4, 0, 1, 0));
    // and a Sync puts the count back with the cycle
    const d = quartet([4, 4, 4, 4]);
    const p = play(d, 0);
    p.evs.push(...p.e.render(t[5] + 1)); // 0 0 0 0 1 1
    p.e.sync(t[6]);
    p.evs.push(...p.e.render(80000));
    expect(octs(p.evs, 0, 10)).toEqual([0, 0, 0, 0, 1, 1, 0, 0, 0, 0]);
  });
  it('rests count as note events, as they always have for Octave', () => {
    const { evs } = play(quartet([2, 2, 2, 2], cyc(2, 3), [[60], [], [60], [60]]));
    expect(ons(evs).filter((n) => n.channel === 1).slice(0, 3).map((n) => n.pitch)).toEqual([60, 72, 72]);
  });
  it('a ranged step is still drawn on every note: the rate holds the step, not the value', () => {
    // one ranged step: the advance makes no difference, so every rate draws the same values
    const one = (r: number) => octs(play(quartet([r, r, r, r], cyc([0, 4]))).evs, 0, 24);
    expect(new Set(one(1)).size).toBeGreaterThan(2);
    for (const r of [2, 4, 16]) expect(one(r)).toEqual(one(1));
    // a ranged step held for four notes varies within its range; the fixed step after it does not
    const held = octs(play(quartet([4, 4, 4, 4], cyc([1, 3], 2))).evs, 0, 64);
    const ranged = held.filter((_, i) => Math.floor(i / 4) % 2 === 0);
    expect(ranged.every((x) => x >= -1 && x <= 1)).toBe(true);
    expect(new Set(ranged).size).toBeGreaterThan(1);
    expect(held.filter((_, i) => Math.floor(i / 4) % 2 === 1).every((x) => x === 0)).toBe(true);
  });
  it('Classic Mode: Octave stays neutral whatever the rates', () => {
    const c = quartet([4, 2, 8, 16]);
    c.extended.enabled = false;
    expect(octs(play(c).evs, 0, 8)).toEqual(rep(8, 0));
  });
});
const ons = (evs: EngineEvent[]) => evs.filter((x): x is NoteOnEvent => x.kind === 'on');

describe('Octave Note Rate: document', () => {
  const mk = () => {
    const c = demoComposition(77);
    c.extended.enabled = true;
    return new Session(c);
  };
  const grid = () => Array.from({ length: 6 }, (_, p) => Array.from({ length: 4 }, (_, v) => [1, 2, 3, 4, 8, 16][(p + v) % 6]));
  it('defaults to 1 everywhere; save/load keeps all 24 rates; bad or missing values load as 1', () => {
    expect(defaultComposition().octave.rates).toEqual(Array(6).fill([1, 1, 1, 1]));
    const s = mk();
    s.comp.octave.rates = grid();
    expect(deserialize(serialize(s.comp)).composition.octave.rates).toEqual(grid());
    const doc = JSON.parse(serialize(s.comp));
    doc.composition.octave.rates[0] = [5, 'x', 0, null];
    doc.composition.octave.rates[1] = [2];
    delete doc.composition.octave.rates[2];
    const back = deserialize(JSON.stringify(doc)).composition.octave.rates;
    expect(back[0]).toEqual([1, 1, 1, 1]);
    expect(back[1]).toEqual([2, 1, 1, 1]);
    expect(back[2]).toEqual([1, 1, 1, 1]);
    expect(back.slice(3)).toEqual(grid().slice(3));
  });
  it('Undo and Redo a rate change, without moving the playing Position', () => {
    const s = mk();
    s.clickPosition('octave', 2);
    s.history.commit();
    s.comp.octave.rates[4][1] = 8;
    s.changed('octave');
    s.history.commit();
    s.clickPosition('octave', 5);
    s.undo();
    expect(s.comp.octave.rates[4][1]).toBe(1);
    expect(s.comp.octave.active).toBe(5);
    s.redo();
    expect(s.comp.octave.rates[4][1]).toBe(8);
  });
  it('swapping or copying an Octave Position takes its rates along', () => {
    const s = mk();
    s.comp.octave.rates = grid();
    const [r1, r4] = [grid()[1], grid()[4]];
    s.movePosition('octave', 1, 4, false);
    expect([s.comp.octave.rates[1], s.comp.octave.rates[4]]).toEqual([r4, r1]);
    s.movePosition('octave', 4, 0, true);
    expect(s.comp.octave.rates[0]).toEqual(r1);
    s.comp.octave.rates[0][0] = 16;
    expect(s.comp.octave.rates[4][0]).toBe(r1[0]); // a copy, not the same array
    s.movePosition('rhythm', 2, 3, false);
    expect(s.comp.octave.rates[2]).toEqual(grid()[2]);
  });
  it('A/B states keep the rates; a state from before rates recalls them as 1', () => {
    const s = mk();
    s.comp.octave.rates[3] = [2, 4, 8, 16];
    s.abCapture('a');
    s.comp.octave.rates[3] = [1, 1, 3, 1];
    s.abCapture('b');
    s.abRecall('a');
    expect(s.comp.octave.rates[3]).toEqual([2, 4, 8, 16]);
    s.abRecall('b');
    expect(s.comp.octave.rates[3]).toEqual([1, 1, 3, 1]);
    delete (s.comp.extended.ab.a!.octave as { rates?: unknown }).rates;
    s.abRecall('a');
    expect(s.comp.octave.rates).toEqual(Array(6).fill([1, 1, 1, 1]));
  });
  it('Snapshots and Home recall the Position, and with it that Position’s rates', () => {
    const s = mk();
    s.comp.octave.rates[3] = [4, 4, 4, 4];
    s.clickPosition('octave', 3);
    s.captureHome();
    s.blinkEverything();
    s.clickSnapshot(0);
    s.clickPosition('octave', 0);
    s.clickSnapshot(0);
    expect(s.comp.octave.active).toBe(3);
    s.clickPosition('octave', 1);
    s.returnHome(true);
    expect(s.comp.octave.active).toBe(3);
    expect(s.comp.snapshots[0]!.positions).not.toHaveProperty('rates');
    expect(s.comp.octave.rates[3]).toEqual([4, 4, 4, 4]);
  });
  it('Classic Mode keeps the rates (also through save/load and A/B recall) for when it is switched off', () => {
    const s = mk();
    s.comp.octave.rates = grid();
    s.abCapture('a');
    s.comp.extended.enabled = false;
    s.changed('extended');
    const back = new Session(deserialize(serialize(s.comp)).composition);
    expect(back.comp.extended.enabled).toBe(false);
    delete (back.comp.extended.ab.a!.octave as { rates?: unknown }).rates;
    back.abRecall('a');
    expect(back.comp.octave.rates).toEqual(grid());
    back.comp.extended.enabled = true;
    back.changed('extended');
    expect(back.comp.octave.rates).toEqual(grid());
  });
});
