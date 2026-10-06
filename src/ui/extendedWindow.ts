/**
 * EXTENDED windows — emmm's continuation of M, clearly labelled as not part of Classic M:
 *
 *   Extended     mode switch, Seed / Reroll, Locks, Mutation, A/B states, MIDI clock input
 *   MIDI Learn   map controllers and keys to emmm controls (an application preference)
 *   CC Cycles    (below) cyclic distributions driving MIDI controllers
 *
 * The Performance Feedback inspector lives in feedbackWindow.ts.
 */
import { allLearnTargets, LOCK_DIMS, sourceLabel, targetKey, targetLabel, type LearnTarget } from '../extended/extended';
import type { UiContext } from './context';
import { el, label, localPoint, setSvg, setTip, svgEl, trackDrag } from './dom';
import { iconSvg } from './icons';
import { keyLabel } from './keys';
import { Selector } from './selector';
import { MWindow, Numerical, RangeBar } from './widgets';

const SYNC_TEXT = { internal: 'INTERNAL', waiting: 'WAITING', running: 'RUNNING', lost: 'LOST' } as const;
const SYNC_TIP = {
  internal: 'Internal: emmm keeps its own tempo',
  waiting: 'External: waiting for MIDI clock (or for Start)',
  running: 'External: following the incoming MIDI clock',
  lost: 'External: the clock stopped arriving — emmm holds the last tempo until it returns',
} as const;

export class ExtendedWindow {
  win: MWindow;
  private parts: { update(): void }[] = [];
  private builtFor: object | null = null;
  openCc: (() => void) | null = null;
  openLearn: (() => void) | null = null;
  constructor(private ctx: UiContext, parent: HTMLElement) {
    this.win = new MWindow(parent, { id: 'extended', title: 'Extended', x: 150, y: 20, w: 300, h: 300, closable: true });
  }

