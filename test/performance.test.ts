/**
 * EXTENDED performance features: Seed / Reroll, Locks, Mutation, A/B states, expanded MIDI
 * Learn (an application preference), MIDI clock sync status — and the persistence split.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Prefs, type PrefStore } from '../src/app/prefs';
import { Session } from '../src/app/session';
import { demoComposition } from '../src/engine/defaults';
import { MEngine, type NoteOnEvent } from '../src/engine/engine';
import { allLearnTargets, cleanLearnMappings, ClockFollower, CLOCK_LOST_MS, defaultLocks, learnInto, targetKey, type LearnMapping } from '../src/extended/extended';
import { mutate, mutationRng } from '../src/extended/mutation';
import { capturePerfState } from '../src/extended/perfState';
import { deserialize, FORMAT_VERSION, onLegacyLearn, serialize } from '../src/persistence/format';

let sessions: Session[] = [];
/** The demo with some randomness in it (thinned, partly random order), so seeds matter. */
function randomDemo(seed: number) {
  const c = demoComposition(seed);
  c.noteDensity.positions[c.noteDensity.active] = [70, 70, 70, 70];
  c.noteOrder.positions[c.noteOrder.active] = [0, 1, 2, 3].map(() => ({ original: 30, cyclic: 20 }));
  return c;
}

function mk(seed = 4242): Session {
  const s = new Session(randomDemo(seed));
  s.comp.extended.enabled = true;
  sessions.push(s);
  return s;
}
afterEach(() => {
  sessions.forEach((s) => s.stop());
  sessions = [];
});

const notes = (s: Session, to: number) =>
  s.engine
    .render(to)
    .filter((x): x is NoteOnEvent => x.kind === 'on')
    .map((x) => `${x.voice}:${x.tick.toFixed(2)}:${x.pitch}:${x.velocity}`);

function memStore(): PrefStore & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

describe('Seed / Reroll', () => {
  it('same document + same seed = same performance', () => {
    const a = mk(7);
    const b = mk(7);
    a.start();
    b.start();
    expect(notes(a, 4000)).toEqual(notes(b, 4000));
  });
  it('Reroll changes the random choices but not the Patterns or settings', () => {
    const s = mk(7);
    const before = structuredClone(s.comp.patternGroups);
    s.start();
    const first = notes(s, 4000);
    s.stop();
    s.reroll(123456);
    expect(s.comp.seed).toBe(123456);
    expect(s.comp.patternGroups).toEqual(before);
    s.start();
    expect(notes(s, 4000)).not.toEqual(first);
  });
  it('a locked Voice keeps its random stream through a Reroll (reproducibly, from Start)', () => {
    const voice = (s: Session, v: number) => notes(s, 6000).filter((n) => n.startsWith(v + ':'));
    const s = mk(7);
    s.start();
    const v0 = voice(s, 0);
    s.stop();
    s.comp.extended.locks.voices[0] = true;
    s.reroll(999);
    expect(s.comp.extended.voiceSeeds).toEqual([7, null, null, null]);
    s.start();
    expect(voice(s, 0)).toEqual(v0);
    // saved and reloaded, it still plays the same
    const t = new Session(deserialize(serialize(s.comp)).composition);
    sessions.push(t);
    t.start();
    expect(voice(t, 0)).toEqual(v0);
  });
  it('per-voice seeds are ignored in Classic (Extended off)', () => {
    const plain = mk(7);
    const stale = mk(7);
    plain.comp.extended.enabled = false;
    stale.comp.extended.enabled = false;
    stale.comp.extended.voiceSeeds = [1, 2, 3, 4]; // overrides left over, Extended off
    plain.start();
    stale.start();
    expect(notes(stale, 3000)).toEqual(notes(plain, 3000));
    // with Extended on they do apply
    const ref = mk(7);
    const on = mk(7);
    on.comp.extended.voiceSeeds = [1, 2, 3, 4];
    ref.start();
    on.start();
    expect(notes(on, 3000)).not.toEqual(notes(ref, 3000));
  });
  it('Reroll while playing switches unlocked voices at once, without restarting', () => {
    const s = mk(7);
    s.start();
    s.emitNow(s.engine.render(500));
    const tick = s.engine.tick;
    s.reroll(31337);
    expect(s.engine.state).toBe('playing');
    expect(s.engine.tick).toBe(tick);
  });
});

