/**
 * EXTENDED — the Conductor runtime: runs the Robot Conductors, the Rules and Home / Return
 * (docs/CONDUCTORS.md). Musical things happen inside the engine's render at exact ticks: Robot
 * decisions and Return steps are engine actions, and Rules react through the engine's
 * `observer` hook. A hand (a click, a Snapshot, MIDI Learn …) is seen at once through `poke`,
 * also while paused or stopped. Nothing here runs unless the document's Extended is on; with it
 * off the engine's hooks are null and Classic is untouched.
 *
 * Ownership of a Variable's Position, highest first: RETURN (while it brings the Variable Home,
 * and for the rest period after) > TRAJECTORY > ROBOT. `owns(v, t)` answers "is it Return's
 * now?"; Robots, M's Baton robot, Position / Baton Trajectories and Rule "set Position" actions
 * all ask before they write.
 *
 * Runtime state only — never saved, never part of Undo. Start rebuilds it; Stop clears it.
 */
import { NUM_VOICES, noteValueTicks } from '../engine/constants';
import { cellIndex } from '../engine/conducting';
import type { EngineEvent, MEngine, StepEvent } from '../engine/engine';
import { Rng } from '../engine/rng';
import type { Composition, Snapshot, VariableName } from '../engine/types';
import {
  candidates,
  chooseOther,
  decide,
  freshMemory,
  NUM_ROBOTS,
  PERSONALITIES,
  remember,
  resolvePosition,
  robotStepTicks,
  ROBOT_VARS,
  VAR_SHORT,
  type Personality,
  type RobotMemory,
  type TargetView,
} from '../extended/conductors';
import { activeOf, homeDistance, homeVars, returnPath, returnTicks } from '../extended/home';
import { actionWords, intervalTicks, matches, MAX_DEFERRED, MAX_DEPTH, MAX_QUEUE, type Action, type CondEvent, type CycleKind, type Rule } from '../extended/rules';

/** What the Conductor needs from the Session. */
export interface ConductorHost {
  readonly comp: Composition;
  readonly engine: MEngine;
  /** Recall Snapshot `index` at tick `t` (the Session keeps its Restore state); null = empty */
  recallSnapshotAt(index: number, t: number): EngineEvent[] | null;
}

/** M's conducting arrows in M's order (to read the Baton robot's Position). */
const ARROW_VARS: VariableName[] = ['patternGroup', 'noteDensity', 'velocityRange', 'noteOrder', 'transposition', 'timeDistortion', 'accent', 'legato', 'rhythm', 'orchestration'];
const CYCLES: CycleKind[] = ['pattern', 'rhythm', 'legato', 'accent'];
const LOG_MAX = 40;

interface Queued {
  ev: CondEvent;
  depth: number;
}

interface RuleRt {
  count: number;
  next: number;
  firedTick: number;
  /** times it fired since Start */
  fires: number;
  /** tick it last fired (display) */
  flash: number;
}

export interface ReturnRt {
  start: number;
  end: number;
  grid: number;
  vars: VariableName[];
  rr: number;
  gen: number;
  /** steps from Home when it began (progress = 1 − remaining / total) */
  total: number;
}

/** After a Return: these Variables stay at Home, owned by the Return, until `until`. */
export interface RestHold {
  vars: VariableName[];
  until: number;
}

export type LogKind = 'move' | 'rule' | 'return' | 'robot' | 'info';
export interface LogEntry {
  tick: number;
  text: string;
  kind: LogKind;
  /** the Robot that moved (kind 'move') */
  robot?: number;
  /** happened while stopped (no musical time) */
  stopped?: boolean;
}

/** How a Variable stands with Home (the Home tab). */
export type HomeVarState = 'none' | 'excluded' | 'home' | 'away' | 'returning' | 'waiting' | 'resting';

export class Conductor {
  /** each Robot's memory (Position, visits …) */
  mem: RobotMemory[] = Array.from({ length: NUM_ROBOTS }, () => freshMemory(0));
  private rng: Rng[] = Array.from({ length: NUM_ROBOTS }, (_, i) => new Rng(0, 6000 + i));
  /** next decision tick on each Robot's grid (Infinity = none) */
  next: number[] = [Infinity, Infinity, Infinity, Infinity];
  suspendedUntil = [-Infinity, -Infinity, -Infinity, -Infinity];
  /** Variables resting at Home after a Return (still owned by it) */
  restHold: RestHold | null = null;
  private seenTargetMoves = [0, 0, 0, 0];
  /** Rule-made changes (performing, not editing): null = as the document says */
  enabledOverride: (boolean | null)[] = [null, null, null, null];
  personalityOverride: (Personality | null)[] = [null, null, null, null];
  /** a Follower / Contrarian with nothing to watch */
  waiting = [false, false, false, false];
  lastMoveTick = [-Infinity, -Infinity, -Infinity, -Infinity];
  /** Variables each Robot changed last time (display) */
  lastChanged: string[] = ['', '', '', ''];
  ret: ReturnRt | null = null;
  log: LogEntry[] = [];
  /** events dropped because a pass overflowed (diagnostics) */
  dropped = 0;
  private ruleRt = new WeakMap<Rule, RuleRt>();
  private queue: Queued[] = [];
  private curTick = -1;
  private fired = new Set<number>();
  private lastPos: Partial<Record<VariableName, number>> = {};
  private lastDistance: number | null = null;
  /** per Voice per cycle: events since the cycle last began (-1 = not started) */
  private cycleCount: number[][] = Array.from({ length: NUM_VOICES }, () => [0, 0, 0, 0]);
  private deferred = 0;
  /** invalidates everything scheduled before (Stop, Extended off) */
  private runGen = 0;
  private hubGen = 0;
  private retGen = 0;
  /** depth carried into the scan after a deferred action */
  private scanDepth = 0;
  private out: EngineEvent[] = [];
  /** whether Start has initialised the runtime */
  private live = false;

