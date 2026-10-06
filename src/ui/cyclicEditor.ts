/**
 * The Cyclic Editor (S1 ch.7 and ch.17): four editing grids (one per voice) of 16 steps ×
 * levels 0–4; the Rhythm / Legato / Accent buttons with vertical Position selectors; the global
 * Rhythm and Legato value tables; the Accent ↔ Velocity Range reminder diagram.
 */
import { MAX_CYCLE_STEPS, NUM_POSITIONS, NUM_VOICES } from '../engine/constants';
import type { Cycle } from '../engine/types';
import type { UiContext } from './context';
import { clamp, el, label, localPoint, svgEl, setSvg, trackDrag } from './dom';
import { MWindow, Numerical } from './widgets';

type CycVar = 'rhythm' | 'legato' | 'accent';
const RHYTHM_VALUES = [0.25, 0.33, 0.5, 0.66, 0.75, 1, 1.25, 1.33, 1.5, 1.66, 1.75, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 12, 16];

const SX = 9; // step spacing
const LY = 6; // level spacing
const GX = 18; // grid left
const GH = 4 * LY; // grid height (levels 0..4)
const BLOCK = 58;

export class CyclicEditor {
  win: MWindow;
  which: CycVar = 'accent';
  editPos = 0;
  private grids: SVGSVGElement[] = [];
  private names: Record<CycVar, HTMLDivElement> = {} as Record<CycVar, HTMLDivElement>;
  private sel: Record<CycVar, HTMLDivElement[]> = { rhythm: [], legato: [], accent: [] };
  private parts: { update(): void }[] = [];

