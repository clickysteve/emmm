/**
 * emmm Pattern generators (not M): Random Melody, Random Walk, Arpeggio, Motif, Euclidean.
 * Each makes ordinary Pattern steps — a step is a list of pitches, [] a rest — from the notes of
 * a Root + Scale inside a pitch range. Nothing plays here: the result is edited and played like
 * any Pattern. Deterministic for a given Rng.
 */
import type { Rng } from '../engine/rng';
import type { Step } from '../engine/types';
import { inScale, type ScaleChoice } from './scales';

export type GeneratorId = 'random' | 'walk' | 'arpeggio' | 'motif' | 'euclidean';
export const GENERATORS: { id: GeneratorId; name: string; help: string }[] = [
  { id: 'random', name: 'Random Melody', help: 'Notes picked at random from the scale; Density = how many steps have a note' },
  { id: 'walk', name: 'Random Walk', help: 'Moves mostly to neighbouring scale notes; Variation = how often it leaps' },
  { id: 'arpeggio', name: 'Arpeggio', help: 'Every other scale note (root, third, fifth …) up, down or up-down; Variation adds octave jumps' },
  { id: 'motif', name: 'Motif', help: 'A short phrase repeated; Variation = how much each repeat changes (a note or two, or a shift)' },
  { id: 'euclidean', name: 'Euclidean', help: 'Density spreads the notes as evenly as possible over the steps (Euclidean rhythm); Variation = how far the pitches wander' },
];

export interface GenParams {
  generator: GeneratorId;
  scale: ScaleChoice;
  /** inclusive MIDI pitch range */
  lo: number;
  hi: number;
  steps: number;
  /** 0–100: share of steps with a note */
  density: number;
  /** 0–100: how much the material changes / leaps */
  variation: number;
  direction: 'up' | 'down' | 'updown';
}

/** The scale's notes within lo..hi (inclusive, clamped to 0–127), low to high. */
export function scalePool(scale: ScaleChoice, lo: number, hi: number): number[] {
  const a = Math.max(0, Math.min(lo, hi));
  const b = Math.min(127, Math.max(lo, hi));
  const out: number[] = [];
  for (let p = a; p <= b; p++) if (inScale(scale, p)) out.push(p);
  return out;
}

/** Euclidean rhythm: k onsets spread as evenly as possible over n steps (Bresenham form). */
export function euclid(k: number, n: number): boolean[] {
  const K = Math.max(0, Math.min(n, Math.round(k)));
  return Array.from({ length: n }, (_, i) => Math.floor(((i + 1) * K) / n) !== Math.floor((i * K) / n));
}

const clampI = (x: number, n: number) => Math.max(0, Math.min(n - 1, x));

/** Generate the steps, or null when the scale has no notes in the range. */
export function generate(p: GenParams, rng: Rng): Step[] | null {
  const pool = scalePool(p.scale, p.lo, p.hi);
  if (!pool.length) return null;
  const n = Math.max(1, Math.min(256, Math.round(p.steps)));
  const dens = Math.max(0, Math.min(100, p.density));
  const vari = Math.max(0, Math.min(100, p.variation)) / 100;
  const N = pool.length;
  const on = () => rng.chance(dens);
  const out: Step[] = [];
  switch (p.generator) {
    case 'random':
      for (let i = 0; i < n; i++) out.push(on() ? [pool[rng.int(0, N - 1)]] : []);
      break;
    case 'walk': {
      // mostly ±1 or ±2 scale notes; a leap (3–7 notes) with a chance that grows with Variation
      let at = Math.floor(N / 2);
      for (let i = 0; i < n; i++) {
        if (!on()) {
          out.push([]);
          continue;
        }
        out.push([pool[at]]);
        const leap = rng.next() < 0.05 + vari * 0.3;
        const size = leap ? rng.int(3, 7) : rng.int(1, 2);
        let next = at + (rng.next() < 0.5 ? -size : size);
        if (next < 0 || next >= N) next = at - (next - at); // turn back at the edges
        at = clampI(next, N);
      }
      break;
    }
    case 'arpeggio': {
      // chord tones: every other scale note from the lowest root-like start
      const tones = pool.filter((_, i) => i % 2 === 0);
      const order = p.direction === 'down' ? [...tones].reverse() : p.direction === 'updown' && tones.length > 2 ? [...tones, ...tones.slice(1, -1).reverse()] : tones;
      for (let i = 0; i < n; i++) {
        if (!on()) {
          out.push([]);
          continue;
        }
        let pitch = order[i % order.length];
        if (rng.next() < vari * 0.3) pitch += rng.next() < 0.5 ? -12 : 12;
        out.push([pitch >= pool[0] && pitch <= pool[N - 1] ? pitch : order[i % order.length]]);
      }
      break;
    }
    case 'motif': {
      // a 3–6 step phrase (a small walk), then repeats; each repeat may change a note or two
      // or shift a few notes by a scale step, so it stays recognisable
      const len = Math.min(n, rng.int(3, 6));
      let at = rng.int(Math.floor(N / 4), Math.max(Math.floor(N / 4), Math.floor((3 * N) / 4) - 1));
      const motif: number[] = []; // pool indices, −1 = rest
      for (let i = 0; i < len; i++) {
        motif.push(i === 0 || on() ? at : -1);
        at = clampI(at + rng.int(-2, 2), N);
      }
      for (let start = 0; start < n; start += len) {
        const phrase = [...motif];
        if (start > 0 && rng.next() < vari) {
          const changes = rng.int(1, 2);
          for (let c = 0; c < changes; c++) {
            const k = rng.int(1, len - 1);
            if (phrase[k] >= 0) phrase[k] = clampI(phrase[k] + (rng.next() < 0.5 ? -1 : 1) * rng.int(1, 2), N);
          }
          if (rng.next() < vari * 0.5) {
            const d = rng.next() < 0.5 ? -1 : 1;
            for (let k = Math.floor(len / 2); k < len; k++) if (phrase[k] >= 0) phrase[k] = clampI(phrase[k] + d, N);
          }
        }
        for (let k = 0; k < len && start + k < n; k++) out.push(phrase[k] >= 0 ? [pool[phrase[k]]] : []);
      }
      break;
    }
    case 'euclidean': {
      const hits = euclid((n * dens) / 100, n);
      // start on the root (the lowest one in range), then wander with Variation
      const root = pool.findIndex((x) => (((x - p.scale.root) % 12) + 12) % 12 === 0);
      let at = root >= 0 ? root : Math.floor(N / 2);
      for (let i = 0; i < n; i++) {
        if (!hits[i]) {
          out.push([]);
          continue;
        }
        out.push([pool[at]]);
        if (rng.next() < vari) at = clampI(at + rng.int(-3, 3), N);
      }
      break;
    }
  }
  return out;
}
