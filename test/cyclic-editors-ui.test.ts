// @vitest-environment happy-dom
/**
 * The dedicated Cyclic Variable edit windows (Rhythm, Legato, Accent, Octave), driven with
 * pointer events on the real controls: opening from menus and the Cyclic Variables window,
 * Position choice in the title bar, cycles programmed on the grids, Undo, Classic Mode.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Session } from '../src/app/session';
import { view } from '../src/ui/dom';

type Ui = { openEditor: (n: string, o?: object) => void; updateAll: () => void };
let s: Session;
let ui: Ui;

beforeAll(async () => {
  await import('../src/main');
  s = (window as unknown as { emmm: Session }).emmm;
  ui = (window as unknown as { emmmUi: Ui }).emmmUi;
  document.querySelector('.mdialog')?.remove();
  (s.scheduler as unknown as { wake: () => void }).wake = () => {};
});

const pd = (e: Element, init: PointerEventInit = {}) => e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, ...init }));
const pm = (e: Element, init: PointerEventInit = {}) => e.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, ...init }));
const pu = (e: Element, init: PointerEventInit = {}) => e.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, ...init }));
const closeMenus = () => window.dispatchEvent(new PointerEvent('pointerdown'));
function item(title: string, label: string): HTMLDivElement {
  closeMenus();
  pd([...document.querySelectorAll('#menubar .menu')].find((m) => m.firstChild?.textContent === title)!);
  return [...document.querySelectorAll<HTMLDivElement>('.dropdown .item')].find((i) => i.firstElementChild!.textContent === label)!;
}
const choose = (title: string, label: string) => (pu(item(title, label)), ui.updateAll());
const ed = (v: string) => document.querySelector<HTMLDivElement>(`[data-win="edit-${v}"]`)!;
const isOpen = (v: string) => !ed(v).classList.contains('hidden');
const editPos = (v: string) => [...ed(v).querySelectorAll('.possel .p')].findIndex((c) => c.classList.contains('edit'));
const cyclicWin = () => document.querySelector('[data-win="cyclic"]')!;
/** grid geometry (cyclicEditor.ts): step k at x 18 + 12k; level l at y 4 + 7(4 − l); numbers below */
const X = (step: number) => (18 + 12 * step) * view.scale;
const Y = (level: number) => (4 + 7 * (4 - level)) * view.scale;
const LEN_Y = 42;
function setLevel(v: string, voice: number, step: number, level: number): void {
  const g = ed(v).querySelector(`.cgrid[data-voice="${voice}"]`)!;
  pd(g, { clientX: X(step), clientY: Y(level) });
  pu(g, { clientX: X(step), clientY: Y(level) });
}
function setLength(v: string, voice: number, n: number): void {
  const g = ed(v).querySelector(`.cgrid[data-voice="${voice}"]`)!;
  pd(g, { clientX: X(n - 1), clientY: LEN_Y * view.scale });
  pu(g, { clientX: X(n - 1), clientY: LEN_Y * view.scale });
}
/** a cycle as plain levels (a range as "lo-hi") */
const levels = (v: 'rhythm' | 'legato' | 'accent' | 'octave', p: number, voice: number) => s.comp[v].positions[p][voice].map((c) => (c.lo === c.hi ? c.lo : `${c.lo}-${c.hi}`));

