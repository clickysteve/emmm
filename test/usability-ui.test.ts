// @vitest-environment happy-dom
/**
 * emmm usability features, driven through the real menus and controls: Classic Mode (the full
 * instrument by default), Follow Playing Pattern, copying Patterns and Groups, and About.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Session } from '../src/app/session';
import { defaultComposition } from '../src/engine/defaults';
import { deserialize, serialize } from '../src/persistence/format';

type Ui = { openEditor: (n: string, o?: object) => void; updateAll: () => void; patternEditor: { group: number; voice: number; win: { titleEl: HTMLElement } } };
let s: Session;
let ui: Ui;

beforeAll(async () => {
  await import('../src/main');
  s = (window as unknown as { emmm: Session }).emmm;
  ui = (window as unknown as { emmmUi: Ui }).emmmUi;
  document.querySelector('.mdialog')?.remove();
  (s.scheduler as unknown as { wake: () => void }).wake = () => {};
});

const pd = (e: Element) => e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
const pu = (e: Element) => e.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
const closeMenus = () => window.dispatchEvent(new PointerEvent('pointerdown'));
function item(title: string, label: string): HTMLDivElement {
  closeMenus();
  pd([...document.querySelectorAll('#menubar .menu')].find((m) => m.firstChild?.textContent === title)!);
  const it = [...document.querySelectorAll<HTMLDivElement>('.dropdown .item')].find((i) => i.firstElementChild!.textContent === label);
  if (!it) throw new Error(`no ${title} ▸ ${label}`);
  return it;
}
const choose = (title: string, label: string) => (pu(item(title, label)), ui.updateAll());
const editor = () => document.querySelector<HTMLDivElement>('[data-win="edit-pattern"]')!;
const grp = (g: string) => [...editor().querySelectorAll<HTMLDivElement>('.num')].find((d) => d.textContent === g && d.title.startsWith('Edit Pattern Group'))!;
const dialogButton = (t: string) => [...document.querySelectorAll<HTMLButtonElement>('.mdialog button')].find((b) => b.textContent === t)!;
const flush = () => new Promise((r) => setTimeout(r, 0));
const P = (g: number, v: number) => s.comp.patternGroups[g].patterns[v];

describe('Classic Mode', () => {
  it('a new document is the full instrument; Options ▸ Enable Classic Mode maps to Extended off', () => {
    expect(s.comp.extended.enabled).toBe(true);
    expect(item('Options', 'Enable Classic Mode').getAttribute('aria-checked')).toBe('false');
    choose('Options', 'Enable Classic Mode');
    expect(s.comp.extended.enabled).toBe(false);
    expect(item('Options', 'Trajectory…').classList.contains('disabled')).toBe(true);
    expect(item('Options', 'CC Cycles…').classList.contains('disabled')).toBe(true);
    // utilities stay: editing, copy / paste, MIDI
    expect(item('Edit', 'Copy Group').classList.contains('disabled')).toBe(false);
    expect(item('File', 'MIDI Settings…').classList.contains('disabled')).toBe(false);
    choose('Options', 'Enable Classic Mode');
    expect(s.comp.extended.enabled).toBe(true);
    closeMenus();
  });
  it('saved documents keep their mode; an old document without the setting opens in Classic Mode', () => {
    const c = defaultComposition();
    c.extended.enabled = false;
    expect(deserialize(serialize(c)).composition.extended.enabled).toBe(false);
    c.extended.enabled = true;
    expect(deserialize(serialize(c)).composition.extended.enabled).toBe(true);
    const old = JSON.parse(serialize(c));
    delete old.composition.extended;
    expect(deserialize(JSON.stringify(old)).composition.extended.enabled).toBe(false);
  });
});

describe('Pattern Editor: Follow Playing Pattern', () => {
  it('off by default: the editor stays on its Group while the playing Group changes; on: it follows', () => {
    s.clickPosition('patternGroup', 1);
    ui.openEditor('patternEditor', { voice: 0 });
    ui.updateAll();
    expect(ui.patternEditor.group).toBe(1);
    expect(item('Options', 'Follow Playing Pattern').getAttribute('aria-checked')).toBe('false');
    closeMenus();
    s.clickPosition('patternGroup', 3); // as a Robot or conducting would
    ui.updateAll();
    expect(ui.patternEditor.group).toBe(1);
    expect(ui.patternEditor.win.titleEl.textContent).toMatch(/b.*playing: d/);
    // editing the shown Group never changes what plays
    pd(grp('c'));
    ui.updateAll();
    expect(ui.patternEditor.group).toBe(2);
    expect(s.comp.patternGroup.active).toBe(3);
    choose('Options', 'Follow Playing Pattern');
    expect(ui.patternEditor.group).toBe(3);
    s.clickPosition('patternGroup', 0);
    ui.updateAll();
    expect(ui.patternEditor.group).toBe(0);
    choose('Options', 'Follow Playing Pattern');
    expect(s.comp.patternGroup.active).toBe(0);
  });
});

describe('Copy, Paste and Duplicate', () => {
  it('a Pattern: Copy in Group a, pick Group b, Paste — an independent copy, the playing Group unchanged', () => {
    ui.openEditor('patternEditor', { voice: 0 });
    pd(grp('a'));
    ui.updateAll();
    P(0, 0).scale = { root: 2, scale: 'minor' };
    choose('Edit', 'Copy');
    pd(grp('b'));
    ui.updateAll();
    choose('Edit', 'Paste');
    expect(JSON.stringify(P(1, 0))).toBe(JSON.stringify(P(0, 0)));
    P(1, 0).steps[0]?.push(99);
    P(1, 0).scale!.root = 5;
    expect(P(0, 0).steps[0]).not.toContain(99);
    expect(P(0, 0).scale!.root).toBe(2);
    expect(s.comp.patternGroup.active).toBe(0);
  });
  it('a whole Group: Copy Group, Paste Group asks before replacing notes, one Undo restores all four', async () => {
    s.history.commit();
    pd(grp('a'));
    ui.updateAll();
    choose('Edit', 'Copy Group');
    pd(grp('b'));
    ui.updateAll();
    const before = JSON.stringify(s.comp.patternGroups[1]);
    expect(s.hasNotes(1)).toBe(true);
    choose('Edit', 'Paste Group');
    await flush();
    expect(document.querySelector('.mdialog')!.textContent).toMatch(/Replace the four Patterns of Group b/);
    dialogButton('Replace').click();
    await flush();
    expect(JSON.stringify(s.comp.patternGroups[1])).toBe(JSON.stringify(s.comp.patternGroups[0]));
    expect(s.comp.patternGroups[1].patterns[2]).not.toBe(s.comp.patternGroups[0].patterns[2]);
    expect(s.comp.patternGroup.active).toBe(0);
    s.history.commit();
    s.undo();
    expect(JSON.stringify(s.comp.patternGroups[1])).toBe(before);
  });
  it('Duplicate Group… copies straight into the Group picked in one dialog', async () => {
    pd(grp('a'));
    ui.updateAll();
    choose('Edit', 'Duplicate Group…');
    await flush();
    expect(dialogButton('a')).toBeUndefined(); // not onto itself
    dialogButton('e').click();
    await flush();
    expect(JSON.stringify(s.comp.patternGroups[4])).toBe(JSON.stringify(s.comp.patternGroups[0]));
  });
});

describe('About emmm', () => {
  it('a spiritual successor, not a recreation; MORE LIKE THIS opens the site in a new tab', () => {
    choose('emmm', 'About emmm…');
    const about = document.querySelector<HTMLDivElement>('[data-win="about"]')!;
    expect(about.textContent).toMatch(/spiritual successor to M/);
    expect(about.textContent).toMatch(/not affiliated with or endorsed by Intelligent Music, Cycling '74/);
    expect(about.textContent).not.toMatch(/recreation/);
    const a = about.querySelector<HTMLAnchorElement>('#about-more')!;
    expect(a.textContent).toMatch(/MORE LIKE THIS/);
    expect(a.getAttribute('href')).toBe('https://slopfactory.allmyfriendsaresynths.com/');
    expect(a.target).toBe('_blank');
  });
});
