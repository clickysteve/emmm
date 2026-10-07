/**
 * emmm's startup state ("New"). The *structure* follows M; the particular contents of the
 * six Positions are emmm's own choice (M shipped a startup file whose exact contents we do
 * not know — see UNCERTAINTIES.md). Position 1 of every Variable is a neutral "safe"
 * Position, as the M manual recommends keeping.
 */
import {
  DEFAULT_LEGATO_VALUES,
  DEFAULT_RHYTHM_VALUES,
  NUM_CHANNELS,
  NUM_POSITIONS,
  NUM_SLIDESHOWS,
  NUM_SNAPSHOTS,
  NUM_SOUND_CHOICES,
  NUM_VOICES,
} from './constants';
import { defaultExtended } from '../extended/extended';
import { newPattern } from './patternOps';
import { Rng } from './rng';
import type {
  ArrowDir,
  Composition,
  ConductTarget,
  ContinuousConducting,
  Cycle,
  NoteOrder,
  Pattern,
  Step,
  TimeMap,
  Variable,
  VelocityRange,
} from './types';

const V = NUM_VOICES;

function variable<T>(positions: T[]): Variable<T> {
  return { active: 0, positions, marked: positions.map(() => false) };
}
const each = <T>(f: (v: number) => T): T[] => Array.from({ length: V }, (_, v) => f(v));
const same = <T>(x: T): T[] => each(() => structuredClone(x));

/** Cycle from a list of levels or [lo,hi] ranges. */
export function cyc(...steps: (number | [number, number])[]): Cycle {
  return steps.map((s) => (Array.isArray(s) ? { lo: Math.min(...s), hi: Math.max(...s) } : { lo: s, hi: s }));
}

export function neutralMap(): TimeMap {
  return { points: [], count: 1, unit: 4 };
}

export const CONDUCT_TARGETS: ConductTarget[] = [
  'patternGroup',
  'noteDensity',
  'velocityRange',
  'noteOrder',
  'transposition',
  'timeDistortion',
  'accent',
  'legato',
  'rhythm',
  'orchestration',
  'soundChoice',
  'tempo',
  'snapshot',
];

function continuous(): ContinuousConducting {
  return { dirs: same<ArrowDir>('right'), voices: same(false), values: same<number | null>(null) };
}

export function emptyPatternGroup(): { patterns: Pattern[] } {
  return { patterns: each(() => newPattern([])) };
}

