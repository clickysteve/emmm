/**
 * MIDI clock input (MIDI Settings): follow an external tempo and, optionally, its Start /
 * Stop / Continue. This is MIDI infrastructure, not an Extended feature: it works whether or
 * not Extended is on (until format v4 it lived in, and depended on, Extended).
 */

/** External-clock sync status, for display. */
export type SyncStatus = 'internal' | 'waiting' | 'running' | 'lost';

/** A gap this long between clock pulses means the clock has stopped or been unplugged
 * (24 ppq at 20 bpm is one pulse every 125 ms). */
export const CLOCK_LOST_MS = 400;

/**
 * MIDI clock follower: estimates tempo from 24-ppq pulses and nudges it to stay in phase
 * with the pulse count (a gentle, bounded proportional correction).
 *
 * The estimate is a trimmed mean of the last 24 pulse intervals, so jittery USB/IAC timing
 * does not make the tempo wobble. A gap longer than CLOCK_LOST_MS marks the clock lost:
 * the tempo then simply stays where it was (no runaway), and when pulses return the
 * estimate starts again from fresh intervals.
 */
export class ClockFollower {
  private intervals: number[] = [];
  private last = -Infinity;
  pulses = 0;
  running = false;
  lastPulseMs = -Infinity;
  /** set when pulses resume after a loss; the owner re-aligns the phase (rebase) */
  recovered = false;

  reset(): void {
    this.intervals = [];
    this.last = -Infinity;
    this.pulses = 0;
    this.lastPulseMs = -Infinity;
    this.recovered = false;
  }

  /** Feed one 0xF8 pulse at time `ms`. Returns the bpm estimate (or null while warming up). */
  pulse(ms: number): number | null {
    this.pulses++;
    this.lastPulseMs = ms;
    const gap = ms - this.last;
    this.last = ms;
    if (!(gap > 0) || gap > CLOCK_LOST_MS) {
      // first pulse, or recovering after a loss: start the estimate again
      this.intervals = [];
      if (gap > CLOCK_LOST_MS && gap !== Infinity) this.recovered = true;
      return null;
    }
    this.intervals.push(gap);
    if (this.intervals.length > 24) this.intervals.shift();
    if (this.intervals.length < 6) return null;
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const cut = Math.floor(sorted.length / 5);
    const mid = sorted.slice(cut, sorted.length - cut);
    const mean = mid.reduce((a, b) => a + b, 0) / mid.length;
    return 60000 / (mean * 24);
  }

  /** Status at time `now` (ms), given that clock input is enabled. */
  status(now: number, playing: boolean): SyncStatus {
    if (this.lastPulseMs === -Infinity) return 'waiting';
    if (now - this.lastPulseMs > CLOCK_LOST_MS) return playing ? 'lost' : 'waiting';
    return playing ? 'running' : 'waiting';
  }

  /** After a loss, count pulses from where emmm is now instead of chasing the gap. */
  rebase(nowTick: number): void {
    this.pulses = Math.round(nowTick / 4);
    this.recovered = false;
  }

  /** Expected M tick for the pulses received since Start (96 ticks per quarter). */
  expectedTick(): number {
    return this.pulses * 4;
  }

  /** Tempo with phase correction: `nowTick` is where emmm is; gain is per beat of error. */
  corrected(bpm: number, nowTick: number, gain = 0.1): number {
    const errBeats = (this.expectedTick() - nowTick) / 96;
    const k = Math.max(-0.15, Math.min(0.15, errBeats * gain));
    return bpm * (1 + k);
  }
}
