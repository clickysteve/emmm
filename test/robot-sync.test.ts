/**
 * EXTENDED Change Sync and the Smart / Genius personalities (docs/CONDUCTORS.md §3a): a Robot's
 * own moves wait for its beat / bar / phrase boundary (one waiting move per Robot, the latest
 * wins, re-checked when it takes effect); Smart phrases; Genius also listens to the others.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '../src/app/session';
import { demoComposition } from '../src/engine/defaults';
import type { Rng } from '../src/engine/rng';
import { cleanRobots, decide, defaultParams, freshMemory, type MusicView, type RobotDef } from '../src/extended/conductors';
import { deserialize, serialize } from '../src/persistence/format';

const BAR = 384;
let sessions: Session[] = [];
afterEach(() => {
  sessions.forEach((s) => s.stop());
  sessions = [];
});

interface Move {
  i: number;
  t: number;
  from: number;
  to: number;
}
/** an Extended session, every Robot off, recording every Robot move */
function mk(seed = 7): { s: Session; moves: Move[] } {
  const s = new Session(demoComposition(seed));
  (s.scheduler as unknown as { wake: () => void }).wake = () => {};
  s.comp.extended.enabled = true;
  s.changed('extended');
  for (let i = 0; i < 4; i++) s.setRobotEnabled(i, false);
  const moves: Move[] = [];
  const c = s.conductor as unknown as { robotMoved: (i: number, from: number, to: number, t: number, ch: string[]) => void };
  const orig = c.robotMoved.bind(c);
  c.robotMoved = (i, from, to, t, ch) => {
    if (from !== to) moves.push({ i, t, from, to });
    orig(i, from, to, t, ch);
  };
  sessions.push(s);
  return { s, moves };
}
function robot(s: Session, i: number, def: Partial<Omit<RobotDef, 'params' | 'enabled'>>, on = true): void {
  expect(s.setRobot(i, def)).toBe(true);
  s.setRobotEnabled(i, on);
}
function run(s: Session, to: number, chunk = 24): void {
  for (let t = s.engine.tick + chunk; ; t += chunk) {
    const tt = Math.min(t, to);
    s.emitNow(s.engine.render(tt));
    if (tt >= to) break;
  }
}
const of = (moves: Move[], i: number) => moves.filter((m) => m.i === i);
const drunkPG = { personality: 'drunk' as const, variables: ['patternGroup' as const], rateNum: 1, rateDen: 4, home: null };

