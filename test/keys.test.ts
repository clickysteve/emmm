// @vitest-environment happy-dom
/**
 * Keyboard: direct numerical entry (number boxes and range bars) and the shared keyboard
 * command table — no duplicates, no browser / system reserved combinations, labels.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chordLabel, findKey, KEYS, keyLabel, matches, type Chord } from '../src/ui/keys';
import { Numerical, RangeBar, typing } from '../src/ui/widgets';

let screen: HTMLDivElement;
beforeEach(() => {
  document.body.innerHTML = '';
  screen = document.createElement('div');
  screen.id = 'screen';
  document.body.appendChild(screen);
  typing.active = null;
});

const key = (e: Element, k: string, init: KeyboardEventInit = {}) => {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  e.dispatchEvent(ev);
  return ev;
};
const typeText = (e: Element, t: string) => [...t].forEach((ch) => key(e, ch));
const press = (e: Element) => e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientY: -1000 }));

function num(o: Partial<ConstructorParameters<typeof Numerical>[5]> = {}, start = 120) {
  let v = start;
  const sets: { v: number; final: boolean; alt: boolean }[] = [];
  const n = new Numerical(screen, 0, 0, 30, 15, {
    get: () => v,
    set: (x, i) => {
      v = x;
      sets.push({ v: x, final: i.final, alt: i.alt });
    },
    min: 20,
    max: 300,
    ...o,
  });
  return { n, sets, get v() { return v; } };
}

describe('number boxes: direct entry', () => {
  it('type 137, Enter: one final set (one Undo step), no step per digit', () => {
    const t = num();
    t.n.el.focus();
    typeText(t.n.el, '137');
    expect(t.n.editing).toBe(true);
    expect(t.n.el.textContent).toBe('137');
    expect(t.sets).toEqual([]); // nothing applied while typing
    key(t.n.el, 'Enter');
    expect(t.v).toBe(137);
    expect(t.sets).toEqual([{ v: 137, final: true, alt: false }]);
    expect(t.n.editing).toBe(false);
  });
  it('Enter starts an edit of the current value; the first key replaces it; Backspace edits', () => {
    const t = num();
    t.n.el.focus();
    key(t.n.el, 'Enter');
    expect(t.n.editing).toBe(true);
    expect(t.n.el.textContent).toBe('120');
    typeText(t.n.el, '99');
    key(t.n.el, 'Backspace');
    typeText(t.n.el, '0');
    key(t.n.el, 'Enter');
    expect(t.v).toBe(90);
  });
  it('Escape cancels: the value is unchanged and nothing was set', () => {
    const t = num();
    t.n.el.focus();
    typeText(t.n.el, '250');
    key(t.n.el, 'Escape');
    expect(t.v).toBe(120);
    expect(t.sets).toEqual([]);
    expect(t.n.el.textContent).toBe('120');
  });
  it('values outside the legal range are clamped to it', () => {
    const t = num();
    t.n.el.focus();
    typeText(t.n.el, '999');
    key(t.n.el, 'Enter');
    expect(t.v).toBe(300);
    typeText(t.n.el, '5');
    key(t.n.el, 'Enter');
    expect(t.v).toBe(20);
  });
  it('invalid input fails safely (no NaN, no set) and letters are refused', () => {
    const t = num();
    t.n.el.focus();
    typeText(t.n.el, '1-2');
    key(t.n.el, 'Enter');
    expect(t.v).toBe(120);
    expect(t.sets).toEqual([]);
    typeText(t.n.el, '4');
    key(t.n.el, 'x'); // refused, still editing
    expect(t.n.el.textContent).toBe('4');
    key(t.n.el, 'Enter');
    expect(t.v).toBe(20); // 4 clamped up to the minimum
    expect(t.sets.every((s) => Number.isFinite(s.v))).toBe(true);
  });
  it('↑ ↓ step, Shift = ten steps, Page Up / Down, Home / End = min / max', () => {
    const t = num();
    t.n.el.focus();
    key(t.n.el, 'ArrowUp');
    expect(t.v).toBe(121);
    key(t.n.el, 'ArrowDown', { shiftKey: true });
    expect(t.v).toBe(111);
    key(t.n.el, 'PageUp');
    expect(t.v).toBe(121);
    key(t.n.el, 'Home');
    expect(t.v).toBe(20);
    key(t.n.el, 'End');
    expect(t.v).toBe(300);
  });
  it('a value list (Time Base denominators) steps through legal values and snaps typed ones', () => {
    const t = num({ values: [0, 1, 2, 3, 4, 6, 8, 16], min: undefined, max: undefined }, 4);
    t.n.el.focus();
    key(t.n.el, 'ArrowUp');
    expect(t.v).toBe(6);
    key(t.n.el, 'End');
    expect(t.v).toBe(16);
    typeText(t.n.el, '7');
    key(t.n.el, 'Enter');
    expect([6, 8]).toContain(t.v);
  });
  it('a compound entry (n/d) goes to its own handler; refused entries change nothing', () => {
    const got: string[] = [];
    const t = num({ chars: '/sa', entry: (s) => (got.push(s), /^\d+\/\d+$/.test(s)) });
    t.n.el.focus();
    typeText(t.n.el, '3/8');
    key(t.n.el, 'Enter');
    typeText(t.n.el, '3/');
    key(t.n.el, 'Enter');
    expect(got).toEqual(['3/8', '3/']);
    expect(t.sets).toEqual([]);
  });
  it('while typing, keys never reach emmm’s shortcuts (digits, Space, letters, Enter)', () => {
    const t = num();
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    t.n.el.focus();
    typeText(t.n.el, '13');
    key(t.n.el, ' ');
    key(t.n.el, 'a');
    key(t.n.el, 'Enter');
    window.removeEventListener('keydown', seen);
    expect(seen).not.toHaveBeenCalled();
  });
  it('a selected (not typing) box lets Space, letters and Tab through to emmm', () => {
    const t = num();
    const seen: string[] = [];
    const l = (e: KeyboardEvent) => seen.push(e.key);
    window.addEventListener('keydown', l);
    t.n.el.focus();
    key(t.n.el, ' ');
    key(t.n.el, 'b');
    key(t.n.el, 'Tab');
    window.removeEventListener('keydown', l);
    expect(seen).toEqual([' ', 'b', 'Tab']);
  });
  it('a press selects the box (focus), so typing goes to it; pressing elsewhere commits', () => {
    const t = num();
    press(t.n.el);
    expect(document.activeElement).toBe(t.n.el);
    typeText(t.n.el, '200');
    t.n.el.blur();
    expect(t.v).toBe(200);
  });
  it('a clicked box lets go of the keyboard after 3 s without a key (Return and digits are M’s again); typing holds on', () => {
    vi.useFakeTimers();
    const t = num();
    press(t.n.el);
    expect(document.activeElement).toBe(t.n.el);
    vi.advanceTimersByTime(3100);
    expect(document.activeElement).not.toBe(t.n.el);
    press(t.n.el);
    typeText(t.n.el, '15');
    vi.advanceTimersByTime(10000); // still typing: kept
    expect(t.n.editing).toBe(true);
    key(t.n.el, 'Enter');
    expect(t.v).toBe(20); // 15 clamped to the minimum
    vi.advanceTimersByTime(3100);
    expect(document.activeElement).not.toBe(t.n.el);
    vi.useRealTimers();
  });
  it('only one control is typed into at a time', () => {
    const a = num();
    const b = num();
    a.n.el.focus();
    typeText(a.n.el, '50');
    b.n.beginEdit('7');
    expect(a.n.editing).toBe(false);
    expect(a.v).toBe(120); // the abandoned edit did not apply
    expect(b.n.editing).toBe(true);
  });
});

describe('range bars: direct entry', () => {
  function bar(single = false) {
    let r: [number, number] = [40, 100];
    const b = new RangeBar(screen, 0, 0, 100, 10, { min: 0, max: 127, get: () => r, set: (lo, hi) => (r = [lo, hi]), single });
    return { b, get r() { return r; } };
  }
  it('type "60-90", Enter', () => {
    const t = bar();
    t.b.el.focus();
    typeText(t.b.el, '60-90');
    key(t.b.el, 'Enter');
    expect(t.r).toEqual([60, 90]);
  });
  it('one number = a single value; reversed and out-of-range values are fixed', () => {
    const t = bar();
    t.b.el.focus();
    typeText(t.b.el, '70');
    key(t.b.el, 'Enter');
    expect(t.r).toEqual([70, 70]);
    typeText(t.b.el, '200-10');
    key(t.b.el, 'Enter');
    expect(t.r).toEqual([10, 127]);
  });
  it('arrows move the whole range, keeping its width; Escape cancels', () => {
    const t = bar();
    t.b.el.focus();
    key(t.b.el, 'ArrowUp', { shiftKey: true });
    expect(t.r).toEqual([50, 110]);
    key(t.b.el, 'End');
    expect(t.r).toEqual([67, 127]);
    typeText(t.b.el, '5');
    key(t.b.el, 'Escape');
    expect(t.r).toEqual([67, 127]);
  });
  it('a single-value bar (Mutation strength) takes one number only', () => {
    const t = bar(true);
    t.b.el.focus();
    typeText(t.b.el, '25');
    key(t.b.el, 'Enter');
    expect(t.r[1]).toBe(25);
    key(t.b.el, 'ArrowUp');
    expect(t.r[1]).toBe(26);
  });
});

describe('the keyboard command table', () => {
  const ev = (code: string, m: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {}, key = '') =>
    new KeyboardEvent('keydown', { code, key: key || code, metaKey: !!m.meta, ctrlKey: !!m.ctrl, altKey: !!m.alt, shiftKey: !!m.shift });
  it('no two commands share a key', () => {
    const all = KEYS.flatMap((d) => d.keys.map((k) => JSON.stringify([k.key, !!k.mod, !!k.alt, !!k.shift])));
    expect(new Set(all).size).toBe(all.length);
  });
  it('no command uses a plain key (those are M’s performance keys)', () => {
    for (const d of KEYS) for (const k of d.keys) expect(k.mod || k.alt, d.id).toBeTruthy();
  });
  it('nothing collides with browser- or system-reserved combinations', () => {
    const reserved: Chord[] = [
      ...['KeyN', 'KeyT', 'KeyW', 'KeyQ', 'KeyH', 'KeyP', 'KeyF', 'KeyR', 'KeyY', 'KeyJ', 'KeyE', 'KeyG'].map((k) => ({ key: k, mod: true })),
      ...['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'].map((k) => ({ key: k, mod: true })),
      ...['KeyN', 'KeyT', 'KeyW', 'KeyB', 'KeyO', 'KeyJ', 'KeyI', 'KeyC', 'Digit3', 'Digit4', 'Digit5', 'KeyQ', 'KeyA'].map((k) => ({ key: k, mod: true, shift: true })),
      ...['KeyI', 'KeyJ', 'KeyC', 'KeyU', 'KeyD', 'KeyH', 'KeyM', 'KeyW', 'KeyL', 'KeyB', 'KeyP', 'Escape'].map((k) => ({ key: k, mod: true, alt: true })),
      // Windows: Alt+D address bar, Alt+E / Alt+F browser menu, Alt+Home; Mac accent dead keys
      ...['KeyD', 'KeyE', 'KeyF', 'Home', 'KeyI', 'KeyN', 'KeyU', 'Backquote'].map((k) => ({ key: k, alt: true })),
      { key: 'Tab', mod: true },
    ];
    const id = (k: Chord) => JSON.stringify([k.key, !!k.mod, !!k.alt, !!k.shift]);
    const bad = new Set(reserved.map(id));
    for (const d of KEYS)
      for (const k of d.keys)
        if (!(d.id === 'metronome' && k.key === 'KeyM')) expect(bad.has(id(k)), `${d.id} ${chordLabel(k, true)}`).toBe(false);
  });
  it('labels in Mac and PC style', () => {
    expect(chordLabel({ key: 'KeyZ', mod: true, shift: true }, true)).toBe('⇧⌘Z');
    expect(chordLabel({ key: 'KeyZ', mod: true, shift: true }, false)).toBe('Ctrl+Shift+Z');
    expect(chordLabel({ key: 'Backspace', mod: true }, true)).toBe('⌘⌫');
    expect(chordLabel({ key: 'KeyP', alt: true }, true)).toBe('⌥P');
    expect(chordLabel({ key: 'Enter', alt: true }, false)).toBe('Alt+Enter');
    expect(keyLabel('nope')).toBe('');
  });
  it('matches by physical key: ⌥P on a Mac types "π" but is still ⌥P; extra modifiers do not match', () => {
    expect(findKey(ev('KeyP', { alt: true }, 'π'), true)?.id).toBe('patternsWindow');
    expect(findKey(ev('KeyP', { alt: true, shift: true }, 'Π'), true)).toBeUndefined();
    expect(findKey(ev('KeyZ', { meta: true }, 'z'), true)?.id).toBe('undo');
    expect(findKey(ev('KeyZ', { ctrl: true }, 'z'), true)).toBeUndefined(); // ⌃Z is not ⌘Z on the Mac
    expect(findKey(ev('KeyZ', { ctrl: true }, 'z'), false)?.id).toBe('undo'); // Ctrl+Z elsewhere
    expect(matches(ev('Backspace', { meta: true }, 'Backspace'), { key: 'Backspace', mod: true }, true)).toBe(true);
  });
});
