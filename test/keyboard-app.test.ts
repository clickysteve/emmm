// @vitest-environment happy-dom
/**
 * The keyboard in the whole app: direct entry into real controls (Tempo, Length, Phase,
 * Time Base), Undo after it, shortcuts while stopped / playing / with the Pattern Editor in
 * front, suppression while typing, and the menus showing the keys.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Session } from '../src/app/session';
import { IS_MAC, keyLabel } from '../src/ui/keys';

type Ui = { openEditor: (n: string, o?: object) => void; updateAll: () => void; patternEditor: { region: [number, number] | null; voice: number; win: { open: boolean } } };
let s: Session;
let ui: Ui;

beforeAll(async () => {
  await import('../src/main');
  s = (window as unknown as { emmm: Session }).emmm;
  ui = (window as unknown as { emmmUi: Ui }).emmmUi;
  document.querySelector('.mdialog')?.remove();
});

const mod = IS_MAC ? { metaKey: true } : { ctrlKey: true };
/** a key event where a real one would go: the focused element, bubbling to the window */
function key(k: string, init: KeyboardEventInit & { code?: string } = {}) {
  const target = (document.activeElement as HTMLElement) ?? document.body;
  const code = init.code ?? (/^[a-z]$/i.test(k) ? 'Key' + k.toUpperCase() : /^[0-9]$/.test(k) ? 'Digit' + k : k === ' ' ? 'Space' : k);
  const ev = new KeyboardEvent('keydown', { key: k, code, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
}
const type = (t: string) => [...t].forEach((ch) => key(ch));
const pd = (e: Element) => e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientY: -9999 }));
const win = (id: string) => document.querySelector<HTMLDivElement>(`[data-win="${id}"]`)!;
const z = (id: string) => Number(win(id).style.zIndex || 0);
const topZ = () => Math.max(...[...document.querySelectorAll<HTMLDivElement>('.mwin')].map((w) => Number(w.style.zIndex || 0)));
/** a number box by its tooltip text */
const box = (root: string, tip: RegExp) => [...document.querySelectorAll<HTMLDivElement>(`${root} .num[role="spinbutton"]`)].find((e) => tip.test(e.title || e.dataset.tip || ''))!;
const blur = () => (document.activeElement as HTMLElement)?.blur?.();

describe('direct entry in the real controls', () => {
  it('Tempo 137', () => {
    const t = box('[data-win="conducting"]', /^Tempo/);
    pd(t); // a click selects it (and steps it, as in M)
    type('137');
    key('Enter');
    expect(s.comp.tempo.value).toBe(137);
    blur();
  });
  it('Length 16, Phase 48, Time Base 3/8 — in the Pattern Editor — and one Undo step each', () => {
    ui.openEditor('patternEditor', { voice: 0 });
    s.history.commit();
    const before = s.history.depth.undo;
    const len = box('[data-win="edit-pattern"]', /^Output Length/);
    len.focus();
    key('Enter'); // Enter edits the current value
    type('16');
    key('Enter', { altKey: true }); // ⌥↩ = the structural change (the Pattern becomes 16 steps)
    expect(s.pattern(0).steps.length).toBe(16);
    expect(s.pattern(0).outputLength).toBe(16);
    s.history.commit();
    const ph = box('[data-win="edit-pattern"]', /^Phase/);
    ph.focus();
    type('48');
    key('Enter');
    expect(s.pattern(0).phase).toBe(48);
    s.history.commit();
    const tb = box('[data-win="edit-pattern"]', /^Time Base numerator/);
    tb.focus();
    type('3/8');
    key('Enter');
    expect([s.pattern(0).tbNum, s.pattern(0).tbDen]).toEqual([3, 8]);
    s.history.commit();
    const den = box('[data-win="edit-pattern"]', /^Time Base denominator/);
    den.focus();
    type('10'); // not a legal denominator: refused, nothing changes
    key('Enter');
    expect(s.pattern(0).tbDen).toBe(8);
    den.focus();
    type('sa');
    key('Enter');
    expect(s.pattern(0).tbDen).toBe(0);
    s.history.commit();
    expect(s.history.depth.undo - before).toBe(4);
    s.undo();
    expect(s.pattern(0).tbDen).toBe(8);
    s.undo();
    expect([s.pattern(0).tbNum, s.pattern(0).tbDen]).not.toEqual([3, 8]);
    s.undo();
    expect(s.pattern(0).phase).not.toBe(48);
    blur();
  });
  it('the Pattern Editor and the Patterns window show the same typed value', () => {
    const len = box('[data-win="edit-pattern"]', /^Output Length/);
    len.focus();
    type('5');
    key('Enter');
    ui.updateAll();
    const pw = [...document.querySelectorAll<HTMLDivElement>('[data-win="patterns"] .num[role="spinbutton"]')].find((e) => /^Output Length/.test(e.title || e.dataset.tip || ''))!;
    expect(pw.textContent).toBe('5');
    blur();
  });
});

describe('typing never triggers performance keys', () => {
  it('digits, Space, letters and Return go to the number being typed', () => {
    const t = box('[data-win="conducting"]', /^Tempo/);
    t.focus();
    key('Enter');
    type('9');
    key(' ');
    key('a'); // would recall Snapshot A
    key('1'); // would play Slideshow 1
    expect(s.engine.state).toBe('stopped');
    expect(s.slideshowPlay).toBeNull();
    key('Escape');
    expect(s.comp.tempo.value).toBe(137);
    blur();
  });
});