describe('Mutation', () => {
  it('is deterministic for the same document, seed and count', () => {
    const run = () => {
      const c = demoComposition(3);
      mutate(c, 60, defaultLocks(), mutationRng(c.seed, 0));
      return JSON.stringify(c);
    };
    expect(run()).toBe(run());
  });
  it('never touches Pattern notes, routing, Snapshots or options', () => {
    const c = demoComposition(3);
    const before = structuredClone(c);
    for (let i = 0; i < 20; i++) mutate(c, 100, defaultLocks(), mutationRng(c.seed, i));
    c.patternGroups.forEach((g, gi) => g.patterns.forEach((p, v) => expect([...p.steps].map((x) => x.join()).sort()).toEqual([...before.patternGroups[gi].patterns[v].steps].map((x) => x.join()).sort())));
    expect(c.patternGroups.map((g) => g.patterns.map((p) => p.steps))).toEqual(before.patternGroups.map((g) => g.patterns.map((p) => p.steps)));
    expect(c.midi).toEqual(before.midi);
    expect(c.snapshots).toEqual(before.snapshots);
    expect(c.options).toEqual(before.options);
  });
  it('respects dimension locks and Voice locks', () => {
    const c = demoComposition(3);
    const before = structuredClone(c);
    const locks = defaultLocks();
    locks.dims.noteDensity = true;
    locks.dims.rhythm = true;
    locks.dims.positions = true;
    locks.voices[2] = true;
    for (let i = 0; i < 30; i++) {
      const r = mutate(c, 100, locks, mutationRng(c.seed, i));
      expect(r.positions).toEqual([]);
      expect(r.changed).not.toContain('noteDensity');
    }
    expect(c.noteDensity).toEqual(before.noteDensity);
    expect(c.rhythm).toEqual(before.rhythm);
    for (const k of ['velocityRange', 'noteOrder', 'transposition', 'legato', 'accent'] as const) expect(c[k].positions[c[k].active][2]).toEqual(before[k].positions[before[k].active][2]);
  });
  it('subtle changes less than chaos', () => {
    const distance = (amount: number) => {
      let d = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const c = demoComposition(seed);
        const b = structuredClone(c);
        mutate(c, amount, defaultLocks(), mutationRng(seed, 0));
        d += c.noteDensity.positions[c.noteDensity.active].reduce((a, x, v) => a + Math.abs(x - b.noteDensity.positions[b.noteDensity.active][v]), 0);
        d += c.transposition.positions[c.transposition.active].reduce((a, x, v) => a + Math.abs(x - b.transposition.positions[b.transposition.active][v]), 0);
      }
      return d;
    };
    expect(distance(5)).toBeLessThan(distance(95) / 2);
  });
  it('through the Session: one Undo step, and Undo brings the old settings back', () => {
    const s = mk();
    s.comp.extended.mutation.amount = 100;
    s.history.commit();
    const before = s.docState();
    s.mutateNow();
    expect(s.docState()).not.toBe(before);
    s.undo();
    expect(s.docState()).toBe(before);
  });
  it('mutating while playing keeps MIDI valid and every note gets its note-off', () => {
    const s = mk();
    const sent: number[][] = [];
    (s as unknown as { send: (c: number, b: number[]) => void }).send = (_c, b) => sent.push([...b]);
    s.comp.extended.mutation.amount = 90;
    s.start();
    for (let t = 200; t <= 3000; t += 200) {
      s.emitNow(s.engine.render(t));
      s.mutateNow();
    }
    s.stop();
    const open = new Map<string, number>();
    for (const m of sent) {
      expect(m.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)).toBe(true);
      const k = `${m[0] & 15}:${m[1]}`;
      if ((m[0] & 0xf0) === 0x90 && m[2] > 0) open.set(k, (open.get(k) ?? 0) + 1);
      if ((m[0] & 0xf0) === 0x80) open.set(k, (open.get(k) ?? 0) - 1);
    }
    expect([...open.values()].every((n) => n <= 0)).toBe(true);
  });
});

