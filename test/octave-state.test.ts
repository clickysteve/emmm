/**
 * emmm Octave in Snapshots, A/B states and Home — and kept as it is in Classic Mode.
 */
import { describe, expect, it } from 'vitest';
import { Session } from '../src/app/session';
import { demoComposition } from '../src/engine/defaults';
import { describeSnapshot, emptySnapshot } from '../src/engine/snapshots';
import { cleanHome } from '../src/extended/home';
import { deserialize, serialize, validate } from '../src/persistence/format';

function mk(extended = true): Session {
  const c = demoComposition(77);
  c.extended.enabled = extended;
  return new Session(c);
}
const classic = (s: Session, on: boolean) => {
  s.comp.extended.enabled = !on;
  s.changed('extended');
};

describe('Octave in Snapshots', () => {
  it('Blink Everything captures Octave and recall restores it', () => {
    const s = mk();
    s.clickPosition('octave', 3);
    s.blinkEverything();
    s.clickSnapshot(0);
    expect(s.comp.snapshots[0]!.positions.octave).toBe(3);
    expect(describeSnapshot(s.comp.snapshots[0]!)).toContain('Octave 4');
    s.clickPosition('octave', 1);
    s.clickSnapshot(0);
    expect(s.comp.octave.active).toBe(3);
  });
  it('Hold/Do selects Octave like the other Cyclic Variables (only what was selected is stored)', () => {
    const s = mk();
    s.holdDo();
    s.clickPosition('octave', 5);
    s.clickSnapshot(1);
    expect(s.comp.snapshots[1]!.positions).toEqual({ octave: 5 });
    s.clickPosition('octave', 0);
    s.clickPosition('rhythm', 2);
    s.clickSnapshot(1);
    expect(s.comp.octave.active).toBe(5);
    expect(s.comp.rhythm.active).toBe(2);
  });
  it('an older Snapshot without Octave leaves Octave where it is (also after save/load)', () => {
    const s = mk();
    s.comp.snapshots[2] = { ...emptySnapshot(), positions: { rhythm: 4, legato: 1, accent: 2 } };
    const back = new Session(deserialize(serialize(s.comp)).composition);
    back.clickPosition('octave', 4);
    back.clickSnapshot(2);
    expect([back.comp.rhythm.active, back.comp.legato.active, back.comp.accent.active, back.comp.octave.active]).toEqual([4, 1, 2, 4]);
  });
  it('Classic Mode: Blink Everything leaves Octave out and recall does not change it', () => {
    const s = mk();
    s.clickPosition('octave', 2);
    s.comp.snapshots[3] = { ...emptySnapshot(), positions: { octave: 5, rhythm: 1 } };
    classic(s, true);
    s.blinkEverything();
    expect(s.hold!.pending.positions.octave).toBeUndefined();
    s.holdDo();
    s.clickSnapshot(3);
    expect(s.comp.rhythm.active).toBe(1);
    expect(s.comp.octave.active).toBe(2);
    classic(s, false);
    s.clickSnapshot(3);
    expect(s.comp.octave.active).toBe(5);
  });
});

describe('Octave in A/B states', () => {
  it('switching A and B restores Octave (its Positions and the active one)', () => {
    const s = mk();
    s.clickPosition('octave', 1);
    s.abCapture('a');
    s.clickPosition('octave', 4);
    s.comp.octave.positions[4][0] = [{ lo: 0, hi: 0 }];
    s.abCapture('b');
    s.comp.octave.positions[4][0] = [{ lo: 3, hi: 3 }];
    s.abRecall('a');
    expect(s.comp.octave.active).toBe(1);
    s.abRecall('b');
    expect(s.comp.octave.active).toBe(4);
    expect(s.comp.octave.positions[4][0]).toEqual([{ lo: 0, hi: 0 }]);
  });
  it('an older state without Octave, and any state in Classic Mode, leave Octave alone', () => {
    const s = mk();
    s.clickPosition('octave', 1);
    s.abCapture('a');
    delete s.comp.extended.ab.a!.octave;
    s.clickPosition('rhythm', 3);
    s.clickPosition('octave', 5);
    s.abRecall('a');
    expect(s.comp.rhythm.active).toBe(0);
    expect(s.comp.octave.active).toBe(5);
    s.clickPosition('octave', 1);
    s.abCapture('b');
    s.clickPosition('octave', 3);
    classic(s, true);
    s.abRecall('b'); // the session call itself (the menu is disabled in Classic Mode)
    expect(s.comp.octave.active).toBe(3);
  });
});

describe('Octave and Home', () => {
  it('Capture Home includes Octave and Return brings it back', () => {
    const s = mk();
    s.clickPosition('octave', 2);
    s.captureHome();
    expect(s.comp.extended.home.positions!.octave).toBe(2);
    expect(s.comp.extended.home.include.octave).toBe(true);
    s.clickPosition('octave', 5);
    s.returnHome(true);
    expect(s.comp.octave.active).toBe(2);
  });
  it('an older Home without Octave does not move Octave', () => {
    const s = mk();
    s.captureHome();
    const old = structuredClone(s.comp.extended.home) as { positions: Record<string, number>; include: Record<string, boolean> };
    delete old.positions.octave;
    delete old.include.octave;
    s.comp.extended.home = cleanHome(old);
    s.clickPosition('octave', 4);
    s.clickPosition('accent', 3);
    s.returnHome(true);
    expect(s.comp.accent.active).toBe(0);
    expect(s.comp.octave.active).toBe(4);
  });
});

describe('older projects', () => {
  it('load and validate without any Octave in Snapshots, A/B or Home', () => {
    const s = mk();
    s.blinkEverything();
    s.clickSnapshot(0);
    s.abCapture('a');
    s.captureHome();
    const doc = JSON.parse(serialize(s.comp));
    const x = doc.composition;
    delete x.snapshots[0].positions.octave;
    delete x.extended.ab.a.octave;
    delete x.extended.home.positions.octave;
    delete x.extended.home.include.octave;
    const back = deserialize(JSON.stringify(doc)).composition;
    expect(() => validate(back)).not.toThrow();
    expect(back.snapshots[0]!.positions.octave).toBeUndefined();
    expect(back.extended.home.positions!.octave).toBeUndefined();
    expect(back.extended.home.include.octave).toBe(true);
  });
});
