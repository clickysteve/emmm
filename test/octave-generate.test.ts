/**
 * emmm Octave (the fourth Cyclic Variable) in the engine, and the Pattern generators.
 */
import { describe, expect, it } from 'vitest';
import { euclid, generate, GENERATORS, scalePool, type GenParams } from '../src/app/generate';
import { inScale } from '../src/app/scales';
import { Session } from '../src/app/session';
import { noteName } from '../src/engine/constants';
import { cyc, defaultComposition, demoComposition } from '../src/engine/defaults';
import { MEngine, type EngineEvent, type NoteOnEvent } from '../src/engine/engine';
import { Rng } from '../src/engine/rng';
import type { Composition, Step } from '../src/engine/types';
import { deserialize, serialize } from '../src/persistence/format';

/** One Voice, plays every step in order at full density, ch 1. */
function solo(steps: Step[], octave: ReturnType<typeof cyc>, enabled = true): Composition {
  const c = defaultComposition(7);
  c.extended.enabled = enabled;
  c.patternGroups[0].patterns[0].steps = steps;
  c.patternGroups[0].patterns[0].scrambled = steps.map((_, i) => i);
  c.patternGroups[0].patterns[0].outputLength = steps.length;
  c.noteDensity.positions[0][0] = 100;
  c.noteOrder.positions[0][0] = { original: 100, cyclic: 0 };
  c.accent.positions[0][0] = cyc(4);
  c.rhythm.positions[0][0] = cyc(2);
  c.transposition.positions[0][0] = 0;
  c.orchestration.positions[0][0] = [1];
  c.voices.forEach((v, i) => (v.playEnable = i === 0));
  c.octave.positions[0][0] = octave;
  return c;
}
const run = (c: Composition, ticks = 2000): EngineEvent[] => {
  const e = new MEngine(c);
  e.start();
  return e.render(ticks);
};
const ons = (evs: EngineEvent[]) => evs.filter((x): x is NoteOnEvent => x.kind === 'on');
const pitchesOf = (c: Composition, n = 6) => ons(run(c)).slice(0, n).map((e) => e.pitch);

describe('Octave Cyclic Variable', () => {
  it('neutral by default: new and legacy documents play exactly as before', () => {
    const sig = (c: Composition) => ons(run(c, 3000)).map((x) => `${x.tick}:${x.pitch}:${x.velocity}`).join();
    const classic = demoComposition(5);
    const full = demoComposition(5);
    full.extended.enabled = true;
    expect(sig(full)).toBe(sig(classic));
    expect(defaultComposition().octave.positions.flat(2)).toEqual(Array(24).fill({ lo: 2, hi: 2 }));
    // a document saved before Octave existed gets the neutral cycles
    const old = JSON.parse(serialize(demoComposition()));
    delete old.composition.octave;
    delete old.composition.conducting.arrows.octave;
    const back = deserialize(JSON.stringify(old)).composition;
    expect(back.octave.positions.flat(2).every((s) => s.lo === 2 && s.hi === 2)).toBe(true);
    expect(back.conducting.arrows.octave.enabled).toBe(false);
  });
  it('levels shift whole octaves; added to Transposition (C3 + 7 semitones + 1 octave = G4)', () => {
    expect(pitchesOf(solo([[60]], cyc(3)), 2)).toEqual([72, 72]);
    expect(pitchesOf(solo([[60]], cyc(0)), 2)).toEqual([36, 36]);
    const c = solo([[60]], cyc(3));
    c.transposition.positions[0][0] = 7;
    expect(noteName(pitchesOf(c, 1)[0])).toBe('G4');
  });
  it('advances once per event like Legato and Accent — rests included; a chord gets one shift', () => {
    // cycle 0, +1 against C3, rest, C3, C3: the rest takes the +1 step
    expect(pitchesOf(solo([[60], [], [60], [60]], cyc(2, 3)), 3)).toEqual([60, 60, 72]);
    const chord = ons(run(solo([[60, 64, 67]], cyc([1, 3]))));
    const byTick = new Map<number, number[]>();
    chord.forEach((e) => byTick.set(e.tick, [...(byTick.get(e.tick) ?? []), e.pitch]));
    for (const ps of byTick.values()) expect([ps[1] - ps[0], ps[2] - ps[0]]).toEqual([4, 7]);
    expect(new Set([...byTick.values()].map((ps) => ps[0])).size).toBeGreaterThan(1); // the range is used
  });
  it('MIDI range: a shifted note outside 0–127 is left out; every note-off matches its note-on pitch', () => {
    expect(pitchesOf(solo([[120], [60]], cyc(4)), 2)).toEqual([84, 84]);
    expect(pitchesOf(solo([[5], [60]], cyc(0)), 2)).toEqual([36, 36]);
    const evs = run(solo([[60, 64]], cyc(0, 4, [1, 3])), 4000);
    const on = new Map(ons(evs).map((e) => [e.id, e.pitch]));
    const offs = evs.filter((e) => e.kind === 'off') as { id: number; pitch: number }[];
    expect(offs.length).toBeGreaterThan(4);
    for (const o of offs) expect(o.pitch).toBe(on.get(o.id));
  });
  it('Classic Mode: Octave has no effect, and its cycles are kept', () => {
    const c = solo([[60]], cyc(4, 0), false);
    expect(pitchesOf(c, 3)).toEqual([60, 60, 60]);
    c.extended.enabled = true;
    expect(pitchesOf(c, 2)).toEqual([84, 36]);
  });
});

