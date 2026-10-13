// @vitest-environment happy-dom
/**
 * Cell editing: a click on a number box (or a note-picture box) only selects it — M's
 * "top half up, bottom half down" press is gone. Then ↑ ↓ step through the parameter's own
 * values, typing + Return sets one, Escape cancels. Dragging outside is still a slider.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Session } from '../src/app/session';
import { OCTAVE_RATES } from '../src/engine/constants';
import { Numerical, type NumericalOpts } from '../src/ui/widgets';

/** a press at the very top (dy < 0) or bottom of a box: M stepped up / down here */
const press = (e: Element, clientY: number, init: PointerEventInit = {}) => e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientY, pointerId: 1, ...init }));
const release = (e: Element, clientY: number) => e.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientY, pointerId: 1 }));
const click = (e: Element, clientY = -9999) => (press(e, clientY), release(e, clientY));
function key(k: string, init: KeyboardEventInit = {}) {
  const target = (document.activeElement as HTMLElement) ?? document.body;
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
}
const type = (t: string) => [...t].forEach((ch) => key(ch));
const blur = () => (document.activeElement as HTMLElement)?.blur?.();
afterEach(blur);

function box(o: Partial<NumericalOpts> & { v: number }) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const st = { v: o.v, sets: 0 };
  const n = new Numerical(parent, 0, 0, 30, 14, { get: () => st.v, set: (x) => ((st.v = x), st.sets++), ...o });
  return { n, st };
}

describe('the Numerical widget', () => {
  it('a click in either half selects without changing the value; the box is outlined (focused)', () => {
    const { n, st } = box({ v: 5, min: 0, max: 9 });
    click(n.el, -9999); // top half: M stepped up
    click(n.el, 9999); // bottom half: M stepped down
    expect(st.v).toBe(5);
    expect(st.sets).toBe(0);
    expect(document.activeElement).toBe(n.el);
  });

  it('↑ ↓ step by one within min / max (signed range)', () => {
    const { n, st } = box({ v: -1, min: -2, max: 2 });
    click(n.el);
    key('ArrowUp');
    expect(st.v).toBe(0);
    key('ArrowDown');
    key('ArrowDown');
    key('ArrowDown');
    expect(st.v).toBe(-2); // held at the minimum
    for (let i = 0; i < 9; i++) key('ArrowUp');
    expect(st.v).toBe(2); // and the maximum
  });

  it('a value list steps through its own values, not by 1', () => {
    const { n, st } = box({ v: 4, values: [1, 2, 4, 8, 16], format: () => '' });
    click(n.el);
    key('ArrowUp');
    expect(st.v).toBe(8);
    key('ArrowDown');
    key('ArrowDown');
    expect(st.v).toBe(2);
  });

  it('typing + Return commits; Escape cancels and keeps the old value; invalid text is refused', () => {
    const { n, st } = box({ v: 50, min: 0, max: 100 });
    click(n.el);
    type('73');
    expect(n.editing).toBe(true);
    expect(st.v).toBe(50); // nothing changes until Return
    key('Enter');
    expect(st.v).toBe(73);
    type('12');
    key('Escape');
    expect(st.v).toBe(73);
    expect(n.editing).toBe(false);
    type('250');
    key('Enter');
    expect(st.v).toBe(100); // clamped to the parameter's range
    key('Enter'); // edit the current value
    type('.');
    key('Enter');
    expect(st.v).toBe(100); // "." alone is not a number: refused
  });

  it('only the selected box responds: ↑ elsewhere does nothing', () => {
    const a = box({ v: 3, min: 0, max: 9 });
    const b = box({ v: 3, min: 0, max: 9 });
    click(a.n.el);
    key('ArrowUp');
    expect([a.st.v, b.st.v]).toEqual([4, 3]);
    blur();
    key('ArrowUp');
    expect([a.st.v, b.st.v]).toEqual([4, 3]);
  });

  it('dragging up outside the box is still the slider; Hold/Do intercepts still take the click', () => {
    const { n, st } = box({ v: 10, min: 0, max: 99 });
    press(n.el, 0);
    n.el.dispatchEvent(new PointerEvent('pointermove', { clientY: -30, pointerId: 1 }));
    release(n.el, -30);
    expect(st.v).toBe(20); // 30 px up at 3 px per unit
    let taken = 0;
    const h = box({ v: 1, min: 0, max: 9, intercept: () => (taken++, true) });
    click(h.n.el);
    expect([taken, h.st.v]).toEqual([1, 1]);
  });

  it('Shift-click still pastes the last value (S1 Appendix A)', () => {
    const a = box({ v: 3, min: 0, max: 99 });
    click(a.n.el);
    type('42');
    key('Enter');
    const b = box({ v: 7, min: 0, max: 99 });
    click(b.n.el, -9999);
    expect(b.st.v).toBe(7);
    press(b.n.el, 0, { shiftKey: true });
    expect(b.st.v).toBe(42);
  });
});

