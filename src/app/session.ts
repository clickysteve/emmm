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
import { CcCycleRunner, learnInto, sameSource, targetLabel, type LearnMapping, type LearnSource, type LearnTarget } from '../extended/extended';
import { ClockFollower, type SyncStatus } from '../midi/clockIn';
import { mutate, mutationRng } from '../extended/mutation';
import { cleanTrajectory, clampTo, freshState, MAX_TRAJECTORY_VALUES, nextIndex, SMOOTH_TICKS, stepTicks, targetInfo, TRAJECTORY_SLOTS, trajRng, valueAt, type Trajectory, type TrajState, type TrajTarget } from '../extended/trajectory';
import { neutralMod } from '../engine/engine';
import { capturePerfState, recallPerfState } from '../extended/perfState';
import { freshSeed } from '../engine/rng';
import { assignDeep } from './assign';
import { History } from './history';
import { CHROMATIC, cleanChoice, transformSteps, type ScaleChoice } from './scales';

function trajTargetKey(t: TrajTarget): string {
  return t.kind === 'position' ? 'position:' + t.variable : t.kind === 'cc' ? `cc:${t.channel}:${t.cc}` : t.kind;
}

/** Changes that are about playing or viewing, not editing: they never make an Undo step. */
const TRANSIENT = new Set(['editor', 'baton', 'tempo', 'transport', 'select', 'window', 'step', 'mouse', 'learn', 'hold', 'movie', 'sync', 'load', 'undo', 'midi', 'transpose', 'ics', 'clock', 'feedback', 'ab-recall', 'trajectory']);

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
    // Trajectory actions ('traj') report their own visible changes (see trajApply)
    this.engine = new MEngine(this.comp, { onChange: (w) => w !== 'traj' && this.changed(w) });
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
    this.midi.onChange(() => this.notify('midi'));
    this.history = new History(() => this.docState());
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
    if (what !== 'trajectory') this.trajManual(what);
    if (!TRANSIENT.has(what)) this.historySoon();
    this.listeners.forEach((f) => f(what));
  }

  // ------------------------------------------------------------------ Undo / Redo

  /** Document history (see app/history.ts). Performance state is not part of it. */
  readonly history: History;
  /** set by the UI while a pointer is pressed: an edit gesture is not finished yet */
  gestureActive = false;
  private historyTimer: ReturnType<typeof setTimeout> | null = null;

  private historySoon(): void {
    if (this.historyTimer) clearTimeout(this.historyTimer);
    this.historyTimer = setTimeout(() => {
      this.historyTimer = null;
      if (this.gestureActive) return; // committed when the gesture ends (gestureEnd)
      this.history.commit();
    }, 300);
  }

  /** The UI calls this when a pointer is released: the gesture is one undoable step. */
  gestureEnd(): void {
    this.gestureActive = false;
    if (this.historyTimer) this.historySoon();
  }

  /** The document as Undo sees it: everything except performance state. */
  docState(): string {
    const c = this.comp;
    const v = <T extends { active: number }>(x: T) => ({ ...x, active: 0 });
    return JSON.stringify({
      ...c,
      patternGroup: { active: 0 },
      noteDensity: v(c.noteDensity),
      velocityRange: v(c.velocityRange),
      noteOrder: v(c.noteOrder),
      transposition: v(c.transposition),
      timeDistortion: v(c.timeDistortion),
      accent: v(c.accent),
      legato: v(c.legato),
      rhythm: v(c.rhythm),
      orchestration: v(c.orchestration),
      soundChoice: v(c.soundChoice),
      tempo: { ...c.tempo, value: 0 },
      voices: c.voices.map((x) => ({ ...x, playEnable: true, echoThru: false, mouseAdvance: false })),
      conducting: { ...c.conducting, baton: null, continuousVelocity: { ...c.conducting.continuousVelocity, values: null }, continuousLegato: { ...c.conducting.continuousLegato, values: null } },
      midi: null,
      sequenceEnable: false,
      extended: { ...c.extended, ccCycles: { ...c.extended.ccCycles, active: 0 }, ab: { ...c.extended.ab, last: null }, mutation: { ...c.extended.mutation, amount: 0 } },
    });
  }

  /** Put a history state into the live document, keeping the current performance state. */
  private restoreDoc(state: string): void {
    const c = this.comp;
    const next = JSON.parse(state) as Composition;
    for (const k of ['noteDensity', 'velocityRange', 'noteOrder', 'transposition', 'timeDistortion', 'accent', 'legato', 'rhythm', 'orchestration', 'soundChoice'] as const)
      (next[k] as { active: number }).active = c[k].active;
    next.patternGroup = { active: c.patternGroup.active };
    next.tempo.value = c.tempo.value;
    next.voices.forEach((x, i) => {
      x.playEnable = c.voices[i].playEnable;
      x.echoThru = c.voices[i].echoThru;
      x.mouseAdvance = c.voices[i].mouseAdvance;
    });
    next.conducting.baton = structuredClone(c.conducting.baton);
    next.conducting.continuousVelocity.values = [...c.conducting.continuousVelocity.values];
    next.conducting.continuousLegato.values = [...c.conducting.continuousLegato.values];
    next.midi = structuredClone(c.midi);
    next.sequenceEnable = c.sequenceEnable;
    next.extended.ccCycles.active = c.extended.ccCycles.active;
    next.extended.ab.last = c.extended.ab.last;
    next.extended.mutation.amount = c.extended.mutation.amount;
    const dens = c.patternGroups.map((g) => g.patterns.map((p) => p.tbDen));
    assignDeep(c, next);
    // a step-advance voice that is no longer step-advance must be woken by the engine
    const tick = this.scheduler.frontierTick();
    const g = c.patternGroup.active;
    c.patternGroups[g].patterns.forEach((p, v) => {
      if (dens[g][v] !== p.tbDen) {
        const den = p.tbDen;
        p.tbDen = dens[g][v];
        this.engine.setTimeBaseDen(v, den, tick);
      }
    });
  }

  undo(): boolean {
    if (this.historyTimer) clearTimeout(this.historyTimer), (this.historyTimer = null);
    const ok = this.history.undo((st) => (this.restoreDoc(st), this.trajSync()));
    if (ok) this.notify('undo');
    return ok;
  }

  redo(): boolean {
    if (this.historyTimer) clearTimeout(this.historyTimer), (this.historyTimer = null);
    const ok = this.history.redo((st) => (this.restoreDoc(st), this.trajSync()));
    if (ok) this.notify('undo');
    return ok;
  }

  /** Notify views without creating a history step. */
  private notify(what: string): void {
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

  // ------------------------------------------------------------------ MIDI clock out (Send Clock)

  /** The device that received Start and is being clocked; only ever one (no duplicate streams). */
  private clockOut: string | null = null;

  private clockTarget(): string | null {
    return this.comp.options.sendClock && this.comp.midi.clockPort ? this.comp.midi.clockPort : null;
  }

  private pulse(ms: number, click: boolean, down: boolean): void {
    const target = this.clockTarget();
    const when = ms + this.comp.midi.latencyMs;
    if (target !== this.clockOut) {
      // Send Clock switched off, or another device chosen, while playing: stop the old one;
      // a newly chosen device starts with the music from here
      if (this.clockOut) this.midi.send(this.clockOut, msg.STOP, when);
      if (target) this.midi.send(target, msg.START, when);
      this.clockOut = target;
    }
    if (target) this.midi.send(target, msg.CLOCK, when);
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
    this.extHalted = false;
    if (this.engine.state === 'playing') {
      this.sync();
      return;
    }
    const wasPaused = this.engine.state === 'paused';
    this.applySeedOverrides();
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
      this.clockOut = this.clockTarget();
      if (this.clockOut) this.midi.send(this.clockOut, msg.START);
      this.ccRunner.reset(this.comp.seed);
      this.trajStart();
      this.scheduler.started();
      if (this.slideshowPlay?.waiting) this.beginSlideshowPlayback();
      if (this.slideshowRec && !this.comp.options.slideshowRecordWait) this.slideshowRec.start = 0;
    }
    this.changed('transport');
  }

  /**
   * Stop (§11, Return / ●): terminate playback and return the transport to its initial
   * position — all notes off, the engine rewound (MEngine.rewind), Slideshow playback and
   * recording, Trajectories, the Movie, tap conducting and clock output ended; Start then plays
   * from the beginning. Performance settings persist (active Positions, tempo, Baton,
   * conducting values, Play-Enable, Snapshots, Hold/Do in progress, the captured Movie).
   * Distinct from Pause, which keeps the place and the sounding notes.
   */
  stop(): void {
    this.extHalted = false;
    // Note-ons up to the render frontier may already be queued in the MIDI driver with future
    // timestamps; the note-offs must not be sent before them or notes would hang.
    const offAt = this.afterQueued();
    const evs = this.engine.stop();
    if (evs.length) this.dispatch(evs, () => offAt);
    this.trajStop();
    this.scheduler.stopped();
    this.scheduler.limitTick = Infinity;
    this.tapConduct.active = false;
    this.monitor.allOff();
    // after the clock pulses already queued ahead in the driver, not before them
    if (this.clockOut) this.midi.send(this.clockOut, msg.STOP, offAt + this.comp.midi.latencyMs);
    this.clockOut = null;
    if (this.movieRecording) {
      this.movieRecording = false;
      this.movieArmed = false;
    }
    if (this.slideshowRec) this.finishSlideshowRecording(null);
    if (this.slideshowPlay) this.slideshowPlay = null;
    this.clockFollower.reset();
    this.ccRunner.reset(this.comp.seed);
    // nothing already scheduled for the display may flash after the stop
    this.visual.length = 0;
    this.engine.voices.forEach((_, v) => (this.nowPlaying[v] = null));
    this.changed('transport');
  }

  /** Stopped by an external MIDI Stop (FC) with the place kept, so Continue can resume. */
  extHalted = false;

  /** External MIDI Stop (FC): notes off, position kept (MEngine.halt). */
  private externalStop(): void {
    if (this.engine.state === 'stopped') return;
    const wasPlaying = this.engine.state === 'playing';
    const offAt = this.afterQueued();
    const evs = this.engine.halt();
    if (evs.length) this.dispatch(evs, () => offAt);
    this.scheduler.pauseToggled();
    this.monitor.allOff();
    if (this.clockOut && wasPlaying) this.midi.send(this.clockOut, msg.STOP, offAt + this.comp.midi.latencyMs);
    this.tapConduct.active = false;
    this.extHalted = true;
    this.changed('transport');
  }

  pause(): void {
    if (this.engine.state === 'stopped') return;
    this.extHalted = false;
    const pausing = this.engine.state === 'playing';
    const at = this.afterQueued() + this.comp.midi.latencyMs;
    this.engine.pause();
    this.scheduler.pauseToggled();
    // clocked gear pauses and resumes with emmm (Stop … Continue)
    if (this.clockOut) this.midi.send(this.clockOut, pausing ? msg.STOP : msg.CONTINUE, pausing ? at : undefined);
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
  /** Time after every note already handed to the MIDI driver (the render frontier). */
  private afterQueued(): number {
    return this.playing ? Math.max(performance.now(), this.scheduler.tickToMs(this.engine.tick)) : performance.now();
  }

  allNotesOff(): void {
    const chans = new Set(this.comp.orchestration.positions[this.comp.orchestration.active].flat());
    const now = this.afterQueued();
    for (const c of chans) this.send(c, msg.allNotesOff(c), now);
    this.monitor.allOff();
  }

  panic(channels?: number[]): void {
    const now = this.afterQueued();
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
    // the label names the slot, so the Snapshot window can show it waiting (quantized)
    this.emitNow(this.engine.perform(this.scheduler.frontierTick(), quantized, index === null ? 'snapshot' : `snapshot:${index}`, run));
    this.changed('snapshot');
  }

  /** Snapshot slots waiting for the Snapshot quantization point (for display). */
  pendingSnapshots(): number[] {
    return this.engine
      .pendingActions()
      .filter((a) => a.label.startsWith('snapshot:'))
      .map((a) => Number(a.label.slice(9)));
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

  /**
   * emmm Transposition Scale Lock (not M): Transposition values (Positions, conducting, the
   * Robot, Trajectory) count degrees of each Voice's own Pattern scale instead of semitones
   * (MEngine.transposePitch). Part of the document; one Undo step. The stored values and the
   * Pattern notes are not changed.
   */
  setScaleLock(on: boolean): void {
    if (this.comp.scaleLock === on) return;
    this.comp.scaleLock = on;
    this.changed('scaleLock');
  }

  /**
   * Give voice v's Pattern a Root + Scale (emmm). Its notes move to the new scale (see
   * transformPitch for the exact rule); choosing Chromatic leaves them as they are. One
   * Undo step restores the scale and every pitch.
   */
  setPatternScale(v: number, choice: ScaleChoice): void {
    const p = this.pattern(v);
    const from = p.scale ? cleanChoice(p.scale) : CHROMATIC;
    const to = cleanChoice(choice);
    p.steps = transformSteps(p.steps, from, to);
    p.scale = to;
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
  /** MIDI Learn mappings: an application preference (app/prefs.ts) handed in by the UI. */
  learn: LearnMapping[] = [];
  /** a mapping waiting for a controller or key: its target, and the row it replaces */
  learnArmed: { target: LearnTarget; replace: number | null } | null = null;
  /** last Learn result, for display */
  learnNote = '';
  private learnLast = new Map<string, number>();

  armLearn(target: LearnTarget, replace: number | null = null): void {
    this.learnArmed = { target, replace };
    this.learnNote = `Move a controller or press a key for ${targetLabel(target)}… (Esc cancels)`;
    this.notify('learn');
  }

  cancelLearn(): void {
    if (!this.learnArmed) return;
    this.learnArmed = null;
    this.learnNote = 'Learn cancelled.';
    this.notify('learn');
  }

  removeLearn(i: number): void {
    const m = this.learn[i];
    if (!m) return;
    this.learn.splice(i, 1);
    this.learnNote = `Removed ${targetLabel(m.target)}.`;
    this.notify('learn');
  }

  /** Tempo from an external source: not rounded, widens the range if needed. */
  setTempoExact(bpm: number): void {
    const t = this.comp.tempo;
    t.value = Math.max(10, Math.min(400, bpm));
    if (t.value < t.lo) t.lo = Math.floor(t.value);
    if (t.value > t.hi) t.hi = Math.ceil(t.value);
  }

  // ------------------------------------------------------------------ MIDI clock input (MIDI Settings)

  readonly clockFollower = new ClockFollower();
  /** the incoming clock's tempo estimate, for display */
  clockIn = { bpm: 0 };

  /**
   * MIDI clock input (whether or not Extended is on): 0xF8 clock, and — with Start / Stop /
   * Continue followed — the transport by its MIDI meaning:
   *   FA Start     from the initial position (a running or halted emmm is stopped first);
   *                the first clock after it is the downbeat.
   *   FB Continue  from where an external Stop left off; from stopped it is a Start (MIDI:
   *                Start = Song Position 0 + Continue).
   *   FC Stop      notes off, the place kept (externalStop), so Continue can resume.
   *   F2 Song Position Pointer 0 while not playing = back to the beginning (DAWs send it
   *                before Continue to play from the top). Other positions are not located:
   *                M's performance is generative, not a timeline; Continue resumes from
   *                where emmm stopped.
   * Clock pulses while stopped (e.g. a master's "clock on stop") never start emmm.
   * Returns true if consumed.
   */
  private clockRealtime(port: string, data: ArrayLike<number>, ts: number): boolean {
    const ci = this.comp.midi.clockIn;
    if (!ci.enabled) return false;
    if (ci.port !== '*' && ci.port !== port) return false;
    const f = this.clockFollower;
    switch (data[0]) {
      case 0xf8: {
        if (!this.playing) {
          f.lastPulseMs = ts; // the clock is alive: Waiting, not Lost
          return true;
        }
        const bpm = f.pulse(ts);
        if (f.recovered) f.rebase(this.scheduler.nowTick());
        if (bpm) {
          const c = f.corrected(bpm, this.scheduler.nowTick());
          this.clockIn.bpm = bpm;
          this.setTempoExact(c);
        }
        return true;
      }
      case 0xfa:
        if (!ci.transport) return true;
        if (this.engine.state !== 'stopped') this.stop();
        f.reset();
        this.start();
        return true;
      case 0xfb:
        if (!ci.transport) return true;
        if (this.engine.state === 'paused') {
          this.pause(); // continue from the kept place
          f.reset();
          f.recovered = true; // the next pulse re-bases the phase on where emmm is
        } else if (this.engine.state === 'stopped') {
          f.reset();
          this.start();
        }
        return true;
      case 0xfc:
        if (!ci.transport) return true;
        this.externalStop();
        return true;
      case 0xf2: {
        if (!ci.transport) return true;
        const pos = ((data[1] ?? 0) & 0x7f) | (((data[2] ?? 0) & 0x7f) << 7);
        if (pos === 0 && this.engine.state === 'paused') this.stop();
        return true;
      }
    }
    return false;
  }

  /** MIDI Learn: arm a mapping, or apply learnt mappings. Returns true if consumed. */
  private extendedLearn(m: msg.ParsedMessage): boolean {
    if (!this.comp.extended.enabled) return false;
    if (m.type !== 'cc' && m.type !== 'noteon' && m.type !== 'noteoff') return false;
    const src: LearnSource = { type: m.type === 'cc' ? 'cc' : 'note', channel: m.channel, number: m.data1 };
    if (this.learnArmed) {
      if (m.type === 'noteoff') return true;
      const { target, replace } = this.learnArmed;
      const was = learnInto(this.learn, target, src, replace);
      this.learnArmed = null;
      this.learnNote = `${targetLabel(target)} ← ${src.type === 'cc' ? 'CC' : 'note'} ${src.number} ch${src.channel}` + (was && was !== targetLabel(target) ? ` (taken from ${was})` : '');
      // the gesture that taught it must not also trigger it
      this.learnLast.set(`${m.channel}:${m.data1}:${m.type === 'cc' ? 'cc' : 'n'}`, m.type === 'cc' ? m.data2 : 127);
      this.notify('learn');
      return true;
    }
    let used = false;
    for (const map of this.learn) {
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
      case 'position':
        if (rising || (m.type === 'cc' && val >= 64 && prev < 64)) this.clickPosition(t.variable, t.position);
        break;
      case 'pause':
        if (rising) this.pause();
        break;
      case 'mutate':
        if (rising) this.mutateNow();
        break;
      case 'mutationAmount':
        if (m.type === 'cc') this.setMutationAmount(Math.round((val / 127) * 100));
        break;
      case 'reroll':
        if (rising) this.reroll();
        break;
      case 'abRecall':
        if (rising) this.abRecall(t.slot);
        break;
      case 'abCapture':
        if (rising) this.abCapture(t.slot);
        break;
      case 'abToggle':
        if (rising) this.abToggle();
        break;
      case 'trajToggle':
        if (rising) this.setTrajectory(t.slot, { on: !this.comp.extended.trajectories[t.slot].on });
        break;
    }
  }

  // ------------------------------------------------------------------ EXTENDED: Trajectories

  /** Where each Trajectory is (runtime only). */
  traj: TrajState[] = Array.from({ length: TRAJECTORY_SLOTS }, freshState);
  private trajRngs: Rng[] = Array.from({ length: TRAJECTORY_SLOTS }, (_, i) => trajRng(0, i));
  /** a chain of steps is scheduled for this slot */
  trajLive = [false, false, false, false];
  /** the target each slot last applied (to release it when it changes) */
  private trajApplied: (TrajTarget | null)[] = [null, null, null, null];
  private trajAppliedKey = ['', '', '', ''];
  /** controller messages sent by Trajectories (for Performance Feedback / tests) */
  trajCcCount = 0;

  private trajActive(slot: number): boolean {
    const ext = this.comp.extended;
    const d = ext.trajectories[slot];
    return ext.enabled && !!d && d.on && d.target.kind !== 'none' && d.values.length > 0;
  }

  /** Start: every active Trajectory from its first step, at tick 0. */
  private trajStart(): void {
    this.trajRngs = this.trajRngs.map((_, i) => trajRng(this.comp.seed, i));
    for (let i = 0; i < TRAJECTORY_SLOTS; i++) {
      this.traj[i] = freshState();
      this.trajLive[i] = false;
      if (this.trajActive(i)) this.trajBegin(i, 0);
    }
  }

  /** Stop: everything released (note-level targets back to their Positions). */
  private trajStop(): void {
    for (let i = 0; i < TRAJECTORY_SLOTS; i++) {
      this.traj[i] = { ...freshState(), gen: this.traj[i].gen + 1 };
      this.trajLive[i] = false;
      this.trajApplied[i] = null;
      this.trajAppliedKey[i] = '';
    }
    this.engine.mod = neutralMod();
  }

  /** Begin a slot's chain at `tick` (first step chosen by its traversal). */
  private trajBegin(slot: number, tick: number): void {
    const d = this.comp.extended.trajectories[slot];
    const n = d.values.length;
    const st = this.traj[slot];
    st.gen++;
    st.index = d.mode === 'backward' ? n - 1 : d.mode === 'random' ? this.trajRngs[slot].int(0, n - 1) : 0;
    st.dir = d.mode === 'backward' ? -1 : 1;
    st.start = tick;
    st.end = tick; // the first action starts the step
    st.value = null;
    st.sent = null;
    st.held = false;
    (st as TrajState & { begun?: boolean }).begun = false;
    this.trajLive[slot] = true;
    this.trajSchedule(slot, tick);
  }

  private trajSchedule(slot: number, tick: number): void {
    const gen = this.traj[slot].gen;
    this.engine.schedule(tick, 'traj', (t) => {
      if (this.traj[slot].gen !== gen) return;
      return this.trajTick(slot, t);
    });
  }

  /** One Trajectory action: a new step at a step boundary, else a Smooth update. */
  private trajTick(slot: number, t: number): EngineEvent[] | void {
    if (!this.trajActive(slot)) {
      this.trajLive[slot] = false;
      this.trajRelease(slot);
      return;
    }
    const d = this.comp.extended.trajectories[slot];
    const st = this.traj[slot] as TrajState & { begun?: boolean };
    const n = d.values.length;
    if (t >= st.end - 1e-9) {
      if (st.begun) st.index = st.next % n;
      st.begun = true;
      st.index = Math.min(st.index, n - 1);
      st.held = false;
      st.start = t;
      st.end = t + stepTicks(d);
      const nx = nextIndex(d.mode, st.index, st.dir, n, this.trajRngs[slot]);
      st.next = nx.i;
      st.dir = nx.dir;
    }
    let out: EngineEvent[] | void = undefined;
    if (!st.held) out = this.trajApply(slot, d, valueAt(d, st, t), t);
    // The Trajectory's own Baton / Position moves are not a hand on them, and a Baton glide
    // must not make the whole screen recompute (only a real Position change does).
    if (out) out = out.filter((e) => !(e.kind === 'change' && e.what === 'baton')).map((e) => (e.kind === 'change' && e.what !== 'sync' ? { ...e, what: 'trajectory' } : e));
    const glide = d.smooth && targetInfo(d.target).kind !== 'enumerated';
    this.trajSchedule(slot, glide ? Math.min(t + SMOOTH_TICKS, st.end) : st.end);
    return out;
  }

  private trajPerVoice(d: Trajectory, f: (v: number) => void): void {
    d.voices.forEach((on, v) => on && f(v));
  }

  private trajApply(slot: number, d: Trajectory, value: number, t: number): EngineEvent[] | void {
    const st = this.traj[slot];
    // a different target than last time: give the old one back first (cheap check per update)
    const key = trajTargetKey(d.target);
    if (this.trajAppliedKey[slot] !== key) {
      if (this.trajApplied[slot]) this.trajRelease(slot);
      this.trajApplied[slot] = structuredClone(d.target);
      this.trajAppliedKey[slot] = key;
    }
    st.value = value;
    const m = this.engine.mod;
    const tg = d.target;
    switch (tg.kind) {
      case 'density':
        return this.trajPerVoice(d, (v) => (m.density[v] = Math.round(value)));
      case 'transpose':
        return this.trajPerVoice(d, (v) => (m.transpose[v] = Math.round(value)));
      case 'velocity':
        return this.trajPerVoice(d, (v) => (m.velocity[v] = Math.round(value)));
      case 'legato':
        return this.trajPerVoice(d, (v) => (m.legato[v] = value / 100));
      case 'tempo':
        this.setTempoExact(value);
        this.dirty = true; // redraw (the numbers read the value directly)
        return;
      case 'mutation':
        this.comp.extended.mutation.amount = Math.round(value);
        this.dirty = true;
        return;
      case 'batonX':
        this.dirty = true;
        return this.engine.conduct(value / 100, this.comp.conducting.baton.y, t, false);
      case 'batonY':
        this.dirty = true;
        return this.engine.conduct(this.comp.conducting.baton.x, value / 100, t, false);
      case 'position': {
        const pos = Math.max(0, Math.min(5, Math.round(value) - 1));
        if ((this.comp[tg.variable] as { active: number }).active === pos) return;
        return this.engine.selectPosition(tg.variable, pos, t);
      }
      case 'cc': {
        const v = Math.max(0, Math.min(127, Math.round(value)));
        if (st.sent === v) return; // never the same value twice in a row
        st.sent = v;
        const ms = this.scheduler.tickToMs(t);
        this.send(tg.channel, msg.controlChange(tg.channel, tg.cc, v), ms);
        this.movieAdd(t, msg.controlChange(this.outTarget(tg.channel).channel, tg.cc, v));
        this.trajCcCount++;
        return;
      }
    }
  }

  /** Give a target back: note-level modulation to neutral (others simply stay where they are). */
  private trajRelease(slot: number): void {
    const tg = this.trajApplied[slot];
    this.trajApplied[slot] = null;
    this.trajAppliedKey[slot] = '';
    if (!tg) return;
    const d = this.comp.extended.trajectories[slot];
    const m = this.engine.mod;
    const voices = d?.voices ?? [true, true, true, true];
    voices.forEach((on, v) => {
      if (!on) return;
      if (tg.kind === 'density') m.density[v] = null;
      if (tg.kind === 'transpose') m.transpose[v] = 0;
      if (tg.kind === 'velocity') m.velocity[v] = 0;
      if (tg.kind === 'legato') m.legato[v] = 1;
    });
  }

  /** A hand on a parameter a Trajectory drives: it wins until the Trajectory's next step. */
  private trajManual(what: string): void {
    if (!this.playing || !this.comp.extended.enabled) return;
    for (let i = 0; i < TRAJECTORY_SLOTS; i++) {
      if (!this.trajLive[i]) continue;
      const tg = this.comp.extended.trajectories[i].target;
      const hit =
        (tg.kind === 'density' && what === 'noteDensity') ||
        (tg.kind === 'tempo' && what === 'tempo') ||
        ((tg.kind === 'batonX' || tg.kind === 'batonY') && what === 'baton') ||
        (tg.kind === 'mutation' && what === 'mutation') ||
        (tg.kind === 'position' && what === tg.variable);
      if (!hit) continue;
      this.traj[i].held = true;
      if (tg.kind === 'density') this.trajRelease(i); // so the hand's own value is heard
    }
  }

  /** After edits / Undo: start chains that should run, stop the ones that should not. */
  trajSync(): void {
    if (this.engine.state === 'stopped') return;
    for (let i = 0; i < TRAJECTORY_SLOTS; i++) {
      const want = this.trajActive(i);
      if (want && !this.trajLive[i]) {
        // join on the Trajectory's own grid from Start, so it stays in step with the music
        const step = stepTicks(this.comp.extended.trajectories[i]);
        const now = this.scheduler.frontierTick();
        this.trajBegin(i, Math.ceil((now - 1e-6) / step) * step);
      } else if (!want && this.trajLive[i]) {
        this.traj[i].gen++;
        this.trajLive[i] = false;
        this.trajRelease(i);
      }
    }
  }

  /** Change a Trajectory's definition (one Undo step). Values, rate and traversal take
   * effect at the next step; switching it on joins at the next step of its own grid. */
  setTrajectory(slot: number, patch: Partial<Trajectory>): void {
    const ext = this.comp.extended;
    const cur = ext.trajectories[slot];
    if (!cur) return;
    const targetChanged = patch.target && JSON.stringify(patch.target) !== JSON.stringify(cur.target);
    const next = cleanTrajectory({ ...cur, ...patch });
    // a new target keeps the values where they fit its range
    Object.assign(cur, next);
    if (targetChanged && this.trajLive[slot]) {
      this.trajRelease(slot);
      this.traj[slot].gen++;
      this.trajLive[slot] = false;
    }
    this.trajSync();
    this.changed('trajectory-edit');
  }

  setTrajectoryValue(slot: number, i: number, value: number): void {
    const d = this.comp.extended.trajectories[slot];
    if (!d || i < 0 || i >= d.values.length) return;
    d.values[i] = clampTo(targetInfo(d.target), value);
    this.changed('trajectory-edit');
  }

  /** Add a value after `i` (a copy of it), up to 16. */
  addTrajectoryValue(slot: number, i = -1): number {
    const d = this.comp.extended.trajectories[slot];
    if (!d || d.values.length >= MAX_TRAJECTORY_VALUES) return -1;
    const at = i < 0 ? d.values.length - 1 : i;
    d.values.splice(at + 1, 0, d.values[at] ?? targetInfo(d.target).min);
    this.changed('trajectory-edit');
    return at + 1;
  }

  removeTrajectoryValue(slot: number, i: number): void {
    const d = this.comp.extended.trajectories[slot];
    if (!d || d.values.length <= 1 || i < 0 || i >= d.values.length) return;
    d.values.splice(i, 1);
    this.changed('trajectory-edit');
  }

  /** Clear: one value (the target's minimum, or 0 where 0 is legal). */
  clearTrajectory(slot: number): void {
    const d = this.comp.extended.trajectories[slot];
    if (!d) return;
    const info = targetInfo(d.target);
    d.values = [clampTo(info, 0)];
    this.changed('trajectory-edit');
  }

  /** Duplicate the sequence (1 2 3 → 1 2 3 1 2 3), up to 16 values. */
  duplicateTrajectory(slot: number): void {
    const d = this.comp.extended.trajectories[slot];
    if (!d) return;
    d.values = [...d.values, ...d.values].slice(0, MAX_TRAJECTORY_VALUES);
    this.changed('trajectory-edit');
  }

  // ------------------------------------------------------------------ EXTENDED: seed, locks, mutation, A/B

  /** Seeds for the engine: per-voice overrides only count in Extended mode. */
  private applySeedOverrides(): void {
    const ext = this.comp.extended;
    this.engine.seedOverride = ext.enabled ? ext.voiceSeeds.map((x) => (typeof x === 'number' ? x : null)) : [null, null, null, null];
  }

  /**
   * Reroll (Extended): a new seed — a new "take" of the same settings. Pattern material and
   * settings are untouched. Locked Voices keep their old seed (and keep playing exactly as
   * before); the others switch to the new random stream at once, without restarting.
   */
  reroll(seed = freshSeed()): void {
    const ext = this.comp.extended;
    const old = this.comp.seed;
    ext.voiceSeeds = ext.voiceSeeds.map((s, v) => (ext.locks.voices[v] ? (s ?? old) : null));
    this.comp.seed = seed >>> 0;
    this.applySeedOverrides();
    if (this.engine.state !== 'stopped') this.engine.voices.forEach((_, v) => !ext.locks.voices[v] && this.engine.reseedVoice(v, this.comp.seed));
    this.trajRngs = this.trajRngs.map((_, i) => trajRng(this.comp.seed, i));
    this.status = `Reroll: seed ${this.comp.seed}`;
    this.changed('seed');
  }

  setMutationAmount(x: number): void {
    this.comp.extended.mutation.amount = Math.max(0, Math.min(100, Math.round(x)));
    this.changed('mutation');
  }

  /** Mutate the active settings by the current amount, respecting Locks (one Undo step). */
  mutateNow(): string[] {
    const ext = this.comp.extended;
    this.history.commit();
    const rng = mutationRng(this.comp.seed, ext.mutation.count);
    ext.mutation.count++;
    const r = mutate(this.comp, ext.mutation.amount, ext.locks, rng);
    // (during Hold/Do a click would be collected, not performed: Positions then stay put)
    if (!this.hold) for (const p of r.positions) this.clickPosition(p.variable, p.position);
    this.status = r.changed.length ? `Mutated: ${r.changed.join(', ')}` : 'Mutate: nothing changed (everything locked?)';
    this.changed('mutation');
    this.history.commit();
    return r.changed;
  }

  abCapture(slot: 'a' | 'b'): void {
    this.comp.extended.ab[slot] = capturePerfState(this.comp);
    this.comp.extended.ab.last = slot;
    this.status = `Captured ${slot.toUpperCase()}`;
    this.changed('ab');
  }

  /** Recall A or B — safe while playing; a different Pattern Group is selected the M way. */
  abRecall(slot: 'a' | 'b'): void {
    const st = this.comp.extended.ab[slot];
    if (!st) return;
    const tick = this.scheduler.frontierTick();
    const r = recallPerfState(this.comp, st, (g, v, den) => {
      if (g === this.comp.patternGroup.active) this.engine.setTimeBaseDen(v, den, tick);
      else this.comp.patternGroups[g].patterns[v].tbDen = den;
    });
    if (r.patternGroup !== this.comp.patternGroup.active) this.clickPosition('patternGroup', r.patternGroup);
    this.comp.extended.ab.last = slot;
    this.status = `Recalled ${slot.toUpperCase()}`;
    this.changed('ab-recall');
  }

  abToggle(): void {
    const ab = this.comp.extended.ab;
    const to = ab.last === 'a' ? 'b' : 'a';
    if (ab[to]) this.abRecall(to);
    else if (ab[to === 'a' ? 'b' : 'a']) this.abRecall(to === 'a' ? 'b' : 'a');
  }

  /** External-clock status for display. */
  clockStatus(now = performance.now()): SyncStatus {
    if (!this.comp.midi.clockIn.enabled) return 'internal';
    return this.clockFollower.status(now, this.playing);
  }

  midiIn(port: string, data: ArrayLike<number>, ts: number): void {
    if (((data[0] ?? 0) >= 0xf8 || data[0] === 0xf2) && this.clockRealtime(port, data, ts)) return;
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
    // A document with no MIDI output assignment at all (File ▸ New, Open Demo) keeps the
    // current routing, so loading it does not silently disconnect the user's devices.
    if (comp.midi.outputs.every((o) => !o.port)) comp.midi = structuredClone(this.comp.midi);
    this.comp = comp;
    this.emitNow(this.engine.load(comp));
    this.editRng = new Rng(comp.seed, 500);
    this.hold = null;
    this.currentSnapshot = null;
    this.undoSnapshot = null;
    this.selected = [false, false, false, false];
    this.applySeedOverrides();
    this.history.reset();
    this.notify('load');
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
