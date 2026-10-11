/**
 * Transposition Scale Lock (emmm, not M): Transposition values count degrees of each Voice's
 * own Pattern scale instead of semitones. The scale-degree rule itself, then the engine
 * (Positions, chords, different scales per Voice, Keyboard Transpose), every way the
 * Transposition Variable moves (conducting, the Robot, Trajectory, Mutation), the document
 * (save / load / older files / Undo) — and M's chromatic Transposition unchanged when off.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CHROMATIC, inScale, shiftDegrees, type ScaleChoice } from '../src/app/scales';
import { Session } from '../src/app/session';
import { defaultLocks } from '../src/extended/extended';
import { demoComposition } from '../src/engine/defaults';
import { MEngine, type NoteOnEvent } from '../src/engine/engine';
import type { Composition } from '../src/engine/types';
import { mutate, mutationRng } from '../src/extended/mutation';
import { targetInfo } from '../src/extended/trajectory';
import { deserialize, serialize } from '../src/persistence/format';

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const name = (p: number) => NAMES[((p % 12) + 12) % 12] + (Math.floor(p / 12) - 2); // emmm: 60 = C3
const names = (ps: number[]) => ps.map(name).join(' ');
const sc = (scale: string, root = 0): ScaleChoice => ({ root, scale });
const shift = (c: ScaleChoice, ps: number[], d: number) => ps.map((p) => shiftDegrees(c, p, d));
const C_MINOR = sc('minor');
const CHORD = [60, 63, 67]; // C Eb G

// ---------------------------------------------------------------------------- the rule

describe('scale-degree transposition (shiftDegrees)', () => {
  it('C Minor: C–Eb–G +1 → D–F–Ab, +2 → Eb–G–Bb, +3 → F–Ab–C', () => {
    expect(names(shift(C_MINOR, CHORD, 1))).toBe('D3 F3 Ab3');
    expect(names(shift(C_MINOR, CHORD, 2))).toBe('Eb3 G3 Bb3');
    expect(names(shift(C_MINOR, CHORD, 3))).toBe('F3 Ab3 C4');
  });
  it('C Minor descending, symmetric: −1 → Bb–D–F, −2 → Ab–C–Eb; +n then −n is the identity', () => {
    expect(names(shift(C_MINOR, CHORD, -1))).toBe('Bb2 D3 F3');
    expect(names(shift(C_MINOR, CHORD, -2))).toBe('Ab2 C3 Eb3');
    for (let d = -20; d <= 20; d++) for (const p of [48, 50, 51, 53, 55, 56, 58, 60, 72]) expect(shiftDegrees(C_MINOR, shiftDegrees(C_MINOR, p, d), -d)).toBe(p);
  });
  it('octaves wrap: ±7 degrees of a seven-note scale = ±12 semitones; +8 = an octave and a step', () => {
    expect(shift(C_MINOR, CHORD, 7)).toEqual(CHORD.map((p) => p + 12));
    expect(shift(C_MINOR, CHORD, -7)).toEqual(CHORD.map((p) => p - 12));
    expect(shift(C_MINOR, CHORD, 14)).toEqual(CHORD.map((p) => p + 24));
    expect(names(shift(C_MINOR, CHORD, 8))).toBe('D4 F4 Ab4');
    expect(names(shift(C_MINOR, [58], 1))).toBe('C3'); // Bb2 → C3 across the octave
    expect(names(shift(C_MINOR, [60], -1))).toBe('Bb2');
  });
  it('Major and other roots: C Major C–E–G +1 → D–F–A; G Major +1 from F# → G; D Dorian +2 from D → F', () => {
    expect(names(shift(sc('major'), [60, 64, 67], 1))).toBe('D3 F3 A3');
    expect(names(shift(sc('major', 7), [66], 1))).toBe('G3');
    expect(names(shift(sc('dorian', 2), [62], 2))).toBe('F3');
  });
  it('pentatonic: 5 degrees per octave (A minor pentatonic A C D E G)', () => {
    const am = sc('minorPentatonic', 9);
    expect(names(shift(am, [57], 1))).toBe('C3');
    expect(names(shift(am, [57], 4))).toBe('G3');
    expect(names(shift(am, [57], 5))).toBe('A3'); // an octave
    expect(names(shift(am, [57, 60, 64], 1))).toBe('C3 D3 G3');
    expect(names(shift(sc('majorPentatonic'), [60, 64, 67], -1))).toBe('A2 D3 E3');
  });
  it('a note outside the scale keeps its chromatic inflection (degree just below + the remainder, as in a scale change)', () => {
    // C minor: E natural = Eb + 1; B natural = Bb + 1
    expect(names(shift(C_MINOR, [64], 1))).toBe('F#3');
    expect(names(shift(C_MINOR, [71], 1))).toBe('C#4');
    expect(names(shift(C_MINOR, [64], -1))).toBe('Eb3'); // (Eb + 1) − 1 degree = D + 1
    expect(shiftDegrees(C_MINOR, 61, 0)).toBe(61); // 0 degrees: nothing moves
    // deterministic: the same input always gives the same output
    expect(shift(C_MINOR, [61, 64, 66, 69, 71], 3)).toEqual(shift(C_MINOR, [61, 64, 66, 69, 71], 3));
  });
  it('Chromatic is simply semitones', () => {
    for (let d = -30; d <= 30; d++) for (const p of [0, 37, 60, 61, 100]) expect(shiftDegrees(CHROMATIC, p, d)).toBe(p + d);
  });
});

// ---------------------------------------------------------------------------- in the engine

/** voice 0 alone, original order, every step played, on one channel */
function comp(lock: boolean, steps: number[][], scale?: ScaleChoice, t = 0): Composition {
  const c = demoComposition(5);
  c.scaleLock = lock;
  c.voices.forEach((v, i) => (v.playEnable = i === 0));
  const p = c.patternGroups[0].patterns[0];
  p.steps = steps.map((x) => [...x]);
  p.scrambled = p.steps.map((_, i) => i);
  p.outputLength = p.steps.length;
  if (scale) p.scale = scale;
  c.transposition.positions[0][0] = t;
  return c;
}
/** played chords of a voice, in order (pitches sorted) */
function chords(c: Composition, ticks = 384 * 2, voice = 0, prep?: (e: MEngine) => void): number[][] {
  const e = new MEngine(c);
  e.start();
  prep?.(e);
  const byTick = new Map<number, number[]>();
  for (const x of e.render(ticks)) if (x.kind === 'on' && x.voice === voice) byTick.set(x.tick, [...(byTick.get(x.tick) ?? []), x.pitch]);
  return [...byTick.values()].map((ps) => ps.sort((a, b) => a - b));
}