  constructor(private ctx: UiContext, parent: HTMLElement) {
    const s = ctx.s;
    this.win = new MWindow(parent, { id: 'edit-cyclic', title: 'Cyclic Editor', x: 150, y: 60, w: 300, h: 256, closable: true, area: 'cyclic' });
    const b = this.win.body;
    for (let v = 0; v < NUM_VOICES; v++) {
      const y0 = 3 + v * BLOCK;
      label(b, 3, y0 + 9, String(v + 1)).style.fontSize = '12px';
      const area = el('div', '', b, [GX - 8, y0, SX * 16 + 16, GH + 22]);
      area.style.position = 'absolute';
      const svg = svgEl(SX * 16 + 16, GH + 22, '');
      area.appendChild(svg);
      this.grids.push(svg);
      area.addEventListener('pointerdown', (ev) => this.down(ev, v, area));
    }
    // right-hand panel: three variable buttons with vertical position selectors
    const vars: CycVar[] = ['rhythm', 'legato', 'accent'];
    vars.forEach((cv, k) => {
      const y0 = 3 + k * 78;
      const nm = el('div', 'btn', b, [170, y0, 52, 14], cv[0].toUpperCase() + cv.slice(1));
      nm.style.fontSize = '10px';
      nm.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        this.which = cv;
        s.changed('editor');
      });
      this.names[cv] = nm;
      for (let p = 0; p < NUM_POSITIONS; p++) {
        const c = el('div', 'box', b, [170, y0 + 16 + p * 9, 12, 10]);
        c.style.background = 'var(--paper)';
        c.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          const startY = ev.clientY;
          trackDrag(ev, c, () => {}, ({ ev: e }) => {
            if (e.clientX - ev.clientX > 12 || (e.clientY - startY) > 30) {
              s.comp[cv].marked[p] = !s.comp[cv].marked[p];
            } else {
              this.which = cv;
              this.editPos = p;
              if (ev.altKey) s.clickPosition(cv, p, { shift: ev.shiftKey });
            }
            s.changed('editor');
          });
        });
        this.sel[cv].push(c);
      }
      if (cv !== 'accent') {
        for (let lv = 4; lv >= 0; lv--) {
          const y = y0 + 4 + (4 - lv) * 14;
          label(b, 232, y + 3, `${lv} =`, 'small');
          this.parts.push(
            new Numerical(b, 252, y, 40, 13, {
              get: () => (cv === 'rhythm' ? s.comp.rhythmValues : s.comp.legatoValues)[lv],
              set: (x) => {
                (cv === 'rhythm' ? s.comp.rhythmValues : s.comp.legatoValues)[lv] = x;
                s.changed(cv);
              },
              ...(cv === 'rhythm' ? { values: RHYTHM_VALUES, format: (x: number) => String(x) } : { min: 1, max: 400 }),
              title: cv === 'rhythm' ? `Rhythm Value for level ${lv}: multiple of the Time Base (global)` : `Legato Value for level ${lv}: percent of the time to the next note (global)`,
            }),
          );
        }
      } else {
        // reminder: accent levels 1..4 are quarters of the Velocity Range
        const d = svgEl(70, 40, '');
        const box = el('div', '', b, [222, y0 + 14, 70, 40]);
        box.style.position = 'absolute';
        box.appendChild(d);
        setSvg(
          d,
          `<defs><pattern id="acg" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="1" height="1"/><rect x="1" y="1" width="1" height="1"/></pattern></defs>` +
            [1, 2, 3, 4].map((n, i) => `<text x="${14 + i * 14}" y="8" font-size="8" text-anchor="middle" font-family="Tiny5">${n}</text><rect x="${14 + i * 14}" y="10" width="1" height="6" fill="var(--ink)"/>`).join('') +
            `<rect x="4" y="16" width="62" height="1" fill="var(--ink)"/><rect x="14" y="14" width="42" height="5" fill="url(#acg)" stroke="var(--ink)" stroke-width="0.5"/><text x="35" y="32" font-size="8" text-anchor="middle" font-family="Tiny5">Vel Range</text>`,
        );
        label(b, 222, y0 + 58, '0 = silent', 'tiny');
      }
    });
    this.parts.push({ update: () => this.drawAll() });
  }

  private cycles(): Cycle[] {
    return this.ctx.s.comp[this.which].positions[this.editPos];
  }

  private get locked(): boolean {
    return this.ctx.s.isLocked(this.which, this.editPos);
  }

  private down(ev: PointerEvent, v: number, area: HTMLElement): void {
    ev.preventDefault();
    if (this.locked) return;
    const s = this.ctx.s;
    const at = (e: PointerEvent) => {
      const p = localPoint(area, e);
      return { step: Math.round((p.x - 8) / SX), level: clamp(Math.round(4 - (p.y - 3) / LY), 0, 4), y: p.y };
    };
    const a = at(ev);
    const cyc = this.cycles()[v];
    // step-number row: set the cycle length
    if (a.y > GH + 6) {
      const n = clamp(a.step + 1, 1, MAX_CYCLE_STEPS);
      while (cyc.length < n) cyc.push({ lo: 1, hi: 1 }); // new steps default to level 1 [DOC]
      cyc.length = n;
      s.changed(this.which);
      return;
    }
    if (a.step < 0 || a.step >= cyc.length) return;
    cyc[a.step] = { lo: a.level, hi: a.level };
    s.changed(this.which);
    trackDrag(ev, area, ({ ev: e }) => {
      const b = at(e);
      if (b.step === a.step) {
        cyc[a.step] = { lo: Math.min(a.level, b.level), hi: Math.max(a.level, b.level) };
      } else {
        // horizontal drag: a run of steps at the same level, within the cycle length
        const lo = Math.max(0, Math.min(a.step, b.step));
        const hi = Math.min(cyc.length - 1, Math.max(a.step, b.step));
        for (let k = lo; k <= hi; k++) cyc[k] = { lo: a.level, hi: a.level };
      }
      s.changed(this.which);
    });
  }

  private drawnKey = '';
  private drawAll(): void {
    const s = this.ctx.s;
    const cycles = this.cycles();
    const flashNow = this.ctx.now();
    const key = [s.rev, this.which, this.editPos, s.engine.state, ...s.engine.voices.map((v) => v.cycle[this.which]), ...this.ctx.flash.cycle[this.which].map((t) => t > flashNow)].join('|');
    if (key === this.drawnKey) return;
    this.drawnKey = key;
    const isActive = s.comp[this.which].active === this.editPos;
    cycles.forEach((cyc, v) => {
      let inner = '';
      const ox = 8;
      const oy = 3;
      // levels (horizontal lines) and steps (vertical lines)
      for (let lv = 0; lv <= 4; lv++) {
        inner += `<text x="2" y="${oy + (4 - lv) * LY + 2.5}" font-size="6" font-family="Silkscreen">${lv}</text>`;
        inner += `<text x="${ox + SX * 15 + 4}" y="${oy + (4 - lv) * LY + 2.5}" font-size="6" font-family="Silkscreen">${lv}</text>`;
        inner += `<line x1="${ox}" y1="${oy + (4 - lv) * LY + 0.5}" x2="${ox + SX * 15}" y2="${oy + (4 - lv) * LY + 0.5}" stroke="var(--dim)" stroke-dasharray="1 1"/>`;
      }
      for (let st = 0; st < 16; st++) {
        const x = ox + st * SX + 0.5;
        const on = st < cyc.length;
        inner += `<line x1="${x}" y1="${oy}" x2="${x}" y2="${oy + GH}" stroke="var(--ink)" stroke-dasharray="${on ? '0' : '1 2'}"/>`;
        inner += `<text x="${x}" y="${oy + GH + 10}" font-size="6" text-anchor="middle" font-family="Silkscreen"${on ? '' : ' fill="var(--dim)" fill-opacity="0.467"'}>${st + 1}</text>`;
        if (st === cyc.length - 1) inner += `<rect x="${x - 4}" y="${oy + GH + 3}" width="9" height="9" fill="none" stroke="var(--ink)"/>`;
        if (on) {
          const c = cyc[st];
          const y1 = oy + (4 - c.hi) * LY;
          const y2 = oy + (4 - c.lo) * LY;
          if (c.hi !== c.lo) inner += `<rect x="${x - 1.5}" y="${y1}" width="3" height="${y2 - y1}" fill="var(--ink)"/>`;
          for (let lv = c.lo; lv <= c.hi; lv++) inner += `<rect x="${x - 2.5}" y="${oy + (4 - lv) * LY - 2}" width="5" height="5" fill="var(--ink)"/>`;
        }
      }
      // where the cycle is now (emmm visual aid): the step just played
      const vr = s.engine.voices[v];
      if (isActive && s.engine.state !== 'stopped' && cyc.length > 0) {
        const cur = (vr.cycle[this.which] - 1 + cyc.length) % cyc.length;
        inner += `<rect x="${ox + cur * SX - 3.5}" y="${oy + GH + 13}" width="7" height="2" fill="var(--activity)"/>`;
      }
      if (this.ctx.flash.cycle[this.which][v] > flashNow && isActive) inner += `<rect x="${ox - 4}" y="0" width="2" height="${GH + 6}" fill="var(--activity)"/>`;
      setSvg(this.grids[v], inner);
    });
    (['rhythm', 'legato', 'accent'] as CycVar[]).forEach((cv) => {
      this.names[cv].classList.toggle('on', cv === this.which);
      this.sel[cv].forEach((c, p) => {
        const edit = cv === this.which && p === this.editPos;
        c.style.background = edit ? 'var(--ink)' : 'var(--paper)';
        c.style.borderBottomWidth = s.comp[cv].active === p ? '2px' : '1px';
        c.textContent = s.comp[cv].marked[p] ? '*' : '';
        c.style.color = edit ? 'var(--paper)' : 'var(--ink)';
        c.style.fontSize = '9px';
        c.style.lineHeight = '9px';
        c.style.textAlign = 'center';
      });
    });
  }

  update(): void {
    this.win.setTitle('Cyclic Editor');
    this.parts.forEach((p) => p.update());
  }

  openAt(which: CycVar, pos: number): void {
    this.which = which;
    this.editPos = pos;
    this.win.show();
    this.ctx.s.changed('editor');
  }
}