const P = (o: Partial<GenParams> = {}): GenParams => ({ generator: 'random', scale: { root: 2, scale: 'minor' }, lo: 50, hi: 74, steps: 32, density: 75, variation: 50, direction: 'up', ...o });
const notes = (s: Step[]) => s.filter((x) => x.length).map((x) => x[0]);
const meanStep = (s: Step[]) => {
  const n = notes(s);
  return n.slice(1).reduce((a, x, i) => a + Math.abs(x - n[i]), 0) / Math.max(1, n.length - 1);
};

describe('Pattern generators', () => {
  it('every generator: notes of the chosen scale, inside the range, the asked number of steps', () => {
    for (const g of GENERATORS)
      for (let seed = 1; seed <= 20; seed++) {
        const out = generate(P({ generator: g.id }), new Rng(seed))!;
        expect(out).toHaveLength(32);
        for (const p of notes(out)) {
          expect(inScale({ root: 2, scale: 'minor' }, p)).toBe(true);
          expect(p >= 50 && p <= 74).toBe(true);
        }
      }
    expect(generate(P({ scale: { root: 2, scale: 'major' }, lo: 60, hi: 60 }), new Rng(1))).toBeNull(); // C is not in D major
    expect(scalePool({ root: 0, scale: 'major' }, 120, 200)).toEqual([120, 122, 124, 125, 127]);
  });
  it('Random Walk moves in smaller steps than Random Melody', () => {
    let walk = 0;
    let rand = 0;
    for (let seed = 1; seed <= 20; seed++) {
      walk += meanStep(generate(P({ generator: 'walk', variation: 0 }), new Rng(seed))!);
      rand += meanStep(generate(P({ generator: 'random' }), new Rng(seed))!);
    }
    expect(walk * 2).toBeLessThan(rand);
  });
  it('Motif repeats a short phrase (exactly, with Variation 0)', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const out = generate(P({ generator: 'motif', variation: 0, density: 100 }), new Rng(seed))!;
      const s = out.map((x) => x.join());
      const period = [3, 4, 5, 6].find((k) => s.every((x, i) => i < k || x === s[i - k]));
      expect(period).toBeDefined();
    }
  });
  it('Euclidean spreads the onsets evenly', () => {
    const e = euclid(3, 8);
    expect(e.filter(Boolean)).toHaveLength(3);
    const at = e.flatMap((x, i) => (x ? [i] : []));
    const gaps = at.map((x, i) => ((at[(i + 1) % at.length] - x + 8) % 8) || 8);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
    const out = generate(P({ generator: 'euclidean', steps: 16, density: 25 }), new Rng(3))!;
    expect(out.map((x) => (x.length ? 'x' : '.')).join('')).toBe('...x...x...x...x');
  });
  it('Apply replaces only the chosen Pattern; one Undo restores it; saved and loaded like any notes; plays in Classic Mode', () => {
    const s = new Session(demoComposition(9));
    const before = JSON.stringify(s.comp.patternGroups);
    s.history.commit();
    const steps = generate(P({ generator: 'arpeggio', direction: 'updown' }), new Rng(4))!;
    const p0 = s.comp.patternGroups[2].patterns[1];
    const keep = { tbNum: p0.tbNum, tbDen: p0.tbDen, phase: p0.phase, chordMode: p0.chordMode };
    s.applyGenerated(2, 1, steps, { root: 2, scale: 'minor' });
    const p = s.comp.patternGroups[2].patterns[1];
    expect(p.steps).toEqual(steps);
    expect(p.scale).toEqual({ root: 2, scale: 'minor' });
    expect({ tbNum: p.tbNum, tbDen: p.tbDen, phase: p.phase, chordMode: p.chordMode }).toEqual(keep);
    const after = JSON.parse(JSON.stringify(s.comp.patternGroups));
    after[2].patterns[1] = JSON.parse(before)[2].patterns[1];
    expect(JSON.stringify(after)).toBe(before);
    expect(deserialize(serialize(s.comp)).composition.patternGroups[2].patterns[1].steps).toEqual(steps);
    // a generated Pattern is ordinary material: it plays with Octave off (Classic Mode)
    const c = structuredClone(s.comp);
    c.extended.enabled = false;
    c.patternGroup.active = 2;
    c.voices.forEach((v) => (v.playEnable = true));
    expect(ons(run(c, 4000)).some((e) => e.voice === 1 && notes(steps).includes(e.pitch - c.transposition.positions[c.transposition.active][1]))).toBe(true);
    s.history.commit();
    s.undo();
    expect(JSON.stringify(s.comp.patternGroups)).toBe(before);
    s.stop();
  });
});
