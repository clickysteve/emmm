/** Tiny DOM helpers for the fixed-coordinate "screen". */

/** Current screen scale (logical px → CSS px). Set by main.ts. */
export const view = { scale: 1 };

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  parent?: HTMLElement | null,
  rect?: [number, number, number?, number?],
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (rect) place(e, ...rect);
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export function place(e: HTMLElement, x: number, y: number, w?: number, h?: number): HTMLElement {
  e.style.left = x + 'px';
  e.style.top = y + 'px';
  if (w !== undefined) e.style.width = w + 'px';
  if (h !== undefined) e.style.height = h + 'px';
  return e;
}

export function label(parent: HTMLElement, x: number, y: number, text: string, cls = ''): HTMLDivElement {
  const d = el('div', 'label ' + cls, parent, [x, y]);
  d.innerHTML = text;
  return d;
}

/** An inline SVG element sized w×h with crisp edges. */
export function svgEl(w: number, h: number, inner: string, cls = ''): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('width', String(w));
  s.setAttribute('height', String(h));
  s.setAttribute('viewBox', `0 0 ${w} ${h}`);
  s.setAttribute('shape-rendering', 'crispEdges');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = inner;
  return s;
}

export function setSvg(s: SVGSVGElement, inner: string): void {
  if (s.innerHTML !== inner) s.innerHTML = inner;
}

/** Pointer position in the element's logical coordinates. */
export function localPoint(e: Element, ev: { clientX: number; clientY: number }): { x: number; y: number; w: number; h: number } {
  const r = e.getBoundingClientRect();
  const s = view.scale;
  return { x: (ev.clientX - r.left) / s, y: (ev.clientY - r.top) / s, w: r.width / s, h: r.height / s };
}

export interface DragInfo {
  dx: number;
  dy: number;
  ev: PointerEvent;
}

/**
 * Track a pointer drag after pointerdown, in logical pixels. Returns nothing; calls `move`
 * for each movement and `up` at the end (with `moved` = whether it was a real drag).
 */
export function trackDrag(
  start: PointerEvent,
  target: Element,
  move: (d: DragInfo) => void,
  up?: (d: DragInfo & { moved: boolean }) => void,
): void {
  const sx = start.clientX;
  const sy = start.clientY;
  let moved = false;
  try {
    (target as HTMLElement).setPointerCapture(start.pointerId);
  } catch {
    /* ignore */
  }
  const onMove = (ev: PointerEvent) => {
    const dx = (ev.clientX - sx) / view.scale;
    const dy = (ev.clientY - sy) / view.scale;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    move({ dx, dy, ev });
  };
  const onUp = (ev: PointerEvent) => {
    target.removeEventListener('pointermove', onMove as EventListener);
    target.removeEventListener('pointerup', onUp as EventListener);
    target.removeEventListener('pointercancel', onUp as EventListener);
    up?.({ dx: (ev.clientX - sx) / view.scale, dy: (ev.clientY - sy) / view.scale, ev, moved });
  };
  target.addEventListener('pointermove', onMove as EventListener);
  target.addEventListener('pointerup', onUp as EventListener);
  target.addEventListener('pointercancel', onUp as EventListener);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
