/**
 * Core usability: Pattern Length in the editor workflow, Clear Pattern, Undo / Redo, the
 * scale guide and the Time Base model — all without changing M's musical behaviour.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { History } from '../src/app/history';
import { assignDeep } from '../src/app/assign';
import { CHROMATIC, cleanChoice, inScale, isChromatic, isRoot, SCALES, snapToScale } from '../src/app/scales';
import { Session } from '../src/app/session';
import { STEP_ADVANCE } from '../src/engine/constants';
import { demoComposition } from '../src/engine/defaults';
import { MEngine, type NoteOnEvent } from '../src/engine/engine';
import * as ops from '../src/engine/patternOps';

let sessions: Session[] = [];
function mk(seed = 99): Session {
  const s = new Session(demoComposition(seed));
  sessions.push(s);
  return s;
}
afterEach(() => {
  sessions.forEach((s) => s.stop());
  sessions = [];
});

/** What the Pattern Editor does on a click: toggle a pitch, then report the edit. */
function click(s: Session, v: number, step: number, pitch: number): void {
  ops.togglePitch(s.pattern(v), step, pitch, s.editRng, s.comp.options.dontScrambleRests);
  s.patternEdited();
  s.history.commit(); // a released gesture
}

describe('Pattern Length from the Pattern Editor (the step-25 workflow)', () => {
  it('grows to 25, keeps the trailing rest when the note goes, and sets back without leaving the editor', () => {
    const s = mk();
    const p = s.pattern(0);
    expect(p.steps.length).toBe(8);
    expect(p.outputLength).toBe(8);
    click(s, 0, 24, 72); // a note at step 25
    expect(p.steps.length).toBe(25);
    expect(p.outputLength).toBe(25);
    click(s, 0, 24, 72); // remove it
    expect(p.steps[24]).toEqual([]);
    expect(p.steps.length).toBe(25); // not trimmed automatically: trailing rests are kept
    expect(p.outputLength).toBe(25);
    // the editor's Length control is the same Output Length numerical as the Patterns window
    s.setOutputLength(0, 8, false);
    expect(p.outputLength).toBe(8);
    expect(p.steps.length).toBe(25); // plain change: the Voice plays 8, the rests stay
    // Alt-drag (structural): the Pattern itself becomes 8 steps
    s.setOutputLength(0, 8, true);
    expect(p.steps.length).toBe(8);
    // and extend again, with rests
    s.setOutputLength(0, 12, true);
    expect(p.steps.length).toBe(12);
    expect(p.steps.slice(8)).toEqual([[], [], [], []]);
    expect(p.outputLength).toBe(12);
  });
  it('one state: the value the Patterns window reads is the value the editor wrote', () => {
    const s = mk();
    s.setOutputLength(1, 3, false);
    expect(s.pattern(1).outputLength).toBe(3);
    expect(s.comp.patternGroups[s.comp.patternGroup.active].patterns[1].outputLength).toBe(3);
  });
});

describe('Clear Pattern', () => {
  it('empties only the edited Pattern and nothing else', () => {
    const s = mk();
    const before = structuredClone(s.comp);
    s.editOp('clear', { voice: 2 });
    const p = s.pattern(2);
    expect(p.steps).toEqual([]);
    expect(p.outputLength).toBe(0);
    expect(p.tbNum).toBe(before.patternGroups[0].patterns[2].tbNum); // timing stays
    expect(p.phase).toBe(before.patternGroups[0].patterns[2].phase);
    for (const v of [0, 1, 3]) expect(s.pattern(v)).toEqual(before.patternGroups[0].patterns[v]);
    expect(s.comp.midi).toEqual(before.midi);
    expect(s.comp.noteDensity).toEqual(before.noteDensity);
  });
  it('is safe while playing: every note still gets its note-off', () => {
    const s = mk();
    const sent: number[][] = [];
    (s as unknown as { send: (c: number, b: number[]) => void }).send = (_c, b) => sent.push([...b]);
    s.start();
    s.emitNow(s.engine.render(150));
    s.editOp('clear', { voice: 0 });
    s.emitNow(s.engine.render(800));
    s.stop();
    const open = new Map<string, number>();
    for (const m of sent) {
      const k = `${m[0] & 0x0f}:${m[1]}`;
      if ((m[0] & 0xf0) === 0x90 && m[2] > 0) open.set(k, (open.get(k) ?? 0) + 1);
      if ((m[0] & 0xf0) === 0x80) open.set(k, (open.get(k) ?? 0) - 1);
    }
    expect([...open.values()].every((n) => n <= 0)).toBe(true);
  });
  it('undoes and redoes', () => {
    const s = mk();
    const notes = structuredClone(s.pattern(0).steps);
    s.history.commit();
    s.editOp('clear', { voice: 0 });
    s.history.commit();
    expect(s.pattern(0).steps).toEqual([]);
    expect(s.undo()).toBe(true);
    expect(s.pattern(0).steps).toEqual(notes);
    expect(s.redo()).toBe(true);
    expect(s.pattern(0).steps).toEqual([]);
  });
});

