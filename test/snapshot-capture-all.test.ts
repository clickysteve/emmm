// @vitest-environment happy-dom
/**
 * Capture All: double-clicking an empty Snapshot letter stores everything a Snapshot can hold,
 * as Blink Everything + a letter would — passively (no recall, no interruption of the music or
 * the Robots), never over an occupied slot, and leaving a Hold/Do selection alone.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Session } from '../src/app/session';
import { CONDUCT_TARGETS, demoComposition } from '../src/engine/defaults';
import type { EngineEvent } from '../src/engine/engine';
import { captureAll, SNAPSHOT_VARIABLES, VOICE_ITEMS } from '../src/engine/snapshots';
import type { VariableName } from '../src/engine/types';

let sessions: Session[] = [];
afterEach(() => {
  sessions.forEach((s) => s.stop());
  sessions = [];
});

function mk(seed = 31, extended = true): Session {
  const s = new Session(demoComposition(seed));
  (s.scheduler as unknown as { wake: () => void }).wake = () => {};
  s.comp.extended.enabled = extended;
  s.changed('extended');
  sessions.push(s);
  return s;
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
const act = (s: Session, v: VariableName) => (s.comp[v] as { active: number }).active;
const positions = (s: Session) => SNAPSHOT_VARIABLES.map((v) => act(s, v));
/** some state away from the defaults */
function vary(s: Session): void {
  s.clickPosition('noteDensity', 3);
  s.clickPosition('accent', 1);
  s.clickPosition('rhythm', 4);
  s.clickPosition('octave', 2);
  s.clickPosition('patternGroup', 1);
  s.comp.voices[2].playEnable = false;
  s.comp.patternGroups[s.comp.patternGroup.active].patterns[1].tbDen = 16;
  s.comp.conducting.arrows.legato.enabled = !s.comp.conducting.arrows.legato.enabled;
}

describe('Capture All (Session)', () => {
  it('stores exactly what Blink Everything + a letter stores, into an empty slot', () => {
    const a = mk();
    const b = mk();
    vary(a);
    vary(b);
    expect(a.captureAllInto(4)).toBe(true);
    b.blinkEverything();
    b.clickSnapshot(4);
    expect(a.comp.snapshots[4]).toEqual(b.comp.snapshots[4]);
    expect(a.currentSnapshot).toBe(4);
  });

  it('holds every capturable item (the authoritative lists), at its current value', () => {
    const s = mk();
    vary(s);
    s.captureAllInto(0);
    const snap = s.comp.snapshots[0]!;
    expect(snap).toEqual(captureAll(s.comp));
    expect(Object.keys(snap.positions).sort()).toEqual([...SNAPSHOT_VARIABLES].sort());
    for (const v of SNAPSHOT_VARIABLES) expect(snap.positions[v]).toBe(act(s, v));
    expect(Object.keys(snap.arrows).sort()).toEqual([...CONDUCT_TARGETS].sort());
    for (const t of CONDUCT_TARGETS) expect(snap.arrows[t]).toEqual(s.comp.conducting.arrows[t]);
    snap.voices.forEach((vi) => expect(Object.keys(vi).sort()).toEqual([...VOICE_ITEMS].sort()));
    expect(snap.voices[2].playEnable).toBe(false);
    expect(snap.voices[1].tbDen).toBe(16);
    expect(snap.sync).toBe(true);
  });

  it('never overwrites an occupied slot', () => {
    const s = mk();
    s.holdDo();
    s.clickPosition('rhythm', 2);
    s.clickSnapshot(3);
    const before = structuredClone(s.comp.snapshots[3]);
    s.clickPosition('accent', 4);
    expect(s.captureAllInto(3)).toBe(false);
    expect(s.comp.snapshots[3]).toEqual(before);
  });

  it('leaves the Hold/Do selection (blinking items) as it was; selective capture still works', () => {
    const s = mk();
    s.captureAllInto(1);
    expect(s.hold).toBeNull(); // nothing left blinking
    s.holdDo();
    s.clickPosition('transposition', 5);
    const sel = structuredClone(s.hold!.pending);
    s.captureAllInto(2);
    expect(s.hold!.mode).toBe('hold');
    expect(s.hold!.pending).toEqual(sel);
    s.clickSnapshot(6);
    expect(s.comp.snapshots[6]!.positions).toEqual({ transposition: 5 });
    expect(s.comp.snapshots[6]!.sync).toBe(false);
    // and a following Hold/Do starts from nothing, as before
    s.holdDo();
    expect(s.hold!.pending.positions).toEqual({});
  });

  it('is passive: playback and the Robots carry on exactly as without it', () => {
    const setup = (s: Session) => {
      expect(s.setRobot(1, { personality: 'drunk', variables: ['noteDensity', 'velocityRange'], rateNum: 1, rateDen: 8 })).toBe(true);
      s.setRobotEnabled(1, true);
      expect(s.setRobot(2, { personality: 'orbit', variables: ['rhythm'], rateNum: 1, rateDen: 4 })).toBe(true);
      s.setRobotEnabled(2, true);
      s.start();
    };
    const a = mk(9);
    const b = mk(9);
    setup(a);
    setup(b);
    run(a, 1500);
    run(b, 1500);
    const at = positions(a);
    const tick = a.engine.tick;
    const log = a.conductor.log.length;
    expect(log).toBeGreaterThan(0);
    a.captureAllInto(7);
    // nothing changed by the capture itself
    expect(positions(a)).toEqual(at);
    expect(a.engine.tick).toBe(tick);
    expect(a.engine.state).toBe('playing');
    expect(a.conductor.log.length).toBe(log);
    expect(a.engine.pendingActions().filter((x) => x.label.startsWith('snapshot'))).toEqual([]); // no recall
    expect(a.comp.snapshots[7]!.positions.noteDensity).toBe(act(a, 'noteDensity'));
    // and the music and the Robots go on identically to the session that did not capture
    const ea = run(a, 4500);
    const eb = run(b, 4500);
    expect(JSON.stringify(ea)).toBe(JSON.stringify(eb));
    expect(a.conductor.log.map((l) => `${l.tick} ${l.text}`)).toEqual(b.conductor.log.map((l) => `${l.tick} ${l.text}`));
    expect(a.conductor.log.at(-1)!.tick).toBeGreaterThan(tick); // the Robots kept moving
  });

  it('recalls normally afterwards', () => {
    const s = mk();
    vary(s);
    const want = positions(s);
    s.captureAllInto(5);
    s.clickPosition('noteDensity', 0);
    s.clickPosition('rhythm', 0);
    s.clickPosition('octave', 5);
    s.comp.voices[2].playEnable = true;
    s.clickSnapshot(5);
    expect(positions(s)).toEqual(want);
    expect(s.comp.voices[2].playEnable).toBe(false);
    s.restoreFromSnapshot();
    expect(act(s, 'noteDensity')).toBe(0);
  });

  it('Classic Mode: Octave is left out (as Blink Everything does) and nothing Extended is switched on', () => {
    const s = mk(31, false);
    s.clickPosition('octave', 3);
    s.captureAllInto(0);
    const snap = s.comp.snapshots[0]!;
    expect(snap.positions.octave).toBeUndefined();
    expect(Object.keys(snap.positions).sort()).toEqual(SNAPSHOT_VARIABLES.filter((v) => v !== 'octave').sort());
    s.blinkEverything();
    expect(snap).toEqual(s.hold!.pending);
    s.holdDo(); // Do the blinked items (Octave not among them)
    expect(s.comp.extended.enabled).toBe(false);
    expect(s.engine.observer).toBeNull();
    s.clickPosition('octave', 1);
    s.clickSnapshot(0);
    expect(act(s, 'octave')).toBe(1);
  });
});

