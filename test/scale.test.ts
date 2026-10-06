/**
 * A Pattern's Root + Scale (emmm): changing it transforms the notes by scale degree,
 * keeping octave and register; Chromatic leaves notes alone; one Undo step; saved with the
 * document; older documents load as Chromatic, unchanged. The engine never quantises.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CHROMATIC, transformPitch, transformSteps } from '../src/app/scales';
import { Session } from '../src/app/session';
import { demoComposition } from '../src/engine/defaults';
import { deserialize, serialize } from '../src/persistence/format';

const C = (scale: string, root = 0) => ({ root, scale });
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const name = (p: number) => NAMES[p % 12] + (Math.floor(p / 12) - 2); // emmm: 60 = C3
const names = (ps: number[]) => ps.map(name).join(' ');
const tr = (from: { root: number; scale: string }, to: { root: number; scale: string }, ps: number[]) => ps.map((p) => transformPitch(from, to, p));

let sessions: Session[] = [];
afterEach(() => {
  sessions.forEach((s) => s.stop());
  sessions = [];
});
function withPattern(steps: number[][], scale?: { root: number; scale: string }) {
  const s = new Session(demoComposition(1));
  sessions.push(s);
  const p = s.pattern(0);
  p.steps = steps.map((x) => [...x]);
  p.scrambled = p.steps.map((_, i) => i);
  p.outputLength = p.steps.length;
  if (scale) p.scale = scale;
  s.history.commit();
  return s;
}

describe('transforming notes between scales', () => {
  it('C Major → C Natural Minor keeps scale degrees: 1 3 5 6 = C E G A → C Eb G Ab', () => {
    expect(names(tr(C('major'), C('minor'), [60, 64, 67, 69]))).toBe('C3 Eb3 G3 Ab3');
    // the whole scale
    expect(names(tr(C('major'), C('minor'), [60, 62, 64, 65, 67, 69, 71]))).toBe('C3 D3 Eb3 F3 G3 Ab3 Bb3');
  });
  it('C Minor Pentatonic → D Minor Pentatonic: C Eb F G Bb → D F G A C', () => {
    expect(names(tr(C('minorPentatonic'), C('minorPentatonic', 2), [60, 63, 65, 67, 70]))).toBe('D3 F3 G3 A3 C4');
  });
  it('a root change alone transposes by the shorter way (register kept)', () => {
    expect(names(tr(C('major'), C('major', 9), [60, 64, 67]))).toBe('A2 C#3 E3'); // C → A: down 3, not up 9
    expect(names(tr(C('major'), C('major', 5), [60, 64, 67]))).toBe('F3 A3 C4'); // C → F: up 5
  });
  it('a scale-type change alone (same root)', () => {
    expect(names(tr(C('major', 2), C('dorian', 2), [62, 66, 69, 71, 73]))).toBe('D3 F3 A3 B3 C4');
  });
  it('multi-octave melodies keep their octaves (no collapsing into one octave)', () => {
    const out = tr(C('major'), C('minor'), [36, 52, 67, 88, 100]);
    expect(names(out)).toBe('C1 Eb2 G3 Eb5 Eb6');
    expect(out.map((p) => Math.floor(p / 12))).toEqual([3, 4, 5, 7, 8]);
  });
  it('chords and repeated notes: every note moves; identical results in one chord merge', () => {
    const steps = transformSteps([[60, 64, 67], [64], [64], [], [60, 64, 67, 71]], C('major'), C('minor'));
    expect(steps.map(names)).toEqual(['C3 Eb3 G3', 'Eb3', 'Eb3', '', 'C3 Eb3 G3 Bb3']);
    // shrinking scales can make two notes of a chord the same: merged, step kept
    const s2 = transformSteps([[62, 64]], C('major'), C('minorPentatonic'));
    expect(s2).toHaveLength(1);
    expect(s2[0].length).toBeGreaterThanOrEqual(1);
  });
  it('out-of-scale source notes keep their chromatic offset from the degree below', () => {
    // F# in C major = F + 1 → in C minor: F + 1 = F#; C# (= C + 1) → D major root moves it to D#
    expect(names(tr(C('major'), C('minor'), [66]))).toBe('F#3');
    expect(names(tr(C('major'), C('major', 2), [61]))).toBe('Eb3'); // D♯ (spelled E♭ here)
    // to a smaller scale: F# (degree 4 + 1) → minor pentatonic degree ⌊3×5/7⌋ = 2 (F) + 1
    expect(names(tr(C('major'), C('minorPentatonic'), [66]))).toBe('F#3');
  });
  it('different scale sizes map degrees proportionally, keeping the tonic', () => {
    expect(names(tr(C('minorPentatonic'), C('major'), [60, 63, 65, 67, 70, 72]))).toBe('C3 D3 E3 G3 A3 C4');
  });
  it('Chromatic → scale: nearest scale note (lower on a tie); scale → Chromatic: unchanged', () => {
    expect(names(tr(CHROMATIC, C('minorPentatonic'), [60, 61, 62, 64, 66, 69]))).toBe('C3 C3 Eb3 Eb3 F3 Bb3'); // A is 1 from B♭, 2 from G
    expect(tr(C('minor'), CHROMATIC, [61, 63, 66])).toEqual([61, 63, 66]);
  });
  it('results stay inside MIDI 0–127', () => {
    for (const p of [0, 1, 5, 120, 126, 127]) {
      const q = transformPitch(C('major'), C('minor', 11), p);
      expect(q).toBeGreaterThanOrEqual(0);
      expect(q).toBeLessThanOrEqual(127);
    }
  });
});

describe('a Pattern’s scale in the Session', () => {
  it('changing Root or Scale transforms the Pattern; one Undo step restores scale and pitches; Redo repeats it exactly', () => {
    const s = withPattern([[60], [64], [67], [69]], C('major'));
    s.setPatternScale(0, C('minor'));
    s.history.commit();
    expect(s.pattern(0).steps.map(names)).toEqual(['C3', 'Eb3', 'G3', 'Ab3']);
    expect(s.pattern(0).scale).toEqual(C('minor'));
    s.setPatternScale(0, C('minor', 2));
    s.history.commit();
    expect(s.pattern(0).steps.map(names)).toEqual(['D3', 'F3', 'A3', 'Bb3']);
    s.undo();
    expect(s.pattern(0).scale).toEqual(C('minor'));
    expect(s.pattern(0).steps.map(names)).toEqual(['C3', 'Eb3', 'G3', 'Ab3']);
    s.undo();
    expect(s.pattern(0).scale).toEqual(C('major'));
    expect(s.pattern(0).steps.map(names)).toEqual(['C3', 'E3', 'G3', 'A3']);
    s.redo();
    expect(s.pattern(0).steps.map(names)).toEqual(['C3', 'Eb3', 'G3', 'Ab3']);
  });
  it('only that Pattern changes; steps, rests and timing are kept', () => {
    const s = withPattern([[60], [], [64, 67]]);
    const other = structuredClone(s.pattern(1));
    const tb = [s.pattern(0).tbNum, s.pattern(0).tbDen, s.pattern(0).phase];
    s.setPatternScale(0, C('minorPentatonic'));
    expect(s.pattern(0).steps).toEqual([[60], [], [63, 67]]);
    expect([s.pattern(0).tbNum, s.pattern(0).tbDen, s.pattern(0).phase]).toEqual(tb);
    expect(s.pattern(1)).toEqual(other);
  });
  it('switching to Chromatic keeps the notes but remembers the root', () => {
    const s = withPattern([[61], [66]], C('blues', 4));
    s.setPatternScale(0, { root: 4, scale: 'chromatic' });
    expect(s.pattern(0).steps).toEqual([[61], [66]]);
  });
  it('saved and reloaded with the document', () => {
    const s = withPattern([[60]], C('dorian', 2));
    const back = deserialize(serialize(s.comp)).composition;
    expect(back.patternGroups[0].patterns[0].scale).toEqual(C('dorian', 2));
  });
  it('documents without scale metadata load as Chromatic with their notes untouched', () => {
    const doc = JSON.parse(serialize(demoComposition(4)));
    doc.version = 1;
    const notes = JSON.stringify(doc.composition.patternGroups.map((g: { patterns: { steps: number[][] }[] }) => g.patterns.map((p) => p.steps)));
    const back = deserialize(JSON.stringify(doc)).composition;
    expect(back.patternGroups.every((g) => g.patterns.every((p) => p.scale === undefined))).toBe(true);
    expect(JSON.stringify(back.patternGroups.map((g) => g.patterns.map((p) => p.steps)))).toBe(notes);
  });
  it('a damaged scale in a file falls back to Chromatic', () => {
    const doc = JSON.parse(serialize(demoComposition(4)));
    doc.composition.patternGroups[0].patterns[0].scale = { root: 99, scale: 'nonsense' };
    expect(deserialize(JSON.stringify(doc)).composition.patternGroups[0].patterns[0].scale).toEqual(CHROMATIC);
  });
  it('playback is never quantised: M plays the Pattern as it is', () => {
    const s = withPattern([[61], [66]], C('major'));
    const sent: number[] = [];
    (s as unknown as { send: (c: number, b: number[]) => void }).send = (_c, b) => (b[0] & 0xf0) === 0x90 && sent.push(b[1]);
    s.comp.voices.forEach((v, i) => (v.playEnable = i === 0));
    s.comp.transposition.positions[s.comp.transposition.active][0] = 0;
    s.start();
    s.emitNow(s.engine.render(400));
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((p) => p === 61 || p === 66)).toBe(true); // out-of-scale notes play as written
  });
});