describe('real cells in the app', () => {
  let s: Session;
  beforeAll(async () => {
    await import('../src/main');
    s = (window as unknown as { emmm: Session }).emmm;
    document.querySelector('.mdialog')?.remove();
  });
  const cell = (root: string, tip: RegExp) => [...document.querySelectorAll<HTMLDivElement>(`${root} .num[role="spinbutton"]`)].find((e) => tip.test(e.title || e.dataset.tip || ''))!;
  const update = () => (window as unknown as { emmmUi: { updateAll: () => void } }).emmmUi.updateAll();

  it('Tempo: click, ↑ ↓, type', () => {
    const t = cell('[data-win="conducting"]', /^Tempo/);
    const v0 = s.comp.tempo.value;
    click(t, -9999);
    expect(s.comp.tempo.value).toBe(v0);
    key('ArrowUp');
    expect(s.comp.tempo.value).toBe(v0 + 1);
    key('ArrowDown');
    key('ArrowDown');
    expect(s.comp.tempo.value).toBe(v0 - 1);
    type('140');
    key('Enter');
    expect(s.comp.tempo.value).toBe(140);
  });

  it('note-picture cells (Sync ratio beside Tempo, Robot rate): arrows through the note values, pictures kept', () => {
    const ratio = cell('[data-win="conducting"]', /^Sync \/ Metronome ratio/);
    s.comp.syncRatio = 4;
    update();
    click(ratio, 9999);
    expect(s.comp.syncRatio).toBe(4);
    key('ArrowUp');
    expect(s.comp.syncRatio).toBe(6);
    key('ArrowDown');
    key('ArrowDown');
    expect(s.comp.syncRatio).toBe(3);
    update();
    expect(ratio.querySelector('svg')).not.toBeNull(); // still a note picture, not a number
    const rate = cell('[data-win="conducting"]', /^Robot rate/);
    s.comp.conducting.robot.rate = 1;
    update();
    click(rate, -9999);
    expect(s.comp.conducting.robot.rate).toBe(1);
    key('ArrowUp');
    key('ArrowUp');
    expect(s.comp.conducting.robot.rate).toBe(4);
    type('8');
    key('Enter');
    expect(s.comp.conducting.robot.rate).toBe(8);
    key('ArrowUp');
    expect(s.comp.conducting.robot.rate).toBe(8); // the last note value
    update();
    expect(rate.querySelector('svg')).not.toBeNull();
  });

  it('Octave Note Rate still works: click selects, ↑ ↓ through 1 2 3 4 8 16, typing sets', () => {
    const ui = (window as unknown as { emmmUi: { openEditor: (n: string, o?: object) => void } }).emmmUi;
    s.comp.extended.enabled = true;
    s.changed('extended');
    ui.openEditor('octave');
    const rb = document.querySelector<HTMLDivElement>('[data-win="edit-octave"] .num.octrate[data-voice="0"]')!;
    const before = structuredClone(s.comp.octave.rates);
    click(rb, -9999);
    expect(s.comp.octave.rates).toEqual(before);
    key('ArrowUp');
    const p = s.comp.octave.rates.findIndex((r, i) => r[0] !== before[i][0]); // the edited Position
    expect(s.comp.octave.rates[p][0]).toBe(OCTAVE_RATES[OCTAVE_RATES.indexOf(before[p][0]) + 1]);
    type('16');
    key('Enter');
    expect(s.comp.octave.rates[p][0]).toBe(16);
  });

  it('a selected cell keeps Snapshot letters out only while typing', () => {
    const t = cell('[data-win="conducting"]', /^Tempo/);
    click(t);
    type('1');
    const ev = key('s');
    expect(ev.defaultPrevented).toBe(true); // taken (refused) by the box being typed
    key('Escape');
  });
});