  private toggle(x: number, y: number, w: number, get: () => boolean, set: (v: boolean) => void, text: string, title = '', what = 'extended'): HTMLDivElement {
    const d = el('div', 'num', this.win.body, [x, y, w, 14]);
    d.style.fontSize = '9px';
    d.style.justifyContent = 'flex-start';
    d.style.paddingLeft = '3px';
    if (title) d.title = title;
    d.setAttribute('role', 'switch');
    d.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      set(!get());
      this.ctx.s.changed(what);
    });
    this.parts.push({ update: () => ((d.textContent = (get() ? '☒ ' : '☐ ') + text), d.classList.toggle('inv', get()), d.setAttribute('aria-checked', String(get()))) });
    return d;
  }

  private button(x: number, y: number, w: number, text: string, title: string, f: () => void): HTMLDivElement {
    const d = el('div', 'btn', this.win.body, [x, y, w, 14], text);
    d.style.fontSize = '9px';
    d.title = title;
    d.setAttribute('role', 'button');
    d.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      f();
    });
    return d;
  }

  private build(): void {
    const s = this.ctx.s;
    const ext = s.comp.extended;
    const b = this.win.body;
    b.innerHTML = '';
    this.parts = [];
    this.builtFor = s.comp;
    const note = el('div', 'label small', b, [6, 3, 288, 20]);
    note.style.whiteSpace = 'normal';
    note.style.lineHeight = '10px';
    note.innerHTML = 'Not part of Classic M — emmm’s ideas for what M might have become. Classic note generation is never changed.';
    this.toggle(6, 25, 112, () => ext.enabled, (v) => (ext.enabled = v), 'Extended on', 'Switch the Extended features on for this document');
    this.button(122, 25, 84, 'MIDI Learn…', 'Map controllers and keys to emmm controls', () => this.openLearn?.());
    this.button(210, 25, 84, 'CC Cycles…', 'Cyclic patterns of MIDI controller values, one per Voice', () => this.openCc?.());
    const off = el('div', 'label tiny', b, [6, 43, 288, 8]);
    this.parts.push({ update: () => (off.textContent = ext.enabled ? '' : 'Extended is off: the controls below are inactive until you switch it on.') });

    // seed / reroll
    label(b, 6, 56, '<b>Seed</b>');
    const seed = el('input', 'mtext', b, [36, 53, 74, 15]);
    seed.style.position = 'absolute';
    seed.inputMode = 'numeric';
    seed.title = 'The seed every random choice starts from at Start. Same document + same seed = the same performance. Type a number and press Return.';
    seed.setAttribute('aria-label', 'Seed');
    seed.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') seed.blur();
    });
    seed.addEventListener('focus', () => seed.select());
    seed.addEventListener('change', () => {
      const n = Number(seed.value.trim());
      if (Number.isFinite(n) && n >= 0) s.setSeed(n);
      seed.value = String(s.comp.seed);
    });
    this.parts.push({ update: () => document.activeElement !== seed && seed.value !== String(s.comp.seed) && (seed.value = String(s.comp.seed)) });
    this.button(114, 53, 84, 'Reroll', `Reroll (${keyLabel('reroll')}). New Variation: a new seed — the same settings played with different random choices. Locked Voices keep theirs. Patterns are untouched.`, () => ext.enabled && s.reroll());

    // locks
    label(b, 6, 76, '<b>Locks</b>');
    label(b, 44, 77, 'keep these while Mutate and Reroll change the rest', 'tiny');
    label(b, 6, 89, 'Voices', 'small');
    for (let v = 0; v < 4; v++) {
      const d = el('div', 'num', b, [44 + v * 20, 86, 18, 14]);
      d.title = `Lock Voice ${v + 1}: Mutation leaves it alone and Reroll keeps its random choices`;
      d.setAttribute('role', 'switch');
      d.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        ext.locks.voices[v] = !ext.locks.voices[v];
        s.changed('locks');
      });
      this.parts.push({
        update: () => {
          const on = ext.locks.voices[v];
          const key = String(on);
          if (d.dataset.v !== key) {
            d.innerHTML = on ? iconSvg('lock', 10, 12, 'var(--paper)') : String(v + 1);
            d.dataset.v = key;
          }
          d.classList.toggle('inv', on);
          d.setAttribute('aria-checked', String(on));
          d.setAttribute('aria-label', `Lock Voice ${v + 1}`);
        },
      });
    }
    LOCK_DIMS.forEach((dim, i) => {
      const x = 6 + (i % 4) * 72;
      const y = 104 + Math.floor(i / 4) * 16;
      this.toggle(x, y, 70, () => ext.locks.dims[dim.id], (v) => (ext.locks.dims[dim.id] = v), dim.label, `Lock ${dim.help}`, 'locks');
    });

    // mutation
    label(b, 6, 158, '<b>Mutation</b>');
    label(b, 62, 159, 'subtle', 'tiny');
    const bar = new RangeBar(b, 92, 156, 120, 12, {
      min: 0,
      max: 100,
      get: () => [0, ext.mutation.amount],
      set: (_lo, hi, final) => {
        ext.mutation.amount = hi;
        if (final) s.setMutationAmount(hi);
      },
      fill: 'black',
      single: true,
      label: 'Mutation strength',
    });
    bar.el.title = 'Mutation strength: subtle (small, related changes) ←→ chaos (big transformations)';
    this.parts.push(bar);
    label(b, 216, 159, 'chaos', 'tiny');
    const amt = el('div', 'label small', b, [240, 159, 20, 10]);
    this.parts.push({ update: () => (amt.textContent = String(ext.mutation.amount)) });
    this.button(254, 155, 40, 'Mutate', `Mutate (${keyLabel('mutate')}): change the active settings by this amount (not the Patterns’ notes). Locks are respected. ${keyLabel('undo')} undoes it.`, () => ext.enabled && s.mutateNow());

    // A/B
    label(b, 6, 180, '<b>A / B</b>');
    const ab = (x: number, slot: 'a' | 'b') => {
      const cap = this.button(x, 177, 62, `Capture ${slot.toUpperCase()}`, `Capture ${slot.toUpperCase()} (${keyLabel(slot === 'a' ? 'captureA' : 'captureB')}): store the current performance state (Positions, cycles, tempo, Voice settings)`, () => ext.enabled && s.abCapture(slot));
      const rec = this.button(x + 64, 177, 24, slot.toUpperCase(), `Recall ${slot.toUpperCase()} (${keyLabel(slot === 'a' ? 'recallA' : 'recallB')}; safe while playing)`, () => ext.enabled && s.abRecall(slot));
      this.parts.push({
        update: () => {
          rec.classList.toggle('on', ext.ab.last === slot && !!ext.ab[slot]);
          rec.style.opacity = ext.ab[slot] ? '1' : '0.4';
          cap.style.opacity = ext.enabled ? '1' : '0.6';
        },
      });
    };
    ab(44, 'a');
    ab(140, 'b');
    this.button(236, 177, 58, 'A ⇄ B', 'Switch between A and B', () => ext.enabled && s.abToggle());

    // MIDI clock input
    label(b, 6, 202, '<b>MIDI clock input</b>');
    const st = el('div', 'num', b, [210, 199, 84, 14]);
    st.style.fontSize = '8px';
    this.parts.push({
      update: () => {
        const k = s.clockStatus();
        const t = SYNC_TEXT[k] + (k === 'running' || k === 'lost' ? ` ${s.extStatus.bpm.toFixed(1)}` : '');
        if (st.textContent !== t) st.textContent = t;
        st.classList.toggle('inv', k === 'running');
        st.classList.toggle('blink', k === 'lost');
        setTip(st, SYNC_TIP[k]);
      },
    });
    this.toggle(6, 216, 110, () => ext.clockIn.enabled, (v) => (ext.clockIn.enabled = v), 'follow clock', 'Follow an external MIDI clock (24 pulses per quarter note) for tempo', 'clock');
    this.toggle(120, 216, 120, () => ext.clockIn.transport, (v) => (ext.clockIn.transport = v), 'Start/Stop/Cont', 'Follow external Start, Stop and Continue messages', 'clock');
    this.parts.push(
      new Selector(b, 6, 234, 234, 14, {
        label: 'MIDI clock input: which input to follow',
        options: () => [{ value: '*', text: 'any input' }, ...s.midi.inputs().map((o) => ({ value: o.id, text: o.name }))],
        value: () => ext.clockIn.port,
        onChange: (v) => ((ext.clockIn.port = v), s.changed('clock')),
        missingText: () => 'input not connected',
      }),
    );
    const status = el('div', 'label small', b, [6, 256, 288, 22]);
    status.style.whiteSpace = 'normal';
    status.style.lineHeight = '10px';
    status.setAttribute('aria-live', 'polite');
    this.parts.push({ update: () => status.textContent !== s.status && (status.textContent = s.status) });
  }

  update(): void {
    if (this.builtFor !== this.ctx.s.comp) this.build();
    this.parts.forEach((p) => p.update());
  }
}

