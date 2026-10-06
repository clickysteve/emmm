/**
 * Palette window (emmm, Options ▸ Palette…): choose, edit, save and exchange colour palettes.
 * Purely cosmetic: nothing here touches the Session or the composition.
 */
import { downloadBytes, pickFile } from '../persistence/storage';
import { el, label } from './dom';
import {
  applyPalette,
  contrastWarnings,
  exportPalette,
  importPalette,
  normHex,
  PaletteError,
  type PaletteLibrary,
  ROLE_INFO,
  ROLES,
  type Role,
} from './palette';
import { MWindow } from './widgets';

const ROW_Y = 16;
const ROW_H = 17;

export class PaletteWindow {
  win: MWindow;
  private list: HTMLDivElement;
  private name: HTMLInputElement;
  private status: HTMLDivElement;
  private rows = new Map<Role, { swatch: HTMLDivElement; picker: HTMLInputElement; hex: HTMLInputElement; warn: HTMLDivElement }>();
  private btns: Record<'duplicate' | 'delete' | 'import' | 'export' | 'classic', HTMLButtonElement>;
  private deleteArmed = 0;

  constructor(
    private lib: PaletteLibrary,
    parent: HTMLElement,
  ) {
    this.win = new MWindow(parent, { id: 'palette', title: 'Palette', x: 200, y: 80, w: 304, h: 262, closable: true });
    const b = this.win.body;
    // keys typed here are for the text fields, not emmm's keyboard shortcuts
    b.addEventListener('keydown', (e) => e.stopPropagation());

    label(b, 6, 4, 'Palettes', 'small');
    this.list = el('div', 'box', b, [6, 16, 112, 112]);
    this.list.style.overflowY = 'auto';
    this.list.style.background = 'var(--paper)';
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', 'Palettes');

    label(b, 6, 133, 'Name', 'tiny');
    this.name = el('input', 'mtext', b, [6, 142, 112, 16]);
    this.name.style.position = 'absolute';
    this.name.setAttribute('aria-label', 'Palette name');
    this.name.addEventListener('focus', () => this.name.select());
    const rename = () => {
      const p = this.lib.selected;
      if (!p.builtIn && this.lib.rename(p.id, this.name.value)) this.refresh();
      else this.name.value = p.name;
    };
    this.name.addEventListener('change', rename);
    this.name.addEventListener('keydown', (e) => e.key === 'Enter' && (rename(), this.name.blur()));

    const btn = (x: number, y: number, w: number, t: string, title: string, f: () => void) => {
      const d = el('button', 'mbutton', b, [x, y, w, 17], t);
      d.style.position = 'absolute';
      d.style.padding = '0';
      d.title = title;
      d.addEventListener('click', f);
      return d;
    };
    this.btns = {
      duplicate: btn(6, 164, 54, 'Duplicate', 'Make an editable copy of this palette', () => this.say(`Made “${this.lib.duplicate(this.lib.selectedId).name}”.`, true)),
      delete: btn(64, 164, 54, 'Delete', 'Delete this custom palette', () => this.remove()),
      import: btn(6, 185, 54, 'Import…', 'Load a palette file (.emmm-palette.json)', () => void this.importFile()),
      export: btn(64, 185, 54, 'Export…', 'Save this palette as a file', () => this.exportFile()),
      classic: btn(6, 206, 112, 'Back to Classic', 'Use the original black-and-white look', () => this.say('Classic palette.', this.lib.resetToClassic())),
    };

    label(b, 128, 4, 'Colours', 'small');
    ROLES.forEach((role, i) => {
      const y = ROW_Y + i * ROW_H;
      const info = ROLE_INFO[role];
      const l = label(b, 128, y + 3, info.label, 'small');
      l.title = info.help;
      const swatch = el('div', 'box', b, [194, y, 22, 14]);
      swatch.title = `${info.label}: ${info.help} — click to pick a colour`;
      swatch.setAttribute('role', 'button');
      swatch.tabIndex = 0;
      // the browser's colour picker, opened from the swatch
      const picker = el('input', '', swatch);
      picker.type = 'color';
      Object.assign(picker.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', opacity: '0', border: '0', padding: '0', cursor: 'default' });
      picker.setAttribute('aria-label', `${info.label} colour`);
      picker.addEventListener('input', () => this.set(role, picker.value));
      swatch.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && picker.click());
      const hex = el('input', 'mtext', b, [220, y, 60, 14]);
      hex.style.position = 'absolute';
      hex.style.padding = '0 3px';
      hex.spellcheck = false;
      hex.addEventListener('focus', () => hex.select());
      hex.maxLength = 7;
      hex.setAttribute('aria-label', `${info.label} hex colour`);
      hex.addEventListener('input', () => /^#?[0-9a-f]{6}$/i.test(hex.value.trim()) && this.set(role, hex.value, false));
      const commit = () => {
        if (normHex(hex.value)) this.set(role, hex.value);
        else {
          this.say(`“${hex.value}” is not a colour. Use a hex value such as #1d6a86.`);
          hex.value = this.lib.selected.colors[role];
        }
      };
      hex.addEventListener('change', commit);
      hex.addEventListener('keydown', (e) => e.key === 'Enter' && (commit(), hex.blur()));
      const warn = el('div', 'label', b, [284, y + 3, 12, 10], '!');
      warn.style.fontWeight = '600';
      this.rows.set(role, { swatch, picker, hex, warn });
    });
    this.status = el('div', 'label tiny', b, [6, 227, 292, 14]);
    this.status.style.whiteSpace = 'normal';
    this.status.style.lineHeight = '8px';
    this.status.setAttribute('aria-live', 'polite');
  }

  private set(role: Role, value: string, rewriteHex = true): void {
    const wasBuiltIn = this.lib.selected.builtIn;
    const p = this.lib.setColor(role, value);
    this.applySoon();
    if (wasBuiltIn && !p.builtIn) this.say(`Built-in palettes stay as they are: editing “${p.name}”.`);
    this.refresh(rewriteHex ? undefined : role);
  }

  /** Live edits (a colour picker drag fires many events) restyle at most once per frame. */
  private frame = 0;
  private applySoon(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      applyPalette(this.lib.selected.colors);
    });
  }

  private say(text: string, refresh: unknown = false): void {
    if (refresh) {
      applyPalette(this.lib.selected.colors);
      this.refresh();
    }
    this.status.textContent = text;
  }

  private remove(): void {
    const p = this.lib.selected;
    if (p.builtIn) return;
    // two clicks to delete (no system dialog)
    if (performance.now() - this.deleteArmed > 3000) {
      this.deleteArmed = performance.now();
      this.btns.delete.textContent = 'Sure?';
      setTimeout(() => (this.btns.delete.textContent = 'Delete'), 3000);
      return;
    }
    this.deleteArmed = 0;
    this.btns.delete.textContent = 'Delete';
    this.lib.remove(p.id);
    this.say(`Deleted “${p.name}”.`, true);
  }

  private exportFile(): void {
    const p = this.lib.selected;
    const safe = p.name.replace(/[^\w\- ]+/g, '').trim() || 'palette';
    downloadBytes(`${safe}.emmm-palette.json`, exportPalette(p), 'application/json');
    this.say(`Exported “${p.name}”.`);
  }

  private async importFile(): Promise<void> {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    try {
      const r = importPalette(await f.text());
      const p = this.lib.addImported(r);
      let msg = `Imported “${p.name}”.`;
      if (r.filled.length) msg += ` Missing or unreadable: ${r.filled.map((x) => ROLE_INFO[x].label).join(', ')} (Classic used).`;
      this.say(msg, true);
    } catch (e) {
      this.say('Could not import: ' + (e instanceof PaletteError ? e.message : 'the file could not be read.'));
    }
  }

  /** Redraw the list and the colour rows from the library. `editing` keeps that hex field as typed. */
  refresh(editing?: Role): void {
    const sel = this.lib.selected;
    this.list.innerHTML = '';
    for (const p of this.lib.all()) {
      const d = el('div', 'label', this.list, undefined, p.name + (p.builtIn ? '' : ' *'));
      Object.assign(d.style, { position: 'relative', padding: '2px 4px', overflow: 'hidden', textOverflow: 'ellipsis' });
      d.setAttribute('role', 'option');
      d.setAttribute('aria-selected', String(p.id === sel.id));
      d.dataset.palette = p.id;
      d.title = p.builtIn ? `${p.name} (built in)` : `${p.name} (yours)`;
      if (p.id === sel.id) d.classList.add('inv');
      d.addEventListener('pointerdown', () => {
        this.lib.select(p.id);
        this.say('', true);
      });
    }
    this.name.value = sel.name;
    this.name.disabled = sel.builtIn;
    this.name.title = sel.builtIn ? 'Built-in palettes cannot be renamed: Duplicate first' : 'Rename this palette';
    this.btns.delete.disabled = sel.builtIn;
    this.btns.delete.style.opacity = sel.builtIn ? '0.4' : '1';
    this.name.style.opacity = sel.builtIn ? '0.6' : '1';
    const warnings = new Map(contrastWarnings(sel.colors).map((w) => [w.role, w]));
    for (const role of ROLES) {
      const r = this.rows.get(role)!;
      const c = sel.colors[role];
      r.swatch.style.background = c;
      r.picker.value = c;
      if (role !== editing) r.hex.value = c;
      const w = warnings.get(role);
      r.warn.style.visibility = w ? 'visible' : 'hidden';
      r.warn.title = w ? `Low contrast against ${ROLE_INFO[w.against].label} (${w.ratio.toFixed(1)}:1) — may be hard to see` : '';
    }
  }

  show(): void {
    this.refresh();
    this.status.textContent = '';
    this.win.show();
  }

  update(): void {}
}
