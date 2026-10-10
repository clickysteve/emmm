/**
 * The Robots window (EXTENDED — not part of M): the four Robot Conductors, their Position
 * weights, the Rules and Home / Return (docs/CONDUCTORS.md). Drawn with emmm's own controls —
 * number boxes, toggles, pop-up selectors, inverted selections — in the Extended palette area.
 *
 *   overview   four rows, always visible: on / off, personality, the six Positions (current
 *              inverted, Home marked), rate, Variables, what it is doing; and the activity log
 *   ROBOT      the selected Robot's editor
 *   WEIGHTS    six weights per Variable as bars, with each Position's chance
 *   RULES      list and editor: WHEN condition [every Nth] THEN action [at …]
 *   HOME       capture / clear, which Variables, Return settings, RETURN HOME, progress
 *
 * Every control calls a Session method (one Undo step each); the window keeps no musical
 * state of its own.
 */
import { NUM_POSITIONS, NUM_SNAPSHOTS, STEP_ADVANCE, TIME_BASE_DENOMINATORS } from '../engine/constants';
import type { VariableName } from '../engine/types';
import { candidates, NUM_ROBOTS, PARAM_INFO, PERSONALITIES, personalityInfo, rateLabel, rateWords, ROBOT_VARS, VAR_LONG, VAR_SHORT, weightRow, type Personality, type RobotParams, type RobotVar } from '../extended/conductors';
import { activeOf, HOME_VARS, returnPath } from '../extended/home';
import { ACTION_KINDS, CONDITION_KINDS, CYCLE_NAMES, defaultAction, defaultCondition, MAX_RULES, ruleSummary, TIMINGS, type Action, type Condition, type Rule, type RuleTiming } from '../extended/rules';
import type { UiContext } from './context';
import { el, label, localPoint, setSvg, setTip, svgEl, trackDrag } from './dom';
import { keyLabel } from './keys';
import { Selector } from './selector';
import { MWindow, Numerical } from './widgets';

const W = 476;
const H = 340;
const PANEL_Y = 92;
type Tab = 'robot' | 'weights' | 'rules' | 'home';
const TABS: { id: Tab; name: string; help: string }[] = [
  { id: 'robot', name: 'ROBOT', help: 'The selected Robot: on / off, personality, rate, Variables, parameters' },
  { id: 'weights', name: 'WEIGHTS', help: 'How likely each Position is to be chosen by a Robot' },
  { id: 'rules', name: 'RULES', help: 'WHEN something happens THEN do something' },
  { id: 'home', name: 'HOME', help: 'Capture Home, and bring the music back to it' },
];
const DENS = (TIME_BASE_DENOMINATORS as readonly number[]).filter((x) => x !== STEP_ADVANCE);
const barBeat = (t: number) => `${Math.floor(t / 384) + 1}:${Math.floor((t % 384) / 96) + 1}`;
const letter = (i: number) => String.fromCharCode(65 + i);

interface Part {
  update(): void;
}

export class RobotsWindow {
  win: MWindow;
  tab: Tab = 'robot';
  /** the Robot shown in the ROBOT tab (Robot 2 first: Robot 1 is M's own) */
  sel = 1;
  selVar: RobotVar = 'noteDensity';
  selRule = 0;
  private parts: Part[] = [];
  private tabParts: Part[] = [];
  private panel!: HTMLDivElement;
  private builtFor: object | null = null;
  private tabSig = '';
  private logEl!: HTMLDivElement;
  private logSig = '';

  constructor(private ctx: UiContext, parent: HTMLElement) {
    this.win = new MWindow(parent, { id: 'robots', title: 'Robots', x: 120, y: 40, w: W, h: H, closable: true, area: 'trajectory' });
  }

  private get s() {
    return this.ctx.s;
  }
  private get c() {
    return this.ctx.s.conductor;
  }
  private get ext() {
    return this.ctx.s.comp.extended;
  }

  // ------------------------------------------------------------------ small controls