  constructor(private host: ConductorHost) {}

  private get comp(): Composition {
    return this.host.comp;
  }
  private get ext() {
    return this.host.comp.extended;
  }
  private get engine(): MEngine {
    return this.host.engine;
  }
  private get on(): boolean {
    return this.ext.enabled;
  }

  // ------------------------------------------------------------------ Robot state

  /** Is Robot i switched on (document, or a Rule's override)? Robot 1 = M's robot button. */
  robotOn(i: number): boolean {
    if (!this.on) return false;
    const o = this.enabledOverride[i];
    if (o !== null) return o;
    return i === 0 ? this.comp.conducting.robot.enabled : this.ext.robots[i].enabled;
  }

  personality(i: number): Personality {
    const p = this.personalityOverride[i] ?? this.ext.robots[i].personality;
    return p === 'baton' && i !== 0 ? 'drunk' : p;
  }

  isBaton(i: number): boolean {
    return i === 0 && this.personality(0) === 'baton';
  }

  /** Is Robot i choosing Positions itself (on, and not M's Baton robot)? */
  positionRobot(i: number): boolean {
    return this.robotOn(i) && !this.isBaton(i);
  }

  /** The Variables a Robot moves: its own list, or (Baton) those with arrows on. */
  variables(i: number): VariableName[] {
    if (this.isBaton(i)) {
      const c = this.comp.conducting;
      return ARROW_VARS.filter((v) => c.arrows[v].enabled && !(v === 'velocityRange' && c.continuousMode.velocityRange) && !(v === 'legato' && c.continuousMode.legato));
    }
    return [...this.ext.robots[i].variables];
  }

  /** The Baton robot's Position: the cell of its first arrowed Variable, else the Baton ↔ cell. */
  batonPos(): number {
    const vars = this.variables(0);
    if (this.isBaton(0) && vars.length) return activeOf(this.comp, vars[0]);
    return cellIndex(this.comp.conducting.baton.x);
  }

  /** Robot i's Home Position: its own, else Home of its first Variable (if captured). */
  robotHome(i: number): number | null {
    const d = this.ext.robots[i];
    if (d.home !== null) return d.home;
    const v = this.variables(i)[0];
    const hp = v ? this.ext.home.positions?.[v] : undefined;
    return hp !== undefined && hp < 6 ? hp : null;
  }

  /** Where Robot i is (playing: its memory; stopped: its first Variable now). */
  displayPos(i: number): number {
    if (this.live) return this.mem[i].pos;
    return this.initialPos(i);
  }

  private initialPos(i: number): number {
    if (this.isBaton(i)) return this.batonPos();
    const v = this.ext.robots[i].variables[0];
    return v ? activeOf(this.comp, v) : 0;
  }

  suspended(i: number, t = this.engine.tick): boolean {
    return t < this.suspendedUntil[i];
  }

  /** "Returning" claims these Variables. */
  returning(v: VariableName): boolean {
    return !!this.ret && this.ret.vars.includes(v);
  }

  /** Does Return own Variable v at tick t (bringing it Home, or resting it there)? Then no
   * Robot, Trajectory or Rule may set its Position. */
  owns(v: VariableName, t = this.engine.tick): boolean {
    if (this.returning(v)) return true;
    const h = this.restHold;
    return !!h && t < h.until && h.vars.includes(v);
  }

  /** The Home tab's view of one Variable. */
  homeState(v: VariableName): HomeVarState {
    const home = this.ext.home;
    if (!home.positions || home.positions[v] === undefined) return 'none';
    if (!home.include[v]) return 'excluded';
    const at = activeOf(this.comp, v) === home.positions[v];
    if (this.returning(v)) return at ? 'waiting' : 'returning';
    if (this.owns(v)) return 'resting';
    return at ? 'home' : 'away';
  }

  /** Return progress 0–1 by steps made (null when not returning). */
  returnProgress(): number | null {
    const r = this.ret;
    if (!r) return null;
    return r.total ? Math.max(0, Math.min(1, 1 - this.remaining() / r.total)) : 1;
  }

  // ------------------------------------------------------------------ hooks

