/**
 * Colour palettes — a purely cosmetic layer.
 *
 * The whole interface draws with a handful of CSS custom properties (--desktop, --paper,
 * --ink, --dim, --activity, --selection, and the 1-bit dither fills). A palette assigns a
 * colour to each *semantic role*; `paletteCss` turns that into one style sheet. Functional
 * areas (Patterns, Variables, …) re-define --ink for their own windows, so each area can have
 * its own colour while everything inside it — frames, text, miniatures, inverted Positions —
 * stays coherent.
 *
 * Palettes are an application preference (localStorage), never part of a musical document.
 *
 * The role-list / CSS-variable / mix-helper approach follows the theme code in clickysteve's
 * M8 Librarian and PT Librarian (THEME_COLORS + applyAppTheme + mixRgb), adapted to emmm.
 */

/** The semantic colour roles, in display order. */
export const ROLES = [
  'desktop',
  'paper',
  'ink',
  'dim',
  'patterns',
  'variables',
  'cyclic',
  'conducting',
  'midi',
  'snapshots',
  'activity',
  'selection',
] as const;
export type Role = (typeof ROLES)[number];
export type Colors = Record<Role, string>;

export const ROLE_INFO: Record<Role, { label: string; help: string }> = {
  desktop: { label: 'Desktop', help: 'background behind the windows' },
  paper: { label: 'Paper', help: 'window and panel background' },
  ink: { label: 'Ink', help: 'frames, text and drawing (menus, dialogs, other windows)' },
  dim: { label: 'Dim', help: 'guide lines, tiny labels, disabled items' },
  patterns: { label: 'Patterns', help: 'Patterns window and Pattern Editor' },
  variables: { label: 'Variables', help: 'Variables window and its edit windows' },
  cyclic: { label: 'Cyclic', help: 'Cyclic Variables window and Cyclic Editor' },
  conducting: { label: 'Conducting', help: 'transport, tempo and Conducting Grid' },
  midi: { label: 'Midi', help: 'Orchestration, Sound Choice, Midi Assignment, Monitor' },
  snapshots: { label: 'Snapshots', help: 'Snapshot window' },
  activity: { label: 'Activity', help: 'the Baton, now-playing marks, flashing bricks' },
  selection: { label: 'Selection', help: 'selected Patterns, editor regions, menu highlight' },
};

/** Which windows belong to which functional area (data-area attribute on the window). */
export type Area = 'patterns' | 'variables' | 'cyclic' | 'conducting' | 'midi' | 'snapshots';
export const AREAS: Area[] = ['patterns', 'variables', 'cyclic', 'conducting', 'midi', 'snapshots'];

export interface Palette {
  id: string;
  name: string;
  builtIn: boolean;
  colors: Colors;
}

const all = (c: string, extra: Partial<Colors> = {}): Colors =>
  ({ ...Object.fromEntries(ROLES.map((r) => [r, c])), ...extra }) as Colors;

/** Built-in palettes. Classic is the original 1-bit look and the default. */
export const BUILT_INS: Palette[] = [
  {
    id: 'classic',
    name: 'Classic',
    builtIn: true,
    colors: all('#000000', { paper: '#ffffff' }),
  },
  {
    id: 'dark',
    name: 'Dark',
    builtIn: true,
    colors: all('#d9d4c7', {
      desktop: '#000000',
      paper: '#17191c',
      dim: '#8a857a',
      activity: '#e3b65c',
      selection: '#7fa7d1',
    }),
  },
  {
    id: 'colour',
    name: 'Colour',
    builtIn: true,
    colors: {
      desktop: '#23303a',
      paper: '#fbf8ef',
      ink: '#202020',
      dim: '#8c8576',
      patterns: '#1d6a86',
      variables: '#8a2f5e',
      cyclic: '#2c7149',
      conducting: '#a94f12',
      midi: '#4e44a0',
      snapshots: '#7d6208',
      activity: '#d0372a',
      selection: '#2b78c9',
    },
  },
];
export const DEFAULT_PALETTE_ID = 'classic';
export const CLASSIC = BUILT_INS[0];

// ---------------------------------------------------------------------------- colour maths

/** Lenient hex parsing (#rgb, #rrggbb, with or without #) → '#rrggbb' lowercase, or null.
 * After PT Librarian's parseColorVal. */
export function normHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let s = v.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) s = s.replace(/./g, (c) => c + c);
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return '#' + s.toLowerCase();
}