export function defaultComposition(seed = 38291): Composition {
  const vr = (lo: number, hi: number): VelocityRange => ({ lo, hi });
  const no = (original: number, cyclic: number): NoteOrder => ({ original, cyclic });

  const comp: Composition = {
    name: 'Untitled',
    seed,
    patternGroups: Array.from({ length: NUM_POSITIONS }, emptyPatternGroup),
    patternGroup: { active: 0 },
    noteDensity: variable([
      same(100),
      [100, 75, 75, 50],
      [75, 50, 100, 25],
      [50, 100, 50, 100],
      [100, 30, 30, 0],
      same(35),
    ]),
    velocityRange: variable([
      same(vr(64, 110)),
      [vr(90, 127), vr(40, 70), vr(40, 70), vr(40, 70)],
      [vr(40, 70), vr(90, 127), vr(40, 70), vr(40, 70)],
      [vr(40, 70), vr(40, 70), vr(90, 127), vr(40, 70)],
      [vr(40, 70), vr(40, 70), vr(40, 70), vr(90, 127)],
      same(vr(20, 127)),
    ]),
    noteOrder: variable([
      same(no(100, 0)),
      same(no(0, 100)),
      same(no(0, 0)),
      same(no(80, 20)),
      same(no(50, 0)),
      [no(100, 0), no(0, 100), no(50, 50), no(0, 0)],
    ]),
    transposition: variable([
      same(0),
      [0, 12, -12, 7],
      same(5),
      same(-5),
      [12, 7, 0, -12],
      same(2),
    ]),
    scaleLock: false,
    timeDistortion: variable([
      same(neutralMap()),
      same<TimeMap>({ points: [[0.62, 0.5]], count: 1, unit: 4 }), // swing
      same<TimeMap>({ points: [[0.15, 0.7]], count: 8, unit: 4 }), // flurry then slow (manual's example)
      same<TimeMap>({ points: [[0.25, 0.4], [0.5, 0.45], [0.75, 0.9]], count: 2, unit: 1 }), // rubato
      [neutralMap(), { points: [[0.6, 0.5]], count: 1, unit: 4 }, neutralMap(), { points: [[0.66, 0.5]], count: 1, unit: 4 }],
      each<TimeMap>((v) => ({ points: [[0.3 + v * 0.1, 0.5]], count: 4, unit: 4 })),
    ]),
    accent: variable([
      same(cyc(4)),
      same(cyc(4, 2, 2, 2)),
      same(cyc(4, 1, 1)),
      same(cyc([1, 4])),
      same(cyc(4, 0, 2, 3)),
      same(cyc(4, 1, 2, 1, 3, 1, 2, 1, 4, 1, 2, 0, 3, 1, [1, 4], [0, 4])),
    ]),
    legato: variable([
      same(cyc(2)),
      same(cyc(4)),
      same(cyc(1, 1, 1, 4)),
      same(cyc([0, 4])),
      same(cyc(0)),
      same(cyc(4, 2)),
    ]),
    rhythm: variable([
      same(cyc(1)),
      same(cyc(1, 0, 0)),
      same(cyc(2, 1, 1)),
      same(cyc(1, 1, 1, [0, 4])),
      same(cyc(1, 1, 1, 0, 0)),
      same(cyc(2)),
    ]),
    orchestration: variable([
      each((v) => [v + 1]),
      same([1]),
      [[1], [1], [2], [2]],
      each((v) => [((v + 1) % 4) + 1]),
      [[1, 2], [2, 3], [3, 4], [4, 1]],
      each((v) => [v + 1]),
    ]),
    soundChoice: {
      active: 0,
      positions: Array.from({ length: NUM_SOUND_CHOICES }, () => Array.from({ length: NUM_CHANNELS }, () => null)),
    },
    rhythmValues: [...DEFAULT_RHYTHM_VALUES],
    legatoValues: [...DEFAULT_LEGATO_VALUES],
    voices: each((v) => ({ src: 0, use: 'off', playEnable: v === 0, echoThru: false, mouseAdvance: false })),
    echoMap: Array.from({ length: NUM_CHANNELS }, () => false),
    tempo: { lo: 60, hi: 180, value: 120 },
    syncRatio: 4,
    conducting: {
      arrows: Object.fromEntries(CONDUCT_TARGETS.map((t) => [t, { enabled: false, dir: 'right' as ArrowDir }])) as Composition['conducting']['arrows'],
      baton: { x: 0.5, y: 0.5 },
      continuousVelocity: continuous(),
      continuousLegato: continuous(),
      continuousMode: { velocityRange: false, legato: false },
      robot: { enabled: false, hRange: 0.5, vRange: 0, rate: 1 },
    },
    quantization: 0,
    snapshots: Array.from({ length: NUM_SNAPSHOTS }, () => null),
    slideshows: Array.from({ length: NUM_SLIDESHOWS }, () => null),
    options: {
      useMetronome: false,
      sendClock: false,
      tapAffectsVelocity: false,
      dontScrambleRests: false,
      slideshowRecordWait: true,
      sustainEntersRests: false,
      midiConduct: false,
      secondOrderTranspose: false,
      noCyclicBlinking: false,
      syncRestartsSequence: true,
      editorSoundWhilePlaying: false,
      lockMarkedVariables: false,
      noZoomRects: false,
    },
    midi: {
      outputs: Array.from({ length: NUM_CHANNELS }, (_, i) => ({ port: '', channel: i + 1 })),
      inputs: Array.from({ length: NUM_CHANNELS }, (_, i) => ({ port: '*', channel: i + 1 })),
      firstProgramIsOne: Array.from({ length: NUM_CHANNELS }, () => true),
      latencyMs: 0,
      conductCtrlX: 1,
      conductCtrlY: 2,
      clockPort: '',
      clockIn: { enabled: false, port: '*', transport: true },
    },
    sequence: null,
    sequenceEnable: false,
    extended: defaultExtended(),
  };
  return comp;
}

const n = (name: string): number => {
  const m = /^([A-G])(#?)(-?\d)$/.exec(name);
  if (!m) throw new Error('bad note ' + name);
  const pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]]!;
  return pc + (m[2] ? 1 : 0) + (Number(m[3]) + 2) * 12;
};
/** Parse "C3 E3 [C3 E3 G3] - B3" into steps ("-" = rest, brackets = chord). M note names (C3 = 60). */
export function steps(src: string): Step[] {
  const out: Step[] = [];
  const re = /\[([^\]]*)\]|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1] !== undefined) out.push(m[1].trim().split(/\s+/).filter(Boolean).map(n));
    else if (m[2] === '-') out.push([]);
    else out.push([n(m[2])]);
  }
  return out;
}
export { n as parseNote };

/** A small demonstration composition (emmm's own material) loaded on first run. */
export function demoComposition(seed = 38291): Composition {
  const c = defaultComposition(seed);
  c.name = 'Jumping In';
  const rng = new Rng(seed, 99);
  const g = c.patternGroups[0].patterns;
  g[0] = newPattern(steps('C3 D3 E3 F3 G3 A3 B3 C4'), rng);
  g[1] = newPattern(steps('[C2 E3 G3 B3] [A1 E3 G3 C4] [F1 A2 E3 G3] [G1 B2 D3 F3]'), rng);
  g[1].tbDen = 1;
  g[2] = newPattern(steps('C2 - G1 - A1 C2 - E2'), rng);
  g[2].tbDen = 8;
  g[3] = newPattern(steps('E4 G4 - B4 D5 - - C5 A4 - G4 -'), rng);
  g[3].tbDen = 8;
  const b = c.patternGroups[1].patterns;
  b[0] = newPattern(steps('C3 E3 G3 B3'), rng);
  b[1] = newPattern(steps('[C3 E3 G3] [D3 F3 A3]'), rng);
  b[1].tbDen = 2;
  c.voices.forEach((v) => (v.playEnable = true));
  return c;
}