describe('Scale Lock in the engine', () => {
  it('a chord keeps its shape in the scale: C Minor C–Eb–G at Transposition +1 plays D–F–Ab', () => {
    expect(names(chords(comp(true, [CHORD], C_MINOR, 1))[0])).toBe('D3 F3 Ab3');
    expect(names(chords(comp(true, [CHORD], C_MINOR, -2))[0])).toBe('Ab2 C3 Eb3');
    // without Scale Lock the same value is a semitone (M)
    expect(names(chords(comp(false, [CHORD], C_MINOR, 1))[0])).toBe('C#3 E3 Ab3');
  });
  it('the stored notes are never changed by playing', () => {
    const c = comp(true, [CHORD, [62]], C_MINOR, 3);
    chords(c);
    expect(c.patternGroups[0].patterns[0].steps).toEqual([CHORD, [62]]);
  });
  it('a Chromatic Pattern behaves exactly as without Scale Lock', () => {
    const on = chords(comp(true, [CHORD, [62, 65]], undefined, 5));
    const off = chords(comp(false, [CHORD, [62, 65]], undefined, 5));
    expect(on).toEqual(off);
    // the whole demo, every Voice Chromatic: identical output with Scale Lock on or off
    const sig = (lock: boolean) => {
      const d = demoComposition(4);
      d.scaleLock = lock;
      d.transposition.active = 4;
      const e = new MEngine(d);
      e.start();
      return e.render(3000).filter((x): x is NoteOnEvent => x.kind === 'on').map((x) => `${x.tick}:${x.pitch}:${x.velocity}`).join();
    };
    expect(sig(true)).toBe(sig(false));
  });
  it('each Voice uses its own Pattern’s scale: +2 in C Minor and in D Dorian', () => {
    const c = comp(true, [[60]], C_MINOR, 2);
    c.voices[1].playEnable = true;
    const p1 = c.patternGroups[0].patterns[1];
    p1.steps = [[62]];
    p1.scrambled = [0];
    p1.outputLength = 1;
    p1.scale = sc('dorian', 2);
    c.transposition.positions[0][1] = 2;
    expect(names(chords(c, 400, 0)[0])).toBe('Eb3'); // C + 2 degrees of C minor
    expect(names(chords(c, 400, 1)[0])).toBe('F3'); // D + 2 degrees of D Dorian
  });
  it('the scale follows the Pattern Group: switching group switches scale', () => {
    const c = comp(true, [[60]], C_MINOR, 2);
    const g1 = c.patternGroups[1].patterns[0];
    g1.steps = [[60]];
    g1.scrambled = [0];
    g1.outputLength = 1;
    g1.scale = sc('major');
    c.patternGroup.active = 1;
    expect(names(chords(c, 400)[0])).toBe('E3');
  });
  it('a Position change takes effect at once, in degrees', () => {
    const c = comp(true, [CHORD], C_MINOR, 0);
    c.transposition.positions[1][0] = 2;
    const e = new MEngine(c);
    e.start();
    const first = e.render(200).filter((x): x is NoteOnEvent => x.kind === 'on' && x.voice === 0);
    e.selectPosition('transposition', 1, e.tick);
    const later = e.render(800).filter((x): x is NoteOnEvent => x.kind === 'on' && x.voice === 0);
    expect(names(first.slice(0, 3).map((x) => x.pitch).sort((a, b) => a - b))).toBe('C3 Eb3 G3');
    expect(names(later.slice(0, 3).map((x) => x.pitch).sort((a, b) => a - b))).toBe('Eb3 G3 Bb3');
  });
  it('Keyboard Transpose (a played key, Use = T) stays chromatic on top of the degrees', () => {
    const c = comp(true, [[60]], C_MINOR, 1);
    c.options.secondOrderTranspose = true;
    const e = (key: number, second: boolean) => {
      c.options.secondOrderTranspose = second;
      return chords(c, 400, 0, (m) => m.keyboardTranspose(0, key))[0][0];
    };
    expect(name(e(62, true))).toBe('E3'); // D (+1 degree) then +2 semitones
    expect(name(e(62, false))).toBe('D3'); // the key replaces the Position: C + 2 semitones
  });
});

