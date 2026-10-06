/**
 * Session: the performance controller. Owns the Composition, the engine, the scheduler,
 * MIDI routing, Hold/Do + Snapshots + Slideshows, the Input Control System, recording and
 * Movies. The UI only calls Session methods and redraws when notified.
 */
import { MIDDLE_C, NUM_VOICES, STEP_ADVANCE, TIME_BASE_DENOMINATORS, noteValueTicks } from '../engine/constants';
import { clearContinuous } from '../engine/conducting';
import { defaultComposition } from '../engine/defaults';
import { MEngine, type EngineEvent, type StepEvent } from '../engine/engine';
import { InputControl, TIME_BASE_FROM_VALUE, type OneStep } from '../engine/inputControl';
import * as ops from '../engine/patternOps';
import { PatternRecorder } from '../engine/recorder';
import { Rng } from '../engine/rng';
import { captureAll, captureLike, currentVoiceItem, emptySnapshot, snapshotSize } from '../engine/snapshots';
import type { Composition, ConductTarget, Pattern, Slideshow, Snapshot, SnapshotVoiceItems, Step, VariableName } from '../engine/types';
import { Monitor } from '../audio/monitor';
import * as msg from '../midi/messages';
import type { MovieEvent, TempoChange } from '../midi/smf';
import { MidiManager } from '../midi/webmidi';
import { Scheduler } from '../scheduler/scheduler';
import { CcCycleRunner, ClockFollower, sameSource, type LearnMapping, type LearnSource } from '../extended/extended';

export interface VisualEvent {
  ms: number;
  ev: EngineEvent;
}

export interface LogLine {
  ms: number;
  text: string;
  dir: 'out' | 'in';
}

export type HoldMode = 'hold' | 'edit';

export interface HoldState {
  mode: HoldMode;
  pending: Snapshot;
}

interface SlideshowRec {
  index: number;
  start: number | null;
  events: { tick: number; kind: 'snapshot' | 'position'; index?: number; variable?: VariableName; position?: number }[];
}
interface SlideshowPlay {
  index: number;
  t0: number;
  gen: number;
  waiting: boolean;
  paused: boolean;
  /** ticks into the show at the moment of pausing */
  pausedAt: number;
}

export class Session {
  comp: Composition;
  readonly engine: MEngine;
  readonly scheduler: Scheduler;
  readonly midi = new MidiManager();
  readonly monitor = new Monitor();
  readonly ics = new InputControl();
  readonly recorders: PatternRecorder[];
  editRng: Rng;

  /** Events waiting to be shown (UI consumes those whose time has come). */
  visual: VisualEvent[] = [];
  log: LogLine[] = [];
  /** Last step event per voice (what the UI shows as "now playing"). */
  nowPlaying: (StepEvent | null)[] = [null, null, null, null];

  hold: HoldState | null = null;
  currentSnapshot: number | null = null;
  private undoSnapshot: Snapshot | null = null;
  slideshowRec: SlideshowRec | null = null;
  slideshowPlay: SlideshowPlay | null = null;
  slideshowPausedRec = false;
  private slideGen = 0;

  movieArmed = false;
  movieRecording = false;
  movie: MovieEvent[] = [];
  movieTempos: TempoChange[] = [];
  private lastMovieTempo = 0;

  /** Pattern selection for Edit / Pattern menu operations (Select column). */
  selected = [false, false, false, false];
  clipboard: { steps: Step[]; pattern: Pattern | null } | null = null;
  lastNumerical: number | null = null;

  tapConduct = { active: false, lastTap: 0, beats: 0 };
  private lastTap = 0;
  private echoNotes = new Map<string, number[]>(); // input key -> output channels
  private sustain = false;
  private listeners = new Set<(what: string) => void>();
  dirty = true;
  /** Monitor every output through the internal synth regardless of assignment. */
  monitorAll = false;
  status = '';

  constructor(comp?: Composition) {
    this.comp = comp ?? defaultComposition();
    this.editRng = new Rng(this.comp.seed, 500);
    this.engine = new MEngine(this.comp, { onChange: (w) => this.changed(w) });
    this.scheduler = new Scheduler(
      this.engine,
      () => this.comp.tempo.value,
      () => this.comp.syncRatio,
      {
        events: (evs, toMs) => this.dispatch(evs, toMs),
        pulse: (ms, click, down) => this.pulse(ms, click, down),
      },
    );
    this.recorders = Array.from({ length: NUM_VOICES }, () => new PatternRecorder(this.editRng, () => this.comp.options.dontScrambleRests));
    this.midi.setInputHandler((port, data, ts) => this.midiIn(port, data, ts));
    this.midi.onChange(() => this.changed('midi'));
  }

  // ------------------------------------------------------------------ notifications

