import { describe, expect, it } from 'vitest';
import { conductAt, continuousLegatoMultiplier, continuousVelocityOffset, cellIndex } from '../src/engine/conducting';
import { cyc, defaultComposition, demoComposition, steps } from '../src/engine/defaults';
import { MEngine, type NoteOnEvent } from '../src/engine/engine';
import { InputControl, whiteIndex, CODES } from '../src/engine/inputControl';
import * as ops from '../src/engine/patternOps';
import { PatternRecorder } from '../src/engine/recorder';
import { Rng } from '../src/engine/rng';
import { captureAll, captureLike, snapshotSize } from '../src/engine/snapshots';
import { forward, inverse, sanitizePoints, unwarp, warp } from '../src/engine/timeDistortion';
import type { TimeMap } from '../src/engine/types';
import * as msg from '../src/midi/messages';
import { notesToSteps, readSmf, writeSmf } from '../src/midi/smf';
import { deserialize, serialize, FormatError } from '../src/persistence/format';
import { TickClock, msPerTick } from '../src/scheduler/clock';

const rng = () => new Rng(5);
const pitches = (p: { steps: number[][] }) => p.steps.map((s) => (s.length ? s.join('+') : '-')).join(' ');

describe('pattern operations (§15)', () => {
  it('Rotate Forward makes the first step last; Backward undoes it', () => {
    const p = ops.newPattern(steps('C3 D3 E3 F3'), rng());
    ops.rotateForward(p);
    expect(pitches(p)).toBe('62 64 65 60');
    ops.rotateBackward(p);
    expect(pitches(p)).toBe('60 62 64 65');
  });
  it('Reverse, Double and Triple with Rests, Eliminate Rests', () => {
    const p = ops.newPattern(steps('C3 D3 E3'), rng());
    ops.reverse(p);
    expect(pitches(p)).toBe('64 62 60');
    ops.withRests(p, 1, rng(), false);
    expect(pitches(p)).toBe('64 - 62 - 60 -');
    expect(p.outputLength).toBe(6);
    ops.eliminateRests(p, rng(), false);
    expect(pitches(p)).toBe('64 62 60');
    ops.withRests(p, 2, rng(), false);
    expect(p.steps.length).toBe(9);
  });
  it('Eliminate Chords splits chords into single steps', () => {
    const p = ops.newPattern(steps('[C3 E3 G3] D3'), rng());
    ops.eliminateChords(p, rng(), false);
    expect(pitches(p)).toBe('60 64 67 62');
  });
  it('region operations only affect the region', () => {
    const p = ops.newPattern(steps('C3 D3 E3 F3 G3'), rng());
    ops.transpose(p, 12, [1, 3]);
    expect(pitches(p)).toBe('60 74 76 65 67');
    ops.reverse(p, [0, 2]);
    expect(pitches(p)).toBe('74 60 76 65 67');
  });
  it('scrambled list stays a permutation through edits', () => {
    const r = rng();
    const p = ops.newPattern(steps('C3 D3 E3 F3 G3 A3'), r);
    const isPerm = () => [...p.scrambled].sort((a, b) => a - b).join() === p.steps.map((_, i) => i).join();
    expect(isPerm()).toBe(true);
    ops.insertSteps(p, 2, [[70], []], r, false);
    expect(isPerm()).toBe(true);
    ops.deleteSteps(p, [0, 5], r, false);
    expect(isPerm()).toBe(true);
    ops.eliminateChords(p, r, false);
    expect(isPerm()).toBe(true);
  });
  it("Don't Scramble Rests keeps rests in place in the Cyclic Random order", () => {
    const p = ops.newPattern(steps('C3 - D3 - E3 - F3 -'), rng());
    for (let k = 0; k < 20; k++) {
      ops.rescramble(p, new Rng(k), true);
      p.scrambled.forEach((src, pos) => {
        expect(p.steps[src].length === 0).toBe(p.steps[pos].length === 0);
      });
    }
  });
  it('Swap Scrambled and Original exchanges the two orders', () => {
    const p = ops.newPattern(steps('C3 D3 E3 F3'), rng());
    p.scrambled = [2, 0, 3, 1];
    ops.swapScrambledAndOriginal(p);
    expect(pitches(p)).toBe('64 60 65 62');
    // the old original order is now reached through the scrambled list
    expect(p.scrambled.map((i) => p.steps[i][0])).toEqual([60, 62, 64, 65]);
  });
  it('Output Length with the modifier adds rests or deletes from the end', () => {
    const p = ops.newPattern(steps('C3 D3'), rng());
    ops.setLengthWithRests(p, 4, rng(), false);
    expect(pitches(p)).toBe('60 62 - -');
    ops.setLengthWithRests(p, 1, rng(), false);
    expect(pitches(p)).toBe('60');
  });
  it('clicking past the end pads with rests', () => {
    const p = ops.newPattern(steps('C3'), rng());
    ops.togglePitch(p, 3, 67, rng(), false);
    expect(pitches(p)).toBe('60 - - 67');
    expect(p.outputLength).toBe(4);
  });
});