function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = rgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours (1 … 21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Roles drawn on top of the paper, and how much contrast they need to stay readable. */
const NEEDS: Partial<Record<Role, number>> = {
  ink: 3,
  dim: 1.6,
  patterns: 3,
  variables: 3,
  cyclic: 3,
  conducting: 3,
  midi: 3,
  snapshots: 3,
  activity: 2,
  selection: 2,
};

export interface ContrastWarning {
  role: Role;
  ratio: number;
  against: Role;
}

/** Roles that are hard to see against their background. Never changes any colour. */
export function contrastWarnings(c: Colors): ContrastWarning[] {
  const out: ContrastWarning[] = [];
  for (const role of ROLES) {
    const need = NEEDS[role];
    if (need === undefined) continue;
    const ratio = contrast(c[role], c.paper);
    if (ratio < need) out.push({ role, ratio, against: 'paper' });
  }
  // the paper itself is unreadable if even the base ink disappears on it
  if (contrast(c.ink, c.paper) < 3) out.push({ role: 'paper', ratio: contrast(c.ink, c.paper), against: 'ink' });
  return out;
}

// ---------------------------------------------------------------------------- CSS

const enc = (hex: string) => hex.replace('#', '%23');
/** 1-bit fills as SVG data URIs in a given colour (the same pixels as the original look). */
function fills(ink: string, paper: string): Record<string, string> {
  const svg = (w: number, body: string) => `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${w}' shape-rendering='crispEdges'%3E${body}%3C/svg%3E")`;
  const px = (x: number, y: number, c: string) => `%3Crect x='${x}' y='${y}' width='1' height='1' fill='${enc(c)}'/%3E`;
  return {
    '--grey': svg(2, px(0, 0, ink) + px(1, 1, ink)),
    '--lightgrey': svg(4, px(0, 0, ink) + px(2, 2, ink)),
    '--dots': svg(4, px(1, 1, ink)),
    '--hatch': svg(4, px(3, 0, ink) + px(2, 1, ink) + px(1, 2, ink) + px(0, 3, ink)),
    '--whitegrey': svg(2, px(0, 0, paper) + px(1, 1, paper)),
  };
}

const decl = (o: Record<string, string>) =>
  Object.entries(o)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');

/** Ink, paper and fills for one scope (the root, or one area), plus their swapped versions
 * (--inv-*) for inverted (flashing / blinking) controls. */
function scope(ink: string, paper: string): Record<string, string> {
  const inv = Object.fromEntries(Object.entries(fills(paper, ink)).map(([k, v]) => ['--inv-' + k.slice(2), v]));
  return { '--ink': ink, ...fills(ink, paper), '--inv-ink': paper, '--inv-paper': ink, ...inv };
}

const SWAP = '--ink:var(--inv-ink);--paper:var(--inv-paper);' + ['grey', 'lightgrey', 'dots', 'hatch', 'whitegrey'].map((f) => `--${f}:var(--inv-${f})`).join(';');

/** The one style sheet that applies a palette. */
export function paletteCss(c: Colors): string {
  const root = {
    '--desktop': c.desktop,
    '--paper': c.paper,
    '--dim': c.dim,
    '--activity': c.activity,
    '--selection': c.selection,
    ...scope(c.ink, c.paper),
  };
  let css = `:root{${decl(root)}}\n`;
  for (const a of AREAS) css += `[data-area="${a}"]{${decl(scope(c[a], c.paper))}}\n`;
  if (!isClassic(c)) {
    // Classic inverts with filter: invert(), which is exact for black and white. Any other
    // palette swaps ink and paper instead, so an inverted control keeps the palette's colours.
    css +=
      `.flash,.pmatrix .cell.hot svg{filter:none;${SWAP}}\n` +
      `@keyframes mblink-swap{0%,49%{}50%,100%{${SWAP}}}\n` +
      `.blink{animation-name:mblink-swap}\n` +
      `:root{--brick-color:var(--activity);--brick-blend:normal;--mark-color:var(--activity);--mark-blend:normal}\n`;
  }
  return css;
}

/** Apply a palette to a document (a single <style> element; nothing else is touched). */
export function applyPalette(c: Colors, doc: Document = document): void {
  let el = doc.getElementById('emmm-palette') as HTMLStyleElement | null;
  if (!el) {
    el = doc.createElement('style');
    el.id = 'emmm-palette';
    doc.head.appendChild(el);
  }
  el.textContent = paletteCss(c);
  doc.documentElement.dataset.palette = isClassic(c) ? 'classic' : 'custom';
}

export function isClassic(c: Colors): boolean {
  return ROLES.every((r) => c[r] === CLASSIC.colors[r]);
}

// ---------------------------------------------------------------------------- file format

export const PALETTE_FORMAT = 'emmm-palette';
export const PALETTE_VERSION = 1;

export interface PaletteFile {
  format: typeof PALETTE_FORMAT;
  version: number;
  name: string;
  colors: Colors;
}

export function exportPalette(p: { name: string; colors: Colors }): string {
  const f: PaletteFile = { format: PALETTE_FORMAT, version: PALETTE_VERSION, name: p.name, colors: { ...p.colors } };
  return JSON.stringify(f, null, 2);
}

export class PaletteError extends Error {}

export interface ImportResult {
  name: string;
  colors: Colors;
  /** roles that were missing or invalid and were taken from Classic */
  filled: Role[];
  /** unknown keys that were ignored */
  ignored: string[];
}

/** Parse and validate a palette file. Throws PaletteError with a readable message. */
export function importPalette(text: string): ImportResult {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new PaletteError('The file is not valid JSON.');
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new PaletteError('The file is not an emmm palette.');
  const o = obj as Record<string, unknown>;
  if (o.format !== undefined && o.format !== PALETTE_FORMAT) throw new PaletteError('The file is not an emmm palette.');
  const version = Number(o.version);
  if (!Number.isInteger(version) || version < 1) throw new PaletteError('The palette file has no valid version number.');
  if (version > PALETTE_VERSION) throw new PaletteError(`This palette was made by a newer emmm (format v${version}).`);
  if (!o.colors || typeof o.colors !== 'object' || Array.isArray(o.colors)) throw new PaletteError('The palette file has no colours.');
  const src = o.colors as Record<string, unknown>;
  const colors = {} as Colors;
  const filled: Role[] = [];
  let valid = 0;
  for (const r of ROLES) {
    const h = normHex(src[r]);
    if (h) {
      colors[r] = h;
      valid++;
    } else {
      colors[r] = CLASSIC.colors[r];
      filled.push(r);
    }
  }
  if (!valid) throw new PaletteError('None of the palette colours could be read.');
  const ignored = Object.keys(src).filter((k) => !(ROLES as readonly string[]).includes(k));
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 40) : 'Imported palette';
  return { name, colors, filled, ignored };
}

