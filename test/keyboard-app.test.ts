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
  it('while stopped: ⌥P ⌥V ⌥C ⌥K bring windows forward; ⌥G opens the Pattern Editor; ⌥M MIDI Settings', () => {
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

describe('Space = Play / Pause (emmm; M had Start / Sync)', () => {
  it('stopped → Start, playing → Pause, paused → Continue; Return stops', () => {
    blur();
    s.stop();
    key(' ');
    expect(s.engine.state).toBe('playing');
    key(' ');
    expect(s.engine.state).toBe('paused');
    key(' ');
    expect(s.engine.state).toBe('playing');
    key(' ');
    expect(s.engine.state).toBe('paused');
    key('Enter');
    expect(s.engine.state).toBe('stopped');
  });
  it('uses the existing transport: a paused Continue keeps the position (no restart)', () => {
    blur();
    key(' ');
    s.scheduler.wake();
    s.emitNow(s.engine.render(s.engine.tick + 300));
    const at = s.engine.tick;
    key(' ');
    key(' ');
    expect(s.engine.state).toBe('playing');
    expect(s.engine.tick).toBeGreaterThanOrEqual(at);
    key('Enter');
  });
  it('a held Space (auto-repeat) does not toggle again', () => {
    blur();
    key(' ');
    key(' ', { repeat: true });
    key(' ', { repeat: true });
    expect(s.engine.state).toBe('playing');
    key('Enter');
  });
  it('⇧Space is Sync (M’s Start-while-playing); it does not pause', () => {
    blur();
    key(' ');
    let synced = 0;
    const orig = s.sync.bind(s);
    s.sync = () => (synced++, orig());
    key(' ', { shiftKey: true });
    s.sync = orig;
    expect(synced).toBe(1);
    expect(s.engine.state).toBe('playing');
    key('Enter');
  });
  it('never while typing: Space goes into a number being typed', () => {
    const t = box('[data-win="conducting"]', /^Tempo/);
    t.focus();
    key('Enter'); // edit
    key(' ');
    expect(s.engine.state).toBe('stopped');
    key('Escape');
    blur();
  });
  it('one source of truth: the Start / Pause tooltips and Keyboard Shortcuts show the registry keys', () => {
    expect(keyLabel('playPause')).toBe('Space');
    const tips = [...document.querySelectorAll<HTMLElement>('[data-win="conducting"] [title], [data-win="conducting"] [data-tip]')].map((e) => e.title || e.dataset.tip || '');
    expect(tips.some((t) => t.startsWith('Start') && t.includes(keyLabel('playPause')))).toBe(true);
    expect(tips.some((t) => t.startsWith('Pause') && t.includes(keyLabel('pause')))).toBe(true);
    key('h', { altKey: true });
    expect(win('shortcuts').textContent).toContain('Play / Pause');
  });
});

describe('MIDI Settings', () => {
  it('File ▸ MIDI Settings… (⌥M) — the old name is gone', () => {
    const t = [...document.querySelectorAll('#menubar .menu')].find((m) => m.firstChild?.textContent === 'File')!;
    t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const labels = [...document.querySelectorAll('.dropdown .item')].map((i) => i.children[0]?.textContent);
    const keys = Object.fromEntries([...document.querySelectorAll('.dropdown .item')].map((i) => [i.children[0]?.textContent, i.children[1]?.textContent ?? '']));
    window.dispatchEvent(new PointerEvent('pointerdown'));
    expect(labels).toContain('MIDI Settings…');
    expect(labels).not.toContain('Midi Assignment…');
    expect(keys['MIDI Settings…']).toBe(keyLabel('midiSettings'));
    blur();
    key('m', { altKey: true });
    expect(win('midiassign').classList.contains('hidden')).toBe(false);
    expect(win('midiassign').querySelector('.titlebar')?.textContent).toContain('MIDI Settings');
  });
  it('holds clock out and clock input, which work with Extended off; the Extended window has no clock', () => {
    const w = win('midiassign');
    const sw = (txt: string) => [...w.querySelectorAll<HTMLElement>('[role="switch"]')].find((e) => e.textContent!.includes(txt))!;
    s.comp.extended.enabled = false;
    s.comp.options.sendClock = false;
    ui.updateAll();
    pd(sw('Send clock'));
    expect(s.comp.options.sendClock).toBe(true); // the same setting as Options ▸ Send Clock
    pd(sw('Follow clock'));
    expect(s.comp.midi.clockIn.enabled).toBe(true);
    ui.updateAll();
    expect(w.textContent).toContain('Tempo: WAITING');
    s.midiIn('any', [0xfa], performance.now());
    expect(s.engine.state).toBe('playing');
    s.midiIn('any', [0xfc], performance.now());
    expect(s.engine.state).toBe('stopped');
    pd(sw('Follow clock'));
    pd(sw('Send clock'));
    expect(win('extended').textContent).not.toMatch(/clock/i);
  });
});

describe('mouse wheel and trackpad in the Pattern Editor', () => {
  const pe = () => ui.patternEditor as unknown as { scroll: number; low: number };
  const area = (n: number) => [...win('edit-pattern').querySelectorAll<HTMLElement>('.box')][n]; // 0 keyboard, 1 grid
  const wheel = (e: Element, init: WheelEventInit) => {
    const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
    // happy-dom's WheelEvent drops the modifier keys; a browser's has them
    for (const k of ['shiftKey', 'ctrlKey', 'metaKey', 'altKey'] as const) Object.defineProperty(ev, k, { value: !!init[k] });
    e.dispatchEvent(ev);
    return ev;
  };
  it('sideways → steps; plain wheel over the grid → pitches; ⇧ + wheel → steps; small deltas add up', () => {
    const p = s.pattern(0);
    p.steps = Array.from({ length: 80 }, (_, i) => [60 + (i % 7)]);
    p.scrambled = p.steps.map((_, i) => i);
    p.outputLength = 80;
    ui.openEditor('patternEditor', { voice: 0 });
    pe().scroll = 0;
    const low = pe().low;
    expect(wheel(area(1), { deltaX: 120 }).defaultPrevented).toBe(true);
    expect(pe().scroll).toBe(10);
    expect(pe().low).toBe(low);
    wheel(area(1), { deltaY: 100 });
    expect(pe().low).toBe(low - 5); // down = lower notes
    expect(pe().scroll).toBe(10);
    wheel(area(1), { deltaY: -120, shiftKey: true });
    expect(pe().scroll).toBe(0);
    for (let i = 0; i < 8; i++) wheel(area(1), { deltaX: 3 });
    expect(pe().scroll).toBe(2); // 24 px = two steps
    wheel(area(0), { deltaY: -40 }); // over the keyboard: pitches
    expect(pe().low).toBe(low - 3);
  });
  it('over the scroll bar the plain wheel scrolls the steps; lines (Firefox) are converted', () => {
    const bar = win('edit-pattern').querySelector<HTMLElement>('[title^="MIDI edit range"]')!;
    pe().scroll = 0;
    wheel(bar, { deltaY: 3, deltaMode: 1 }); // 3 lines
    expect(pe().scroll).toBe(4);
  });
  it('the wheel is not taken globally: ⌘/Ctrl-wheel (zoom) and other windows are left alone', () => {
    const before = { ...pe() };
    expect(wheel(area(1), { deltaY: 100, ctrlKey: true }).defaultPrevented).toBe(false);
    const tempo = box('[data-win="conducting"]', /^Tempo/);
    const t0 = s.comp.tempo.value;
    expect(wheel(tempo, { deltaY: 100 }).defaultPrevented).toBe(false);
    expect(wheel(win('variables'), { deltaX: 100 }).defaultPrevented).toBe(false);
    expect(s.comp.tempo.value).toBe(t0);
    expect({ ...pe() }).toEqual(before);
  });
});
