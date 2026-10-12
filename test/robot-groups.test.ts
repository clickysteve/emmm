/**
 * EXTENDED Allowed Groups (docs/CONDUCTORS.md §3): each Robot may be restricted to some
 * Pattern Groups. Every automatic pathway by which a Robot chooses a Pattern Group — its own
 * decisions (every personality), Rule "advance" / "choose", Follower / Contrarian, and Robot 1's
 * Baton (M) jump (also when the Baton lands on a Snapshot) — keeps to its set; a hand, a Rule
 * "set Position" and Snapshots you recall do not. Old documents allow every Group.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '../src/app/session';
import { demoComposition } from '../src/engine/defaults';
import type { EngineEvent } from '../src/engine/engine';
import type { Composition } from '../src/engine/types';
import { allGroups, cleanGroups, cleanRobots, cleanWeights, nearestGroup, PERSONALITIES, robotWeights, type RobotDef } from '../src/extended/conductors';
import { deserialize, serialize } from '../src/persistence/format';

let sessions: Session[] = [];
afterEach(() => {
  sessions.forEach((s) => s.stop());
  sessions = [];
});

function mk(seed = 7, comp?: Composition): Session {
  const s = new Session(comp ?? demoComposition(seed));
  (s.scheduler as unknown as { wake: () => void }).wake = () => {};
  s.comp.extended.enabled = true;
  s.changed('extended');
  sessions.push(s);
  return s;
}
function robot(s: Session, i: number, def: Partial<Omit<RobotDef, 'params' | 'enabled'>>, on = true): void {
  expect(s.setRobot(i, def)).toBe(true);
  s.setRobotEnabled(i, on);
}
/** allow exactly these Groups (0 = a) for Robot i, through the Session as the window does */
function allow(s: Session, i: number, gs: number[]): void {
  for (let g = 0; g < 6; g++) if (gs.includes(g)) s.setRobotGroup(i, g, true);
  for (let g = 0; g < 6; g++) if (!gs.includes(g)) s.setRobotGroup(i, g, false);
  expect(s.comp.extended.robots[i].groups).toEqual(allGroups().map((_, g) => gs.includes(g)));
}
function run(s: Session, to: number, chunk = 24): EngineEvent[] {
  const all: EngineEvent[] = [];
  for (let t = s.engine.tick + chunk; ; t += chunk) {
    const tt = Math.min(t, to);
    const evs = s.engine.render(tt);
    all.push(...evs);
    s.emitNow(evs);
    if (tt >= to) break;
  }
  return all;
}
const pg = (s: Session) => s.comp.patternGroup.active;
/** every Pattern Group the music was put in, render step by render step */
function groupsVisited(s: Session, to: number, chunk: number): number[] {
  const seen: number[] = [];
  for (let t = s.engine.tick + chunk; t <= to; t += chunk) {
    run(s, t, chunk);
    seen.push(pg(s));
  }
  return seen;
}
/** every Pattern Group change the engine makes, with its tick */
function spyGroups(s: Session): { tick: number; pos: number }[] {
  const out: { tick: number; pos: number }[] = [];
  const orig = s.engine.selectPosition.bind(s.engine);
  s.engine.selectPosition = ((v, p, t, o) => {
    if (v === 'patternGroup') out.push({ tick: t, pos: p });
    return orig(v, p, t, o);
  }) as typeof s.engine.selectPosition;
  return out;
}

