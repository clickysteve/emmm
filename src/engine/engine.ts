/**
 * The M engine: turns a Composition into timed note events (M-BEHAVIOUR §2–§8).
 *
 * The engine knows nothing about milliseconds, MIDI ports or the DOM. It works in M
 * "ticks" (96 per quarter note) on a master timeline that starts at 0 when Start is
 * pressed and does not advance while paused. A scheduler asks it to `render(toTick)` a little
 * ahead of real time; the engine reads the Composition *live* at each event, exactly as M's
 * interrupt routine read the global variables the user interface was changing (S2).
 */
import { ACCENT_MAPPING, NUM_VOICES, STEP_ADVANCE, TICKS_PER_WHOLE, noteValueTicks } from './constants';
import { conductAt } from './conducting';
import { Rng } from './rng';
import { unwarp, warp } from './timeDistortion';
import type { Composition, CycleStep, Pattern, Snapshot, VariableName } from './types';

export interface NoteOnEvent {
  kind: 'on';
  tick: number;
  voice: number;
  /** M Output Channel 1..16 (mapped to a device/channel by the MIDI layer) */
  channel: number;
  pitch: number;
  velocity: number;
  id: number;
}
export interface NoteOffEvent {
  kind: 'off';
  tick: number;
  voice: number;
  channel: number;
  pitch: number;
  id: number;
}
export interface ProgramEvent {
  kind: 'program';
  tick: number;
  channel: number;
  program: number;
}
/** Bookkeeping for the UI: one per voice event (played or not). */
export interface StepEvent {
  kind: 'step';
  tick: number;
  voice: number;
  /** index into pattern.steps that was chosen, -1 if none */
  stepIndex: number;
  scheme: 'original' | 'cyclic' | 'utterly' | 'none';
  played: boolean;
  patternRestart: boolean;
  cycleRestart: { rhythm: boolean; legato: boolean; accent: boolean };
  levels: { rhythm: number; legato: number; accent: number };
  pitches: number[];
  velocity: number;
  interval: number;
}
/** A state change performed by the engine at a musical time (quantized action, robot …). */
export interface ChangeEvent {
  kind: 'change';
  tick: number;
  what: string;
}
export type EngineEvent = NoteOnEvent | NoteOffEvent | ProgramEvent | StepEvent | ChangeEvent;

export type EngineState = 'stopped' | 'playing' | 'paused';

interface PendingOff {
  tick: number;
  voice: number;
  channel: number;
  pitch: number;
  id: number;
}

interface ScheduledAction {
  tick: number;
  seq: number;
  run: (tick: number) => EngineEvent[] | void;
  label: string;
}

/** Per-voice runtime state (not saved in the composition). */
export interface VoiceRuntime {
  /** master tick where this voice's clock 0 sits (sync tick + phase) */
  origin: number;
  /** voice clock time (ticks after origin, before time distortion) of the next event */
  clock: number;
  /** read position in the Output Length (§4) */
  position: number;
  cycle: { rhythm: number; legato: number; accent: number };
  rng: Rng;
  /** Keyboard Transpose offset in semitones, null when none received (§9) */
  keyTranspose: number | null;
  /** notes held by a step-advance key: released on key-up */
  heldStepNotes: { channel: number; pitch: number; id: number }[];
  /** last emitted step event (for UI) */
  last: StepEvent | null;
}

export interface EngineOptions {
  /** Called whenever the engine changes the composition itself (quantized actions …). */
  onChange?: (what: string) => void;
}

const CYCLES = ['rhythm', 'legato', 'accent'] as const;

export class MEngine {
  comp: Composition;
  state: EngineState = 'stopped';
  /** master tick up to which events have been rendered */
  tick = 0;
  voices: VoiceRuntime[];
  private offs: PendingOff[] = [];
  private actions: ScheduledAction[] = [];
  private actionSeq = 0;
  private nextId = 1;
  private sounding = new Map<string, number>(); // "ch:pitch" -> note id
  private cancelled = new Set<number>();
  /** Mouse Advance gate (§9) and the extra velocity from mouse speed. */
  mouseAdvanceActive = false;
  mouseAdvanceVelocity = 0;
  /** Tap-Affects-Velocity global offset. */
  globalVelocityOffset = 0;
  /** Robot conductor */
  private robotRng: Rng;
  private robotNext = 0;
  private opts: EngineOptions;

