/**
 * emmm's tooltips. Every control already describes itself with a `title`; instead of the
 * browser's system-styled tooltip, this one shared layer shows that text in emmm's own
 * look (a small framed box in the pixel font, palette colours).
 *
 * On hover it moves an element's `title` into `data-tip` (so the system tooltip never
 * appears) and shows the text after a short delay — immediately while moving between
 * controls. It never takes pointer events, so it cannot get in the way of editing, and it
 * hides on any press or key. Turn it off with Options ▸ Show Tips (a browser preference).
 */
import { el } from './dom';

const DELAY = 550;
const FOLLOW = 1500; // after one tip has shown, the next appears at once for this long

export interface TooltipLayer {
  enabled: boolean;
  hide(): void;
}

export function installTooltips(screen: HTMLElement, scale: () => number, enabled = true): TooltipLayer {
  const tip = el('div', 'mtip hidden', screen);
  tip.setAttribute('role', 'tooltip');
  tip.style.pointerEvents = 'none'; // never in the way of a gesture
  tip.id = 'emmm-tip';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let target: Element | null = null;
  let lastShown = 0;
  let px = 0;
  let py = 0;
  const layer: TooltipLayer = { enabled, hide };

  function hide(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!tip.classList.contains('hidden')) lastShown = performance.now();
    tip.classList.add('hidden');
    target?.removeAttribute('aria-describedby');
  }

  function textOf(e: Element): string {
    // adopt a (possibly updated) title; keep it as data-tip from then on
    const t = e.getAttribute('title');
    if (t !== null) {
      if (t) (e as HTMLElement).dataset.tip = t;
      e.removeAttribute('title');
      if (!e.getAttribute('aria-label') && !e.textContent?.trim() && t) e.setAttribute('aria-label', t);
    }
    return (e as HTMLElement).dataset.tip ?? '';
  }

  function show(): void {
    if (!target || !layer.enabled) return;
    const text = textOf(target);
    if (!text) return;
    tip.textContent = text;
    tip.classList.remove('hidden');
    const sr = screen.getBoundingClientRect();
    const k = scale() || 1;
    const x = (px - sr.left) / k;
    const y = (py - sr.top) / k;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const W = sr.width / k;
    const H = sr.height / k;
    tip.style.left = Math.max(2, Math.min(x + 8, W - w - 2)) + 'px';
    tip.style.top = (y + 14 + h > H - 2 ? Math.max(2, y - h - 6) : y + 14) + 'px';
    target.setAttribute('aria-describedby', tip.id);
  }

  screen.addEventListener('pointerover', (e) => {
    const t = (e.target as Element).closest?.('[title], [data-tip]');
    if (t === target) return;
    hide();
    target = t;
    if (!t) return;
    textOf(t); // suppress the system tooltip straight away (also when tips are off)
    if (!layer.enabled) return;
    px = e.clientX;
    py = e.clientY;
    timer = setTimeout(show, performance.now() - lastShown < FOLLOW ? 0 : DELAY);
  });
  screen.addEventListener('pointermove', (e) => {
    px = e.clientX;
    py = e.clientY;
  });
  screen.addEventListener('pointerleave', () => {
    hide();
    target = null;
  });
  // pressing or typing dismisses (the tip must never block a performance gesture)
  window.addEventListener('pointerdown', () => {
    hide();
    lastShown = 0;
  }, true);
  window.addEventListener('keydown', hide, true);
  // a title set later (windows built on demand) is adopted at once, so the system tooltip
  // never shows
  new MutationObserver((recs) => {
    for (const r of recs) if (r.target instanceof Element && r.target.hasAttribute('title')) textOf(r.target);
  }).observe(screen, { subtree: true, attributes: true, attributeFilter: ['title'] });
  return layer;
}