describe('time distortion (§8)', () => {
  const m: TimeMap = { points: [[0.25, 0.75]], count: 1, unit: 4 }; // 96 ticks
  it('forward and inverse are inverses', () => {
    for (const r of [0, 0.1, 0.25, 0.6, 1]) expect(inverse(m, forward(m, r))).toBeCloseTo(r, 9);
  });
  it('warp: a steep start crowds events early; the period is preserved', () => {
    // clock 72 (= 0.75 of 96) happens at real 24 (= 0.25)
    expect(warp(m, 72)).toBeCloseTo(24);
    expect(warp(m, 96)).toBeCloseTo(96);
    expect(warp(m, 96 + 72)).toBeCloseTo(96 + 24);
    expect(unwarp(m, warp(m, 50))).toBeCloseTo(50);
  });
  it('a swing map delays the middle eighth note', () => {
    const c = defaultComposition();
    c.patternGroups[0].patterns[0] = ops.newPattern(steps('C3'), rng());
    c.patternGroups[0].patterns[0].tbDen = 8;
    c.voices.forEach((v, i) => (v.playEnable = i === 0));
    c.timeDistortion.positions[0][0] = { points: [[2 / 3, 0.5]], count: 1, unit: 4 };
    const e = new MEngine(c);
    e.start();
    const on = e.render(200).filter((x): x is NoteOnEvent => x.kind === 'on');
    expect(on.map((x) => Math.round(x.tick))).toEqual([0, 64, 96, 160, 192]);
  });
  it('sanitizePoints enforces a monotonic map', () => {
    expect(sanitizePoints([[0.5, 0.5], [0.7, 0.3], [0.8, 0.9]])).toEqual([[0.5, 0.5], [0.8, 0.9]]);
    expect(sanitizePoints([[0.9, 0.2], [0.2, 0.1]])).toEqual([[0.2, 0.1], [0.9, 0.2]]);
  });
});

describe('scheduler clock', () => {
  it('converts ticks to ms at the tempo, and tempo changes are continuous', () => {
    const c = new TickClock();
    c.reset(1000, 120);
    expect(msPerTick(120)).toBeCloseTo(500 / 96);
    expect(c.tickToMs(96)).toBeCloseTo(1500);
    c.setTempo(60, 96);
    expect(c.tickToMs(96)).toBeCloseTo(1500);
    expect(c.tickToMs(192)).toBeCloseTo(2500);
    expect(c.msToTick(2500)).toBeCloseTo(192);
  });
});

describe('MIDI messages and files', () => {
  it('encodes channel messages', () => {
    expect(msg.noteOn(1, 60, 100)).toEqual([0x90, 60, 100]);
    expect(msg.noteOff(16, 61)).toEqual([0x8f, 61, 0]);
    expect(msg.programChange(3, 5)).toEqual([0xc2, 5]);
    expect(msg.noteOn(1, 60, 0)[2]).toBe(1); // velocity 0 would be a note-off
    expect(msg.parse([0x92, 64, 0]).type).toBe('noteoff');
    expect(msg.parse([0x92, 64, 1])).toEqual({ type: 'noteon', channel: 3, data1: 64, data2: 1 });
  });
  it('writes a movie and reads it back', () => {
    const bytes = writeSmf(
      [
        { tick: 0, data: [0x90, 60, 100] },
        { tick: 48, data: [0x80, 60, 0] },
        { tick: 96, data: [0x91, 64, 90] },
        { tick: 200, data: [0x81, 64, 0] },
      ],
      [{ tick: 0, bpm: 120 }],
    );
    const f = readSmf(bytes);
    expect(f.ppq).toBe(96);
    expect(f.notes.map((n) => [n.beat, n.durBeats, n.channel, n.pitch, n.velocity])).toEqual([
      [0, 0.5, 1, 60, 100],
      [1, 104 / 96, 2, 64, 90],
    ]);
  });
  it('imports notes into steps with chords and rests (§17)', () => {
    const notes = [
      { beat: 0, durBeats: 0.5, channel: 1, pitch: 60, velocity: 90 },
      { beat: 0.01, durBeats: 0.5, channel: 1, pitch: 64, velocity: 90 },
      { beat: 0.5, durBeats: 0.5, channel: 1, pitch: 62, velocity: 90 },
      { beat: 2, durBeats: 0.5, channel: 1, pitch: 65, velocity: 90 },
      { beat: 2, durBeats: 0.5, channel: 2, pitch: 30, velocity: 90 },
    ];
    expect(notesToSteps(notes, { channels: [1], chord: 'chord', rests: 'dur', quant: 8 })).toEqual([[60, 64], [62], [], [], [65]]);
    expect(notesToSteps(notes, { channels: [1], chord: 'single', rests: 'none', quant: 8 })).toEqual([[60], [64], [62], [65]]);
  });
});