  constructor(comp: Composition, opts: EngineOptions = {}) {
    this.comp = comp;
    this.opts = opts;
    this.voices = Array.from({ length: NUM_VOICES }, (_, v) => this.freshVoice(v));
    this.robotRng = new Rng(comp.seed, 1000);
  }

  private freshVoice(v: number): VoiceRuntime {
    return {
      origin: 0,
      clock: 0,
      position: 0,
      cycle: { rhythm: 0, legato: 0, accent: 0 },
      rng: new Rng(this.comp.seed, v + 1),
      keyTranspose: null,
      heldStepNotes: [],
      last: null,
    };
  }

  /** Replace the composition (file load). Stops first. */
  load(comp: Composition): EngineEvent[] {
    const ev = this.stop();
    this.comp = comp;
    this.voices = Array.from({ length: NUM_VOICES }, (_, v) => this.freshVoice(v));
    this.robotRng = new Rng(comp.seed, 1000);
    return ev;
  }

  // ---------------------------------------------------------------- accessors

  pattern(v: number): Pattern {
    return this.comp.patternGroups[this.comp.patternGroup.active].patterns[v];
  }

  /** Base pulse in ticks for a voice (§2). Infinity for step advance. */
  baseTicks(v: number): number {
    const p = this.pattern(v);
    if (p.tbDen === STEP_ADVANCE) return Infinity;
    return (Math.max(1, p.tbNum) * TICKS_PER_WHOLE) / p.tbDen;
  }

  private timeMap(v: number) {
    return this.comp.timeDistortion.positions[this.comp.timeDistortion.active][v];
  }

  /** Master tick of the voice's next event. */
  nextEventTick(v: number): number {
    if (this.pattern(v).tbDen === STEP_ADVANCE) return Infinity;
    const vr = this.voices[v];
    return vr.origin + warp(this.timeMap(v), vr.clock);
  }

  // ---------------------------------------------------------------- transport

  /** Start (§11): from stopped re-seeds randomness and plays from the beginning; while
   * playing it is a Sync. Returns events to emit immediately (note-offs). */
  start(): EngineEvent[] {
    if (this.state === 'paused') {
      this.state = 'playing';
      return [];
    }
    if (this.state === 'playing') return this.sync(this.tick);
    this.state = 'playing';
    this.tick = 0;
    this.offs = [];
    this.actions = [];
    this.sounding.clear();
    this.cancelled.clear();
    this.voices.forEach((vr, v) => {
      vr.rng.reseed(this.comp.seed, v + 1);
      vr.heldStepNotes = [];
      vr.last = null;
    });
    this.robotRng.reseed(this.comp.seed, 1000);
    this.robotNext = 0;
    this.resetVoices(0);
    return [];
  }

  /** Stop (§11): all sounding notes off, generation halts. */
  stop(): EngineEvent[] {
    const out: EngineEvent[] = [];
    for (const o of this.offs) {
      if (this.cancelled.has(o.id)) continue;
      out.push({ kind: 'off', tick: this.tick, voice: o.voice, channel: o.channel, pitch: o.pitch, id: o.id });
    }
    for (const vr of this.voices) {
      for (const h of vr.heldStepNotes) out.push({ kind: 'off', tick: this.tick, voice: -1, channel: h.channel, pitch: h.pitch, id: h.id });
      vr.heldStepNotes = [];
    }
    this.offs = [];
    this.actions = [];
    this.sounding.clear();
    this.cancelled.clear();
    this.state = 'stopped';
    return out;
  }

  /** Pause (§11): freezes the clock without releasing notes. Toggle. */
  pause(): void {
    if (this.state === 'playing') this.state = 'paused';
    else if (this.state === 'paused') this.state = 'playing';
  }

  private resetVoices(at: number): void {
    this.voices.forEach((vr, v) => {
      vr.origin = at + this.pattern(v).phase;
      vr.clock = 0;
      vr.position = 0;
      vr.cycle = { rhythm: 0, legato: 0, accent: 0 };
    });
  }

  /** Sync (§11): all voices back to step 1 / cycle step 1 at `at`. */
  sync(at: number): EngineEvent[] {
    this.resetVoices(at);
    return [{ kind: 'change', tick: at, what: 'sync' }];
  }

