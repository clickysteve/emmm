// @vitest-environment happy-dom
/**
 * The Pattern Editor's Scale section (emmm), used like a user would: choose a Root and Scale,
 * choose Apply to (This Pattern / This Group / All Groups), then press Apply Scale.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Session } from '../src/app/session';

type Ui = { openEditor: (n: string, o?: object) => void; updateAll: () => void };
let s: Session;
let ui: Ui;

beforeAll(async () => {
  window.confirm = () => true;
  await import('../src/main');
  s = (window as unknown as { emmm: Session }).emmm;
  ui = (window as unknown as { emmmUi: Ui }).emmmUi;
  document.querySelector('.mdialog')?.remove();
  (s.scheduler as unknown as { wake: () => void }).wake = () => {};
});

const pd = (e: Element) => e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
const editor = () => document.querySelector<HTMLDivElement>('[data-win="edit-pattern"]')!;
const sel = (start: string) => [...editor().querySelectorAll<HTMLDivElement>('.msel')].find((e) => (e.getAttribute('aria-label') ?? '').startsWith(start))!;
const items = () => [...document.querySelectorAll<HTMLDivElement>('.msel-item')];
function choose(start: string, text: string): string[] {
  pd(sel(start));
  const all = items().map((i) => i.textContent ?? '');
  const it = items().find((i) => i.textContent === text);
  if (!it) throw new Error(`no item ${text}: ${all.join(' | ')}`);
  it.click();
  ui.updateAll();
  return all;
}
const scales = () => s.comp.patternGroups.map((g) => g.patterns.map((p) => (p.scale ? `${p.scale.root}${p.scale.scale}` : '-')));

const radio = (start: string) => [...editor().querySelectorAll<HTMLDivElement>('[role=radio]')].find((e) => (e.textContent ?? '').slice(2).startsWith(start))!;
const applyScale = () => (pd(editor().querySelector('#pe-apply-scale')!), ui.updateAll());

describe('Pattern Editor: Scale, Apply to, Apply Scale', () => {
  it('choosing a scale or a scope changes nothing; Apply Scale does exactly the chosen scope; one Undo each', () => {
    s.clickPosition('patternGroup', 1);
    ui.openEditor('patternEditor', { voice: 2 });
    ui.updateAll();
    expect(editor().classList.contains('hidden')).toBe(false);
    expect(radio('This Pattern').textContent).toBe('◉ This Pattern (b3)');
    expect(radio('This Group').textContent).toBe('○ This Group (b)');
    expect(radio('All Groups').textContent).toBe('○ All Groups (a–f)');
    const notes = JSON.stringify(s.comp.patternGroups);
    choose('Scale root', 'D');
    choose('Scale to apply', 'Natural Minor / Aeolian');
    pd(radio('This Group'));
    ui.updateAll();
    expect(radio('This Group').getAttribute('aria-checked')).toBe('true');
    expect(JSON.stringify(s.comp.patternGroups)).toBe(notes); // nothing applied yet
    // This Group
    applyScale();
    expect(scales()[1]).toEqual(['2minor', '2minor', '2minor', '2minor']);
    expect(scales().filter((_, g) => g !== 1).flat().every((x) => x === '-')).toBe(true);
    s.history.commit();
    // This Pattern
    choose('Scale to apply', 'Dorian');
    pd(radio('This Pattern'));
    applyScale();
    expect(scales()[1]).toEqual(['2minor', '2minor', '2dorian', '2minor']);
    s.history.commit();
    // All Groups
    pd(radio('All Groups'));
    applyScale();
    expect(scales().flat()).toEqual(Array(24).fill('2dorian'));
    s.history.commit();
    // one Undo per Apply
    s.undo();
    expect(scales()[1]).toEqual(['2minor', '2minor', '2dorian', '2minor']);
    s.undo();
    s.undo();
    expect(JSON.stringify(s.comp.patternGroups)).toBe(notes);
  });
});