describe('the model', () => {
  it('every Robot allows all six Groups by default; old or broken data recovers safely', () => {
    expect(cleanRobots(undefined).map((r) => r.groups)).toEqual(Array.from({ length: 4 }, () => [true, true, true, true, true, true]));
    expect(cleanGroups(undefined)).toEqual(allGroups());
    expect(cleanGroups('ab')).toEqual(allGroups());
    expect(cleanGroups([true, false])).toEqual([true, false, true, true, true, true]); // short: the rest allowed
    expect(cleanGroups([false, false, false, false, false, false])).toEqual(allGroups()); // none → all
    expect(cleanGroups([false, 'x', null, 0, false, false])).toEqual([false, true, true, true, false, false]); // only false forbids
    expect(cleanGroups([false, true, false, false, false, false, false, false])).toEqual([false, true, false, false, false, false]); // extra ignored
  });
  it('robotWeights: all allowed = the shared weights themselves; otherwise Pattern Group is masked', () => {
    const w = cleanWeights({ patternGroup: [10, 20, 30, 40, 50, 60] });
    expect(robotWeights(w, allGroups())).toBe(w);
    const r = robotWeights(w, [true, false, true, false, false, false]);
    expect(r.patternGroup).toEqual([10, 0, 30, 0, 0, 0]);
    expect(r.noteDensity).toBe(w.noteDensity);
    expect(w.patternGroup).toEqual([10, 20, 30, 40, 50, 60]); // the shared weights are untouched
    // allowed Groups whose weights are all 0: the Allowed Groups win, equally
    const z = cleanWeights({ patternGroup: [0, 0, 0, 10, 10, 10] });
    expect(robotWeights(z, [true, true, false, false, false, false]).patternGroup).toEqual([10, 10, 0, 0, 0, 0]);
  });
  it('nearestGroup: itself if allowed, else the nearest (ties → the lower)', () => {
    const g = [false, true, false, true, false, false];
    expect(nearestGroup(g, 1)).toBe(1);
    expect(nearestGroup(g, 2)).toBe(1);
    expect(nearestGroup(g, 5)).toBe(3);
    expect(nearestGroup(g, 0)).toBe(1);
    expect(nearestGroup(allGroups(), 4)).toBe(4);
  });
});

