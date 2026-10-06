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
  /** typed text → value (default: a decimal number); null = not valid */
  parse?: (text: string) => number | null;
  /** take typed text completely (compound values such as Time Base n / d); true = done,
   * false = not valid */
  entry?: (text: string) => boolean;
  /** step for Shift + ↑ / ↓ and Page Up / Down (default 10; 3 values in a value list) */
  bigStep?: number;
  /** characters accepted while typing, besides digits (default "-.") */
  chars?: string;
  /** the text an edit starts from (default: the shown text, or the number if it shows none) */
  editText?: (v: number) => string;
  /** extra keys while selected (not typing), e.g. ← → between neighbours; true = used */
  onKey?: (e: KeyboardEvent) => boolean;
}

/** Shared "last numerical value" for Shift-click copying (S1 Appendix A). */
export const numericalMemory = { last: null as number | null };

/** The control that currently owns typing (a number box or range bar being edited). */
export const typing = { active: null as { cancel(): void } | null };

/**
 * Direct entry shared by number boxes and range bars: the control keeps its look; typed
 * characters replace its text (with a caret) until Enter commits or Escape cancels.
 */
class TextEntry {
  text = '';
  /** the first key replaces the shown value */
  replace = true;
  constructor(
    private host: HTMLElement,
    private accept: (ch: string) => boolean,
  ) {}
  start(initial: string, replace: boolean): void {
    this.text = initial;
    this.replace = replace;
    this.host.classList.add('editing');
  }
  get on(): boolean {
    return this.host.classList.contains('editing');
  }
  stop(): void {
    this.host.classList.remove('editing');
  }
  /** a typed character; false if refused */
  type(ch: string): boolean {
    if (!this.accept(ch)) return false;
    if (this.replace) this.text = '';
    this.replace = false;
    if (this.text.length < 12) this.text += ch;
    return true;
  }
  backspace(): void {
    this.text = this.replace ? '' : this.text.slice(0, -1);
    this.replace = false;
  }
}

/**
 * A clicked number box or range bar owns the keyboard only while you are working with it:
 * it lets go after 3 s without a key (or at once with Escape or a click elsewhere), so M's
 * performance keys — Return to Stop, digits for Slideshows — are never taken for long.
 * While you are typing a value it holds on until Return or Escape.
 */
const SELECT_MS = 3000;
function holdSelection(e: HTMLElement, typing: () => boolean): void {
  const h = e as HTMLElement & { _idle?: ReturnType<typeof setTimeout> };
  if (h._idle) clearTimeout(h._idle);
  h._idle = setTimeout(() => {
    if (document.activeElement === e && !typing()) e.blur();
  }, SELECT_MS);
}

/** Brief "no" flash for invalid typing (the value stays as it was). */
function refuse(e: HTMLElement): void {
  e.classList.remove('refused');
  void e.offsetWidth;
  e.classList.add('refused');
  setTimeout(() => e.classList.remove('refused'), 300);
}

export class Numerical {
  el: HTMLDivElement;
  private temp: number | null = null;
  private entryState: TextEntry;
  private textEl: HTMLSpanElement | null = null;
  constructor(
    parent: HTMLElement,
    x: number,
    y: number,
    w: number,
    h: number,
    private o: NumericalOpts,
  ) {
    this.el = el('div', 'num ' + (o.cls ?? ''), parent, [x, y, w, h]);
    if (o.title) this.el.title = o.title + ' — click, then type a number';
    this.el.addEventListener('pointerdown', (ev) => this.down(ev));
    // keyboard: click to select, then type a number (Enter = edit the current one);
    // ↑ ↓ step, Shift = bigger steps, Home / End = minimum / maximum
    this.el.tabIndex = -1;
    this.el.setAttribute('role', 'spinbutton');
    if (o.min !== undefined) this.el.setAttribute('aria-valuemin', String(o.values ? o.values[0] : o.min));
    if (o.max !== undefined) this.el.setAttribute('aria-valuemax', String(o.values ? o.values[o.values.length - 1] : o.max));
    const chars = o.chars ?? '-.';
    this.entryState = new TextEntry(this.el, (ch) => /[0-9]/.test(ch) || chars.includes(ch.toLowerCase()));
    this.el.addEventListener('keydown', (e) => this.key(e));
    this.el.addEventListener('blur', () => this.entryState.on && this.commitText(false));
    this.update();
  }

  /** Is the box being typed into? */
  get editing(): boolean {
    return this.entryState.on;
  }

  /** Start direct entry (keyboard, or from code / tests). */
  beginEdit(first?: string): void {
    typing.active?.cancel();
    const v = this.o.get();
    const shown = this.o.format ? this.o.format(v) : String(v);
    this.entryState.start(this.o.editText ? this.o.editText(v) : shown || String(v), true);
    typing.active = { cancel: () => this.cancelEdit() };
    if (first) this.entryState.type(first);
    this.render();
  }

