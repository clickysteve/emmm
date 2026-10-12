/**
 * Apply scale to: this Pattern, every Pattern of the current Pattern Group, or all Patterns
 * (emmm, Pattern Editor). Each Pattern changes exactly as when its own Root / Scale is changed
 * (its notes move from its own scale to the new one — app/scales.ts transformPitch), gets its
 * own copy of the choice, and keeps everything else. One Undo step; saved in the document.
 */
import { describe, expect, it } from 'vitest';
import { Session } from '../src/app/session';
import { CHROMATIC, transformSteps, type ScaleChoice } from '../src/app/scales';
import { demoComposition } from '../src/engine/defaults';
import type { Composition, Pattern } from '../src/engine/types';
import { deserialize, serialize } from '../src/persistence/format';

const D_MINOR: ScaleChoice = { root: 2, scale: 'minor' };
const E_MINOR: ScaleChoice = { root: 4, scale: 'minor' };

function mk(): Session {
  const c = demoComposition(17);
  // notes in every Group, some Patterns already with a scale of their own
  c.patternGroups.forEach((g, gi) =>
    g.patterns.forEach((p, v) => {
      if (!p.steps.length) p.steps = [[60 + gi + v], [], [64 + v, 72], [71 - gi]];
      p.outputLength = p.steps.length;
      p.scrambled = p.steps.map((_, k) => k);
    }),
  );
  c.patternGroups[1].patterns[2].scale = { root: 7, scale: 'major' };
  c.patternGroups[4].patterns[0].scale = { root: 0, scale: 'minorPentatonic' };
  const s = new Session(c);
  (s.scheduler as unknown as { wake: () => void }).wake = () => {};
  return s;
}
/** everything of a Pattern except its notes and scale */
const rest = (p: Pattern) => {
  const { steps: _s, scale: _c, ...o } = structuredClone(p);
  return o;
};
/** what applying `to` must do to one Pattern: exactly a single-Pattern scale change */
const expected = (p: Pattern, to: ScaleChoice) => transformSteps(p.steps, p.scale ?? CHROMATIC, to);
const all = (c: Composition) => c.patternGroups.flatMap((g, gi) => g.patterns.map((p, v) => ({ gi, v, p })));

