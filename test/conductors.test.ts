/**
 * EXTENDED Robot Conductors, Position weights, personalities, Rules and Home / Return
 * (docs/CONDUCTORS.md): scheduling on musical grids, priority, transport, external clock,
 * determinism, every personality, every Rule condition and action, Rule safety, Return, and
 * persistence — plus proof that Classic is untouched.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '../src/app/session';
import { defaultComposition, demoComposition } from '../src/engine/defaults';
import { MEngine, type EngineEvent, type NoteOnEvent } from '../src/engine/engine';
import { Rng } from '../src/engine/rng';
import type { Composition, VariableName } from '../src/engine/types';
import {
  candidates,
  cleanRobots,
  cleanWeights,
  createsCycle,
  decide,
  defaultParams,
  freshMemory,
  PERSONALITIES,
  remember,
  resolvePosition,
  weightedPick,
  type Candidate,
  type DecideContext,
  type Personality,
  type RobotDef,
  type RobotParams,
} from '../src/extended/conductors';
import { captureHome, homeDistance, returnPath, defaultHome } from '../src/extended/home';
import { cleanRules, ruleSummary, type Rule } from '../src/extended/rules';
import { deserialize, serialize } from '../src/persistence/format';

let sessions: Session[] = [];
afterEach(() => {
  sessions.forEach((s) => s.stop());
  sessions = [];
});

function mk(seed = 7, comp?: Composition): Session {
  const s = new Session(comp ?? demoComposition(seed));
  // the tests render the music themselves (the real-time scheduler would render ahead at Start)
  (s.scheduler as unknown as { wake: () => void }).wake = () => {};
  s.comp.extended.enabled = true;
  s.changed('extended');
  sessions.push(s);
  return s;
}
/** every note message handed to MIDI */
function spy(s: Session) {
  const notes: { on: boolean; ch: number; pitch: number }[] = [];
  (s as unknown as { send: (c: number, b: number[]) => void }).send = (c, b) => {
    const k = b[0] & 0xf0;
    if (k === 0x90 && b[2] > 0) notes.push({ on: true, ch: c, pitch: b[1] });
    else if (k === 0x80 || (k === 0x90 && b[2] === 0)) notes.push({ on: false, ch: c, pitch: b[1] });
  };
  return notes;
}
function robot(s: Session, i: number, def: Partial<Omit<RobotDef, 'params' | 'enabled'>>, on = true): void {
  expect(s.setRobot(i, def)).toBe(true);
  s.setRobotEnabled(i, on);
}
/** render to `to` in chunks (the scheduler renders a few ticks at a time) */
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
const logOf = (s: Session) => s.conductor.log.map((l) => `${l.tick} ${l.text}`);
const moves = (s: Session, r: number) => s.conductor.log.filter((l) => l.text.startsWith(`R${r + 1} `) && l.text.includes('→')).map((l) => l.tick);
const act = (s: Session, v: VariableName) => (s.comp[v] as { active: number }).active;
const ons = (evs: EngineEvent[]) => evs.filter((e): e is NoteOnEvent => e.kind === 'on').map((e) => `${e.tick}:${e.channel}:${e.pitch}:${e.velocity}`);
const rule = (r: Partial<Rule> & Pick<Rule, 'when' | 'then'>): Rule => ({ on: true, every: 1, at: 'now', ...r });

// ============================================================================ Robots

describe('multiple Robots: independent musical scheduling', () => {
  it('each Robot decides exactly on its own grid from Start (1|4, 1|2, 2|1), the first one step in', () => {
    const s = mk();
    robot(s, 1, { personality: 'orbit', variables: ['noteDensity'], rateNum: 1, rateDen: 4 });
    robot(s, 2, { personality: 'orbit', variables: ['transposition'], rateNum: 1, rateDen: 2 });
    robot(s, 3, { personality: 'orbit', variables: ['rhythm'], rateNum: 2, rateDen: 1 });
    s.start();
    run(s, 1536);
    expect(moves(s, 1)).toEqual(Array.from({ length: 16 }, (_, k) => 96 * (k + 1)));
    expect(moves(s, 2)).toEqual(Array.from({ length: 8 }, (_, k) => 192 * (k + 1)));
    expect(moves(s, 3)).toEqual([768, 1536]);
  });
  it('their Variables move independently: each Robot only touches its own', () => {
    const s = mk();
    robot(s, 1, { personality: 'orbit', variables: ['noteDensity'], rateNum: 1, rateDen: 4 });
    robot(s, 2, { personality: 'pendulum', variables: ['velocityRange', 'legato'], rateNum: 1, rateDen: 2 });
    const before = { tr: act(s, 'transposition'), rh: act(s, 'rhythm') };
    s.start();
    run(s, 192 * 3);
    expect(act(s, 'noteDensity')).toBe(6 % 6); // six Orbit steps from Position 1: back to 1
    expect(act(s, 'velocityRange')).toBe(3);
    expect(act(s, 'legato')).toBe(3);
    expect({ tr: act(s, 'transposition'), rh: act(s, 'rhythm') }).toEqual(before);
  });
  it('rate "sa" = only when a Rule advances it', () => {
    const s = mk();
    robot(s, 1, { personality: 'orbit', variables: ['noteDensity'], rateNum: 1, rateDen: 0 });
    s.start();
    run(s, 1536);
    expect(moves(s, 1)).toEqual([]);
  });
  it('switched on while playing, a Robot joins at its next grid point; switched off, it stops', () => {
    const s = mk();
    robot(s, 1, { personality: 'orbit', variables: ['noteDensity'], rateNum: 1, rateDen: 1 }, false);
    s.start();
    run(s, 500);
    s.setRobotEnabled(1, true);
    run(s, 1200);
    expect(moves(s, 1)).toEqual([768, 1152]);
    s.setRobotEnabled(1, false);
    run(s, 2400);
    expect(moves(s, 1)).toEqual([768, 1152]);
  });
  it('a rate change re-grids from Start at the next point of the new grid', () => {
    const s = mk();
    robot(s, 1, { personality: 'orbit', variables: ['noteDensity'], rateNum: 1, rateDen: 1 });
    s.start();
    run(s, 400);
    s.setRobot(1, { rateDen: 4 });
    run(s, 700);
    expect(moves(s, 1)).toEqual([384, 480, 576, 672]);
  });
});

describe('conflicts: priority = Robot number', () => {
  it('two Robots on the same Variable at the same tick: the higher priority one wins, every time', () => {
    const s = mk();
    robot(s, 1, { personality: 'orbit', variables: ['noteDensity'], rateNum: 1, rateDen: 4 });
    robot(s, 2, { personality: 'chaotic', variables: ['noteDensity'], rateNum: 1, rateDen: 4 });
    s.start();
    for (let k = 1; k <= 12; k++) {
      run(s, 96 * k + 1, 97);
      expect(act(s, 'noteDensity')).toBe(s.conductor.mem[1].pos);
    }
    // the lower-priority Robot still moved in its own right (its events fire)
    expect(moves(s, 2).length).toBeGreaterThan(4);
  });
  it('at different ticks, the latest change wins', () => {
    const s = mk();
    robot(s, 1, { personality: 'orbit', variables: ['noteDensity'], rateNum: 1, rateDen: 1 });
    robot(s, 2, { personality: 'pendulum', variables: ['noteDensity'], rateNum: 3, rateDen: 4 });
    s.start();
    run(s, 300);
    expect(act(s, 'noteDensity')).toBe(s.conductor.mem[2].pos); // Robot 3 moved at 288
    run(s, 390);
    expect(act(s, 'noteDensity')).toBe(s.conductor.mem[1].pos); // then Robot 2 at 384
  });
  it('a Robot over two Variables applies one Position to both (resolved per Variable by weights)', () => {
    const s = mk();
    s.comp.extended.weights.legato = [10, 0, 10, 0, 10, 0];
    robot(s, 1, { personality: 'orbit', variables: ['velocityRange', 'legato'], rateNum: 1, rateDen: 4 });
    s.start();
    run(s, 97);
    // candidates are the Positions eligible for both: 1, 3, 5 → Orbit goes to 3
    expect([act(s, 'velocityRange'), act(s, 'legato')]).toEqual([2, 2]);
  });
});

