/**
 * EXTENDED Trajectory: model, traversal, tick-exact timing, transport, Smooth, MIDI CC
 * (bounded, no duplicates), seeded randomness / Reroll, the manual-control rule, Locks, A/B,
 * Undo, persistence, Movie export — and Classic unchanged.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '../src/app/session';
import { demoComposition } from '../src/engine/defaults';
import { MEngine, type NoteOnEvent } from '../src/engine/engine';
import { Rng } from '../src/engine/rng';
import { capturePerfState } from '../src/extended/perfState';
import { cleanTrajectory, nextIndex, SMOOTH_TICKS, targetChoices, targetInfo, type Trajectory, type TrajMode } from '../src/extended/trajectory';
import { writeSmf } from '../src/midi/smf';
import { deserialize, serialize } from '../src/persistence/format';

let sessions: Session[] = [];
afterEach(() => {
  sessions.forEach((s) => s.stop());
  sessions = [];
});
function mk(seed = 11): Session {
  const s = new Session(demoComposition(seed));
  s.comp.extended.enabled = true;
  sessions.push(s);
  return s;
}
function spy(s: Session) {
  const sent: { ch: number; b: number[] }[] = [];
  (s as unknown as { send: (c: number, b: number[], ms: number) => void }).send = (ch, b) => sent.push({ ch, b: [...b] });
  return sent;
}
function set(s: Session, slot: number, t: Partial<Trajectory>) {
  s.setTrajectory(slot, { on: true, ...t });
}
/** render tick by tick, recording a value after each step boundary */
function sample(s: Session, ticks: number[], read: () => unknown): unknown[] {
  return ticks.map((t) => (s.emitNow(s.engine.render(t)), read()));
}

describe('model', () => {
  it('a typed registry: ranges, kinds, offset vs absolute', () => {
    expect(targetInfo({ kind: 'density' })).toMatchObject({ min: 0, max: 100, mode: 'absolute', perVoice: true });
    expect(targetInfo({ kind: 'transpose' })).toMatchObject({ min: -24, max: 24, mode: 'offset' });
    expect(targetInfo({ kind: 'cc', channel: 1, cc: 74 })).toMatchObject({ min: 0, max: 127, mode: 'output' });
    expect(targetInfo({ kind: 'position', variable: 'patternGroup' }).kind).toBe('enumerated');
    expect(targetChoices().map((t) => t.kind)).toContain('cc');
  });
  it('stored Trajectories are validated (ranges, rate, mode, smooth only where it can glide)', () => {
    const t = cleanTrajectory({ on: true, target: { kind: 'cc', channel: 99, cc: 300 }, values: [-5, 50, 999, 'x'], rateNum: 0, rateDen: 7.5, mode: 'sideways', smooth: true });
    expect(t.target).toEqual({ kind: 'cc', channel: 1, cc: 74 });
    expect(t.values).toEqual([0, 50, 127]);
    expect([t.rateNum, t.rateDen, t.mode]).toEqual([1, 4, 'forward']);
    expect(cleanTrajectory({ target: { kind: 'position', variable: 'rhythm' }, smooth: true }).smooth).toBe(false);
    expect(cleanTrajectory({ values: Array.from({ length: 40 }, () => 1) }).values.length).toBe(16);
  });
});

describe('traversal', () => {
  const walk = (mode: TrajMode, n: number, k: number, seed = 1) => {
    const rng = new Rng(seed, 4000);
    let i = mode === 'backward' ? n - 1 : 0;
    let dir = mode === 'backward' ? -1 : 1;
    const out = [i];
    for (let j = 0; j < k; j++) ({ i, dir } = nextIndex(mode, i, dir, n, rng)), out.push(i);
    return out;
  };
  it('forward, backward', () => {
    expect(walk('forward', 4, 6)).toEqual([0, 1, 2, 3, 0, 1, 2]);
    expect(walk('backward', 4, 6)).toEqual([3, 2, 1, 0, 3, 2, 1]);
  });
  it('ping-pong does not repeat its ends', () => {
    expect(walk('pingpong', 4, 9)).toEqual([0, 1, 2, 3, 2, 1, 0, 1, 2, 3]);
    expect(walk('pingpong', 2, 4)).toEqual([0, 1, 0, 1, 0]);
    expect(walk('pingpong', 1, 3)).toEqual([0, 0, 0, 0]);
  });
  it('random is deterministic for a seed and different for another', () => {
    expect(walk('random', 5, 20, 7)).toEqual(walk('random', 5, 20, 7));
    expect(walk('random', 5, 20, 7)).not.toEqual(walk('random', 5, 20, 8));
  });
  it('random walk moves to a neighbour each time', () => {
    const w = walk('walk', 6, 200, 3);
    for (let j = 1; j < w.length; j++) expect(Math.abs(w[j] - w[j - 1])).toBe(1);
    expect(new Set(w).size).toBeGreaterThan(3);
  });
});

