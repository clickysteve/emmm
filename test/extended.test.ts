import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '../src/app/session';
import { demoComposition } from '../src/engine/defaults';
import { MEngine, type NoteOnEvent } from '../src/engine/engine';
import { ClockFollower } from '../src/midi/clockIn';

let sessions: Session[] = [];
const mk = () => {
  const s = new Session(demoComposition(77));
  sessions.push(s);
  return s;
};
afterEach(() => {
  sessions.forEach((s) => s.stop());
  sessions = [];
});

describe('EXTENDED is inert unless enabled', () => {
  it('controllers do nothing in Classic mode', () => {
    const s = mk();
    s.learn.push({ target: { kind: 'variable', variable: 'patternGroup' }, source: { type: 'cc', channel: 1, number: 20 } });
    s.midiIn('x', [0xb0, 20, 127], 0);
    expect(s.comp.patternGroup.active).toBe(0);
  });
  it('MIDI clock input is not Extended: it follows Start with Extended off, and is ignored only when switched off', () => {
    const s = mk();
    expect(s.comp.extended.enabled).toBe(false);
    s.midiIn('x', [0xfa], 0); // clock input off (the default): ignored
    expect(s.engine.state).toBe('stopped');
    s.comp.midi.clockIn.enabled = true;
    s.midiIn('x', [0xfa], 0);
    expect(s.engine.state).toBe('playing');
  });
  it('Classic note output is identical whatever the Extended settings', () => {
    const sig = (mutate: (c: ReturnType<typeof demoComposition>) => void) => {
      const c = demoComposition(5);
      mutate(c);
      const e = new MEngine(c);
      e.start();
      return e
        .render(3000)
        .filter((x): x is NoteOnEvent => x.kind === 'on')
        .map((x) => `${x.tick}:${x.pitch}:${x.velocity}`)
        .join();
    };
    expect(sig((c) => (c.extended.enabled = true))).toBe(sig(() => {}));
  });
});

describe('MIDI Learn', () => {
  it('learns a controller and maps its value onto six Positions', () => {
    const s = mk();
    s.comp.extended.enabled = true;
    s.armLearn({ kind: 'variable', variable: 'transposition' });
    s.midiIn('x', [0xb2, 21, 0], 0);
    expect(s.learn).toEqual([{ target: { kind: 'variable', variable: 'transposition' }, source: { type: 'cc', channel: 3, number: 21 } }]);
    s.midiIn('x', [0xb2, 21, 127], 0);
    expect(s.comp.transposition.active).toBe(5);
    s.midiIn('x', [0xb2, 21, 50], 0);
    expect(s.comp.transposition.active).toBe(2);
  });
  it('a learnt key triggers Start on its rising edge', () => {
    const s = mk();
    s.comp.extended.enabled = true;
    s.learn.push({ target: { kind: 'start' }, source: { type: 'note', channel: 10, number: 36 } });
    s.midiIn('x', [0x99, 36, 100], 0);
    expect(s.engine.state).toBe('playing');
  });
});

describe('MIDI clock input', () => {
  it('estimates tempo from 24 ppq pulses', () => {
    const f = new ClockFollower();
    let bpm: number | null = null;
    const msPerPulse = 60000 / (100 * 24); // 100 bpm
    for (let i = 0; i < 30; i++) bpm = f.pulse(i * msPerPulse) ?? bpm;
    expect(bpm).toBeCloseTo(100, 6);
    // MIDI: the first clock after Start is the downbeat (tick 0); the 30th is at 29 × 4
    expect(f.expectedTick()).toBe(116);
  });
  it('phase correction speeds up when behind and slows when ahead (bounded)', () => {
    const f = new ClockFollower();
    for (let i = 0; i < 48; i++) f.pulse(i * 10); // 2 beats received → expected tick 192
    expect(f.corrected(120, 96)).toBeGreaterThan(120);
    expect(f.corrected(120, 400)).toBeLessThan(120);
    expect(f.corrected(120, -10000)).toBeLessThanOrEqual(120 * 1.15 + 1e-9);
  });
  it('Start / Stop messages drive the transport when enabled', () => {
    const s = mk();
    s.comp.midi.clockIn.enabled = true;
    s.midiIn('x', [0xfa], 0);
    expect(s.engine.state).toBe('playing');
    s.midiIn('x', [0xfc], 0);
    // MIDI Stop halts (notes off) and keeps the place for a Continue; it is not emmm's Stop
    expect(s.playing).toBe(false);
    expect(s.extHalted).toBe(true);
  });
});

describe('CC Cycles', () => {
  it('send a controller before each played note, cycling, only in Extended mode', () => {
    const s = mk();
    const sent: [number, number[]][] = [];
    (s as unknown as { send: (c: number, b: number[]) => void }).send = (c, b) => sent.push([c, b]);
    s.comp.voices.forEach((v, i) => (v.playEnable = i === 0));
    s.comp.extended.ccCycles.active = 1; // ramp 0,32,64,96,127,96,64,32 on CC74
    s.start();
    s.emitNow(s.engine.render(96 * 3));
    expect(sent.filter((x) => (x[1][0] & 0xf0) === 0xb0)).toHaveLength(0); // Classic: nothing
    s.stop();
    s.comp.extended.enabled = true;
    sent.length = 0;
    s.start();
    s.emitNow(s.engine.render(96 * 4));
    const cc = sent.filter((x) => (x[1][0] & 0xf0) === 0xb0).map((x) => [x[1][1], x[1][2]]);
    expect(cc.slice(0, 5)).toEqual([[74, 0], [74, 32], [74, 64], [74, 96], [74, 127]]);
  });
  it('save/load keeps CC Cycle lengths', async () => {
    const { serialize, deserialize } = await import('../src/persistence/format');
    const c = demoComposition(1);
    c.extended.ccCycles.positions[2][1].cycle = [{ lo: 1, hi: 3 }];
    expect(deserialize(serialize(c)).composition.extended.ccCycles.positions[2][1].cycle).toEqual([{ lo: 1, hi: 3 }]);
  });
});
