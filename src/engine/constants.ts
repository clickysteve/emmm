/**
 * Fixed numbers of M's world. See docs/M-BEHAVIOUR.md (§ references) and docs/PROVENANCE.md.
 */

export const NUM_VOICES = 4;
export const NUM_POSITIONS = 6;
export const NUM_SOUND_CHOICES = 16;
export const NUM_CHANNELS = 16;
export const NUM_SNAPSHOTS = 26;
export const NUM_SLIDESHOWS = 9;
export const MAX_CYCLE_STEPS = 16;
export const MAX_LEVEL = 4;
export const MAX_PATTERN_STEPS = 999; // §3 [DOC]
export const MAX_PHASE = 199; // §2 [DOC]
export const MAX_TB_NUMERATOR = 99; // §2 [DOC S2]

/** §2 [DOC] 96 ticks per quarter note. */
export const TICKS_PER_QUARTER = 96;
export const TICKS_PER_WHOLE = TICKS_PER_QUARTER * 4; // 384

/** §2 [DOC] legal Time Base denominators. 0 stands for "sa" (step advance). */
export const TIME_BASE_DENOMINATORS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 15, 16, 24] as const;
export const STEP_ADVANCE = 0;

/** M calls MIDI note 60 "C3" (§9 [DOC]). */
export const MIDDLE_C = 60;
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function noteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 2;
  return NOTE_NAMES[((midi % 12) + 12) % 12] + octave;
}

/** §5 [DOC] default Legato Value table, index = level. */
export const DEFAULT_LEGATO_VALUES = [6, 25, 50, 75, 100];
/** §5 levels 0,1 [DOC]; 2..4 [INF from manual screenshots]. @m-uncertain */
export const DEFAULT_RHYTHM_VALUES = [0.5, 1, 2, 3, 4];

/**
 * §6 How accent levels 1..4 map into the Velocity Range. @m-uncertain
 * 'spread': level1 = low, level4 = high (emmm default).
 * 'quarters': level k = low + range*k/4 (literal "quarters" reading).
 */
export type AccentMapping = 'spread' | 'quarters';
export const ACCENT_MAPPING: AccentMapping = 'spread';

/** §9 chord detection window for Chord record mode. @m-uncertain */
export const CHORD_WINDOW_MS = 40;

/** Note values used by quantization, sync ratio, robot rate, time-distortion units.
 * Expressed as fraction-of-whole denominators (4 = quarter, 6 = quarter triplet ... ). */
export const NOTE_VALUES = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32] as const;
export function noteValueTicks(den: number): number {
  return TICKS_PER_WHOLE / den;
}