describe('Robot 1 is M’s Robot Conductor (migration, Classic unchanged)', () => {
  const classic = (c: Composition, to: number) => {
    const e = new MEngine(structuredClone(c));
    e.start();
    return ons(e.render(to));
  };
  it('with Extended on and Robot 1 = Baton (M), the music is exactly Classic', () => {
    const c = demoComposition(31);
    c.conducting.robot = { enabled: true, hRange: 1, vRange: 1, rate: 4 };
    c.conducting.arrows.noteDensity = { enabled: true, dir: 'right' };
    c.conducting.arrows.transposition = { enabled: true, dir: 'up' };
    const want = classic(c, 384 * 12);
    const s = mk(31, structuredClone(c));
    s.start();
    expect(ons(run(s, 384 * 12))).toEqual(want);
    expect(s.conductor.isBaton(0)).toBe(true);
    // the Baton robot's Position is the cell of its first arrowed Variable
    expect(s.conductor.mem[0].pos).toBe(act(s, 'noteDensity'));
    expect(moves(s, 0).length).toBeGreaterThan(3);
  });
  it('Extended on with nothing else set plays exactly Classic', () => {
    const c = demoComposition(8);
    const s = mk(8, structuredClone(c));
    s.start();
    expect(ons(run(s, 384 * 8))).toEqual(classic(c, 384 * 8));
  });
  it('Extended off: the engine hooks are absent (Classic code path) even with Robots, Rules and Home set', () => {
    const c = demoComposition(9);
    const s = mk(9, structuredClone(c));
    robot(s, 1, { personality: 'drunk', variables: ['noteDensity'], rateNum: 1, rateDen: 4 });
    s.addRule(rule({ when: { kind: 'interval', num: 1, den: 1 }, then: { kind: 'setPosition', variable: 'transposition', position: 3 } }));
    s.captureHome();
    s.comp.extended.enabled = false;
    s.changed('extended');
    expect(s.engine.observer).toBeNull();
    expect(s.engine.robotGate).toBeNull();
    s.start();
    expect(ons(run(s, 384 * 6))).toEqual(classic(c, 384 * 6));
  });
  it('a format-4 document with M’s robot loads as Robot 1 = Baton (M), rate carried over, Robots 2–4 off', () => {
    const c = demoComposition(3);
    c.conducting.robot = { enabled: true, hRange: 0.3, vRange: 0.2, rate: 8 };
    const doc = JSON.parse(serialize(c));
    doc.version = 4;
    for (const k of ['robots', 'weights', 'rules', 'home', 'returnSettings']) delete doc.composition.extended[k];
    const back = deserialize(JSON.stringify(doc)).composition;
    expect(back.extended.robots[0]).toMatchObject({ personality: 'baton', rateNum: 1, rateDen: 8 });
    expect(back.extended.robots.slice(1).map((r) => r.enabled)).toEqual([false, false, false]);
    expect(back.conducting.robot).toEqual({ enabled: true, hRange: 0.3, vRange: 0.2, rate: 8 });
    expect(back.extended.rules).toEqual([]);
    expect(back.extended.home.positions).toBeNull();
    // and it plays as it did
    const s = mk(3, back);
    s.start();
    expect(ons(run(s, 384 * 6))).toEqual(classic(c, 384 * 6));
  });
  it('Robot 1 given another personality parks the Baton robot and moves Positions itself', () => {
    const s = mk();
    s.comp.conducting.robot = { enabled: true, hRange: 1, vRange: 1, rate: 4 };
    s.comp.conducting.arrows.transposition = { enabled: true, dir: 'right' };
    robot(s, 0, { personality: 'orbit', variables: ['noteDensity'], rateNum: 1, rateDen: 4 });
    const baton = { ...s.comp.conducting.baton };
    s.start();
    run(s, 384 * 2);
    expect(s.comp.conducting.baton).toEqual(baton); // M's robot did not jump
    expect(moves(s, 0).length).toBe(8);
  });
  it('switched on mid-play under Extended, the Baton robot joins its grid instead of catching up', () => {
    const s = mk();
    s.comp.conducting.robot = { enabled: false, hRange: 1, vRange: 1, rate: 4 };
    s.comp.conducting.arrows.noteDensity = { enabled: true, dir: 'right' };
    s.start();
    run(s, 1000);
    s.setRobotEnabled(0, true);
    const evs = run(s, 1200);
    const batons = evs.filter((e) => e.kind === 'change' && e.what === 'baton').map((e) => e.tick);
    expect(batons).toEqual([1056, 1152]);
  });
});

describe('transport and clock', () => {
  const setup = (s: Session) => {
    robot(s, 1, { personality: 'drunk', variables: ['noteDensity'], rateNum: 1, rateDen: 4 });
    robot(s, 2, { personality: 'curious', variables: ['transposition', 'legato'], rateNum: 1, rateDen: 2 });
    robot(s, 3, { personality: 'follower', variables: ['rhythm'], rateNum: 1, rateDen: 4, target: 1 });
  };
  it('deterministic: same document + seed = the same moves; Stop then Start replays them', () => {
    const a = mk(41);
    setup(a);
    a.start();
    run(a, 3000);
    const first = logOf(a);
    a.stop();
    a.start();
    run(a, 3000);
    expect(logOf(a).slice(-first.length)).toEqual(first);
    const b = mk(41);
    setup(b);
    b.start();
    run(b, 3000);
    expect(logOf(b)).toEqual(first);
    const c = mk(42);
    setup(c);
    c.start();
    run(c, 3000);
    expect(logOf(c)).not.toEqual(first);
  });
  it('independent of how finely the music is rendered', () => {
    const a = mk(5);
    const b = mk(5);
    setup(a);
    setup(b);
    a.start();
    b.start();
    const ea = run(a, 3000, 1);
    const eb = run(b, 3000, 113);
    expect(logOf(a)).toEqual(logOf(b));
    expect(ons(ea)).toEqual(ons(eb));
  });
  it('Pause freezes the Robots; Continue resumes exactly where they were', () => {
    const a = mk(6);
    const b = mk(6);
    setup(a);
    setup(b);
    a.start();
    b.start();
    run(a, 3000);
    run(b, 1300);
    b.pause();
    expect(b.engine.render(5000)).toEqual([]);
    b.pause();
    run(b, 3000);
    expect(logOf(b)).toEqual(logOf(a));
  });
  it('Stop clears every pending decision; a stopped emmm moves nothing', () => {
    const s = mk();
    setup(s);
    s.start();
    run(s, 1000);
    s.stop();
    expect(s.engine.pendingActions()).toEqual([]);
    const pos = s.conductor.mem.map((m) => m.pos);
    expect(s.engine.render(5000)).toEqual([]);
    expect(s.conductor.mem.map((m) => m.pos)).toEqual(pos);
  });
  it('tempo changes never move the decisions in musical time', () => {
    const a = mk(12);
    const b = mk(12);
    setup(a);
    setup(b);
    a.start();
    b.start();
    run(a, 3000);
    for (let t = 0; t < 3000; t += 250) {
      b.setTempo(60 + (t % 7) * 15);
      run(b, t + 250);
    }
    expect(logOf(b)).toEqual(logOf(a));
  });
  it('external MIDI clock: FA starts the Robots from the top, FC halts with them kept, FB continues — as if uninterrupted', () => {
    const a = mk(13);
    const b = mk(13);
    for (const s of [a, b]) {
      s.comp.midi.clockIn.enabled = true;
      setup(s);
    }
    a.midiIn('x', [0xfa], 0);
    run(a, 3000);
    b.midiIn('x', [0xfa], 0);
    run(b, 1100);
    b.midiIn('x', [0xfc], 1);
    expect(b.extHalted).toBe(true);
    expect(b.engine.render(4000)).toEqual([]);
    b.midiIn('x', [0xfb], 2);
    run(b, 3000);
    expect(logOf(b)).toEqual(logOf(a));
    // FA again: from the beginning, the same take
    b.midiIn('x', [0xfa], 3);
    const n = b.conductor.log.length;
    run(b, 3000);
    expect(logOf(b).slice(n)).toEqual(logOf(a).slice(0, logOf(b).length - n));
  });
  it('external clock pulses set the tempo; the decisions stay on their ticks', () => {
    const a = mk(14);
    const b = mk(14);
    for (const s of [a, b]) setup(s);
    b.comp.midi.clockIn.enabled = true;
    a.start();
    b.midiIn('x', [0xfa], 0);
    for (let i = 0; i < 24 * 8; i++) b.midiIn('x', [0xf8], i * 25); // 100 bpm
    run(a, 2000);
    run(b, 2000);
    expect(logOf(b)).toEqual(logOf(a));
  });
  it('Reroll gives the Robots a new random path', () => {
    const a = mk(15);
    setup(a);
    a.start();
    run(a, 3000);
    const first = logOf(a);
    a.stop();
    a.reroll(99999);
    a.start();
    run(a, 3000);
    expect(logOf(a).slice(first.length)).not.toEqual(first);
  });
});

