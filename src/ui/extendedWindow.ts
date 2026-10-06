/**
 * EXTENDED window: switch Extended mode on, MIDI clock input, MIDI Learn mappings.
 * Drawn in the same visual language, but clearly labelled as not part of Classic M.
 */
import { sourceLabel, targetLabel } from '../extended/extended';
import type { UiContext } from './context';
import { el, label, localPoint, setSvg, svgEl, trackDrag } from './dom';
import { MWindow, Numerical } from './widgets';

export class ExtendedWindow {
  win: MWindow;
  private parts: { update(): void }[] = [];
  private builtFor: object | null = null;
  private portSig = '';
  openCc: (() => void) | null = null;
  constructor(private ctx: UiContext, parent: HTMLElement) {
    this.win = new MWindow(parent, { id: 'extended', title: 'Extended', x: 150, y: 40, w: 300, h: 360, closable: true });
  }

  private toggle(x: number, y: number, w: number, get: () => boolean, set: (v: boolean) => void, text: string, title = ''): void {
    const d = el('div', 'num', this.win.body, [x, y, w, 14]);
    d.style.fontSize = '9px';
    d.style.justifyContent = 'flex-start';
    d.style.paddingLeft = '3px';
    d.title = title;
    d.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      set(!get());
      this.ctx.s.changed('extended');
    });
    this.parts.push({ update: () => ((d.textContent = (get() ? '☒ ' : '☐ ') + text), d.classList.toggle('inv', get())) });
  }

  private build(): void {
    const s = this.ctx.s;
    const ext = s.comp.extended;
    const b = this.win.body;
    b.innerHTML = '';
    this.parts = [];
    this.builtFor = s.comp;
    const note = el('div', 'label small', b, [6, 4, 288, 22]);
    note.style.whiteSpace = 'normal';
    note.style.lineHeight = '10px';
    note.innerHTML = 'Not part of Classic M — ideas for what M might have become. Nothing here changes how notes are generated.';
    this.toggle(6, 28, 140, () => ext.enabled, (v) => (ext.enabled = v), 'Extended mode on');
    const ccb = el('div', 'btn', b, [160, 28, 90, 14], 'CC Cycles…');
    ccb.style.fontSize = '9px';
    ccb.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.openCc?.();
    });
    label(b, 6, 50, '<b>MIDI clock input</b>');
    this.toggle(6, 62, 110, () => ext.clockIn.enabled, (v) => (ext.clockIn.enabled = v), 'follow clock', 'Follow an external MIDI clock (24 ppq) tempo');
    this.toggle(120, 62, 120, () => ext.clockIn.transport, (v) => (ext.clockIn.transport = v), 'Start/Stop/Cont', 'Follow external Start, Stop and Continue');
    const sel = el('select', 'mselect', b, [6, 80, 180, 14]);
    sel.style.position = 'absolute';
    sel.style.fontSize = '8px';
    for (const o of [{ id: '*', name: 'any input' }, ...s.midi.inputs()]) {
      const op = document.createElement('option');
      op.value = o.id;
      op.textContent = o.name;
      sel.appendChild(op);
    }
    sel.value = ext.clockIn.port;
    sel.addEventListener('change', () => ((ext.clockIn.port = sel.value), s.changed('extended')));
    sel.addEventListener('pointerdown', (e) => e.stopPropagation());
    const st = el('div', 'label small', b, [192, 83, 100, 10]);
    this.parts.push({ update: () => (st.textContent = ext.enabled && ext.clockIn.enabled ? (s.extStatus.bpm ? `${s.extStatus.bpm.toFixed(1)} bpm in` : 'waiting…') : '') });

    label(b, 6, 104, '<b>MIDI Learn</b>');
    label(b, 70, 105, 'click Learn, then move a knob or press a key', 'tiny');
    ext.learn.forEach((m, i) => {
      const col = i < 16 ? 0 : 1;
      const x = 6 + col * 146;
      const y = 116 + (i % 16) * 14;
      label(b, x, y + 3, targetLabel(m.target), 'small');
      const src = el('div', 'label tiny', b, [x + 64, y + 4, 46, 8]);
      const learn = el('div', 'btn', b, [x + 110, y, 32, 13], 'Learn');
      learn.style.fontSize = '8px';
      learn.title = 'Learn: then move a controller or press a key. Alt-click clears.';
      learn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (e.altKey) {
          m.source = null;
          if (s.learnArmed === i) s.learnArmed = null;
        } else s.learnArmed = s.learnArmed === i ? null : i;
        s.changed('learn');
      });
      this.parts.push({
        update: () => {
          src.textContent = sourceLabel(m.source);
          learn.classList.toggle('on', s.learnArmed === i);
          learn.classList.toggle('blink', s.learnArmed === i);
        },
      });
    });
  }

  update(): void {
    const s = this.ctx.s;
    const sig = s.midi.inputs().map((i) => i.id).join();
    if (this.builtFor !== s.comp || sig !== this.portSig) {
      this.portSig = sig;
      this.build();
    }
    this.parts.forEach((p) => p.update());
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
      for (let lv = 0; lv <= 4; lv++) inner += `<line x1="${ox}" y1="${oy + (4 - lv) * LY + 0.5}" x2="${ox + SX * 15}" y2="${oy + (4 - lv) * LY + 0.5}" stroke="#000" stroke-dasharray="1 1"/>`;
      for (let st = 0; st < 16; st++) {
        const x = ox + st * SX + 0.5;
        const on = st < cyc.length;
        inner += `<line x1="${x}" y1="${oy}" x2="${x}" y2="${oy + 4 * LY}" stroke="#000" stroke-dasharray="${on ? '0' : '1 2'}"/>`;
        inner += `<text x="${x}" y="${oy + 4 * LY + 10}" font-size="6" text-anchor="middle" font-family="Silkscreen">${st + 1}</text>`;
        if (st === cyc.length - 1) inner += `<rect x="${x - 4}" y="${oy + 4 * LY + 3}" width="9" height="9" fill="none" stroke="#000"/>`;
        if (on) {
          const c = cyc[st];
          for (let lv = c.lo; lv <= c.hi; lv++) inner += `<rect x="${x - 2.5}" y="${oy + (4 - lv) * LY - 2}" width="5" height="5" fill="#000"/>`;
          if (c.hi > c.lo) inner += `<rect x="${x - 1}" y="${oy + (4 - c.hi) * LY}" width="2" height="${(c.hi - c.lo) * LY}" fill="#000"/>`;
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
