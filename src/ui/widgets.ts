/**
 * M's control vocabulary, rebuilt: the Numerical, the Range Bar, the Conducting Arrow, the
 * Picture Matrix and the window frame (S2 "The User Interface"; S1 ch.2).
 */
import { arrowFromAngle, rotateArrow } from '../engine/conducting';
import type { ArrowDir } from '../engine/types';
import { clamp, el, localPoint, place, svgEl, setSvg, trackDrag, view } from './dom';
import { arrowIcon, ICON } from './icons';
import type { Area } from './palette';

// ---------------------------------------------------------------------------- Numerical

export interface NumericalOpts {
  get: () => number;
  /** final = pointer released; alt/shift = modifier keys at press */
  set: (v: number, info: { final: boolean; alt: boolean; shift: boolean }) => void;
  min?: number;
  max?: number;
  /** if given, the numerical steps through these values */
  values?: readonly number[];
  format?: (v: number) => string;
  /** pixels of vertical drag per unit (slider gesture) */
  pxPerUnit?: number;
  /** with alt held, show changes but only commit on release (Output Length) */
  deferWithAlt?: boolean;
  /** Intercept a click (e.g. Hold/Do selection); return true if consumed. */
  intercept?: (ev: PointerEvent) => boolean;
  cls?: string;
  title?: string;
}

/** Shared "last numerical value" for Shift-click copying (S1 Appendix A). */
export const numericalMemory = { last: null as number | null };

export class Numerical {
  el: HTMLDivElement;
  private temp: number | null = null;
  constructor(
    parent: HTMLElement,
    x: number,
    y: number,
    w: number,
    h: number,
    private o: NumericalOpts,
  ) {
    this.el = el('div', 'num ' + (o.cls ?? ''), parent, [x, y, w, h]);
    if (o.title) this.el.title = o.title;
    this.el.addEventListener('pointerdown', (ev) => this.down(ev));
    this.update();
  }

  private clampV(v: number): number {
    const o = this.o;
    if (o.values) {
      // snap to nearest legal value
      let best = o.values[0];
      for (const x of o.values) if (Math.abs(x - v) < Math.abs(best - v)) best = x;
      return best;
    }
    return clamp(Math.round(v), o.min ?? -Infinity, o.max ?? Infinity);
  }

  private stepFrom(v: number, n: number): number {
    const o = this.o;
    if (o.values) {
      const i = o.values.indexOf(v);
      const j = clamp((i < 0 ? 0 : i) + n, 0, o.values.length - 1);
      return o.values[j];
    }
    return clamp(v + n, o.min ?? -Infinity, o.max ?? Infinity);
  }

  private down(ev: PointerEvent): void {
    ev.stopPropagation();
    ev.preventDefault();
    if (this.o.intercept?.(ev)) return;
    const alt = ev.altKey;
    const shift = ev.shiftKey;
    const defer = alt && !!this.o.deferWithAlt;
    const commit = (v: number, final: boolean) => {
      v = this.clampV(v);
      if (defer && !final) {
        this.temp = v;
        this.update();
        return;
      }
      this.temp = null;
      numericalMemory.last = v;
      this.o.set(v, { final, alt, shift });
      this.update();
    };
    if (shift && numericalMemory.last !== null) {
      commit(numericalMemory.last, true);
      return;
    }
    const p = localPoint(this.el, ev);
    const dir = p.y < p.h / 2 ? 1 : -1;
    const start = this.o.get();
    let cur = this.stepFrom(start, dir);
    commit(cur, false);
    let slider = false;
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(function rep(this: unknown) {
      cur = self.stepFrom(cur, dir);
      commit(cur, false);
      timer = setTimeout(rep, 70);
    }, 380);
    const self = this;
    this.el.classList.add('inv');
    trackDrag(
      ev,
      this.el,
      ({ dy }) => {
        const outside = Math.abs(dy) > p.h / 2 + 2;
        if (outside && !slider) {
          slider = true;
          if (timer) clearTimeout(timer);
          timer = null;
          document.body.classList.add('dragging');
        }
        if (slider) {
          const ppu = this.o.pxPerUnit ?? (this.o.values ? 6 : 3);
          const units = Math.round(-dy / ppu);
          if (this.o.values) {
            const i0 = Math.max(0, this.o.values.indexOf(start));
            cur = this.o.values[clamp(i0 + units, 0, this.o.values.length - 1)];
          } else cur = this.clampV(start + units);
          commit(cur, false);
        }
      },
      () => {
        if (timer) clearTimeout(timer);
        document.body.classList.remove('dragging');
        this.el.classList.remove('inv');
        commit(this.temp ?? cur, true);
      },
    );
  }