// ============================================================================ weights

describe('weights', () => {
  it('equal by default; candidates for one Variable are its weights', () => {
    const c = defaultComposition();
    expect(c.extended.weights.noteDensity).toEqual([10, 10, 10, 10, 10, 10]);
    const w = cleanWeights({ noteDensity: [50, 25, 15, 7, 2, 1] });
    const k = candidates(w, ['noteDensity']);
    expect(k.map((x) => x.pos)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(k[0].w / k[5].w).toBeCloseTo(50);
  });
  it('a 50 25 15 7 2 1 distribution is followed (seeded, within 2 %)', () => {
    const w = cleanWeights({ noteDensity: [50, 25, 15, 7, 2, 1] });
    const k = candidates(w, ['noteDensity']);
    const rng = new Rng(1, 6000);
    const n = 40000;
    const count = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) count[weightedPick(k, rng)!]++;
    [50, 25, 15, 7, 2, 1].forEach((x, i) => expect(Math.abs(count[i] / n - x / 100)).toBeLessThan(0.02));
  });
  it('weight 0 excludes a Position; extreme weights; all-zero rows are refused / repaired', () => {
    const w = cleanWeights({ noteDensity: [0, 0, 10, 0, 10, 0], legato: [0, 0, 0, 0, 0, 0], rhythm: [100, 0, 0, 0, 0, 1] });
    expect(candidates(w, ['noteDensity']).map((x) => x.pos)).toEqual([2, 4]);
    expect(w.legato).toEqual([10, 10, 10, 10, 10, 10]);
    const rng = new Rng(2, 6000);
    let last = 0;
    for (let i = 0; i < 2000; i++) if (weightedPick(candidates(w, ['rhythm']), rng) === 5) last++;
    expect(last).toBeGreaterThan(5);
    expect(last).toBeLessThan(60);
    expect(cleanWeights({ accent: [-5, 400, 'x', 3.6] }).accent).toEqual([0, 100, 10, 4, 10, 10]);
  });
  it('unavailable Positions: each Variable takes its nearest eligible one; disjoint Variables fall back to the union', () => {
    const w = cleanWeights({ noteDensity: [10, 0, 0, 0, 0, 0], legato: [0, 0, 0, 0, 0, 10] });
    expect(candidates(w, ['noteDensity', 'legato']).map((x) => x.pos)).toEqual([0, 5]);
    expect(resolvePosition(w, 'noteDensity', 5)).toBe(0);
    expect(resolvePosition(w, 'legato', 0)).toBe(5);
    const w2 = cleanWeights({ noteDensity: [0, 10, 0, 10, 0, 0] });
    expect(resolvePosition(w2, 'noteDensity', 2)).toBe(1); // tie → the lower
  });
  it('a Robot only ever visits eligible Positions (in the music)', () => {
    const s = mk();
    s.comp.extended.weights.noteDensity = [0, 10, 0, 50, 0, 10];
    robot(s, 1, { personality: 'chaotic', variables: ['noteDensity'], rateNum: 1, rateDen: 8 });
    const seen = new Set<number>();
    s.start();
    for (let t = 48; t < 384 * 20; t += 48) {
      run(s, t, 48);
      seen.add(act(s, 'noteDensity'));
    }
    expect([...seen].sort()).toEqual([1, 3, 5]);
  });
  it('deterministic with a seed', () => {
    const k = candidates(cleanWeights({}), ['noteDensity']);
    const a = new Rng(9, 6000);
    const b = new Rng(9, 6000);
    expect(Array.from({ length: 50 }, () => weightedPick(k, a))).toEqual(Array.from({ length: 50 }, () => weightedPick(k, b)));
  });
  it('editing: the last eligible Position cannot be set to 0; row operations; one Undo step each', () => {
    const s = mk();
    s.comp.extended.weights.noteDensity = [0, 0, 0, 0, 0, 7];
    s.history.commit();
    s.setWeight('noteDensity', 5, 0);
    expect(s.comp.extended.weights.noteDensity[5]).toBe(7);
    expect(s.status).toMatch(/at least one/);
    s.weightOp('noteDensity', 'reset');
    s.history.commit();
    expect(s.comp.extended.weights.noteDensity).toEqual([10, 10, 10, 10, 10, 10]);
    s.setWeight('noteDensity', 2, 0);
    s.weightOp('noteDensity', 'equal');
    expect(s.comp.extended.weights.noteDensity).toEqual([10, 10, 0, 10, 10, 10]);
    s.weightOp('noteDensity', 'random');
    const r = s.comp.extended.weights.noteDensity;
    expect(r[2]).toBe(0);
    expect(r.filter((x) => x > 0).length).toBe(5);
    s.clickPosition('noteDensity', 4);
    s.weightOp('noteDensity', 'current');
    expect(s.comp.extended.weights.noteDensity).toEqual([10, 10, 0, 10, 60, 10]);
    s.history.commit();
    s.weightOp('noteDensity', 'home');
    expect(s.status).toMatch(/No Home/);
    s.clickPosition('noteDensity', 1);
    s.captureHome();
    s.weightOp('noteDensity', 'home');
    expect(s.comp.extended.weights.noteDensity).toEqual([10, 60, 0, 10, 10, 10]);
    s.history.commit();
    s.undo();
    expect(s.comp.extended.weights.noteDensity).toEqual([10, 10, 0, 10, 60, 10]);
  });
  it('weights do not change Orbit or Pendulum (only which Positions are eligible)', () => {
    const run6 = (w: number[]) => {
      const cands = candidates(cleanWeights({ noteDensity: w }), ['noteDensity']);
      const mem = freshMemory(0);
      const rng = new Rng(1, 6000);
      const out: number[] = [];
      for (let i = 0; i < 12; i++) {
        const to = decide('orbit', defaultParams(), mem, cands, { home: null, target: null, seenTargetMoves: 0 }, rng);
        remember(mem, to);
        out.push(to);
      }
      return out;
    };
    expect(run6([10, 10, 10, 10, 10, 10])).toEqual(run6([90, 1, 50, 3, 7, 100]));
    expect(run6([10, 0, 10, 0, 10, 0])).toEqual([2, 4, 0, 2, 4, 0, 2, 4, 0, 2, 4, 0]);
  });
});