describe('Change Sync', () => {
  it('FREE (the default) moves on the decision grid; BAR waits for the bar line — at most one move a bar', () => {
    const free = mk();
    robot(free.s, 1, drunkPG);
    expect(free.s.comp.extended.robots[1].sync).toBe(0);
    free.s.start();
    run(free.s, 32 * BAR);
    expect(of(free.moves, 1).some((m) => m.t % BAR !== 0)).toBe(true);

    const bar = mk();
    robot(bar.s, 1, { ...drunkPG, sync: 4 });
    bar.s.start();
    run(bar.s, 32 * BAR);
    const ms = of(bar.moves, 1);
    expect(ms.length).toBeGreaterThan(10);
    expect(ms.every((m) => m.t % BAR === 0)).toBe(true);
    expect(new Set(ms.map((m) => m.t)).size).toBe(ms.length);
    // what the Robot holds is what the music plays
    expect(bar.s.comp.patternGroup.active).toBe(bar.s.conductor.mem[1].pos);
  });

  it('BEAT and 4 BARS use their own boundaries, counted from Start', () => {
    const b = mk();
    robot(b.s, 1, { ...drunkPG, rateNum: 1, rateDen: 8, sync: 1 });
    const p = mk();
    robot(p.s, 1, { ...drunkPG, sync: 16 });
    for (const x of [b, p]) x.s.start(), run(x.s, 32 * BAR);
    expect(of(b.moves, 1).length).toBeGreaterThan(10);
    expect(of(b.moves, 1).every((m) => m.t % 96 === 0)).toBe(true);
    expect(of(b.moves, 1).some((m) => m.t % BAR !== 0)).toBe(true);
    expect(of(p.moves, 1).length).toBeGreaterThan(3);
    expect(of(p.moves, 1).every((m) => m.t % (4 * BAR) === 0 && m.t > 0)).toBe(true);
  });

  it('a waiting move is cancelled by switching the Robot off, changing its sync, Stop — never executed later', () => {
    const { s, moves } = mk();
    robot(s, 1, { ...drunkPG, sync: 32 });
    s.start();
    run(s, BAR + 96);
    expect(s.conductor.pending[1]).not.toBeNull();
    s.setRobotEnabled(1, false);
    expect(s.conductor.pending[1]).toBeNull();
    run(s, 10 * BAR);
    expect(of(moves, 1)).toEqual([]);
    s.setRobotEnabled(1, true);
    run(s, 10 * BAR + 288);
    expect(s.conductor.pending[1]).not.toBeNull();
    s.setRobot(1, { sync: 4 });
    expect(s.conductor.pending[1]).toBeNull();
    s.setRobot(1, { sync: 32 });
    run(s, 10 * BAR + 480);
    expect(s.conductor.pending[1]).not.toBeNull();
    s.stop();
    expect(s.conductor.pending).toEqual([null, null, null, null]);
    moves.length = 0;
    s.start();
    run(s, 7 * BAR);
    expect(of(moves, 1)).toEqual([]); // nothing left over from before Stop
  });

  it('the hand is immediate; a waiting move is re-checked against Allowed Groups when it lands', () => {
    const { s, moves } = mk();
    // decides at bar 3, takes effect at bar 4 (no decision in between to replace it)
    robot(s, 1, { ...drunkPG, rateNum: 3, rateDen: 1, sync: 16 });
    s.setRobotParam(1, 'stay', 0);
    s.start();
    run(s, 3 * BAR + 24);
    const pm = s.conductor.pending[1];
    expect(pm).not.toBeNull();
    expect(pm!.at).toBe(4 * BAR);
    s.setRobotGroup(1, pm!.to, false); // forbidden while it waits
    run(s, 4 * BAR + 24);
    // it lands on the nearest allowed Position instead — or, if that is where it already is, stays
    const m = of(moves, 1);
    expect(m.every((x) => x.t === 4 * BAR && x.to !== pm!.to)).toBe(true);
    expect(s.conductor.pending[1]).toBeNull();
    expect(s.comp.extended.robots[1].groups[s.comp.patternGroup.active]).toBe(true);
    // the hand is never quantised
    s.clickPosition('patternGroup', 5);
    expect(s.comp.patternGroup.active).toBe(5);
    s.allowAllGroups(1);
  });

  it('two Robots on one Variable at the same boundary: one change, the lower number wins', () => {
    const { s, moves } = mk();
    robot(s, 1, { ...drunkPG, sync: 4 });
    robot(s, 2, { ...drunkPG, personality: 'chaotic', sync: 4 });
    s.start();
    const seen: number[] = [];
    for (let t = BAR; t <= 24 * BAR; t += BAR) {
      run(s, t);
      seen.push(s.comp.patternGroup.active);
      // after Robot 2 moved at this bar line, the music is where Robot 2 is
      if (moves.some((m) => m.i === 1 && m.t === t)) expect(s.comp.patternGroup.active).toBe(s.conductor.mem[1].pos);
    }
    expect(new Set(seen).size).toBeGreaterThan(1);
  });
});

/** a fixed random stream */
const fixed = (...xs: number[]): Rng => {
  let k = 0;
  return { next: () => xs[k++ % xs.length] } as unknown as Rng;
};
const all6 = Array.from({ length: 6 }, (_, pos) => ({ pos, w: 10 }));
const music = (m: Partial<MusicView>): MusicView => ({ barsHere: 0, onBar: true, everyBar: true, others: 0, busy: 0, sinceOther: Infinity, otherTick: -1, otherPos: null, ...m });

describe('Smart', () => {
  it('holds until its section is played, and waits for a bar line', () => {
    const mem = freshMemory(2);
    const ctx = (m: Partial<MusicView>) => ({ home: 2, target: null, seenTargetMoves: 0, music: music(m) });
    expect(decide('smart', defaultParams(), mem, all6, ctx({ barsHere: 3 }), fixed(0.5))).toBe(2);
    expect(decide('smart', defaultParams(), mem, all6, ctx({ barsHere: 4.5, onBar: false }), fixed(0.5))).toBe(2);
    expect(decide('smart', defaultParams(), mem, all6, ctx({ barsHere: 4 }), fixed(0.5))).not.toBe(2);
  });

  it('alone over 96 bars: phrases of 2+ bars on bar lines, returns to its theme, varies, keeps to Allowed Groups', () => {
    const { s, moves } = mk(11);
    robot(s, 1, { ...drunkPG, personality: 'smart', home: 0 });
    for (const g of [4, 5]) s.setRobotGroup(1, g, false);
    s.start();
    run(s, 96 * BAR);
    const ms = of(moves, 1);
    expect(ms.length).toBeGreaterThan(8);
    expect(ms.length).toBeLessThan(48); // no constant wandering
    expect(ms.every((m) => m.t % BAR === 0 && m.to < 4)).toBe(true);
    const gaps = ms.slice(1).map((m, k) => (m.t - ms[k].t) / BAR);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(2);
    expect(new Set(gaps).size).toBeGreaterThan(1); // not one fixed phrase length
    expect(ms.filter((m) => m.to === 0).length).toBeGreaterThanOrEqual(ms.length / 4); // the theme comes back
    expect(new Set(ms.map((m) => m.to)).size).toBeGreaterThanOrEqual(3);
  });

  it('with 4 BARS sync its moves land on 4-bar boundaries; it is not the same as Drunk at 4 BARS', () => {
    const a = mk(3);
    robot(a.s, 1, { ...drunkPG, personality: 'smart', home: 0, sync: 16 });
    const b = mk(3);
    robot(b.s, 1, { ...drunkPG, sync: 16 });
    for (const x of [a, b]) x.s.start(), run(x.s, 96 * BAR);
    expect(of(a.moves, 1).every((m) => m.t % (4 * BAR) === 0)).toBe(true);
    expect(of(a.moves, 1).length).toBeLessThan(of(b.moves, 1).length);
  });
});