// ------------------------------------------------------------------ the real Snapshot window

describe('Capture All (Snapshot window)', () => {
  type Ui = { updateAll: () => void };
  let s: Session;
  let ui: Ui;
  beforeAll(async () => {
    await import('../src/main');
    s = (window as unknown as { emmm: Session }).emmm;
    ui = (window as unknown as { emmmUi: Ui }).emmmUi;
    document.querySelector('.mdialog')?.remove();
    (s.scheduler as unknown as { wake: () => void }).wake = () => {};
    s.comp.snapshots.fill(null);
    s.currentSnapshot = null;
    ui.updateAll();
    // the 26 letters, in order (their tips read "Snapshot A: …" while nothing is held)
    slots = [...document.querySelectorAll<HTMLDivElement>('[data-win="snapshot"] .num')].filter((d) => /^Snapshot [A-Z]:/.test(d.dataset.tip || d.title));
    expect(slots).toHaveLength(26);
  });
  let slots: HTMLDivElement[] = [];
  const slot = (i: number) => slots[i];
  const pd = (e: Element) => e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  /** a double-click as the browser delivers it: two presses, then dblclick */
  const dbl = (e: Element) => {
    pd(e);
    pd(e);
    e.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    ui.updateAll();
  };

  it('an empty letter says so in its tooltip', () => {
    expect(slot(4).dataset.tip || slot(4).title).toContain('Double-click empty slot to capture all');
  });

  it('a single click on an empty letter still does nothing', () => {
    pd(slot(4));
    ui.updateAll();
    expect(s.comp.snapshots[4]).toBeNull();
    expect(slot(4).innerHTML).toBe('');
  });

  it('double-clicking an empty letter stores everything and shows it as saved (current)', () => {
    s.clickPosition('accent', 2);
    s.clickPosition('noteDensity', 4);
    const want = captureAll(s.comp);
    dbl(slot(4));
    expect(s.comp.snapshots[4]).toEqual(want);
    expect(s.currentSnapshot).toBe(4);
    expect(s.hold).toBeNull();
    expect(slot(4).querySelector('svg text')?.textContent).toBe('E');
    expect(slot(4).querySelector('circle')?.getAttribute('fill')).toBe('var(--ink)');
    expect(slot(4).dataset.tip).toMatch(/^Snapshot E: /);
    expect(slot(4).dataset.tip).toContain('Accent 3');
    expect(slot(4).dataset.tip).toContain('Note Density 5');
  });

  it('double-clicking an occupied letter keeps its contents (it is recalled, as before)', () => {
    const before = structuredClone(s.comp.snapshots[4]);
    s.clickPosition('accent', 0);
    dbl(slot(4));
    expect(s.comp.snapshots[4]).toEqual(before);
    expect(s.comp.accent.active).toBe(2);
  });

  it('while holding, the first press stores the selection as before; the double-click adds nothing', () => {
    s.holdDo();
    s.clickPosition('legato', 3);
    dbl(slot(9));
    expect(s.comp.snapshots[9]!.positions).toEqual({ legato: 3 });
    expect(s.comp.snapshots[9]!.sync).toBe(false);
  });
});
