/**
 * The emmm pop-up selector: one shared replacement for the browser's native <select>.
 *
 * Closed, it is a framed box showing the current choice (truncated with …) and a small
 * pop-up triangle, like a Macintosh pop-up menu. Open, it is a list drawn like emmm's
 * menus (same font, frame, shadow and highlight colour — so it follows the palette).
 *
 * Mouse: press to open, click a choice (or press-drag-release). Keyboard: focus it (Tab),
 * Space / Enter / ↓ / ↑ open; ↑ ↓ Home End and typed letters move; Enter chooses;
 * Escape closes without changing. Choices are read from a function each time the list
 * opens or `update()` runs, so devices that come and go are always current.
 */
import { el, view } from './dom';

export interface SelectorOption {
  value: string;
  text: string;
  disabled?: boolean;
  /** shown greyed, for a value that is set but not currently available */
  missing?: boolean;
}

export interface SelectorOpts {
  options: () => SelectorOption[];
  value: () => string;
  onChange: (value: string) => void;
  /** accessible name and tooltip */
  label: string;
  /** text shown when the value is not among the options (e.g. a disconnected device) */
  missingText?: (value: string) => string;
  /** font size of the closed box (logical px); the list uses the menu size */
  fontSize?: number;
}

let openSelector: Selector | null = null;
/** Close any open selector list (menus call this so only one pop-up is ever open). */
export function closeSelectors(): void {
  openSelector?.close(false);
}

export class Selector {
  el: HTMLDivElement;
  private text: HTMLSpanElement;
  private list: HTMLDivElement | null = null;
  private items: { opt: SelectorOption; el: HTMLDivElement }[] = [];
  private hi = -1;
  private typed = '';
  private typedAt = 0;
  private openedAt = 0;
  private openedByKey = false;

  constructor(
    parent: HTMLElement,
    x: number,
    y: number,
    w: number,
    h: number,
    private o: SelectorOpts,
  ) {
    this.el = el('div', 'msel', parent, [x, y, w, h]);
    this.el.tabIndex = 0;
    this.el.setAttribute('role', 'combobox');
    this.el.setAttribute('aria-haspopup', 'listbox');
    this.el.setAttribute('aria-expanded', 'false');
    this.el.setAttribute('aria-label', o.label);
    this.el.title = o.label;
    if (o.fontSize) this.el.style.fontSize = o.fontSize + 'px';
    this.text = el('span', 'msel-text', this.el);
    el('span', 'msel-arrow', this.el);
    this.el.addEventListener('pointerdown', (e) => this.down(e));
    this.el.addEventListener('keydown', (e) => this.key(e));
    this.el.addEventListener('blur', () => {
      // focus moving elsewhere closes the list (a click inside the list keeps focus here)
      setTimeout(() => this.list && document.activeElement !== this.el && this.close(false), 0);
    });
    this.update();
  }

  /** The option for the current value (or a stand-in when the value is unavailable). */
  private current(): SelectorOption {
    const v = this.o.value();
    const found = this.o.options().find((x) => x.value === v);
    if (found) return found;
    return { value: v, text: this.o.missingText ? this.o.missingText(v) : v, missing: true };
  }

  update(): void {
    const c = this.current();
    if (this.text.textContent !== c.text) this.text.textContent = c.text;
    this.el.classList.toggle('missing', !!c.missing);
    this.el.setAttribute('aria-valuetext', c.text);
    if (this.list) this.render(); // choices may have changed while open
  }

  get isOpen(): boolean {
    return !!this.list;
  }

