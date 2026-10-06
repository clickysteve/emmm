/**
 * Look-ahead scheduler ("A Tale of Two Clocks" pattern).
 *
 * A worker-driven timer wakes every ~10 ms (workers are not throttled like main-thread
 * timers in background tabs). Each wake-up asks the engine for every event up to
 * `now + lookahead`, converts ticks to performance.now() timestamps with the TickClock, and
 * hands them to the sink, which sends timestamped Web MIDI messages. Musical timing is
 * therefore decided by MIDIOutput.send timestamps, not by when the JavaScript runs. The UI
 * draws from a separate requestAnimationFrame loop.
 */
import { TICKS_PER_QUARTER } from '../engine/constants';
import type { EngineEvent, MEngine } from '../engine/engine';
import { TickClock } from './clock';

export interface SchedulerSink {
  /** Events rendered by the engine with their absolute timestamps. */
  events(events: EngineEvent[], tickToMs: (tick: number) => number): void;
  /** MIDI clock pulse (24 ppq) at a timestamp; `beat` = metronome click time if on a click. */
  pulse(ms: number, isClick: boolean, isDownbeat: boolean): void;
}

const WORKER_SRC = `let id=null;onmessage=e=>{if(e.data==='start'){if(id===null)id=setInterval(()=>postMessage('t'),${10});}else if(e.data==='stop'){clearInterval(id);id=null;}}`;

export class Scheduler {
  readonly clock = new TickClock();
  lookaheadMs = 60;
  /** extra delay before the first event after Start, so it is not late */
  startDelayMs = 30;
  private worker: Worker | null = null;
  private fallback: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private nextPulseTick = 0;
  private lastState: string = 'stopped';
  /** Rendering never passes this tick (Tap Conduct waits for the next tap). */
  limitTick = Infinity;

  constructor(
    private engine: MEngine,
    private getTempo: () => number,
    private getSyncRatio: () => number,
    private sink: SchedulerSink,
  ) {}

  private ensureTimer(): void {
    if (this.running) return;
    this.running = true;
    try {
      if (!this.worker && typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
        const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
        this.worker = new Worker(url);
        this.worker.onmessage = () => this.wake();
      }
      if (this.worker) this.worker.postMessage('start');
      else this.fallback = setInterval(() => this.wake(), 10);
    } catch {
      this.fallback = setInterval(() => this.wake(), 10);
    }
  }

  private haltTimer(): void {
    this.running = false;
    this.worker?.postMessage('stop');
    if (this.fallback) clearInterval(this.fallback);
    this.fallback = null;
  }

  /** Call after engine.start() from stopped. */
  started(): void {
    this.clock.reset(performance.now() + this.startDelayMs, this.getTempo(), 0);
    this.nextPulseTick = 0;
    this.lastState = 'playing';
    this.ensureTimer();
    this.wake();
  }

  stopped(): void {
    this.lastState = 'stopped';
    this.haltTimer();
  }

  /** Call after engine.pause() toggles. */
  pauseToggled(): void {
    if (this.engine.state === 'playing' && this.lastState === 'paused') {
      // resume where we left off: the render frontier becomes "now"
      this.clock.reset(performance.now() + 5, this.getTempo(), this.engine.tick);
      this.ensureTimer();
    }
    this.lastState = this.engine.state;
  }

  /** The tick currently sounding (≤ the render frontier). */
  nowTick(): number {
    if (this.engine.state !== 'playing') return this.engine.tick;
    return Math.min(this.engine.tick, Math.max(0, this.clock.msToTick(performance.now())));
  }

  /** The earliest tick at which a new action can still be rendered. */
  frontierTick(): number {
    return this.engine.tick;
  }

  tickToMs(tick: number): number {
    return this.clock.tickToMs(tick);
  }

  /** One scheduling pass. Public for tests and for immediate refresh after gestures. */
  wake(): void {
    if (this.engine.state !== 'playing') return;
    const now = performance.now();
    this.clock.setTempo(this.getTempo(), this.engine.tick);
    const horizon = Math.min(this.limitTick, this.clock.msToTick(now + this.lookaheadMs));
    if (horizon <= this.engine.tick) return;
    const events = this.engine.render(horizon);
    if (events.length) this.sink.events(events, (t) => this.clock.tickToMs(t));
    // MIDI clock (24 ppq) and metronome clicks, scaled by the sync ratio (§11)
    const ratio = this.getSyncRatio() || 4;
    const pulseTicks = TICKS_PER_QUARTER / 24 / (ratio / 4);
    const clickEvery = 24;
    while (this.nextPulseTick <= horizon) {
      const n = Math.round(this.nextPulseTick / pulseTicks);
      this.sink.pulse(this.clock.tickToMs(this.nextPulseTick), n % clickEvery === 0, n % (clickEvery * 4) === 0);
      this.nextPulseTick += pulseTicks;
    }
  }
}