// ---------------------------------------------------------------------------- persistence

const KEY_SELECTED = 'emmm.palette.selected';
const KEY_CUSTOM = 'emmm.palette.custom';

export interface PaletteStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function defaultStore(): PaletteStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Palette preferences: the custom palettes and which palette is selected. */
export class PaletteLibrary {
  custom: Palette[] = [];
  selectedId = DEFAULT_PALETTE_ID;

  constructor(private store: PaletteStore | null = defaultStore()) {
    this.load();
  }

  load(): void {
    try {
      const raw = this.store?.getItem(KEY_CUSTOM);
      const list = raw ? (JSON.parse(raw) as unknown[]) : [];
      this.custom = [];
      for (const item of Array.isArray(list) ? list : []) {
        try {
          const r = importPalette(JSON.stringify({ format: PALETTE_FORMAT, version: 1, ...(item as object) }));
          const id = typeof (item as Palette).id === 'string' ? (item as Palette).id : this.newId();
          this.custom.push({ id, name: r.name, builtIn: false, colors: r.colors });
        } catch {
          /* skip a damaged entry */
        }
      }
      const sel = this.store?.getItem(KEY_SELECTED);
      this.selectedId = sel && this.find(sel) ? sel : DEFAULT_PALETTE_ID;
    } catch {
      this.custom = [];
      this.selectedId = DEFAULT_PALETTE_ID;
    }
  }

  private save(): void {
    try {
      this.store?.setItem(KEY_CUSTOM, JSON.stringify(this.custom.map((p) => ({ id: p.id, name: p.name, colors: p.colors }))));
      this.store?.setItem(KEY_SELECTED, this.selectedId);
    } catch {
      /* storage full or blocked: palettes still work for this session */
    }
  }

  private newId(): string {
    let i = this.custom.length + 1;
    while (this.find('custom-' + i)) i++;
    return 'custom-' + i;
  }

  all(): Palette[] {
    return [...BUILT_INS, ...this.custom];
  }

  find(id: string): Palette | undefined {
    return this.all().find((p) => p.id === id);
  }

  get selected(): Palette {
    return this.find(this.selectedId) ?? CLASSIC;
  }

  select(id: string): Palette {
    if (this.find(id)) this.selectedId = id;
    this.save();
    return this.selected;
  }

  private uniqueName(base: string): string {
    const names = new Set(this.all().map((p) => p.name));
    if (!names.has(base)) return base;
    for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
  }

  /** A custom copy of any palette, selected. */
  duplicate(id: string, name?: string): Palette {
    const src = this.find(id) ?? CLASSIC;
    const p: Palette = { id: this.newId(), name: this.uniqueName(name ?? `${src.name} copy`), builtIn: false, colors: { ...src.colors } };
    this.custom.push(p);
    this.selectedId = p.id;
    this.save();
    return p;
  }

  /** Change one colour. Built-ins are never modified: editing one makes a custom copy first. */
  setColor(role: Role, value: string): Palette {
    const hex = normHex(value);
    let p = this.selected;
    if (!hex) return p;
    if (p.builtIn) p = this.duplicate(p.id);
    p.colors[role] = hex;
    this.save();
    return p;
  }

  rename(id: string, name: string): boolean {
    const p = this.custom.find((x) => x.id === id);
    const n = name.trim().slice(0, 40);
    if (!p || !n) return false;
    p.name = n;
    this.save();
    return true;
  }

  remove(id: string): boolean {
    const i = this.custom.findIndex((x) => x.id === id);
    if (i < 0) return false;
    this.custom.splice(i, 1);
    if (this.selectedId === id) this.selectedId = DEFAULT_PALETTE_ID;
    this.save();
    return true;
  }

  /** Add an imported palette as a new custom palette, selected. */
  addImported(r: ImportResult): Palette {
    const p: Palette = { id: this.newId(), name: this.uniqueName(r.name), builtIn: false, colors: { ...r.colors } };
    this.custom.push(p);
    this.selectedId = p.id;
    this.save();
    return p;
  }

  resetToClassic(): Palette {
    return this.select(DEFAULT_PALETTE_ID);
  }
}