  /** Next quantization point ≥ tick, counted from Start (§12). */
  quantizeTick(tick: number, quant = this.comp.quantization): number {
    if (!quant || this.state === 'stopped') return tick;
    const q = noteValueTicks(quant);
    return Math.ceil((tick - 1e-6) / q) * q;
  }

  /** Schedule a composition change at a musical time. */
  schedule(tick: number, label: string, run: (tick: number) => EngineEvent[] | void): void {
    this.actions.push({ tick, seq: this.actionSeq++, run, label });
    this.actions.sort((a, b) => a.tick - b.tick || a.seq - b.seq);
  }

  /** Run `run` now if not playing, else at the next quantization point (when quantized). */
  perform(nowTick: number, quantized: boolean, label: string, run: (tick: number) => EngineEvent[] | void): EngineEvent[] {
    if (this.state !== 'playing' || !quantized || !this.comp.quantization) {
      return run(nowTick) || [];
    }
    this.schedule(this.quantizeTick(nowTick), label, run);
    return [];
  }

  pendingActions(): { tick: number; label: string }[] {
    return this.actions.map((a) => ({ tick: a.tick, label: a.label }));
  }

  // ---------------------------------------------------------------- variables

  /** Select a Variable Position, with its side effects (program changes, sync). */
  selectPosition(variable: VariableName, position: number, tick: number, opts: { noSync?: boolean } = {}): EngineEvent[] {
    const out: EngineEvent[] = [];
    if (variable === 'soundChoice') {
      this.comp.soundChoice.active = position;
      out.push(...this.programChanges(tick));
    } else if (variable === 'patternGroup') {
      this.comp.patternGroup.active = position;
      if (!opts.noSync && this.state !== 'stopped') out.push(...this.sync(tick));
    } else {
      (this.comp[variable] as { active: number }).active = position;
    }
    out.push({ kind: 'change', tick, what: variable });
    return out;
  }

  /** Program changes for the active Sound Choice Position. */
  programChanges(tick: number): ProgramEvent[] {
    const pos = this.comp.soundChoice.positions[this.comp.soundChoice.active];
    const out: ProgramEvent[] = [];
    pos.forEach((prog, ch) => {
      if (prog !== null && prog !== undefined) out.push({ kind: 'program', tick, channel: ch + 1, program: prog });
    });
    return out;
  }

  /** Apply a Snapshot (§12). */
  applySnapshot(s: Snapshot, tick: number, forceSync = false): EngineEvent[] {
    const out: EngineEvent[] = [];
    const order: VariableName[] = ['patternGroup', ...Object.keys(s.positions).filter((k) => k !== 'patternGroup')] as VariableName[];
    for (const k of order) {
      const p = s.positions[k];
      if (p === undefined) continue;
      out.push(...this.selectPosition(k, p, tick, { noSync: true }));
    }
    for (const [k, a] of Object.entries(s.arrows)) {
      if (a) this.comp.conducting.arrows[k as keyof typeof this.comp.conducting.arrows] = { ...a };
    }
    s.voices.forEach((vi, v) => {
      if (!vi) return;
      const vs = this.comp.voices[v];
      const p = this.pattern(v);
      if (vi.src !== undefined) vs.src = vi.src;
      if (vi.playEnable !== undefined) vs.playEnable = vi.playEnable;
      if (vi.echoThru !== undefined) vs.echoThru = vi.echoThru;
      if (vi.mouseAdvance !== undefined) vs.mouseAdvance = vi.mouseAdvance;
      if (vi.outputLength !== undefined) p.outputLength = Math.min(vi.outputLength, p.steps.length);
      if (vi.tbNum !== undefined) p.tbNum = vi.tbNum;
      if (vi.tbDen !== undefined) this.setTimeBaseDen(v, vi.tbDen, tick);
      if (vi.phase !== undefined) p.phase = vi.phase;
    });
    if ((s.sync || forceSync) && this.state !== 'stopped') out.push(...this.sync(tick));
    out.push({ kind: 'change', tick, what: 'snapshot' });
    return out;
  }

  /** Change a voice's Time Base denominator, waking a step-advance voice if needed. */
  setTimeBaseDen(v: number, den: number, tick: number): void {
    const p = this.pattern(v);
    const wasSa = p.tbDen === STEP_ADVANCE;
    p.tbDen = den;
    if (wasSa && den !== STEP_ADVANCE) {
      const vr = this.voices[v];
      vr.clock = Math.max(0, unwarp(this.timeMap(v), Math.max(0, tick - vr.origin)));
      if (tick < vr.origin) vr.clock = 0;
    }
  }

