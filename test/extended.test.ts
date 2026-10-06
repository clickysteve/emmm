import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '../src/app/session';
import { demoComposition } from '../src/engine/defaults';
import { MEngine, type NoteOnEvent } from '../src/engine/engine';
import { ClockFollower } from '../src/extended/extended';

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
    s.comp.extended.learn[0].source = { type: 'cc', channel: 1, number: 20 };
    s.midiIn('x', [0xb0, 20, 127], 0);
    expect(s.comp.patternGroup.active).toBe(0);
  });
  it('clock messages are ignored in Classic mode', () => {
    const s = mk();
    s.comp.extended.clockIn.enabled = true; // but extended.enabled is false
    s.midiIn('x', [0xfa], 0);
    expect(s.engine.state).toBe('stopped');
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
    const idx = s.comp.extended.learn.findIndex((m) => m.target.kind === 'variable' && m.target.variable === 'transposition');
    s.learnArmed = idx;
    s.midiIn('x', [0xb2, 21, 0], 0);
    expect(s.comp.extended.learn[idx].source).toEqual({ type: 'cc', channel: 3, number: 21 });
    s.midiIn('x', [0xb2, 21, 127], 0);
    expect(s.comp.transposition.active).toBe(5);
    s.midiIn('x', [0xb2, 21, 50], 0);
    expect(s.comp.transposition.active).toBe(2);
  });
  it('a learnt key triggers Start on its rising edge', () => {
    const s = mk();
    s.comp.extended.enabled = true;
    const idx = s.comp.extended.learn.findIndex((m) => m.target.kind === 'start');
    s.comp.extended.learn[idx].source = { type: 'note', channel: 10, number: 36 };
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
    expect(f.expectedTick()).toBe(120);
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
    s.comp.extended.enabled = true;
    s.comp.extended.clockIn.enabled = true;
    s.midiIn('x', [0xfa], 0);
    expect(s.engine.state).toBe('playing');
    s.midiIn('x', [0xfc], 0);
    expect(s.engine.state).toBe('stopped');
  });
});
