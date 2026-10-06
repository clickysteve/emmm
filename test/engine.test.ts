import { describe, expect, it } from 'vitest';
import { cyc, defaultComposition, steps } from '../src/engine/defaults';
import { MEngine, type EngineEvent, type NoteOnEvent, type NoteOffEvent, type StepEvent } from '../src/engine/engine';
import { newPattern } from '../src/engine/patternOps';
import { Rng } from '../src/engine/rng';
import type { Composition } from '../src/engine/types';

/** A composition where only voice 1 plays `src` with neutral Position 1 everywhere. */
function solo(src: string, mutate?: (c: Composition) => void): Composition {
  const c = defaultComposition(38291);
  c.patternGroups[0].patterns[0] = newPattern(steps(src), new Rng(1));
  c.voices.forEach((v, i) => (v.playEnable = i === 0));
  mutate?.(c);
  return c;
}

function run(c: Composition, toTick: number): EngineEvent[] {
  const e = new MEngine(c);
  e.start();
  return e.render(toTick);
}
const ons = (ev: EngineEvent[]) => ev.filter((e): e is NoteOnEvent => e.kind === 'on');
const offs = (ev: EngineEvent[]) => ev.filter((e): e is NoteOffEvent => e.kind === 'off');
const stepsOf = (ev: EngineEvent[], v = 0) => ev.filter((e): e is StepEvent => e.kind === 'step' && e.voice === v);

describe('pattern traversal (§4) — documented behaviour', () => {
  it('Original Order plays the pattern in order, one step per quarter at 1|4, and loops', () => {
    // Input C3 E3 G3 B3, Time Base 1|4, Rhythm level 1 (×1), all Position 1.
    const ev = run(solo('C3 E3 G3 B3'), 96 * 7);
    expect(ons(ev).map((e) => [e.tick, e.pitch])).toEqual([
      [0, 60],
      [96, 64],
      [192, 67],
      [288, 71],
      [384, 60],
      [480, 64],
      [576, 67],
      [672, 71],
    ]);
  });

  it('Time Base denominator 8 doubles speed; numerator 3 slows by three (§2)', () => {
    const e8 = run(solo('C3 E3', (c) => (c.patternGroups[0].patterns[0].tbDen = 8)), 96);
    expect(ons(e8).map((e) => e.tick)).toEqual([0, 48, 96]);
    const e3 = run(solo('C3 E3', (c) => (c.patternGroups[0].patterns[0].tbNum = 3)), 600);
    expect(ons(e3).map((e) => e.tick)).toEqual([0, 288, 576]);
  });

  it('non-integer time bases keep exact time (1|5 = 76.8 ticks) [DOC table]', () => {
    const ev = run(solo('C3', (c) => (c.patternGroups[0].patterns[0].tbDen = 5)), 400);
    expect(ons(ev).map((e) => +e.tick.toFixed(3))).toEqual([0, 76.8, 153.6, 230.4, 307.2, 384]);
  });

  it('Output Length shorter than the pattern restarts early (§3)', () => {
    const ev = run(solo('C3 D3 E3 F3', (c) => (c.patternGroups[0].patterns[0].outputLength = 2)), 96 * 3);
    expect(ons(ev).map((e) => e.pitch)).toEqual([60, 62, 60, 62]);
  });

  it('Output Length 0 is silent but the cycles keep running', () => {
    const ev = run(solo('C3 D3', (c) => (c.patternGroups[0].patterns[0].outputLength = 0)), 96 * 3);
    expect(ons(ev)).toHaveLength(0);
    expect(stepsOf(ev)).toHaveLength(4);
  });

  it('rests consume a step and produce no note', () => {
    const ev = run(solo('C3 - E3'), 96 * 2);
    expect(ons(ev).map((e) => [e.tick, e.pitch])).toEqual([
      [0, 60],
      [192, 64],
    ]);
  });

  it('chords sound together', () => {
    const ev = run(solo('[C3 E3 G3]'), 0);
    expect(ons(ev).map((e) => e.pitch).sort()).toEqual([60, 64, 67]);
  });

  it('Phase delays the voice by ticks after Start (§2)', () => {
    const ev = run(solo('C3', (c) => (c.patternGroups[0].patterns[0].phase = 48)), 200);
    expect(ons(ev).map((e) => e.tick)).toEqual([48, 144]);
  });
});

