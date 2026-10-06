/**
 * Colour palettes: the model, validation, file format, persistence — and proof that palettes
 * are purely cosmetic (they never touch the composition, the engine or MIDI output).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '../src/app/session';
import { demoComposition } from '../src/engine/defaults';
import { serialize } from '../src/persistence/format';
import {
  applyPalette,
  BUILT_INS,
  CLASSIC,
  contrast,
  contrastWarnings,
  DEFAULT_PALETTE_ID,
  exportPalette,
  importPalette,
  normHex,
  PaletteError,
  PaletteLibrary,
  paletteCss,
  ROLES,
  type PaletteStore,
} from '../src/ui/palette';

function memStore(init: Record<string, string> = {}): PaletteStore & { data: Record<string, string> } {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

/** Just enough of a Document for applyPalette. */
function fakeDoc() {
  const els: Record<string, { id: string; textContent: string }> = {};
  return {
    els,
    getElementById: (id: string) => els[id] ?? null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: (e: { id: string; textContent: string }) => (els[e.id] = e) },
    documentElement: { dataset: {} as Record<string, string> },
  } as unknown as Document & { els: typeof els };
}

describe('palettes: built-ins', () => {
  it('Classic is the default and is exactly the original black-and-white', () => {
    expect(DEFAULT_PALETTE_ID).toBe('classic');
    expect(new PaletteLibrary(memStore()).selected.id).toBe('classic');
    for (const r of ROLES) expect(CLASSIC.colors[r]).toBe(r === 'paper' ? '#ffffff' : '#000000');
  });
  it('every built-in defines every role, and none has contrast warnings', () => {
    for (const p of BUILT_INS) {
      for (const r of ROLES) expect(normHex(p.colors[r]), `${p.name} ${r}`).toBe(p.colors[r]);
      expect(contrastWarnings(p.colors), p.name).toEqual([]);
    }
  });
  it('preset names are emmm’s own', () => {
    expect(BUILT_INS.map((p) => p.name)).toEqual(['Classic', 'Dark', 'Colour']);
  });
});

describe('palettes: colour helpers', () => {
  it('normHex accepts #rgb / #rrggbb with or without # and rejects the rest', () => {
    expect(normHex('#ABC')).toBe('#aabbcc');
    expect(normHex(' 1d6a86 ')).toBe('#1d6a86');
    expect(normHex('#12345')).toBeNull();
    expect(normHex('red')).toBeNull();
    expect(normHex(12)).toBeNull();
  });
  it('contrast follows WCAG', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
  });
  it('warns, without changing anything, when a colour is hard to see', () => {
    const c = { ...CLASSIC.colors, variables: '#f4f4f4' };
    const w = contrastWarnings(c);
    expect(w.map((x) => x.role)).toEqual(['variables']);
    expect(c.variables).toBe('#f4f4f4');
  });
});

describe('palettes: CSS layer', () => {
  it('Classic CSS sets the original colours and keeps exact filter inversion', () => {
    const css = paletteCss(CLASSIC.colors);
    expect(css).toContain('--paper:#ffffff');
    expect(css).toContain('--ink:#000000');
    expect(css).not.toContain('mblink-swap');
  });
  it('other palettes give each area its own ink and swap colours for inversion', () => {
    const colour = BUILT_INS.find((p) => p.id === 'colour')!;
    const css = paletteCss(colour.colors);
    expect(css).toContain(`[data-area="patterns"]{--ink:${colour.colors.patterns}`);
    expect(css).toContain(`[data-area="cyclic"]{--ink:${colour.colors.cyclic}`);
    expect(css).toContain('mblink-swap');
    // dither fills are redrawn in the palette's colours
    expect(css).toContain(colour.colors.variables.replace('#', '%23'));
  });
  it('applyPalette writes one style element and nothing else', () => {
    const doc = fakeDoc();
    applyPalette(BUILT_INS[1].colors, doc);
    applyPalette(BUILT_INS[2].colors, doc);
    expect(Object.keys(doc.els)).toEqual(['emmm-palette']);
    expect(doc.els['emmm-palette'].textContent).toBe(paletteCss(BUILT_INS[2].colors));
    expect(doc.documentElement.dataset.palette).toBe('custom');
    applyPalette(CLASSIC.colors, doc);
    expect(doc.documentElement.dataset.palette).toBe('classic');
  });
});

