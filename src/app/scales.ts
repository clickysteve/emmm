/**
 * Scale assistance for the Pattern Editor — an editing aid only.
 *
 * A scale is a set of pitch classes (semitones above the root). It guides note entry in the
 * Pattern Editor; it never changes existing Pattern notes, and nothing in the engine reads
 * it, so M's generated output is never quantised to a scale.
 */

export interface Scale {
  id: string;
  name: string;
  /** semitone offsets from the root, ascending, starting with 0 */
  steps: readonly number[];
}

export const SCALES: readonly Scale[] = [
  { id: 'chromatic', name: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { id: 'major', name: 'Major / Ionian', steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', name: 'Natural Minor / Aeolian', steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'harmonicMinor', name: 'Harmonic Minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'melodicMinor', name: 'Melodic Minor', steps: [0, 2, 3, 5, 7, 9, 11] },
  { id: 'dorian', name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'phrygian', name: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  { id: 'lydian', name: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  { id: 'mixolydian', name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'locrian', name: 'Locrian', steps: [0, 1, 3, 5, 6, 8, 10] },
  { id: 'majorPentatonic', name: 'Major Pentatonic', steps: [0, 2, 4, 7, 9] },
  { id: 'minorPentatonic', name: 'Minor Pentatonic', steps: [0, 3, 5, 7, 10] },
  { id: 'blues', name: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
  { id: 'wholeTone', name: 'Whole Tone', steps: [0, 2, 4, 6, 8, 10] },
];

export const ROOT_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export function scaleById(id: string): Scale {
  return SCALES.find((s) => s.id === id) ?? SCALES[0];
}

export interface ScaleChoice {
  root: number; // pitch class 0..11
  scale: string; // Scale id
}

export const CHROMATIC: ScaleChoice = { root: 0, scale: 'chromatic' };

export function isChromatic(c: ScaleChoice): boolean {
  return scaleById(c.scale).steps.length === 12;
}

/** Is a MIDI pitch in the scale? */
export function inScale(c: ScaleChoice, pitch: number): boolean {
  const pc = (((pitch - c.root) % 12) + 12) % 12;
  return scaleById(c.scale).steps.includes(pc);
}

export function isRoot(c: ScaleChoice, pitch: number): boolean {
  return (((pitch - c.root) % 12) + 12) % 12 === 0;
}

/**
 * The scale pitch to enter for a click on `pitch`: the pitch itself if it is in the scale,
 * otherwise the nearest scale pitch (the lower one when two are equally near).
 */
export function snapToScale(c: ScaleChoice, pitch: number, lo = 0, hi = 127): number {
  if (inScale(c, pitch)) return pitch;
  for (let d = 1; d < 12; d++) {
    if (pitch - d >= lo && inScale(c, pitch - d)) return pitch - d;
    if (pitch + d <= hi && inScale(c, pitch + d)) return pitch + d;
  }
  return pitch;
}

/** Validate a stored choice (preferences can be hand-edited or stale). */
export function cleanChoice(v: unknown): ScaleChoice {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<ScaleChoice>;
  const root = Number.isInteger(o.root) && (o.root as number) >= 0 && (o.root as number) < 12 ? (o.root as number) : 0;
  const scale = SCALES.some((s) => s.id === o.scale) ? (o.scale as string) : 'chromatic';
  return { root, scale };
}