describe('Rhythm cycle (§5) — documented worked example', () => {
  it('levels 1 and 0 at 1|16 give 24 and 12 ticks (manual ch.7 example)', () => {
    const ev = run(
      solo('C3', (c) => {
        c.patternGroups[0].patterns[0].tbDen = 16;
        c.rhythm.positions[0][0] = cyc(1, 0);
      }),
      110,
    );
    expect(ons(ev).map((e) => e.tick)).toEqual([0, 24, 36, 60, 72, 96, 108]);
  });

  it('1|6 gives 64 and 32 ticks for the same cycle', () => {
    const ev = run(
      solo('C3', (c) => {
        c.patternGroups[0].patterns[0].tbDen = 6;
        c.rhythm.positions[0][0] = cyc(1, 0);
      }),
      200,
    );
    expect(ons(ev).map((e) => e.tick)).toEqual([0, 64, 96, 160, 192]);
  });

  it('Rhythm Value table is global and editable', () => {
    const ev = run(
      solo('C3', (c) => {
        c.rhythm.positions[0][0] = cyc(0);
        c.rhythmValues[0] = 1.5;
      }),
      300,
    );
    expect(ons(ev).map((e) => e.tick)).toEqual([0, 144, 288]);
  });
});

describe('Legato (§5) — durations are a percentage of the time to the next note', () => {
  it('default level 2 = 50% of a quarter', () => {
    const ev = run(solo('C3'), 100);
    const off = offs(ev)[0];
    expect(off.tick).toBe(48);
  });
  it('400% overlaps following notes; repeated pitch is re-attacked cleanly', () => {
    const ev = run(
      solo('C3 E3', (c) => {
        c.legato.positions[0][0] = cyc(4);
        c.legatoValues[4] = 400;
      }),
      96 * 2,
    );
    const on = ons(ev);
    expect(on.map((e) => e.pitch)).toEqual([60, 64, 60]);
    // C3 at 192 re-attacks the still-sounding C3 from tick 0: an off is sent first.
    const offAt192 = offs(ev).filter((o) => o.tick === 192 && o.pitch === 60);
    expect(offAt192).toHaveLength(1);
  });
  it('legato tracks the rhythm, not the clock (manual: 4-step legato over a 2-step rhythm)', () => {
    const ev = run(
      solo('C3', (c) => {
        c.rhythm.positions[0][0] = cyc(1, 3); // 96, 288 ticks
        c.legato.positions[0][0] = cyc(4, 0, 0, 0);
      }),
      96 * 8,
    );
    const lv = stepsOf(ev).map((s) => s.levels.legato);
    expect(lv.slice(0, 5)).toEqual([4, 0, 0, 0, 4]);
  });
});

describe('Accent and Velocity Range (§6)', () => {
  it('accent level 0 silences the step', () => {
    const ev = run(solo('C3', (c) => (c.accent.positions[0][0] = cyc(4, 0))), 96 * 3);
    expect(ons(ev).map((e) => e.tick)).toEqual([0, 192]);
  });
  it('levels map across the range: 1 = low, 4 = high', () => {
    const ev = run(
      solo('C3', (c) => {
        c.accent.positions[0][0] = cyc(4, 1, 2, 3);
        c.velocityRange.positions[0][0] = { lo: 40, hi: 100 };
      }),
      96 * 3,
    );
    expect(ons(ev).map((e) => e.velocity)).toEqual([100, 40, 60, 80]);
  });
  it('single-value range gives one dynamic regardless of accent levels', () => {
    const ev = run(
      solo('C3', (c) => {
        c.accent.positions[0][0] = cyc(4, 1, 2);
        c.velocityRange.positions[0][0] = { lo: 90, hi: 90 };
      }),
      96 * 2,
    );
    expect(new Set(ons(ev).map((e) => e.velocity))).toEqual(new Set([90]));
  });
  it('a range step picks among its levels, all of them eventually', () => {
    const ev = run(solo('C3', (c) => (c.accent.positions[0][0] = cyc([0, 4]))), 96 * 400);
    const lv = new Set(stepsOf(ev).map((s) => s.levels.accent));
    expect(lv).toEqual(new Set([0, 1, 2, 3, 4]));
    const rests = stepsOf(ev).filter((s) => s.levels.accent === 0).length / stepsOf(ev).length;
    expect(rests).toBeGreaterThan(0.12); // manual: "about 20 percent"
    expect(rests).toBeLessThan(0.28);
  });
});

describe('Note Density (§7)', () => {
  it('0% never plays, 100% always plays', () => {
    expect(ons(run(solo('C3', (c) => (c.noteDensity.positions[0][0] = 0)), 960))).toHaveLength(0);
    expect(ons(run(solo('C3'), 960))).toHaveLength(11);
  });
  it('50% plays about half, and skipped notes still consume their step', () => {
    const ev = run(solo('C3 D3 E3 F3', (c) => (c.noteDensity.positions[0][0] = 50)), 96 * 999);
    const n = ons(ev).length;
    expect(n / 1000).toBeGreaterThan(0.44);
    expect(n / 1000).toBeLessThan(0.56);
    // position is tied to time: step k always sounds pitch k
    for (const o of ons(ev)) expect(o.pitch).toBe([60, 62, 64, 65][Math.round(o.tick / 96) % 4]);
  });
});