  /** Install or remove the engine hooks according to Extended. Cheap; call on any change. */
  attach(): void {
    const e = this.engine;
    if (!this.on) {
      if (e.robotGate || e.observer) {
        e.robotGate = null;
        e.observer = null;
        this.hubGen++;
        this.hubAt = -1;
        this.runGen++;
        this.ret = null;
        this.restHold = null;
        this.atStart = [];
      }
      return;
    }
    if (!e.observer) this.baseline(); // just switched on: what is there now is not a change
    if (!e.robotGate)
      e.robotGate = {
        on: () => this.robotOn(0) && this.isBaton(0),
        // held while suspended, or while every Variable it moves belongs to a Return (so the
        // Baton stays at Home through the rest and resumes from there, not from far away)
        held: (t) => {
          if (this.suspended(0, t)) return true;
          const vars = this.variables(0);
          return vars.length > 0 && vars.every((v) => this.owns(v, t));
        },
        skip: (v, t) => this.owns(v, t),
      };
    if (!e.observer) e.observer = (t, cause, produced, step) => this.observe(t, cause, produced, step);
  }

  /** Take the current Positions and Home distance as "already seen" (no events for them). */
  baseline(): void {
    for (const v of ROBOT_VARS) this.lastPos[v] = activeOf(this.comp, v);
    this.lastSound = activeOf(this.comp, 'soundChoice');
    this.lastDistance = this.ext.home.positions ? homeDistance(this.comp, this.ext.weights, this.ext.home).total : null;
  }

  // ------------------------------------------------------------------ the hand

  /** Rule actions waiting for Start (fired while stopped with a musical timing). */
  private atStart: { r: Rule; ri: number; depth: number }[] = [];
  /** distinguishes one gesture from the next for "each rule at most once a moment" */
  private gesture = 0;

  /**
   * Something outside the music's render changed (a click, a Snapshot, MIDI Learn, an edit):
   * the Rules see it now — playing, paused or stopped. Immediate actions happen at once;
   * timed ones (Q / beat / bar) wait for that point in the music (while stopped: for Start).
   * Returns the events to emit. Never starts the transport, never makes notes.
   */
  poke(): EngineEvent[] {
    if (!this.on || this.engine.rendering) return [];
    this.attach();
    const t = this.engine.tick;
    this.curTick = -1 - ++this.gesture; // a new moment: every rule may fire once
    this.fired.clear();
    this.scan(t, 0);
    this.process(t);
    const out = this.out;
    this.out = [];
    return tag(out);
  }

  // ------------------------------------------------------------------ transport

  /** Start from stopped (after the engine's rewind): everything from tick 0. Rule overrides
   * made while stopped (on / off, personality) and Rule actions waiting for Start are kept. */
  start(): void {
    const waiting = this.atStart;
    this.reset(true);
    this.attach();
    if (!this.on) return;
    this.live = true;
    this.rng = this.rng.map((_, i) => new Rng(this.comp.seed, 6000 + i));
    for (let i = 0; i < NUM_ROBOTS; i++) this.mem[i] = freshMemory(this.initialPos(i));
    this.baseline();
    this.schedule(0, true);
    // timed Rule actions fired while stopped: at the downbeat (tick 0 is on every grid)
    for (const w of waiting) this.deferAt(0, w.r, w.ri, w.depth);
  }

  /** Stop: runtime cleared (the engine's rewind already dropped every scheduled action). */
  stop(): void {
    this.reset(false);
  }

  private reset(keepOverrides = false): void {
    this.atStart = [];
    this.runGen++;
    this.hubGen++;
    this.hubAt = -1;
    this.retGen++;
    this.live = false;
    this.next = [Infinity, Infinity, Infinity, Infinity];
    this.suspendedUntil = [-Infinity, -Infinity, -Infinity, -Infinity];
    this.restHold = null;
    this.seenTargetMoves = [0, 0, 0, 0];
    if (!keepOverrides) {
      this.enabledOverride = [null, null, null, null];
      this.personalityOverride = [null, null, null, null];
    }
    this.waiting = [false, false, false, false];
    this.lastMoveTick = [-Infinity, -Infinity, -Infinity, -Infinity];
    this.lastChanged = ['', '', '', ''];
    this.ret = null;
    this.ruleRt = new WeakMap();
    this.queue = [];
    this.fired.clear();
    this.curTick = -1;
    this.deferred = 0;
    this.cycleCount = Array.from({ length: NUM_VOICES }, () => [0, 0, 0, 0]);
    this.out = [];
    this.scanDepth = 0;
  }

  /** Reroll: new random streams from the new seed, at once. */
  reseed(): void {
    this.rng = this.rng.map((_, i) => new Rng(this.comp.seed, 6000 + i));
  }

  /**
   * After any change to the definitions (or Extended switched on / off, Undo …): join every
   * Robot and interval Rule to its own grid from Start, at the next grid point.
   */
  sync(): void {
    this.attach();
    if (!this.on || this.engine.state === 'stopped') return;
    if (!this.live) {
      // Extended switched on while playing: begin now, as if from here
      this.live = true;
      this.rng = this.rng.map((_, i) => new Rng(this.comp.seed, 6000 + i));
      for (let i = 0; i < NUM_ROBOTS; i++) this.mem[i] = freshMemory(this.initialPos(i));
      this.baseline();
    }
    this.schedule(this.engine.tick, false);
  }