describe('in the music', () => {
  it('Density 20 40 80 100 60 at 1/4, forward: one value per quarter note, looping', () => {
    const s = mk();
    set(s, 0, { target: { kind: 'density' }, values: [20, 40, 80, 100, 60], rateNum: 1, rateDen: 4 });
    s.start();
    const got = sample(s, [1, 97, 193, 289, 385, 481, 577], () => s.engine.mod.density[0]);
    expect(got).toEqual([20, 40, 80, 100, 60, 20, 40]);
    // the document's Positions are never overwritten
    expect(s.comp.noteDensity.positions[s.comp.noteDensity.active][0]).toBe(demoComposition(11).noteDensity.positions[0][0]);
  });
  it('Density really thins the notes (0 % = silence)', () => {
    const s = mk();
    const sent = spy(s);
    set(s, 0, { target: { kind: 'density' }, values: [0], voices: [true, true, true, true] });
    s.start();
    s.emitNow(s.engine.render(800));
    expect(sent.filter((m) => (m.b[0] & 0xf0) === 0x90)).toEqual([]);
  });
  it('Transposition 0 7 12 7 offsets the notes step by step', () => {
    const base = new MEngine(demoComposition(11));
    base.start();
    const plain = base.render(384 * 2).filter((e): e is NoteOnEvent => e.kind === 'on' && e.voice === 0);
    const s = mk();
    const sent = spy(s);
    set(s, 0, { target: { kind: 'transpose' }, values: [0, 7, 12, 7], voices: [true, false, false, false], rateDen: 4 });
    s.start();
    s.emitNow(s.engine.render(384 * 2));
    const ons = sent.filter((m) => (m.b[0] & 0xf0) === 0x90 && m.ch === plain[0].channel).map((m) => m.b[1]);
    const expect0 = plain.map((n) => n.pitch + [0, 7, 12, 7][Math.floor(n.tick / 96) % 4]);
    expect(ons.slice(0, expect0.length)).toEqual(expect0);
  });
  it('Smooth glides between values (0 → 100 → 20 on the Baton) at bounded resolution', () => {
    const s = mk();
    set(s, 0, { target: { kind: 'batonX' }, values: [0, 100, 20], rateDen: 4, smooth: true });
    s.start();
    const got = sample(s, [1, 25, 49, 73, 97, 145, 193], () => Math.round(s.comp.conducting.baton.x * 100));
    expect(got[0]).toBe(0);
    expect(got[2]).toBeGreaterThan(40);
    expect(got[2]).toBeLessThan(60); // half way through the step
    expect(got[4]).toBe(100);
    expect(got[5]).toBeGreaterThan(50); // gliding down to 20
    expect(got[6]).toBe(20);
  });
  it('Positions are Step only and change at step boundaries (Rhythm 1 → 3 → 2)', () => {
    const s = mk();
    set(s, 0, { target: { kind: 'position', variable: 'rhythm' }, values: [1, 3, 2], rateNum: 2, rateDen: 4 });
    s.start();
    expect(sample(s, [1, 193, 385, 577], () => s.comp.rhythm.active)).toEqual([0, 2, 1, 0]);
  });
});

