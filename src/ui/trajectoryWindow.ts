/**
 * The Trajectory window (EXTENDED — not part of M): four small processes, each a row of
 * values that emmm moves through at a musical rate, pointed at a parameter or a MIDI
 * controller. Drawn with M's own controls: number boxes (type, drag or arrow them), toggles,
 * pop-ups, and a strip of bars showing the sequence and where it is.
 */
import { TIME_BASE_DENOMINATORS, STEP_ADVANCE } from '../engine/constants';
import { MAX_TRAJECTORY_VALUES, stepTicks, targetChoices, targetInfo, TRAJ_MODES, TRAJECTORY_SLOTS, valueAt, type Trajectory, type TrajTarget } from '../extended/trajectory';
import type { UiContext } from './context';
import { el, label, setSvg, setTip, svgEl } from './dom';
import { Selector } from './selector';
import { MWindow, Numerical } from './widgets';

const BOX = 24; // value box width
const VX = 30; // values start
const SLOT_H = 64;
const TOP = 16;

const tkey = (t: TrajTarget) => (t.kind === 'position' ? 'position:' + t.variable : t.kind);

export class TrajectoryWindow {
  win: MWindow;
  private parts: { update(): void }[] = [];
  private rows: { sig: string; box: HTMLDivElement; values: Numerical[]; bars: SVGSVGElement; extra: HTMLDivElement; extraSig: string; focus: number }[] = [];
  private builtFor: object | null = null;

  constructor(private ctx: UiContext, parent: HTMLElement) {
    this.win = new MWindow(parent, { id: 'trajectory', title: 'Trajectory', x: 110, y: 30, w: 470, h: 18 + TOP + TRAJECTORY_SLOTS * SLOT_H + 4, closable: true, area: 'trajectory' });
  }

  private def(slot: number): Trajectory {
    return this.ctx.s.comp.extended.trajectories[slot];
  }