  /** (Re)compute next decision ticks and (re)start the chain. `fromStart`: first at one step. */
  private schedule(now: number, fromStart: boolean): void {
    for (let i = 0; i < NUM_ROBOTS; i++) {
      const step = robotStepTicks(this.ext.robots[i]);
      if (!this.positionRobot(i) || !Number.isFinite(step)) {
        this.next[i] = Infinity;
        continue;
      }
      this.next[i] = gridAfter(this.next[i], step, now, fromStart);
    }
    this.ext.rules.forEach((r) => {
      const rt = this.rt(r);
      rt.next = r.on && r.when.kind === 'interval' ? gridAfter(rt.next, intervalTicks(r.when), now, fromStart) : Infinity;
    });
    this.hubSchedule();
  }

  private rt(r: Rule): RuleRt {
    let x = this.ruleRt.get(r);
    if (!x) this.ruleRt.set(r, (x = { count: 0, next: Infinity, firedTick: -1, fires: 0, flash: -Infinity }));
    return x;
  }

  /** When rule `i` last fired (tick), for display. */
  ruleFlash(i: number): number {
    const r = this.ext.rules[i];
    return r ? (this.ruleRt.get(r)?.flash ?? -Infinity) : -Infinity;
  }
  /** How often rule i's condition matched / it fired, since Start. */
  ruleCount(i: number): number {
    const r = this.ext.rules[i];
    return r ? (this.ruleRt.get(r)?.count ?? 0) : 0;
  }
  ruleFires(i: number): number {
    const r = this.ext.rules[i];
    return r ? (this.ruleRt.get(r)?.fires ?? 0) : 0;
  }

  /** the tick the chain's next action waits for (-1 = none), so an edit that changes nothing
   * does not schedule again */
  private hubAt = -1;

  private hubSchedule(): void {
    let t = Math.min(...this.next);
    for (const r of this.ext.rules) t = Math.min(t, this.ruleRt.get(r)?.next ?? Infinity);
    if (Number.isFinite(t) && t === this.hubAt) return;
    const gen = ++this.hubGen;
    this.hubAt = Number.isFinite(t) ? t : -1;
    if (!Number.isFinite(t)) return;
    this.engine.schedule(t, 'cond', (tt) => {
      if (gen !== this.hubGen) return;
      this.hubAt = -1;
      return this.hub(tt);
    });
  }

  /** One tick of the chain: due Robots decide in priority order, then interval Rules fire. */
  private hub(t: number): EngineEvent[] {
    const out: EngineEvent[] = [];
    const claims = new Map<VariableName, number>();
    for (let i = 0; i < NUM_ROBOTS; i++) {
      if (this.next[i] > t + 1e-6) continue;
      const step = robotStepTicks(this.ext.robots[i]);
      this.next[i] = Number.isFinite(step) && this.positionRobot(i) ? gridAfter(-1, step, t, false) : Infinity;
      out.push(...this.decideRobot(i, t, claims, 'timer'));
    }
    this.ext.rules.forEach((r, ri) => {
      const rt = this.ruleRt.get(r);
      if (!rt || rt.next > t + 1e-6) return;
      rt.next = r.on && r.when.kind === 'interval' ? gridAfter(-1, intervalTicks(r.when), t, false) : Infinity;
      this.enqueue({ kind: 'interval', rule: ri }, 0);
    });
    this.hubSchedule();
    return tag(out);
  }

  // ------------------------------------------------------------------ decisions

  private targetView(i: number): TargetView | null {
    const p = this.personality(i);
    if (p !== 'follower' && p !== 'contrarian') return null;
    const t = this.ext.robots[i].target;
    if (t === null || t === i || !this.robotOn(t)) return null;
    const m = this.mem[t];
    if (!m.moves) return null; // has not moved yet
    return { pos: m.pos, lastDelta: m.lastDelta, moves: m.moves };
  }

  /**
   * Robot i decides at tick t ('timer' = its own grid, 'advance' / 'choose' = a Rule). Applies
   * the Position to its Variables not claimed at this tick by a higher-priority Robot or by a
   * Return, and queues its events.
   */
  private decideRobot(i: number, t: number, claims: Map<VariableName, number>, cause: 'timer' | 'advance' | 'choose'): EngineEvent[] {
    if (!this.positionRobot(i)) return [];
    if (this.suspended(i, t)) return [];
    if (!this.live) this.mem[i] = freshMemory(this.initialPos(i)); // a Rule, while stopped
    const def = this.ext.robots[i];
    const vars = def.variables;
    const free = vars.filter((v) => !this.owns(v, t));
    if (vars.length && !free.length) return []; // everything it moves belongs to a Return: it rests
    const cands = candidates(this.ext.weights, vars);
    const mem = this.mem[i];
    const target = this.targetView(i);
    const p = this.personality(i);
    this.waiting[i] = (p === 'follower' || p === 'contrarian') && !target;
    const ctx = { home: this.robotHome(i), target, seenTargetMoves: this.seenTargetMoves[i] };
    const to = cause === 'choose' ? chooseOther(mem, cands, this.rng[i]) : decide(p, def.params, mem, cands, ctx, this.rng[i]);
    if (target) this.seenTargetMoves[i] = target.moves;
    const from = mem.pos;
    remember(mem, to);
    const out: EngineEvent[] = [];
    const changed: string[] = [];
    for (const v of free) {
      if (claims.has(v)) continue;
      claims.set(v, i);
      const pos = resolvePosition(this.ext.weights, v, to);
      if (activeOf(this.comp, v) !== pos) {
        out.push(...this.engine.selectPosition(v, pos, t));
        changed.push(VAR_SHORT[v]);
      }
    }
    this.robotMoved(i, from, to, t, changed);
    return out;
  }