  // ---------------------------------------------------------------- rendering

  /**
   * Generate every event with tick ≤ toTick, in time order. Advances `this.tick`.
   * Does nothing unless playing.
   */
  render(toTick: number): EngineEvent[] {
    const out: EngineEvent[] = [];
    if (this.state !== 'playing') return out;
    let guard = 0;
    for (;;) {
      if (++guard > 100000) break; // defensive: never hang the audio thread
      const offT = this.offs.length ? this.offs[0].tick : Infinity;
      const actT = this.actions.length ? this.actions[0].tick : Infinity;
      const robT = this.comp.conducting.robot.enabled ? this.robotNext : Infinity;
      let vT = Infinity;
      let vIdx = -1;
      for (let v = 0; v < NUM_VOICES; v++) {
        let t = this.nextEventTick(v);
        if (t < this.tick) t = this.tick; // map edits may move an event into the past
        if (t < vT) {
          vT = t;
          vIdx = v;
        }
      }
      const t = Math.min(offT, actT, robT, vT);
      if (t > toTick || t === Infinity) break;
      if (offT === t) {
        const o = this.offs.shift()!;
        if (this.cancelled.delete(o.id)) continue;
        const key = o.channel + ':' + o.pitch;
        if (this.sounding.get(key) === o.id) this.sounding.delete(key);
        out.push({ kind: 'off', tick: t, voice: o.voice, channel: o.channel, pitch: o.pitch, id: o.id });
        continue;
      }
      if (actT === t) {
        const a = this.actions.shift()!;
        const ev = a.run(t);
        if (ev) out.push(...ev);
        this.opts.onChange?.(a.label);
        continue;
      }
      if (robT === t) {
        out.push(...this.robotStep(t));
        continue;
      }
      out.push(...this.voiceEvent(vIdx, Math.max(t, this.tick)));
    }
    if (toTick > this.tick) this.tick = toTick;
    return out;
  }

  private pickLevel(step: CycleStep | undefined, rng: Rng): number {
    if (!step) {
      rng.nextU32();
      return 1;
    }
    return rng.int(Math.min(step.lo, step.hi), Math.max(step.lo, step.hi));
  }

  /** Read the next step of a voice's cycle and advance it. */
  private cycleRead(v: number, which: (typeof CYCLES)[number]): { level: number; restart: boolean } {
    const vr = this.voices[v];
    const variable = this.comp[which];
    const cycle = variable.positions[variable.active][v];
    const len = Math.max(1, cycle.length);
    const idx = vr.cycle[which] % len;
    const level = this.pickLevel(cycle[idx], vr.rng);
    vr.cycle[which] = (idx + 1) % len;
    return { level, restart: idx === 0 && len > 1 };
  }

  /** Accent level → velocity (§6). */
  velocityFor(v: number, accent: number): number {
    const r = this.comp.velocityRange.positions[this.comp.velocityRange.active][v];
    const lo = Math.min(r.lo, r.hi);
    const hi = Math.max(r.lo, r.hi);
    let vel: number;
    if (ACCENT_MAPPING === 'spread') vel = lo + ((hi - lo) * (Math.max(1, accent) - 1)) / 3;
    else vel = lo + ((hi - lo) * accent) / 4;
    const cont = this.comp.conducting.continuousVelocity.values[v] ?? 0;
    vel += cont + this.globalVelocityOffset;
    return Math.max(1, Math.min(127, Math.round(vel)));
  }

  /** Total transposition for a voice in semitones (§9). */
  transposition(v: number): number {
    const t = this.comp.transposition.positions[this.comp.transposition.active][v];
    const k = this.voices[v].keyTranspose;
    if (k === null) return t;
    return this.comp.options.secondOrderTranspose ? t + k : k;
  }

