// @vitest-environment happy-dom
/**
 * The whole app, driven through its menus with pointer events: the Windows menu brings
 * windows forward / opens editors / closes edit windows, and the other menus' commands are
 * wired (Undo/Redo, Clear Pattern, New, Options). No native dialogs are used.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Session } from '../src/app/session';

type Ui = { openEditor: (n: string, o?: object) => void; updateAll: () => void };
let s: Session;
let ui: Ui;
const confirmSpy = vi.fn(() => true);
const promptSpy = vi.fn(() => 'x');

beforeAll(async () => {
  window.confirm = confirmSpy;
  window.prompt = promptSpy;
  await import('../src/main');
  s = (window as unknown as { emmm: Session }).emmm;
  ui = (window as unknown as { emmmUi: Ui }).emmmUi;
  document.querySelector('.mdialog')?.remove(); // the "no Web MIDI here" notice
});

const pd = (e: Element) => e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
const pu = (e: Element) => e.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
const menuTitle = (t: string) => [...document.querySelectorAll('#menubar .menu')].find((m) => m.firstChild?.textContent === t)!;
function openMenu(title: string): HTMLDivElement[] {
  pd(menuTitle(title));
  return [...document.querySelectorAll<HTMLDivElement>('.dropdown .item')];
}
const label = (it: HTMLDivElement) => it.firstElementChild!.textContent!;
function choose(title: string, item: string): void {
  const it = openMenu(title).find((i) => label(i) === item);
  if (!it) throw new Error(`no ${title} ▸ ${item}: ${openMenu(title).map(label).join(' | ')}`);
  pu(it);
}
const win = (id: string) => document.querySelector<HTMLDivElement>(`[data-win="${id}"]`)!;
const isOpen = (id: string) => !win(id).classList.contains('hidden');
const z = (id: string) => Number(win(id).style.zIndex || 0);
const topZ = () => Math.max(...[...document.querySelectorAll<HTMLDivElement>('.mwin')].map((w) => Number(w.style.zIndex || 0)));
const closeMenus = () => window.dispatchEvent(new PointerEvent('pointerdown'));

describe('Windows menu', () => {
  it('lists the Conducting window (by its document title) first, then the main windows and the editors', () => {
    const items = openMenu('Windows').map(label);
    closeMenus();
    expect(items.slice(0, 7)).toEqual(['Close Edit Windows', s.comp.name, 'Patterns a', 'Variables', 'Cyclic Variables', 'Midi', 'Snap']);
    expect(items).toContain('Cyclic Editor');
    expect(items).toContain('Pattern Editor');
    expect(items).toContain('Monitor');
  });
  it('each main window entry brings that window to the front, and flashes its title', () => {
    ui.openEditor('noteDensity'); // something on top
    for (const [entry, id] of [
      ['Patterns a', 'patterns'],
      [s.comp.name, 'conducting'],
      ['Variables', 'variables'],
      ['Cyclic Variables', 'cyclic'],
      ['Midi', 'midi'],
      ['Snap', 'snapshot'],
    ]) {
      choose('Windows', entry);
      expect(z(id), entry).toBe(topZ());
      expect(win(id).querySelector('.title')!.classList.contains('flash-front'), entry).toBe(true);
    }
  });
  it('editor entries open their editors in front; Monitor opens the Monitor', () => {
    choose('Windows', 'Close Edit Windows');
    for (const [entry, id] of [
      ['Cyclic Editor', 'edit-cyclic'],
      ['Pattern Editor', 'edit-pattern'],
      ['Monitor', 'monitor'],
    ]) {
      expect(isOpen(id)).toBe(false);
      choose('Windows', entry);
      expect(isOpen(id), entry).toBe(true);
      expect(z(id)).toBe(topZ());
    }
  });
  it('open edit windows appear in the list, as in M, and come forward from it', () => {
    ui.openEditor('transposition');
    const items = openMenu('Windows').map(label);
    closeMenus();
    expect(items).toContain('Transposition');
    ui.openEditor('noteOrder');
    choose('Windows', 'Transposition');
    expect(z('edit-transposition')).toBe(topZ());
  });
  it('Close Edit Windows closes every edit window, then is disabled', () => {
    choose('Windows', 'Close Edit Windows');
    expect([...document.querySelectorAll('.mwin')].filter((w) => !w.classList.contains('hidden')).map((w) => (w as HTMLElement).dataset.win).sort()).toEqual(['conducting', 'cyclic', 'midi', 'patterns', 'snapshot', 'variables']);
    const close = openMenu('Windows')[0];
    closeMenus();
    expect(close.classList.contains('disabled')).toBe(true);
  });
  it('the document entry follows the document name', () => {
    s.comp.name = 'Night Piece';
    s.changed('name');
    ui.updateAll();
    expect(openMenu('Windows').map(label)[1]).toBe('Night Piece');
    closeMenus();
  });
});

describe('other menus are wired', () => {
  it('Edit ▸ Undo / Redo', () => {
    s.history.commit();
    s.comp.transposition.positions[1][2] = 9;
    s.changed('transposition');
    s.history.commit();
    const undo = openMenu('Edit').find((i) => label(i) === 'Undo')!;
    expect(undo.classList.contains('disabled')).toBe(false);
    pu(undo);
    expect(s.comp.transposition.positions[1][2]).not.toBe(9);
    choose('Edit', 'Redo');
    expect(s.comp.transposition.positions[1][2]).toBe(9);
  });
  it('Edit items that need a selection are disabled without one, enabled with one', () => {
    s.selected = [false, false, false, false];
    choose('Windows', 'Close Edit Windows');
    expect(openMenu('Edit').find((i) => label(i) === 'Cut')!.classList.contains('disabled')).toBe(true);
    closeMenus();
    s.selected = [true, false, false, false];
    expect(openMenu('Edit').find((i) => label(i) === 'Cut')!.classList.contains('disabled')).toBe(false);
    closeMenus();
  });
  it('Pattern ▸ Clear Pattern clears the selected Pattern; Undo restores it', () => {
    s.history.commit();
    s.selected = [false, true, false, false];
    const before = structuredClone(s.pattern(1).steps);
    choose('Pattern', 'Clear Pattern');
    expect(s.pattern(1).steps).toEqual([]);
    s.undo();
    expect(s.pattern(1).steps).toEqual(before);
  });
  it('Pattern ▸ Edit… opens the Pattern Editor; Variables ▸ items open their edit windows', () => {
    choose('Pattern', 'Edit…');
    expect(isOpen('edit-pattern')).toBe(true);
    for (const [item, id] of [
      ['Note Density…', 'edit-noteDensity'],
      ['Velocity Range…', 'edit-velocityRange'],
      ['Note Order…', 'edit-noteOrder'],
      ['Transposition…', 'edit-transposition'],
      ['Time Distortion…', 'edit-timeDistortion'],
      ['Orchestration…', 'edit-orchestration'],
      ['Rhythm…', 'edit-cyclic'],
    ]) {
      choose('Variables', item);
      expect(isOpen(id), item).toBe(true);
    }
  });
  it('File ▸ New asks in an emmm dialog (never the browser’s)', async () => {
    choose('File', 'New');
    const d = document.querySelector('.mdialog')!;
    expect(d.textContent).toContain('Start a new document?');
    [...d.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!.click();
    choose('File', 'Save As…');
    expect(document.querySelector('.mdialog input')).not.toBeNull();
    [...document.querySelectorAll<HTMLButtonElement>('.mdialog button')].find((b) => b.textContent === 'Cancel')!.click();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(promptSpy).not.toHaveBeenCalled();
  });
  it('Options toggle and open things', () => {
    const was = s.comp.options.dontScrambleRests;
    choose('Options', "Don't Scramble Rests");
    expect(s.comp.options.dontScrambleRests).toBe(!was);
    choose('Options', 'Palette…');
    expect(isOpen('palette')).toBe(true);
    choose('Options', 'Performance Feedback  (Extended)');
    expect(isOpen('feedback')).toBe(true);
    choose('Options', 'Performance Feedback  (Extended)');
    expect(isOpen('feedback')).toBe(false);
    choose('Options', 'MIDI Learn…  (Extended)');
    expect(isOpen('learn')).toBe(true);
    choose('Options', 'Extended…  (not Classic M)');
    expect(isOpen('extended')).toBe(true);
    const tipsBefore = openMenu('Options').find((i) => label(i) === 'Show Tips')!.classList.contains('checked');
    closeMenus();
    choose('Options', 'Show Tips');
    expect(openMenu('Options').find((i) => label(i) === 'Show Tips')!.classList.contains('checked')).toBe(!tipsBefore);
    closeMenus();
  });
  it('emmm menu: About, Help, New random seed', () => {
    choose('emmm', 'About emmm…');
    expect(isOpen('about')).toBe(true);
    choose('emmm', 'Help…');
    expect(isOpen('help')).toBe(true);
    const seed = s.comp.seed;
    choose('emmm', 'New random seed');
    expect(s.comp.seed).not.toBe(seed);
  });
  it('the app has no native <select> anywhere', () => {
    ui.openEditor('midiAssignment');
    choose('Options', 'Extended…  (not Classic M)');
    ui.updateAll();
    expect(document.querySelectorAll('select')).toHaveLength(0);
    expect(document.querySelectorAll('.msel').length).toBeGreaterThan(34);
  });
});