describe('palettes: library and persistence', () => {
  it('editing a built-in creates a custom copy; the built-in stays unchanged', () => {
    const lib = new PaletteLibrary(memStore());
    lib.select('dark');
    const p = lib.setColor('activity', '#ff0000');
    expect(p.builtIn).toBe(false);
    expect(p.name).toBe('Dark copy');
    expect(lib.selectedId).toBe(p.id);
    expect(lib.find('dark')!.colors.activity).toBe(BUILT_INS[1].colors.activity);
    expect(p.colors.activity).toBe('#ff0000');
  });
  it('invalid colours are ignored', () => {
    const lib = new PaletteLibrary(memStore());
    const p = lib.duplicate('classic');
    lib.setColor('ink', 'not a colour');
    expect(lib.selected.colors.ink).toBe(p.colors.ink);
  });
  it('rename, duplicate, delete, reset to Classic', () => {
    const lib = new PaletteLibrary(memStore());
    const a = lib.duplicate('colour');
    expect(lib.rename(a.id, '  Studio  ')).toBe(true);
    expect(lib.selected.name).toBe('Studio');
    expect(lib.rename('classic', 'Nope')).toBe(false);
    const b = lib.duplicate(a.id);
    expect(b.name).toBe('Studio copy');
    expect(lib.duplicate(a.id).name).toBe('Studio copy 2');
    expect(lib.remove('classic')).toBe(false);
    expect(lib.remove(b.id)).toBe(true);
    expect(lib.find(b.id)).toBeUndefined();
    lib.select(a.id);
    lib.remove(a.id); // deleting the selected palette falls back to Classic
    expect(lib.selectedId).toBe('classic');
    lib.select('dark');
    expect(lib.resetToClassic().id).toBe('classic');
  });
  it('selection and custom palettes survive a reload', () => {
    const store = memStore();
    const lib = new PaletteLibrary(store);
    const p = lib.setColor('selection', '#123456');
    lib.rename(p.id, 'Mine');
    const again = new PaletteLibrary(store);
    expect(again.selected.name).toBe('Mine');
    expect(again.selected.colors.selection).toBe('#123456');
  });
  it('damaged or unknown stored preferences fall back to Classic safely', () => {
    expect(new PaletteLibrary(memStore({ 'emmm.palette.custom': '{nope', 'emmm.palette.selected': 'custom-1' })).selected.id).toBe('classic');
    expect(new PaletteLibrary(memStore({ 'emmm.palette.selected': 'gone' })).selected.id).toBe('classic');
    const lib = new PaletteLibrary(memStore({ 'emmm.palette.custom': JSON.stringify([{ id: 'custom-1', name: 'ok', colors: { ink: '#111111' } }, 42, { colors: 'x' }]) }));
    expect(lib.custom.map((p) => p.name)).toEqual(['ok']);
    expect(lib.custom[0].colors.paper).toBe('#ffffff'); // missing roles from Classic
  });
  it('works without any storage at all', () => {
    const lib = new PaletteLibrary(null);
    expect(lib.duplicate('dark').name).toBe('Dark copy');
  });
});