describe('Genius', () => {
  const ctx = (m: Partial<MusicView>) => ({ home: 0, target: null, seenTargetMoves: 0, music: music(m) });
  it('listens: holds while another Robot has just moved; responds a bar later with a different Position', () => {
    const mem = freshMemory(0);
    mem.section = 4;
    expect(decide('genius', defaultParams(), mem, all6, ctx({ barsHere: 5, others: 1, sinceOther: 0, otherTick: 3000, otherPos: 3 }), fixed(0.1))).toBe(0);
    const to = decide('genius', defaultParams(), mem, all6, ctx({ barsHere: 2, others: 1, sinceOther: 1, otherTick: 3000, otherPos: 3 }), fixed(0.1, 0.5, 0.3, 0.9));
    expect(to).not.toBe(0); // answered before its own section was over …
    expect(to).not.toBe(3); // … with something else than the other Robot took
    expect(mem.heard).toBe(3000);
  });

  it('restraint: when the others are busy its sections double', () => {
    const mem = freshMemory(0);
    mem.section = 4;
    expect(decide('genius', defaultParams(), mem, all6, ctx({ barsHere: 5, others: 2, busy: 2, sinceOther: 1.5, otherTick: 10, otherPos: null }), fixed(0.7))).toBe(0);
    mem.heard = 10;
    expect(decide('genius', defaultParams(), mem, all6, ctx({ barsHere: 8, others: 2, busy: 2, sinceOther: 1.5, otherTick: 10, otherPos: null }), fixed(0.7))).not.toBe(0);
  });

  it('alone: phrases on bar lines and builds arcs that return Home', () => {
    const { s, moves } = mk(5);
    robot(s, 1, { ...drunkPG, personality: 'genius', home: 1 });
    s.start();
    run(s, 128 * BAR);
    const ms = of(moves, 1);
    expect(ms.length).toBeGreaterThan(8);
    expect(ms.every((m) => m.t % BAR === 0)).toBe(true);
    expect(ms.filter((m) => m.to === 1).length).toBeGreaterThanOrEqual(3);
    // never straight back where it came from, except Home
    expect(ms.slice(1).every((m, k) => m.to === 1 || m.to !== ms[k].from)).toBe(true);
  });

  it('with others: never changes on the bar another Robot just changed (unless long overdue); no runaway decisions', () => {
    const { s, moves } = mk(9);
    robot(s, 1, { ...drunkPG, variables: ['noteDensity'], rateNum: 2, rateDen: 1 });
    robot(s, 2, { ...drunkPG, personality: 'genius', variables: ['patternGroup'] });
    robot(s, 3, { ...drunkPG, personality: 'genius', variables: ['transposition'] });
    s.setRobotGroup(2, 5, false);
    s.start();
    run(s, 64 * BAR);
    for (const g of [2, 3]) {
      const ms = of(moves, g);
      expect(ms.length).toBeGreaterThan(2);
      // one decision per beat at most: Genius never makes extra decisions in reaction
      expect(s.conductor.mem[g].decisions).toBeLessThanOrEqual(64 * 4 + 2);
      for (const m of ms) {
        const sameBar = moves.some((o) => o.i !== g && o.i < g && o.t === m.t);
        if (sameBar) expect(m.t - (ms[ms.indexOf(m) - 1]?.t ?? 0)).toBeGreaterThanOrEqual(8 * BAR); // only when overdue
      }
    }
    expect(of(moves, 2).every((m) => m.to !== 5)).toBe(true);
  });
});

describe('persistence', () => {
  it('sync and Smart / Genius are saved and come back; old documents get FREE; broken values are repaired', () => {
    const { s } = mk();
    s.setRobot(1, { personality: 'smart', sync: 16 });
    s.setRobot(2, { personality: 'genius', sync: 1 });
    const back = deserialize(serialize(s.comp)).composition;
    expect(back.extended.robots.map((r) => [r.personality, r.sync])).toEqual([
      ['baton', 0],
      ['smart', 16],
      ['genius', 1],
      ['restless', 0],
    ]);
    const old = cleanRobots([{ personality: 'drunk' }, { personality: 'orbit', sync: 5 }, { sync: 'bar' }]);
    expect(old.map((r) => r.sync)).toEqual([0, 0, 0, 0]);
  });
});
