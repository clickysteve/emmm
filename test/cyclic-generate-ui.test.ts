// @vitest-environment happy-dom
/**
 * The Cyclic Variables window (four columns, Octave, informative pictures; three Classic
 * columns in Classic Mode), the Cyclic Editor's Octave, and Pattern ▸ Generate Pattern….
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Session } from '../src/app/session';
import { cyc } from '../src/engine/defaults';

type Ui = { openEditor: (n: string, o?: object) => void; updateAll: () => void; patternEditor: { group: number; voice: number }; generateWin: { dest: { group: number; voice: number }; pending: unknown } };
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
const pu = (e: Element) => e.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
const closeMenus = () => window.dispatchEvent(new PointerEvent('pointerdown'));
function item(title: string, label: string): HTMLDivElement {
  closeMenus();
  pd([...document.querySelectorAll('#menubar .menu')].find((m) => m.firstChild?.textContent === title)!);
  return [...document.querySelectorAll<HTMLDivElement>('.dropdown .item')].find((i) => i.firstElementChild!.textContent === label)!;
}
const choose = (title: string, label: string) => (pu(item(title, label)), ui.updateAll());
const cyclicWin = () => document.querySelector('[data-win="cyclic"]')!;
const cells = (v: string) => [...cyclicWin().querySelectorAll<HTMLDivElement>(`.pos[data-var="${v}"]`)];
const columns = () => ['rhythm', 'legato', 'accent', 'octave'].filter((v) => cells(v).length === 6);
const gen = () => document.querySelector('[data-win="generate"]')!;
const genOpen = () => !gen().classList.contains('hidden');

describe('Cyclic Variables window', () => {
  it('four columns with Octave; Classic Mode shows the three Classic ones; Octave data is kept', () => {
    ui.updateAll();
    expect(s.comp.extended.enabled).toBe(true);
    expect(columns()).toEqual(['rhythm', 'legato', 'accent', 'octave']);
    s.comp.octave.positions[3][1] = cyc(4, 0, [1, 3]);
    choose('Options', 'Enable Classic Mode');
    expect(columns()).toEqual(['rhythm', 'legato', 'accent']);
    expect(item('Variables', 'Octave…').classList.contains('disabled')).toBe(true);
    closeMenus();
    choose('Options', 'Enable Classic Mode');
    expect(columns()).toEqual(['rhythm', 'legato', 'accent', 'octave']);
    expect(s.comp.octave.positions[3][1]).toEqual(cyc(4, 0, [1, 3]));
  });
  it('pictures: a range is drawn dithered, a fixed value solid; the active Position stays inverted; the playing step is marked', () => {
    s.comp.rhythm.positions[5] = [cyc(1, 2, 3), cyc(2), cyc(4), cyc(0)];
    s.changed('rhythm');
    ui.updateAll();
    const svg = (v: string, i: number) => cells(v)[i].querySelector('svg')!.innerHTML;
    expect(svg('rhythm', 5)).not.toMatch(/fill="url\(#g/);
    s.comp.rhythm.positions[5][0] = cyc([1, 3]);
    s.changed('rhythm');
    ui.updateAll();
    expect(svg('rhythm', 5)).toMatch(/fill="url\(#g/);
    s.clickPosition('octave', 3);
    ui.updateAll();
    expect(cells('octave')[3].classList.contains('active')).toBe(true);
    expect(svg('octave', 3)).not.toMatch(/fill="none" stroke/);
    s.start();
    s.emitNow(s.engine.render(s.engine.tick + 400));
    ui.updateAll();
    expect(svg('octave', 3)).toMatch(/fill="none" stroke/); // the step being played, framed
    expect(svg('octave', 2)).not.toMatch(/fill="none" stroke/); // only on the active Position
    s.stop();
    s.clickPosition('octave', 0);
  });
  it('double-click an Octave Position: the Cyclic Editor edits Octave; clicking the grid sets a level', () => {
    const c = cells('octave')[4];
    pd(c);
    pu(c);
    pd(c);
    ui.updateAll();
    const ed = document.querySelector('[data-win="edit-cyclic"]')!;
    expect(ed.classList.contains('hidden')).toBe(false);
    expect([...ed.querySelectorAll('.btn.on')].map((b) => b.textContent)).toContain('Octave');
    s.comp.octave.positions[4][0] = cyc(2);
    // the first voice grid: step 1, level 4 (top line)
    const grid = [...ed.querySelectorAll<HTMLDivElement>('div')].find((d) => d.querySelector('svg') && d.style.position === 'absolute')!;
    const r = grid.getBoundingClientRect();
    pd(grid, { clientX: r.left + 8, clientY: r.top + 3 });
    pu(grid);
    expect(s.comp.octave.positions[4][0][0]).toEqual({ lo: 4, hi: 4 });
  });
});

describe('Generate Pattern', () => {
  it('targets the Pattern being edited, fixed while open; Generate previews only; Cancel changes nothing', () => {
    s.clickPosition('patternGroup', 0);
    ui.openEditor('patternEditor', { voice: 1 });
    const b = [...document.querySelectorAll<HTMLDivElement>('[data-win="edit-pattern"] .num')].find((d) => d.textContent === 'b' && d.title.startsWith('Edit Pattern Group'))!;
    pd(b);
    ui.updateAll();
    const before = JSON.stringify(s.comp.patternGroups);
    choose('Pattern', 'Generate Pattern…');
    expect(genOpen()).toBe(true);
    expect(ui.generateWin.dest).toEqual({ group: 1, voice: 1 });
    expect(gen().textContent).toMatch(/Into Pattern b2/);
    s.clickPosition('patternGroup', 4); // the music (or a Robot) moves on
    ui.updateAll();
    expect(ui.generateWin.dest).toEqual({ group: 1, voice: 1 });
    pd(gen().querySelector('#gen-generate')!);
    ui.updateAll();
    expect(ui.generateWin.pending).not.toBeNull();
    expect(gen().querySelector('.box svg')!.innerHTML).toMatch(/<rect/);
    expect(JSON.stringify(s.comp.patternGroups)).toBe(before);
    pd(gen().querySelector('#gen-cancel')!);
    expect(genOpen()).toBe(false);
    expect(JSON.stringify(s.comp.patternGroups)).toBe(before);
  });
  it('Apply replaces only that Pattern, in one Undo step', () => {
    s.history.commit();
    const before = JSON.stringify(s.comp.patternGroups);
    choose('Pattern', 'Generate Pattern…');
    pd(gen().querySelector('#gen-generate')!);
    pd(gen().querySelector('#gen-apply')!);
    expect(genOpen()).toBe(false);
    const now = JSON.parse(JSON.stringify(s.comp.patternGroups));
    expect(JSON.stringify(now[1].patterns[1])).not.toBe(JSON.stringify(JSON.parse(before)[1].patterns[1]));
    now[1].patterns[1] = JSON.parse(before)[1].patterns[1];
    expect(JSON.stringify(now)).toBe(before);
    s.history.commit();
    s.undo();
    expect(JSON.stringify(s.comp.patternGroups)).toBe(before);
  });
  it('Classic Mode: greyed out, and an open generator closes without applying', () => {
    const before = JSON.stringify(s.comp.patternGroups);
    choose('Pattern', 'Generate Pattern…');
    pd(gen().querySelector('#gen-generate')!);
    choose('Options', 'Enable Classic Mode');
    expect(genOpen()).toBe(false);
    expect(ui.generateWin.pending).toBeNull();
    expect(item('Pattern', 'Generate Pattern…').classList.contains('disabled')).toBe(true);
    closeMenus();
    expect(JSON.stringify(s.comp.patternGroups)).toBe(before);
    choose('Options', 'Enable Classic Mode');
    expect(item('Pattern', 'Generate Pattern…').classList.contains('disabled')).toBe(false);
    closeMenus();
  });
});