describe('Note Order (§4)', () => {
  it('Cyclic Random repeats the scrambled order every Output Length', () => {
    const ev = run(solo('C3 D3 E3 F3 G3 A3 B3 C4', (c) => (c.noteOrder.positions[0][0] = { original: 0, cyclic: 100 })), 96 * 23);
    const p = ons(ev).map((e) => e.pitch);
    expect(p.slice(0, 8)).toEqual(p.slice(8, 16));
    expect([...p.slice(0, 8)].sort()).toEqual([60, 62, 64, 65, 67, 69, 71, 72].sort());
  });
  it('Utterly Random only picks pitches from the pattern, non-repetitively', () => {
    const ev = run(solo('C3 D3 E3 F3', (c) => (c.noteOrder.positions[0][0] = { original: 0, cyclic: 0 })), 96 * 99);
    const p = ons(ev).map((e) => e.pitch);
    expect(new Set(p)).toEqual(new Set([60, 62, 64, 65]));
    expect(p.slice(0, 4)).not.toEqual(p.slice(4, 8));
  });
  it('mixing 50/50 uses both schemes', () => {
    const ev = run(solo('C3 D3 E3 F3', (c) => (c.noteOrder.positions[0][0] = { original: 50, cyclic: 50 })), 96 * 199);
    const schemes = new Set(stepsOf(ev).map((s) => s.scheme));
    expect(schemes).toEqual(new Set(['original', 'cyclic']));
  });
});

describe('Transposition, Orchestration (§4)', () => {
  it('transposes by semitones relative to C3', () => {
    const ev = run(solo('C3', (c) => (c.transposition.positions[0][0] = 15)), 0);
    expect(ons(ev)[0].pitch).toBe(75);
  });
  it('a voice can be sent to several output channels; voices can merge', () => {
    const c = solo('C3', (c) => {
      c.orchestration.positions[0] = [[1, 2], [1], [3], [4]];
      c.patternGroups[0].patterns[1] = newPattern(steps('E3'), new Rng(2));
      c.voices[1].playEnable = true;
    });
    const ev = run(c, 0);
    expect(ons(ev).map((e) => [e.voice, e.channel])).toEqual([
      [0, 1],
      [0, 2],
      [1, 1],
    ]);
  });
  it('keyboard transpose: E3 = up a major third; second-order adds to the Variable', () => {
    const c = solo('C3', (c) => (c.transposition.positions[0][0] = 12));
    const e = new MEngine(c);
    e.start();
    e.keyboardTranspose(0, 64);
    expect(ons(e.render(0))[0].pitch).toBe(64);
    c.options.secondOrderTranspose = true;
    expect(ons(e.render(96))[0].pitch).toBe(76);
  });
});

describe('channel separation and voices', () => {
  it('voices run independent time bases (anything against anything)', () => {
    const c = solo('C3', (c) => {
      c.patternGroups[0].patterns[0].tbDen = 3;
      c.patternGroups[0].patterns[1] = newPattern(steps('G3'), new Rng(2));
      c.patternGroups[0].patterns[1].tbDen = 4;
      c.voices[1].playEnable = true;
    });
    const ev = run(c, 384);
    expect(ons(ev).filter((e) => e.voice === 0).map((e) => e.tick)).toEqual([0, 128, 256, 384]);
    expect(ons(ev).filter((e) => e.voice === 1).map((e) => e.tick)).toEqual([0, 96, 192, 288, 384]);
  });
  it('Play-Enable off mutes but the voice keeps its place', () => {
    const c = solo('C3 D3 E3');
    const e = new MEngine(c);
    e.start();
    e.render(0);
    c.voices[0].playEnable = false;
    e.render(96);
    c.voices[0].playEnable = true;
    expect(ons(e.render(192))[0].pitch).toBe(64);
  });
});

describe('transport (§11)', () => {
  it('Stop turns sounding notes off', () => {
    const c = solo('C3', (c) => (c.legato.positions[0][0] = cyc(4)));
    const e = new MEngine(c);
    e.start();
    e.render(10);
    const ev = e.stop();
    expect(offs(ev).map((o) => o.pitch)).toEqual([60]);
    expect(e.render(500)).toHaveLength(0);
  });
  it('Sync resets all voices to their first step and first cycle step', () => {
    const c = solo('C3 D3 E3 F3');
    const e = new MEngine(c);
    e.start();
    e.render(150);
    e.sync(150);
    expect(ons(e.render(150))[0].pitch).toBe(60);
  });
  it('Pause freezes everything; notes are not released', () => {
    const c = solo('C3 D3');
    const e = new MEngine(c);
    e.start();
    e.render(10);
    e.pause();
    expect(e.render(1000)).toHaveLength(0);
    e.pause();
    const ev = e.render(96);
    expect(offs(ev)[0].tick).toBe(48);
    expect(ons(ev)[0].pitch).toBe(62);
  });
  it('selecting a Pattern Group syncs (§3)', () => {
    const c = solo('C3 D3 E3');
    c.patternGroups[1].patterns[0] = newPattern(steps('G3 A3'), new Rng(3));
    const e = new MEngine(c);
    e.start();
    e.render(100);
    e.selectPosition('patternGroup', 1, 100);
    expect(ons(e.render(100))[0].pitch).toBe(67);
  });
});