// ---------------------------------------------------------------------------- every way it moves

/** C minor material in every Voice, so a scale-degree transposition stays in C minor */
function minorDemo(lock: boolean): Composition {
  const c = demoComposition(9);
  c.scaleLock = lock;
  c.patternGroups[0].patterns.forEach((p, v) => {
    p.steps = [[48 + 12 * (v % 3)], [51 + 12 * (v % 3), 55 + 12 * (v % 3)], [53], [58, 62], [56]];
    p.scrambled = p.steps.map((_, i) => i);
    p.outputLength = p.steps.length;
    p.scale = C_MINOR;
  });
  c.transposition.positions = [
    [0, 0, 0, 0],
    [1, 2, -1, 3],
    [2, 2, 2, 2],
    [-3, -3, -3, -3],
    [4, 5, 6, 7],
    [1, 1, 1, 1],
  ];
  return c;
}
const allInMinor = (ps: number[]) => ps.every((p) => inScale(C_MINOR, p));

describe('Scale Lock wherever the Transposition Variable moves', () => {
  it('the Robot Conductor: with Scale Lock every note stays in C Minor (and the Positions really change)', () => {
    const run = (lock: boolean) => {
      const c = minorDemo(lock);
      c.conducting.arrows.transposition = { enabled: true, dir: 'right' };
      c.conducting.robot = { enabled: true, hRange: 1, vRange: 1, rate: 2 };
      const e = new MEngine(c);
      e.start();
      const seen = new Set<number>();
      const pitches: number[] = [];
      for (let t = 96; t <= 96 * 60; t += 96) {
        pitches.push(...e.render(t).filter((x): x is NoteOnEvent => x.kind === 'on').map((x) => x.pitch));
        seen.add(c.transposition.active);
      }
      return { seen, pitches };
    };
    const on = run(true);
    expect(on.seen.size).toBeGreaterThan(2);
    expect(allInMinor(on.pitches)).toBe(true);
    // the same values as semitones leave the scale (M)
    expect(allInMinor(run(false).pitches)).toBe(false);
  });
  it('conducting the Baton: the chosen Position is read in degrees', () => {
    const s = new Session(minorDemo(true));
    s.comp.conducting.arrows.transposition = { enabled: true, dir: 'right' };
    s.start();
    const pitches: number[] = [];
    for (const x of [0.05, 0.3, 0.5, 0.7, 0.95]) {
      s.conduct(x, 0.5, true);
      pitches.push(...s.engine.render(s.engine.tick + 200).filter((e): e is NoteOnEvent => e.kind === 'on').map((e) => e.pitch));
    }
    s.stop();
    expect(allInMinor(pitches)).toBe(true);
  });
  it('Trajectory Transposition + counts degrees (and is labelled so)', () => {
    const base = new MEngine(minorDemo(false)); // raw notes: Position 1 is all zeros
    base.start();
    const plain = base.render(384 * 2).filter((e): e is NoteOnEvent => e.kind === 'on' && e.voice === 0);
    const s = new Session(minorDemo(true));
    s.comp.extended.enabled = true;
    const sent: number[][] = [];
    (s as unknown as { send: (c: number, b: number[]) => void }).send = (_c, b) => sent.push([...b]);
    s.setTrajectory(0, { on: true, target: { kind: 'transpose' }, values: [0, 1, 2, 3], voices: [true, false, false, false], rateDen: 4 });
    s.start();
    s.emitNow(s.engine.render(384 * 2));
    s.stop();
    const ons = sent.filter((b) => (b[0] & 0xf0) === 0x90 && (b[0] & 0x0f) === plain[0].channel - 1).map((b) => b[1]);
    const expected = plain.map((n) => shiftDegrees(C_MINOR, n.pitch, [0, 1, 2, 3][Math.floor(n.tick / 96) % 4]));
    expect(ons.slice(0, expected.length)).toEqual(expected);
    expect(allInMinor(ons)).toBe(true);
    expect(targetInfo({ kind: 'transpose' }, true)).toMatchObject({ unit: 'degrees', min: -24, max: 24 });
    expect(targetInfo({ kind: 'transpose' })).toMatchObject({ unit: 'st' });
  });
  it('Mutation proposes degree-sized moves; with Chromatic Patterns it is exactly as without Scale Lock', () => {
    const run = (c: Composition) => {
      mutate(c, 90, defaultLocks(), mutationRng(77, 3));
      return c.transposition.positions[c.transposition.active];
    };
    const chromaticOn = demoComposition(2);
    chromaticOn.scaleLock = true;
    chromaticOn.transposition.active = 1;
    const chromaticOff = demoComposition(2);
    chromaticOff.transposition.active = 1;
    expect(run(chromaticOn)).toEqual(run(chromaticOff));
    // in C minor: deterministic for a seed, and within three octaves of degrees
    const a = run(minorDemo(true));
    const b = run(minorDemo(true));
    expect(a).toEqual(b);
    a.forEach((x) => expect(Math.abs(x)).toBeLessThanOrEqual(21));
  });
  it('seeded determinism: the same document and seed play the same notes with Scale Lock', () => {
    const sig = () => {
      const e = new MEngine(minorDemo(true));
      e.start();
      e.comp.transposition.active = 4;
      return e.render(3000).filter((x): x is NoteOnEvent => x.kind === 'on').map((x) => `${x.tick}:${x.pitch}`).join();
    };
    expect(sig()).toBe(sig());
  });
});