describe('shortcuts', () => {
  it('while stopped: ⌥P ⌥V ⌥C ⌥K bring windows forward; ⌥G opens the Pattern Editor; ⌥M Midi Assignment', () => {
    blur();
    for (const [k, id] of [
      ['p', 'patterns'],
      ['v', 'variables'],
      ['c', 'cyclic'],
      ['k', 'conducting'],
    ] as const) {
      key(k, { altKey: true });
      expect(z(id), id).toBe(topZ());
    }
    key('m', { altKey: true });
    expect(win('midiassign').classList.contains('hidden')).toBe(false);
    key('g', { altKey: true });
    expect(z('edit-pattern')).toBe(topZ());
  });
  it('⌥↓ ⌥↑ select the next / previous Pattern; ⌥] ⌥[ step the Variable last clicked', () => {
    key('ArrowDown', { altKey: true });
    expect(s.selected).toEqual([false, true, false, false]);
    key('ArrowUp', { altKey: true });
    key('ArrowUp', { altKey: true });
    expect(s.selected).toEqual([false, false, false, true]);
    pd(document.querySelector('[data-var="noteDensity"][data-pos="0"]')!);
    key(']', { altKey: true, code: 'BracketRight' });
    expect(s.comp.noteDensity.active).toBe(1);
    key('[', { altKey: true, code: 'BracketLeft' });
    key('[', { altKey: true, code: 'BracketLeft' });
    expect(s.comp.noteDensity.active).toBe(5);
  });
  it('during playback: Space starts, ⌥ commands keep working, Tab pauses, Return stops', () => {
    blur();
    key(' ');
    expect(s.engine.state).toBe('playing');
    key('p', { altKey: true });
    expect(z('patterns')).toBe(topZ());
    key('Tab');
    expect(s.engine.state).toBe('paused');
    key('Tab');
    expect(s.engine.state).toBe('playing');
    key('Enter');
    expect(s.engine.state).toBe('stopped');
  });
  it('⌘⌫ clears the selected Pattern; ⌘Z brings it back', () => {
    s.selected = [true, false, false, false];
    s.history.commit();
    const before = JSON.stringify(s.pattern(0).steps);
    key('Backspace', mod);
    expect(s.pattern(0).steps).toEqual([]);
    key('z', mod);
    expect(JSON.stringify(s.pattern(0).steps)).toBe(before);
    key('z', { ...mod, shiftKey: true });
    expect(s.pattern(0).steps).toEqual([]);
    key('z', mod);
  });
  it('Extended keys work only with Extended on: ⇧⌥A capture, ⌥X mutate, ⌥A recall', () => {
    s.comp.extended.enabled = false;
    key('x', { altKey: true });
    expect(s.comp.extended.mutation.count).toBe(0);
    s.comp.extended.enabled = true;
    key('a', { altKey: true, shiftKey: true });
    expect(s.comp.extended.ab.a).not.toBeNull();
    s.clickPosition('transposition', 4);
    key('x', { altKey: true });
    expect(s.comp.extended.mutation.count).toBe(1);
    key('a', { altKey: true });
    expect(s.comp.transposition.active).toBe(0);
  });
  it('⌥H opens Keyboard Shortcuts, generated from the same table', () => {
    key('h', { altKey: true });
    const w = win('shortcuts');
    expect(w.classList.contains('hidden')).toBe(false);
    expect(w.textContent).toContain(keyLabel('clearPattern'));
    expect(w.textContent).toContain('Hold/Do');
  });
});

describe('the Pattern Editor in front', () => {
  it('← → move, ⇧→ selects, ⌘A selects all, ⌫ deletes the selection, Escape clears it', () => {
    s.selected = [false, false, false, false];
    ui.openEditor('patternEditor', { voice: 2 });
    const pe = ui.patternEditor;
    const len = s.pattern(2).steps.length;
    blur();
    key('ArrowRight');
    key('ArrowRight', { shiftKey: true });
    key('ArrowRight', { shiftKey: true });
    expect(pe.region).toEqual([1, 3]);
    s.history.commit();
    key('Backspace');
    expect(s.pattern(2).steps.length).toBe(len - 2);
    expect(s.hold).toBeNull(); // not Hold/Do
    key('a', mod);
    expect(pe.region).toEqual([0, len - 2]);
    key('Escape');
    expect(pe.region).toBeNull();
    key('Backspace'); // nothing selected: Backspace is Hold/Do again (M)
    expect(s.hold).not.toBeNull();
    key('Backspace');
    s.undo();
    expect(s.pattern(2).steps.length).toBe(len);
  });
});

describe('menus show the keys', () => {
  const items = (title: string) => {
    const t = [...document.querySelectorAll('#menubar .menu')].find((m) => m.firstChild?.textContent === title)!;
    t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const r = [...document.querySelectorAll('.dropdown .item')].map((i) => [i.children[0]?.textContent, i.children[1]?.textContent ?? '']);
    window.dispatchEvent(new PointerEvent('pointerdown'));
    return Object.fromEntries(r);
  };
  it('labels beside the commands, from the shared table', () => {
    expect(items('Edit')).toMatchObject({ Undo: keyLabel('undo'), Redo: keyLabel('redo'), Copy: keyLabel('copy'), Paste: keyLabel('paste') });
    expect(items('Pattern')).toMatchObject({ 'Edit…': keyLabel('patternEditor'), 'Clear Pattern': keyLabel('clearPattern') });
    expect(items('Windows')).toMatchObject({ Variables: keyLabel('variablesWindow'), 'Cyclic Editor': keyLabel('cyclicEditor') });
    expect(items('Options')).toMatchObject({ 'Use Metronome': keyLabel('metronome'), 'Full Screen': keyLabel('fullScreen') });
    expect(items('emmm')).toMatchObject({ 'Keyboard Shortcuts…': keyLabel('shortcuts') });
  });
});