  private down(e: PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.el.focus({ preventScroll: true });
    if (this.list) {
      this.close(false);
      return;
    }
    this.open(false);
    // press-drag-release: releasing over a choice picks it
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointerup', up, true);
      if (!this.list || performance.now() - this.openedAt < 250) return;
      const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.msel-item') as HTMLDivElement | null;
      const i = this.items.findIndex((it) => it.el === t);
      if (i >= 0) this.choose(i);
    };
    window.addEventListener('pointerup', up, true);
  }

  open(byKey: boolean): void {
    if (this.list) return;
    openSelector?.close(false);
    openSelector = this;
    this.openedByKey = byKey;
    this.openedAt = performance.now();
    const screen = (this.el.closest('#screen') as HTMLElement | null) ?? document.body;
    const list = el('div', 'msel-list', screen);
    // the list belongs to its window's area, so it takes that area's colours (palette.ts)
    const area = (this.el.closest('[data-area]') as HTMLElement | null)?.dataset.area;
    if (area) list.dataset.area = area;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', this.o.label);
    list.addEventListener('pointerdown', (e) => {
      e.preventDefault(); // keep focus on the selector
      e.stopPropagation();
    });
    this.list = list;
    this.render();
    // position below the box, in the screen's logical coordinates; flip up if needed
    const sr = screen.getBoundingClientRect();
    const r = this.el.getBoundingClientRect();
    const k = view.scale || 1;
    const x = (r.left - sr.left) / k;
    const y = (r.bottom - sr.top) / k;
    const sw = sr.width / k;
    const sh = sr.height / k;
    list.style.minWidth = r.width / k + 'px';
    const lw = list.offsetWidth;
    const lh = list.offsetHeight;
    list.style.left = Math.max(0, Math.min(x, sw - lw - 2)) + 'px';
    list.style.top = (y + lh > sh - 2 ? Math.max(16, (r.top - sr.top) / k - lh) : y) + 'px';
    this.el.setAttribute('aria-expanded', 'true');
    this.el.classList.add('open');
    this.reveal(this.hi);
  }

  /** Scroll the list (only the list: scrollIntoView would also move the screen) to show item i. */
  private reveal(i: number): void {
    const it = this.items[i]?.el;
    const l = this.list;
    if (!it || !l) return;
    const top = it.offsetTop;
    const bottom = top + it.offsetHeight;
    if (top < l.scrollTop) l.scrollTop = top;
    else if (bottom > l.scrollTop + l.clientHeight) l.scrollTop = bottom - l.clientHeight;
  }

  private render(): void {
    if (!this.list) return;
    const v = this.o.value();
    const opts = this.o.options();
    const cur = this.current();
    if (cur.missing) opts.unshift({ ...cur, disabled: true });
    const sig = opts.map((x) => x.value + '\u0000' + x.text + (x.disabled ? '1' : '0')).join('\u0001');
    if (this.list.dataset.sig !== sig) {
      this.list.dataset.sig = sig;
      this.list.innerHTML = '';
      this.items = opts.map((opt, i) => {
        const d = el('div', 'msel-item' + (opt.disabled ? ' disabled' : '') + (opt.missing ? ' missing' : ''), this.list!, undefined, opt.text);
        d.id = `msel-${Math.random().toString(36).slice(2)}-${i}`;
        d.setAttribute('role', 'option');
        d.setAttribute('aria-disabled', String(!!opt.disabled));
        d.title = opt.text;
        d.addEventListener('pointerenter', () => !opt.disabled && this.highlight(i));
        d.addEventListener('click', () => this.choose(i));
        return { opt, el: d };
      });
      if (this.hi < 0 || this.hi >= this.items.length) this.hi = this.items.findIndex((it) => it.opt.value === v);
    }
    this.items.forEach((it) => {
      it.el.classList.toggle('checked', it.opt.value === v && !it.opt.missing);
      it.el.setAttribute('aria-selected', String(it.opt.value === v));
    });
    this.highlight(this.hi);
  }

  /** Mark item i as the highlighted one; `reveal` scrolls the list to it (keyboard moves
   * only — a redraw or the mouse must never scroll the list under the user). */
  private highlight(i: number, reveal = false): void {
    this.hi = i;
    this.items.forEach((it, k) => it.el.classList.toggle('hot', k === i));
    const it = this.items[i];
    if (it) {
      this.el.setAttribute('aria-activedescendant', it.el.id);
      if (reveal) this.reveal(i);
    } else this.el.removeAttribute('aria-activedescendant');
  }

  private move(d: number): void {
    const n = this.items.length;
    if (!n) return;
    let i = this.hi;
    for (let k = 0; k < n; k++) {
      i = i < 0 ? (d > 0 ? 0 : n - 1) : Math.max(0, Math.min(n - 1, i + d));
      if (!this.items[i].opt.disabled) break;
      if ((d > 0 && i === n - 1) || (d < 0 && i === 0)) return;
    }
    if (!this.items[i]?.opt.disabled) this.highlight(i, true);
  }

  private choose(i: number): void {
    const it = this.items[i];
    if (!it || it.opt.disabled) return;
    const changed = it.opt.value !== this.o.value();
    const byKey = this.openedByKey;
    this.close(byKey);
    if (changed) this.o.onChange(it.opt.value);
    this.update();
  }

  /** Close the list. `keepFocus` false hands the keyboard back to emmm's performance keys. */
  close(keepFocus: boolean): void {
    if (!this.list) return;
    this.list.remove();
    this.list = null;
    this.items = [];
    this.hi = -1;
    if (openSelector === this) openSelector = null;
    this.el.setAttribute('aria-expanded', 'false');
    this.el.removeAttribute('aria-activedescendant');
    this.el.classList.remove('open');
    if (!keepFocus) this.el.blur();
  }

  private key(e: KeyboardEvent): void {
    // keys typed at a selector belong to it, not to emmm's performance shortcuts
    if (e.metaKey || e.ctrlKey) return;
    e.stopPropagation();
    const open = !!this.list;
    // type-ahead: printable keys search the choices; a space counts as text while typing
    const typing = performance.now() - this.typedAt < 700 && this.typed !== '';
    if (e.key.length === 1 && (/\S/.test(e.key) || (e.key === ' ' && typing))) {
      const now = performance.now();
      this.typed = typing ? this.typed + e.key.toLowerCase() : e.key.toLowerCase();
      this.typedAt = now;
      if (!open) this.open(true);
      const i = this.items.findIndex((it) => !it.opt.disabled && it.opt.text.toLowerCase().startsWith(this.typed));
      if (i >= 0) this.highlight(i, true);
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        if (!open) this.open(true);
        else this.move(e.key === 'ArrowDown' ? 1 : -1);
        return;
      case 'Home':
      case 'End':
        if (!open) return;
        e.preventDefault();
        this.hi = -1;
        this.move(e.key === 'Home' ? 1 : -1);
        if (e.key === 'End') {
          this.hi = this.items.length;
          this.move(-1);
        }
        return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (open) this.choose(this.hi);
        else this.open(true);
        return;
      case 'Escape':
        e.preventDefault();
        if (open) this.close(true);
        else this.el.blur();
        return;
      case 'Tab':
        if (open) this.close(true);
        return;
    }
  }
}

// clicking anywhere else closes an open list
if (typeof window !== 'undefined')
  window.addEventListener('pointerdown', (e) => {
    if (!openSelector) return;
    const t = e.target as Element | null;
    if (t?.closest('.msel-list') || t?.closest('.msel') === openSelector.el) return;
    openSelector.close(false);
  });