describe('MIDI controller output', () => {
  const ccs = (sent: { ch: number; b: number[] }[]) => sent.filter((m) => (m.b[0] & 0xf0) === 0xb0);
  it('20 40 100 127 60 on CC74, M Output Channel 1, one message per step', () => {
    const s = mk();
    const sent = spy(s);
    set(s, 0, { target: { kind: 'cc', channel: 1, cc: 74 }, values: [20, 40, 100, 127, 60], rateDen: 4 });
    s.start();
    s.emitNow(s.engine.render(96 * 5 - 1));
    expect(ccs(sent).map((m) => [m.ch, m.b[1], m.b[2]])).toEqual([[1, 74, 20], [1, 74, 40], [1, 74, 100], [1, 74, 127], [1, 74, 60]]);
  });
  it('the same value twice in a row is sent once', () => {
    const s = mk();
    const sent = spy(s);
    set(s, 0, { target: { kind: 'cc', channel: 2, cc: 1 }, values: [64, 64, 64, 10] });
    s.start();
    s.emitNow(s.engine.render(96 * 4 - 1));
    expect(ccs(sent).map((m) => m.b[2])).toEqual([64, 10]);
  });
  it('Smooth CC is bounded: four Trajectories gliding 0↔127 every sixteenth stay ≤ one message per 6 ticks each', () => {
    const s = mk();
    const sent = spy(s);
    for (let i = 0; i < 4; i++) set(s, i, { target: { kind: 'cc', channel: i + 1, cc: 74 }, values: [0, 127], rateNum: 1, rateDen: 16, smooth: true });
    s.start();
    const ticks = 384 * 4; // four bars
    s.emitNow(s.engine.render(ticks));
    const per = [1, 2, 3, 4].map((ch) => ccs(sent).filter((m) => m.ch === ch));
    for (const p of per) {
      expect(p.length).toBeLessThanOrEqual(ticks / SMOOTH_TICKS + 1);
      for (let i = 1; i < p.length; i++) expect(p[i].b[2]).not.toBe(p[i - 1].b[2]); // no duplicates
      expect(p.every((m) => m.b[2] >= 0 && m.b[2] <= 127)).toBe(true);
    }
  });
  it('goes into the Movie (and so into the exported MIDI file)', () => {
    const s = mk();
    spy(s);
    set(s, 0, { target: { kind: 'cc', channel: 1, cc: 74 }, values: [20, 90] });
    s.toggleMovie();
    s.start();
    s.emitNow(s.engine.render(300));
    s.stop();
    const cc = s.movie.filter((m) => (m.data[0] & 0xf0) === 0xb0);
    expect(cc.map((m) => m.data[2])).toEqual([20, 90, 20, 90]);
    const smf = writeSmf(s.movie, s.movieTempos, 'x');
    const bytes = [...smf];
    const at = bytes.findIndex((b, i) => (b & 0xf0) === 0xb0 && bytes[i + 1] === 74 && bytes[i + 2] === 90);
    expect(at).toBeGreaterThan(0);
  });
});

describe('transport', () => {
  it('Start begins at the first step, Pause freezes, Continue resumes, Stop releases, Start again resets', () => {
    const s = mk();
    set(s, 0, { target: { kind: 'density' }, values: [10, 20, 30, 40] });
    s.start();
    s.emitNow(s.engine.render(97));
    expect(s.engine.mod.density[0]).toBe(20);
    s.pause();
    s.emitNow(s.engine.render(400)); // nothing moves while paused
    expect(s.engine.mod.density[0]).toBe(20);
    s.pause();
    s.emitNow(s.engine.render(s.engine.tick + 96));
    expect(s.engine.mod.density[0]).toBe(30);
    s.stop();
    expect(s.engine.mod.density[0]).toBeNull(); // released: the Position's own value again
    s.start();
    s.emitNow(s.engine.render(1));
    expect(s.engine.mod.density[0]).toBe(10);
  });
  it('switched on while playing, it joins at the next step of its own grid', () => {
    const s = mk();
    s.start();
    s.emitNow(s.engine.render(150));
    set(s, 1, { target: { kind: 'density' }, values: [5] });
    expect(s.engine.mod.density[0]).toBeNull();
    s.emitNow(s.engine.render(191));
    expect(s.engine.mod.density[0]).toBeNull();
    s.emitNow(s.engine.render(193));
    expect(s.engine.mod.density[0]).toBe(5);
    s.setTrajectory(1, { on: false });
    expect(s.engine.mod.density[0]).toBeNull();
  });
  it('follows tempo: steps are musical ticks whatever the tempo or an external clock does', () => {
    const s = mk();
    set(s, 0, { target: { kind: 'density' }, values: [10, 20] });
    s.start();
    s.setTempoExact(200);
    expect(sample(s, [1, 97, 193], () => s.engine.mod.density[0])).toEqual([10, 20, 10]);
  });
});