// ---------------------------------------------------------------------------- MIDI Learn

/** MIDI Learn (Extended): mappings are an application preference, kept by this browser. */
export class LearnWindow {
  win: MWindow;
  private list: HTMLDivElement;
  private note: HTMLDivElement;
  private target: LearnTarget = { kind: 'variable', variable: 'noteDensity' };
  private sig = '';
  private rows: { update(): void }[] = [];
  private picker: Selector;
  constructor(private ctx: UiContext, parent: HTMLElement) {
    const s = ctx.s;
    this.win = new MWindow(parent, { id: 'learn', title: 'MIDI Learn', x: 200, y: 40, w: 300, h: 300, closable: true, onClose: () => s.cancelLearn() });
    const b = this.win.body;
    const intro = el('div', 'label small', b, [6, 3, 288, 20]);
    intro.style.whiteSpace = 'normal';
    intro.style.lineHeight = '10px';
    intro.innerHTML = 'Extended. Choose a control, press <b>Learn</b>, then move a knob or press a key. A controller sweeps a Variable’s Positions; a key steps or triggers.';
    const options = allLearnTargets().flatMap((g) => g.targets.map((t) => ({ value: targetKey(t), text: `${g.group.split(' (')[0]} · ${targetLabel(t)}` })));
    const byKey = new Map(allLearnTargets().flatMap((g) => g.targets.map((t) => [targetKey(t), t] as const)));
    this.picker = new Selector(b, 6, 27, 200, 14, {
      label: 'Control to learn',
      options: () => options,
      value: () => targetKey(this.target),
      onChange: (v) => (this.target = byKey.get(v) ?? this.target),
    });
    const learn = el('div', 'btn', b, [212, 27, 82, 14], 'Learn');
    learn.style.fontSize = '9px';
    learn.title = 'Learn: then move a controller or press a key (Escape cancels)';
    learn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (s.learnArmed) s.cancelLearn();
      else s.armLearn(this.target, null);
    });
    this.rows.push({
      update: () => {
        const armed = !!s.learnArmed && s.learnArmed.replace === null;
        learn.classList.toggle('on', armed);
        learn.classList.toggle('blink', armed);
        learn.textContent = armed ? 'Listening…' : 'Learn';
      },
    });
    label(b, 6, 47, 'Control', 'tiny');
    label(b, 150, 47, 'Controller / key', 'tiny');
    this.list = el('div', 'box', b, [6, 56, 288, 186]);
    this.list.style.overflowY = 'auto';
    this.list.style.background = 'var(--paper)';
    this.list.setAttribute('role', 'list');
    this.note = el('div', 'label small', b, [6, 246, 288, 22]);
    this.note.style.whiteSpace = 'normal';
    this.note.style.lineHeight = '10px';
    this.note.setAttribute('aria-live', 'polite');
    const off = el('div', 'label tiny', b, [6, 270, 288, 8]);
    this.rows.push({ update: () => (off.textContent = s.comp.extended.enabled ? '' : 'Extended is off: switch it on (Extended window) to use these mappings.') });
  }

  private renderList(): void {
    const s = this.ctx.s;
    this.list.innerHTML = '';
    if (!s.learn.length) {
      const e = el('div', 'label small', this.list, [6, 6, 270, 30], 'No mappings yet.');
      e.style.whiteSpace = 'normal';
    }
    s.learn.forEach((m, i) => {
      const y = 2 + i * 15;
      const row = el('div', '', this.list, [0, y, 270, 14]);
      row.style.position = 'absolute';
      row.setAttribute('role', 'listitem');
      label(row, 4, 3, targetLabel(m.target), 'small');
      label(row, 146, 3, sourceLabel(m.source), 'small');
      const re = el('div', 'btn', row, [206, 0, 40, 13], 'Learn');
      re.style.fontSize = '8px';
      re.title = `Learn a different controller for ${targetLabel(m.target)}`;
      re.dataset.row = String(i);
      re.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (s.learnArmed?.replace === i) s.cancelLearn();
        else s.armLearn(m.target, i);
      });
      const x = el('div', 'btn', row, [250, 0, 16, 13], '×');
      x.style.fontSize = '9px';
      x.title = `Remove the mapping for ${targetLabel(m.target)}`;
      x.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        s.removeLearn(i);
      });
    });
  }

  update(): void {
    const s = this.ctx.s;
    const sig = s.learn.map((m) => targetKey(m.target) + sourceLabel(m.source)).join('|');
    if (sig !== this.sig) {
      this.sig = sig;
      this.renderList();
    }
    this.list.querySelectorAll<HTMLDivElement>('[data-row]').forEach((d) => {
      const armed = s.learnArmed?.replace === Number(d.dataset.row);
      d.classList.toggle('on', armed);
      d.classList.toggle('blink', armed);
    });
    if (this.note.textContent !== s.learnNote) this.note.textContent = s.learnNote;
    this.picker.update();
    this.rows.forEach((r) => r.update());
  }
}