describe('A/B performance states', () => {
  it('capture and recall the playing state, not notes, routing or the palette', () => {
    const s = mk();
    s.abCapture('a');
    const pattern0 = structuredClone(s.pattern(0).steps);
    s.clickPosition('transposition', 3);
    s.comp.noteDensity.positions[0][1] = 7;
    s.setTempo(150);
    s.comp.midi.outputs[0].port = 'routing-stays';
    s.abCapture('b');
    s.abRecall('a');
    expect(s.comp.transposition.active).toBe(0);
    expect(s.comp.noteDensity.positions[0][1]).not.toBe(7);
    expect(s.comp.midi.outputs[0].port).toBe('routing-stays');
    expect(s.pattern(0).steps).toEqual(pattern0);
    s.abRecall('b');
    expect(s.comp.transposition.active).toBe(3);
    expect(s.comp.tempo.value).toBe(150);
    s.abToggle();
    expect(s.comp.extended.ab.last).toBe('a');
    const keys = Object.keys(capturePerfState(s.comp));
    expect(keys).not.toContain('midi');
    expect(keys).not.toContain('patternGroups');
    expect(JSON.stringify(capturePerfState(s.comp))).not.toMatch(/palette|"steps"/);
  });
  it('recall is safe during playback (valid output, no restart)', () => {
    const s = mk();
    s.abCapture('a');
    s.clickPosition('rhythm', 2);
    s.setTimeBase(1, 1, 16);
    s.start();
    s.emitNow(s.engine.render(400));
    s.abRecall('a');
    expect(s.engine.state).toBe('playing');
    expect(() => s.emitNow(s.engine.render(2000))).not.toThrow();
    expect(s.comp.rhythm.active).toBe(0);
  });
  it('a Pattern Group change is performed the M way (through the Pattern Group Position)', () => {
    const s = mk();
    s.abCapture('a');
    s.clickPosition('patternGroup', 1);
    s.abRecall('a');
    expect(s.comp.patternGroup.active).toBe(0);
  });
});

