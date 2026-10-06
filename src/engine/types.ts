/**
 * The emmm composition model — M's state, expressed as plain serialisable data.
 * Everything a performance needs lives here; the engine (engine.ts) reads it live.
 * See docs/M-BEHAVIOUR.md and docs/ARCHITECTURE.md.
 */

/** A pattern step: MIDI pitches. [] = rest, one pitch = note, several = chord. */
export type Step = number[];

export type ChordMode = 'single' | 'chord' | 'build';
export type InsertMode = 'insert' | 'replace' | 'overdub';

/** M-BEHAVIOUR §3 */
export interface Pattern {
  steps: Step[];
  /** Cyclic Random order: a permutation of step indices. */
  scrambled: number[];
  outputLength: number;
  /** Time Base numerator (1..99) and denominator (see TIME_BASE_DENOMINATORS, 0 = sa). */
  tbNum: number;
  tbDen: number;
  /** Phase in ticks (0..199). */
  phase: number;
  chordMode: ChordMode;
  insertMode: InsertMode;
  drumMachine: boolean;
  /** Pattern Size numerical: maximum steps. */
  size: number;
}

/** A Pattern Group holds four patterns (one per voice). */
export interface PatternGroup {
  patterns: Pattern[];
}

/** One step of a cyclic variable: a level or a contiguous range of levels 0..4. */
export interface CycleStep {
  lo: number;
  hi: number;
}
/** One voice's cycle: 1..16 steps. */
export type Cycle = CycleStep[];

export interface VelocityRange {
  lo: number;
  hi: number;
}

/** Note Order percentages; utterly random = 100 - original - cyclic. */
export interface NoteOrder {
  original: number;
  cyclic: number;
}

/** Time distortion map for one voice (§8). Points are interior breakpoints in the unit
 * square, (realTime, clockTime), strictly increasing in both. (0,0) and (1,1) are implicit. */
export interface TimeMap {
  points: [number, number][];
  /** length = count × (whole / unit) */
  count: number;
  unit: number;
}

/** Generic Variable: six Positions, one active. */
export interface Variable<T> {
  active: number;
  positions: T[];
  marked: boolean[];
}

export type UseMode = 'off' | 'record' | 'transpose' | 'control' | 'echomap';

/** Per-voice Patterns-window settings that are *not* stored in the Pattern Group. */
export interface VoiceSettings {
  /** 0 = All, 1..16 = M Input Channel */
  src: number;
  use: UseMode;
  playEnable: boolean;
  echoThru: boolean;
  mouseAdvance: boolean;
}

export type ArrowDir = 'right' | 'left' | 'up' | 'down';
export interface ConductArrow {
  enabled: boolean;
  dir: ArrowDir;
}

/** The conductable targets (§10). */
export type VariableName =
  | 'patternGroup'
  | 'noteDensity'
  | 'velocityRange'
  | 'noteOrder'
  | 'transposition'
  | 'timeDistortion'
  | 'accent'
  | 'legato'
  | 'rhythm'
  | 'orchestration'
  | 'soundChoice';
export type ConductTarget = VariableName | 'tempo' | 'snapshot';

export interface ContinuousConducting {
  /** per-voice arrows & enable bricks */
  dirs: ArrowDir[];
  voices: boolean[];
  /** current per-voice values: offset (velocity) or multiplier (legato); null = inactive */
  values: (number | null)[];
}

export interface Conducting {
  arrows: Record<ConductTarget, ConductArrow>;
  /** Baton position in the grid, 0..1 each axis; y = 0 is the bottom. */
  baton: { x: number; y: number };
  continuousVelocity: ContinuousConducting;
  continuousLegato: ContinuousConducting;
  /** whether the variable arrow box is in "continuous" mode */
  continuousMode: { velocityRange: boolean; legato: boolean };
  robot: {
    enabled: boolean;
    /** max jump per move, 0..1 of grid width/height */
    hRange: number;
    vRange: number;
    /** rate as note value denominator: 1 (whole) .. 8 (eighth) */
    rate: number;
  };
}

export interface Tempo {
  lo: number;
  hi: number;
  value: number;
}

/** Snapshot item keys; values are what gets restored. */
export interface SnapshotVoiceItems {
  src?: number;
  playEnable?: boolean;
  echoThru?: boolean;
  mouseAdvance?: boolean;
  outputLength?: number;
  tbNum?: number;
  tbDen?: number;
  phase?: number;
}
export interface Snapshot {
  positions: Partial<Record<VariableName, number>>;
  arrows: Partial<Record<ConductTarget, ConductArrow>>;
  voices: SnapshotVoiceItems[];
  sync: boolean;
  sequenceEnable?: boolean;
}

export type SlideshowEvent =
  | { tick: number; kind: 'snapshot'; index: number }
  | { tick: number; kind: 'position'; variable: VariableName; position: number }
  | { tick: number; kind: 'baton'; x: number; y: number };
export interface Slideshow {
  events: SlideshowEvent[];
  /** tick length up to the loop point; null = no loop */
  loopLength: number | null;
}

export interface Options {
  useMetronome: boolean;
  sendClock: boolean;
  tapAffectsVelocity: boolean;
  dontScrambleRests: boolean;
  slideshowRecordWait: boolean;
  sustainEntersRests: boolean;
  midiConduct: boolean;
  secondOrderTranspose: boolean;
  noCyclicBlinking: boolean;
  syncRestartsSequence: boolean;
  editorSoundWhilePlaying: boolean;
  lockMarkedVariables: boolean;
}

export interface MidiPortAssignment {
  /** Web MIDI port id, '' = none, 'monitor' = emmm's internal monitor */
  port: string;
  /** 1..16 */
  channel: number;
}

export interface MidiConfig {
  outputs: MidiPortAssignment[]; // 16 M Output Channels
  inputs: MidiPortAssignment[]; // 16 M Input Channels
  /** per output channel: program numbers displayed from 1 (true) or 0 (false) */
  firstProgramIsOne: boolean[];
  latencyMs: number;
  conductCtrlX: number;
  conductCtrlY: number;
  clockPort: string;
}

export interface Composition {
  name: string;
  seed: number;
  patternGroups: PatternGroup[];
  patternGroup: { active: number };
  noteDensity: Variable<number[]>;
  velocityRange: Variable<VelocityRange[]>;
  noteOrder: Variable<NoteOrder[]>;
  transposition: Variable<number[]>;
  timeDistortion: Variable<TimeMap[]>;
  accent: Variable<Cycle[]>;
  legato: Variable<Cycle[]>;
  rhythm: Variable<Cycle[]>;
  /** each position: 4 voices × list of enabled M Output Channels (1..16) */
  orchestration: Variable<number[][]>;
  /** 16 positions × 16 channels; null = no program change */
  soundChoice: { active: number; positions: (number | null)[][] };
  rhythmValues: number[];
  legatoValues: number[];
  voices: VoiceSettings[];
  echoMap: boolean[];
  tempo: Tempo;
  /** Metronome / sync ratio: note value of the click (4 = quarter). */
  syncRatio: number;
  conducting: Conducting;
  quantization: number; // 0 = none, else note value denominator
  snapshots: (Snapshot | null)[];
  slideshows: (Slideshow | null)[];
  options: Options;
  midi: MidiConfig;
}