describe('Robots never choose a Group they are not allowed', () => {
  const personalities = PERSONALITIES.filter((p) => p.id !== 'baton').map((p) => p.id);
  it.each(personalities)('%s: Groups a and b only, over 160 decisions', (p) => {
    const s = mk(11);
    robot(s, 0, { personality: 'drunk', variables: ['patternGroup'], rateNum: 1, rateDen: 16 }); // a target for Follower / Contrarian
    allow(s, 0, [0, 1]);
    robot(s, 1, { personality: p, variables: ['patternGroup'], rateNum: 1, rateDen: 8, target: 0 });
    allow(s, 1, [0, 1]);
    s.start();
    const seen = groupsVisited(s, 384 * 80, 48);
    expect(seen.length).toBe(640);
    expect(new Set(seen).size).toBeGreaterThan(0);
    for (const g of seen) expect([0, 1]).toContain(g);
  });
  it('Groups a and b: both are visited, never c–f (also with another Variable on the same Robot)', () => {
    const s = mk(5);
    robot(s, 1, { personality: 'chaotic', variables: ['patternGroup', 'noteDensity'], rateNum: 1, rateDen: 8 });
    allow(s, 1, [0, 1]);
    const changes = spyGroups(s);
    s.start();
    const seen = groupsVisited(s, 384 * 40, 48);
    expect(new Set(seen)).toEqual(new Set([0, 1]));
    for (const c of changes) expect(c.pos).toBeLessThan(2);
    // Note Density is still moved by the same Robot (the restriction is on Groups only)
    expect(s.conductor.log.some((l) => l.robot === 1 && /Dens/.test(l.text))).toBe(true);
  });
  it('non-contiguous Groups a and c', () => {
    const s = mk(9);
    robot(s, 2, { personality: 'tourist', variables: ['patternGroup'], rateNum: 1, rateDen: 8 });
    allow(s, 2, [0, 2]);
    s.start();
    expect(new Set(groupsVisited(s, 384 * 30, 48))).toEqual(new Set([0, 2]));
  });
  it('a single Group: the Robot goes there at its next decision and stays (other Variables still move)', () => {
    const s = mk(3);
    s.clickPosition('patternGroup', 4); // the music is in Group e
    robot(s, 1, { personality: 'restless', variables: ['patternGroup', 'legato'], rateNum: 1, rateDen: 4 });
    allow(s, 1, [1]);
    expect(pg(s)).toBe(4); // switching Groups off moves nothing by itself
    s.start();
    run(s, 95);
    expect(pg(s)).toBe(4); // no jump before the Robot's first decision
    run(s, 96);
    expect(pg(s)).toBe(1);
    expect(new Set(groupsVisited(s, 384 * 20, 48))).toEqual(new Set([1]));
    expect(s.conductor.log.some((l) => l.robot === 1 && /Leg/.test(l.text))).toBe(true);
  });
  it('a Group switched off while the music is in it: no jump now; the next automatic choice is allowed, and every one after', () => {
    const s = mk(4);
    robot(s, 1, { personality: 'drunk', variables: ['patternGroup'], rateNum: 1, rateDen: 1 });
    s.clickPosition('patternGroup', 2);
    s.start();
    run(s, 300);
    s.clickPosition('patternGroup', 2); // a hand puts it in Group c
    const before = s.engine.tick;
    allow(s, 1, [0, 1, 4, 5]);
    run(s, 383);
    expect(pg(s)).toBe(2); // the restriction waits for the Robot's next decision (bar 2)
    expect(s.engine.tick).toBeGreaterThan(before);
    run(s, 384);
    expect([0, 1, 4, 5]).toContain(pg(s));
    for (const g of groupsVisited(s, 384 * 30, 96)) expect([0, 1, 4, 5]).toContain(g);
  });
  it('every Group allowed: exactly the behaviour before Allowed Groups existed (fingerprint recorded on main)', () => {
    // the same scenario run on main (0f4656a) gave 468:a45a34a9:6 — notes, and the Group after every render step
    const s = mk(7);
    s.comp.conducting.arrows.patternGroup = { enabled: true, dir: 'right' };
    s.comp.conducting.robot = { enabled: true, hRange: 1, vRange: 1, rate: 2 };
    robot(s, 1, { personality: 'chaotic', variables: ['patternGroup', 'noteDensity'], rateNum: 1, rateDen: 4 });
    robot(s, 2, { personality: 'drunk', variables: ['patternGroup'], rateNum: 3, rateDen: 8 });
    robot(s, 3, { personality: 'follower', variables: ['patternGroup', 'legato'], target: 1, rateNum: 1, rateDen: 2 });
    // switching Groups off and back on leaves the definition exactly as it was
    s.setRobotGroup(2, 3, false);
    s.allowAllGroups(2);
    s.start();
    const out: string[] = [];
    for (let t = 24; t <= 384 * 24; t += 24) {
      const evs = s.engine.render(t);
      s.emitNow(evs);
      for (const e of evs) if (e.kind === 'on') out.push(`${e.tick}:${e.channel}:${e.pitch}:${e.velocity}`);
      out.push(`g${pg(s)}`);
    }
    let h = 2166136261;
    for (const ch of out.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    expect(`${out.length}:${h.toString(16)}:${new Set(out.filter((x) => x[0] === 'g')).size}`).toBe('468:a45a34a9:6');
  });
});

describe('each Robot has its own Allowed Groups', () => {
  it('Robot 2 keeps to a b, Robot 3 to d e f — on the same Variable, at their own ticks', () => {
    const s = mk(21);
    robot(s, 1, { personality: 'chaotic', variables: ['patternGroup'], rateNum: 1, rateDen: 4 }); // ticks 96k
    allow(s, 1, [0, 1]);
    robot(s, 2, { personality: 'chaotic', variables: ['patternGroup'], rateNum: 3, rateDen: 8 }); // ticks 144k
    allow(s, 2, [3, 4, 5]);
    const changes = spyGroups(s);
    s.start();
    run(s, 384 * 40, 48);
    // at a tick on both grids, Robot 2 decides first and wins (priority); otherwise the tick says who
    const r2 = changes.filter((c) => c.tick % 96 === 0).map((c) => c.pos);
    const r3 = changes.filter((c) => c.tick % 96 !== 0).map((c) => c.pos);
    expect(r2.length).toBeGreaterThan(10);
    expect(r3.length).toBeGreaterThan(10);
    for (const p of r2) expect([0, 1]).toContain(p);
    for (const p of r3) expect([3, 4, 5]).toContain(p);
    expect(s.comp.extended.robots[0].groups).toEqual(allGroups());
    expect(s.comp.extended.robots[3].groups).toEqual(allGroups());
  });
  it('a Follower keeps to its own Groups, not its target’s', () => {
    const s = mk(2);
    robot(s, 1, { personality: 'orbit', variables: ['noteDensity'], rateNum: 1, rateDen: 4 });
    robot(s, 2, { personality: 'follower', variables: ['patternGroup'], target: 1, rateNum: 1, rateDen: 4 });
    allow(s, 2, [2, 3]);
    s.start();
    for (const g of groupsVisited(s, 384 * 20, 96)) expect([2, 3]).toContain(g);
    expect(s.conductor.mem[1].pos).toBeGreaterThanOrEqual(0);
  });
});

describe('other pathways', () => {
  it('Rule “advance” and “choose” keep to the Robot’s Groups', () => {
    const s = mk(6);
    robot(s, 1, { personality: 'chaotic', variables: ['patternGroup'], rateNum: 1, rateDen: 0 }); // sa: Rules only
    allow(s, 1, [4, 5]);
    s.addRule({ on: true, every: 1, at: 'now', when: { kind: 'interval', num: 1, den: 8 }, then: { kind: 'choose', robot: 1 } });
    s.addRule({ on: true, every: 1, at: 'now', when: { kind: 'interval', num: 1, den: 16 }, then: { kind: 'advance', robot: 1 } });
    const changes = spyGroups(s);
    s.start();
    run(s, 384 * 20, 24);
    expect(changes.length).toBeGreaterThan(20);
    for (const c of changes) expect([4, 5]).toContain(c.pos);
  });
  it('Robot 1 as Baton (M): a jump onto a forbidden Group lands on the nearest allowed one', () => {
    const s = mk(31);
    s.comp.conducting.arrows.patternGroup = { enabled: true, dir: 'right' };
    s.setBatonRobot({ hRange: 1, vRange: 1, rate: 8 });
    s.setRobotEnabled(0, true);
    allow(s, 0, [0, 1]);
    expect(s.conductor.isBaton(0)).toBe(true);
    const changes = spyGroups(s);
    s.start();
    const seen = groupsVisited(s, 384 * 30, 48);
    expect(new Set(seen)).toEqual(new Set([0, 1]));
    for (const c of changes) expect(c.pos).toBeLessThan(2);
    // the Baton itself still moves freely (only the Group is kept in bounds)
    expect(s.conductor.log.filter((l) => l.robot === 0).length).toBeGreaterThan(10);
  });
  it('Robot 1 as Baton (M) landing on a Snapshot: its Pattern Group is kept to the allowed Groups too', () => {
    const s = mk(12);
    s.comp.snapshots[0] = { positions: { patternGroup: 5, noteDensity: 2 }, arrows: {}, voices: [], sync: false };
    s.comp.conducting.arrows.snapshot = { enabled: true, dir: 'right' };
    s.setBatonRobot({ hRange: 1, vRange: 1, rate: 4 });
    s.setRobotEnabled(0, true);
    allow(s, 0, [1, 2]);
    const changes = spyGroups(s);
    s.start();
    run(s, 384 * 30, 48);
    expect(changes.length).toBeGreaterThan(0);
    for (const c of changes) expect([1, 2]).toContain(c.pos);
    expect(s.comp.snapshots[0]!.positions.patternGroup).toBe(5); // the stored Snapshot is untouched
  });
  it('Classic (Extended off): Allowed Groups are kept but ignored — M’s robot is exactly M’s', () => {
    const s = mk(31);
    s.comp.conducting.arrows.patternGroup = { enabled: true, dir: 'right' };
    s.setBatonRobot({ hRange: 1, vRange: 1, rate: 8 });
    s.setRobotEnabled(0, true);
    allow(s, 0, [0]);
    s.comp.extended.enabled = false;
    s.changed('extended');
    s.start();
    expect(new Set(groupsVisited(s, 384 * 30, 48)).size).toBeGreaterThan(2);
    expect(s.comp.extended.robots[0].groups[1]).toBe(false);
  });
  it('the hand, a Rule “set Position” and a recalled Snapshot may still choose any Group', () => {
    const s = mk(8);
    robot(s, 1, { personality: 'drunk', variables: ['patternGroup'], rateNum: 1, rateDen: 1 });
    allow(s, 1, [0]);
    s.start();
    run(s, 100);
    s.clickPosition('patternGroup', 5);
    expect(pg(s)).toBe(5);
    s.comp.snapshots[2] = { positions: { patternGroup: 3 }, arrows: {}, voices: [], sync: false };
    s.executeSnapshot(2);
    expect(pg(s)).toBe(3);
    // a Rule that sets the Group every bar (after the Robot's decision at the same tick)
    s.addRule({ on: true, every: 1, at: 'now', when: { kind: 'interval', num: 1, den: 1 }, then: { kind: 'setPosition', variable: 'patternGroup', position: 4 } });
    run(s, 384 * 3 + 1);
    expect(pg(s)).toBe(4);
  });
});

describe('editing, persistence, Undo', () => {
  it('the last allowed Group cannot be switched off (refused with a message)', () => {
    const s = mk();
    allow(s, 2, [3]);
    s.setRobotGroup(2, 3, false);
    expect(s.comp.extended.robots[2].groups).toEqual([false, false, false, true, false, false]);
    expect(s.status).toMatch(/at least one Pattern Group must stay allowed/);
    s.allowAllGroups(2);
    expect(s.comp.extended.robots[2].groups).toEqual(allGroups());
  });
  it('Allowed Groups are saved per Robot and come back; editing them is one Undo step each', () => {
    const s = mk();
    s.history.commit();
    allow(s, 1, [0, 1]);
    allow(s, 3, [2, 4]);
    s.history.commit();
    const back = deserialize(serialize(s.comp)).composition.extended.robots;
    expect(back[1].groups).toEqual([true, true, false, false, false, false]);
    expect(back[3].groups).toEqual([false, false, true, false, true, false]);
    expect(back[0].groups).toEqual(allGroups());
    s.setRobotGroup(3, 5, true);
    s.history.commit();
    expect(s.comp.extended.robots[3].groups[5]).toBe(true);
    s.undo();
    expect(s.comp.extended.robots[3].groups).toEqual([false, false, true, false, true, false]);
  });
  it('a document saved before Allowed Groups (no `groups`) loads with every Group allowed; broken data is repaired', () => {
    const s = mk();
    allow(s, 1, [0]);
    const doc = JSON.parse(serialize(s.comp));
    for (const r of doc.composition.extended.robots) delete r.groups;
    expect(deserialize(JSON.stringify(doc)).composition.extended.robots.map((r) => r.groups)).toEqual(Array.from({ length: 4 }, () => allGroups()));
    doc.composition.extended.robots[1].groups = [false, false, false, false, false, false];
    doc.composition.extended.robots[2].groups = 'nonsense';
    const back = deserialize(JSON.stringify(doc)).composition.extended.robots;
    expect(back[1].groups).toEqual(allGroups());
    expect(back[2].groups).toEqual(allGroups());
    // and it plays: no crash, Groups chosen as before
    const s2 = mk(7, deserialize(JSON.stringify(doc)).composition);
    robot(s2, 1, { personality: 'chaotic', variables: ['patternGroup'], rateNum: 1, rateDen: 8 });
    s2.start();
    expect(new Set(groupsVisited(s2, 384 * 20, 48)).size).toBeGreaterThan(2);
  });
});