describe('Undo / Redo', () => {
  it('History: bounded, one step per settled change, redo cleared by a new edit', () => {
    let doc = 'a';
    const h = new History(() => doc, 3);
    for (const x of ['b', 'c', 'd', 'e']) {
      doc = x;
      h.commit();
    }
    expect(h.depth.undo).toBe(3); // bounded
    expect(h.commit()).toBe(false); // nothing changed
    const apply = (st: string) => (doc = st);
    h.undo(apply);
    expect(doc).toBe('d');
    h.undo(apply);
    expect(doc).toBe('c');
    h.redo(apply);
    expect(doc).toBe('d');
    doc = 'x';
    expect(h.redo(apply)).toBe(false); // a new edit ends the redo chain
    expect(h.canRedo).toBe(false);
  });
  it('a dragged value is one step (the gesture), not one per movement', () => {
    const s = mk();
    s.history.commit();
    const d0 = s.comp.noteDensity.positions[0][0];
    s.gestureActive = true;
    for (let x = 1; x <= 30; x++) {
      s.comp.noteDensity.positions[0][0] = x;
      s.changed('noteDensity');
    }
    s.gestureEnd();
    s.history.commit();
    expect(s.history.depth.undo).toBe(1);
    s.undo();
    expect(s.comp.noteDensity.positions[0][0]).toBe(d0);
  });
  it('covers Pattern notes, Length, Variable values and cycles', () => {
    const s = mk();
    s.history.commit();
    const snap0 = JSON.stringify(s.comp);
    click(s, 1, 3, 77);
    s.setOutputLength(1, 2, false);
    s.history.commit();
    s.comp.transposition.positions[2][1] = 5;
    s.changed('transposition');
    s.history.commit();
    s.comp.rhythm.positions[0][0] = [{ lo: 3, hi: 4 }];
    s.changed('rhythm');
    s.history.commit();
    while (s.undo());
    expect(JSON.stringify(s.comp)).toBe(snap0);
  });
  it('playing (Position changes, tempo, Baton) never makes an Undo step, and Undo keeps the performance where it is', () => {
    const s = mk();
    s.history.commit();
    click(s, 0, 2, 70); // an edit
    s.clickPosition('transposition', 4);
    s.setTempo(140);
    s.conduct(0.2, 0.9, false);
    s.history.commit();
    expect(s.history.depth.undo).toBe(1);
    s.undo();
    expect(s.pattern(0).steps[2]).not.toContain(70);
    expect(s.comp.transposition.active).toBe(4); // the performance is not rewound
    expect(s.comp.tempo.value).toBe(140);
  });
  it('MIDI routing is never undone', () => {
    const s = mk();
    s.history.commit();
    click(s, 0, 1, 61);
    s.comp.midi.outputs[3].port = 'some-device';
    s.changed('midi');
    s.undo();
    expect(s.comp.midi.outputs[3].port).toBe('some-device');
  });
  it('undo while playing keeps object identity (views and the engine stay bound) and emits valid MIDI', () => {
    const s = mk();
    const groups = s.comp.patternGroups;
    const ext = s.comp.extended;
    s.start();
    s.emitNow(s.engine.render(200));
    click(s, 0, 0, 40);
    s.undo();
    expect(s.comp.patternGroups).toBe(groups);
    expect(s.comp.extended).toBe(ext);
    expect(() => s.emitNow(s.engine.render(1200))).not.toThrow();
  });
  it('a step-advance voice made to run again by Undo is woken by the engine', () => {
    const s = mk();
    s.history.commit();
    s.setTimeBase(0, 1, STEP_ADVANCE);
    s.history.commit();
    s.start();
    s.emitNow(s.engine.render(100));
    s.undo();
    expect(s.pattern(0).tbDen).not.toBe(STEP_ADVANCE);
    const evs = s.engine.render(1000);
    expect(evs.some((e) => e.kind === 'step' && e.voice === 0)).toBe(true);
  });
  it('loading a document clears the history', () => {
    const s = mk();
    click(s, 0, 1, 61);
    s.load(demoComposition(5));
    expect(s.history.canUndo).toBe(false);
  });
  it('assignDeep updates in place', () => {
    const dst = { a: [1, 2, 3], b: { c: 1, gone: 2 }, keep: { x: 1 } };
    const keepRef = dst.keep;
    const aRef = dst.a;
    assignDeep(dst, { a: [9], b: { c: 2 }, keep: { x: 5 }, extra: [1] });
    expect(dst).toEqual({ a: [9], b: { c: 2 }, keep: { x: 5 }, extra: [1] });
    expect(dst.keep).toBe(keepRef);
    expect(dst.a).toBe(aRef);
  });
});