  private robotMoved(i: number, from: number, to: number, t: number, changed: string[]): void {
    if (from === to) return;
    this.lastMoveTick[i] = t;
    this.lastChanged[i] = changed.join(' ');
    const p = this.personality(i);
    const tg = this.ext.robots[i].target;
    const verb = p === 'follower' && tg !== null ? ` followed Robot ${tg + 1}:` : p === 'contrarian' && tg !== null ? ` moved away from Robot ${tg + 1}:` : '';
    this.addLog(t, `Robot ${i + 1}${verb} ${from + 1} → ${to + 1}${changed.length ? ' · ' + changed.join(' ') : ''}`, 'move', i);
    this.enqueue({ kind: 'robotMoved', robot: i, from, to }, this.scanDepth);
    if (this.robotHome(i) === to) this.enqueue({ kind: 'robotHome', robot: i }, this.scanDepth);
  }

  // ------------------------------------------------------------------ the observer

  private observe(t: number, cause: 'voice' | 'action' | 'robot', produced: EngineEvent[], step: StepEvent | null): EngineEvent[] | void {
    if (!this.on || !this.live) return;
    if (t !== this.curTick) {
      this.curTick = t;
      this.fired.clear();
    }
    const h = this.restHold;
    if (h && t >= h.until) {
      this.restHold = null;
      this.addLog(h.until, `Rest over: ${h.vars.map((v) => VAR_SHORT[v]).join(' ')} free again`, 'return');
    }
    this.noteSync(produced);
    if (step) this.voiceCycles(step);
    if (cause === 'robot' && this.isBaton(0)) {
      // M's Baton robot jumped (or was held): its Position is that of its first arrow
      const from = this.mem[0].pos;
      const to = this.batonPos();
      remember(this.mem[0], to);
      this.robotMoved(0, from, to, t, produced.filter((e) => e.kind === 'change' && (ROBOT_VARS as string[]).includes(e.what)).map((e) => VAR_SHORT[(e as { what: VariableName }).what]));
    }
    const depth = this.scanDepth;
    this.scanDepth = 0;
    this.scan(t, depth);
    this.process(t);
    const out = this.out;
    this.out = [];
    return out.length ? tag(out) : undefined;
  }

  /** A Sync (Snapshot, Pattern Group) restarts the Voices: that is not a completed cycle. */
  private noteSync(evs: EngineEvent[]): void {
    if (evs.some((e) => e.kind === 'change' && e.what === 'sync')) this.cycleCount = Array.from({ length: NUM_VOICES }, () => [0, 0, 0, 0]);
  }

  private voiceCycles(e: StepEvent): void {
    const c = this.cycleCount[e.voice];
    const flags: boolean[] = [e.patternRestart, e.cycleRestart.rhythm, e.cycleRestart.legato, e.cycleRestart.accent];
    CYCLES.forEach((k, j) => {
      if (flags[j]) {
        if (c[j] > 0) this.enqueue({ kind: 'cycle', voice: e.voice, cycle: k }, 0);
        c[j] = 1;
      } else if (c[j] > 0) c[j]++;
    });
  }

  /** Compare with what was last seen: Variables that entered a Position, Home reached. */
  private scan(t: number, depth: number): void {
    let any = false;
    for (const v of ROBOT_VARS) {
      const a = activeOf(this.comp, v);
      if (this.lastPos[v] !== a) {
        this.lastPos[v] = a;
        any = true;
        this.enqueue({ kind: 'variableAt', variable: v, position: a }, depth);
      }
    }
    const home = this.ext.home;
    if (!home.positions) {
      this.lastDistance = null;
      return;
    }
    const snd = activeOf(this.comp, 'soundChoice');
    if (!any && snd === this.lastSound && this.lastDistance !== null) return;
    this.lastSound = snd;
    const d = homeDistance(this.comp, this.ext.weights, home).total;
    if (d === 0 && this.lastDistance !== null && this.lastDistance > 0 && homeVars(home).length) {
      this.addLog(t, 'Home reached', 'return');
      this.enqueue({ kind: 'homeReached' }, depth);
    }
    this.lastDistance = d;
  }
  private lastSound = -1;

  /** Home changed (captured / cleared / included): distance is measured afresh. */
  homeChanged(): void {
    this.lastDistance = this.ext.home.positions ? homeDistance(this.comp, this.ext.weights, this.ext.home).total : null;
  }

