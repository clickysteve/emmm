// @vitest-environment happy-dom
/**
 * The Pattern Editor's “Apply … to…” pop-up (emmm), used like a user would: choose a Root and
 * Scale for this Pattern, then give it to this Pattern, the current Group or all Patterns.
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

describe('Pattern Editor: Apply scale to', () => {
  it('shows the three scopes; This Pattern / current Group / All Patterns each do exactly that', () => {
    s.clickPosition('patternGroup', 1);
    ui.openEditor('patternEditor', { voice: 2 });
    ui.updateAll();
    expect(editor().classList.contains('hidden')).toBe(false);
    expect(sel('Apply scale to').textContent).toMatch(/Apply C Chromatic to…/);
    choose('Root of this Pattern', 'D');
    choose('Scale of this Pattern', 'Natural Minor / Aeolian');
    expect(sel('Apply scale to').textContent).toMatch(/Apply D Minor to…/);
    expect(scales()[1][2]).toBe('2minor');
    expect(scales().flat().filter((x) => x !== '-')).toEqual(['2minor']);
    // the menu
    const list = choose('Apply scale to', 'Group b: all 4 Patterns');
    expect(list).toEqual(['Apply D Minor to…', 'This Pattern (Group b, Voice 3)', 'Group b: all 4 Patterns', 'All Patterns: Groups a–f']);
    expect(scales()[1]).toEqual(['2minor', '2minor', '2minor', '2minor']);
    expect(scales().filter((_, g) => g !== 1).flat().every((x) => x === '-')).toBe(true);
    // a different scale for this Pattern alone, then everywhere
    choose('Scale of this Pattern', 'Dorian');
    expect(scales()[1]).toEqual(['2minor', '2minor', '2dorian', '2minor']);
    choose('Apply scale to', 'All Patterns: Groups a–f');
    expect(scales().flat()).toEqual(Array(24).fill('2dorian'));
    // and back to one Pattern on its own
    choose('Root of this Pattern', 'E');
    expect(scales().flat().filter((x) => x === '4dorian').length).toBe(1);
    expect(scales().flat().filter((x) => x === '2dorian').length).toBe(23);
  });
});