describe('scales (pitch-class sets)', () => {
  const cMinPent = { root: 0, scale: 'minorPentatonic' };
  const dDorian = { root: 2, scale: 'dorian' };
  it('pitch-class sets for all 12 roots', () => {
    expect(SCALES.map((s) => s.id)).toEqual(['chromatic', 'major', 'minor', 'harmonicMinor', 'melodicMinor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian', 'majorPentatonic', 'minorPentatonic', 'blues', 'wholeTone']);
    for (const s of SCALES) expect(s.steps[0]).toBe(0);
    expect([60, 63, 65, 67, 70].every((p) => inScale(cMinPent, p))).toBe(true);
    expect([61, 62, 64, 66, 68, 69, 71].some((p) => inScale(cMinPent, p))).toBe(false);
    expect([62, 64, 65, 67, 69, 71, 72].every((p) => inScale(dDorian, p))).toBe(true);
    expect(isRoot(dDorian, 50)).toBe(true);
    for (let root = 0; root < 12; root++) expect(isRoot({ root, scale: 'major' }, 60 + root)).toBe(true);
  });
  it('snaps a new note to the nearest scale note (lower on a tie)', () => {
    expect(snapToScale(cMinPent, 61)).toBe(60);
    expect(snapToScale(cMinPent, 62)).toBe(63);
    expect(snapToScale(cMinPent, 64)).toBe(63); // 63 and 65 equally near → lower
    expect(snapToScale(cMinPent, 67)).toBe(67);
    expect(snapToScale(CHROMATIC, 61)).toBe(61);
    expect(isChromatic(CHROMATIC)).toBe(true);
  });
  it('stored choices are validated', () => {
    expect(cleanChoice({ root: 14, scale: 'nope' })).toEqual(CHROMATIC);
    expect(cleanChoice({ root: 2, scale: 'dorian' })).toEqual(dDorian);
  });
  it('no real-time quantiser: with Scale Lock off (the default) a Pattern scale never changes the output', () => {
    const c = demoComposition(3);
    expect(c.scaleLock).toBe(false);
    // the default document carries no scale data apart from the (off) Scale Lock switch
    expect(JSON.stringify(c).replace('"scaleLock":false', '')).not.toMatch(/scale/i);
    const sig = (withScales: boolean) => {
      const d = demoComposition(3);
      // scale metadata only (notes not transformed): many notes are outside it
      if (withScales) d.patternGroups.forEach((g) => g.patterns.forEach((p) => (p.scale = { root: 2, scale: 'minorPentatonic' })));
      const e = new MEngine(d);
      e.start();
      return e.render(3000).filter((x): x is NoteOnEvent => x.kind === 'on').map((x) => x.pitch).join();
    };
    expect(sig(true)).toBe(sig(false));
  });
});

describe('Time Base model (confirmed, unchanged)', () => {
  it('belongs to the Pattern in the active Pattern Group: a different group brings its own', () => {
    const s = mk();
    s.setTimeBase(0, 1, 16);
    expect(s.comp.patternGroups[0].patterns[0].tbDen).toBe(16);
    s.clickPosition('patternGroup', 1);
    expect(s.pattern(0)).toBe(s.comp.patternGroups[1].patterns[0]);
  });
  it('the base pulse is n/d of a whole note, Rhythm multiplies it', () => {
    const c = demoComposition(8);
    const p = c.patternGroups[0].patterns[0];
    p.tbNum = 1;
    p.tbDen = 8;
    const e = new MEngine(c);
    expect(e.baseTicks(0)).toBe(48); // an eighth note = 48 ticks
    p.tbNum = 3;
    expect(e.baseTicks(0)).toBe(144); // dotted quarter
    c.rhythm.positions[c.rhythm.active][0] = [{ lo: 2, hi: 2 }]; // level 2 = ×2 (default table)
    p.tbNum = 1;
    e.start();
    const steps = e.render(48 * 2 * 4).filter((x) => x.kind === 'step' && x.voice === 0);
    expect(steps.map((x) => x.tick).slice(0, 3)).toEqual([p.phase, p.phase + 96, p.phase + 192]);
  });
  it('can change while playing', () => {
    const s = mk();
    s.start();
    s.emitNow(s.engine.render(300));
    s.setTimeBase(0, 1, 16);
    expect(() => s.emitNow(s.engine.render(900))).not.toThrow();
    expect(s.pattern(0).tbDen).toBe(16);
  });
});