  private toggle(parent: HTMLElement, x: number, y: number, w: number, text: () => string, on: () => boolean, click: () => void, tip: string, enabled: () => boolean = () => true): void {
    const d = el('div', 'num', parent, [x, y, w, 14]);
    d.style.fontSize = '9px';
    d.title = tip;
    d.setAttribute('role', 'switch');
    d.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (enabled()) click();
    });
    this.parts.push({
      update: () => {
        const t = text();
        if (d.textContent !== t) d.textContent = t;
        d.classList.toggle('inv', on());
        d.setAttribute('aria-checked', String(on()));
        d.style.opacity = enabled() ? '1' : '0.4';
      },
    });
  }

  private build(): void {
    const s = this.ctx.s;
    const b = this.win.body;
    b.innerHTML = '';
    this.parts = [];
    this.rows = [];
    this.builtFor = s.comp;
    const note = el('div', 'label tiny', b, [6, 3, 456, 9], 'EXTENDED — NOT PART OF CLASSIC M. A ROW OF VALUES MOVED THROUGH AT A MUSICAL RATE.');
    note.style.color = 'var(--ink)';
    const off = el('div', 'label tiny', b, [300, 3, 160, 9]);
    this.parts.push({ update: () => (off.textContent = s.comp.extended.enabled ? '' : 'EXTENDED IS OFF') });
    for (let slot = 0; slot < TRAJECTORY_SLOTS; slot++) this.buildSlot(slot, TOP + slot * SLOT_H);
  }

  private buildSlot(slot: number, y0: number): void {
    const s = this.ctx.s;
    const b = this.win.body;
    const d = () => this.def(slot);
    if (slot > 0) {
      const rule = el('div', 'box', b, [4, y0 - 4, 458, 1]);
      rule.style.borderWidth = '1px 0 0 0';
      rule.style.borderStyle = 'dotted';
    }
    // on / off
    this.toggle(b, 4, y0, 22, () => `${slot + 1}`, () => d().on, () => s.setTrajectory(slot, { on: !d().on }), `Trajectory ${slot + 1} on / off (it runs while the music plays)`);
    // target
    const choices = targetChoices();
    this.parts.push(
      new Selector(b, 30, y0, 118, 14, {
        label: `Trajectory ${slot + 1} target`,
        fontSize: 8,
        options: () => choices.map((t) => ({ value: tkey(t), text: targetInfo(t).name })),
        value: () => tkey(d().target),
        onChange: (v) => {
          const t = choices.find((c) => tkey(c) === v) ?? { kind: 'none' };
          s.setTrajectory(slot, { target: t.kind === 'cc' && d().target.kind === 'cc' ? d().target : t });
        },
      }),
    );
    // per-target extra: CC channel + number, or Voices
    const extra = el('div', '', b, [152, y0, 96, 14]);
    extra.style.position = 'absolute';
    // rate: Time Base n | d
    label(b, 246, y0 + 4, 'rate', 'tiny');
    const den = (TIME_BASE_DENOMINATORS as readonly number[]).filter((x) => x !== STEP_ADVANCE);
    const rateTip = 'Rate: one step every n / d of a whole note (M’s Time Base): 1|16 sixteenths, 1|4 quarters, 4|4 a bar, 8|4 two bars. Type "1/8" for both.';
    const both = (t: string) => {
      const m = /^(\d+)\s*\/\s*(\d+)$/.exec(t.trim());
      if (!m || !den.includes(Number(m[2])) || Number(m[1]) < 1 || Number(m[1]) > 99) return false;
      s.setTrajectory(slot, { rateNum: Number(m[1]), rateDen: Number(m[2]) });
      return true;
    };
    this.parts.push(
      new Numerical(b, 272, y0, 20, 14, { get: () => d().rateNum, set: (x) => s.setTrajectory(slot, { rateNum: x }), min: 1, max: 99, chars: '/', entry: (t) => (t.includes('/') ? both(t) : /^\d+$/.test(t) && (s.setTrajectory(slot, { rateNum: Math.max(1, Math.min(99, Number(t))) }), true)), title: rateTip }),
      new Numerical(b, 296, y0, 20, 14, { get: () => d().rateDen, set: (x) => s.setTrajectory(slot, { rateDen: x }), values: den, chars: '/', entry: (t) => (t.includes('/') ? both(t) : den.includes(Number(t)) && (s.setTrajectory(slot, { rateDen: Number(t) }), true)), title: rateTip }),
    );
    el('div', 'label', b, [292, y0 + 3, 4, 10], '|');
    // traversal
    this.parts.push(
      new Selector(b, 320, y0, 74, 14, {
        label: `Trajectory ${slot + 1}: how it moves through the values`,
        fontSize: 8,
        options: () => TRAJ_MODES.map((m) => ({ value: m.id, text: m.name })),
        value: () => d().mode,
        onChange: (v) => s.setTrajectory(slot, { mode: v as Trajectory['mode'] }),
      }),
    );
    // step / smooth
    this.toggle(
      b,
      398,
      y0,
      64,
      () => (d().smooth ? 'Smooth' : 'Step'),
      () => d().smooth,
      () => s.setTrajectory(slot, { smooth: !d().smooth }),
      'Step: jump to each value. Smooth: glide from one value to the next across the step (not for Positions).',
      () => targetInfo(d().target).kind !== 'enumerated',
    );
    // values (built per length) + bar strip
    const box = el('div', '', b, [0, y0 + 18, 470, 40]);
    box.style.position = 'absolute';
    const bars = svgEl(MAX_TRAJECTORY_VALUES * BOX, 12, '');
    const strip = el('div', '', b, [VX, y0 + 36, MAX_TRAJECTORY_VALUES * BOX, 12]);
    strip.style.position = 'absolute';
    strip.appendChild(bars);
    strip.title = 'The values as bars; the inverted bar is the current step (a line marks the glide when Smooth)';
    // edit buttons
    const btn = (x: number, yy: number, t: string, tip: string, f: () => void) => {
      const e = el('div', 'btn', b, [x, y0 + yy, 22, 13], t);
      e.style.fontSize = '9px';
      e.title = tip;
      e.setAttribute('role', 'button');
      e.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        f();
      });
    };
    const row = { sig: '', box, values: [] as Numerical[], bars, extra, extraSig: '', focus: -1 };
    this.rows.push(row);
    btn(420, 18, '+', 'Add a value after the selected one (a copy of it); also + while a value is selected', () => this.add(slot));
    btn(443, 18, '−', 'Remove the selected value (or the last); also Delete while a value is selected', () => s.removeTrajectoryValue(slot, row.focus >= 0 ? row.focus : d().values.length - 1));
    btn(420, 33, 'Clr', 'Clear: one value left', () => s.clearTrajectory(slot));
    btn(443, 33, '×2', 'Duplicate the sequence (up to 16 values)', () => s.duplicateTrajectory(slot));
    label(b, 4, y0 + 22, 'val', 'tiny');
  }

  private add(slot: number): void {
    const row = this.rows[slot];
    const at = this.ctx.s.addTrajectoryValue(slot, row.focus);
    if (at >= 0) row.focus = at;
    this.refocus(slot);
  }

  /** after the value boxes are rebuilt, keep keyboard focus on the same index */
  private pendingFocus: { slot: number; i: number } | null = null;
  private refocus(slot: number): void {
    this.pendingFocus = { slot, i: this.rows[slot].focus };
  }

  /** (Re)build a slot's value boxes when its length or target changes. */
  private buildValues(slot: number): void {
    const s = this.ctx.s;
    const row = this.rows[slot];
    const d = this.def(slot);
    const info = targetInfo(d.target);
    row.box.innerHTML = '';
    row.values = d.values.map((_, i) => {
      const n = new Numerical(row.box, VX + i * BOX, 0, BOX - 1, 15, {
        get: () => this.def(slot).values[i] ?? 0,
        set: (x) => s.setTrajectoryValue(slot, i, x),
        min: info.min,
        max: info.max,
        format: d.target.kind === 'position' && d.target.variable === 'patternGroup' ? (x) => 'abcdef'[Math.round(x) - 1] ?? String(x) : undefined,
        bigStep: info.max - info.min > 30 ? 10 : 1,
        title: `Trajectory ${slot + 1}, value ${i + 1} (${info.name}${info.unit ? ', ' + info.unit : ''}: ${info.min}…${info.max}). Type it, drag it, ↑ ↓; ← → next value; + adds, Delete removes.`,
        onKey: (e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            const j = Math.max(0, Math.min(this.def(slot).values.length - 1, i + (e.key === 'ArrowLeft' ? -1 : 1)));
            row.values[j]?.el.focus();
            row.focus = j;
            return true;
          }
          if (e.key === 'Delete' || e.key === 'Backspace') {
            row.focus = Math.max(0, i - 1);
            s.removeTrajectoryValue(slot, i);
            this.refocus(slot);
            return true;
          }
          if (e.key === '+' || e.key === '=' || e.key === 'Insert') {
            row.focus = i;
            this.add(slot);
            return true;
          }
          return false;
        },
      });
      n.el.addEventListener('focus', () => (row.focus = i));
      return n;
    });
  }

  private buildExtra(slot: number): void {
    const s = this.ctx.s;
    const row = this.rows[slot];
    const d = () => this.def(slot);
    row.extra.innerHTML = '';
    const t = d().target;
    if (t.kind === 'cc') {
      label(row.extra, 0, 3, 'ch', 'tiny');
      new Numerical(row.extra, 12, 0, 22, 14, {
        get: () => (d().target as { channel: number }).channel,
        set: (x) => s.setTrajectory(slot, { target: { kind: 'cc', channel: x, cc: (d().target as { cc: number }).cc } }),
        min: 1,
        max: 16,
        title: 'M Output Channel (1–16) the controller is sent on — its device and MIDI channel come from Midi Assignment',
      });
      label(row.extra, 38, 3, 'cc', 'tiny');
      new Numerical(row.extra, 50, 0, 26, 14, {
        get: () => (d().target as { cc: number }).cc,
        set: (x) => s.setTrajectory(slot, { target: { kind: 'cc', channel: (d().target as { channel: number }).channel, cc: x } }),
        min: 0,
        max: 127,
        title: 'Controller number (0–127), e.g. 74 = filter cutoff on many synths',
      });
    } else if (targetInfo(t).perVoice) {
      for (let v = 0; v < 4; v++) {
        const e = el('div', 'num', row.extra, [v * 14, 0, 13, 14], String(v + 1));
        e.style.fontSize = '9px';
        e.title = `Voice ${v + 1}: affected by this Trajectory`;
        e.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          const voices = [...d().voices];
          voices[v] = !voices[v];
          s.setTrajectory(slot, { voices });
        });
        e.classList.toggle('inv', d().voices[v]);
      }
    }
  }

  update(): void {
    const s = this.ctx.s;
    if (this.builtFor !== s.comp) this.build();
    for (let slot = 0; slot < TRAJECTORY_SLOTS; slot++) {
      const row = this.rows[slot];
      const d = this.def(slot);
      const info = targetInfo(d.target);
      const sig = `${d.values.length}|${tkey(d.target)}`;
      if (row.sig !== sig) {
        row.sig = sig;
        this.buildValues(slot);
      }
      const esig = JSON.stringify([d.target, d.voices]);
      if (row.extraSig !== esig) {
        row.extraSig = esig;
        this.buildExtra(slot);
      }
      row.values.forEach((n) => n.update());
      // where it is: the current step's box is marked; bars show the values
      const live = s.trajLive[slot] && s.playing;
      const st = s.traj[slot];
      row.values.forEach((n, i) => n.el.classList.toggle('tstep', live && i === st.index));
      const span = info.max - info.min || 1;
      let g = '';
      d.values.forEach((v, i) => {
        const h = Math.max(1, Math.round(((v - info.min) / span) * 11));
        const cur = live && i === st.index;
        g += `<rect x="${i * BOX + 3}" y="${12 - h}" width="${BOX - 7}" height="${h}" fill="${cur ? 'var(--activity)' : 'var(--ink)'}"/>`;
      });
      if (live && d.smooth && info.kind !== 'enumerated' && st.end > st.start) {
        const now = s.scheduler.nowTick();
        const f = Math.max(0, Math.min(1, (now - st.start) / (st.end - st.start)));
        const v = valueAt(d, st, now);
        const x = Math.round(st.index * BOX + BOX / 2 + f * (st.next - st.index) * BOX);
        const yy = 12 - Math.max(1, Math.round(((v - info.min) / span) * 11));
        g += `<rect x="${x - 2}" y="${yy}" width="5" height="1" fill="var(--activity)"/>`;
      }
      setSvg(row.bars, g);
      setTip(row.bars.parentElement!, `Trajectory ${slot + 1}: ${info.name}${live ? ` — step ${st.index + 1}/${d.values.length}, value ${st.value ?? '—'}` : ''} · ${stepTicks(d) / 96} beat(s) a step`);
    }
    if (this.pendingFocus) {
      const { slot, i } = this.pendingFocus;
      this.pendingFocus = null;
      const vals = this.rows[slot].values;
      vals[Math.max(0, Math.min(vals.length - 1, i))]?.el.focus();
    }
    this.parts.forEach((p) => p.update());
  }
}