describe('seed, Reroll, Locks, A/B, the hand', () => {
  const path = (seed: number, reroll?: number) => {
    const s = mk(seed);
    set(s, 0, { target: { kind: 'density' }, values: [1, 2, 3, 4, 5, 6, 7, 8], mode: 'random' });
    if (reroll) s.reroll(reroll);
    s.start();
    return sample(s, Array.from({ length: 16 }, (_, i) => i * 96 + 1), () => s.engine.mod.density[0]);
  };
  it('Random: same document and seed = same path; Reroll = another', () => {
    expect(path(5)).toEqual(path(5));
    expect(path(5, 999)).not.toEqual(path(5));
    expect(path(5, 999)).toEqual(path(5, 999));
  });
  it('Locks do not stop a Trajectory (they hold back Mutate and Reroll only)', () => {
    const s = mk();
    s.comp.extended.locks.dims.noteDensity = true;
    s.comp.extended.locks.voices[0] = true;
    set(s, 0, { target: { kind: 'density' }, values: [33] });
    s.start();
    s.emitNow(s.engine.render(1));
    expect(s.engine.mod.density[0]).toBe(33);
  });
  it('A/B states do not capture Trajectories; a recall leaves them running', () => {
    const s = mk();
    set(s, 0, { target: { kind: 'density' }, values: [33, 44] });
    expect(JSON.stringify(capturePerfState(s.comp))).not.toMatch(/trajector/i);
    s.abCapture('a');
    s.start();
    s.emitNow(s.engine.render(1));
    s.abRecall('a');
    s.emitNow(s.engine.render(97));
    expect(s.engine.mod.density[0]).toBe(44);
  });
  it('the hand wins until the next step (absolute targets)', () => {
    const s = mk();
    set(s, 0, { target: { kind: 'density' }, values: [10, 20] });
    s.start();
    s.emitNow(s.engine.render(10));
    expect(s.engine.mod.density[0]).toBe(10);
    s.clickPosition('noteDensity', 3); // a hand on Note Density
    expect(s.engine.mod.density[0]).toBeNull(); // the Position the hand chose is heard
    expect(s.traj[0].held).toBe(true);
    s.emitNow(s.engine.render(97));
    expect(s.engine.mod.density[0]).toBe(20); // the Trajectory takes over again at its next step
  });
  it('the hand on Tempo wins until the next step too', () => {
    const s = mk();
    set(s, 0, { target: { kind: 'tempo' }, values: [90, 150], smooth: true });
    s.start();
    s.emitNow(s.engine.render(30));
    s.setTempo(120);
    s.emitNow(s.engine.render(90));
    expect(s.comp.tempo.value).toBe(120);
    s.emitNow(s.engine.render(97));
    expect(s.comp.tempo.value).toBe(150);
  });
});