  /**
   * Choose the pattern step for this event (§4 step 4). Returns -1 for an empty pattern.
   * Always consumes exactly one or two random numbers.
   */
  private chooseStep(v: number): { index: number; scheme: StepEvent['scheme']; restart: boolean } {
    const vr = this.voices[v];
    const p = this.pattern(v);
    const order = this.comp.noteOrder.positions[this.comp.noteOrder.active][v];
    const r = vr.rng.next() * 100;
    const len = Math.min(p.outputLength, p.steps.length);
    if (len <= 0) {
      vr.position = 0;
      return { index: -1, scheme: 'none', restart: false };
    }
    const pos = vr.position % len;
    const restart = pos === 0;
    vr.position = (pos + 1) % len;
    if (r < order.original) return { index: pos, scheme: 'original', restart };
    if (r < order.original + order.cyclic) {
      let idx = p.scrambled[pos] ?? pos;
      if (idx >= len) idx = idx % len; // @m-uncertain §4: scrambled index beyond Output Length
      return { index: idx, scheme: 'cyclic', restart };
    }
    return { index: vr.rng.int(0, len - 1), scheme: 'utterly', restart };
  }

  /** One voice event (§4). */
  private voiceEvent(v: number, t: number): EngineEvent[] {
    const vr = this.voices[v];
    const vs = this.comp.voices[v];
    const base = this.baseTicks(v);
    const out: EngineEvent[] = [];

    // Mouse Advance (§9): the voice keeps time but does not step unless the gate is open.
    if (vs.mouseAdvance && !this.mouseAdvanceActive) {
      vr.clock += base;
      return out;
    }

    const rh = this.cycleRead(v, 'rhythm');
    const lg = this.cycleRead(v, 'legato');
    const ac = this.cycleRead(v, 'accent');
    const mult = this.comp.rhythmValues[rh.level] ?? 1;
    const interval = Math.max(1, base * mult);
    const choice = this.chooseStep(v);
    const p = this.pattern(v);
    const step = choice.index >= 0 ? p.steps[choice.index] : [];
    const density = this.comp.noteDensity.positions[this.comp.noteDensity.active][v];
    const dense = vr.rng.chance(density);
    const played = vs.playEnable && step.length > 0 && ac.level > 0 && dense;

    let velocity = 0;
    const pitches: number[] = [];
    if (played) {
      velocity = this.velocityFor(v, ac.level);
      if (vs.mouseAdvance) velocity = Math.max(1, Math.min(127, velocity + this.mouseAdvanceVelocity));
      const tr = this.transposition(v);
      const legatoMul = this.comp.conducting.continuousLegato.values[v] ?? 1;
      const pct = (this.comp.legatoValues[lg.level] ?? 50) * legatoMul;
      // Duration is a percentage of the time to the next event, measured in real time so
      // that time distortion stretches durations along with onsets.
      const tm = this.timeMap(v);
      const realNext = vr.origin + warp(tm, vr.clock + interval);
      const realInterval = Math.max(0.25, realNext - t);
      const dur = Math.max(0.25, (realInterval * pct) / 100);
      const channels = this.comp.orchestration.positions[this.comp.orchestration.active][v];
      for (const raw of step) {
        const pitch = raw + tr;
        if (pitch < 0 || pitch > 127) continue;
        pitches.push(pitch);
        for (const ch of channels) out.push(...this.noteOn(v, ch, pitch, velocity, t, t + dur));
      }
    }
    const ev: StepEvent = {
      kind: 'step',
      tick: t,
      voice: v,
      stepIndex: choice.index,
      scheme: choice.scheme,
      played,
      patternRestart: choice.restart,
      cycleRestart: { rhythm: rh.restart, legato: lg.restart, accent: ac.restart },
      levels: { rhythm: rh.level, legato: lg.level, accent: ac.level },
      pitches,
      velocity,
      interval,
    };
    vr.last = ev;
    out.unshift(ev);
    vr.clock += interval;
    return out;
  }

  private noteOn(voice: number, channel: number, pitch: number, velocity: number, t: number, offTick: number): EngineEvent[] {
    const out: EngineEvent[] = [];
    const key = channel + ':' + pitch;
    const prev = this.sounding.get(key);
    if (prev !== undefined) {
      // Re-attack of a sounding note: end the old one now, drop its pending off.
      this.cancelled.add(prev);
      out.push({ kind: 'off', tick: t, voice, channel, pitch, id: prev });
    }
    const id = this.nextId++;
    this.sounding.set(key, id);
    out.push({ kind: 'on', tick: t, voice, channel, pitch, velocity, id });
    if (offTick !== Infinity) this.insertOff({ tick: offTick, voice, channel, pitch, id });
    return out;
  }

  private insertOff(o: PendingOff): void {
    let i = this.offs.length;
    while (i > 0 && this.offs[i - 1].tick > o.tick) i--;
    this.offs.splice(i, 0, o);
  }