describe('MIDI Learn (expanded)', () => {
  it('offers transport, Variables, every Position, conducting, Voices, all Snapshots and the Extended actions', () => {
    const all = allLearnTargets().flatMap((g) => g.targets);
    const kinds = new Set(all.map((t) => t.kind));
    for (const k of ['start', 'stop', 'pause', 'sync', 'holdDo', 'tempo', 'variable', 'position', 'batonX', 'batonY', 'playEnable', 'snapshot', 'mutate', 'mutationAmount', 'reroll', 'abRecall', 'abCapture', 'abToggle']) expect(kinds.has(k as never)).toBe(true);
    expect(all.filter((t) => t.kind === 'snapshot')).toHaveLength(26);
    expect(new Set(all.map(targetKey)).size).toBe(all.length);
  });
  it('a key on a Position target selects that Position; a CC on Mutation amount sets it', () => {
    const s = mk();
    s.armLearn({ kind: 'position', variable: 'noteOrder', position: 4 });
    s.midiIn('x', [0x90, 48, 100], 0); // learnt — and not triggered by the teaching press
    expect(s.comp.noteOrder.active).toBe(0);
    s.midiIn('x', [0x80, 48, 0], 0);
    s.midiIn('x', [0x90, 48, 100], 0);
    expect(s.comp.noteOrder.active).toBe(4);
    s.armLearn({ kind: 'mutationAmount' });
    s.midiIn('x', [0xb0, 30, 0], 0);
    s.midiIn('x', [0xb0, 30, 127], 0);
    expect(s.comp.extended.mutation.amount).toBe(100);
  });
  it('Mutate, Reroll, A/B, Pause from controllers', () => {
    const s = mk();
    s.learn.push(
      { target: { kind: 'abCapture', slot: 'a' }, source: { type: 'note', channel: 1, number: 60 } },
      { target: { kind: 'mutate' }, source: { type: 'note', channel: 1, number: 61 } },
      { target: { kind: 'abRecall', slot: 'a' }, source: { type: 'note', channel: 1, number: 62 } },
      { target: { kind: 'reroll' }, source: { type: 'note', channel: 1, number: 63 } },
    );
    const press = (n: number) => (s.midiIn('x', [0x90, n, 100], 0), s.midiIn('x', [0x80, n, 0], 0));
    s.comp.extended.mutation.amount = 100;
    press(60);
    const captured = JSON.stringify(capturePerfState(s.comp));
    press(61);
    press(62);
    expect(JSON.stringify(capturePerfState(s.comp))).toBe(captured);
    const seed = s.comp.seed;
    press(63);
    expect(s.comp.seed).not.toBe(seed);
  });
  it('one source drives one target: learning it elsewhere moves it (conflict handling)', () => {
    const list: LearnMapping[] = [];
    const src = { type: 'cc' as const, channel: 1, number: 7 };
    expect(learnInto(list, { kind: 'tempo' }, src, null)).toBeNull();
    expect(learnInto(list, { kind: 'batonX' }, src, null)).toBe('Tempo (in range)');
    expect(list).toEqual([{ target: { kind: 'batonX' }, source: src }]);
    // re-learn a row in place
    learnInto(list, { kind: 'batonX' }, { type: 'cc', channel: 2, number: 9 }, 0);
    expect(list).toEqual([{ target: { kind: 'batonX' }, source: { type: 'cc', channel: 2, number: 9 } }]);
  });
  it('remove and cancel', () => {
    const s = mk();
    s.armLearn({ kind: 'sync' });
    s.cancelLearn();
    s.midiIn('x', [0xb0, 5, 64], 0);
    expect(s.learn).toEqual([]);
    s.learn.push({ target: { kind: 'sync' }, source: { type: 'cc', channel: 1, number: 5 } });
    s.removeLearn(0);
    expect(s.learn).toEqual([]);
  });
  it('mappings persist as an application preference and are validated', () => {
    const store = memStore();
    const p = new Prefs(store);
    p.app.learn.push({ target: { kind: 'snapshot', index: 25 }, source: { type: 'note', channel: 16, number: 127 } });
    p.saveApp();
    expect(new Prefs(store).app.learn).toEqual(p.app.learn);
    expect(cleanLearnMappings([{ target: { kind: 'nope' }, source: { type: 'cc', channel: 1, number: 1 } }, { target: { kind: 'stop' }, source: { type: 'cc', channel: 0, number: 1 } }, { target: { kind: 'stop' }, source: null }, 'x'])).toEqual([]);
  });
  it('does not regress normal MIDI input: unmapped notes still record / echo', () => {
    const s = mk();
    s.learn.push({ target: { kind: 'start' }, source: { type: 'note', channel: 10, number: 36 } });
    s.comp.voices[0].use = 'record';
    s.comp.voices[0].src = 0;
    const len = s.pattern(0).steps.length;
    s.midiIn('*', [0x90, 64, 90], 0);
    s.midiIn('*', [0x80, 64, 0], 1);
    expect(s.pattern(0).steps.length + s.recorders[0].counter).toBeGreaterThanOrEqual(len);
    expect(s.engine.state).toBe('stopped');
  });
});