describe('palettes: file format', () => {
  it('export → import round-trips', () => {
    const colour = BUILT_INS[2];
    const text = exportPalette({ name: 'Studio', colors: colour.colors });
    const f = JSON.parse(text);
    expect(f).toEqual({ format: 'emmm-palette', version: 1, name: 'Studio', colors: colour.colors });
    const r = importPalette(text);
    expect(r).toEqual({ name: 'Studio', colors: colour.colors, filled: [], ignored: [] });
  });
  it('accepts the minimal {version, name, colors} form; fills missing roles from Classic', () => {
    const r = importPalette(JSON.stringify({ version: 1, name: 'Bits', colors: { ink: '#0F0', paper: '102030', foo: '#fff', midi: 'nope' } }));
    expect(r.colors.ink).toBe('#00ff00');
    expect(r.colors.paper).toBe('#102030');
    expect(r.colors.midi).toBe('#000000');
    expect(r.filled).toContain('midi');
    expect(r.ignored).toEqual(['foo']);
  });
  it.each([
    ['not json', 'not valid JSON'],
    ['[1,2]', 'not an emmm palette'],
    [JSON.stringify({ format: 'emmm', version: 1, colors: {} }), 'not an emmm palette'],
    [JSON.stringify({ name: 'x', colors: { ink: '#000' } }), 'no valid version'],
    [JSON.stringify({ version: 2, colors: { ink: '#000' } }), 'newer emmm'],
    [JSON.stringify({ version: 1 }), 'no colours'],
    [JSON.stringify({ version: 1, colors: { ink: 'red' } }), 'None of the palette colours'],
  ])('rejects %s', (text, msg) => {
    expect(() => importPalette(text)).toThrow(PaletteError);
    expect(() => importPalette(text)).toThrow(msg);
  });
  it('a failed import leaves the library untouched', () => {
    const store = memStore();
    const lib = new PaletteLibrary(store);
    lib.select('dark');
    const before = JSON.stringify(store.data);
    try {
      lib.addImported(importPalette('{"version":9,"colors":{}}'));
    } catch {
      /* expected */
    }
    expect(JSON.stringify(store.data)).toBe(before);
  });
});

describe('palettes are cosmetic only', () => {
  let sessions: Session[] = [];
  afterEach(() => {
    sessions.forEach((s) => s.stop());
    sessions = [];
  });
  /** Play the demo with some performance gestures; optionally switch palettes all the way through. */
  function perform(switchPalettes: boolean) {
    const s = new Session(demoComposition(4321));
    sessions.push(s);
    const sent: [number, number[]][] = [];
    (s as unknown as { send: (c: number, b: number[]) => void }).send = (c, b) => sent.push([c, [...b]]);
    const lib = new PaletteLibrary(memStore());
    const doc = fakeDoc();
    const cosmetic = (i: number) => {
      if (!switchPalettes) return;
      applyPalette(lib.select(['classic', 'dark', 'colour'][i % 3]).colors, doc);
      const p = lib.setColor(ROLES[i % ROLES.length], `#${(i * 2654435761 % 0xffffff).toString(16).padStart(6, '0')}`);
      applyPalette(p.colors, doc);
    };
    s.start();
    let t = 0;
    for (let i = 0; i < 40; i++) {
      cosmetic(i);
      t += 37;
      s.emitNow(s.engine.render(t));
      if (i === 5) s.clickPosition('transposition', 3);
      if (i === 9) s.clickPosition('noteDensity', 2);
      if (i === 12) s.conduct(0.2, 0.8, false);
      if (i === 15) (s.holdDo(), s.clickPosition('velocityRange', 4), s.clickSnapshot(1));
      if (i === 20) s.executeSnapshot(1);
      if (i === 25) s.engine.sync(t);
      cosmetic(i + 100);
    }
    s.stop();
    return {
      sent,
      doc: serialize(s.comp).replace(/"savedAt": "[^"]*"/, ""),
      state: JSON.stringify({ comp: s.comp, selected: s.selected, snap: s.currentSnapshot, state: s.engine.state, tick: s.engine.tick, tempo: s.comp.tempo, ext: s.comp.extended }),
    };
  }
  it('switching and editing palettes changes no MIDI output, musical state or saved document', () => {
    const plain = perform(false);
    const switched = perform(true);
    expect(plain.sent.length).toBeGreaterThan(20);
    expect(switched.sent).toEqual(plain.sent);
    expect(switched.state).toBe(plain.state);
    expect(switched.doc).toBe(plain.doc);
  });
  it('the saved document never contains palette information', () => {
    const lib = new PaletteLibrary(memStore());
    lib.setColor('ink', '#abcdef');
    const doc = serialize(demoComposition(1));
    expect(doc).not.toMatch(/palette|#abcdef/i);
  });
  it('palette storage keys are separate from the document’s', () => {
    const store = memStore();
    const lib = new PaletteLibrary(store);
    lib.setColor('ink', '#abcdef');
    expect(Object.keys(store.data).sort()).toEqual(['emmm.palette.custom', 'emmm.palette.selected']);
  });
});