describe('deterministic randomness (§13)', () => {
  const busy = (seed: number) =>
    solo('C3 D3 E3 F3 G3', (c) => {
      c.seed = seed;
      c.noteOrder.positions[0][0] = { original: 20, cyclic: 30 };
      c.noteDensity.positions[0][0] = 70;
      c.accent.positions[0][0] = cyc([0, 4], 3);
      c.rhythm.positions[0][0] = cyc([0, 3]);
      c.legato.positions[0][0] = cyc([0, 4]);
    });
  const sig = (ev: EngineEvent[]) => ons(ev).map((e) => `${e.tick.toFixed(2)}:${e.pitch}:${e.velocity}`);

  it('same seed + settings = identical output', () => {
    expect(sig(run(busy(38291), 5000))).toEqual(sig(run(busy(38291), 5000)));
  });
  it('different seeds differ', () => {
    expect(sig(run(busy(38291), 5000))).not.toEqual(sig(run(busy(1234), 5000)));
  });
  it('restarting re-seeds, so a second Start reproduces the first', () => {
    const c = busy(777);
    const e = new MEngine(c);
    e.start();
    const a = sig(e.render(3000));
    e.stop();
    e.start();
    expect(sig(e.render(3000))).toEqual(a);
  });
  it('render granularity does not change output', () => {
    const c = busy(42);
    const e1 = new MEngine(c);
    e1.start();
    const whole = sig(e1.render(4000));
    const e2 = new MEngine(busy(42));
    e2.start();
    const parts: EngineEvent[] = [];
    for (let t = 0; t <= 4000; t += 7.3) parts.push(...e2.render(t));
    parts.push(...e2.render(4000));
    expect(sig(parts)).toEqual(whole);
  });
});

describe('parameter changes while running', () => {
  it('a change is heard at the next event', () => {
    const c = solo('C3');
    const e = new MEngine(c);
    e.start();
    e.render(0);
    c.transposition.positions[0][0] = 7;
    expect(ons(e.render(96))[0].pitch).toBe(67);
    e.selectPosition('transposition', 1, 96); // position 2: voice 1 = 0
    expect(ons(e.render(192))[0].pitch).toBe(60);
  });
  it('cycle counters survive a Position change and wrap to the new length', () => {
    const c = solo('C3', (c) => {
      c.accent.positions[0][0] = cyc(4, 3, 2, 1);
      c.accent.positions[1][0] = cyc(1, 2);
    });
    const e = new MEngine(c);
    e.start();
    e.render(96 * 2); // used steps 0,1,2 → counter at 3
    e.selectPosition('accent', 1, 192);
    const s = stepsOf(e.render(96 * 4));
    expect(s.map((x) => x.levels.accent)).toEqual([2, 1]); // index 3%2=1 → 2, then 0 → 1
  });
});

describe('step advance (Time Base sa)', () => {
  it('sa voices are silent on the clock and play one event per key, held until release', () => {
    const c = solo('C3 D3', (c) => (c.patternGroups[0].patterns[0].tbDen = 0));
    const e = new MEngine(c);
    e.start();
    expect(ons(e.render(500))).toHaveLength(0);
    const a = e.stepAdvance(0, 99, 500);
    expect(ons(a).map((x) => [x.pitch, x.velocity])).toEqual([[60, 99]]);
    expect(offs(e.render(10000))).toHaveLength(0);
    expect(offs(e.stepRelease(0, 10000)).map((x) => x.pitch)).toEqual([60]);
    expect(ons(e.stepAdvance(0, 50, 10001))[0].pitch).toBe(62);
  });
});

describe('mouse advance', () => {
  it('the voice stays at its step while the gate is closed', () => {
    const c = solo('C3 D3 E3', (c) => (c.voices[0].mouseAdvance = true));
    const e = new MEngine(c);
    e.start();
    expect(ons(e.render(300))).toHaveLength(0);
    e.mouseAdvanceActive = true;
    expect(ons(e.render(500)).map((x) => x.pitch)).toEqual([60, 62]);
  });
});