describe('MIDI clock input: jitter, loss, recovery', () => {
  it('a jittery clock still reads the right tempo', () => {
    const f = new ClockFollower();
    const per = 60000 / (120 * 24);
    let bpm: number | null = null;
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
    for (let i = 0; i < 48; i++) bpm = f.pulse(i * per + rnd() * 2.5) ?? bpm; // ±2.5 ms jitter
    expect(bpm!).toBeGreaterThan(117);
    expect(bpm!).toBeLessThan(123);
  });
  it('follows a tempo change', () => {
    const f = new ClockFollower();
    let t = 0;
    let bpm: number | null = null;
    for (let i = 0; i < 30; i++) bpm = f.pulse((t += 60000 / (100 * 24))) ?? bpm;
    for (let i = 0; i < 30; i++) bpm = f.pulse((t += 60000 / (140 * 24))) ?? bpm;
    expect(bpm!).toBeCloseTo(140, 3);
  });
  it('status: Waiting → Running → Lost → Running again, re-aligned', () => {
    const f = new ClockFollower();
    expect(f.status(0, true)).toBe('waiting');
    const per = 60000 / (120 * 24);
    for (let i = 0; i < 30; i++) f.pulse(i * per);
    const lastT = 29 * per;
    expect(f.status(lastT + 5, true)).toBe('running');
    expect(f.status(lastT + CLOCK_LOST_MS + 1, true)).toBe('lost');
    expect(f.status(lastT + CLOCK_LOST_MS + 1, false)).toBe('waiting');
    const back = lastT + 2000;
    expect(f.pulse(back)).toBeNull(); // fresh estimate after the gap
    expect(f.recovered).toBe(true);
    f.rebase(960);
    expect(f.expectedTick()).toBe(960);
    for (let i = 1; i < 10; i++) f.pulse(back + i * per);
    expect(f.status(back + 9 * per + 1, true)).toBe('running');
  });
  it('in the Session: Internal when not following; tempo holds when the clock is lost (no runaway)', () => {
    const s = mk();
    expect(s.clockStatus()).toBe('internal');
    s.comp.extended.clockIn.enabled = true;
    s.start();
    const per = 60000 / (90 * 24);
    for (let i = 0; i < 40; i++) s.midiIn('x', [0xf8], 1000 + i * per);
    const tempo = s.comp.tempo.value;
    expect(tempo).toBeGreaterThan(75);
    expect(tempo).toBeLessThan(105);
    expect(s.clockStatus(1000 + 39 * per + 10)).toBe('running');
    expect(s.clockStatus(1000 + 39 * per + 5000)).toBe('lost');
    expect(s.comp.tempo.value).toBe(tempo);
    expect(s.engine.state).toBe('playing');
  });
  it('Continue after Stop does not double-start; Stop stops', () => {
    const s = mk();
    s.comp.extended.clockIn.enabled = true;
    s.midiIn('x', [0xfa], 0);
    s.midiIn('x', [0xfb], 1);
    expect(s.engine.state).toBe('playing');
    s.midiIn('x', [0xfc], 2);
    expect(s.engine.state).toBe('stopped');
  });
});

describe('MIDI clock output (Send Clock)', () => {
  function clocked() {
    const s = mk();
    const sent: [string, number, number | undefined][] = [];
    (s.midi as unknown as { send: (p: string, b: number[], t?: number) => boolean }).send = (p, b, t) => (sent.push([p, b[0], t]), true);
    s.comp.options.sendClock = true;
    s.comp.midi.clockPort = 'dev-a';
    return { s, sent, kinds: (port = 'dev-a') => sent.filter((x) => x[0] === port).map((x) => ({ 0xfa: 'start', 0xfb: 'continue', 0xfc: 'stop', 0xf8: 'clock' })[x[1]]) };
  }
  it('Start, clock, Stop — Stop after the pulses already queued', () => {
    const { s, sent, kinds } = clocked();
    s.start();
    s.scheduler.wake();
    s.stop();
    const k = kinds();
    expect(k[0]).toBe('start');
    expect(k.filter((x) => x === 'clock').length).toBeGreaterThan(0);
    expect(k[k.length - 1]).toBe('stop');
    const lastClock = Math.max(...sent.filter((x) => x[1] === 0xf8).map((x) => x[2] ?? 0));
    expect(sent[sent.length - 1][2]!).toBeGreaterThanOrEqual(lastClock);
    expect(k.filter((x) => x === 'start')).toHaveLength(1); // one stream
  });
  it('Pause sends Stop, resume sends Continue', () => {
    const { s, kinds } = clocked();
    s.start();
    s.pause();
    s.pause();
    expect(kinds().filter((x) => x !== 'clock')).toEqual(['start', 'stop', 'continue']);
  });
  it('a Sync while playing does not restart the clock', () => {
    const { s, kinds } = clocked();
    s.start();
    s.start(); // = Sync
    expect(kinds().filter((x) => x === 'start')).toHaveLength(1);
  });
  it('changing the device while playing stops the old one and starts the new one', () => {
    const { s, kinds } = clocked();
    s.start();
    s.scheduler.wake();
    s.comp.midi.clockPort = 'dev-b';
    (s as unknown as { pulse: (ms: number, a: boolean, b: boolean) => void }).pulse(performance.now(), false, false);
    expect(kinds('dev-a').at(-1)).toBe('stop');
    expect(kinds('dev-b').slice(0, 2)).toEqual(['start', 'clock']);
  });
  it('switching Send Clock off while playing stops the device', () => {
    const { s, kinds } = clocked();
    s.start();
    s.comp.options.sendClock = false;
    (s as unknown as { pulse: (ms: number, a: boolean, b: boolean) => void }).pulse(performance.now(), false, false);
    expect(kinds().at(-1)).toBe('stop');
    s.stop();
    expect(kinds().filter((x) => x === 'stop')).toHaveLength(1);
  });
});