  /**
   * A control that works from the keyboard once it has focus: Enter / Space act like a click,
   * ← → ↑ ↓ move to the window's other controls, Escape gives the keys back to emmm. A mouse
   * click does not take the focus, so Space and Return stay the transport keys (and Tab stays
   * M's Pause) while you play with the mouse. ⌥W on the open window puts the focus in it.
   */
  private activatable(d: HTMLElement, f: () => void, enabled: () => boolean = () => true): void {
    d.tabIndex = 0;
    d.dataset.rnav = '1';
    d.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (enabled()) f();
    });
    d.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        if (enabled()) f();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        this.moveFocus(d, e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        d.blur();
      }
    });
  }

  /** The window's keyboard controls in reading order. */
  private navigable(): HTMLElement[] {
    return [...this.win.body.querySelectorAll<HTMLElement>('[data-rnav], .msel')].filter((e) => e.offsetParent !== null || !e.closest('.hidden'));
  }

  private moveFocus(from: HTMLElement, d: number): void {
    const all = this.navigable();
    const i = all.indexOf(from);
    const next = all[(i + d + all.length) % all.length];
    next?.focus({ preventScroll: true });
  }

  /** Put the keyboard focus on the current tab (⌥W when the window is already in front). */
  focusIn(): void {
    const t = [...this.win.body.querySelectorAll<HTMLElement>('[role=tab]')].find((e) => e.classList.contains('inv'));
    (t ?? this.navigable()[0])?.focus({ preventScroll: true });
  }

  private toggle(parent: HTMLElement, x: number, y: number, w: number, text: () => string, on: () => boolean, click: () => void, tip: string | (() => string), enabled: () => boolean = () => true, into = this.tabParts): HTMLDivElement {
    const d = el('div', 'num', parent, [x, y, w, 14]);
    d.style.fontSize = '9px';
    d.setAttribute('role', 'switch');
    this.activatable(d, click, enabled);
    into.push({
      update: () => {
        const t = text();
        if (d.textContent !== t) d.textContent = t;
        d.classList.toggle('inv', on());
        d.setAttribute('aria-checked', String(on()));
        const en = enabled();
        d.style.opacity = en ? '1' : '0.4';
        d.setAttribute('aria-disabled', String(!en));
        setTip(d, typeof tip === 'function' ? tip() : tip);
      },
    });
    return d;
  }

  private button(parent: HTMLElement, x: number, y: number, w: number, text: string, tip: string | (() => string), click: () => void, enabled: () => boolean = () => true, h = 14, into = this.tabParts): HTMLDivElement {
    const d = el('div', 'btn', parent, [x, y, w, h], text);
    d.style.fontSize = '9px';
    d.setAttribute('role', 'button');
    this.activatable(d, click, enabled);
    into.push({
      update: () => {
        const en = enabled();
        d.style.opacity = en ? '1' : '0.4';
        d.setAttribute('aria-disabled', String(!en));
        setTip(d, typeof tip === 'function' ? tip() : tip);
      },
    });
    return d;
  }

  private select(parent: HTMLElement, x: number, y: number, w: number, lab: string, options: () => { value: string; text: string; disabled?: boolean }[], value: () => string, onChange: (v: string) => void): Selector {
    const sel = new Selector(parent, x, y, w, 14, { label: lab, fontSize: 8, options, value, onChange });
    this.tabParts.push(sel);
    return sel;
  }

  private text(parent: HTMLElement, x: number, y: number, w: number, h: number, get: () => string, cls = 'label small'): HTMLDivElement {
    const d = el('div', cls, parent, [x, y, w, h]);
    d.style.whiteSpace = h > 10 ? 'normal' : 'nowrap';
    d.style.overflow = 'hidden';
    d.style.textOverflow = 'ellipsis';
    d.style.lineHeight = '10px';
    this.tabParts.push({ update: () => ((t) => d.textContent !== t && (d.textContent = t))(get()) });
    return d;
  }

  /** n | d Time Base number boxes (one step every n/d of a whole note); `sa` allows step advance. */
  private rateBoxes(parent: HTMLElement, x: number, y: number, get: () => { num: number; den: number }, set: (num: number, den: number) => void, tip: string, sa = false): void {
    const dens = sa ? [STEP_ADVANCE, ...DENS] : DENS;
    const both = (t: string) => {
      const m = /^(\d+)\s*[/|]\s*(\d+)$/.exec(t.trim());
      if (!m || !DENS.includes(Number(m[2])) || Number(m[1]) < 1 || Number(m[1]) > 99) return false;
      set(Number(m[1]), Number(m[2]));
      return true;
    };
    this.tabParts.push(
      new Numerical(parent, x, y, 20, 14, { get: () => get().num, set: (v) => set(v, get().den), min: 1, max: 99, chars: '/|', entry: (t) => (/[/|]/.test(t) ? both(t) : /^\d+$/.test(t) && (set(Math.max(1, Math.min(99, Number(t))), get().den), true)), title: tip }),
      new Numerical(parent, x + 24, y, 22, 14, {
        get: () => get().den,
        set: (v) => set(get().num, v),
        values: dens,
        format: (v) => (v === STEP_ADVANCE ? 'sa' : String(v)),
        chars: '/|sa',
        entry: (t) => (/[/|]/.test(t) ? both(t) : t.trim().toLowerCase() === 'sa' && sa ? (set(get().num, STEP_ADVANCE), true) : dens.includes(Number(t)) && (set(get().num, Number(t)), true)),
        title: tip,
      }),
    );
    el('div', 'label', parent, [x + 20, y + 3, 4, 10], '|');
  }

  // ------------------------------------------------------------------ build

  private build(): void {
    const b = this.win.body;
    b.innerHTML = '';
    this.parts = [];
    this.tabSig = '';
    this.builtFor = this.s.comp;
    const head = el('div', 'label tiny', b, [4, 2, 200, 8], 'EXTENDED — NOT PART OF CLASSIC M');
    head.style.color = 'var(--ink)';
    const status = el('div', 'label tiny', b, [176, 2, 160, 8]);
    status.style.color = 'var(--ink)';
    this.parts.push({
      update: () => {
        const ck = this.s.clockStatus();
        const clock = ck === 'internal' ? 'INTERNAL CLOCK' : `EXTERNAL CLOCK · ${ck.toUpperCase()}`;
        const t = this.ext.enabled ? clock : 'EXTENDED IS OFF — Options ▸ Extended…';
        if (status.textContent !== t) status.textContent = t;
        setTip(status, this.ext.enabled ? 'The Robots, Rules and Return follow emmm’s musical clock — internal, or MIDI clock in (MIDI Settings)' : 'Robots, Rules and Return run only when Extended is switched on');
      },
    });
    for (let i = 0; i < NUM_ROBOTS; i++) this.buildRow(i, 12 + i * 15);
    // activity log
    label(b, 340, 2, 'ACTIVITY', 'tiny').style.color = 'var(--ink)';
    this.button(b, 432, 0, 38, 'Clear', 'Clear the activity log (only what is shown; nothing musical)', () => (this.c.clearLog(), (this.logSig = '')), () => true, 10, this.parts).style.fontSize = '7px';
    this.logEl = el('div', 'box', b, [338, 12, 134, 59]);
    this.logEl.style.background = 'var(--paper)';
    this.logEl.style.overflow = 'hidden';
    this.logEl.setAttribute('role', 'log');
    this.logEl.setAttribute('aria-live', 'off');
    this.logEl.setAttribute('aria-label', 'Robot activity');
    // tabs
    TABS.forEach((t, k) => {
      const d = el('div', 'num', b, [2 + k * 62, 75, 60, 14], t.name);
      d.style.fontSize = '9px';
      d.setAttribute('role', 'tab');
      d.title = t.help;
      this.activatable(d, () => {
        this.tab = t.id;
        this.s.changed('window');
      });
      this.parts.push({ update: () => (d.classList.toggle('inv', this.tab === t.id), d.setAttribute('aria-selected', String(this.tab === t.id))) });
    });
    const msg = el('div', 'label small', b, [252, 78, 220, 10]);
    msg.setAttribute('aria-live', 'polite');
    msg.style.overflow = 'hidden';
    msg.style.textOverflow = 'ellipsis';
    this.parts.push({ update: () => msg.textContent !== this.s.status && ((msg.textContent = this.s.status), setTip(msg, this.s.status)) });
    // ← → move between the window's controls from any of them (also off a closed pop-up,
    // whose ↑ ↓ choose; number boxes keep their arrows for their values)
    b.addEventListener(
      'keydown',
      (e) => {
        if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.metaKey || e.ctrlKey || e.altKey) return;
        const t = e.target as HTMLElement;
        if (!(t.dataset.rnav || (t.classList.contains('msel') && t.getAttribute('aria-expanded') !== 'true'))) return;
        e.preventDefault();
        e.stopPropagation();
        this.moveFocus(t, e.key === 'ArrowRight' ? 1 : -1);
      },
      true,
    );
    this.panel = el('div', '', b, [0, PANEL_Y, W, H - 18 - PANEL_Y]);
    this.panel.style.position = 'absolute';
    this.panel.setAttribute('role', 'tabpanel');
  }

  /** One overview row. */
  private buildRow(i: number, y: number): void {
    const b = this.win.body;
    const s = this.s;
    const row = el('div', '', b, [0, y - 1, 336, 15]);
    row.style.position = 'absolute';
    row.style.outlineOffset = '-1px';
    row.addEventListener('pointerdown', () => {
      this.sel = i;
      this.tab = 'robot';
      s.changed('window');
    });
    const on = el('div', 'num', b, [2, y, 16, 13], String(i + 1));
    on.setAttribute('role', 'switch');
    on.setAttribute('aria-label', `Robot ${i + 1} on / off`);
    this.activatable(on, () => ((this.sel = i), s.setRobotEnabled(i, !this.c.robotOn(i))), () => this.ext.enabled);
    const name = el('div', 'label small', b, [21, y + 3, 62, 9]);
    const cells = svgEl(66, 13, '');
    const cbox = el('div', '', b, [84, y, 66, 13]);
    cbox.style.position = 'absolute';
    cbox.appendChild(cells);
    const rate = el('div', 'label small', b, [154, y + 3, 26, 9]);
    const vars = el('div', 'label small', b, [182, y + 3, 78, 9]);
    vars.style.overflow = 'hidden';
    vars.style.textOverflow = 'ellipsis';
    const st = el('div', 'label small', b, [262, y + 3, 74, 9]);
    st.style.overflow = 'hidden';
    this.parts.push({
      update: () => {
        const c = this.c;
        const def = this.ext.robots[i];
        const active = c.robotOn(i);
        const docOn = s.robotEnabled(i);
        on.classList.toggle('inv', active);
        on.setAttribute('aria-checked', String(active));
        setTip(on, `Robot ${i + 1}: ${active ? 'ON' : 'off'}${active !== docOn && this.ext.enabled ? ' (switched by a Rule while playing)' : ''}${i === 0 ? ' — Robot 1 is M’s Robot Conductor: the robot button in the Conducting window' : ''}. Click to switch.`);
        row.style.outline = this.sel === i ? '1px dotted var(--ink)' : 'none';
        const p = c.personality(i);
        const pName = personalityInfo(p).name + (c.personalityOverride[i] ? '*' : '');
        if (name.textContent !== pName) name.textContent = pName;
        name.style.fontWeight = active ? '700' : '400';
        // the six Positions: current inverted, Home marked, not allowed by the weights dotted
        const pos = c.displayPos(i);
        const home = c.robotHome(i);
        const vlist = c.variables(i);
        const ok = new Set(candidates(this.ext.weights, c.isBaton(i) ? [] : vlist).map((x) => x.pos));
        let g = '';
        for (let k = 0; k < NUM_POSITIONS; k++) {
          const x = k * 11;
          const cur = k === pos && (active || !s.playing);
          g += `<rect x="${x + 0.5}" y="0.5" width="10" height="12" fill="${cur ? 'var(--ink)' : 'var(--paper)'}" stroke="var(--ink)" stroke-dasharray="${ok.has(k) ? '0' : '1 1'}"/>`;
          g += `<text x="${x + 5.5}" y="9" font-size="8" text-anchor="middle" font-family="Silkscreen" fill="${cur ? 'var(--paper)' : 'var(--ink)'}">${ok.has(k) ? k + 1 : '·'}</text>`;
          if (home === k) g += `<rect x="${x + 2}" y="10.5" width="7" height="1.5" fill="${cur ? 'var(--paper)' : 'var(--ink)'}"/>`;
        }
        setSvg(cells, g);
        setTip(cbox, `Robot ${i + 1} at Position ${pos + 1}${home !== null ? ` · Home ${home + 1} (underlined)` : ''}${ok.size < 6 ? ' · dotted = not allowed by the weights' : ''}`);
        const rt = c.isBaton(i) ? `1|${s.comp.conducting.robot.rate}` : rateLabel(def);
        if (rate.textContent !== rt) rate.textContent = rt;
        setTip(rate, c.isBaton(i) ? `M’s robot jumps once every 1/${s.comp.conducting.robot.rate} note` : `One decision ${rateWords(def)} (${rt} of a whole note, M’s Time Base)`);
        const vt = vlist.length ? vlist.map((v) => VAR_SHORT[v]).join(' ') : c.isBaton(i) ? 'no arrows on' : '—';
        if (vars.textContent !== vt) vars.textContent = vt;
        setTip(vars, c.isBaton(i) ? `Baton (M): the Variables whose conducting arrows are on — ${vt}` : `Moves: ${vlist.map((v) => VAR_LONG[v]).join(', ') || 'no Variables (it still moves, for Rules)'}`);
        const status = this.robotStatus(i);
        if (st.textContent !== status.text) st.textContent = status.text;
        st.style.fontWeight = status.strong ? '700' : '400';
        st.style.color = status.recent ? 'var(--activity)' : 'var(--ink)';
        setTip(st, status.tip);
      },
    });
  }

  /** What a Robot is doing, in a few words (never only a colour). */
  private robotStatus(i: number): { text: string; tip: string; strong?: boolean; recent?: boolean } {
    const c = this.c;
    const s = this.s;
    if (!this.ext.enabled) return { text: '—', tip: 'Extended is off' };
    if (!c.robotOn(i)) return { text: 'off', tip: `Robot ${i + 1} is off` };
    const now = s.scheduler.nowTick();
    if (c.suspended(i, now)) return { text: 'PAUSED', strong: true, tip: `Paused by a Rule until ${barBeat(c.suspendedUntil[i])}` };
    const vars = c.variables(i);
    if (vars.length && vars.every((v) => c.owns(v, now))) return { text: c.ret ? 'RETURN' : 'resting', strong: true, tip: c.ret ? 'Its Variables are being Returned Home: it waits' : 'Its Variables rest at Home after the Return: it waits' };
    if (c.waiting[i]) return { text: `waits R${(this.ext.robots[i].target ?? 0) + 1}`, tip: 'Follower / Contrarian: the Robot it watches is off or has not moved yet, so it holds' };
    const moved = now - c.lastMoveTick[i];
    if (s.playing && moved >= 0 && moved < 96) return { text: `▸ ${c.lastChanged[i] || 'moved'}`, recent: true, strong: true, tip: `Moved at ${barBeat(c.lastMoveTick[i])}: ${c.lastChanged[i] || 'its Position only'}` };
    if (c.isBaton(i)) return { text: 'Baton (M)', tip: 'M’s Robot Conductor: the Baton jumps; the Variables with arrows on follow' };
    if (!Number.isFinite(c.next[i]) && this.ext.robots[i].rateDen === STEP_ADVANCE) return { text: 'on Rules', tip: 'Rate sa: moves only when a Rule advances it' };
    if (!s.playing) return { text: 'ready', tip: 'Starts deciding one step after Start' };
    return { text: Number.isFinite(c.next[i]) ? `next ${barBeat(c.next[i])}` : 'on', tip: `Next decision at bar ${barBeat(c.next[i])}` };
  }

  // ------------------------------------------------------------------ tabs

  private tabKey(): string {
    const ext = this.ext;
    switch (this.tab) {
      case 'robot':
        return `robot|${this.sel}|${this.c.isBaton(this.sel) ? 'baton' : ext.robots[this.sel].personality}`;
      case 'weights':
        return `weights|${this.selVar}`;
      case 'rules': {
        const r = ext.rules[this.selRule];
        return `rules|${this.selRule}|${ext.rules.length}|${r ? JSON.stringify([r.when.kind, r.then.kind]) : ''}`;
      }
      case 'home':
        return 'home';
    }
  }

  private buildTab(): void {
    this.panel.innerHTML = '';
    this.tabParts = [];
    if (this.tab === 'robot') this.buildRobot();
    else if (this.tab === 'weights') this.buildWeights();
    else if (this.tab === 'rules') this.buildRules();
    else this.buildHome();
  }

  // ------------------------------------------------------------------ ROBOT

  private buildRobot(): void {
    const p = this.panel;
    const s = this.s;
    const i = this.sel;
    const c = this.c;
    const def = () => this.ext.robots[i];
    const baton = c.isBaton(i);
    label(p, 2, 4, `<b>Robot ${i + 1}</b>`);
    this.toggle(p, 46, 1, 30, () => (c.robotOn(i) ? 'On' : 'Off'), () => c.robotOn(i), () => s.setRobotEnabled(i, !c.robotOn(i)), () => (this.ext.enabled ? `Switch Robot ${i + 1} on or off${i === 0 ? ' (the same switch as the Conducting window’s robot button)' : ''}` : 'Switch Extended on first (Options ▸ Extended…)'), () => this.ext.enabled);
    this.select(
      p,
      82,
      1,
      120,
      `Robot ${i + 1} personality`,
      () => PERSONALITIES.map((x) => ({ value: x.id, text: x.id === 'baton' && i !== 0 ? 'Baton (M) — Robot 1 only' : x.name, disabled: x.id === 'baton' && i !== 0 })),
      () => def().personality,
      (v) => {
        const pv = v as Personality;
        if ((pv === 'follower' || pv === 'contrarian') && def().target !== null && !s.canWatch(i, def().target!)) s.setRobot(i, { personality: pv, target: null });
        else s.setRobot(i, { personality: pv });
      },
    );
    label(p, 208, 5, 'rate', 'tiny');
    if (baton) {
      label(p, 230, 4, '1 |', 'small');
      this.tabParts.push(
        new Numerical(p, 244, 1, 22, 14, { get: () => s.comp.conducting.robot.rate, set: (x) => s.setBatonRobot({ rate: x }), values: [1, 2, 4, 8], title: 'M’s robot rate: one jump every 1/1, 1/2, 1/4 or 1/8 note (as in the Conducting window)' }),
      );
    } else {
      this.rateBoxes(p, 230, 1, () => ({ num: def().rateNum, den: def().rateDen }), (num, den) => s.setRobot(i, { rateNum: num, rateDen: den }), 'Rate (M’s Time Base): one decision every n / d of a whole note — 1|4 a beat, 1|1 a bar, 2|1 two bars; sa = only when a Rule advances it. Type "2/1" for both.', true);
    }
    this.text(p, 282, 4, 190, 9, () => (baton ? `one jump every 1/${s.comp.conducting.robot.rate} note` : rateWords(def())));
    // Variables
    label(p, 2, 23, 'Variables', 'tiny');
    ROBOT_VARS.forEach((v, k) => {
      const x = 46 + (k % 5) * 62;
      const y = 19 + Math.floor(k / 5) * 15;
      this.toggle(
        p,
        x,
        y,
        60,
        () => VAR_LONG[v].replace('Velocity Range', 'Velocity').replace('Time Distortion', 'Time Dist').replace('Orchestration', 'Orchestr.'),
        () => c.variables(i).includes(v),
        () => s.toggleRobotVariable(i, v as RobotVar),
        () => (baton ? 'Baton (M) moves the Variables whose conducting arrows are on — switch arrows in the Variables windows' : `${VAR_LONG[v]}: ${c.variables(i).includes(v) ? 'moved by' : 'not moved by'} Robot ${i + 1}`),
        () => !baton,
      );
    });
    this.text(p, 360, 22, 112, 26, () => (baton ? 'Set by the conducting arrows' : `${def().variables.length || 'No'} Variable${def().variables.length === 1 ? '' : 's'}: one Position for all`), 'label tiny');
    // parameters
    label(p, 2, 56, 'set', 'tiny');
    let x = 46;
    if (baton) {
      label(p, x, 56, 'jump ↔ %', 'tiny');
      this.tabParts.push(new Numerical(p, x + 40, 52, 28, 14, { get: () => Math.round(s.comp.conducting.robot.hRange * 100), set: (v) => s.setBatonRobot({ hRange: v / 100 }), min: 0, max: 100, title: 'How far the Baton may jump sideways (as in the Conducting window)' }));
      x += 76;
      label(p, x, 56, 'jump ↕ %', 'tiny');
      this.tabParts.push(new Numerical(p, x + 40, 52, 28, 14, { get: () => Math.round(s.comp.conducting.robot.vRange * 100), set: (v) => s.setBatonRobot({ vRange: v / 100 }), min: 0, max: 100, title: 'How far the Baton may jump up and down' }));
    } else {
      const info = personalityInfo(def().personality);
      if (def().personality === 'follower' || def().personality === 'contrarian') {
        label(p, x, 56, 'watches', 'tiny');
        this.select(
          p,
          x + 34,
          52,
          96,
          `Robot ${i + 1} watches`,
          () => [
            { value: '-', text: '— nobody —' },
            ...Array.from({ length: NUM_ROBOTS }, (_, t) => ({
              value: String(t),
              text: t === i ? `Robot ${t + 1} (itself)` : !s.canWatch(i, t) ? `Robot ${t + 1} (watches back)` : `Robot ${t + 1}${c.robotOn(t) ? '' : ' (off)'}`,
              disabled: t === i || !s.canWatch(i, t),
            })),
          ],
          () => (def().target === null ? '-' : String(def().target)),
          (v) => s.setRobot(i, { target: v === '-' ? null : Number(v) }),
        );
        x += 136;
      }
      for (const k of info.params) {
        const pi = PARAM_INFO[k];
        if (k === 'mode') {
          const modes = def().personality === 'follower' ? (['copy', 'echo'] as const) : (['mirror', 'avoid'] as const);
          label(p, x, 56, 'mode', 'tiny');
          this.select(
            p,
            x + 24,
            52,
            56,
            `Robot ${i + 1} mode`,
            () => modes.map((m) => ({ value: m, text: m })),
            () => (modes as readonly string[]).includes(def().params.mode) ? def().params.mode : modes[0],
            (v) => s.setRobotParam(i, 'mode', v as RobotParams['mode']),
          );
          x += 86;
        } else if (k === 'dir') {
          this.toggle(p, x, 52, 40, () => (def().params.dir < 0 ? 'down' : 'up'), () => false, () => s.setRobotParam(i, 'dir', def().params.dir < 0 ? 1 : -1), 'Orbit direction: up (1 2 3 …) or down (6 5 4 …)');
          x += 46;
        } else {
          label(p, x, 56, pi.label, 'tiny');
          const lw = Math.max(26, pi.label.length * 5 + 4);
          this.tabParts.push(new Numerical(p, x + lw, 52, 24, 14, { get: () => def().params[k] as number, set: (v) => s.setRobotParam(i, k, v as never), min: pi.min, max: pi.max, title: `${info.name}: ${pi.help} (${pi.min}–${pi.max})` }));
          x += lw + 30;
        }
      }
      if (info.params.length) this.button(p, Math.max(x, 380), 52, 50, 'Defaults', `Put ${info.name}’s parameters back to their defaults (the other personalities’ settings are kept)`, () => s.resetRobotParams(i));
      // a mode that belongs to the other personality is shown as that personality's first mode
    }
    // Home Position and where it is
    label(p, 2, 77, 'Home', 'tiny');
    for (let k = -1; k < NUM_POSITIONS; k++) {
      this.toggle(
        p,
        46 + (k + 1) * 18,
        73,
        16,
        () => (k < 0 ? '–' : String(k + 1)),
        () => (k < 0 ? def().home === null : def().home === k),
        () => s.setRobot(i, { home: k < 0 ? null : k }),
        k < 0 ? 'No Home Position of its own: it uses the captured Home of its first Variable (HOME tab)' : `Robot ${i + 1}’s Home Position: ${k + 1} (Homebody returns here; “Robot returns Home” Rules)`,
        () => !baton,
      );
    }
    this.text(p, 176, 76, 296, 9, () => {
      const h = c.robotHome(i);
      const pos = c.displayPos(i);
      return `${s.playing || s.engine.state === 'paused' ? 'now at' : 'starts at'} Position ${pos + 1}${h !== null ? ` · Home ${h + 1}${def().home === null ? ' (from the captured Home)' : ''}` : ' · no Home'} · priority ${i + 1} of 4`;
    });
    // description
    const box = el('div', 'box', p, [2, 92, 470, 82]);
    box.style.background = 'var(--paper)';
    const desc = el('div', 'label small', box, [4, 3, 460, 76]);
    desc.style.whiteSpace = 'normal';
    desc.style.lineHeight = '10px';
    this.tabParts.push({
      update: () => {
        const pi = personalityInfo(c.isBaton(i) ? 'baton' : def().personality);
        const lines = [`<b>${pi.name}</b> — ${pi.help}`];
        if (!c.isBaton(i)) {
          lines.push(pi.weighted ? 'Weights shape its choices (WEIGHTS tab): taller bars are likelier; 0 = never.' : 'Weights only decide which Positions are allowed (0 = not allowed); their sizes do not change its path.');
          const cands = candidates(this.ext.weights, def().variables).map((x) => x.pos + 1);
          lines.push(`Allowed Positions now: ${cands.join(' ')}.`);
          if (c.personalityOverride[i]) lines.push(`A Rule changed it to ${personalityInfo(c.personalityOverride[i]!).name} while playing (* in the overview); Stop puts it back.`);
          if ((def().personality === 'follower' || def().personality === 'contrarian') && def().target === null) lines.push('<b>Choose a Robot to watch</b> — until then it holds its Position.');
        } else {
          lines.push('This is M’s original algorithm, unchanged. Choose another personality to let Robot 1 choose Positions itself (the Baton then stays still).');
        }
        if (i === 0) lines.push('Robot 1 is M’s Robot Conductor: its on / off is the Conducting window’s robot button.');
        lines.push('Priority: when Robots change one Variable at the same moment, the lower number wins.');
        const html = lines.join('<br>');
        if (desc.innerHTML !== html) desc.innerHTML = html;
      },
    });
    this.text(p, 2, 178, 470, 40, () => (this.ext.enabled ? 'Click a row in the overview to edit another Robot. Rate “sa” = it moves only when a Rule tells it to.' : 'Extended is off: these settings are kept but nothing runs. Switch it on in Options ▸ Extended….'), 'label tiny');
  }

  // ------------------------------------------------------------------ WEIGHTS

  private buildWeights(): void {
    const p = this.panel;
    const s = this.s;
    const v = this.selVar;
    label(p, 2, 4, 'Variable', 'tiny');
    ROBOT_VARS.forEach((rv, k) => {
      const x = 46 + k * 42;
      const d = el('div', 'num', p, [x, 0, 40, 14], VAR_SHORT[rv]);
      d.style.fontSize = '9px';
      d.setAttribute('role', 'tab');
      this.activatable(d, () => {
        this.selVar = rv as RobotVar;
        s.changed('window');
      });
      d.title = `${VAR_LONG[rv]}: edit its weights`;
      d.classList.toggle('inv', rv === v);
      const strip = svgEl(40, 4, '');
      const sb = el('div', '', p, [x, 16, 40, 4]);
      sb.style.position = 'absolute';
      sb.appendChild(strip);
      this.tabParts.push({ update: () => setSvg(strip, stripSvg(weightRow(this.ext.weights, rv), 40, 4, false)) });
    });
    // six columns of bars: drag to set
    const X0 = 46;
    const CW = 62;
    const BH = 66;
    label(p, 2, 30, 'weight', 'tiny');
    label(p, 2, 38, '(drag)', 'tiny');
    label(p, 2, 106, 'Position', 'tiny');
    label(p, 2, 124, 'weight', 'tiny');
    label(p, 2, 140, 'chance', 'tiny');
    const row = () => weightRow(this.ext.weights, v);
    for (let k = 0; k < NUM_POSITIONS; k++) {
      const x = X0 + k * CW;
      const col = el('div', 'box', p, [x, 26, CW - 6, BH]);
      col.style.background = 'var(--paper)';
      col.style.overflow = 'hidden';
      col.setAttribute('role', 'slider');
      col.setAttribute('aria-label', `${VAR_LONG[v]} Position ${k + 1} weight`);
      col.setAttribute('aria-valuemin', '0');
      col.setAttribute('aria-valuemax', '100');
      col.tabIndex = 0;
      const fill = el('div', 'inv', col, [0, 0, CW - 8, 0]);
      fill.style.position = 'absolute';
      fill.style.bottom = '0';
      fill.style.top = 'auto';
      const x0 = el('div', 'label small', col, [0, 26, CW - 8, 10], 'excluded');
      x0.style.textAlign = 'center';
      const setFrom = (e: PointerEvent, final: boolean) => {
        const pt = localPoint(col, e);
        if (!(pt.h > 0)) return;
        const w = Math.round(Math.max(0, Math.min(1, 1 - pt.y / pt.h)) * 100);
        if (final || w !== row()[k]) s.setWeight(v as RobotVar, k, w);
      };
      col.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        col.focus({ preventScroll: true });
        setFrom(e, false);
        trackDrag(e, col, ({ ev }) => setFrom(ev, false));
      });
      col.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowUp' ? (e.shiftKey ? 10 : 1) : e.key === 'ArrowDown' ? -(e.shiftKey ? 10 : 1) : e.key === 'Home' ? -100 : e.key === 'End' ? 100 : 0;
        if (!d) return;
        e.preventDefault();
        e.stopPropagation();
        s.setWeight(v as RobotVar, k, Math.max(0, Math.min(100, row()[k] + d)));
      });
      const pos = el('div', 'label', p, [x, 102, CW - 6, 10]);
      pos.style.textAlign = 'center';
      this.tabParts.push(
        new Numerical(p, x + 12, 120, 30, 14, { get: () => row()[k], set: (w) => s.setWeight(v as RobotVar, k, w), min: 0, max: 100, title: `${VAR_LONG[v]} Position ${k + 1}: weight 0–100 (0 = never chosen by a Robot)` }),
      );
      const pct = el('div', 'label small', p, [x, 140, CW - 6, 10]);
      pct.style.textAlign = 'center';
      this.tabParts.push({
        update: () => {
          const r = row();
          const sum = r.reduce((a, b) => a + b, 0) || 1;
          const w = r[k];
          fill.style.height = Math.round((w / 100) * (BH - 2)) + 'px';
          x0.style.display = w === 0 ? 'block' : 'none';
          col.style.backgroundImage = w === 0 ? 'repeating-linear-gradient(45deg, var(--dim) 0 1px, transparent 1px 4px)' : 'none';
          col.setAttribute('aria-valuenow', String(w));
          const cur = activeOf(s.comp, v) === k;
          const hp = this.ext.home.positions?.[v];
          const t = `${k + 1}${cur ? ' ▸now' : ''}${hp === k ? ' ⌂' : ''}`;
          if (pos.textContent !== t) pos.textContent = t;
          pos.style.fontWeight = cur ? '700' : '400';
          const pt = w === 0 ? 'never' : `${Math.round((w / sum) * 100)} %`;
          if (pct.textContent !== pt) pct.textContent = pt;
          setTip(col, `${VAR_LONG[v]} Position ${k + 1}: weight ${w}${w ? ` — about ${Math.round((w / sum) * 100)} % of a weighted Robot’s free choices` : ' — excluded: no Robot picks it (you and Rules still can)'}${cur ? ' · the current Position' : ''}${hp === k ? ' · Home' : ''}. Drag up / down, or ↑ ↓.`);
        },
      });
    }
    // the chances as one strip
    label(p, 2, 158, 'each pick', 'tiny');
    const strip = svgEl(CW * 6 - 6, 12, '');
    const sb = el('div', '', p, [X0, 155, CW * 6 - 6, 12]);
    sb.style.position = 'absolute';
    sb.appendChild(strip);
    sb.title = 'One weighted pick: each Position’s share of the strip is its chance';
    this.tabParts.push({ update: () => setSvg(strip, stripSvg(row(), CW * 6 - 6, 12, true)) });
    // operations
    const ops: [string, string, 'equal' | 'random' | 'current' | 'home' | 'reset', () => boolean][] = [
      ['Equalise', 'All allowed Positions equally likely (excluded ones stay excluded)', 'equal', () => true],
      ['Random', 'New random weights for the allowed Positions (from the seed’s editing stream)', 'random', () => true],
      ['Favour now', 'The current Position much likelier (60), the other allowed ones 10', 'current', () => true],
      ['Favour ⌂', 'The Home Position much likelier (needs a captured Home)', 'home', () => !!this.ext.home.positions],
      ['Reset', 'All six back to 10 (all allowed, equally likely)', 'reset', () => true],
    ];
    ops.forEach(([t, tip, op, en], k) => this.button(p, X0 + k * 75, 172, 71, t, tip, () => s.weightOp(v as RobotVar, op), en));
    this.text(p, 2, 190, 470, 36, () => {
      const users = Array.from({ length: NUM_ROBOTS }, (_, i) => i).filter((i) => this.c.variables(i).includes(v));
      const who = users.length ? `Moved by ${users.map((i) => `Robot ${i + 1} (${personalityInfo(this.c.personality(i)).name})`).join(', ')}.` : 'No Robot moves it now.';
      return `${who} Taller bar = chosen more often by Drunk, Tourist, Homebody, Restless, Chaotic, Curious and Contrarian (avoid). Orbit, Pendulum, Follower and mirror only skip excluded Positions. One Position always stays allowed.`;
    }, 'label tiny');
  }

  // ------------------------------------------------------------------ RULES

  private buildRules(): void {
    const p = this.panel;
    const s = this.s;
    const rules = () => this.ext.rules;
    const list = el('div', 'box', p, [2, 0, 470, 86]);
    list.style.background = 'var(--paper)';
    list.style.overflowY = 'auto';
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', 'Rules');
    let listSig = '';
    const rows: { on: HTMLDivElement; text: HTMLDivElement; fired: HTMLDivElement; row: HTMLDivElement }[] = [];
    const rebuildList = () => {
      list.innerHTML = '';
      rows.length = 0;
      if (!rules().length) {
        const e = el('div', 'label small', list, [6, 6, 440, 20], 'No Rules yet. Press “New Rule”, then choose WHEN and THEN below.');
        e.style.whiteSpace = 'normal';
      }
      rules().forEach((_, ri) => {
        const y = 1 + ri * 13;
        const row = el('div', '', list, [0, y, 455, 12]);
        row.style.position = 'absolute';
        row.setAttribute('role', 'listitem');
        const on = el('div', 'num', row, [2, 0, 14, 12]);
        on.style.fontSize = '8px';
        on.setAttribute('role', 'switch');
        on.setAttribute('aria-label', `Rule ${ri + 1} on / off`);
        this.activatable(on, () => s.setRule(ri, { on: !rules()[ri].on }));
        const text = el('div', 'label small', row, [20, 2, 380, 9]);
        text.style.overflow = 'hidden';
        text.style.textOverflow = 'ellipsis';
        const fired = el('div', 'label small', row, [404, 2, 50, 9]);
        row.addEventListener('pointerdown', () => {
          this.selRule = ri;
          s.changed('window');
        });
        rows.push({ on, text, fired, row });
      });
    };
    this.tabParts.push({
      update: () => {
        const sig = String(rules().length);
        if (sig !== listSig) {
          listSig = sig;
          rebuildList();
        }
        const now = s.scheduler.nowTick();
        rows.forEach((r, ri) => {
          const rule = rules()[ri];
          if (!rule) return;
          r.on.textContent = String(ri + 1);
          r.on.classList.toggle('inv', rule.on);
          r.on.setAttribute('aria-checked', String(rule.on));
          setTip(r.on, `Rule ${ri + 1} is ${rule.on ? 'on' : 'off'} — click to switch`);
          const sum = ruleSummary(rule);
          if (r.text.textContent !== sum) r.text.textContent = sum;
          r.text.style.opacity = rule.on ? '1' : '0.5';
          setTip(r.text, sum);
          r.row.style.outline = ri === this.selRule ? '1px dotted var(--ink)' : 'none';
          const f = this.c.ruleFlash(ri);
          const fresh = s.playing ? f > -Infinity && now - f < 96 && now >= f : false;
          const fires = this.c.ruleFires(ri);
          const ft = fires ? `${fresh ? '● ' : ''}${f > -Infinity && s.engine.state !== 'stopped' ? barBeat(Math.max(0, f)) : '■'} ×${fires}` : '—';
          if (r.fired.textContent !== ft) r.fired.textContent = ft;
          r.fired.style.fontWeight = fresh ? '700' : '400';
          r.fired.style.color = fresh ? 'var(--activity)' : 'var(--ink)';
          setTip(r.fired, fires ? `Fired ${fires} time${fires === 1 ? '' : 's'} since Start; last at ${f > -Infinity ? barBeat(Math.max(0, f)) : '—'} (● = just now)` : 'Has not fired since Start');
        });
      },
    });
    // list operations
    const sel = () => rules()[this.selRule];
    this.button(p, 2, 89, 70, '+ New Rule', `Add a Rule (at most ${MAX_RULES})`, () => {
      const at = s.addRule();
      if (at >= 0) this.selRule = at;
    }, () => rules().length < MAX_RULES);
    this.button(p, 76, 89, 60, 'Duplicate', 'Copy the selected Rule below it', () => {
      const at = s.duplicateRule(this.selRule);
      if (at >= 0) this.selRule = at;
    }, () => !!sel() && rules().length < MAX_RULES);
    this.button(p, 140, 89, 22, '↑', 'Move the selected Rule up (Rules are checked in order; for one event the later Rule acts last)', () => (this.selRule = s.moveRule(this.selRule, -1)), () => this.selRule > 0 && !!sel());
    this.button(p, 166, 89, 22, '↓', 'Move the selected Rule down', () => (this.selRule = s.moveRule(this.selRule, 1)), () => this.selRule < rules().length - 1);
    this.button(p, 192, 89, 50, 'Delete', 'Delete the selected Rule (Undo brings it back)', () => {
      s.deleteRule(this.selRule);
      this.selRule = Math.max(0, Math.min(this.selRule, rules().length - 1));
    }, () => !!sel());
    this.text(p, 250, 92, 222, 9, () => `${rules().length} / ${MAX_RULES} Rules · once a moment each · chains stop at 3`, 'label tiny');
    const r = sel();
    if (!r) return;
    const ri = this.selRule;
    const set = (patch: Partial<Rule>) => s.setRule(ri, patch);
    const when = () => rules()[ri]?.when;
    const then = () => rules()[ri]?.then;
    // WHEN
    label(p, 2, 112, '<b>WHEN</b>');
    this.select(p, 40, 108, 128, 'Condition', () => CONDITION_KINDS.map((k) => ({ value: k.id, text: k.name })), () => when()?.kind ?? 'cycle', (v) => set({ when: defaultCondition(v as Condition['kind']) }));
    this.conditionParams(p, 172, 108, ri);
    label(p, 400, 112, 'every', 'tiny');
    this.tabParts.push(new Numerical(p, 424, 108, 26, 14, { get: () => rules()[ri]?.every ?? 1, set: (v) => set({ every: v }), min: 1, max: 64, format: (v) => (v === 1 ? '1st' : `${v}th`), title: 'Every Nth time: 1 = every time the condition happens; 4 = every fourth time (counted from Start)' }));
    // THEN
    label(p, 2, 130, '<b>THEN</b>');
    this.select(p, 40, 126, 128, 'Action', () => ACTION_KINDS.map((k) => ({ value: k.id, text: k.name })), () => then()?.kind ?? 'advance', (v) => set({ then: defaultAction(v as Action['kind']) }));
    this.actionParams(p, 172, 126, ri);
    // AT
    label(p, 2, 148, '<b>AT</b>');
    TIMINGS.forEach((t, k) =>
      this.toggle(p, 40 + k * 46, 144, 44, () => t.name, () => rules()[ri]?.at === t.id, () => set({ at: t.id as RuleTiming }), `${t.name}: ${t.help}. While stopped, a timed action waits for Start.`),
    );
    this.text(p, 228, 147, 244, 9, () => timingWords(rules()[ri]?.at ?? 'now', s.comp.quantization), 'label small');
    // readable summary + validation notes
    const box = el('div', 'box', p, [2, 162, 470, 64]);
    box.style.background = 'var(--paper)';
    const notes = el('div', 'label small', box, [4, 3, 460, 58]);
    notes.style.whiteSpace = 'normal';
    notes.style.lineHeight = '10px';
    this.tabParts.push({
      update: () => {
        const rule = rules()[ri];
        if (!rule) return;
        const msgs = this.ruleNotes(rule);
        const html = `<b>${escape(ruleSummary(rule).replace(' THEN ', ' → THEN '))}</b>${msgs.length ? '<br>' + msgs.map((m) => '• ' + escape(m)).join('<br>') : '<br>Ready.'}`;
        if (notes.innerHTML !== html) notes.innerHTML = html;
      },
    });
  }

  /** Warnings about a Rule that will run but may not do what was meant. */
  private ruleNotes(r: Rule): string[] {
    const out: string[] = [];
    const ext = this.ext;
    const c = this.c;
    if (!r.on) out.push('This Rule is off.');
    if (!ext.enabled) out.push('Extended is off: Rules do not run.');
    const robotOf = (x: Condition | Action) => ('robot' in x ? x.robot : -1);
    const wr = robotOf(r.when);
    if (wr >= 0 && !c.robotOn(wr) && r.when.kind !== 'interval') out.push(`Robot ${wr + 1} is off, so it will not move: this condition cannot happen until it is on.`);
    const ar = robotOf(r.then);
    if (ar >= 0 && (r.then.kind === 'advance' || r.then.kind === 'choose' || r.then.kind === 'suspend') && !c.robotOn(ar)) out.push(`Robot ${ar + 1} is off: the action will do nothing until it is on.`);
    if (r.then.kind === 'snapshot' && !this.s.comp.snapshots[r.then.index]) out.push(`Snapshot ${letter(r.then.index)} is empty: nothing will be recalled.`);
    if ((r.then.kind === 'returnHome' || r.when.kind === 'homeReached' || r.when.kind === 'robotHome') && !ext.home.positions) out.push('No Home captured yet (HOME tab).');
    if (r.at === 'quant' && !this.s.comp.quantization) out.push('Q: no Snapshot quantization is set, so it acts at once.');
    if (r.then.kind === 'setPosition' && r.when.kind === 'variableAt' && r.when.variable === r.then.variable) out.push('It changes the Variable it watches: it can set off itself or another Rule, but each Rule fires at most once a moment, so the chain stops.');
    if ((r.then.kind === 'advance' || r.then.kind === 'choose') && (r.when.kind === 'robotMoved' || r.when.kind === 'robotAt') && (r.when.robot === r.then.robot || r.when.robot < 0)) out.push('It moves the Robot it watches: once per moment at most.');
    if (r.then.kind === 'enable' && r.then.robot === 0) out.push('Robot 1 is M’s Robot Conductor: the Rule switches it while playing; the document keeps your setting.');
    if (r.when.kind === 'cycle') out.push('A cycle completes when the Voice comes back round to its first step (not at Start or after a Sync).');
    return out;
  }

  private robotSelect(p: HTMLElement, x: number, y: number, w: number, any: boolean, get: () => number, set: (v: number) => void): void {
    this.select(p, x, y, w, 'Robot', () => [...(any ? [{ value: '-1', text: 'any Robot' }] : []), ...Array.from({ length: NUM_ROBOTS }, (_, i) => ({ value: String(i), text: `Robot ${i + 1}` }))], () => String(get()), (v) => set(Number(v)));
  }
  private positionBox(p: HTMLElement, x: number, y: number, get: () => number, set: (v: number) => void): void {
    label(p, x, y + 4, 'Pos', 'tiny');
    this.tabParts.push(new Numerical(p, x + 18, y, 20, 14, { get: () => get() + 1, set: (v) => set(v - 1), min: 1, max: 6, title: 'Position 1–6' }));
  }
  private variableSelect(p: HTMLElement, x: number, y: number, get: () => VariableName, set: (v: VariableName) => void): void {
    this.select(p, x, y, 94, 'Variable', () => ROBOT_VARS.map((v) => ({ value: v, text: VAR_LONG[v] })), get, (v) => set(v as VariableName));
  }

  private conditionParams(p: HTMLElement, x: number, y: number, ri: number): void {
    const s = this.s;
    const w = () => this.ext.rules[ri]?.when as Condition;
    const upd = (patch: Record<string, unknown>) => s.setRule(ri, { when: { ...w(), ...patch } as Condition });
    switch (w().kind) {
      case 'cycle':
        this.select(p, x, y, 64, 'Voice', () => [{ value: '-1', text: 'any Voice' }, ...[0, 1, 2, 3].map((v) => ({ value: String(v), text: `Voice ${v + 1}` }))], () => String((w() as { voice: number }).voice), (v) => upd({ voice: Number(v) }));
        this.select(p, x + 68, y, 64, 'Which cycle', () => (['pattern', 'rhythm', 'legato', 'accent'] as const).map((k) => ({ value: k, text: CYCLE_NAMES[k] })), () => (w() as { cycle: string }).cycle, (v) => upd({ cycle: v }));
        break;
      case 'robotMoved':
      case 'robotHome':
        this.robotSelect(p, x, y, 72, true, () => (w() as { robot: number }).robot, (v) => upd({ robot: v }));
        break;
      case 'robotAt':
        this.robotSelect(p, x, y, 64, false, () => (w() as { robot: number }).robot, (v) => upd({ robot: v }));
        this.positionBox(p, x + 70, y, () => (w() as { position: number }).position, (v) => upd({ position: v }));
        break;
      case 'variableAt':
        this.variableSelect(p, x, y, () => (w() as { variable: VariableName }).variable, (v) => upd({ variable: v }));
        this.positionBox(p, x + 98, y, () => (w() as { position: number }).position, (v) => upd({ position: v }));
        break;
      case 'interval':
        this.rateBoxes(p, x, y, () => w() as { num: number; den: number }, (num, den) => upd({ num, den }), 'Every n / d of a whole note from Start (M’s Time Base): 1|1 every bar, 8|1 every 8 bars, 1|4 every beat');
        this.text(p, x + 50, y + 3, 90, 9, () => ruleSummary(this.ext.rules[ri]).split(' THEN ')[0].replace('WHEN ', ''));
        break;
      default:
        this.text(p, x, y + 3, 200, 9, () => (w().kind === 'homeReached' ? 'every Variable in the Home is there' : 'a Return Home has finished'), 'label tiny');
    }
  }

  private actionParams(p: HTMLElement, x: number, y: number, ri: number): void {
    const s = this.s;
    const a = () => this.ext.rules[ri]?.then as Action;
    const upd = (patch: Record<string, unknown>) => s.setRule(ri, { then: { ...a(), ...patch } as Action });
    switch (a().kind) {
      case 'advance':
      case 'choose':
        this.robotSelect(p, x, y, 64, false, () => (a() as { robot: number }).robot, (v) => upd({ robot: v }));
        this.text(p, x + 70, y + 3, 150, 9, () => (a().kind === 'advance' ? 'one decision of its personality' : 'a different allowed Position'), 'label tiny');
        break;
      case 'enable':
        this.robotSelect(p, x, y, 64, false, () => (a() as { robot: number }).robot, (v) => upd({ robot: v }));
        this.select(p, x + 68, y, 56, 'On / off', () => (['on', 'off', 'toggle'] as const).map((m) => ({ value: m, text: m })), () => (a() as { mode: string }).mode, (v) => upd({ mode: v }));
        break;
      case 'personality':
        this.robotSelect(p, x, y, 64, false, () => (a() as { robot: number }).robot, (v) => upd({ robot: v, personality: v !== 0 && (a() as { personality: string }).personality === 'baton' ? 'next' : (a() as { personality: string }).personality }));
        this.select(
          p,
          x + 68,
          y,
          100,
          'Personality',
          () => [{ value: 'next', text: 'next one' }, ...PERSONALITIES.map((x2) => ({ value: x2.id, text: x2.id === 'baton' ? 'Baton (M) — Robot 1 only' : x2.name, disabled: x2.id === 'baton' && (a() as { robot: number }).robot !== 0 }))],
          () => (a() as { personality: string }).personality,
          (v) => upd({ personality: v }),
        );
        break;
      case 'setPosition':
        this.variableSelect(p, x, y, () => (a() as { variable: VariableName }).variable, (v) => upd({ variable: v }));
        this.positionBox(p, x + 98, y, () => (a() as { position: number }).position, (v) => upd({ position: v }));
        break;
      case 'snapshot':
        this.select(p, x, y, 80, 'Snapshot', () => Array.from({ length: NUM_SNAPSHOTS }, (_, i) => ({ value: String(i), text: `Snapshot ${letter(i)}${this.s.comp.snapshots[i] ? '' : ' (empty)'}` })), () => String((a() as { index: number }).index), (v) => upd({ index: Number(v) }));
        break;
      case 'returnHome':
        this.toggle(p, x, y, 120, () => ((a() as { immediate: boolean }).immediate ? 'jump Home at once' : 'gradual Return'), () => (a() as { immediate: boolean }).immediate, () => upd({ immediate: !(a() as { immediate: boolean }).immediate }), 'Gradual: over the Return duration (HOME tab). At once: all Home in one step.');
        break;
      case 'suspend':
        this.robotSelect(p, x, y, 64, false, () => (a() as { robot: number }).robot, (v) => upd({ robot: v }));
        label(p, x + 68, y + 4, 'for', 'tiny');
        this.rateBoxes(p, x + 82, y, () => a() as { num: number; den: number }, (num, den) => upd({ num, den }), 'How long (n / d of a whole note): 2|1 = two bars');
        break;
    }
  }

  // ------------------------------------------------------------------ HOME

  private buildHome(): void {
    const p = this.panel;
    const s = this.s;
    const c = this.c;
    const home = () => this.ext.home;
    this.button(p, 2, 1, 76, 'Capture Home', 'Capture Home: remember every Variable’s current Position (and the Baton). Again = replace it.', () => s.captureHome(), () => true, 16);
    this.button(p, 82, 1, 40, 'Clear', 'Forget the Home', () => s.clearHome(), () => !!home().positions, 16);
    const ret = this.button(
      p,
      322,
      1,
      150,
      'RETURN HOME',
      () => (c.ret ? 'Returning — click to stop the Return where it is' : `Return Home (${keyLabel('returnHome')}): bring the included Variables back, ${this.ext.returnSettings.immediate ? 'all at once' : 'gradually over the duration below'}`),
      () => s.returnHome(),
      () => this.ext.enabled && !!home().positions,
      20,
    );
    ret.style.fontSize = '11px';
    this.tabParts.push({
      update: () => {
        const t = c.ret ? 'RETURNING… (stop)' : 'RETURN HOME';
        if (ret.textContent !== t) ret.textContent = t;
        ret.classList.toggle('on', !!c.ret);
      },
    });
    this.text(p, 128, 5, 190, 9, () => this.homeStatus(), 'label small').style.fontWeight = '700';
    // settings
    label(p, 2, 26, 'over', 'tiny');
    this.rateBoxes(p, 22, 22, () => ({ num: this.ext.returnSettings.num, den: this.ext.returnSettings.den }), (num, den) => s.setReturnSettings({ num, den }), 'Return duration (n / d of a whole note): 2|1 = two bars. Steps fall on the Snapshot quantization grid (a beat if none).');
    this.text(p, 72, 26, 54, 9, () => durationWordsUi(this.ext.returnSettings.num, this.ext.returnSettings.den), 'label small');
    this.toggle(p, 128, 22, 64, () => 'Immediate', () => this.ext.returnSettings.immediate, () => s.setReturnSettings({ immediate: !this.ext.returnSettings.immediate }), 'Immediate: everything Home in one step (at the next quantization point). Off: gradual, through the Positions in between.');
    label(p, 198, 26, 'rest', 'tiny');
    this.tabParts.push(new Numerical(p, 216, 22, 24, 14, { get: () => this.ext.returnSettings.rest, set: (v) => s.setReturnSettings({ rest: v }), min: 0, max: 32, title: 'Rest: beats the Variables stay Home after the Return (still owned by it) before Robots and Trajectories move them again (0–32)' }));
    label(p, 244, 26, 'beats', 'tiny');
    this.text(p, 272, 26, 200, 9, () => {
      const n = this.ext.rules.filter((r) => r.then.kind === 'returnHome').length;
      return `trigger: button · ${keyLabel('returnHome')}${n ? ` · ${n} Rule${n === 1 ? '' : 's'}` : ' · or a Rule'}`;
    }, 'label small');
    // progress
    const bar = el('div', 'range', p, [2, 41, 470, 9]);
    const fill = el('div', 'fill inv', bar);
    fill.style.left = '0';
    const tmark = el('div', 'cur', bar);
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', 'Return progress');
    this.tabParts.push({
      update: () => {
        const pr = c.returnProgress();
        const r = c.ret;
        fill.style.width = Math.round((pr ?? (home().positions && c.distance() === 0 ? 1 : 0)) * 468) + 'px';
        const now = s.scheduler.nowTick();
        const tf = r ? Math.max(0, Math.min(1, (now - r.start) / (r.end - r.start))) : 0;
        tmark.style.left = Math.round(tf * 468) + 'px';
        tmark.style.display = r ? 'block' : 'none';
        bar.setAttribute('aria-valuenow', String(Math.round((pr ?? 0) * 100)));
        setTip(bar, r ? `Return: ${Math.round((pr ?? 0) * 100)} % of the steps made; the line is how much of its time has passed` : 'Return progress (filled when at Home)');
      },
    });
    // the Variables
    label(p, 2, 56, 'Variable', 'tiny');
    label(p, 92, 56, 'in', 'tiny');
    label(p, 110, 56, 'Home', 'tiny');
    label(p, 138, 56, 'now', 'tiny');
    label(p, 164, 56, 'state', 'tiny');
    HOME_VARS.forEach((v, k) => {
      const y = 64 + k * 14;
      label(p, 2, y + 3, VAR_LONG[v], 'small');
      this.toggle(p, 90, y, 14, () => (home().include[v] ? '☒' : '☐'), () => false, () => s.setHomeInclude(v, !home().include[v]), `${VAR_LONG[v]}: ${home().include[v] ? 'included — Return brings it Home' : 'excluded — Return leaves it alone'}${v === 'patternGroup' ? ' (a Pattern Group change restarts the Voices)' : v === 'soundChoice' ? ' (sends program changes)' : ''}`);
      this.text(p, 112, y + 3, 24, 9, () => {
        const h = home().positions?.[v];
        return h === undefined ? '—' : v === 'patternGroup' ? 'abcdef'[h] : String(h + 1);
      });
      this.text(p, 140, y + 3, 22, 9, () => (v === 'patternGroup' ? 'abcdef'[activeOf(s.comp, v)] : String(activeOf(s.comp, v) + 1)));
      const st = this.text(p, 164, y + 3, 150, 9, () => this.varStateText(v));
      this.tabParts.push({
        update: () => {
          const state = c.homeState(v);
          st.style.fontWeight = state === 'returning' || state === 'resting' ? '700' : '400';
          st.style.opacity = state === 'excluded' || state === 'none' ? '0.5' : '1';
        },
      });
    });
    this.text(p, 320, 58, 152, 168, () => 'Return moves each included Variable back through the allowed Positions between where it is and Home, in order of musical value (Density 10 % → 40 % → 70 % → 100 %, not by Position number); Variables without a size (Pattern Group, Time Distortion, Orchestration, Sound Choice) go Home in one step at their turn. While a Variable is returning and resting, only the Return moves it: Robots and Trajectories wait (Return > Trajectory > Robot), and the Robots then move on from Home. You can still move it by hand.', 'label tiny');
  }

  private homeStatus(): string {
    const c = this.c;
    const s = this.s;
    if (!this.ext.home.positions) return 'No Home yet — Capture one';
    if (c.ret) {
      const left = c.distance();
      return `Returning: ${c.ret.total - left} of ${c.ret.total} steps · ends ${barBeat(c.ret.end)}`;
    }
    const h = c.restHold;
    if (h && s.scheduler.nowTick() < h.until) return `At Home, resting: ${Math.ceil((h.until - s.scheduler.nowTick()) / 96)} beat(s) left`;
    const d = c.distance();
    return d === 0 ? 'At Home' : `${d} step${d === 1 ? '' : 's'} from Home`;
  }

  private varStateText(v: VariableName): string {
    const c = this.c;
    const home = this.ext.home;
    switch (c.homeState(v)) {
      case 'none':
        return '—';
      case 'excluded':
        return '– excluded';
      case 'home':
        return '✓ home';
      case 'waiting':
        return '✓ home (others returning)';
      case 'resting':
        return '… resting at Home';
      case 'returning':
      case 'away': {
        const path = returnPath(this.s.comp, this.ext.weights, v, activeOf(this.s.comp, v), home.positions![v]!);
        const fmt = (x: number) => (v === 'patternGroup' ? 'abcdef'[x] : String(x + 1));
        const shown = path.length > 4 ? [...path.slice(0, 3).map(fmt), '…', fmt(path[path.length - 1])] : path.map(fmt);
        return `${c.homeState(v) === 'returning' ? '▸ returning' : 'away'}: → ${shown.join(' → ')}`;
      }
    }
  }

  // ------------------------------------------------------------------ log

  private updateLog(): void {
    const s = this.s;
    const c = this.c;
    // redrawn only when what is shown changes (a new entry reaching the sounding time)
    const t = s.scheduler.nowTick();
    const shown = c.log.filter((e) => !s.playing || e.stopped || e.tick <= t).slice(-6);
    const sig = `${c.logRev}|${shown.length}|${shown.at(-1)?.tick ?? ''}|${this.ext.enabled}`;
    if (sig === this.logSig) return;
    this.logSig = sig;
    this.logEl.innerHTML = '';
    shown.forEach((e, k) => {
      const d = el('div', 'label small', this.logEl, [2, 1 + k * 9.5, 128, 9]);
      d.style.overflow = 'hidden';
      d.style.textOverflow = 'ellipsis';
      d.style.fontWeight = e.kind === 'rule' || e.kind === 'return' ? '700' : '400';
      d.textContent = `${e.stopped ? '■' : barBeat(e.tick)} ${e.text}`;
      d.title = d.textContent;
    });
    if (!shown.length) el('div', 'label tiny', this.logEl, [3, 3, 126, 8], s.comp.extended.enabled ? 'Nothing yet' : 'Extended is off');
  }

  update(): void {
    if (this.builtFor !== this.s.comp) this.build();
    const key = this.tabKey();
    if (key !== this.tabSig) {
      this.tabSig = key;
      this.buildTab();
    }
    this.parts.forEach((p) => p.update());
    this.tabParts.forEach((p) => p.update());
    this.updateLog();
  }
}