// ---------------------------------------------------------------------------- CC Cycles

const SX = 9;
const LY = 6;

/** Edit window for EXTENDED CC Cycles — same grid gestures as M's Cyclic Editor. */
export class CcCyclesWindow {
  win: MWindow;
  editPos = 0;
  private grids: SVGSVGElement[] = [];
  private parts: { update(): void }[] = [];
  private drawnKey = '';
  constructor(private ctx: UiContext, parent: HTMLElement) {
    const s = ctx.s;
    this.win = new MWindow(parent, {
      id: 'cccycles',
      title: 'CC Cycles',
      x: 170,
      y: 70,
      w: 300,
      h: 262,
      closable: true,
      positions: {
        edit: () => this.editPos,
        active: () => s.comp.extended.ccCycles.active,
        select: (i, ev) => {
          this.editPos = i;
          if (ev.altKey) s.comp.extended.ccCycles.active = i;
          s.changed('cc');
        },
      },
    });
    const b = this.win.body;
    const note = el('div', 'label tiny', b, [4, 2, 290, 8]);
    note.textContent = 'EXTENDED · CC before each note · alt-click box = active';
    for (let v = 0; v < 4; v++) {
      const y0 = 14 + v * 58;
      label(b, 3, y0 + 9, String(v + 1)).style.fontSize = '12px';
      label(b, 3, y0 + 26, 'CC', 'tiny');
      this.parts.push(
        new Numerical(b, 2, y0 + 34, 26, 14, {
          get: () => this.voice(v).cc,
          set: (x) => {
            this.voice(v).cc = x;
            s.changed('cc');
          },
          min: -1,
          max: 127,
          format: (x) => (x < 0 ? 'off' : String(x)),
          title: 'Controller number (off = none)',
        }),
      );
      const area = el('div', '', b, [32, y0, SX * 16 + 16, 4 * LY + 22]);
      area.style.position = 'absolute';
      const svg = svgEl(SX * 16 + 16, 4 * LY + 22, '');
      area.appendChild(svg);
      this.grids.push(svg);
      area.addEventListener('pointerdown', (ev) => this.down(ev, v, area));
    }
    label(b, 216, 16, 'level → value', 'tiny');
    for (let lv = 4; lv >= 0; lv--) {
      const y = 28 + (4 - lv) * 16;
      label(b, 220, y + 3, `${lv} =`, 'small');
      this.parts.push(
        new Numerical(b, 240, y, 34, 14, {
          get: () => s.comp.extended.ccCycles.values[lv],
          set: (x) => {
            s.comp.extended.ccCycles.values[lv] = x;
            s.changed('cc');
          },
          min: 0,
          max: 127,
        }),
      );
    }
    this.parts.push({ update: () => this.draw() });
  }

