/**
 * Time Distortion (M-BEHAVIOUR §8).
 *
 * A map is a monotonic piecewise-linear function f: realTime -> clockTime on the unit
 * square, through (0,0), the user's breakpoints, and (1,1). The map repeats every
 * `length` ticks. A voice computes its events in *clock* time; an event at clock time c is
 * heard at real time warp(c) = floor(c/L)·L + L·f⁻¹((c mod L)/L).
 * Where f is steep, clock time passes quickly, so events crowd together.
 */
import { TICKS_PER_WHOLE } from './constants';
import type { TimeMap } from './types';

export function mapLength(m: TimeMap): number {
  return Math.max(1, m.count) * (TICKS_PER_WHOLE / Math.max(1, m.unit));
}

export function isNeutral(m: TimeMap): boolean {
  return m.points.every(([x, y]) => Math.abs(x - y) < 1e-9);
}

function knots(m: TimeMap): [number, number][] {
  return [[0, 0], ...m.points, [1, 1]];
}

/** Clamp/sort breakpoints so the map stays strictly increasing in both axes. */
export function sanitizePoints(points: [number, number][]): [number, number][] {
  const eps = 1e-3;
  const pts = points
    .map(([x, y]) => [Math.min(1 - eps, Math.max(eps, x)), Math.min(1 - eps, Math.max(eps, y))] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let px = 0;
  let py = 0;
  for (const [x, y] of pts) {
    if (x <= px + eps / 2 || y <= py + eps / 2) continue;
    out.push([x, y]);
    px = x;
    py = y;
  }
  return out;
}

/** f: real (0..1) -> clock (0..1) */
export function forward(m: TimeMap, r: number): number {
  const k = knots(m);
  for (let i = 1; i < k.length; i++) {
    const [x0, y0] = k[i - 1];
    const [x1, y1] = k[i];
    if (r <= x1) return x1 === x0 ? y1 : y0 + ((r - x0) * (y1 - y0)) / (x1 - x0);
  }
  return 1;
}

/** f⁻¹: clock (0..1) -> real (0..1) */
export function inverse(m: TimeMap, c: number): number {
  const k = knots(m);
  for (let i = 1; i < k.length; i++) {
    const [x0, y0] = k[i - 1];
    const [x1, y1] = k[i];
    if (c <= y1) return y1 === y0 ? x0 : x0 + ((c - y0) * (x1 - x0)) / (y1 - y0);
  }
  return 1;
}

/** Voice clock ticks -> real ticks (both measured from the voice's sync origin). */
export function warp(m: TimeMap | undefined, clock: number): number {
  if (!m || m.points.length === 0) return clock;
  const L = mapLength(m);
  const k = Math.floor(clock / L);
  const frac = clock / L - k;
  return k * L + L * inverse(m, frac);
}

/** Real ticks -> voice clock ticks (inverse of warp). */
export function unwarp(m: TimeMap | undefined, real: number): number {
  if (!m || m.points.length === 0) return real;
  const L = mapLength(m);
  const k = Math.floor(real / L);
  const frac = real / L - k;
  return k * L + L * forward(m, frac);
}