describe('Undo, persistence, Classic', () => {
  it('editing is undoable; playback advancing never makes Undo steps', () => {
    const s = mk();
    s.history.commit();
    set(s, 0, { target: { kind: 'density' }, values: [10, 20, 30] });
    s.history.commit();
    s.setTrajectoryValue(0, 1, 77);
    s.history.commit();
    s.addTrajectoryValue(0);
    s.removeTrajectoryValue(0, 0);
    s.history.commit();
    const depth = s.history.depth.undo;
    s.start();
    s.emitNow(s.engine.render(2000));
    s.history.commit();
    expect(s.history.depth.undo).toBe(depth);
    s.undo();
    expect(s.comp.extended.trajectories[0].values).toEqual([10, 77, 30]);
    s.undo();
    expect(s.comp.extended.trajectories[0].values).toEqual([10, 20, 30]);
    s.undo();
    expect(s.comp.extended.trajectories[0].on).toBe(false);
  });
  it('add, remove, clear, duplicate (up to 16)', () => {
    const s = mk();
    set(s, 0, { target: { kind: 'cc', channel: 1, cc: 1 }, values: [1, 2, 3] });
    s.addTrajectoryValue(0, 0);
    expect(s.comp.extended.trajectories[0].values).toEqual([1, 1, 2, 3]);
    s.duplicateTrajectory(0);
    s.duplicateTrajectory(0);
    expect(s.comp.extended.trajectories[0].values.length).toBe(16);
    expect(s.addTrajectoryValue(0)).toBe(-1);
    s.clearTrajectory(0);
    expect(s.comp.extended.trajectories[0].values).toEqual([0]);
    s.removeTrajectoryValue(0, 0); // the last value stays
    expect(s.comp.extended.trajectories[0].values).toEqual([0]);
  });
  it('a new target keeps the values within its range', () => {
    const s = mk();
    set(s, 0, { target: { kind: 'cc', channel: 1, cc: 74 }, values: [0, 64, 127] });
    s.setTrajectory(0, { target: { kind: 'transpose' } });
    expect(s.comp.extended.trajectories[0].values).toEqual([0, 24, 24]);
  });
  it('saved and reloaded exactly; older documents load with four switched-off Trajectories', () => {
    const s = mk();
    set(s, 2, { target: { kind: 'cc', channel: 3, cc: 71 }, values: [5, 6], rateNum: 2, rateDen: 8, mode: 'pingpong', smooth: true });
    const back = deserialize(serialize(s.comp)).composition;
    expect(back.extended.trajectories[2]).toEqual(s.comp.extended.trajectories[2]);
    expect(back.extended.trajectories[2].values).toEqual([5, 6]); // not padded from defaults
    const old = JSON.parse(serialize(demoComposition(2)));
    old.version = 2;
    delete old.composition.extended.trajectories;
    const o = deserialize(JSON.stringify(old)).composition;
    expect(o.extended.trajectories).toHaveLength(4);
    expect(o.extended.trajectories.every((t) => !t.on && t.target.kind === 'none')).toBe(true);
  });
  it('with Extended off, Trajectories do nothing and Classic output is identical', () => {
    const notes = (setup: (s: Session) => void) => {
      const s = new Session(demoComposition(9));
      sessions.push(s);
      const sent = spy(s);
      setup(s);
      s.start();
      s.emitNow(s.engine.render(2000));
      return JSON.stringify(sent);
    };
    const plain = notes(() => {});
    const withTraj = notes((s) => {
      s.comp.extended.trajectories[0] = cleanTrajectory({ on: true, target: { kind: 'transpose' }, values: [7] });
      s.comp.extended.trajectories[1] = cleanTrajectory({ on: true, target: { kind: 'cc', channel: 1, cc: 74 }, values: [1, 2] });
    });
    expect(withTraj).toBe(plain);
  });
  it('changing the target while it runs gives the old one back (also through Undo)', () => {
    const s = mk();
    set(s, 0, { target: { kind: 'density' }, values: [30] });
    s.history.commit();
    s.start();
    s.emitNow(s.engine.render(10));
    expect(s.engine.mod.density[0]).toBe(30);
    s.setTrajectory(0, { target: { kind: 'transpose' }, values: [5] });
    s.history.commit();
    s.emitNow(s.engine.render(100));
    expect(s.engine.mod.density[0]).toBeNull();
    expect(s.engine.mod.transpose[0]).toBe(5);
    s.undo(); // back to Density
    s.emitNow(s.engine.render(200));
    expect(s.engine.mod.transpose[0]).toBe(0);
    expect(s.engine.mod.density[0]).toBe(30); // Undo brought back the Density Trajectory and its value
  });
  it('MIDI Learn can switch a Trajectory on and off', () => {
    const s = mk();
    s.learn.push({ target: { kind: 'trajToggle', slot: 3 }, source: { type: 'note', channel: 1, number: 40 } });
    s.midiIn('x', [0x90, 40, 100], 0);
    expect(s.comp.extended.trajectories[3].on).toBe(true);
  });
});
