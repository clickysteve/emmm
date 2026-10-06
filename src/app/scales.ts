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

// ---------------------------------------------------------------------------- transforming a Pattern

/**
 * Move one pitch from one scale to another (the Pattern's notes follow a change of its Root
 * or Scale). The rule, exactly:
 *
 * 1. To Chromatic: the pitch is unchanged.
 * 2. From Chromatic (or no scale): the nearest pitch of the new scale (the lower one when two
 *    are equally near).
 * 3. Scale to scale: the pitch keeps its scale degree and its octave above the root. The root
 *    moves the shorter way (−6 … +5 semitones), so a melody stays in its register. Scales of
 *    different sizes map degree d to ⌊d × n₂ / n₁⌋ (the tonic stays the tonic, the order of the
 *    degrees is kept).
 * 4. A pitch outside the old scale is taken as the scale degree just below it plus the same
 *    number of semitones, transformed by rule 3.
 * 5. A result outside MIDI 0–127 moves by octaves into range.
 */
export function transformPitch(from: ScaleChoice, to: ScaleChoice, pitch: number): number {
  const s2 = scaleById(to.scale).steps;
  if (s2.length === 12) return pitch;
  const s1 = scaleById(from.scale).steps;
  let out: number;
  if (s1.length === 12) out = snapToScale(to, pitch);
  else {
    const rel = pitch - from.root;
    const oct = Math.floor(rel / 12);
    const pc = rel - oct * 12;
    let d = s1.length - 1;
    while (d > 0 && s1[d] > pc) d--; // the degree at or just below
    const offset = pc - s1[d];
    const d2 = s1.length === s2.length ? d : Math.floor((d * s2.length) / s1.length);
    const shift = ((((to.root - from.root) % 12) + 18) % 12) - 6; // −6 … +5
    out = from.root + shift + oct * 12 + s2[d2] + offset;
  }
  while (out > 127) out -= 12;
  while (out < 0) out += 12;
  return out;
}

/** Transform every step of a Pattern; steps are never removed, identical pitches in one
 * chord merge (they would be the same MIDI note). */
export function transformSteps(steps: number[][], from: ScaleChoice, to: ScaleChoice): number[][] {
  return steps.map((st) => [...new Set(st.map((p) => transformPitch(from, to, p)))]);
}