  update(): void {
    const v = this.temp ?? this.o.get();
    const t = this.o.format ? this.o.format(v) : String(v);
    if (this.el.textContent !== t) this.el.textContent = t;
  }
}

// ---------------------------------------------------------------------------- Range bar

export interface RangeOpts {
  min: number;
  max: number;
  get: () => [number, number];
  set: (lo: number, hi: number, final: boolean) => void;
  /** optional current-value indicator line */
  cur?: () => number | null;
  fill?: 'grey' | 'black' | 'hatch';
}

export class RangeBar {
  el: HTMLDivElement;
  private fill: HTMLDivElement;
  private cur: HTMLDivElement;
  constructor(
    parent: HTMLElement,
    x: number,
    y: number,
    w: number,
    h: number,
    private o: RangeOpts,
  ) {
    this.el = el('div', 'range', parent, [x, y, w, h]);
    this.fill = el('div', 'fill ' + (o.fill === 'black' ? 'inv' : o.fill === 'hatch' ? 'fill-hatch' : 'fill-grey'), this.el);
    this.cur = el('div', 'cur', this.el);
    this.el.addEventListener('pointerdown', (ev) => this.down(ev));
    this.update();
  }

  private valueAt(ev: PointerEvent): number {
    const p = localPoint(this.el, ev);
    const t = clamp(p.x / Math.max(1, p.w), 0, 1);
    return Math.round(this.o.min + t * (this.o.max - this.o.min));
  }

  private down(ev: PointerEvent): void {
    ev.stopPropagation();
    ev.preventDefault();
    const v0 = this.valueAt(ev);
    this.o.set(v0, v0, false);
    this.update();
    trackDrag(
      ev,
      this.el,
      ({ ev: e }) => {
        const v1 = this.valueAt(e);
        this.o.set(Math.min(v0, v1), Math.max(v0, v1), false);
        this.update();
      },
      ({ ev: e }) => {
        const v1 = this.valueAt(e);
        this.o.set(Math.min(v0, v1), Math.max(v0, v1), true);
        this.update();
      },
    );
  }

  update(): void {
    const [lo, hi] = this.o.get();
    const span = this.o.max - this.o.min || 1;
    const w = parseFloat(this.el.style.width) - 2;
    const a = ((lo - this.o.min) / span) * w;
    const b = ((hi - this.o.min) / span) * w;
    this.fill.style.left = Math.round(a) + 'px';
    this.fill.style.width = Math.max(1, Math.round(b - a) + 1) + 'px';
    const c = this.o.cur?.();
    if (c === null || c === undefined) this.cur.style.display = 'none';
    else {
      this.cur.style.display = '';
      this.cur.style.left = Math.round(((c - this.o.min) / span) * w) + 'px';
    }
  }
}

// ---------------------------------------------------------------------------- Conducting arrow

export interface ArrowOpts {
  get: () => { enabled: boolean; dir: ArrowDir };
  toggle: () => void;
  setDir: (d: ArrowDir) => void;
  /** Continuous-conducting capable (Velocity Range, Legato) */
  continuous?: {
    get: () => { on: boolean; dirs: ArrowDir[]; voices: boolean[] };
    setOn: (on: boolean) => void;
    setDir: (v: number, d: ArrowDir) => void;
    toggleVoice: (v: number) => void;
  };
  blink?: () => boolean;
}

/**
 * Click toggles; press-and-hold rotates; dragging outside the box points it at the mouse.
 * Continuous-capable arrows switch to four little per-voice arrows when dragged far.
 */
export class ConductArrow {
  el: HTMLDivElement;
  private svg: SVGSVGElement;
  private bricks: HTMLDivElement[] = [];
  constructor(
    parent: HTMLElement,
    x: number,
    y: number,
    private o: ArrowOpts,
    private h = 13,
  ) {
    this.el = el('div', 'arrow', parent, [x, y, o.continuous ? 19 : 13, h]);
    this.svg = svgEl(o.continuous ? 17 : 11, h - 2, '');
    this.el.appendChild(this.svg);
    if (o.continuous) {
      for (let v = 0; v < 4; v++) {
        const b = el('div', '', this.el, [12, 1 + v * ((h - 2) / 4), 5, (h - 2) / 4 - 1]);
        b.style.position = 'absolute';
        this.bricks.push(b);
      }
    }
    this.el.addEventListener('pointerdown', (ev) => this.down(ev));
    this.update();
  }