// ============================================================================ personalities

function walk(p: Personality, prm: Partial<RobotParams> = {}, opts: { cands?: Candidate[]; n?: number; seed?: number; start?: number; ctx?: (i: number) => Partial<DecideContext> } = {}): number[] {
  const cands = opts.cands ?? Array.from({ length: 6 }, (_, pos) => ({ pos, w: 1 }));
  const mem = freshMemory(opts.start ?? 0);
  const rng = new Rng(opts.seed ?? 3, 6000);
  const params = { ...defaultParams(), ...prm };
  const out = [mem.pos];
  for (let i = 0; i < (opts.n ?? 300); i++) {
    const ctx: DecideContext = { home: null, target: null, seenTargetMoves: 0, ...(opts.ctx?.(i) ?? {}) };
    const to = decide(p, params, mem, cands, ctx, rng);
    expect(cands.some((c) => c.pos === to) || to === mem.pos).toBe(true);
    remember(mem, to);
    out.push(to);
  }
  return out;
}
const deltas = (w: number[]) => w.slice(1).map((x, i) => x - w[i]);

describe('personalities are genuinely different algorithms', () => {
  it('Drunk: never jumps further than its step; prefers neighbours; sometimes stays', () => {
    const w = walk('drunk', { step: 1, stay: 20 });
    expect(deltas(w).every((d) => Math.abs(d) <= 1)).toBe(true);
    const stays = deltas(w).filter((d) => d === 0).length / 300;
    expect(stays).toBeGreaterThan(0.1);
    expect(stays).toBeLessThan(0.35);
    const w2 = walk('drunk', { step: 3, stay: 0 });
    const d2 = deltas(w2).map(Math.abs);
    expect(d2.every((d) => d >= 1 && d <= 3)).toBe(true);
    expect(d2.filter((d) => d === 1).length).toBeGreaterThan(d2.filter((d) => d === 3).length); // nearby likelier
  });
  it('Tourist: never returns to a Position seen within its memory while others are fresh', () => {
    const w = walk('tourist', { memory: 4 });
    for (let i = 4; i < w.length; i++) expect(w.slice(i - 4, i)).not.toContain(w[i]);
    expect(new Set(w).size).toBe(6);
  });
  it('Homebody: spends most of its time at Home and always comes back', () => {
    const w = walk('homebody', { pull: 70, wander: 35, range: 2 }, { ctx: () => ({ home: 2 }), start: 2 });
    const home = w.filter((x) => x === 2).length / w.length;
    expect(home).toBeGreaterThan(0.5);
    expect(w.every((x) => Math.abs(x - 2) <= 3)).toBe(true);
  });
  it('Restless: never stays longer than its patience; the longer it stays, the likelier a move', () => {
    const w = walk('restless', { patience: 3 });
    let run = 0;
    for (const d of deltas(w)) {
      run = d === 0 ? run + 1 : 0;
      expect(run).toBeLessThan(3);
    }
    expect(deltas(w).filter((d) => d === 0).length).toBeGreaterThan(30);
  });
  it('Orbit: in order, wrapping; step and direction', () => {
    expect(walk('orbit', {}, { n: 8 })).toEqual([0, 1, 2, 3, 4, 5, 0, 1, 2]);
    expect(walk('orbit', { step: 2, dir: -1 }, { n: 5 })).toEqual([0, 4, 2, 0, 4, 2]);
  });
  it('Pendulum: back and forth, ends not repeated; two Positions alternate', () => {
    expect(walk('pendulum', {}, { n: 12 })).toEqual([0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0, 1, 2]);
    expect(walk('pendulum', { step: 2 }, { n: 6 })).toEqual([0, 2, 4, 5, 3, 1, 0]);
    expect(walk('pendulum', {}, { n: 4, cands: [{ pos: 1, w: 1 }, { pos: 4, w: 1 }], start: 1 })).toEqual([1, 4, 1, 4, 1]);
  });
  it('Chaotic: every move at least its minimum jump; it never stays', () => {
    const d = deltas(walk('chaotic', { minJump: 3 })).map(Math.abs);
    expect(d.every((x) => x >= 3)).toBe(true);
  });
  it('Curious: favours familiar Positions but explores all of them', () => {
    const w = walk('curious', { explore: 15 }, { n: 600 });
    const count = [0, 1, 2, 3, 4, 5].map((p) => w.filter((x) => x === p).length);
    expect(Math.min(...count)).toBeGreaterThan(0);
    expect(Math.max(...count) / Math.min(...count)).toBeGreaterThan(2); // rich get richer
  });
  it('Follower: copy goes where the target is; echo repeats its moves; holds when there is nothing to follow', () => {
    const target = [3, 3, 5, 1, 1, 4];
    const copy = walk('follower', { mode: 'copy' }, { n: 6, ctx: (i) => ({ target: { pos: target[i], lastDelta: 0, moves: i + 1 } }) });
    expect(copy.slice(1)).toEqual(target);
    const echo = walk('follower', { mode: 'echo' }, { n: 4, start: 2, ctx: (i) => ({ target: { pos: 0, lastDelta: [1, 1, -2, 0][i], moves: i + 1 }, seenTargetMoves: i }) });
    expect(echo).toEqual([2, 3, 4, 2, 2]);
    expect(walk('follower', {}, { n: 5, start: 4 })).toEqual([4, 4, 4, 4, 4, 4]);
  });
  it('Contrarian: mirror is 7 − the target’s Position; avoid keeps its distance', () => {
    const m = walk('contrarian', { mode: 'mirror' }, { n: 6, ctx: (i) => ({ target: { pos: i, lastDelta: 1, moves: i + 1 } }) });
    expect(m.slice(1)).toEqual([5, 4, 3, 2, 1, 0]);
    const a = walk('contrarian', { mode: 'avoid', distance: 3 }, { n: 100, ctx: () => ({ target: { pos: 2, lastDelta: 1, moves: 1 } }) });
    expect(a.slice(1).every((x) => Math.abs(x - 2) >= 3)).toBe(true);
  });
  it('every personality gives its own sequence for the same seed and Positions', () => {
    const ids: Personality[] = ['drunk', 'tourist', 'homebody', 'restless', 'orbit', 'pendulum', 'chaotic', 'curious'];
    const seqs = ids.map((p) => walk(p, {}, { n: 40, ctx: () => ({ home: 0 }) }).join(''));
    expect(new Set(seqs).size).toBe(ids.length);
  });
  it('deterministic replay; no eligible Position → stays; one → goes and stays', () => {
    for (const p of PERSONALITIES.map((x) => x.id)) {
      expect(walk(p, {}, { n: 30, seed: 5 })).toEqual(walk(p, {}, { n: 30, seed: 5 }));
      expect(walk(p, {}, { n: 5, cands: [], start: 3 })).toEqual([3, 3, 3, 3, 3, 3]);
      expect(walk(p, {}, { n: 3, cands: [{ pos: 4, w: 1 }], start: 1 })).toEqual([1, 4, 4, 4]);
    }
  });
  it('no pathological cases: random parameters, weights and targets always terminate quickly', () => {
    const rng = new Rng(77, 1);
    const t0 = performance.now();
    for (let k = 0; k < 400; k++) {
      const p = PERSONALITIES[rng.int(0, PERSONALITIES.length - 1)].id;
      const cands = Array.from({ length: 6 }, (_, pos) => ({ pos, w: rng.int(0, 3) * rng.int(0, 100) })).filter((c) => c.w > 0 || rng.chance(20));
      const prm: Partial<RobotParams> = { step: rng.int(1, 5), stay: rng.int(0, 90), memory: rng.int(1, 12), patience: rng.int(1, 16), minJump: rng.int(1, 5), explore: rng.int(0, 100), dir: rng.chance(50) ? 1 : -1, mode: (['copy', 'echo', 'mirror', 'avoid'] as const)[rng.int(0, 3)], distance: rng.int(1, 5), fidelity: rng.int(0, 100) };
      walk(p, prm, { n: 50, cands, seed: k, start: rng.int(0, 5), ctx: () => ({ home: rng.chance(50) ? rng.int(0, 5) : null, target: rng.chance(50) ? { pos: rng.int(0, 5), lastDelta: rng.int(-5, 5), moves: rng.int(0, 9) } : null }) });
    }
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe('Follower / Contrarian in the music', () => {
  it('a Follower copies its target’s Position each decision', () => {
    const s = mk();
    robot(s, 1, { personality: 'orbit', variables: ['noteDensity'], rateNum: 1, rateDen: 4 });
    robot(s, 2, { personality: 'follower', variables: ['legato'], rateNum: 1, rateDen: 4, target: 1 });
    s.start();
    for (let k = 1; k <= 8; k++) {
      run(s, 96 * k + 1, 97);
      expect(act(s, 'legato')).toBe(act(s, 'noteDensity'));
    }
  });
  it('a Contrarian mirrors its target', () => {
    const s = mk();
    robot(s, 1, { personality: 'orbit', variables: ['noteDensity'], rateNum: 1, rateDen: 4 });
    robot(s, 2, { personality: 'contrarian', variables: ['legato'], rateNum: 1, rateDen: 4, target: 1 });
    s.setRobotParam(2, 'mode', 'mirror');
    s.start();
    run(s, 96 * 5 + 1);
    expect(act(s, 'legato')).toBe(5 - act(s, 'noteDensity'));
  });
  it('waits (holds) while its target is off or has not moved', () => {
    const s = mk();
    robot(s, 1, { personality: 'orbit', variables: ['noteDensity'], rateNum: 1, rateDen: 4 }, false);
    robot(s, 2, { personality: 'follower', variables: ['legato'], rateNum: 1, rateDen: 4, target: 1 });
    const lg = act(s, 'legato');
    s.start();
    run(s, 800);
    expect(act(s, 'legato')).toBe(lg);
    expect(s.conductor.waiting[2]).toBe(true);
  });
  it('dependency cycles are refused when editing and broken when loading', () => {
    const s = mk();
    robot(s, 1, { personality: 'follower', target: 2 });
    expect(s.setRobot(2, { personality: 'follower', target: 1 })).toBe(false);
    expect(s.setRobot(2, { personality: 'contrarian', target: 3 })).toBe(true);
    expect(s.setRobot(3, { personality: 'follower', target: 1 })).toBe(false); // 3 → 1 → 2 → 3
    const robots = cleanRobots([{ personality: 'baton' }, { personality: 'follower', target: 2 }, { personality: 'follower', target: 1 }, { personality: 'baton', target: 3 }]);
    expect(robots[1].target).toBe(2);
    expect(robots[2].target).toBeNull();
    expect(robots[3].personality).toBe('drunk'); // only Robot 1 can be M's Baton robot
    expect(createsCycle(robots, 3, 3)).toBe(true);
  });
});

// ============================================================================ Rules

describe('Rules: conditions', () => {
  it('Voice completes a Pattern cycle (not at Start, not after a Sync)', () => {
    const s = mk();
    s.comp.voices.forEach((v, i) => (v.playEnable = i === 0));
    s.addRule(rule({ when: { kind: 'cycle', voice: 0, cycle: 'pattern' }, then: { kind: 'setPosition', variable: 'noteDensity', position: 2 } }));
    const len = Math.min(s.pattern(0).outputLength, s.pattern(0).steps.length);
    const base = s.engine.baseTicks(0);
    s.start();
    run(s, len * base - 1);
    expect(s.conductor.ruleCount(0)).toBe(0);
    run(s, len * base + 1);
    expect(s.conductor.ruleCount(0)).toBe(1);
    expect(act(s, 'noteDensity')).toBe(2);
  });
  it('Robot moves / enters Position / returns Home; Variable enters Position; interval; every Nth', () => {
    const s = mk();
    robot(s, 1, { personality: 'orbit', variables: ['noteDensity'], rateNum: 1, rateDen: 4, home: 0 });
    s.addRule(rule({ when: { kind: 'robotMoved', robot: 1 }, then: { kind: 'suspend', robot: 3, num: 1, den: 16 } }));
    s.addRule(rule({ when: { kind: 'robotAt', robot: 1, position: 3 }, then: { kind: 'suspend', robot: 3, num: 1, den: 16 } }));
    s.addRule(rule({ when: { kind: 'robotHome', robot: 1 }, then: { kind: 'suspend', robot: 3, num: 1, den: 16 } }));
    s.addRule(rule({ when: { kind: 'variableAt', variable: 'noteDensity', position: 4 }, then: { kind: 'suspend', robot: 3, num: 1, den: 16 } }));
    s.addRule(rule({ when: { kind: 'interval', num: 1, den: 2 }, then: { kind: 'suspend', robot: 3, num: 1, den: 16 } }));
    s.addRule(rule({ when: { kind: 'robotMoved', robot: -1 }, every: 3, then: { kind: 'suspend', robot: 3, num: 1, den: 16 } }));
    s.start();
    run(s, 96 * 12 + 1);
    // 12 moves 1→2→…→6→1→…; Position 4 (index 3) twice; Home (index 0) twice; Density 5 (index 4) twice
    expect([0, 1, 2, 3, 4, 5].map((i) => s.conductor.ruleCount(i))).toEqual([12, 2, 2, 2, 6, 12]);
    expect([0, 1, 2, 3, 4, 5].map((i) => s.conductor.ruleFires(i))).toEqual([12, 2, 2, 2, 6, 4]);
    expect(s.conductor.ruleFlash(4)).toBe(1152);
  });
  it('Home reached and Return completed', () => {
    const s = mk();
    s.captureHome();
    s.addRule(rule({ when: { kind: 'homeReached' }, then: { kind: 'setPosition', variable: 'rhythm', position: 5 } }));
    s.addRule(rule({ when: { kind: 'returnDone' }, then: { kind: 'setPosition', variable: 'accent', position: 5 } }));
    s.start();
    run(s, 100);
    s.clickPosition('noteDensity', 3);
    run(s, 200);
    expect(s.conductor.ruleCount(0)).toBe(0);
    s.returnHome();
    run(s, 2000);
    expect(s.conductor.ruleCount(0)).toBe(1);
    expect(s.conductor.ruleCount(1)).toBe(1);
    expect(act(s, 'accent')).toBe(5);
  });
});

describe('Rules: actions', () => {
  const at = (s: Session, r: Rule) => (s.addRule(r), s);
  it('advance / choose a Robot (also a Rules-only “sa” Robot)', () => {
    const s = mk();
    robot(s, 1, { personality: 'orbit', variables: ['noteDensity'], rateNum: 1, rateDen: 0 });
    robot(s, 2, { personality: 'orbit', variables: ['legato'], rateNum: 1, rateDen: 0 });
    at(s, rule({ when: { kind: 'interval', num: 1, den: 4 }, then: { kind: 'advance', robot: 1 } }));
    at(s, rule({ when: { kind: 'interval', num: 1, den: 2 }, then: { kind: 'choose', robot: 2 } }));
    s.start();
    run(s, 96 * 4 + 1);
    expect(act(s, 'noteDensity')).toBe(4);
    expect(moves(s, 2).length).toBe(2);
  });
  it('Robot on / off / toggle are performance overrides (the document is untouched, Stop clears them)', () => {
    const s = mk();
    robot(s, 1, { personality: 'orbit', variables: ['noteDensity'], rateNum: 1, rateDen: 4 });
    at(s, rule({ when: { kind: 'interval', num: 1, den: 1 }, then: { kind: 'enable', robot: 1, mode: 'toggle' } }));
    s.start();
    run(s, 900);
    // off at 384 (after its move); on again at 768, joining its grid at the next point
    expect(moves(s, 1)).toEqual([96, 192, 288, 384, 864]);
    expect(s.comp.extended.robots[1].enabled).toBe(true);
    s.stop();
    expect(s.conductor.enabledOverride[1]).toBeNull();
  });
  it('personality (named or next) is an override too', () => {
    const s = mk();
    robot(s, 1, { personality: 'orbit', variables: ['noteDensity'], rateNum: 1, rateDen: 4 });
    at(s, rule({ when: { kind: 'robotAt', robot: 1, position: 2 }, then: { kind: 'personality', robot: 1, personality: 'pendulum' } }));
    at(s, rule({ when: { kind: 'interval', num: 4, den: 1 }, then: { kind: 'personality', robot: 2, personality: 'next' } }));
    s.start();
    run(s, 96 * 8 + 1);
    expect(s.conductor.personality(1)).toBe('pendulum');
    expect(s.comp.extended.robots[1].personality).toBe('orbit');
  });
  it('set a Variable Position; recall a Snapshot (empty slot = nothing, logged); Restore works after it', () => {
    const s = mk();
    s.hold = { mode: 'hold', pending: { positions: { transposition: 4 }, arrows: {}, voices: [{}, {}, {}, {}], sync: false } };
    s.clickSnapshot(7);
    at(s, rule({ when: { kind: 'interval', num: 1, den: 4 }, then: { kind: 'snapshot', index: 7 } }));
    at(s, rule({ when: { kind: 'interval', num: 1, den: 4 }, then: { kind: 'snapshot', index: 8 } }));
    at(s, rule({ when: { kind: 'interval', num: 1, den: 2 }, then: { kind: 'setPosition', variable: 'velocityRange', position: 5 } }));
    s.start();
    run(s, 200);
    expect(act(s, 'transposition')).toBe(4);
    expect(act(s, 'velocityRange')).toBe(5);
    expect(logOf(s).some((l) => l.includes('Snapshot I is empty'))).toBe(true);
    expect(s.currentSnapshot).toBe(7);
  });
  it('Return Home (from a Robot’s move)', () => {
    const s = mk();
    s.captureHome();
    s.clickPosition('noteDensity', 5);
    robot(s, 1, { personality: 'orbit', variables: ['legato'], rateNum: 1, rateDen: 4 });
    at(s, rule({ when: { kind: 'robotAt', robot: 1, position: 2 }, then: { kind: 'returnHome', immediate: true } }));
    s.start();
    run(s, 97);
    expect(act(s, 'noteDensity')).toBe(5);
    run(s, 193);
    expect(act(s, 'noteDensity')).toBe(s.comp.extended.home.positions!.noteDensity);
    expect(logOf(s)).toContain('192 Return complete');
  });
  it('Suspend a Robot for a musical duration', () => {
    const s = mk();
    robot(s, 1, { personality: 'orbit', variables: ['legato'], rateNum: 1, rateDen: 4 });
    at(s, rule({ when: { kind: 'robotAt', robot: 1, position: 2 }, then: { kind: 'suspend', robot: 1, num: 1, den: 1 } }));
    s.start();
    run(s, 1000);
    // moves at 96, 192 (Position 3: paused for a bar), none at 288–480, again from 576
    expect(moves(s, 1).slice(0, 4)).toEqual([96, 192, 576, 672]);
    expect(s.conductor.suspended(1, 300)).toBe(true);
  });
});

describe('Rules: safety', () => {
  it('rules fire in list order for one event', () => {
    const s = mk();
    s.addRule(rule({ when: { kind: 'interval', num: 1, den: 4 }, then: { kind: 'setPosition', variable: 'noteDensity', position: 1 } }));
    s.addRule(rule({ when: { kind: 'interval', num: 1, den: 4 }, then: { kind: 'setPosition', variable: 'noteDensity', position: 2 } }));
    s.start();
    run(s, 97);
    // rules 1 and 2 each have their own interval event; both fire, in order: 2 wins
    expect(act(s, 'noteDensity')).toBe(2);
    expect(logOf(s).filter((l) => l.includes('rule'))).toEqual(['96 rule 1: Note Density → Position 2', '96 rule 2: Note Density → Position 3']);
  });
  it('mutually triggering rules (A → B → A) stop: each rule fires at most once a tick', () => {
    const s = mk();
    s.addRule(rule({ when: { kind: 'variableAt', variable: 'noteDensity', position: 5 }, then: { kind: 'setPosition', variable: 'noteDensity', position: 0 } }));
    s.addRule(rule({ when: { kind: 'variableAt', variable: 'noteDensity', position: 0 }, then: { kind: 'setPosition', variable: 'noteDensity', position: 1 } }));
    s.addRule(rule({ when: { kind: 'variableAt', variable: 'noteDensity', position: 1 }, then: { kind: 'setPosition', variable: 'noteDensity', position: 0 } }));
    s.addRule(rule({ when: { kind: 'interval', num: 1, den: 4 }, then: { kind: 'setPosition', variable: 'noteDensity', position: 5 } }));
    s.start();
    const t0 = performance.now();
    run(s, 384 * 4);
    expect(performance.now() - t0).toBeLessThan(1000);
    // per beat: 6 → 1 → 2 → 1 (rule 2 has fired this tick already: the chain ends)
    expect(act(s, 'noteDensity')).toBe(0);
    expect([0, 1, 2, 3].map((i) => s.conductor.ruleFires(i))).toEqual([16, 16, 16, 16]);
  });
  it('a Robot rule that advances itself on its own move is bounded', () => {
    const s = mk();
    robot(s, 1, { personality: 'orbit', variables: ['noteDensity'], rateNum: 1, rateDen: 4 });
    s.addRule(rule({ when: { kind: 'robotMoved', robot: 1 }, then: { kind: 'advance', robot: 1 } }));
    s.start();
    run(s, 96 * 3 + 1);
    expect(moves(s, 1)).toEqual([96, 96, 192, 192, 288, 288]);
  });
  it('the event queue is bounded and depth-limited (16 rules all feeding each other)', () => {
    const s = mk();
    for (let i = 0; i < 16; i++) s.addRule(rule({ when: { kind: 'variableAt', variable: i % 2 ? 'legato' : 'noteDensity', position: i % 6 }, then: { kind: 'setPosition', variable: i % 2 ? 'noteDensity' : 'legato', position: (i + 1) % 6 } }));
    expect(s.addRule(defaultRuleLike())).toBe(-1); // at most 16
    s.start();
    for (let t = 0; t < 384 * 4; t += 96) {
      s.clickPosition('noteDensity', (t / 96) % 6);
      run(s, t + 96);
    }
    expect(s.conductor.log.length).toBeLessThanOrEqual(40);
  });
  it('quantization: “bar” waits for the next bar, “Q” for the Snapshot quantization; Stop discards waiting actions', () => {
    const s = mk();
    s.comp.quantization = 2; // half notes
    s.addRule(rule({ when: { kind: 'interval', num: 1, den: 4 }, every: 100, then: { kind: 'setPosition', variable: 'noteDensity', position: 0 } }));
    s.addRule(rule({ when: { kind: 'interval', num: 1, den: 4 }, then: { kind: 'setPosition', variable: 'legato', position: 4 }, at: 'bar' }));
    s.addRule(rule({ when: { kind: 'interval', num: 1, den: 4 }, then: { kind: 'setPosition', variable: 'rhythm', position: 3 }, at: 'quant' }));
    s.start();
    run(s, 100);
    expect(act(s, 'legato')).not.toBe(4);
    expect(act(s, 'rhythm')).not.toBe(3);
    run(s, 193);
    expect(act(s, 'rhythm')).toBe(3);
    expect(act(s, 'legato')).not.toBe(4);
    run(s, 385);
    expect(act(s, 'legato')).toBe(4);
    run(s, 500);
    expect(s.engine.pendingActions().filter((a) => a.label === 'rule').map((a) => a.tick)).toEqual([576, 768]);
    s.stop();
    expect(s.engine.pendingActions()).toEqual([]);
  });
  it('missing targets do nothing harmful: a Robot that is off, no Home, an empty Snapshot', () => {
    const s = mk();
    s.addRule(rule({ when: { kind: 'interval', num: 1, den: 4 }, then: { kind: 'advance', robot: 3 } }));
    s.addRule(rule({ when: { kind: 'interval', num: 1, den: 4 }, then: { kind: 'returnHome', immediate: false } }));
    s.addRule(rule({ when: { kind: 'interval', num: 1, den: 4 }, then: { kind: 'snapshot', index: 25 } }));
    s.start();
    expect(() => run(s, 500)).not.toThrow();
    expect(logOf(s).join('|')).toMatch(/R4 is off.*no Home.*Snapshot Z is empty/);
  });
  it('invalid stored rules are dropped or clamped on load; at most 16', () => {
    const rules = cleanRules([
      { when: { kind: 'nonsense' }, then: { kind: 'advance', robot: 1 } },
      { when: { kind: 'robotAt', robot: 9, position: 40 }, then: { kind: 'snapshot', index: 99 }, every: 0, at: 'never' },
      { when: { kind: 'variableAt', variable: 'soundChoice', position: 1 }, then: { kind: 'advance', robot: 1 } },
      ...Array.from({ length: 30 }, () => ({ when: { kind: 'homeReached' }, then: { kind: 'returnHome' } })),
    ]);
    expect(rules.length).toBe(16);
    expect(rules[0]).toEqual({ on: true, when: { kind: 'robotAt', robot: 3, position: 5 }, every: 1, then: { kind: 'snapshot', index: 25 }, at: 'now' });
    expect(ruleSummary(rules[0])).toBe('WHEN Robot 4 enters Position 6 THEN recall Snapshot Z');
  });
  it('no hung notes: rules recalling Snapshots with Sync, Pattern Group changes, Robots, Return — every note-on is ended by Stop', () => {
    const s = mk(23);
    const notes = spy(s);
    s.hold = { mode: 'hold', pending: { positions: { patternGroup: 1, legato: 5 }, arrows: {}, voices: [{}, {}, {}, {}], sync: true } };
    s.clickSnapshot(0);
    s.captureHome();
    robot(s, 1, { personality: 'chaotic', variables: ['legato', 'rhythm', 'noteDensity'], rateNum: 1, rateDen: 8 });
    robot(s, 2, { personality: 'drunk', variables: ['patternGroup'], rateNum: 1, rateDen: 1 });
    s.addRule(rule({ when: { kind: 'cycle', voice: -1, cycle: 'rhythm' }, then: { kind: 'snapshot', index: 0 } }));
    s.addRule(rule({ when: { kind: 'interval', num: 2, den: 1 }, then: { kind: 'returnHome', immediate: false } }));
    s.start();
    run(s, 384 * 16, 37);
    s.stop();
    const open = new Map<string, number>();
    for (const n of notes) {
      const k = `${n.ch}:${n.pitch}`;
      open.set(k, (open.get(k) ?? 0) + (n.on ? 1 : -1));
      if (!n.on) open.set(k, Math.max(0, open.get(k)!));
    }
    expect([...open.values()].every((x) => x === 0)).toBe(true);
    expect(notes.filter((n) => n.on).length).toBeGreaterThan(20);
  });
  it('rules only act while Extended is on and the music plays', () => {
    const s = mk();
    s.addRule(rule({ when: { kind: 'variableAt', variable: 'noteDensity', position: 3 }, then: { kind: 'setPosition', variable: 'legato', position: 5 } }));
    const lg = act(s, 'legato');
    s.clickPosition('noteDensity', 3);
    expect(act(s, 'legato')).toBe(lg);
  });
});

function defaultRuleLike(): Rule {
  return rule({ when: { kind: 'homeReached' }, then: { kind: 'returnHome', immediate: false } });
}

// ============================================================================ Home / Return

describe('Home and Return', () => {
  it('capture stores every Variable and the Baton; distance counts the included ones', () => {
    const s = mk();
    s.captureHome();
    const h = s.comp.extended.home;
    expect(Object.keys(h.positions!).length).toBe(11);
    expect(h.baton).toEqual(s.comp.conducting.baton);
    expect(s.conductor.distance()).toBe(0);
    s.clickPosition('patternGroup', 1); // not included by default
    expect(s.conductor.distance()).toBe(0);
    s.setHomeInclude('patternGroup', true);
    expect(s.conductor.distance()).toBe(1);
    s.clearHome();
    expect(s.comp.extended.home.positions).toBeNull();
  });
  it('paths go by musical value, through eligible in-between Positions; categorical Variables in one step', () => {
    const c = defaultComposition();
    c.noteDensity.positions = [10, 100, 40, 70, 55, 5].map((x) => [x, x, x, x]);
    const w = cleanWeights({});
    expect(returnPath(c, w, 'noteDensity', 0, 1)).toEqual([2, 4, 3, 1]); // 10 → 40 → 55 → 70 → 100
    expect(returnPath(c, w, 'noteDensity', 1, 5)).toEqual([3, 4, 2, 0, 5]);
    w.noteDensity[4] = 0;
    expect(returnPath(c, w, 'noteDensity', 0, 1)).toEqual([2, 3, 1]);
    expect(returnPath(c, w, 'orchestration', 4, 1)).toEqual([1]);
    expect(returnPath(c, w, 'noteDensity', 3, 3)).toEqual([]);
    w.noteDensity[1] = 0; // Home itself is always allowed
    expect(returnPath(c, w, 'noteDensity', 0, 1).at(-1)).toBe(1);
  });
  it('immediate Return: everything Home at once (at the quantization point when playing)', () => {
    const s = mk();
    s.captureHome();
    const home = { ...s.comp.extended.home.positions };
    s.clickPosition('noteDensity', 4);
    s.clickPosition('rhythm', 3);
    s.clickPosition('transposition', 5);
    s.returnHome(true); // stopped: at once
    expect([act(s, 'noteDensity'), act(s, 'rhythm'), act(s, 'transposition')]).toEqual([home.noteDensity, home.rhythm, home.transposition]);
    s.comp.quantization = 1;
    s.start();
    run(s, 100);
    s.clickPosition('noteDensity', 4);
    s.returnHome(true);
    run(s, 380);
    expect(act(s, 'noteDensity')).toBe(4);
    run(s, 385);
    expect(act(s, 'noteDensity')).toBe(home.noteDensity);
  });
  it('gradual Return: step by step over the duration (musical time), never all at once, completing at the end', () => {
    const c = demoComposition(4);
    c.noteDensity.positions = [100, 80, 60, 40, 20, 10].map((x) => [x, x, x, x]);
    const s = mk(4, c);
    s.clickPosition('noteDensity', 0);
    s.clickPosition('legato', 0);
    s.captureHome();
    s.clickPosition('noteDensity', 5);
    s.start();
    run(s, 50);
    s.setReturnSettings({ num: 1, den: 1 }); // one bar
    s.returnHome();
    expect(s.conductor.ret).not.toBeNull();
    const seen: number[] = [];
    for (let t = 60; t <= 600; t += 12) {
      run(s, t, 12);
      if (seen.at(-1) !== act(s, 'noteDensity')) seen.push(act(s, 'noteDensity'));
    }
    expect(seen).toEqual([5, 4, 3, 2, 1, 0]); // 10 → 20 → 40 → 60 → 80 → 100
    expect(s.conductor.ret).toBeNull();
    const steps = s.conductor.log.filter((l) => l.text.startsWith("RET") || l.text.startsWith("HOME")).map((l) => l.tick);
    expect(steps.length).toBe(5);
    expect(steps[4]).toBe(96 + 384); // the last lands at the end (Return begins at the next beat)
    expect(new Set(steps).size).toBe(5);
  });
  it('Robots leave Returning Variables alone, then rest at Home and move on', () => {
    const s = mk();
    s.captureHome();
    robot(s, 1, { personality: 'orbit', variables: ['noteDensity'], rateNum: 1, rateDen: 8 });
    s.setReturnSettings({ num: 2, den: 1, rest: 2 });
    s.start();
    run(s, 48 * 5 + 1);
    s.returnHome();
    const r = s.conductor.ret!;
    const during: number[] = [];
    while (s.conductor.ret) {
      run(s, s.engine.tick + 24, 24);
      if (s.conductor.ret) during.push(...moves(s, 1).filter((t) => t > r.start));
    }
    expect(during).toEqual([]);
    expect(act(s, 'noteDensity')).toBe(s.comp.extended.home.positions!.noteDensity);
    const done = s.conductor.log.find((l) => l.text === 'Return complete')!.tick;
    run(s, done + 48 * 5);
    const first = moves(s, 1).find((t) => t >= done)!;
    // it rests two of its decisions (at or after the end of the Return), then moves on from Home
    expect(first - done).toBeGreaterThanOrEqual(2 * 48);
    expect(first - done).toBeLessThanOrEqual(3 * 48);
    expect(logOf(s).find((l) => l.startsWith(`${first} R2`))).toBe(`${first} R2 ${s.comp.extended.home.positions!.noteDensity! + 1}→${s.comp.extended.home.positions!.noteDensity! + 2} Dens`);
  });
  it('a hand during Return is taken into account; the Return still finishes at its end', () => {
    const c = demoComposition(4);
    c.noteDensity.positions = [100, 80, 60, 40, 20, 10].map((x) => [x, x, x, x]);
    const s = mk(4, c);
    s.clickPosition('noteDensity', 0);
    s.captureHome();
    s.clickPosition('noteDensity', 5);
    s.start();
    s.setReturnSettings({ num: 1, den: 1 });
    s.returnHome();
    run(s, 200);
    s.clickPosition('noteDensity', 5);
    run(s, 384 + 96 + 1);
    expect(act(s, 'noteDensity')).toBe(0);
    expect(s.conductor.ret).toBeNull();
  });
  it('Return again while returning cancels it; a stopped Return is immediate', () => {
    const s = mk();
    s.captureHome();
    s.clickPosition('noteDensity', 4);
    s.start();
    s.returnHome();
    expect(s.conductor.ret).not.toBeNull();
    s.returnHome();
    expect(s.conductor.ret).toBeNull();
    s.stop();
    s.returnHome();
    expect(act(s, 'noteDensity')).toBe(s.comp.extended.home.positions!.noteDensity);
  });
  it('the M Baton robot is held off Returning Variables, and the Baton goes Home afterwards', () => {
    const s = mk();
    s.comp.conducting.robot = { enabled: true, hRange: 1, vRange: 1, rate: 8 };
    s.comp.conducting.arrows.noteDensity = { enabled: true, dir: 'right' };
    s.captureHome();
    s.start();
    run(s, 300);
    s.returnHome();
    const r = s.conductor.ret!;
    while (s.conductor.ret) run(s, s.engine.tick + 24, 24);
    expect(act(s, 'noteDensity')).toBe(s.comp.extended.home.positions!.noteDensity);
    expect(s.comp.conducting.baton).toEqual(s.comp.extended.home.baton);
    expect(r.end).toBeGreaterThan(r.start);
  });
  it('external clock: a Return is the same in ticks at any incoming tempo', () => {
    const go = (bpm: number) => {
      const s = mk(4);
      s.comp.midi.clockIn.enabled = true;
      s.captureHome();
      s.clickPosition('noteDensity', 5);
      s.clickPosition('legato', 4);
      s.midiIn('x', [0xfa], 0);
      const per = 60000 / (bpm * 24);
      for (let i = 0; i < 48; i++) s.midiIn('x', [0xf8], i * per);
      s.returnHome();
      run(s, 1200);
      return logOf(s);
    };
    expect(go(90)).toEqual(go(150));
  });
  it('Home and Return settings are saved and loaded', () => {
    const s = mk();
    s.clickPosition('noteDensity', 3);
    s.captureHome();
    s.setHomeInclude('soundChoice', true);
    s.setReturnSettings({ num: 3, den: 2, immediate: true, rest: 4 });
    const back = deserialize(serialize(s.comp)).composition.extended;
    expect(back.home).toEqual(s.comp.extended.home);
    expect(back.returnSettings).toEqual({ num: 3, den: 2, immediate: true, rest: 4 });
    expect(homeDistance(s.comp, back.weights, back.home).total).toBe(0);
    expect(captureHome(s.comp, defaultHome()).include.patternGroup).toBe(false);
  });
});

// ============================================================================ persistence / Undo

describe('persistence and Undo', () => {
  it('Robots, weights and Rules round-trip; runtime state is never saved', () => {
    const s = mk();
    robot(s, 1, { personality: 'homebody', variables: ['noteDensity', 'rhythm'], rateNum: 3, rateDen: 8, home: 2 });
    s.setRobotParam(1, 'pull', 90);
    robot(s, 3, { personality: 'contrarian', variables: ['legato'], target: 1 });
    s.setWeight('rhythm', 4, 0);
    s.addRule(rule({ when: { kind: 'robotAt', robot: 1, position: 5 }, then: { kind: 'personality', robot: 2, personality: 'chaotic' }, every: 3, at: 'bar' }));
    s.start();
    run(s, 2000);
    const text = serialize(s.comp);
    expect(text).not.toContain('lastVisit');
    const back = deserialize(text).composition.extended;
    expect(back.robots).toEqual(s.comp.extended.robots);
    expect(back.weights).toEqual(s.comp.extended.weights);
    expect(back.rules).toEqual(s.comp.extended.rules);
  });
  it('definitions are undoable; Robot moves are not in the history', () => {
    const s = mk();
    s.history.commit();
    robot(s, 1, { personality: 'drunk', variables: ['noteDensity'], rateNum: 1, rateDen: 8 });
    s.history.commit();
    const depth = s.history.depth.undo;
    s.start();
    run(s, 2000);
    s.history.commit();
    expect(s.history.depth.undo).toBe(depth);
    s.stop();
    s.undo();
    expect(s.comp.extended.robots[1].enabled).toBe(false);
  });
  it('invalid stored Robots are repaired', () => {
    const r = cleanRobots([null, { personality: 'zzz', variables: ['noteDensity', 'soundChoice', 'noteDensity', 'x'], rateNum: 500, rateDen: 7, home: 9, target: 0, params: { step: 99, mode: 'sideways' } }]);
    expect(r[1]).toMatchObject({ personality: 'drunk', variables: ['noteDensity'], rateNum: 99, rateDen: 7, home: null, target: 0 });
    expect(r[1].params.step).toBe(5);
    expect(r[1].params.mode).toBe('copy');
    expect(r.length).toBe(4);
  });
});