describe('persistence', () => {
  it('round-trips a composition exactly', () => {
    const c = demoComposition(4242);
    c.snapshots[2] = captureAll(c);
    c.slideshows[0] = { events: [{ tick: 0, kind: 'snapshot', index: 2 }], loopLength: 384 };
    c.soundChoice.positions[3][9] = 33;
    const back = deserialize(serialize(c)).composition;
    expect(back).toEqual(c);
  });
  it('fills missing fields from defaults (forward-compatible migration)', () => {
    const c = defaultComposition(7);
    const raw = JSON.parse(serialize(c));
    delete raw.composition.options.lockMarkedVariables;
    delete raw.composition.conducting.robot;
    raw.composition.accent.positions[0][0] = [{ lo: 2, hi: 3 }];
    const back = deserialize(JSON.stringify(raw)).composition;
    expect(back.options.lockMarkedVariables).toBe(false);
    expect(back.conducting.robot.rate).toBe(1);
    expect(back.accent.positions[0][0]).toEqual([{ lo: 2, hi: 3 }]); // not padded
  });
  it('rejects foreign or future documents and clamps bad values', () => {
    expect(() => deserialize('{"format":"other"}')).toThrow(FormatError);
    expect(() => deserialize('{"format":"emmm","version":99}')).toThrow(/newer/);
    expect(() => deserialize('nope')).toThrow(FormatError);
    const raw = JSON.parse(serialize(defaultComposition()));
    raw.composition.noteDensity.positions[0][0] = 900;
    raw.composition.tempo.value = -5;
    const back = deserialize(JSON.stringify(raw)).composition;
    expect(back.noteDensity.positions[0][0]).toBe(100);
    expect(back.tempo.value).toBe(10);
  });
  it('a saved and reloaded performance reproduces the same notes', () => {
    const c = demoComposition(31337);
    c.noteOrder.active = 3;
    c.noteDensity.active = 1;
    const sig = (comp: typeof c) => {
      const e = new MEngine(comp);
      e.start();
      return e
        .render(2000)
        .filter((x): x is NoteOnEvent => x.kind === 'on')
        .map((x) => `${x.tick.toFixed(2)}:${x.channel}:${x.pitch}:${x.velocity}`)
        .join(',');
    };
    expect(sig(deserialize(serialize(c)).composition)).toBe(sig(c));
  });
});