  // ---------------------------------------------------------------- performance gestures

  /**
   * Step Advance (§14 Input Control, Time Base "sa"): play the voice's next event now,
   * held until `stepRelease`. Velocity comes from the key.
   */
  stepAdvance(v: number, keyVelocity: number, t = this.tick): EngineEvent[] {
    if (this.state !== 'playing') return [];
    const vr = this.voices[v];
    const vs = this.comp.voices[v];
    const out: EngineEvent[] = [...this.stepRelease(v, t)];
    const rh = this.cycleRead(v, 'rhythm');
    const lg = this.cycleRead(v, 'legato');
    const ac = this.cycleRead(v, 'accent');
    const choice = this.chooseStep(v);
    const p = this.pattern(v);
    const step = choice.index >= 0 ? p.steps[choice.index] : [];
    const density = this.comp.noteDensity.positions[this.comp.noteDensity.active][v];
    const dense = vr.rng.chance(density);
    const played = vs.playEnable && step.length > 0 && ac.level > 0 && dense;
    const pitches: number[] = [];
    if (played) {
      const tr = this.transposition(v);
      const channels = this.comp.orchestration.positions[this.comp.orchestration.active][v];
      for (const raw of step) {
        const pitch = raw + tr;
        if (pitch < 0 || pitch > 127) continue;
        pitches.push(pitch);
        for (const ch of channels) {
          const evs = this.noteOn(v, ch, pitch, Math.max(1, Math.min(127, keyVelocity)), t, Infinity);
          const on = evs.find((e) => e.kind === 'on') as NoteOnEvent;
          vr.heldStepNotes.push({ channel: ch, pitch, id: on.id });
          out.push(...evs);
        }
      }
    }
    const ev: StepEvent = {
      kind: 'step',
      tick: t,
      voice: v,
      stepIndex: choice.index,
      scheme: choice.scheme,
      played,
      patternRestart: choice.restart,
      cycleRestart: { rhythm: rh.restart, legato: lg.restart, accent: ac.restart },
      levels: { rhythm: rh.level, legato: lg.level, accent: ac.level },
      pitches,
      velocity: keyVelocity,
      interval: 0,
    };
    vr.last = ev;
    out.unshift(ev);
    return out;
  }

  stepRelease(v: number, t = this.tick): EngineEvent[] {
    const vr = this.voices[v];
    const out: EngineEvent[] = [];
    for (const h of vr.heldStepNotes) {
      const key = h.channel + ':' + h.pitch;
      if (this.sounding.get(key) === h.id) {
        this.sounding.delete(key);
        out.push({ kind: 'off', tick: t, voice: v, channel: h.channel, pitch: h.pitch, id: h.id });
      }
    }
    vr.heldStepNotes = [];
    return out;
  }

  /** Keyboard Transpose input (§9): a note number, C3 (60) = no transposition. */
  keyboardTranspose(v: number, note: number): void {
    this.voices[v].keyTranspose = note - 60;
  }

  // ---------------------------------------------------------------- robot conductor

  /** Automatic Conducting (§10): one jump. */
  private robotStep(t: number): EngineEvent[] {
    const r = this.comp.conducting.robot;
    this.robotNext = t + noteValueTicks(Math.max(1, r.rate));
    const b = this.comp.conducting.baton;
    const dx = (this.robotRng.next() * 2 - 1) * r.hRange;
    const dy = (this.robotRng.next() * 2 - 1) * r.vRange;
    const nx = Math.max(0, Math.min(0.999, b.x + dx));
    const ny = Math.max(0, Math.min(0.999, b.y + dy));
    return this.conduct(nx, ny, t, false);
  }

  /** Move the baton and apply the result (manual, robot, MIDI conduct). */
  conduct(x: number, y: number, t: number, fresh: boolean): EngineEvent[] {
    const res = conductAt(this.comp, x, y, fresh);
    const out: EngineEvent[] = [];
    for (const p of res.positions) out.push(...this.selectPosition(p.variable, p.position, t));
    if (res.tempo !== null) this.comp.tempo.value = res.tempo;
    if (res.snapshot !== null) {
      const s = this.comp.snapshots[res.snapshot];
      if (s) out.push(...this.applySnapshot(s, t));
    }
    out.push({ kind: 'change', tick: t, what: 'baton' });
    return out;
  }
}
