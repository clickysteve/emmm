/**
 * Choice bar of Variable Positions (S2 "choice bar"): click selects (Shift quantizes,
 * Hold/Do collects), drag onto another swaps, Alt-drag copies, double-click opens the
 * edit window. The active Position is drawn inverted.
 */
import { NUM_POSITIONS } from '../engine/constants';
import type { VariableName } from '../engine/types';
import { EDITOR_FOR, type UiContext } from './context';
import { LOCK_DIMS, type LockDim } from '../extended/extended';
import { el, setTip, svgEl, setSvg, trackDrag } from './dom';
import { iconSvg } from './icons';
import { miniFor } from './minis';

const LOCKABLE = new Set<string>(LOCK_DIMS.map((d) => d.id));

/** The Variable whose Positions were clicked last (⌥[ ⌥] step through its Positions). */
export const lastVariable = { v: 'patternGroup' as VariableName };

export class VariableChoice {
  cells: HTMLDivElement[] = [];
  private svgs: SVGSVGElement[] = [];
  private lastClick = { t: 0, i: -1 };
  private drawn: string[] = [];
  private flashEls: HTMLDivElement[][] = [];
  /** EXTENDED: a padlock on the bar when Mutation may not change this Variable */
  private lock: HTMLDivElement;
  private frame: HTMLDivElement;
  private lockKey = '';

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
    // lock marks (Extended): a padlock badge for a value lock, a dotted frame for "Positions"
    const W = vertical ? cw : NUM_POSITIONS * (cw - 1) + 1;
    const H = vertical ? NUM_POSITIONS * (ch - 1) + 1 : ch;
    this.frame = el('div', 'lockframe hidden', parent, [x - 2, y - 2, W + 4, H + 4]);
    this.lock = el('div', 'lockbadge hidden', parent, [x - 5, y - 5, 12, 12]);
    this.lock.innerHTML = iconSvg('lock', 10, 10);
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
      // cycle-restart blink marks, one per voice row (cheap to toggle every frame)
      const fl: HTMLDivElement[] = [];
      for (let v = 0; v < 4; v++) {
        const f = el('div', '', c, [0, Math.round(1 + v * ((ch - 4) / 4)), 5, Math.max(2, Math.round((ch - 4) / 4))]);
        f.style.position = 'absolute';
        f.className = 'cbrick';
        f.style.display = 'none';
        fl.push(f);
      }
      this.flashEls.push(fl);
    }
  }

  private down(ev: PointerEvent, i: number): void {
    ev.preventDefault();
    lastVariable.v = this.variable;
    const s = this.ctx.s;
    const now = ev.timeStamp; // the press's own time (robust when the screen is busy)
    const dbl = this.lastClick.i === i && now - this.lastClick.t < 350;
    this.lastClick = { t: now, i };
    if (dbl) {
      const ed = EDITOR_FOR[this.variable];
      if (ed) this.ctx.openEditor(ed, { position: i, variable: this.variable, from: this.cells[i] });
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

  private updateLock(): void {
    const ext = this.ctx.s.comp.extended;
    const values = ext.enabled && LOCKABLE.has(this.variable) && ext.locks.dims[this.variable as LockDim];
    const positions = ext.enabled && this.variable !== 'soundChoice' && ext.locks.dims.positions;
    const key = `${values}|${positions}`;
    if (key === this.lockKey) return;
    this.lockKey = key;
    this.lock.classList.toggle('hidden', !values);
    this.frame.classList.toggle('hidden', !positions);
    setTip(this.lock, 'Locked: Mutation leaves these values alone (Extended window)');
  }

  update(): void {
    this.updateLock();
    const s = this.ctx.s;
    const comp = s.comp;
    const active = (comp[this.variable] as { active: number }).active;
    const pending = s.hold?.pending.positions[this.variable];
    const flashNow = this.ctx.now();
    const isCyc = this.variable === 'accent' || this.variable === 'legato' || this.variable === 'rhythm';
    for (let i = 0; i < NUM_POSITIONS; i++) {
      const on = i === active;
      const c = on ? 'var(--paper)' : 'var(--ink)';
      this.cells[i].classList.toggle('active', on);
      this.cells[i].classList.toggle('blink', pending === i);
      let flash: boolean[] = [];
      if (this.variable === 'patternGroup' && on) flash = this.ctx.flash.pattern.map((t) => t > flashNow);
      const key = `${s.rev}|${on}|${flash.join()}`;
      if (this.drawn[i] !== key) {
        this.drawn[i] = key;
        let inner = miniFor(comp, this.variable, i, this.cw - 2, this.ch - 2, c, flash);
        const marked = (comp[this.variable] as { marked?: boolean[] }).marked?.[i];
        if (marked) inner += `<text x="${this.cw - 4}" y="7" font-size="8" text-anchor="end" fill="${c}">*</text>`;
        setSvg(this.svgs[i], inner);
      }
      // the first step of each restarting cycle blinks (S1 ch.7 "Cyclic Variables Blink")
      const fl = this.flashEls[i];
      for (let v = 0; v < 4; v++) {
        const show = isCyc && on && !comp.options.noCyclicBlinking && this.ctx.flash.cycle[this.variable as 'accent'][v] > flashNow;
        const d = show ? '' : 'none';
        if (fl[v].style.display !== d) fl[v].style.display = d;
      }
    }
  }
}
