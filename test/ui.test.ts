// @vitest-environment happy-dom
/**
 * The shared emmm selector (mouse, keyboard, dynamic choices), dialogs and tooltips, and
 * MIDI Assignment's device selectors keeping routing exactly as chosen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prefs } from '../src/app/prefs';
import { Session } from '../src/app/session';
import { demoComposition } from '../src/engine/defaults';
import type { UiContext } from '../src/ui/context';
import { alertDialog, closeDialog, confirmDialog, promptDialog } from '../src/ui/dialogs';
import { MidiAssignmentWindow } from '../src/ui/otherWindows';
import { closeSelectors, Selector, type SelectorOption } from '../src/ui/selector';
import { installTooltips } from '../src/ui/tooltip';

let screen: HTMLDivElement;
beforeEach(() => {
  document.body.innerHTML = '';
  screen = document.createElement('div');
  screen.id = 'screen';
  document.body.appendChild(screen);
});
afterEach(() => closeSelectors());

const down = (e: Element, init: PointerEventInit = {}) => e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, ...init }));
const key = (e: Element, k: string, init: KeyboardEventInit = {}) => {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  e.dispatchEvent(ev);
  return ev;
};
const list = () => document.querySelector('.msel-list');
const items = () => [...document.querySelectorAll<HTMLDivElement>('.msel-item')];

function make(opts: SelectorOption[] | (() => SelectorOption[]), start = 'b') {
  let value = start;
  const changes: string[] = [];
  const sel = new Selector(screen, 10, 10, 60, 13, {
    label: 'Test selector',
    options: typeof opts === 'function' ? opts : () => opts,
    value: () => value,
    onChange: (v) => {
      value = v;
      changes.push(v);
    },
    missingText: (v) => `${v} (not connected)`,
  });
  return { sel, changes, get value() { return value; } };
}
const ABC: SelectorOption[] = [
  { value: 'a', text: 'Alpha' },
  { value: 'b', text: 'Bravo' },
  { value: 'c', text: 'Charlie' },
];

describe('Selector: mouse', () => {
  it('shows the current choice, opens on press, picks on click, closes', () => {
    const t = make(ABC);
    expect(t.sel.el.textContent).toBe('Bravo');
    expect(t.sel.el.getAttribute('role')).toBe('combobox');
    down(t.sel.el);
    expect(list()).not.toBeNull();
    expect(t.sel.el.getAttribute('aria-expanded')).toBe('true');
    expect(items().map((i) => i.textContent)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(items()[1].classList.contains('checked')).toBe(true);
    items()[2].click();
    expect(t.changes).toEqual(['c']);
    expect(list()).toBeNull();
    expect(t.sel.el.textContent).toBe('Charlie');
  });
  it('choosing the current value again changes nothing; pressing elsewhere closes', () => {
    const t = make(ABC);
    down(t.sel.el);
    items()[1].click();
    expect(t.changes).toEqual([]);
    down(t.sel.el);
    down(document.body);
    expect(list()).toBeNull();
    expect(t.changes).toEqual([]);
  });
  it('only one list is ever open', () => {
    const a = make(ABC);
    const b = make(ABC);
    down(a.sel.el);
    down(b.sel.el);
    expect(document.querySelectorAll('.msel-list')).toHaveLength(1);
    expect(a.sel.isOpen).toBe(false);
    expect(b.sel.isOpen).toBe(true);
  });
});

describe('Selector: keyboard', () => {
  it('↓ opens, ↑ ↓ move, Enter chooses', () => {
    const t = make(ABC, 'a');
    t.sel.el.focus();
    key(t.sel.el, 'ArrowDown');
    expect(t.sel.isOpen).toBe(true);
    key(t.sel.el, 'ArrowDown');
    key(t.sel.el, 'ArrowDown');
    key(t.sel.el, 'ArrowUp');
    expect(items()[1].classList.contains('hot')).toBe(true);
    expect(t.sel.el.getAttribute('aria-activedescendant')).toBe(items()[1].id);
    key(t.sel.el, 'Enter');
    expect(t.changes).toEqual(['b']);
    expect(t.sel.isOpen).toBe(false);
    expect(document.activeElement).toBe(t.sel.el); // keyboard choice keeps focus
  });
  it('Escape closes without changing; a second Escape gives the keys back to emmm', () => {
    const t = make(ABC);
    t.sel.el.focus();
    key(t.sel.el, ' ');
    key(t.sel.el, 'ArrowDown');
    key(t.sel.el, 'Escape');
    expect(t.sel.isOpen).toBe(false);
    expect(t.changes).toEqual([]);
    key(t.sel.el, 'Escape');
    expect(document.activeElement).not.toBe(t.sel.el);
  });
  it('Home / End and type-ahead', () => {
    const t = make(ABC);
    t.sel.el.focus();
    key(t.sel.el, 'Enter');
    key(t.sel.el, 'End');
    expect(items()[2].classList.contains('hot')).toBe(true);
    key(t.sel.el, 'Home');
    expect(items()[0].classList.contains('hot')).toBe(true);
    key(t.sel.el, 'c');
    expect(items()[2].classList.contains('hot')).toBe(true);
  });
  it('type-ahead includes spaces while typing (a space is not “choose” mid-word)', () => {
    const t = make(
      [
        { value: 'p', text: 'Pattern Group' },
        { value: 'v1', text: 'Variables · Note Density' },
        { value: 'v2', text: 'Variables · Transposition' },
      ],
      'p',
    );
    t.sel.el.focus();
    for (const ch of 'Variables · Tr') key(t.sel.el, ch);
    key(t.sel.el, 'Enter');
    expect(t.changes).toEqual(['v2']);
  });
  it('keys typed at a selector never reach emmm’s performance shortcuts (Space = Start)', () => {
    const t = make(ABC);
    const spy = vi.fn();
    window.addEventListener('keydown', spy);
    t.sel.el.focus();
    key(t.sel.el, ' ');
    key(t.sel.el, 'Enter');
    window.removeEventListener('keydown', spy);
    expect(spy).not.toHaveBeenCalled();
  });
  it('disabled choices are skipped and cannot be chosen', () => {
    const t = make(
      [
        { value: 'a', text: 'A' },
        { value: 'x', text: 'off', disabled: true },
        { value: 'c', text: 'C' },
      ],
      'a',
    );
    t.sel.el.focus();
    key(t.sel.el, 'ArrowDown');
    key(t.sel.el, 'ArrowDown');
    expect(items()[2].classList.contains('hot')).toBe(true);
    items()[1].click();
    expect(t.changes).toEqual([]);
  });
});

describe('Selector: dynamic choices and long names', () => {
  it('a device connected or removed while open appears / disappears; a missing value is shown as such', () => {
    const devices: SelectorOption[] = [{ value: 'iac', text: 'IAC Driver Bus 1' }];
    const t = make(() => devices, 'iac');
    down(t.sel.el);
    expect(items()).toHaveLength(1);
    devices.push({ value: 'long', text: 'A Very Long MIDI Interface Name With Many Ports (Port 7 of 8)' });
    t.sel.update();
    expect(items().map((i) => i.textContent)).toContain('A Very Long MIDI Interface Name With Many Ports (Port 7 of 8)');
    expect(items()[1].title).toBe('A Very Long MIDI Interface Name With Many Ports (Port 7 of 8)'); // full name on hover
    devices.splice(0, 1); // the chosen device is unplugged
    t.sel.update();
    expect(t.sel.el.textContent).toBe('iac (not connected)');
    expect(t.sel.el.classList.contains('missing')).toBe(true);
    expect(items()[0].classList.contains('disabled')).toBe(true);
    expect(t.value).toBe('iac'); // nothing was changed behind the user's back
  });
});

describe('MIDI Assignment selectors keep routing exactly as chosen', () => {
  function setup() {
    const s = new Session(demoComposition(1));
    const ports = [
      { id: 'iac-1', name: 'IAC Driver Bus 1' },
      { id: 'synth-long', name: 'Elektron Analog Four MKII — Port 1 (very long name indeed)' },
    ];
    (s.midi as unknown as { outputs: () => typeof ports }).outputs = () => ports;
    (s.midi as unknown as { inputs: () => typeof ports }).inputs = () => [{ id: 'kbd', name: 'Keystation 49' }];
    const sent: [string, number[]][] = [];
    (s.midi as unknown as { send: (p: string, b: number[]) => void }).send = (p, b) => sent.push([p, [...b]]);
    const ctx = { s, screen, prefs: new Prefs(null), flash: { pattern: [], cycle: { rhythm: [], legato: [], accent: [] }, notes: [] }, now: () => 0, openEditor: () => {}, alert: () => {} } as unknown as UiContext;
    const w = new MidiAssignmentWindow(ctx, screen);
    w.win.show();
    w.update();
    return { s, w, ports, sent };
  }
  it('choosing an output device sets that M Output Channel’s port and nothing else', () => {
    const { s, w } = setup();
    const before = structuredClone(s.comp.midi);
    const outSel = w.win.el.querySelectorAll<HTMLDivElement>('.msel')[1 + 2 * 4]; // row 5: input, output
    expect(outSel.getAttribute('aria-label')).toBe('Output Channel 5: port / device');
    down(outSel);
    const choice = items().find((i) => i.textContent === 'Elektron Analog Four MKII — Port 1 (very long name indeed)')!;
    choice.click();
    expect(s.comp.midi.outputs[4].port).toBe('synth-long');
    expect(s.comp.midi.outputs[4].channel).toBe(before.outputs[4].channel);
    const rest = structuredClone(s.comp.midi);
    rest.outputs[4] = before.outputs[4];
    expect(rest).toEqual(before);
  });
  it('notes on that channel go to that device (on its MIDI channel)', () => {
    const { s, w, sent } = setup();
    const outSel = w.win.el.querySelectorAll<HTMLDivElement>('.msel')[1];
    down(outSel);
    items().find((i) => i.textContent === 'IAC Driver Bus 1')!.click();
    s.comp.midi.outputs[0].channel = 3;
    (s as unknown as { send: (c: number, b: number[], ms: number) => void }).send(1, [0x90, 60, 100], 0);
    expect(sent).toEqual([['iac-1', [0x92, 60, 100]]]);
  });
  it('All outputs → sets 1–16 to one device on channels 1–16', () => {
    const { s, w } = setup();
    const all = [...w.win.el.querySelectorAll<HTMLDivElement>('.msel')].find((e) => e.getAttribute('aria-label')!.startsWith('All outputs'))!;
    expect(all.textContent).toBe('choose a device…');
    down(all);
    items().find((i) => i.textContent === 'IAC Driver Bus 1')!.click();
    expect(s.comp.midi.outputs.map((o) => [o.port, o.channel])).toEqual(Array.from({ length: 16 }, (_, i) => ['iac-1', i + 1]));
  });
  it('input selectors and Send Sync use the same component; no native <select> is left', () => {
    const { w } = setup();
    expect(w.win.el.querySelectorAll('select')).toHaveLength(0);
    expect(w.win.el.querySelectorAll('.msel').length).toBe(16 + 16 + 1 + 1);
  });
});

describe('dialogs (instead of the browser’s confirm / prompt)', () => {
  it('confirm: OK resolves true, Escape resolves false', async () => {
    const p = confirmDialog(screen, 'Sure?', 'Do it');
    const btns = [...screen.querySelectorAll<HTMLButtonElement>('.mdialog button')];
    expect(btns.map((b) => b.textContent)).toEqual(['Cancel', 'Do it']);
    btns[1].click();
    expect(await p).toBe(true);
    const q = confirmDialog(screen, 'Again?');
    key(screen.querySelector('.mdialog')!, 'Escape');
    expect(await q).toBe(false);
    expect(screen.querySelector('.mdialog')).toBeNull();
  });
  it('prompt returns the text; Cancel returns null; one dialog at a time', async () => {
    const p = promptDialog(screen, 'Name:', 'Untitled');
    const input = screen.querySelector<HTMLInputElement>('.mdialog input')!;
    input.value = 'My Piece';
    key(screen.querySelector('.mdialog')!, 'Enter');
    expect(await p).toBe('My Piece');
    const a = promptDialog(screen, 'x', 'y');
    void alertDialog(screen, 'second');
    expect(await a).toBeNull(); // replaced → cancelled
    expect(screen.querySelectorAll('.mdialog')).toHaveLength(1);
    expect(closeDialog()).toBe(true);
  });
});

describe('tooltips', () => {
  it('adopt a control’s title (no system tooltip), show it in emmm style after a pause, hide on press', async () => {
    vi.useFakeTimers();
    const layer = installTooltips(screen, () => 1);
    const b = document.createElement('div');
    b.title = 'Time Base numerator';
    screen.appendChild(b);
    b.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 5, clientY: 5 }));
    expect(b.hasAttribute('title')).toBe(false);
    expect(b.dataset.tip).toBe('Time Base numerator');
    const tip = screen.querySelector('.mtip')!;
    expect(tip.classList.contains('hidden')).toBe(true);
    vi.advanceTimersByTime(600);
    expect(tip.classList.contains('hidden')).toBe(false);
    expect(tip.textContent).toBe('Time Base numerator');
    expect(getComputedStyle(tip).pointerEvents).toBe('none'); // never blocks editing
    window.dispatchEvent(new PointerEvent('pointerdown'));
    expect(tip.classList.contains('hidden')).toBe(true);
    layer.enabled = false;
    vi.useRealTimers();
  });
});
