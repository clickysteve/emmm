/**
 * Worked examples, mirrored in docs/EXAMPLES.md. Each: input material + settings →
 * exact output (tick: pitch/velocity, note-off tick). Ticks are 96 per quarter note.
 * [DOC] = follows from documented M behaviour; [INF] = depends on an inferred choice.
 */
import { describe, expect, it } from 'vitest';
import { cyc, defaultComposition, steps } from '../src/engine/defaults';
import { MEngine, type EngineEvent } from '../src/engine/engine';
import { newPattern } from '../src/engine/patternOps';
import { Rng } from '../src/engine/rng';
import type { Composition } from '../src/engine/types';
import { noteName } from '../src/engine/constants';

function voice1(src: string, set: (c: Composition) => void): Composition {
  const c = defaultComposition(38291);
  c.patternGroups[0].patterns[0] = newPattern(steps(src), new Rng(1));
  c.voices.forEach((v, i) => (v.playEnable = i === 0));
  set(c);
  return c;
}

/** "tick name vel→offTick" per note, in onset order */
function play(c: Composition, toTick: number): string[] {
  const e = new MEngine(c);
  e.start();
  const ev: EngineEvent[] = e.render(toTick);
  const offs = new Map<number, number>();
  ev.forEach((x) => x.kind === 'off' && offs.set(x.id, x.tick));
  return ev.filter((x) => x.kind === 'on').map((x) => (x.kind === 'on' ? `${+x.tick.toFixed(2)} ${noteName(x.pitch)} v${x.velocity}→${offs.has(x.id) ? +offs.get(x.id)!.toFixed(2) : '…'}` : ''));
}

describe('worked examples (docs/EXAMPLES.md)', () => {
  it('E1 [DOC] C3 E3 G3 B3, all Position 1 (1|4, rhythm ×1, legato 50%, accent 4, vel 64–110)', () => {
    expect(play(voice1('C3 E3 G3 B3', () => {}), 400)).toEqual(['0 C3 v110→48', '96 E3 v110→144', '192 G3 v110→240', '288 B3 v110→336', '384 C3 v110→…']);
  });

  it('E2 [DOC] same, Time Base 1|8, Rhythm cycle 1,0 (×1, ×½): long-short', () => {
    const c = voice1('C3 E3 G3 B3', (c) => {
      c.patternGroups[0].patterns[0].tbDen = 8;
      c.rhythm.positions[0][0] = cyc(1, 0);
    });
    // intervals 48, 24, 48, 24 … ; legato 50% of each interval
    expect(play(c, 150)).toEqual(['0 C3 v110→24', '48 E3 v110→60', '72 G3 v110→96', '120 B3 v110→132', '144 C3 v110→…']);
  });

  it('E3 [DOC rest at level 0; INF velocity mapping] Accent cycle 4,0,2,1 over vel 40–100', () => {
    const c = voice1('C3 E3 G3 B3', (c) => {
      c.accent.positions[0][0] = cyc(4, 0, 2, 1);
      c.velocityRange.positions[0][0] = { lo: 40, hi: 100 };
    });
    expect(play(c, 400)).toEqual(['0 C3 v100→48', '192 G3 v60→240', '288 B3 v40→336', '384 C3 v100→…']);
  });

  it('E4 [DOC] Legato cycle 4,1 with values 100% / 25%; transposition +7 (G3)', () => {
    const c = voice1('C3 E3', (c) => {
      c.legato.positions[0][0] = cyc(4, 1);
      c.transposition.positions[0][0] = 7;
    });
    expect(play(c, 200)).toEqual(['0 G3 v110→96', '96 B3 v110→120', '192 G3 v110→…']);
  });

  it('E5 [DOC] Phase 48 and two voices: an eighth-note echo', () => {
    const c = voice1('C3 D3', (c) => {
      c.patternGroups[0].patterns[1] = newPattern(steps('C4 D4'), new Rng(2));
      c.patternGroups[0].patterns[1].phase = 48;
      c.voices[1].playEnable = true;
    });
    expect(play(c, 150)).toEqual(['0 C3 v110→48', '48 C4 v110→96', '96 D3 v110→144', '144 D4 v110→…']);
  });

  it('E6 [INF, seeded] Cyclic Random 100%: one fixed reordering, repeated (scramble made by Rng(1))', () => {
    const c = voice1('C3 D3 E3 F3', (c) => (c.noteOrder.positions[0][0] = { original: 0, cyclic: 100 }));
    const names = play(c, 96 * 7).map((s) => s.split(' ')[1]);
    expect(names.slice(0, 4)).toEqual(names.slice(4, 8));
    expect(names.slice(0, 4).join(' ')).toMatchInlineSnapshot(`"C3 E3 D3 F3"`);
  });
});