  private enqueue(ev: CondEvent, depth: number): void {
    if (this.queue.length >= MAX_QUEUE) {
      this.dropped++;
      return;
    }
    this.queue.push({ ev, depth });
  }

  /** Run the queue: every event against every rule, in order; each rule at most once a tick. */
  private process(t: number): void {
    let n = 0;
    while (this.queue.length) {
      const { ev, depth } = this.queue.shift()!;
      if (++n > MAX_QUEUE) {
        this.dropped += this.queue.length + 1;
        this.queue.length = 0;
        this.addLog(t, 'Too many events at once: some ignored', 'info');
        break;
      }
      if (depth > MAX_DEPTH) continue;
      const rules = this.ext.rules;
      for (let ri = 0; ri < rules.length; ri++) {
        const r = rules[ri];
        if (!r.on || this.fired.has(ri) || !matches(r.when, ev, ri)) continue;
        const rt = this.rt(r);
        rt.count++;
        if (rt.count % Math.max(1, r.every)) continue;
        this.fired.add(ri);
        rt.firedTick = t;
        rt.fires++;
        this.fire(ri, r, t, depth + 1);
      }
    }
  }

  private fire(ri: number, r: Rule, t: number, depth: number): void {
    const stopped = this.engine.state === 'stopped';
    const at = stopped ? (r.at === 'now' ? t : Infinity) : this.timing(r, t);
    if (at <= t + 1e-9) {
      this.rt(r).flash = t;
      this.addLog(t, `Rule ${ri + 1} fired: ${actionWords(r.then)}`, 'rule');
      const ev = this.act(r.then, t, depth);
      this.noteSync(ev);
      this.out.push(...ev);
      this.scan(t, depth);
      return;
    }
    if (this.deferred + this.atStart.length >= MAX_DEFERRED) {
      this.addLog(t, `Rule ${ri + 1}: too many actions waiting — ignored`, 'rule');
      return;
    }
    if (stopped) {
      // no musical time while stopped: a timed action waits for Start (the downbeat)
      this.atStart.push({ r, ri, depth });
      this.addLog(t, `Rule ${ri + 1} fired: ${actionWords(r.then)} — waits for Start`, 'rule');
      return;
    }
    this.addLog(t, `Rule ${ri + 1} fired: ${actionWords(r.then)} — at the next ${r.at === 'quant' ? 'Q point' : r.at}`, 'rule');
    this.deferAt(at, r, ri, depth);
  }

  /** A Rule action at a later tick (an engine action: frozen by Pause, dropped by Stop). */
  private deferAt(at: number, r: Rule, ri: number, depth: number): void {
    this.deferred++;
    const gen = this.runGen;
    this.engine.schedule(at, 'rule', (tt) => {
      if (gen !== this.runGen) return;
      this.deferred--;
      this.rt(r).flash = tt;
      this.addLog(tt, `Rule ${ri + 1} acts: ${actionWords(r.then)}`, 'rule');
      const ev = this.act(r.then, tt, depth);
      this.scanDepth = depth; // the observer that follows this action scans at this depth
      return tag(ev);
    });
  }

  /** Timed Rule actions waiting (for their point in the music, or for Start). */
  waitingActions(): number {
    return this.deferred + this.atStart.length;
  }

  private timing(r: Rule, t: number): number {
    const grid = (g: number) => Math.ceil((t - 1e-9) / g) * g;
    switch (r.at) {
      case 'now':
        return t;
      case 'quant':
        return this.comp.quantization ? grid(noteValueTicks(this.comp.quantization)) : t;
      case 'beat':
        return grid(96);
      case 'bar':
        return grid(384);
    }
  }

  // ------------------------------------------------------------------ actions