  onChange(fn: (what: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  /** Incremented on every change, so views can cache what they drew. */
  rev = 0;
  changed(what = 'state'): void {
    this.dirty = true;
    this.rev++;
    this.listeners.forEach((f) => f(what));
  }

  get playing(): boolean {
    return this.engine.state === 'playing';
  }

  pattern(v: number): Pattern {
    return this.comp.patternGroups[this.comp.patternGroup.active].patterns[v];
  }

  // ------------------------------------------------------------------ output routing

  private outTarget(mch: number): { port: string; channel: number } {
    return this.comp.midi.outputs[mch - 1] ?? { port: '', channel: mch };
  }

  private send(mch: number, bytes: number[], ms: number): void {
    const t = this.outTarget(mch);
    const realBytes = [...bytes];
    realBytes[0] = (bytes[0] & 0xf0) | ((t.channel - 1) & 0x0f);
    const when = ms + this.comp.midi.latencyMs;
    if (t.port && t.port !== 'monitor') this.midi.send(t.port, realBytes, when);
    if (t.port === 'monitor' || this.monitorAll) {
      const kind = bytes[0] & 0xf0;
      if (kind === 0x90) this.monitor.noteOn(mch, bytes[1], bytes[2], when);
      else if (kind === 0x80) this.monitor.noteOff(mch, bytes[1], when);
    }
  }

  /** Scheduling diagnostics: how far ahead of their timestamps notes are handed to MIDI. */
  timing = { events: 0, late: 0, maxLateMs: 0, minLeadMs: Infinity };

  private dispatch(evs: EngineEvent[], toMs: (t: number) => number): void {
    const now = performance.now();
    for (const ev of evs) {
      const ms = toMs(ev.tick);
      if (ev.kind === 'on' && this.playing) {
        const lead = ms - now;
        this.timing.events++;
        this.timing.minLeadMs = Math.min(this.timing.minLeadMs, lead);
        if (lead < -1) {
          this.timing.late++;
          this.timing.maxLateMs = Math.max(this.timing.maxLateMs, -lead);
        }
      }
      switch (ev.kind) {
        case 'on':
          this.send(ev.channel, msg.noteOn(ev.channel, ev.pitch, ev.velocity), ms);
          this.movieAdd(ev.tick, msg.noteOn(this.outTarget(ev.channel).channel, ev.pitch, ev.velocity));
          break;
        case 'off':
          this.send(ev.channel, msg.noteOff(ev.channel, ev.pitch), ms);
          this.movieAdd(ev.tick, msg.noteOff(this.outTarget(ev.channel).channel, ev.pitch));
          break;
        case 'program':
          this.send(ev.channel, msg.programChange(ev.channel, ev.program), ms);
          this.movieAdd(ev.tick, msg.programChange(this.outTarget(ev.channel).channel, ev.program));
          break;
        case 'step':
          this.followDrumMachine(ev);
          this.extendedCc(ev, ms);
          break;
        case 'change':
          if (ev.what === 'sync') this.ccRunner.reset();
          this.changed(ev.what);
          break;
      }
      this.visual.push({ ms, ev });
    }
    if (this.visual.length > 4000) this.visual.splice(0, this.visual.length - 4000);
  }

  /** Immediate events (from gestures): dispatch at the current time. */
  emitNow(evs: EngineEvent[]): void {
    if (!evs.length) return;
    const now = performance.now();
    this.dispatch(evs, (t) => (this.playing ? Math.max(now, this.scheduler.tickToMs(t)) : now));
  }

  private pulse(ms: number, click: boolean, down: boolean): void {
    if (this.comp.options.sendClock && this.comp.midi.clockPort) this.midi.send(this.comp.midi.clockPort, msg.CLOCK, ms + this.comp.midi.latencyMs);
    if (click && this.comp.options.useMetronome) this.monitor.click(ms, down);
  }

  private movieAdd(tick: number, data: number[]): void {
    if (!this.movieRecording) return;
    if (this.comp.tempo.value !== this.lastMovieTempo) {
      this.movieTempos.push({ tick, bpm: this.comp.tempo.value });
      this.lastMovieTempo = this.comp.tempo.value;
    }
    this.movie.push({ tick, data });
  }

  // ------------------------------------------------------------------ transport

  start(): void {
    this.monitor.unlock();
    if (this.engine.state === 'playing') {
      this.sync();
      return;
    }
    const wasPaused = this.engine.state === 'paused';
    this.emitNow(this.engine.start());
    if (wasPaused) this.scheduler.pauseToggled();
    else {
      this.emitNow(this.engine.programChanges(0));
      if (this.movieArmed) {
        this.movieRecording = true;
        this.movie = [];
        this.movieTempos = [{ tick: 0, bpm: this.comp.tempo.value }];
        this.lastMovieTempo = this.comp.tempo.value;
      }
      if (this.comp.options.sendClock && this.comp.midi.clockPort) this.midi.send(this.comp.midi.clockPort, msg.START);
      this.ccRunner.reset(this.comp.seed);
      this.scheduler.started();
      if (this.slideshowPlay?.waiting) this.beginSlideshowPlayback();
      if (this.slideshowRec && !this.comp.options.slideshowRecordWait) this.slideshowRec.start = 0;
    }
    this.changed('transport');
  }

  stop(): void {
    // Note-ons up to the render frontier may already be queued in the MIDI driver with future
    // timestamps; the note-offs must not be sent before them or notes would hang.
    const offAt = this.playing ? Math.max(performance.now(), this.scheduler.tickToMs(this.engine.tick)) : performance.now();
    const evs = this.engine.stop();
    if (evs.length) this.dispatch(evs, () => offAt);
    this.scheduler.stopped();
    this.scheduler.limitTick = Infinity;
    this.tapConduct.active = false;
    this.monitor.allOff();
    if (this.comp.options.sendClock && this.comp.midi.clockPort) this.midi.send(this.comp.midi.clockPort, msg.STOP);
    if (this.movieRecording) {
      this.movieRecording = false;
      this.movieArmed = false;
    }
    if (this.slideshowRec) this.finishSlideshowRecording(null);
    if (this.slideshowPlay) this.slideshowPlay = null;
    this.engine.voices.forEach((_, v) => (this.nowPlaying[v] = null));
    this.changed('transport');
  }

  pause(): void {
    if (this.engine.state === 'stopped') return;
    this.engine.pause();
    this.scheduler.pauseToggled();
    this.changed('transport');
  }

  /** Sync, quantized to the Snapshot quantization (§11). */
  sync(): void {
    if (this.hold) {
      this.hold.pending.sync = !this.hold.pending.sync;
      this.changed('hold');
      return;
    }
    if (!this.playing) return;
    this.emitNow(this.engine.perform(this.scheduler.frontierTick(), true, 'sync', (t) => this.engine.sync(t)));
    this.changed('sync');
  }

  /** Sequence Play-Enable toggle (or collect it while holding). */
  toggleSequence(): void {
    if (this.hold) {
      const p = this.hold.pending;
      if (p.sequenceEnable !== undefined) delete p.sequenceEnable;
      else p.sequenceEnable = !this.comp.sequenceEnable;
      this.changed('hold');
      return;
    }
    if (!this.comp.sequence) return;
    this.comp.sequenceEnable = !this.comp.sequenceEnable;
    this.changed('sequence');
  }

  toggleMovie(): void {
    if (this.movieRecording) return;
    this.movieArmed = !this.movieArmed;
    this.changed('movie');
  }

  /** All Notes Off on the channels of the current orchestration (Cmd-period). */
  allNotesOff(): void {
    const chans = new Set(this.comp.orchestration.positions[this.comp.orchestration.active].flat());
    const now = performance.now();
    for (const c of chans) this.send(c, msg.allNotesOff(c), now);
    this.monitor.allOff();
  }

  panic(channels?: number[]): void {
    const now = performance.now();
    for (const c of channels ?? Array.from({ length: 16 }, (_, i) => i + 1)) {
      for (let n = 0; n < 128; n++) this.send(c, msg.noteOff(c, n), now);
      this.send(c, msg.allNotesOff(c), now);
    }
    this.monitor.allOff();
  }

  sendRaw(channels: number[], make: (c: number) => number[]): void {
    const now = performance.now();
    for (const c of channels) this.send(c, make(c), now);
  }

  setTempo(v: number): void {
    const t = this.comp.tempo;
    t.value = Math.round(Math.max(Math.min(t.lo, t.hi), Math.min(Math.max(t.lo, t.hi), v)));
    this.changed('tempo');
  }

  setTempoRange(lo: number, hi: number): void {
    const t = this.comp.tempo;
    t.lo = Math.min(lo, hi);
    t.hi = Math.max(lo, hi);
    t.value = Math.round((t.lo + t.hi) / 2);
    this.changed('tempo');
  }

  // ------------------------------------------------------------------ variable positions

  /**
   * Click on a Variable Position (§12): Hold/Do collects it; Shift quantizes (and records in a
   * Slideshow); otherwise it happens at once.
   */
  clickPosition(variable: VariableName, position: number, mods: { shift?: boolean; alt?: boolean } = {}): void {
    if (this.hold) {
      const p = this.hold.pending.positions;
      if (p[variable] === position) delete p[variable];
      else p[variable] = position;
      this.changed('hold');
      return;
    }
    if (variable === 'velocityRange') clearContinuous(this.comp, 'velocity');
    if (variable === 'legato') clearContinuous(this.comp, 'legato');
    const noSync = variable === 'patternGroup' && !!mods.alt;
    const run = (t: number) => {
      this.recordSlideshow({ tick: t, kind: 'position', variable, position });
      return this.engine.selectPosition(variable, position, t, { noSync });
    };
    if (mods.shift && this.playing) {
      this.emitNow(this.engine.perform(this.scheduler.frontierTick(), true, variable, run));
    } else {
      this.emitNow(this.engine.selectPosition(variable, position, this.scheduler.frontierTick(), { noSync }));
    }
    this.changed(variable);
  }

  /** Drag one Position onto another: swap, or copy with alt (§16). */
  movePosition(variable: VariableName, from: number, to: number, copy: boolean): void {
    if (from === to) return;
    if (this.comp.options.lockMarkedVariables && variable !== 'patternGroup' && variable !== 'soundChoice') {
      const v = this.comp[variable] as { marked: boolean[] };
      if (v.marked[to] || (!copy && v.marked[from])) return;
    }
    const list: unknown[] =
      variable === 'patternGroup'
        ? this.comp.patternGroups
        : variable === 'soundChoice'
          ? this.comp.soundChoice.positions
          : (this.comp[variable] as { positions: unknown[] }).positions;
    if (copy) list[to] = structuredClone(list[from]);
    else [list[from], list[to]] = [list[to], list[from]];
    this.changed(variable);
  }

  isLocked(variable: VariableName, position: number): boolean {
    if (!this.comp.options.lockMarkedVariables || variable === 'patternGroup' || variable === 'soundChoice') return false;
    return (this.comp[variable] as { marked: boolean[] }).marked[position];
  }

  // ------------------------------------------------------------------ conducting

  conduct(x: number, y: number, fresh: boolean, quantized = false): void {
    if (quantized && this.playing) {
      const t = this.scheduler.frontierTick();
      this.emitNow(
        this.engine.perform(t, true, 'baton', (tt) => {
          this.recordSlideshowBaton(tt, x, y);
          return this.engine.conduct(x, y, tt, fresh);
        }),
      );
    } else {
      this.emitNow(this.engine.conduct(x, y, this.scheduler.frontierTick(), fresh));
    }
    this.changed('baton');
  }

  toggleArrow(target: ConductTarget): void {
    if (this.hold) {
      const a = this.hold.pending.arrows;
      if (a[target]) delete a[target];
      else a[target] = { ...this.comp.conducting.arrows[target] };
      this.changed('hold');
      return;
    }
    const a = this.comp.conducting.arrows[target];
    a.enabled = !a.enabled;
    if (!a.enabled && target === 'velocityRange') clearContinuous(this.comp, 'velocity');
    if (!a.enabled && target === 'legato') clearContinuous(this.comp, 'legato');
    this.changed('arrows');
  }

  // ------------------------------------------------------------------ Hold/Do & Snapshots

  holdDo(quantized = false): void {
    if (!this.hold) {
      this.hold = { mode: 'hold', pending: emptySnapshot() };
    } else {
      const pending = this.hold.pending;
      const wasEdit = this.hold.mode === 'edit';
      this.hold = null;
      if (!wasEdit) this.executeSnapshotData(pending, quantized, false, null);
    }
    this.changed('hold');
  }

  blinkEverything(): void {
    this.hold = { mode: 'hold', pending: captureAll(this.comp) };
    this.changed('hold');
  }

  editSnapshot(): void {
    if (this.currentSnapshot === null || !this.comp.snapshots[this.currentSnapshot]) return;
    this.hold = { mode: 'edit', pending: structuredClone(this.comp.snapshots[this.currentSnapshot]!) };
    this.changed('hold');
  }

  /** Toggle a per-voice Patterns-window item while holding (numericals just (de)select). */
  holdVoiceItem(v: number, k: keyof SnapshotVoiceItems, value?: number | boolean): void {
    if (!this.hold) return;
    const vi = this.hold.pending.voices[v] as Record<string, unknown>;
    if (k in vi) delete vi[k];
    else vi[k] = value ?? currentVoiceItem(this.comp, v, k);
    this.changed('hold');
  }

  /** Click on a Snapshot slot (A–Z). */
  clickSnapshot(i: number, mods: { shift?: boolean } = {}): void {
    if (this.hold) {
      const s = this.hold.pending;
      this.hold = null;
      if (snapshotSize(s) > 0) {
        this.comp.snapshots[i] = s;
        this.currentSnapshot = i;
      }
      this.changed('snapshot');
      return;
    }
    this.executeSnapshot(i, !!mods.shift);
  }

  executeSnapshot(i: number, forceSync = false): void {
    const s = this.comp.snapshots[i];
    if (!s) return;
    this.executeSnapshotData(s, true, forceSync, i);
  }

  private executeSnapshotData(s: Snapshot, quantized: boolean, forceSync: boolean, index: number | null): void {
    const run = (t: number) => {
      this.undoSnapshot = captureLike(this.comp, s);
      if (index !== null) {
        this.currentSnapshot = index;
        this.recordSlideshow({ tick: t, kind: 'snapshot', index });
      }
      return this.engine.applySnapshot(s, t, forceSync);
    };
    this.emitNow(this.engine.perform(this.scheduler.frontierTick(), quantized, 'snapshot', run));
    this.changed('snapshot');
  }

  restoreFromSnapshot(): void {
    if (!this.undoSnapshot) return;
    const u = this.undoSnapshot;
    this.emitNow(this.engine.perform(this.scheduler.frontierTick(), true, 'restore', (t) => this.engine.applySnapshot(u, t)));
    this.changed('snapshot');
  }

  eraseSnapshot(): void {
    if (this.currentSnapshot === null) return;
    this.comp.snapshots[this.currentSnapshot] = null;
    this.currentSnapshot = null;
    this.changed('snapshot');
  }

  // ------------------------------------------------------------------ Slideshows

  private recordSlideshow(e: SlideshowRec['events'][number]): void {
    const r = this.slideshowRec;
    if (!r || this.slideshowPausedRec) return;
    if (r.start === null) r.start = e.tick;
    r.events.push({ ...e, tick: e.tick - r.start });
  }
  private recordSlideshowBaton(t: number, x: number, y: number): void {
    const r = this.slideshowRec;
    if (!r) return;
    if (r.start === null) r.start = t;
    (r.events as unknown[]).push({ tick: t - r.start, kind: 'baton', x, y });
  }

  recordSlideshowStart(i: number): void {
    this.slideshowPlay = null;
    this.slideshowRec = { index: i, start: this.comp.options.slideshowRecordWait || !this.playing ? null : this.scheduler.frontierTick(), events: [] };
    this.changed('slideshow');
  }

  private finishSlideshowRecording(loopAt: number | null): void {
    const r = this.slideshowRec!;
    this.slideshowRec = null;
    if (!r.events.length) return;
    const loopLength = loopAt !== null && r.start !== null ? Math.max(1, loopAt - r.start) : null;
    this.comp.slideshows[r.index] = { events: r.events as Slideshow['events'], loopLength };
  }

  clickSlideshow(i: number, mods: { alt?: boolean } = {}): void {
    if (mods.alt) return this.recordSlideshowStart(i);
    if (!this.comp.slideshows[i]) return;
    this.slideshowRec = null;
    this.slideshowPlay = { index: i, t0: 0, gen: ++this.slideGen, waiting: !this.playing, paused: false, pausedAt: 0 };
    if (this.playing) this.beginSlideshowPlayback();
    this.changed('slideshow');
  }

  private beginSlideshowPlayback(): void {
    const sp = this.slideshowPlay;
    if (!sp) return;
    sp.waiting = false;
    const t0 = this.engine.quantizeTick(this.scheduler.frontierTick());
    this.scheduleSlideshowFrom(t0, sp.gen);
  }

  /** Schedule the show's events from `t0`; events before `from` ticks into it are skipped. */
  private scheduleSlideshowFrom(t0: number, gen: number, from = 0): void {
    const sp = this.slideshowPlay;
    if (!sp || sp.gen !== gen) return;
    const show = this.comp.slideshows[sp.index];
    if (!show) return;
    sp.t0 = t0;
    for (const e of show.events) {
      if (e.tick < from) continue;
      this.engine.schedule(t0 + e.tick, 'slideshow', (t) => {
        if (!this.slideshowPlay || this.slideshowPlay.gen !== gen) return;
        if (e.kind === 'snapshot') {
          const s = this.comp.snapshots[e.index];
          if (!s) return;
          this.undoSnapshot = captureLike(this.comp, s);
          this.currentSnapshot = e.index;
          return this.engine.applySnapshot(s, t);
        }
        if (e.kind === 'position') return this.engine.selectPosition(e.variable, e.position, t);
        if (e.kind === 'baton') return this.engine.conduct(e.x, e.y, t, false);
      });
    }
    const end = show.loopLength ?? (show.events.length ? show.events[show.events.length - 1].tick : 0);
    this.engine.schedule(t0 + end + 1e-6, 'slideshow-end', () => {
      if (!this.slideshowPlay || this.slideshowPlay.gen !== gen) return;
      if (show.loopLength) this.scheduleSlideshowFrom(t0 + show.loopLength, gen);
      else this.slideshowPlay = null;
    });
  }

  stopSlideshow(): void {
    if (this.slideshowRec) this.finishSlideshowRecording(null);
    this.slideshowPlay = null; // scheduled events check their generation and fall silent
    this.changed('slideshow');
  }

  /** Slideshow Pause: like the main Pause, playback picks up where it left off. */
  pauseSlideshow(): void {
    if (this.slideshowRec) this.slideshowPausedRec = !this.slideshowPausedRec;
    const sp = this.slideshowPlay;
    if (sp && !sp.waiting) {
      const now = this.scheduler.frontierTick();
      if (!sp.paused) {
        sp.paused = true;
        sp.pausedAt = Math.max(0, now - sp.t0);
        sp.gen = ++this.slideGen; // cancels everything already scheduled
      } else {
        sp.paused = false;
        this.scheduleSlideshowFrom(now - sp.pausedAt, sp.gen, sp.pausedAt);
      }
    }
    this.changed('slideshow');
  }

  /** Loop point: while recording, ends the recording with a loop; while playing, adds one. */
  loopSlideshow(remove = false): void {
    if (this.slideshowRec) {
      this.finishSlideshowRecording(this.scheduler.frontierTick());
    } else if (this.slideshowPlay) {
      const show = this.comp.slideshows[this.slideshowPlay.index];
      if (show) show.loopLength = remove ? null : Math.max(1, this.scheduler.frontierTick() - this.slideshowPlay.t0);
    }
    this.changed('slideshow');
  }

  // ------------------------------------------------------------------ Patterns window

  setVoice<K extends keyof Composition['voices'][number]>(v: number, k: K, value: Composition['voices'][number][K]): void {
    if (this.hold && (k === 'playEnable' || k === 'echoThru' || k === 'mouseAdvance' || k === 'src')) {
      this.holdVoiceItem(v, k as keyof SnapshotVoiceItems, value as number | boolean);
      return;
    }
    this.comp.voices[v][k] = value;
    if (k === 'use' && value !== 'transpose') this.engine.voices[v].keyTranspose = null;
    if (k === 'use' && value === 'record') this.recorders[v].reset(this.pattern(v).steps.length);
    this.changed('voices');
  }

  setTimeBase(v: number, num: number, den: number): void {
    const p = this.pattern(v);
    p.tbNum = Math.max(1, Math.min(99, num));
    this.engine.setTimeBaseDen(v, den, this.scheduler.frontierTick());
    this.changed('patterns');
  }

  setOutputLength(v: number, len: number, withRests: boolean): void {
    const p = this.pattern(v);
    if (withRests) ops.setLengthWithRests(p, len, this.editRng, this.comp.options.dontScrambleRests);
    else p.outputLength = Math.max(0, Math.min(p.steps.length, Math.round(len)));
    this.changed('patterns');
  }

  // ------------------------------------------------------------------ pattern editing

  patternEdited(): void {
    this.changed('patterns');
  }

  /** Apply a Pattern-menu operation to each selected pattern (or `only`). */
  patternOp(op: string, only?: { voice: number; region?: [number, number] }): void {
    const dsr = this.comp.options.dontScrambleRests;
    const targets = only ? [only.voice] : this.selected.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
    for (const v of targets) {
      const p = this.pattern(v);
      const r = only?.region;
      switch (op) {
        case 'transposeUp':
          ops.transpose(p, 1, r);
          break;
        case 'transposeDown':
          ops.transpose(p, -1, r);
          break;
        case 'octaveUp':
          ops.transpose(p, 12, r);
          break;
        case 'octaveDown':
          ops.transpose(p, -12, r);
          break;
        case 'rescramble':
          ops.rescramble(p, this.editRng, dsr, r);
          break;
        case 'originalToScrambled':
          ops.originalToScrambled(p);
          break;
        case 'swapScrambled':
          ops.swapScrambledAndOriginal(p);
          break;
        case 'rotateForward':
          ops.rotateForward(p, r);
          break;
        case 'rotateBackward':
          ops.rotateBackward(p, r);
          break;
        case 'reverse':
          ops.reverse(p, r);
          break;
        case 'double':
          ops.withRests(p, 1, this.editRng, dsr, r);
          break;
        case 'triple':
          ops.withRests(p, 2, this.editRng, dsr, r);
          break;
        case 'eliminateChords':
          ops.eliminateChords(p, this.editRng, dsr, r);
          break;
        case 'eliminateRests':
          ops.eliminateRests(p, this.editRng, dsr, r);
          break;
      }
    }
    this.changed('patterns');
  }

  editOp(op: 'cut' | 'copy' | 'paste' | 'clear' | 'pasteNotes' | 'changeToRests' | 'fillWithRests' | 'pasteAtEnd', only?: { voice: number; region?: [number, number] }): void {
    const dsr = this.comp.options.dontScrambleRests;
    const targets = only ? [only.voice] : this.selected.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
    if (!targets.length) return;
    const g = this.comp.patternGroups[this.comp.patternGroup.active];
    for (const v of targets) {
      const p = g.patterns[v];
      const r = only?.region;
      switch (op) {
        case 'copy':
        case 'cut':
          this.clipboard = { steps: ops.copySteps(p, r), pattern: r ? null : ops.clonePattern(p) };
          if (op === 'cut') {
            if (r) ops.deleteSteps(p, range(r), this.editRng, dsr);
            else ops.clearPattern(p);
          }
          break;
        case 'clear':
          if (r) ops.deleteSteps(p, range(r), this.editRng, dsr);
          else ops.clearPattern(p);
          break;
        case 'paste':
          if (!this.clipboard) break;
          if (r) ops.pasteIntoRegion(p, this.clipboard.steps, r);
          else if (this.clipboard.pattern) g.patterns[v] = ops.clonePattern(this.clipboard.pattern);
          else g.patterns[v] = { ...ops.newPattern(this.clipboard.steps, this.editRng), tbNum: p.tbNum, tbDen: p.tbDen, phase: p.phase };
          break;
        case 'pasteNotes':
          if (!this.clipboard) break;
          if (r) ops.pasteIntoRegion(p, this.clipboard.steps, r);
          else {
            p.steps = this.clipboard.steps.map((s) => [...s]);
            p.outputLength = p.steps.length;
            ops.rescramble(p, this.editRng, dsr);
          }
          break;
        case 'pasteAtEnd':
          if (!this.clipboard) break;
          if (r) ops.insertSteps(p, r[0], this.clipboard.steps, this.editRng, dsr);
          else ops.pasteAtEnd(p, this.clipboard.steps, this.editRng, dsr);
          break;
        case 'changeToRests':
          ops.changeToRests(p, r);
          break;
        case 'fillWithRests':
          ops.fillWithRests(p);
          break;
      }
    }
    this.changed('patterns');
  }

  /** Play a step's notes through the voice's orchestration (Editor Sound). */
  auditionStep(v: number, pitches: number[], velocity = 64): void {
    if (this.playing && !this.comp.options.editorSoundWhilePlaying) return;
    this.monitor.unlock();
    const now = performance.now();
    const chans = this.comp.orchestration.positions[this.comp.orchestration.active][v];
    for (const ch of chans)
      for (const p of pitches) {
        this.send(ch, msg.noteOn(ch, p, velocity), now);
        this.send(ch, msg.noteOff(ch, p), now + 250);
      }
  }

  // ------------------------------------------------------------------ Sound Choice

  setProgram(position: number, channel: number, program: number | null, send: boolean): void {
    this.comp.soundChoice.positions[position][channel - 1] = program;
    if (send && program !== null && position === this.comp.soundChoice.active) this.send(channel, msg.programChange(channel, program), performance.now());
    this.changed('soundChoice');
  }

  // ------------------------------------------------------------------ MIDI input

  /** Which M Input Channels (1..16) an incoming message belongs to. */
  private inputChannels(port: string, midiCh: number): number[] {
    const out: number[] = [];
    this.comp.midi.inputs.forEach((a, i) => {
      if ((a.port === '*' || a.port === port) && a.channel === midiCh) out.push(i + 1);
    });
    return out;
  }

  // ------------------------------------------------------------------ EXTENDED (src/extended)

  readonly clockFollower = new ClockFollower();
  readonly ccRunner = new CcCycleRunner(0);

  /** EXTENDED CC Cycles: a controller value before each played note, on the voice's channels. */
  private extendedCc(ev: StepEvent, ms: number): void {
    const ext = this.comp.extended;
    if (!ext.enabled || !ev.played) return;
    const r = this.ccRunner.next(ext.ccCycles, ev.voice);
    if (!r) return;
    const chans = this.comp.orchestration.positions[this.comp.orchestration.active][ev.voice];
    for (const c of chans) {
      this.send(c, msg.controlChange(c, r.cc, r.value), ms - 0.5);
      this.movieAdd(ev.tick, msg.controlChange(this.outTarget(c).channel, r.cc, r.value));
    }
  }
  /** index into comp.extended.learn waiting for a controller, or null */
  learnArmed: number | null = null;
  private learnLast = new Map<string, number>();
  extStatus = { bpm: 0 };

  /** Tempo from an external source: not rounded, widens the range if needed. */
  setTempoExact(bpm: number): void {
    const t = this.comp.tempo;
    t.value = Math.max(10, Math.min(400, bpm));
    if (t.value < t.lo) t.lo = Math.floor(t.value);
    if (t.value > t.hi) t.hi = Math.ceil(t.value);
  }

  /** System real-time messages for MIDI clock input. Returns true if consumed. */
  private extendedRealtime(port: string, status: number, ts: number): boolean {
    const ext = this.comp.extended;
    if (!ext.enabled || !ext.clockIn.enabled) return false;
    if (ext.clockIn.port !== '*' && ext.clockIn.port !== port) return false;
    const f = this.clockFollower;
    switch (status) {
      case 0xf8: {
        if (!this.playing) return true;
        const bpm = f.pulse(ts);
        if (bpm) {
          const c = f.corrected(bpm, this.scheduler.nowTick());
          this.extStatus.bpm = bpm;
          this.setTempoExact(c);
        }
        return true;
      }
      case 0xfa:
        if (!ext.clockIn.transport) return true;
        if (this.engine.state !== 'stopped') this.stop();
        f.reset();
        this.start();
        return true;
      case 0xfb:
        if (!ext.clockIn.transport) return true;
        if (this.engine.state === 'paused') this.pause();
        else if (this.engine.state === 'stopped') {
          f.reset();
          this.start();
        }
        return true;
      case 0xfc:
        if (!ext.clockIn.transport) return true;
        this.stop();
        return true;
    }
    return false;
  }

  /** MIDI Learn: arm a mapping, or apply learnt mappings. Returns true if consumed. */
  private extendedLearn(m: msg.ParsedMessage): boolean {
    const ext = this.comp.extended;
    if (!ext.enabled) return false;
    if (m.type !== 'cc' && m.type !== 'noteon' && m.type !== 'noteoff') return false;
    const src: LearnSource = { type: m.type === 'cc' ? 'cc' : 'note', channel: m.channel, number: m.data1 };
    if (this.learnArmed !== null && m.type !== 'noteoff') {
      const map = ext.learn[this.learnArmed];
      if (map) map.source = src;
      this.learnArmed = null;
      this.changed('learn');
      return true;
    }
    let used = false;
    for (const map of ext.learn) {
      if (!map.source || !sameSource(map.source, src)) continue;
      used = true;
      this.applyLearn(map, m);
    }
    return used;
  }

  private applyLearn(map: LearnMapping, m: msg.ParsedMessage): void {
    const key = `${m.channel}:${m.data1}:${m.type === 'cc' ? 'cc' : 'n'}`;
    const prev = this.learnLast.get(key) ?? 0;
    const val = m.type === 'cc' ? m.data2 : m.type === 'noteon' ? 127 : 0;
    this.learnLast.set(key, val);
    const rising = val >= 64 && prev < 64;
    const t = map.target;
    switch (t.kind) {
      case 'variable': {
        const n = t.variable === 'soundChoice' ? 16 : 6;
        if (m.type === 'cc') {
          const pos = Math.min(n - 1, Math.floor((val / 128) * n));
          if (pos !== (this.comp[t.variable] as { active: number }).active) this.clickPosition(t.variable, pos);
        } else if (rising) this.clickPosition(t.variable, ((this.comp[t.variable] as { active: number }).active + 1) % n);
        break;
      }
      case 'tempo':
        if (m.type === 'cc') this.setTempo(this.comp.tempo.lo + (val / 127) * (this.comp.tempo.hi - this.comp.tempo.lo));
        break;
      case 'batonX':
        if (m.type === 'cc') this.conduct(val / 127, this.comp.conducting.baton.y, false);
        break;
      case 'batonY':
        if (m.type === 'cc') this.conduct(this.comp.conducting.baton.x, val / 127, false);
        break;
      case 'start':
        if (rising) this.start();
        break;
      case 'stop':
        if (rising) this.stop();
        break;
      case 'sync':
        if (rising) this.sync();
        break;
      case 'holdDo':
        if (rising) this.holdDo();
        break;
      case 'playEnable':
        if (rising) this.setVoice(t.voice, 'playEnable', !this.comp.voices[t.voice].playEnable);
        break;
      case 'snapshot':
        if (rising) this.executeSnapshot(t.index);
        break;
    }
  }

  midiIn(port: string, data: ArrayLike<number>, ts: number): void {
    if ((data[0] ?? 0) >= 0xf8 && this.extendedRealtime(port, data[0], ts)) return;
    const m = msg.parse(data);
    if (this.extendedLearn(m)) {
      this.changed('learn');
      return;
    }
    if (m.type === 'other') return;
    const inChans = this.inputChannels(port, m.channel);
    if (!inChans.length) return;
    this.log.push({ ms: ts, dir: 'in', text: `${m.type} ch${m.channel} ${m.data1} ${m.data2}` });
    if (this.log.length > 300) this.log.splice(0, this.log.length - 300);

    // MIDI Conduct (§10)
    if (m.type === 'cc' && this.comp.options.midiConduct) {
      const b = this.comp.conducting.baton;
      if (m.data1 === this.comp.midi.conductCtrlX) this.conduct(m.data2 / 127, b.y, false);
      if (m.data1 === this.comp.midi.conductCtrlY) this.conduct(b.x, m.data2 / 127, false);
    }
    if (m.type === 'cc' && m.data1 === 64) {
      const down = m.data2 >= 64;
      if (down && !this.sustain && this.comp.options.sustainEntersRests) {
        for (let v = 0; v < NUM_VOICES; v++) if (this.comp.voices[v].use === 'record' && this.voiceHears(v, inChans)) this.recorders[v].rest(this.pattern(v));
        this.changed('patterns');
      }
      this.sustain = down;
    }
    if (m.type !== 'noteon' && m.type !== 'noteoff') return;
    const on = m.type === 'noteon';
    const now = performance.now();
    const key = port + ':' + m.channel + ':' + m.data1;

    // Echo-Thru-Orchestration and Echo Map: rechannelize the input.
    if (on) {
      const chans = new Set<number>();
      for (let v = 0; v < NUM_VOICES; v++) {
        const vs = this.comp.voices[v];
        if (!this.voiceHears(v, inChans)) continue;
        if (vs.echoThru) this.comp.orchestration.positions[this.comp.orchestration.active][v].forEach((c) => chans.add(c));
        if (vs.use === 'echomap') this.comp.echoMap.forEach((e, i) => e && chans.add(i + 1));
      }
      if (chans.size) {
        this.echoNotes.set(key, [...chans]);
        for (const c of chans) this.send(c, msg.noteOn(c, m.data1, m.data2), now);
      }
    } else {
      const chans = this.echoNotes.get(key);
      if (chans) {
        for (const c of chans) this.send(c, msg.noteOff(c, m.data1), now);
        this.echoNotes.delete(key);
      }
    }

    let controlled = false;
    for (let v = 0; v < NUM_VOICES; v++) {
      const vs = this.comp.voices[v];
      if (!this.voiceHears(v, inChans)) continue;
      if (vs.use === 'record') {
        const rec = this.recorders[v];
        const p = this.pattern(v);
        if (on) {
          if (p.drumMachine && !this.playing) continue; // drum mode records only while running [DOC]
          if (p.drumMachine) rec.follow(this.drumStep(v, now));
          rec.noteOn(p, m.data1, now);
        } else rec.noteOff(p, m.data1);
        this.changed('patterns');
      } else if (vs.use === 'transpose' && on) {
        this.engine.keyboardTranspose(v, m.data1);
        this.changed('transpose');
      } else if (vs.use === 'control' && !controlled) {
        controlled = true; // one ICS per message
        this.inputControl(m.data1, on ? m.data2 : 0, on);
      }
    }
  }

  private voiceHears(v: number, inChans: number[]): boolean {
    const src = this.comp.voices[v].src;
    return src === 0 || inChans.includes(src);
  }

  /** Drum Machine Mode: the step whose time slot contains `now`. */
  private drumStep(v: number, nowMs: number): number {
    const last = this.engine.voices[v].last;
    const p = this.pattern(v);
    const len = Math.max(1, Math.min(p.outputLength, p.steps.length));
    if (!last) return 0;
    const lastMs = this.scheduler.tickToMs(last.tick);
    const nextMs = this.scheduler.tickToMs(last.tick + last.interval);
    // last.stepIndex may be in the future (look-ahead); fall back on elapsed time.
    if (nowMs < lastMs) {
      return (last.stepIndex - 1 + len) % len;
    }
    return nowMs - lastMs > (nextMs - lastMs) / 2 ? (last.stepIndex + 1) % len : last.stepIndex;
  }

  private followDrumMachine(ev: StepEvent): void {
    this.nowPlaying[ev.voice] = ev;
  }

  // ------------------------------------------------------------------ Input Control System

  inputControl(note: number, velocity: number, on: boolean): void {
    if (!on) {
      const a = this.ics.noteOff(note);
      if (a.kind === 'release' && a.action.kind === 'stepAdvance') this.stepRelease(a.action.voice);
      return;
    }
    const a = this.ics.noteOn(note);
    if (a.kind === 'oneStep') this.oneStep(a.action, velocity);
    else if (a.kind === 'value') {
      const c = a.code;
      const val = a.value;
      if (c.kind === 'variable') {
        const n = c.variable === 'soundChoice' ? 16 : 6;
        if (val >= 1 && val <= n) this.clickPosition(c.variable, val - 1);
      } else if (c.kind === 'timeBase') {
        const den = TIME_BASE_FROM_VALUE(val, TIME_BASE_DENOMINATORS);
        if (den !== null) this.setTimeBase(c.voice, this.pattern(c.voice).tbNum, den);
      } else if (c.kind === 'snapshot') {
        if (val < 26) this.clickSnapshot(val);
      } else if (c.kind === 'playSlideshow') {
        if (val >= 1 && val <= 9) this.clickSlideshow(val - 1);
      } else if (c.kind === 'recordSlideshow') {
        if (val >= 1 && val <= 9) this.recordSlideshowStart(val - 1);
      }
    } else if (a.kind === 'code' && a.code.kind === 'editSnapshot') {
      this.ics.pending = null;
      this.editSnapshot();
    }
    this.changed('ics');
  }

  private oneStep(a: OneStep, velocity: number): void {
    switch (a.kind) {
      case 'playToggle':
        this.setVoice(a.voice, 'playEnable', !this.comp.voices[a.voice].playEnable);
        break;
      case 'clearPattern':
        if (this.comp.voices[a.voice].use === 'record') PatternRecorder.clearToRests(this.pattern(a.voice), this.editRng, this.comp.options.dontScrambleRests);
        break;
      case 'stepAdvance':
        this.stepAdvance(a.voice, velocity);
        break;
      case 'tapTempo':
        this.tapTempo();
        break;
      case 'start':
        if (!this.playing) this.start();
        break;
      case 'stop':
        this.stop();
        break;
      case 'sync':
        this.sync();
        break;
      case 'holdDo':
        this.holdDo();
        break;
      case 'stopSlideshow':
        this.stopSlideshow();
        break;
      case 'sequenceToggle':
        this.toggleSequence();
        break;
      case 'tapConduct':
        this.tapConductKey(velocity);
        break;
      case 'freezeTempo':
        if (this.tapConduct.active) {
          this.tapConduct.active = false;
          this.scheduler.limitTick = Infinity;
          this.tapVelocity(velocity);
        }
        break;
      case 'accelerando':
        this.setTempoFree(this.comp.tempo.value * 1.03);
        this.tapVelocity(velocity);
        break;
      case 'decelerando':
        this.setTempoFree(this.comp.tempo.value / 1.03);
        this.tapVelocity(velocity);
        break;
    }
  }

  /** Tempo set outside the range bar (taps): widens the range if needed. */
  setTempoFree(bpm: number): void {
    const t = this.comp.tempo;
    t.value = Math.round(Math.max(10, Math.min(400, bpm)));
    if (t.value < t.lo) t.lo = t.value;
    if (t.value > t.hi) t.hi = t.value;
    this.changed('tempo');
  }

  tapTempo(): void {
    const now = performance.now();
    const dt = now - this.lastTap;
    this.lastTap = now;
    if (dt > 60 && dt < 4000) this.setTempoFree((60000 / dt) * (4 / (this.comp.syncRatio || 4)));
  }

  private tapVelocity(velocity: number): void {
    if (this.comp.options.tapAffectsVelocity && velocity > 0) this.engine.globalVelocityOffset = velocity - 64;
  }

  /** Tap Conduct (§14): each tap lets the music advance one beat at the tapped tempo. */
  tapConductKey(velocity: number): void {
    const now = performance.now();
    const tc = this.tapConduct;
    this.tapVelocity(velocity);
    if (!tc.active) {
      tc.active = true;
      tc.lastTap = now;
      if (!this.playing) {
        this.scheduler.limitTick = 0; // nothing sounds until the second tap
        this.start();
      }
      // "a beat for nothing": hold at the current frontier until the next tap
      this.scheduler.limitTick = this.scheduler.frontierTick();
      this.changed('tempo');
      return;
    }
    const dt = now - tc.lastTap;
    tc.lastTap = now;
    if (dt > 60 && dt < 5000) this.setTempoFree(60000 / dt);
    const beat = noteValueTicks(this.comp.syncRatio || 4);
    const from = this.scheduler.frontierTick();
    this.scheduler.clock.reset(now, this.comp.tempo.value, from);
    this.scheduler.limitTick = Math.floor(from / beat + 1e-6) * beat + beat;
    this.scheduler.wake();
  }

  stepAdvance(voice: number, velocity: number): void {
    if (!this.playing) return;
    const voices = voice >= 0 ? [voice] : [0, 1, 2, 3].filter((v) => this.pattern(v).tbDen === STEP_ADVANCE);
    for (const v of voices) {
      if (voice >= 0 && this.pattern(v).tbDen !== STEP_ADVANCE) continue;
      this.emitNow(this.engine.stepAdvance(v, velocity || 64, this.scheduler.nowTick()));
    }
    this.changed('step');
  }

  stepRelease(voice: number): void {
    const voices = voice >= 0 ? [voice] : [0, 1, 2, 3];
    for (const v of voices) this.emitNow(this.engine.stepRelease(v, this.scheduler.nowTick()));
  }

  // ------------------------------------------------------------------ mouse advance

  setMouseAdvance(active: boolean, speed = 0): void {
    this.engine.mouseAdvanceActive = active;
    this.engine.mouseAdvanceVelocity = Math.round(Math.min(40, speed / 8) - 10);
  }

  // ------------------------------------------------------------------ document

  load(comp: Composition): void {
    this.stop();
    this.comp = comp;
    this.emitNow(this.engine.load(comp));
    this.editRng = new Rng(comp.seed, 500);
    this.hold = null;
    this.currentSnapshot = null;
    this.undoSnapshot = null;
    this.selected = [false, false, false, false];
    this.changed('load');
  }

  setSeed(seed: number): void {
    this.comp.seed = Math.max(0, Math.floor(seed)) >>> 0;
    this.changed('seed');
  }

  /** Keyboard key for playing from the computer keyboard into a recording voice (no MIDI). */
  computerKeyNote(note: number, on: boolean): void {
    this.midiIn('computer', on ? [0x90, note, 100] : [0x80, note, 0], performance.now());
  }
}

function range([a, b]: [number, number]): number[] {
  return Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
}

export { MIDDLE_C };
