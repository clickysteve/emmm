/**
 * Choice bar of Variable Positions (S2 "choice bar"): click selects (Shift quantizes,
 * Hold/Do collects), drag onto another swaps, Alt-drag copies, double-click opens the
 * edit window. The active Position is drawn inverted.
 */
import { NUM_POSITIONS } from '../engine/constants';
import type { VariableName } from '../engine/types';
import { EDITOR_FOR, type UiContext } from './context';
import { el, svgEl, setSvg, trackDrag } from './dom';
import { miniFor } from './minis';

export class VariableChoice {
  cells: HTMLDivElement[] = [];
  private svgs: SVGSVGElement[] = [];
  private lastClick = { t: 0, i: -1 };

  constructor(
    private ctx: UiContext,
    parent: HTMLElement,
    public variable: VariableName,
    x: number,
    y: number,
    private cw: number,
    private ch: number,
    vertical = false,
  ) {
    for (let i = 0; i < NUM_POSITIONS; i++) {
      const cx = vertical ? x : x + i * (cw - 1);
      const cy = vertical ? y + i * (ch - 1) : y;
      const c = el('div', 'pos', parent, [cx, cy, cw, ch]);
      c.dataset.var = variable;
      c.dataset.pos = String(i);
      const s = svgEl(cw - 2, ch - 2, '');
      c.appendChild(s);
      this.svgs.push(s);
      this.cells.push(c);
      c.addEventListener('pointerdown', (ev) => this.down(ev, i));
    }
  }

  private down(ev: PointerEvent, i: number): void {
    ev.preventDefault();
    const s = this.ctx.s;
    const now = performance.now();
    const dbl = this.lastClick.i === i && now - this.lastClick.t < 350;
    this.lastClick = { t: now, i };
    if (dbl) {
      const ed = EDITOR_FOR[this.variable];
      if (ed) this.ctx.openEditor(ed, { position: i, variable: this.variable });
      return;
    }
    const shift = ev.shiftKey;
    const alt = ev.altKey;
    let over = i;
    trackDrag(
      ev,
      this.cells[i],
      ({ ev: e }) => {
        over = this.cellAt(e.clientX, e.clientY);
        this.cells.forEach((c, k) => c.classList.toggle('droptarget', k === over && k !== i));
      },
      ({ moved }) => {
        this.cells.forEach((c) => c.classList.remove('droptarget'));
        if (moved && over >= 0 && over !== i) {
          s.movePosition(this.variable, i, over, alt);
        } else if (!moved || over === i) {
          s.clickPosition(this.variable, i, { shift, alt });
        }
      },
    );
  }

  private cellAt(x: number, y: number): number {
    for (let k = 0; k < this.cells.length; k++) {
      const r = this.cells[k].getBoundingClientRect();
      if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return k;
    }
    return -1;
  }

  update(): void {
    const s = this.ctx.s;
    const comp = s.comp;
    const active = (comp[this.variable] as { active: number }).active;
    const pending = s.hold?.pending.positions[this.variable];
    const flashNow = this.ctx.now();
    for (let i = 0; i < NUM_POSITIONS; i++) {
      const on = i === active;
      const c = on ? '#fff' : '#000';
      this.cells[i].classList.toggle('active', on);
      this.cells[i].classList.toggle('blink', pending === i);
      let flash: boolean[] = [];
      if (this.variable === 'patternGroup' && on) flash = this.ctx.flash.pattern.map((t) => t > flashNow);
      let inner = miniFor(comp, this.variable, i, this.cw - 2, this.ch - 2, c, flash);
      if ((this.variable === 'accent' || this.variable === 'legato' || this.variable === 'rhythm') && on && !comp.options.noCyclicBlinking) {
        // the first step of each restarting cycle blinks
        const rh = (this.ch - 4) / 4;
        this.ctx.flash.cycle[this.variable].forEach((t, v) => {
          if (t > flashNow) inner += `<rect x="0" y="${Math.round(1 + v * rh)}" width="5" height="${Math.max(2, Math.round(rh))}" fill="${on ? '#fff' : '#000'}"/>`;
        });
      }
      const marked = (comp[this.variable] as { marked?: boolean[] }).marked?.[i];
      if (marked) inner += `<text x="${this.cw - 4}" y="7" font-size="8" text-anchor="end" fill="${c}">*</text>`;
      setSvg(this.svgs[i], inner);
    }
  }
}
