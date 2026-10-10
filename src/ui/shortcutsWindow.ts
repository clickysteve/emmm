/**
 * Keyboard Shortcuts (emmm ▸ Keyboard Shortcuts…, ⌥H): every key, from the same table the
 * keyboard dispatcher and the menus use, so it is always current.
 */
import { chordLabel, KEYS, NUMBER_KEYS, PATTERN_EDITOR_KEYS, PERFORMANCE_KEYS } from './keys';
import { el } from './dom';
import { MWindow } from './widgets';

const esc = (t: string) => t.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!);

export class ShortcutsWindow {
  win: MWindow;
  constructor(parent: HTMLElement) {
    this.win = new MWindow(parent, { id: 'shortcuts', title: 'Keyboard Shortcuts', x: 150, y: 20, w: 430, h: 446, closable: true });
    const t = el('div', 'label shortcuts', this.win.body, [6, 4, 418, 420]);
    t.style.whiteSpace = 'normal';
    t.style.overflowY = 'auto';
    t.style.pointerEvents = 'auto';
    const table = (rows: [string, string][]) => `<table>${rows.map(([k, d]) => `<tr><td class="k">${esc(k)}</td><td>${esc(d)}</td></tr>`).join('')}</table>`;
    const groups = [...new Set(KEYS.map((k) => k.group))];
    const group = (g: string) => table(KEYS.filter((k) => k.group === g).map((k) => [k.keys.map((c) => chordLabel(c)).join('  or  '), k.label]));
    let html = `<b>Transport</b> (whenever you are not typing a number; emmm: Return = Play / Pause, Space = Stop / Play — in M Space was Start / Sync and Return Stop)${group('Transport')}`;
    html += `<b>Performing</b> (M's own keys)${table(PERFORMANCE_KEYS)}`;
    for (const g of groups.filter((g) => g !== 'Transport')) html += `<b>${esc(g)}</b>${group(g)}`;
    html += `<b>Pattern Editor</b> (when it is the front window)${table(PATTERN_EDITOR_KEYS)}`;
    html += `<b>Numbers and ranges</b>${table(NUMBER_KEYS)}`;
    t.innerHTML = html;
  }

  update(): void {}
}