describe('Input Control System (§14)', () => {
  it('numbers white keys from C1 = 0 (M names MIDI 60 "C3")', () => {
    expect(whiteIndex(36)).toBe(0); // C1
    expect(whiteIndex(38)).toBe(1); // D1
    expect(whiteIndex(60)).toBe(14); // C3
    expect(whiteIndex(37)).toBeNull();
  });
  it('maps the documented one-step keys', () => {
    const ics = new InputControl();
    const one = (n: number) => {
      const a = ics.noteOn(n);
      return a.kind === 'oneStep' ? a.action : null;
    };
    expect(one(60)).toEqual({ kind: 'start' }); // middle C [DOC]
    expect(one(59)).toEqual({ kind: 'stop' }); // B2 [DOC]
    expect(one(71)).toEqual({ kind: 'holdDo' }); // B3 [DOC]
    expect(one(65)).toEqual({ kind: 'sync' }); // F3 [DOC]
    expect(one(53)).toEqual({ kind: 'tapTempo' }); // F2 [DOC]
    expect(one(84)).toEqual({ kind: 'tapConduct' }); // C5 [DOC]
    expect(one(38)).toEqual({ kind: 'playToggle', voice: 1 }); // D1 [DOC]
    expect(one(50)).toEqual({ kind: 'stepAdvance', voice: 0 }); // D2 [DOC]
    expect(one(64)).toEqual({ kind: 'stepAdvance', voice: -1 }); // E3 [DOC]
  });
  it('two-step: Transposition code A#2 then value key D1 = Position 1', () => {
    const ics = new InputControl();
    expect(ics.noteOn(58)).toEqual({ kind: 'code', code: { kind: 'variable', variable: 'transposition' } });
    expect(ics.noteOn(38)).toEqual({ kind: 'value', code: { kind: 'variable', variable: 'transposition' }, value: 1 });
    // the next white key is a one-step control again
    expect(ics.noteOn(60).kind).toBe('oneStep');
  });
  it('documented code keys are where the manual says', () => {
    expect(CODES[39]).toEqual({ kind: 'timeBase', voice: 0 }); // D#1
    expect(CODES[37]).toEqual({ kind: 'snapshot' }); // C#1
    expect(CODES[58]).toEqual({ kind: 'variable', variable: 'transposition' }); // A#2
    expect(CODES[73]).toEqual({ kind: 'snapshot' }); // C#4
    expect(CODES[75]).toEqual({ kind: 'playSlideshow' }); // D#4
    expect(CODES[78]).toEqual({ kind: 'recordSlideshow' }); // F#4
    expect(CODES[80]).toEqual({ kind: 'editSnapshot' }); // G#4
  });
});

describe('recording (§9)', () => {
  const mk = (mode: 'single' | 'chord' | 'build', ins: 'insert' | 'replace' | 'overdub' = 'insert') => {
    const p = ops.newPattern([], rng());
    p.chordMode = mode;
    p.insertMode = ins;
    return p;
  };
  it('Single Note mode records a triad as three steps (manual: 14 notes → 14 steps)', () => {
    const p = mk('single');
    const r = new PatternRecorder(rng(), () => false);
    [60, 64, 67].forEach((n, i) => r.noteOn(p, n, i));
    expect(p.steps).toEqual([[60], [64], [67]]);
  });
  it('Chord mode groups near-simultaneous notes into one step', () => {
    const p = mk('chord');
    const r = new PatternRecorder(rng(), () => false);
    [60, 64, 67].forEach((n, i) => r.noteOn(p, n, i * 5));
    r.noteOn(p, 62, 500);
    expect(p.steps).toEqual([[60, 64, 67], [62]]);
  });
  it('Build mode accumulates while a key is held; replaying a note removes it', () => {
    const p = mk('build');
    const r = new PatternRecorder(rng(), () => false);
    r.noteOn(p, 36, 0);
    r.noteOn(p, 60, 100);
    r.noteOn(p, 64, 200);
    r.noteOff(p, 60);
    r.noteOff(p, 64);
    r.noteOn(p, 64, 300); // already in the chord → removed
    r.noteOff(p, 64);
    r.noteOff(p, 36); // all released → next step
    r.noteOn(p, 41, 400);
    r.noteOff(p, 41);
    expect(p.steps).toEqual([[36, 60], [41]]);
  });
  it('Replace and Overdub act on the step at the counter', () => {
    const p = ops.newPattern(steps('C3 D3 E3'), rng());
    p.insertMode = 'replace';
    const r = new PatternRecorder(rng(), () => false);
    r.counter = 1;
    r.noteOn(p, 70, 0);
    expect(pitches(p)).toBe('60 70 64');
    p.insertMode = 'overdub';
    r.counter = 0;
    r.noteOn(p, 72, 1000);
    expect(pitches(p)).toBe('60+72 70 64');
  });
  it('Insert mode inserts before the counter', () => {
    const p = ops.newPattern(steps('C3 D3'), rng());
    const r = new PatternRecorder(rng(), () => false);
    r.counter = 1;
    r.noteOn(p, 70, 0);
    r.noteOn(p, 71, 1000);
    expect(pitches(p)).toBe('60 70 71 62');
  });
});