// ---------------------------------------------------------------------------- the document

let sessions: Session[] = [];
afterEach(() => {
  sessions.forEach((s) => s.stop());
  sessions = [];
});

describe('Scale Lock in the document', () => {
  it('is saved and loaded', () => {
    const c = minorDemo(true);
    expect(deserialize(serialize(c)).composition.scaleLock).toBe(true);
    expect(deserialize(serialize(minorDemo(false))).composition.scaleLock).toBe(false);
  });
  it('older documents (format 3, no scaleLock) load with Scale Lock off', () => {
    const doc = JSON.parse(serialize(demoComposition(3)));
    doc.version = 3;
    delete doc.composition.scaleLock;
    const back = deserialize(JSON.stringify(doc));
    expect(back.version).toBe(5);
    expect(back.composition.scaleLock).toBe(false);
  });
  it('a hand-edited non-boolean value is refused (off)', () => {
    const doc = JSON.parse(serialize(demoComposition(3)));
    doc.composition.scaleLock = 'yes';
    expect(deserialize(JSON.stringify(doc)).composition.scaleLock).toBe(false);
  });
  it('switching it is one Undo step each way, and Undo / Redo leave the notes and values alone', () => {
    const s = new Session(minorDemo(false));
    sessions.push(s);
    s.history.commit();
    const before = JSON.stringify([s.comp.patternGroups, s.comp.transposition.positions]);
    s.setScaleLock(true);
    s.history.commit();
    expect(s.comp.scaleLock).toBe(true);
    s.undo();
    expect(s.comp.scaleLock).toBe(false);
    s.redo();
    expect(s.comp.scaleLock).toBe(true);
    expect(JSON.stringify([s.comp.patternGroups, s.comp.transposition.positions])).toBe(before);
  });
});