  private voice(v: number) {
    return this.ctx.s.comp.extended.ccCycles.positions[this.editPos][v];
  }

  private down(ev: PointerEvent, v: number, area: HTMLElement): void {
    ev.preventDefault();
    const s = this.ctx.s;
    const at = (e: PointerEvent) => {
      const p = localPoint(area, e);
      return { step: Math.round((p.x - 8) / SX), level: Math.max(0, Math.min(4, Math.round(4 - (p.y - 3) / LY))), y: p.y };
    };
    const a = at(ev);
    const cyc = this.voice(v).cycle;
    if (a.y > 4 * LY + 6) {
      const n = Math.max(1, Math.min(16, a.step + 1));
      while (cyc.length < n) cyc.push({ lo: 1, hi: 1 });
      cyc.length = n;
      s.changed('cc');
      return;
    }
    if (a.step < 0 || a.step >= cyc.length) return;
    cyc[a.step] = { lo: a.level, hi: a.level };
    s.changed('cc');
    trackDrag(ev, area, ({ ev: e }) => {
      const b2 = at(e);
      if (b2.step === a.step) cyc[a.step] = { lo: Math.min(a.level, b2.level), hi: Math.max(a.level, b2.level) };
      else for (let k = Math.max(0, Math.min(a.step, b2.step)); k <= Math.min(cyc.length - 1, Math.max(a.step, b2.step)); k++) cyc[k] = { lo: a.level, hi: a.level };
      s.changed('cc');
    });
  }

  private draw(): void {
    const s = this.ctx.s;
    const key = `${s.rev}|${this.editPos}`;
    if (key === this.drawnKey) return;
    this.drawnKey = key;
    this.grids.forEach((g, v) => {
      const cyc = this.voice(v).cycle;
      const ox = 8;
      const oy = 3;
      let inner = '';
      for (let lv = 0; lv <= 4; lv++) inner += `<line x1="${ox}" y1="${oy + (4 - lv) * LY + 0.5}" x2="${ox + SX * 15}" y2="${oy + (4 - lv) * LY + 0.5}" stroke="var(--dim)" stroke-dasharray="1 1"/>`;
      for (let st = 0; st < 16; st++) {
        const x = ox + st * SX + 0.5;
        const on = st < cyc.length;
        inner += `<line x1="${x}" y1="${oy}" x2="${x}" y2="${oy + 4 * LY}" stroke="var(--ink)" stroke-dasharray="${on ? '0' : '1 2'}"/>`;
        inner += `<text x="${x}" y="${oy + 4 * LY + 10}" font-size="6" text-anchor="middle" font-family="Silkscreen">${st + 1}</text>`;
        if (st === cyc.length - 1) inner += `<rect x="${x - 4}" y="${oy + 4 * LY + 3}" width="9" height="9" fill="none" stroke="var(--ink)"/>`;
        if (on) {
          const c = cyc[st];
          for (let lv = c.lo; lv <= c.hi; lv++) inner += `<rect x="${x - 2.5}" y="${oy + (4 - lv) * LY - 2}" width="5" height="5" fill="var(--ink)"/>`;
          if (c.hi > c.lo) inner += `<rect x="${x - 1}" y="${oy + (4 - c.hi) * LY}" width="2" height="${(c.hi - c.lo) * LY}" fill="var(--ink)"/>`;
        }
      }
      setSvg(g, inner);
    });
  }

  update(): void {
    this.win.updatePositions();
    this.parts.forEach((p) => p.update());
  }
}