  private down(ev: PointerEvent): void {
    ev.stopPropagation();
    ev.preventDefault();
    const o = this.o;
    const p = localPoint(this.el, ev);
    // in continuous mode: clicks on the brick column toggle voices, on a mini arrow rotate it
    if (o.continuous?.get().on && o.get().enabled) {
      const v = clamp(Math.floor(((p.y - 1) / (this.h - 2)) * 4), 0, 3);
      if (p.x >= 11) {
        o.continuous.toggleVoice(v);
        this.update();
        return;
      }
    }
    let rotated = false;
    let dragged = false;
    let holdTimer: ReturnType<typeof setTimeout> | null = setTimeout(function rot() {
      rotated = true;
      if (!o.get().enabled) o.toggle();
      o.setDir(rotateArrow(o.get().dir));
      if (o.continuous?.get().on) o.continuous.get().dirs.forEach((_, v) => o.continuous!.setDir(v, o.get().dir));
      self.update();
      holdTimer = setTimeout(rot, 420);
    }, 420);
    const self = this;
    const cx = p.w / 2;
    const cy = p.h / 2;
    trackDrag(
      ev,
      this.el,
      ({ dx, dy }) => {
        const mx = p.x + dx - cx;
        const my = p.y + dy - cy;
        const dist = Math.hypot(mx, my);
        if (dist < 10) return;
        dragged = true;
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = null;
        if (!o.get().enabled) o.toggle();
        const d = arrowFromAngle(mx, my);
        o.setDir(d);
        if (o.continuous) {
          const far = dist > 34;
          if (far !== o.continuous.get().on) o.continuous.setOn(far);
          if (far) for (let v = 0; v < 4; v++) o.continuous.setDir(v, d);
        }
        this.update();
      },
      () => {
        if (holdTimer) clearTimeout(holdTimer);
        if (!rotated && !dragged) o.toggle();
        this.update();
      },
    );
  }

  update(): void {
    const a = this.o.get();
    this.el.classList.toggle('on', a.enabled);
    this.el.classList.toggle('blink', !!this.o.blink?.());
    const c = a.enabled ? 'var(--paper)' : 'var(--ink)';
    const cont = this.o.continuous?.get();
    if (cont?.on && a.enabled) {
      const rowH = (this.h - 2) / 4;
      let inner = '';
      cont.dirs.forEach((d, v) => {
        inner += `<g transform="translate(0 ${v * rowH}) scale(${rowH / 11})">${arrowIcon(d, 11, c)}</g>`;
      });
      setSvg(this.svg, inner);
      this.bricks.forEach((b, v) => {
        b.style.background = cont.voices[v] ? 'var(--paper)' : 'transparent';
        b.style.border = '1px solid ' + (a.enabled ? 'var(--paper)' : 'var(--ink)');
        b.style.display = '';
      });
    } else {
      const s = Math.min(11, this.h - 2);
      setSvg(this.svg, `<g transform="translate(0 ${(this.h - 2 - s) / 2})">${arrowIcon(a.dir, s, c)}</g>`);
      this.bricks.forEach((b) => (b.style.display = 'none'));
    }
  }
}

// ---------------------------------------------------------------------------- Picture matrix

export interface MatrixItem<T> {
  value: T;
  icon: string; // svg markup or text
  title?: string;
}

/** Pop out a row of icons next to `anchor`; release on one to choose it (S1 ch.2). */
export function pictureMatrix<T>(anchor: HTMLElement, ev: PointerEvent, items: MatrixItem<T>[], current: T, pick: (v: T) => void): void {
  ev.preventDefault();
  ev.stopPropagation();
  const screen = document.getElementById('screen')!;
  const ar = anchor.getBoundingClientRect();
  const sr = screen.getBoundingClientRect();
  const s = view.scale;
  const pm = el('div', 'pmatrix', screen);
  place(pm, (ar.right - sr.left) / s + 1, (ar.top - sr.top) / s);
  const cells = items.map((it) => {
    const c = el('div', 'cell', pm);
    c.innerHTML = it.icon;
    if (it.title) c.title = it.title;
    if (it.value === current) c.classList.add('hot');
    return c;
  });
  let hot = items.findIndex((i) => i.value === current);
  const target = anchor;
  try {
    target.setPointerCapture(ev.pointerId);
  } catch {
    /* ignore */
  }
  const move = (e: PointerEvent) => {
    hot = -1;
    cells.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top - 6 && e.clientY < r.bottom + 6;
      c.classList.toggle('hot', inside);
      if (inside) hot = i;
    });
  };
  const up = () => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    pm.remove();
    if (hot >= 0) pick(items[hot].value);
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
}