describe('conducting (§10)', () => {
  it('six grid units select Positions 1..6 along the arrow', () => {
    expect([0, 0.17, 0.5, 0.99].map((t) => cellIndex(t))).toEqual([0, 1, 3, 5]);
    const c = defaultComposition();
    c.conducting.arrows.noteDensity = { enabled: true, dir: 'right' };
    c.conducting.arrows.transposition = { enabled: true, dir: 'up' };
    c.conducting.arrows.accent = { enabled: true, dir: 'left' };
    const r = conductAt(c, 0.9, 0.1);
    // transposition (up, y=.1) and accent (left, x=.9) already sit on Position 1
    expect(r.positions).toEqual([{ variable: 'noteDensity', position: 5 }]);
    expect(conductAt(c, 0.9, 0.95).positions).toEqual([
      { variable: 'noteDensity', position: 5 },
      { variable: 'transposition', position: 5 },
    ]);
  });
  it('tempo is continuous within the range', () => {
    const c = defaultComposition();
    c.tempo = { lo: 40, hi: 200, value: 120 };
    c.conducting.arrows.tempo = { enabled: true, dir: 'right' };
    expect(conductAt(c, 0.25, 0.5).tempo).toBe(80);
  });
  it('continuous conducting spans ×¼..×4 legato and ±127 velocity, centred on no change', () => {
    expect(continuousLegatoMultiplier(0)).toBeCloseTo(0.25);
    expect(continuousLegatoMultiplier(0.5)).toBeCloseTo(1);
    expect(continuousLegatoMultiplier(1)).toBeCloseTo(4);
    expect(continuousVelocityOffset(0.5)).toBe(0);
    expect(continuousVelocityOffset(1)).toBe(127);
  });
  it('the robot conductor moves the baton at its rate and changes Positions', () => {
    const c = demoComposition(9);
    c.conducting.arrows.transposition = { enabled: true, dir: 'right' };
    c.conducting.robot = { enabled: true, hRange: 1, vRange: 0, rate: 4 };
    const e = new MEngine(c);
    e.start();
    const changes = e.render(96 * 40).filter((x) => x.kind === 'change' && x.what === 'baton');
    expect(changes.map((x) => x.tick)).toEqual(Array.from({ length: 41 }, (_, i) => i * 96));
  });
});

describe('snapshots (§12)', () => {
  it('store Positions, not contents, and restore only what they hold', () => {
    const c = defaultComposition();
    const e = new MEngine(c);
    c.transposition.active = 4;
    c.accent.active = 2;
    const snap = captureAll(c);
    expect(snapshotSize(snap)).toBeGreaterThan(20);
    c.transposition.active = 0;
    c.accent.active = 0;
    c.transposition.positions[4][0] = 11; // edit the Position's content after storing
    e.applySnapshot(snap, 0);
    expect(c.transposition.active).toBe(4);
    expect(c.transposition.positions[4][0]).toBe(11);
    const partial = { positions: { noteDensity: 3 }, arrows: {}, voices: [{}, {}, {}, {}], sync: false };
    const undo = captureLike(c, partial);
    expect(undo.positions).toEqual({ noteDensity: 0 });
    e.applySnapshot(partial, 0);
    expect(c.noteDensity.active).toBe(3);
    expect(c.transposition.active).toBe(4);
  });
  it('quantized actions happen at the next quantization point counted from Start', () => {
    const c = demoComposition();
    c.quantization = 1; // whole note = 384 ticks
    const e = new MEngine(c);
    e.start();
    e.render(100);
    e.perform(100, true, 'test', (t) => e.selectPosition('transposition', 2, t));
    expect(c.transposition.active).toBe(0);
    e.render(383);
    expect(c.transposition.active).toBe(0);
    e.render(384);
    expect(c.transposition.active).toBe(2);
  });
});

describe('sound choice', () => {
  it('selecting a Position sends its program changes', () => {
    const c = defaultComposition();
    c.soundChoice.positions[2][0] = 10;
    c.soundChoice.positions[2][4] = 0;
    const e = new MEngine(c);
    const ev = e.selectPosition('soundChoice', 2, 0).filter((x) => x.kind === 'program');
    expect(ev).toEqual([
      { kind: 'program', tick: 0, channel: 1, program: 10 },
      { kind: 'program', tick: 0, channel: 5, program: 0 },
    ]);
  });
});

describe('cyclic defaults', () => {
  it('new composition Position 1 is neutral: every note, 50% legato, accent 4', () => {
    const c = defaultComposition();
    expect(c.accent.positions[0][0]).toEqual(cyc(4));
    expect(c.legato.positions[0][0]).toEqual(cyc(2));
    expect(c.legatoValues).toEqual([6, 25, 50, 75, 100]);
  });
});
