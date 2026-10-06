/**
 * Mapping between M ticks and wall-clock milliseconds (performance.now() domain).
 *
 * Musical time is piecewise-linear in real time: each tempo change starts a new segment
 * anchored at (tick, ms). Pure and testable — no timers here.
 */
import { TICKS_PER_QUARTER } from '../engine/constants';

export function msPerTick(bpm: number): number {
  return 60000 / (Math.max(1, bpm) * TICKS_PER_QUARTER);
}

export class TickClock {
  anchorTick = 0;
  anchorMs = 0;
  bpm = 120;

  reset(atMs: number, bpm: number, tick = 0): void {
    this.anchorTick = tick;
    this.anchorMs = atMs;
    this.bpm = bpm;
  }

  /** Change tempo; the change takes effect from `atTick` onwards. */
  setTempo(bpm: number, atTick: number): void {
    if (bpm === this.bpm) return;
    this.anchorMs = this.tickToMs(atTick);
    this.anchorTick = atTick;
    this.bpm = bpm;
  }

  tickToMs(tick: number): number {
    return this.anchorMs + (tick - this.anchorTick) * msPerTick(this.bpm);
  }

  msToTick(ms: number): number {
    return this.anchorTick + (ms - this.anchorMs) / msPerTick(this.bpm);
  }
}