describe('dedicated Cyclic Variable editors', () => {
  it('Variables ▸ Rhythm… / Legato… / Accent… / Octave… each open their own window, titled for the Variable', () => {
    for (const [entry, v, title] of [
      ['Rhythm…', 'rhythm', 'Rhythm Editor'],
      ['Legato…', 'legato', 'Legato Editor'],
      ['Accent…', 'accent', 'Accent Editor'],
      ['Octave…', 'octave', 'Octave Editor'],
    ]) {
      choose('Variables', entry);
      expect(isOpen(v), entry).toBe(true);
      expect(ed(v).querySelector('.title')!.textContent).toBe(title);
      expect(ed(v).querySelectorAll('.cgrid')).toHaveLength(4);
    }
    // all four stay open together; asking again brings the existing one forward
    expect(['rhythm', 'legato', 'accent', 'octave'].every(isOpen)).toBe(true);
    choose('Windows', 'Rhythm Editor');
    expect(document.querySelectorAll('[data-win="edit-rhythm"]')).toHaveLength(1);
    expect(Number(ed('rhythm').style.zIndex)).toBeGreaterThan(Number(ed('octave').style.zIndex));
    choose('Windows', 'Close Edit Windows');
    expect(['rhythm', 'legato', 'accent', 'octave'].some(isOpen)).toBe(false);
  });

  it('the Cyclic Variables window: a name opens that editor on the active Position, changing nothing; a double-click opens it on that Position', () => {
    s.clickPosition('legato', 1);
    const name = [...cyclicWin().querySelectorAll<HTMLDivElement>('.label.cname')].find((l) => l.textContent === 'Legato')!;
    pd(name);
    ui.updateAll();
    expect(isOpen('legato')).toBe(true);
    expect(isOpen('rhythm')).toBe(false);
    expect(editPos('legato')).toBe(1);
    const cell = cyclicWin().querySelectorAll('.pos[data-var="octave"]')[2];
    pd(cell);
    pu(cell);
    pd(cell);
    ui.updateAll();
    expect(isOpen('octave')).toBe(true);
    expect(editPos('octave')).toBe(2);
    expect(s.comp.octave.active).toBe(2); // the double-click's first click selects, as in M
    expect(s.comp.legato.active).toBe(1);
    s.clickPosition('legato', 0);
    s.clickPosition('octave', 0);
  });

  it('programs four-step Octave cycles on Position 1 through the grids; closing and reopening keeps them', () => {
    ui.openEditor('cyclic', { variable: 'octave' });
    const p0 = ed('octave').querySelectorAll('.possel .p')[0];
    pd(p0);
    pu(p0);
    ui.updateAll();
    expect(editPos('octave')).toBe(0);
    const v3before = JSON.stringify(s.comp.octave.positions[0][3]);
    setLength('octave', 0, 4);
    expect(levels('octave', 0, 0)).toEqual([2, 2, 2, 2]); // new steps are "no shift"
    setLevel('octave', 0, 1, 3);
    setLevel('octave', 0, 3, 1);
    setLength('octave', 1, 4);
    setLevel('octave', 1, 2, 4);
    setLength('octave', 2, 4);
    setLevel('octave', 2, 0, 1);
    setLevel('octave', 2, 2, 3);
    expect(levels('octave', 0, 0)).toEqual([2, 3, 2, 1]); //  0 +1  0 −1
    expect(levels('octave', 0, 1)).toEqual([2, 2, 4, 2]); //  0  0 +2  0
    expect(levels('octave', 0, 2)).toEqual([1, 2, 3, 2]); // −1  0 +1  0
    expect(JSON.stringify(s.comp.octave.positions[0][3])).toBe(v3before);
    // a ranged step: drag up the step from −1 to +1
    const g = ed('octave').querySelector('.cgrid[data-voice="3"]')!;
    setLength('octave', 3, 2);
    pd(g, { clientX: X(1), clientY: Y(1) });
    pm(g, { clientX: X(1), clientY: Y(3) });
    pu(g, { clientX: X(1), clientY: Y(3) });
    expect(levels('octave', 0, 3)).toEqual([2, '1-3']);
    // the status line says what a step is, in octaves
    pm(ed('octave').querySelector('.cgrid[data-voice="0"]')!, { clientX: X(1), clientY: Y(3) });
    ui.updateAll();
    expect(ed('octave').textContent).toContain('Position 1 · Voice 1 · Step 2 of 4 · +1 oct');
    ed('octave').querySelector<HTMLDivElement>('.close')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(isOpen('octave')).toBe(false);
    choose('Variables', 'Octave…');
    expect(editPos('octave')).toBe(0);
    expect(levels('octave', 0, 0)).toEqual([2, 3, 2, 1]);
    expect(ed('octave').querySelector('.cgrid[data-voice="0"] svg')!.innerHTML.match(/width="5" height="5"/g)).toHaveLength(4);
  });

  it('choosing another Position in the title bar edits that one only; the playing Position is unchanged', () => {
    const before = JSON.stringify(s.comp.octave.positions[0]);
    const p3 = ed('octave').querySelectorAll('.possel .p')[3];
    pd(p3);
    pu(p3);
    ui.updateAll();
    setLevel('octave', 0, 0, 4);
    expect(s.comp.octave.positions[3][0][0]).toEqual({ lo: 4, hi: 4 });
    expect(JSON.stringify(s.comp.octave.positions[0])).toBe(before);
    expect(s.comp.octave.active).toBe(0);
  });

  it('Undo and Redo a grid edit', () => {
    s.history.commit();
    const before = JSON.stringify(s.comp.octave.positions[3][1]);
    setLength('octave', 1, 3);
    setLevel('octave', 1, 2, 0);
    s.history.commit();
    const after = JSON.stringify(s.comp.octave.positions[3][1]);
    s.undo();
    expect(JSON.stringify(s.comp.octave.positions[3][1])).toBe(before);
    s.redo();
    expect(JSON.stringify(s.comp.octave.positions[3][1])).toBe(after);
  });

  it('Octave Note Rate: a RATE box beside each Voice’s grid sets that Voice’s rate for the edited Position only; Undo restores it', () => {
    ui.openEditor('cyclic', { variable: 'octave', position: 2 });
    const box = (v: number) => ed('octave').querySelector<HTMLDivElement>(`.num.octrate[data-voice="${v}"]`)!;
    const key = (e: Element, k: string) => e.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    expect([0, 1, 2, 3].map((v) => box(v).textContent)).toEqual(s.comp.octave.rates[2].map(String));
    // beside the grid: right of it, left of the octave legend
    const grid = ed('octave').querySelector<HTMLDivElement>('.cgrid[data-voice="1"]')!;
    const left = (e: HTMLElement) => parseFloat(e.style.left);
    expect(left(box(1))).toBeGreaterThanOrEqual(left(grid) + parseFloat(grid.style.width));
    s.history.commit();
    const before = structuredClone(s.comp.octave.rates);
    pd(box(1));
    pu(box(1));
    expect(s.comp.octave.rates[2]).toEqual(before[2]); // a click only selects the box
    expect(document.activeElement).toBe(box(1));
    key(box(1), '8');
    key(box(1), 'Enter');
    key(box(3), 'Home');
    key(box(3), 'ArrowUp');
    ui.updateAll();
    expect(s.comp.octave.rates[2]).toEqual([before[2][0], 8, before[2][2], 2]);
    expect(box(1).textContent).toBe('8');
    expect(s.comp.octave.rates.filter((_, p) => p !== 2)).toEqual(before.filter((_, p) => p !== 2));
    key(box(1), 'End');
    expect(s.comp.octave.rates[2][1]).toBe(16);
    key(box(1), '5');
    key(box(1), 'Enter');
    expect([1, 2, 3, 4, 8, 16]).toContain(s.comp.octave.rates[2][1]); // typed values snap to the menu
    s.history.commit();
    s.undo();
    expect(s.comp.octave.rates).toEqual(before);
    expect(ed('rhythm').querySelector('.octrate')).toBeNull();
  });

  it('Rhythm, Legato and Accent keep their editing (new steps at level 1, ranges, value tables)', () => {
    for (const v of ['rhythm', 'legato', 'accent'] as const) {
      ui.openEditor('cyclic', { variable: v, position: 5 });
      setLength(v, 0, 1);
      setLength(v, 0, 3);
      expect(levels(v, 5, 0).slice(1)).toEqual([1, 1]);
      setLevel(v, 0, 2, 4);
      expect(levels(v, 5, 0)[2]).toBe(4);
    }
    expect(ed('rhythm').querySelectorAll('.num').length).toBeGreaterThanOrEqual(5);
    expect(ed('accent').textContent).toContain('0 = silent');
  });

  it('Classic Mode: the Octave Editor closes and cannot be opened; Octave data is kept; the others still work', () => {
    ui.openEditor('cyclic', { variable: 'octave' });
    const kept = JSON.stringify(s.comp.octave);
    choose('Options', 'Enable Classic Mode');
    expect(isOpen('octave')).toBe(false);
    ui.openEditor('cyclic', { variable: 'octave' });
    expect(isOpen('octave')).toBe(false);
    expect(item('Windows', 'Octave Editor').classList.contains('disabled')).toBe(true);
    closeMenus();
    expect([...cyclicWin().querySelectorAll('.label.cname')].map((l) => l.textContent)).toEqual(['Rhythm', 'Legato', 'Accent']);
    choose('Windows', 'Accent Editor');
    expect(isOpen('accent')).toBe(true);
    setLevel('accent', 0, 0, 3);
    expect(s.comp.accent.positions[editPos('accent')][0][0]).toEqual({ lo: 3, hi: 3 });
    choose('Options', 'Enable Classic Mode');
    expect(JSON.stringify(s.comp.octave)).toBe(kept);
  });
});