describe('MIDI clock input moved out of Extended (format 4)', () => {
  const v3 = (extEnabled: boolean, clockEnabled: boolean) => {
    const doc = JSON.parse(serialize(demoComposition(3)));
    doc.version = 3;
    delete doc.composition.midi.clockIn;
    doc.composition.extended.enabled = extEnabled;
    doc.composition.extended.clockIn = { enabled: clockEnabled, port: 'in-7', transport: false };
    return deserialize(JSON.stringify(doc)).composition;
  };
  it('an older file’s clock input arrives in the MIDI settings, on only if it was really running (Extended on)', () => {
    expect(v3(true, true).midi.clockIn).toEqual({ enabled: true, port: 'in-7', transport: false });
    expect(v3(false, true).midi.clockIn).toEqual({ enabled: false, port: 'in-7', transport: false });
    expect('clockIn' in v3(true, true).extended).toBe(false);
  });
  it('it is not part of Undo (MIDI configuration belongs to the setup, as M’s Midi Assignment)', () => {
    const s = new Session(demoComposition(3));
    sessions.push(s);
    s.history.commit();
    s.setScaleLock(true);
    s.history.commit();
    s.comp.midi.clockIn.enabled = true;
    s.changed('clock');
    s.undo();
    expect(s.comp.midi.clockIn.enabled).toBe(true);
    expect(s.comp.scaleLock).toBe(false);
  });
});