describe('persistence: Classic document, Extended state, preferences', () => {
  it('format version 2 saves Extended performance state in the document', () => {
    const s = mk();
    s.comp.extended.locks.dims.accent = true;
    s.comp.extended.mutation.amount = 70;
    s.abCapture('a');
    const doc = deserialize(serialize(s.comp));
    expect(doc.version).toBe(FORMAT_VERSION);
    expect(FORMAT_VERSION).toBe(2);
    expect(doc.mode).toBe('extended');
    expect(doc.composition.extended.locks.dims.accent).toBe(true);
    expect(doc.composition.extended.mutation.amount).toBe(70);
    expect(doc.composition.extended.ab.a).toEqual(s.comp.extended.ab.a);
  });
  it('MIDI Learn and preferences are not in the document', () => {
    const s = mk();
    s.learn.push({ target: { kind: 'stop' }, source: { type: 'cc', channel: 1, number: 2 } });
    const text = serialize(s.comp);
    expect(text).not.toMatch(/"learn"|palette|"tips"|"feedback"|minorPentatonic/);
  });
  it('a version-1 document still loads; its MIDI Learn mappings are handed to the preferences once', () => {
    const v1 = JSON.parse(serialize(demoComposition(11)));
    v1.version = 1;
    delete v1.composition.extended.locks;
    delete v1.composition.extended.mutation;
    delete v1.composition.extended.voiceSeeds;
    delete v1.composition.extended.ab;
    v1.composition.extended.learn = [
      { target: { kind: 'start' }, source: { type: 'note', channel: 10, number: 36 } },
      { target: { kind: 'tempo' }, source: null },
    ];
    let adopted: unknown[] = [];
    onLegacyLearn((l) => (adopted = l));
    const doc = deserialize(JSON.stringify(v1));
    onLegacyLearn(null);
    expect(doc.version).toBe(2);
    expect('learn' in doc.composition.extended).toBe(false);
    expect(doc.composition.extended.locks).toEqual(defaultLocks());
    expect(doc.composition.extended.voiceSeeds).toEqual([null, null, null, null]);
    expect(cleanLearnMappings(adopted)).toEqual([{ target: { kind: 'start' }, source: { type: 'note', channel: 10, number: 36 } }]);
    // and it plays exactly as before
    const a = new MEngine(doc.composition);
    const b = new MEngine(demoComposition(11));
    a.start();
    b.start();
    expect(a.render(2000)).toEqual(b.render(2000));
  });
  it('editor assistance and app preferences have their own versioned stores', () => {
    const store = memStore();
    const p = new Prefs(store);
    p.editor.scale = { root: 9, scale: 'minor' };
    p.app.tips = false;
    p.app.feedback = true;
    p.saveEditor();
    p.saveApp();
    const q = new Prefs(store);
    expect(q.editor.scale).toEqual({ root: 9, scale: 'minor' });
    expect(q.app.tips).toBe(false);
    expect(q.app.feedback).toBe(true);
    expect(JSON.parse(store.data['emmm.prefs']).version).toBe(1);
    expect(new Prefs(null).app.tips).toBe(true); // no storage: defaults
  });
});