// ---------------------------------------------------------------------------- Window frame

export interface WindowOpts {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  closable?: boolean;
  /** six-box position selector in the title bar */
  positions?: {
    count?: number;
    edit: () => number;
    active: () => number;
    marked?: () => boolean[];
    select: (i: number, ev: PointerEvent) => void;
    mark?: (i: number) => void;
  };
  onClose?: () => void;
  inverse?: boolean;
  /** functional area, for the colour palette (see palette.ts) */
  area?: Area;
}

let zTop = 100;

/** An M-style window: title in a tab with a slanted edge, optional close triangle. */
export class MWindow {
  el: HTMLDivElement;
  body: HTMLDivElement;
  titleEl: HTMLDivElement;
  private possel: HTMLDivElement | null = null;
  private posCells: HTMLDivElement[] = [];
  constructor(
    parent: HTMLElement,
    public o: WindowOpts,
  ) {
    this.el = el('div', 'mwin' + (o.inverse ? ' inverse' : ''), parent, [o.x, o.y, o.w, o.h]);
    this.el.dataset.win = o.id;
    if (o.area) this.el.dataset.area = o.area;
    const tb = el('div', 'titlebar', this.el);
    if (o.closable) {
      const c = el('div', 'close', tb);
      c.appendChild(svgEl(13, 15, `<polygon points="3.5,3.5 11.5,3.5 3.5,11.5" fill="var(--paper)" stroke="var(--ink)"/>`));
      c.title = 'Close';
      c.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.close();
      });
    }
    this.titleEl = el('div', 'title', tb, undefined, o.title);
    const slant = el('div', 'slant', tb);
    slant.appendChild(svgEl(16, 16, `<polygon points="0,0 1,0 16,15.5 0,15.5" fill="var(--paper)"/><line x1="0.5" y1="0" x2="16" y2="15.5" stroke="var(--ink)"/>`));
    el('div', 'titlefill', tb);
    if (o.positions) {
      const n = o.positions.count ?? 6;
      this.possel = el('div', 'possel', tb);
      for (let i = 0; i < n; i++) {
        const c = el('div', 'p', this.possel);
        c.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          const startY = ev.clientY;
          trackDrag(ev, c, () => {}, ({ ev: e }) => {
            // pull-down marks the Position (S1 ch.17)
            if ((e.clientY - startY) / view.scale > 8 && o.positions!.mark) o.positions!.mark(i);
            else o.positions!.select(i, ev);
            this.updatePositions();
          });
        });
        this.posCells.push(c);
      }
    }
    this.body = el('div', 'body', this.el);
    this.body.style.height = o.h - 18 + 'px';
    tb.addEventListener('pointerdown', (ev) => this.dragStart(ev));
    this.el.addEventListener(
      'pointerdown',
      (ev) => {
        this.front();
        // Cmd-click brings a window to the front without acting (S1 Appendix A)
        if (ev.metaKey && !ev.altKey) {
          ev.stopPropagation();
          ev.preventDefault();
        }
      },
      true,
    );
    this.updatePositions();
  }

  front(): void {
    this.el.style.zIndex = String(++zTop);
  }

  private dragStart(ev: PointerEvent): void {
    this.front();
    const x0 = this.o.x;
    const y0 = this.o.y;
    trackDrag(ev, ev.currentTarget as Element, ({ dx, dy }) => {
      this.o.x = Math.round(x0 + dx);
      this.o.y = Math.max(16, Math.round(y0 + dy));
      place(this.el, this.o.x, this.o.y);
    });
  }

  updatePositions(): void {
    const ps = this.o.positions;
    if (!ps) return;
    const e = ps.edit();
    const a = ps.active();
    const m = ps.marked?.() ?? [];
    this.posCells.forEach((c, i) => {
      c.classList.toggle('edit', i === e);
      c.classList.toggle('active', i === a);
      c.classList.toggle('marked', !!m[i]);
    });
  }

  setTitle(t: string): void {
    if (this.titleEl.textContent !== t) this.titleEl.textContent = t;
  }

  show(): void {
    this.el.classList.remove('hidden');
    this.front();
  }

  close(): void {
    this.el.classList.add('hidden');
    this.o.onClose?.();
  }

  get open(): boolean {
    return !this.el.classList.contains('hidden');
  }
}

export { ICON };