  cancelEdit(): void {
    if (!this.entryState.on) return;
    this.entryState.stop();
    if (typing.active) typing.active = null;
    if (document.activeElement === this.el) holdSelection(this.el, () => this.entryState.on);
    this.textEl = null;
    this.el.textContent = '';
    // boxes drawn as pictures (note values) redraw their picture
    delete this.el.dataset.v;
    this.update();
  }

  private commitText(alt: boolean): void {
    const t = this.entryState.replace ? '' : this.entryState.text.trim();
    this.cancelEdit();
    if (t === '') return; // nothing typed: keep the value
    if (this.o.entry) {
      if (!this.o.entry(t)) refuse(this.el);
      this.update();
      return;
    }
    const parsed = this.o.parse ? this.o.parse(t) : t === '' || !/^-?(\d+\.?\d*|\.\d+)$/.test(t) ? null : Number(t);
    if (parsed === null || !Number.isFinite(parsed)) {
      refuse(this.el);
      return;
    }
    this.apply(this.clampV(parsed), alt);
  }

  private apply(v: number, alt = false): void {
    numericalMemory.last = v;
    this.o.set(v, { final: true, alt, shift: false });
    this.update();
  }

  private key(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey) {
      if (this.entryState.on) e.stopPropagation();
      return;
    }
    const k = e.key;
    if (this.entryState.on) {
      // while typing, every key belongs to the box (no shortcuts, no Snapshot letters)
      e.stopPropagation();
      if (k === 'Enter') this.commitText(e.altKey);
      else if (k === 'Escape') this.cancelEdit();
      else if (k === 'Tab') this.commitText(false);
      else if (k === 'Backspace' || k === 'Delete') (this.entryState.backspace(), this.render());
      else if (k.length === 1 && !this.entryState.type(k)) refuse(this.el);
      else this.render();
      e.preventDefault();
      return;
    }
    // selected (not typing): numbers, Enter, arrows, Home/End and Escape belong to the box;
    // everything else (Space, Return-less letters, Tab …) still reaches emmm
    const o = this.o;
    if (o.onKey?.(e)) {
      e.stopPropagation();
      e.preventDefault();
      holdSelection(this.el, () => this.entryState.on);
      return;
    }
    const big = o.bigStep ?? (o.values ? 3 : 10);
    let handled = true;
    if (k.length === 1 && /[0-9]/.test(k)) this.beginEdit(k);
    else if (k.length === 1 && (o.chars ?? '-.').includes(k.toLowerCase()) && k !== ' ') this.beginEdit(k);
    else if (k === 'Enter') this.beginEdit();
    else if (k === 'ArrowUp' || k === 'ArrowDown') this.apply(this.stepFrom(o.get(), (k === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? big : 1)));
    else if (k === 'PageUp' || k === 'PageDown') this.apply(this.stepFrom(o.get(), (k === 'PageUp' ? 1 : -1) * big));
    else if (k === 'Home') this.apply(o.values ? o.values[0] : this.clampV(o.min ?? o.get()));
    else if (k === 'End') this.apply(o.values ? o.values[o.values.length - 1] : this.clampV(o.max ?? o.get()));
    else if (k === 'Escape') this.el.blur();
    else handled = false;
    if (handled) {
      e.stopPropagation();
      e.preventDefault();
      holdSelection(this.el, () => this.entryState.on);
    }
  }

  /** Show the typed text with a caret. */
  private render(): void {
    if (!this.entryState.on) return;
    if (!this.textEl) {
      this.el.textContent = '';
      this.textEl = el('span', 'entrytext', this.el);
    }
    this.textEl.textContent = this.entryState.text;
    this.textEl.classList.toggle('whole', this.entryState.replace);
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
    if (this.entryState.on) this.commitText(false);
    this.el.focus({ preventScroll: true }); // selected: typing a number now edits it
    holdSelection(this.el, () => this.entryState.on);
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
    if (this.entryState.on) return; // the typed text stays until Enter / Escape
    const v = this.temp ?? this.o.get();
    const t = this.o.format ? this.o.format(v) : String(v);
    if (this.el.textContent !== t) this.el.textContent = t;
    this.el.setAttribute('aria-valuenow', String(v));
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
  /** one value (the top of the bar), not a range: Mutation strength, Robot jump */
  single?: boolean;
  /** accessible name (also the tooltip, if the bar has none) */
  label?: string;
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
    // keyboard: click, then type "40-100" (or one number); ↑ ↓ move it, Shift = by 10
    this.el.tabIndex = -1;
    this.el.setAttribute('role', 'slider');
    if (o.label) this.el.setAttribute('aria-label', o.label);
    this.entryState = new TextEntry(this.el, (ch) => /[0-9]/.test(ch) || (!o.single && /[-– ,]/.test(ch)));
    this.el.addEventListener('keydown', (e) => this.key(e));
    this.el.addEventListener('blur', () => this.entryState.on && this.commitText());
    this.update();
  }

  private entryState: TextEntry;
  private entryEl: HTMLDivElement | null = null;

  get editing(): boolean {
    return this.entryState.on;
  }

  private text(): string {
    const [lo, hi] = this.o.get();
    return this.o.single ? String(hi) : `${lo}-${hi}`;
  }

  beginEdit(first?: string): void {
    typing.active?.cancel();
    this.entryState.start(this.text(), true);
    typing.active = { cancel: () => this.cancelEdit() };
    if (first) this.entryState.type(first);
    this.render();
  }

  cancelEdit(): void {
    if (!this.entryState.on) return;
    this.entryState.stop();
    if (typing.active) typing.active = null;
    if (document.activeElement === this.el) holdSelection(this.el, () => this.entryState.on);
    this.entryEl?.remove();
    this.entryEl = null;
  }

  private set(lo: number, hi: number): void {
    const o = this.o;
    hi = clamp(Math.round(hi), o.min, o.max);
    if (o.single) {
      // one value: only the top end moves (the bottom is fixed by the owner)
      o.set(o.get()[0], hi, true);
      this.update();
      return;
    }
    lo = clamp(Math.round(lo), o.min, o.max);
    if (lo > hi) [lo, hi] = [hi, lo];
    o.set(lo, hi, true);
    this.update();
  }

  private commitText(): void {
    const t = this.entryState.replace ? '' : this.entryState.text.trim();
    this.cancelEdit();
    if (!t) return;
    const m = /^(\d+)(?:\s*[-–, ]\s*(\d+))?$/.exec(t);
    if (!m || (this.o.single && m[2] !== undefined)) {
      refuse(this.el);
      return;
    }
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    this.set(a, b);
  }

  private key(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey) {
      if (this.entryState.on) e.stopPropagation();
      return;
    }
    const k = e.key;
    if (this.entryState.on) {
      e.stopPropagation();
      e.preventDefault();
      if (k === 'Enter' || k === 'Tab') this.commitText();
      else if (k === 'Escape') this.cancelEdit();
      else if (k === 'Backspace' || k === 'Delete') (this.entryState.backspace(), this.render());
      else if (k.length === 1 && !this.entryState.type(k)) refuse(this.el);
      else this.render();
      return;
    }
    const [lo, hi] = this.o.get();
    const d = e.shiftKey ? 10 : 1;
    let handled = true;
    if (k.length === 1 && /[0-9]/.test(k)) this.beginEdit(k);
    else if (k === 'Enter') this.beginEdit();
    else if (k === 'ArrowUp' || k === 'ArrowRight' || k === 'ArrowDown' || k === 'ArrowLeft') {
      const dir = k === 'ArrowUp' || k === 'ArrowRight' ? d : -d;
      if (this.o.single) this.set(lo, hi + dir);
      else {
        // move the whole range, keeping its width
        const sh = clamp(dir, this.o.min - lo, this.o.max - hi);
        this.set(lo + sh, hi + sh);
      }
    } else if (k === 'Home' || k === 'End') {
      if (this.o.single) this.set(lo, k === 'Home' ? this.o.min : this.o.max);
      else this.set(k === 'Home' ? this.o.min : this.o.max - (hi - lo), k === 'Home' ? this.o.min + (hi - lo) : this.o.max);
    } else if (k === 'Escape') this.el.blur();
    else handled = false;
    if (handled) {
      e.stopPropagation();
      e.preventDefault();
      holdSelection(this.el, () => this.entryState.on);
    }
  }

  private render(): void {
    if (!this.entryState.on) return;
    if (!this.entryEl) this.entryEl = el('div', 'entrytext rangeentry', this.el);
    this.entryEl.textContent = this.entryState.text;
    this.entryEl.classList.toggle('whole', this.entryState.replace);
  }

  private valueAt(ev: PointerEvent): number {
    const p = localPoint(this.el, ev);
    const t = clamp(p.x / Math.max(1, p.w), 0, 1);
    return Math.round(this.o.min + t * (this.o.max - this.o.min));
  }

  private down(ev: PointerEvent): void {
    ev.stopPropagation();
    ev.preventDefault();
    if (this.entryState.on) this.commitText();
    this.el.focus({ preventScroll: true });
    holdSelection(this.el, () => this.entryState.on);
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
    this.el.setAttribute('aria-valuetext', this.o.single ? String(hi) : `${lo} to ${hi}`);
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

/** Hooks for the app: a window that appears must be drawn at once (main.ts sets this). */
export const windowEvents = { shown: () => {} };

/** The window most recently brought to the front (its keyboard context is active). */
export const windowFocus = { front: null as MWindow | null };

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
    windowFocus.front = this;
  }

  /** Briefly highlight the title tab (Windows menu: shows which window came forward). */
  flashTitle(): void {
    this.titleEl.classList.remove('flash-front');
    void this.titleEl.offsetWidth; // restart the animation
    this.titleEl.classList.add('flash-front');
    setTimeout(() => this.titleEl.classList.remove('flash-front'), 700);
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
    windowEvents.shown();
  }

  close(): void {
    this.el.classList.add('hidden');
    if (windowFocus.front === this) windowFocus.front = null;
    this.o.onClose?.();
  }

  get open(): boolean {
    return !this.el.classList.contains('hidden');
  }
}

export { ICON };