/** Weights as a strip of proportional segments (`labels`: Position numbers in them). */
function stripSvg(row: number[], w: number, h: number, labels: boolean): string {
  const sum = row.reduce((a, b) => a + b, 0) || 1;
  let x = 0;
  let g = `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="var(--paper)" stroke="var(--ink)"/>`;
  row.forEach((wt, k) => {
    const ww = (wt / sum) * (w - 2);
    if (ww <= 0) return;
    g += `<rect x="${1 + x}" y="1" width="${Math.max(0.5, ww - (labels ? 1 : 0.5))}" height="${h - 2}" fill="${k % 2 ? 'var(--dim)' : 'var(--ink)'}"/>`;
    if (labels && ww > 8) g += `<text x="${1 + x + ww / 2}" y="${h - 3}" font-size="8" text-anchor="middle" font-family="Silkscreen" fill="var(--paper)">${k + 1}</text>`;
    x += ww;
  });
  return g;
}

function timingWords(at: RuleTiming, quant: number): string {
  switch (at) {
    case 'now':
      return 'at once, at the moment of the event';
    case 'quant':
      return quant ? `at the next Snapshot quantization point (1/${quant})` : 'Q — no quantization set, so at once';
    case 'beat':
      return 'at the next beat';
    case 'bar':
      return 'at the next bar';
  }
}

function durationWordsUi(num: number, den: number): string {
  const beats = (num * 4) / den;
  if (beats % 4 === 0) return beats === 4 ? '1 bar' : `${beats / 4} bars`;
  return `${Math.round(beats * 100) / 100} beats`;
}

function escape(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