describe('Apply scale to', () => {
  it('This Pattern: only the edited Voice’s Pattern in the current Group — the old single-Pattern behaviour', () => {
    const s = mk();
    s.clickPosition('patternGroup', 1);
    const before = structuredClone(s.comp.patternGroups);
    const want = expected(before[1].patterns[3], D_MINOR);
    expect(s.applyPatternScale(D_MINOR, 'pattern', 3)).toBe(1);
    expect(s.comp.patternGroups[1].patterns[3].scale).toEqual(D_MINOR);
    expect(s.comp.patternGroups[1].patterns[3].steps).toEqual(want);
    // identical to choosing the Root and Scale in the Pattern Editor
    const t = mk();
    t.clickPosition('patternGroup', 1);
    t.setPatternScale(3, D_MINOR);
    expect(s.comp.patternGroups).toEqual(t.comp.patternGroups);
    for (const { gi, v, p } of all(s.comp)) if (!(gi === 1 && v === 3)) expect(p).toEqual(before[gi].patterns[v]);
  });
  it('Current Group: all four Patterns of the active Group; every other Group untouched', () => {
    const s = mk();
    s.clickPosition('patternGroup', 1);
    const before = structuredClone(s.comp.patternGroups);
    expect(s.applyPatternScale(D_MINOR, 'group', 0)).toBe(4);
    s.comp.patternGroups[1].patterns.forEach((p, v) => {
      expect(p.scale).toEqual(D_MINOR);
      expect(p.steps).toEqual(expected(before[1].patterns[v], D_MINOR)); // from its own scale (Voice 3 was G major)
      expect(rest(p)).toEqual(rest(before[1].patterns[v]));
    });
    for (const { gi, v, p } of all(s.comp)) if (gi !== 1) expect(p).toEqual(before[gi].patterns[v]);
    expect(s.status).toMatch(/D Natural Minor \/ Aeolian applied to Group b \(4 Patterns\): 4 Patterns changed/);
  });
  it('All Patterns: all 24 (six Groups × four Voices); nothing else of any Pattern changes', () => {
    const s = mk();
    const before = structuredClone(s.comp);
    expect(s.applyPatternScale(D_MINOR, 'all', 0)).toBe(24);
    for (const { gi, v, p } of all(s.comp)) {
      const b = before.patternGroups[gi].patterns[v];
      expect(p.scale).toEqual(D_MINOR);
      expect(p.steps).toEqual(expected(b, D_MINOR));
      expect(rest(p)).toEqual(rest(b)); // Time Base, Phase, Length, chord / insert mode, Size, scrambled order …
      expect(p.steps.length).toBe(b.steps.length); // no step added or removed (rests stay rests)
      b.steps.forEach((st, k) => expect(p.steps[k].length === 0).toBe(st.length === 0));
    }
    // only the Patterns changed: Variables, voices, conducting, Extended … are as they were
    const { patternGroups: _a, ...others } = s.comp;
    const { patternGroups: _b, ...othersBefore } = before;
    expect(others).toEqual(othersBefore);
  });
  it('afterwards each Pattern has its own scale: D minor everywhere, then one changed to E minor', () => {
    const s = mk();
    s.applyPatternScale(D_MINOR, 'all', 0);
    const scales = all(s.comp).map((x) => x.p.scale!);
    expect(new Set(scales).size).toBe(24); // 24 separate objects — no shared reference
    s.clickPosition('patternGroup', 2);
    s.setPatternScale(2, E_MINOR); // Group c, Voice 3 alone
    for (const { gi, v, p } of all(s.comp)) expect(p.scale).toEqual(gi === 2 && v === 2 ? E_MINOR : D_MINOR);
    // and a Group apply after that changes only that Group
    s.applyPatternScale({ root: 9, scale: 'dorian' }, 'group', 0);
    for (const { gi, p } of all(s.comp)) expect(p.scale).toEqual(gi === 2 ? { root: 9, scale: 'dorian' } : D_MINOR);
  });
  it('Chromatic leaves every note as it is (only the scale is set); applying the same scale twice changes nothing', () => {
    const s = mk();
    const before = structuredClone(s.comp.patternGroups);
    s.applyPatternScale(CHROMATIC, 'all', 0);
    for (const { gi, v, p } of all(s.comp)) {
      expect(p.steps).toEqual(before[gi].patterns[v].steps);
      expect(p.scale).toEqual(CHROMATIC);
    }
    s.applyPatternScale(D_MINOR, 'group', 0);
    const once = structuredClone(s.comp.patternGroups);
    expect(s.applyPatternScale(D_MINOR, 'group', 0)).toBe(0);
    expect(s.comp.patternGroups).toEqual(once);
    expect(s.status).toMatch(/Nothing to change/);
  });
  it('one Undo step brings back every scale and every note; Redo applies it again', () => {
    const s = mk();
    s.history.commit();
    const before = structuredClone(s.comp.patternGroups);
    s.applyPatternScale(D_MINOR, 'all', 0);
    s.history.commit();
    const after = structuredClone(s.comp.patternGroups);
    expect(s.undo()).toBe(true);
    expect(s.comp.patternGroups).toEqual(before);
    expect(s.redo()).toBe(true);
    expect(s.comp.patternGroups).toEqual(after);
  });
  it('saved and loaded with the document (format unchanged); older files without scales load as Chromatic', () => {
    const s = mk();
    s.applyPatternScale(D_MINOR, 'group', 0);
    s.clickPosition('patternGroup', 3);
    s.applyPatternScale(E_MINOR, 'pattern', 1);
    const text = serialize(s.comp);
    expect(JSON.parse(text).version).toBe(5);
    const back = deserialize(text).composition;
    expect(back.patternGroups).toEqual(s.comp.patternGroups);
    back.patternGroups.forEach((g, gi) => g.patterns.forEach((p, v) => expect(p.scale).toEqual(gi === 0 ? D_MINOR : gi === 3 && v === 1 ? E_MINOR : s.comp.patternGroups[gi].patterns[v].scale)));
    // an old file: no `scale` anywhere
    const doc = JSON.parse(text);
    for (const g of doc.composition.patternGroups) for (const p of g.patterns) delete p.scale;
    const old = deserialize(JSON.stringify(doc)).composition;
    for (const { gi, v, p } of all(old)) {
      expect(p.scale).toBeUndefined();
      expect(p.steps).toEqual(s.comp.patternGroups[gi].patterns[v].steps);
    }
  });
});