  /** Perform a Rule's action at tick t. Never creates notes. */
  act(a: Action, t: number, depth = 1): EngineEvent[] {
    const prevDepth = this.scanDepth;
    this.scanDepth = depth;
    try {
      switch (a.kind) {
        case 'advance':
        case 'choose':
          if (!this.robotOn(a.robot)) {
            this.addLog(t, `Robot ${a.robot + 1} is off: nothing to advance`, 'info');
            return [];
          }
          if (this.isBaton(a.robot)) {
            if (this.suspended(0, t)) return [];
            const ev = this.engine.robotJump(t);
            const from = this.mem[0].pos;
            const to = this.batonPos();
            remember(this.mem[0], to);
            this.robotMoved(0, from, to, t, []);
            return ev;
          }
          return this.decideRobot(a.robot, t, new Map(), a.kind);
        case 'enable': {
          const was = this.robotOn(a.robot);
          const want = a.mode === 'toggle' ? !was : a.mode === 'on';
          this.enabledOverride[a.robot] = want;
          if (want && !was) this.mem[a.robot] = { ...freshMemory(this.initialPos(a.robot)) };
          this.addLog(t, `Robot ${a.robot + 1} switched ${want ? 'on' : 'off'}`, 'robot');
          if (this.live) this.schedule(t, false);
          return [];
        }
        case 'personality': {
          let p = a.personality;
          if (p === 'next') {
            const ids = PERSONALITIES.map((x) => x.id).filter((x) => x !== 'baton' || a.robot === 0);
            p = ids[(ids.indexOf(this.personality(a.robot)) + 1) % ids.length];
          }
          if (p === 'baton' && a.robot !== 0) return [];
          const wasBaton = this.isBaton(a.robot);
          this.personalityOverride[a.robot] = p;
          if (wasBaton !== this.isBaton(a.robot)) this.mem[a.robot].pos = this.isBaton(a.robot) ? this.batonPos() : this.mem[a.robot].pos;
          this.addLog(t, `Robot ${a.robot + 1} is now ${PERSONALITIES.find((x) => x.id === p)?.name}`, 'robot');
          if (this.live) this.schedule(t, false);
          return [];
        }
        case 'setPosition':
          if (this.owns(a.variable, t)) {
            this.addLog(t, `${VAR_SHORT[a.variable]} belongs to the Return: not set`, 'info');
            return [];
          }
          if (activeOf(this.comp, a.variable) === a.position) return [];
          return this.engine.selectPosition(a.variable, a.position, t);
        case 'snapshot': {
          const ev = this.host.recallSnapshotAt(a.index, t);
          if (!ev) this.addLog(t, `Snapshot ${String.fromCharCode(65 + a.index)} is empty: nothing recalled`, 'info');
          return ev ?? [];
        }
        case 'returnHome':
          return this.returnHome(t, a.immediate);
        case 'suspend': {
          if (!this.live) {
            this.addLog(t, `Robot ${a.robot + 1}: no pause while stopped`, 'info');
            return [];
          }
          const until = t + intervalTicks(a);
          this.suspendedUntil[a.robot] = Math.max(this.suspendedUntil[a.robot], until);
          this.addLog(t, `Robot ${a.robot + 1} paused for ${Math.round((until - t) / 96 * 100) / 100} beats`, 'robot');
          return [];
        }
      }
    } finally {
      this.scanDepth = prevDepth;
    }
  }

  // ------------------------------------------------------------------ Home / Return

  /**
   * Return Home at tick t. Gradual (default) or immediate; when stopped, always immediate.
   * Returns events to emit at t.
   */
  returnHome(t: number, immediate = false): EngineEvent[] {
    const home = this.ext.home;
    if (!home.positions || !homeVars(home).length) {
      this.addLog(t, 'No Home to return to (capture one first)', 'info');
      return [];
    }
    if (this.ret) {
      this.addLog(t, 'Already returning', 'info');
      return [];
    }
    this.restHold = null; // a new Return takes the Variables from any rest
    const vars = homeVars(home);
    const stopped = this.engine.state === 'stopped';
    if (stopped || immediate || this.ext.returnSettings.immediate) {
      const at = stopped ? t : this.comp.quantization ? this.engine.quantizeTick(t) : t;
      if (at <= t + 1e-9) return this.homeNow(t, vars, true);
      const gen = this.runGen;
      this.engine.schedule(at, 'return', (tt) => (gen === this.runGen ? tag(this.homeNow(tt, vars, true)) : undefined));
      return [];
    }
    const grid = this.comp.quantization ? noteValueTicks(this.comp.quantization) : 96;
    const start = Math.ceil((t - 1e-9) / grid) * grid;
    const end = start + Math.max(grid, Math.ceil(returnTicks(this.ext.returnSettings) / grid - 1e-9) * grid);
    this.ret = { start, end, grid, vars, rr: 0, gen: ++this.retGen, total: this.distance() };
    this.addLog(t, `Return started: ${this.ret.total} step${this.ret.total === 1 ? '' : 's'} over ${Math.round(((end - start) / 96) * 100) / 100} beats`, 'return');
    this.returnSchedule(start, true);
    return [];
  }

  /** Stop a gradual Return where it is (the Robots take over again at once). */
  cancelReturn(): void {
    if (!this.ret) return;
    this.ret = null;
    this.retGen++;
    this.addLog(this.engine.tick, 'Return cancelled', 'return');
  }

  private returnSchedule(t: number, first: boolean): void {
    const gen = this.ret!.gen;
    this.engine.schedule(t, 'return', (tt) => (this.ret && this.ret.gen === gen ? tag(this.returnStep(tt, first)) : undefined));
  }

  private remaining(): number {
    const r = this.ret!;
    let n = 0;
    for (const v of r.vars) n += returnPath(this.comp, this.ext.weights, v, activeOf(this.comp, v), this.ext.home.positions![v]!).length;
    return n;
  }

  /** One Return step: some Variables one stop nearer Home; the next step spread over what is left. */
  private returnStep(t: number, first: boolean): EngineEvent[] {
    const r = this.ret!;
    if (!this.ext.home.positions) {
      this.ret = null;
      return [];
    }
    let m = this.remaining();
    const out: EngineEvent[] = [];
    if (m === 0) return this.finishReturn(t, out);
    if (t >= r.end - 1e-6) return this.finishReturn(t, [...out, ...this.homeNow(t, r.vars, false)]);
    // grid points still to come after this one; the first step waits unless it is needed
    const future = Math.floor((r.end - t) / r.grid + 1e-9);
    const k = first && future >= m ? 0 : Math.ceil(m / (future + 1));
    if (k > 0) {
      for (let j = 0; j < k; j++) {
        const mv = this.returnMove(t);
        if (!mv) break;
        out.push(...mv);
      }
      m = this.remaining();
      if (m === 0) return this.finishReturn(t, out);
    }
    const interval = Math.max(r.grid, Math.floor((r.end - t) / Math.max(1, m) / r.grid + 1e-9) * r.grid);
    this.returnSchedule(Math.min(r.end, t + interval), false);
    return out;
  }

  /** Move the next Variable (round-robin) one stop along its path. */
  private returnMove(t: number): EngineEvent[] | null {
    const r = this.ret!;
    for (let j = 0; j < r.vars.length; j++) {
      const v = r.vars[(r.rr + j) % r.vars.length];
      const path = returnPath(this.comp, this.ext.weights, v, activeOf(this.comp, v), this.ext.home.positions![v]!);
      if (!path.length) continue;
      r.rr = (r.rr + j + 1) % r.vars.length;
      this.addLog(t, path.length === 1 ? `${VAR_SHORT[v]} reached Home (${path[0] + 1})` : `Returning ${VAR_SHORT[v]} → ${path[0] + 1}`, 'return');
      return this.engine.selectPosition(v, path[0], t);
    }
    return null;
  }

  /** Put the included Variables (all, or those still away) at Home now, as a Snapshot. */
  private homeNow(t: number, vars: VariableName[], finish: boolean): EngineEvent[] {
    const hp = this.ext.home.positions!;
    const positions: Snapshot['positions'] = {};
    for (const v of vars) if (hp[v] !== undefined && activeOf(this.comp, v) !== hp[v]) positions[v] = hp[v];
    const moved = Object.keys(positions) as VariableName[];
    if (moved.length) this.addLog(t, `Home now: ${moved.map((v) => VAR_SHORT[v]).join(' ')}`, 'return');
    const out = Object.keys(positions).length ? this.engine.applySnapshot({ positions, arrows: {}, voices: [], sync: false }, t).filter((e) => !(e.kind === 'change' && e.what === 'snapshot')) : [];
    if (finish) return this.finishReturn(t, out);
    return out;
  }

  /**
   * Return complete. Its Variables stay at Home, still owned by the Return, for the rest period
   * (beats; not while stopped); the Robots that move them start again from Home afterwards.
   */
  private finishReturn(t: number, out: EngineEvent[]): EngineEvent[] {
    const vars = this.ret?.vars ?? homeVars(this.ext.home);
    this.ret = null;
    this.retGen++;
    const beats = this.ext.returnSettings.rest;
    const playing = this.engine.state !== 'stopped';
    this.restHold = playing && beats > 0 ? { vars, until: t + beats * 96 } : null;
    for (let i = 0; i < NUM_ROBOTS; i++) {
      if (!this.robotOn(i)) continue;
      const rv = this.variables(i);
      if (!rv.some((v) => vars.includes(v))) continue;
      if (this.isBaton(i)) {
        if (this.ext.home.baton) this.comp.conducting.baton = { ...this.ext.home.baton };
        this.mem[i].pos = this.batonPos();
      } else {
        const h = this.robotHome(i);
        if (h !== null) this.mem[i].pos = h;
      }
      this.mem[i].dwell = 0;
    }
    this.addLog(t, this.restHold ? `Return complete — resting ${beats} beat${beats === 1 ? '' : 's'}` : 'Return complete', 'return');
    this.enqueue({ kind: 'returnDone' }, this.scanDepth);
    return out;
  }

  /** Steps from Home now (0 = at Home; null = no Home). */
  distance(): number {
    if (!this.ext.home.positions) return 0;
    return homeDistance(this.comp, this.ext.weights, this.ext.home).total;
  }

  // ------------------------------------------------------------------ log

  private addLog(tick: number, text: string, kind: LogKind, robot?: number): void {
    const e: LogEntry = { tick, text, kind };
    if (robot !== undefined) e.robot = robot;
    if (this.engine.state === 'stopped') e.stopped = true;
    this.log.push(e);
    if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX);
    this.logRev++;
  }

  /** bumped on every log entry (views redraw the log only when it changed) */
  logRev = 0;

  /** Clear the visible log (runtime only; nothing musical depends on it). */
  clearLog(): void {
    this.log = [];
    this.logRev++;
  }
}

/**
 * The next point of a grid of `step` ticks from tick 0 after `now` (from Start: the first
 * step). A decision already due exactly at `now` on this grid (not yet made) is kept.
 */
function gridAfter(current: number, step: number, now: number, fromStart: boolean): number {
  if (fromStart) return step;
  if (Math.abs(current - now) < 1e-9 && Math.abs(now / step - Math.round(now / step)) < 1e-6) return current;
  return (Math.floor(now / step + 1e-9) + 1) * step;
}

/** The Conductor's own Position changes are not a hand on a Variable (see Session.changed). */
function tag(evs: EngineEvent[]): EngineEvent[] {
  return evs.map((e) => (e.kind === 'change' && e.what !== 'sync' && e.what !== 'snapshot' ? { ...e, what: 'conductor' } : e));
}
