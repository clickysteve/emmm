// @vitest-environment happy-dom
/**
 * The Robots window, driven like a user in a simulated browser (pointer and key events on
 * the real controls): opening it, Robots, personalities, Variables, rate, weights, Rules,
 * Home / Return, the log, Undo / Redo, keyboard behaviour and disabled controls.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Session } from '../src/app/session';

type Ui = { openEditor: (n: string, o?: object) => void; updateAll: () => void; robotsWin: { tab: string; sel: number; selRule: number; selVar: string } };
let s: Session;
let ui: Ui;

beforeAll(async () => {
  window.confirm = () => true;
  await import('../src/main');
  s = (window as unknown as { emmm: Session }).emmm;
  ui = (window as unknown as { emmmUi: Ui }).emmmUi;
  document.querySelector('.mdialog')?.remove();
  // the test renders the music itself
  (s.scheduler as unknown as { wake: () => void }).wake = () => {};
});

const pd = (e: Element, init: PointerEventInit = {}) => e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, ...init }));
const pu = (e: Element) => e.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
const key = (e: Element, k: string, init: KeyboardEventInit = {}) => {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  e.dispatchEvent(ev);
  return ev;
};
const win = () => document.querySelector<HTMLDivElement>('[data-win="robots"]')!;
const isOpen = () => !win().classList.contains('hidden');
const draw = () => ui.updateAll();
const within = (sel: string) => [...win().querySelectorAll<HTMLDivElement>(sel)];
const byText = (sel: string, t: string | RegExp) => {
  const e = within(sel).find((x) => (typeof t === 'string' ? x.textContent === t : t.test(x.textContent ?? '')));
  if (!e) throw new Error(`no ${sel} "${t}" in: ${within(sel).map((x) => x.textContent).join(' | ')}`);
  return e;
};
const tab = (name: string) => (pd(byText('[role=tab]', name)), draw());
const selector = (labelText: string) => win().querySelector<HTMLDivElement>(`.msel[aria-label="${labelText}"]`)!;
function choose(labelText: string, text: string): void {
  pd(selector(labelText));
  const it = [...document.querySelectorAll<HTMLDivElement>('.msel-item')].find((i) => i.textContent === text);
  if (!it) throw new Error(`no item ${text}: ${[...document.querySelectorAll('.msel-item')].map((i) => i.textContent).join(' | ')}`);
  it.click();
  draw();
}
function options(labelText: string): { text: string; disabled: boolean }[] {
  pd(selector(labelText));
  const out = [...document.querySelectorAll<HTMLDivElement>('.msel-item')].map((i) => ({ text: i.textContent ?? '', disabled: i.classList.contains('disabled') }));
  key(selector(labelText), 'Escape');
  return out;
}
/** type into a number box found by (part of) its tip */
function typeInto(tip: RegExp, text: string, nth = 0): void {
  const n = within('[role=spinbutton]').filter((e) => tip.test(e.title || e.dataset.tip || ''))[nth];
  if (!n) throw new Error(`no number box ${tip}`);
  n.focus();
  for (const ch of text) key(n, ch);
  key(n, 'Enter');
  draw();
}
const render = (to: number) => {
  for (let t = s.engine.tick + 24; t <= to; t += 24) s.emitNow(s.engine.render(t));
  draw();
};
const act = (v: string) => (s.comp as unknown as Record<string, { active: number }>)[v].active;

beforeEach(() => {
  if (s.engine.state !== 'stopped') s.stop();
});

describe('opening', () => {
  it('Options ▸ Robots, Rules & Home… opens it; Windows lists it; the Mutation & Variation window has a button; ⌥W too', () => {
    pd([...document.querySelectorAll('#menubar .menu')].find((m) => m.firstChild?.textContent === 'Options')!);
    const item = [...document.querySelectorAll<HTMLDivElement>('.dropdown .item')].find((i) => i.firstElementChild!.textContent!.startsWith('Robots, Rules & Home'))!;
    expect(item.querySelector('.key')!.textContent).toMatch(/W/);
    pu(item);
    expect(isOpen()).toBe(true);
    win().querySelector<HTMLDivElement>('.close')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(isOpen()).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', altKey: true, bubbles: true, cancelable: true }));
    expect(isOpen()).toBe(true);
    // it comes to the front
    const z0 = [...document.querySelectorAll<HTMLDivElement>('.mwin')].map((w) => Number(w.style.zIndex || 0));
    expect(Number(win().style.zIndex)).toBe(Math.max(...z0));
    pd([...document.querySelectorAll('#menubar .menu')].find((m) => m.firstChild?.textContent === 'Windows')!);
    expect([...document.querySelectorAll('.dropdown .item')].map((i) => i.firstElementChild!.textContent)).toContain('Robots');
    window.dispatchEvent(new PointerEvent('pointerdown'));
    pd([...document.querySelectorAll('#menubar .menu')].find((m) => m.firstChild?.textContent === 'Options')!);
    pu([...document.querySelectorAll<HTMLDivElement>('.dropdown .item')].find((i) => i.firstElementChild!.textContent!.startsWith('Mutation & Variation…'))!);
    draw();
    const ext = document.querySelector('[data-win="extended"]')!;
    const rb = [...ext.querySelectorAll<HTMLDivElement>('.btn')].find((b) => b.textContent === 'Robots…')!;
    pd(rb);
    draw();
    const zs = [...document.querySelectorAll<HTMLDivElement>('.mwin')].map((w) => Number(w.style.zIndex || 0));
    expect(Number(win().style.zIndex)).toBe(Math.max(...zs));
  });
  it('Classic Mode closes the window, greys its commands and keeps every Robot setting', () => {
    const pers = s.comp.extended.robots[1].personality;
    s.comp.extended.robots[1].personality = 'orbit';
    const before = JSON.stringify(s.comp.extended.robots);
    const options = () => {
      window.dispatchEvent(new PointerEvent('pointerdown'));
      pd([...document.querySelectorAll('#menubar .menu')].find((m) => m.firstChild?.textContent === 'Options')!);
      return [...document.querySelectorAll<HTMLDivElement>('.dropdown .item')];
    };
    const item = (t: string) => options().find((i) => i.firstElementChild!.textContent === t)!;
    // a new document is the full instrument: Classic Mode is off
    expect(item('Enable Classic Mode').getAttribute('aria-checked')).toBe('false');
    pu(item('Enable Classic Mode'));
    draw();
    expect(s.comp.extended.enabled).toBe(false);
    expect(isOpen()).toBe(false);
    expect(item('Robots, Rules & Home…').classList.contains('disabled')).toBe(true);
    expect(item('Mutation & Variation…').classList.contains('disabled')).toBe(true);
    // modern utilities stay available
    expect(item('MIDI Learn…').classList.contains('disabled')).toBe(false);
    expect(item('Follow Playing Pattern').classList.contains('disabled')).toBe(false);
    window.dispatchEvent(new PointerEvent('pointerdown'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', altKey: true, bubbles: true, cancelable: true }));
    expect(isOpen()).toBe(false);
    pu(item('Enable Classic Mode'));
    expect(s.comp.extended.enabled).toBe(true);
    expect(JSON.stringify(s.comp.extended.robots)).toBe(before);
    expect(s.comp.extended.robots[1].enabled).toBe(false); // nothing switched on by itself
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', altKey: true, bubbles: true, cancelable: true }));
    draw();
    expect(isOpen()).toBe(true);
    s.comp.extended.robots[1].personality = pers;
    draw();
  });
});

describe('ROBOT tab', () => {
  it('enable Robot 2, choose a personality, assign Variables, set the rate — all through the controls', () => {
    tab('ROBOT');
    pd(win().querySelector('[aria-label="Robot 2 on / off"]')!);
    draw();
    expect(s.comp.extended.robots[1].enabled).toBe(true);
    expect(win().querySelector('[aria-label="Robot 2 on / off"]')!.classList.contains('inv')).toBe(true);
    choose('Robot 2 personality', 'Orbit');
    expect(s.comp.extended.robots[1].personality).toBe('orbit');
    // only Orbit's parameters are shown
    expect(within('.label.tiny').map((l) => l.textContent)).toContain('step');
    expect(within('.label.tiny').map((l) => l.textContent)).not.toContain('stay %');
    // Variables: Velocity and Legato are on by default for Robot 2; swap Legato for Note Density
    pd(byText('[role=switch]', 'Legato'));
    pd(byText('[role=switch]', 'Note Density'));
    draw();
    expect(s.comp.extended.robots[1].variables).toEqual(['noteDensity', 'velocityRange']);
    typeInto(/Rate \(M’s Time Base\)/, '1/4');
    expect([s.comp.extended.robots[1].rateNum, s.comp.extended.robots[1].rateDen]).toEqual([1, 4]);
    expect(win().textContent).toMatch(/every beat/);
    // the description is the implemented algorithm's
    expect(win().textContent).toMatch(/Steps through the eligible Positions in order, wrapping round/);
  });
  it('Baton (M) is offered only to Robot 1; a Follower cannot watch a Robot that watches it', () => {
    expect(options('Robot 2 personality').find((o) => o.text.startsWith('Baton'))).toEqual({ text: 'Baton (M) — Robot 1 only', disabled: true });
    s.setRobot(2, { personality: 'follower', target: 1 });
    choose('Robot 2 personality', 'Follower');
    const opts = options('Robot 2 watches');
    expect(opts.find((o) => o.text.startsWith('Robot 2'))).toEqual({ text: 'Robot 2 (itself)', disabled: true });
    expect(opts.find((o) => o.text.startsWith('Robot 3'))).toEqual({ text: 'Robot 3 (watches back)', disabled: true });
    choose('Robot 2 watches', 'Robot 1 (off)');
    expect(s.comp.extended.robots[1].target).toBe(0);
    s.setRobot(2, { personality: 'drunk', target: null });
    choose('Robot 2 personality', 'Orbit');
  });
  it('Defaults puts back only this personality’s parameters', () => {
    s.setRobotParam(1, 'step', 3);
    s.setRobotParam(1, 'stay', 70); // Drunk's, kept
    draw();
    pd(byText('.btn', 'Defaults'));
    expect(s.comp.extended.robots[1].params.step).toBe(1);
    expect(s.comp.extended.robots[1].params.stay).toBe(70);
  });
  it('clicking a row in the overview selects that Robot', () => {
    const rows = within('div').filter((d) => d.style.width === '336px');
    pd(rows[2]);
    draw();
    expect(ui.robotsWin.sel).toBe(2);
    expect(win().textContent).toMatch(/Robot 3/);
    pd(rows[1]);
    draw();
  });
});

describe('playing: the overview and the log show what happens', () => {
  it('Robot 2 moves on its grid; its Positions and the log follow', () => {
    s.conductor.clearLog();
    s.start();
    render(96 * 3 + 1);
    expect(s.conductor.mem[1].pos).toBe(3);
    // (playing, the log shows an entry once it has sounded; stopped, everything)
    s.stop();
    draw();
    const log = win().querySelector('[role=log]')!.textContent!;
    expect(log).toMatch(/Robot 2 1 → 2/);
    expect(log).toMatch(/Robot 2 3 → 4/);
    pd(byText('.btn', 'Clear'));
    draw();
    expect(win().querySelector('[role=log]')!.textContent).toMatch(/Nothing yet/);
  });
});

describe('WEIGHTS tab', () => {
  it('select a Variable, type a weight, see the chances; 0 excludes; the last allowed one is kept', () => {
    tab('WEIGHTS');
    pd(byText('[role=tab]', 'Dens'));
    draw();
    for (let k = 0; k < 6; k++) typeInto(/Note Density Position \d: weight/, k < 5 ? '0' : '40', k);
    const row = s.comp.extended.weights.noteDensity;
    expect(row).toEqual([0, 0, 0, 0, 0, 40]);
    expect(win().textContent).toMatch(/100 %/);
    expect(within('.label').filter((d) => d.textContent === 'excluded' && d.style.display !== 'none').length).toBe(5);
    typeInto(/Note Density Position \d: weight/, '0', 5);
    expect(row[5]).toBe(40);
    expect(win().textContent).toMatch(/at least one Position must stay eligible/);
    pd(byText('.btn', 'Reset'));
    draw();
    expect(s.comp.extended.weights.noteDensity).toEqual([10, 10, 10, 10, 10, 10]);
    expect(win().textContent).toMatch(/17 %/);
  });
  it('keyboard on a bar: ↑ / ↓ change the weight; Favour ⌂ is disabled until there is a Home', () => {
    const bar = win().querySelector<HTMLDivElement>('[role=slider][aria-label="Note Density Position 3 weight"]')!;
    bar.focus();
    key(bar, 'ArrowUp', { shiftKey: true });
    draw();
    expect(s.comp.extended.weights.noteDensity[2]).toBe(20);
    s.clearHome();
    draw();
    const fav = byText('.btn', 'Favour ⌂');
    expect(fav.getAttribute('aria-disabled')).toBe('true');
    pd(fav);
    expect(s.comp.extended.weights.noteDensity[2]).toBe(20);
  });
  it('weights steer the Robot (an excluded Position is never visited)', () => {
    s.comp.extended.weights.noteDensity = [10, 0, 10, 0, 10, 0];
    s.comp.extended.weights.velocityRange = [10, 10, 10, 10, 10, 10];
    s.changed('conductors');
    s.conductor.clearLog();
    s.start();
    render(96 * 12);
    expect([0, 2, 4]).toContain(act('noteDensity'));
    expect(s.conductor.log.filter((l) => l.kind === 'move' && l.robot === 1).every((l) => /→ [135]/.test(l.text))).toBe(true);
    s.stop();
    s.weightOp('noteDensity', 'reset');
  });
});

describe('RULES tab', () => {
  it('add a Rule, edit WHEN / THEN / AT, see it in words; it fires on a manual change, even stopped', () => {
    s.comp.extended.rules = [];
    s.changed('conductors');
    tab('RULES');
    expect(win().textContent).toMatch(/No Rules yet/);
    pd(byText('.btn', '+ New Rule'));
    draw();
    expect(s.comp.extended.rules.length).toBe(1);
    choose('Condition', 'Variable enters Position');
    choose('Variable', 'Note Density');
    typeInto(/Position 1–6/, '5');
    choose('Action', 'Set Variable Position');
    // the action's Variable selector is the second one
    const vs = win().querySelectorAll<HTMLDivElement>('.msel[aria-label="Variable"]');
    pd(vs[1]);
    [...document.querySelectorAll<HTMLDivElement>('.msel-item')].find((i) => i.textContent === 'Legato')!.click();
    draw();
    typeInto(/Position 1–6/, '6', 1);
    expect(s.comp.extended.rules[0]).toMatchObject({ when: { kind: 'variableAt', variable: 'noteDensity', position: 4 }, then: { kind: 'setPosition', variable: 'legato', position: 5 }, at: 'now' });
    expect(win().textContent).toMatch(/WHEN Note Density enters Position 5 THEN Legato → Position 6/);
    s.clickPosition('noteDensity', 4);
    draw();
    expect(act('legato')).toBe(5);
    expect(s.engine.state).toBe('stopped');
    expect(win().textContent).toMatch(/×1/);
  });
  it('timing toggles; warnings; Duplicate, reorder, off, Delete; the 16-Rule limit disables New', () => {
    pd(byText('[role=switch]', 'bar'));
    draw();
    expect(s.comp.extended.rules[0].at).toBe('bar');
    pd(byText('[role=switch]', 'Q'));
    draw();
    expect(win().textContent).toMatch(/Q: no Snapshot quantization is set/);
    choose('Action', 'Recall Snapshot');
    expect(win().textContent).toMatch(/Snapshot A is empty/);
    pd(byText('.btn', 'Duplicate'));
    draw();
    expect(s.comp.extended.rules.length).toBe(2);
    expect(ui.robotsWin.selRule).toBe(1);
    choose('Condition', 'Home is reached');
    pd(byText('.btn', '↑'));
    draw();
    expect(s.comp.extended.rules[0].when.kind).toBe('homeReached');
    pd(win().querySelector('[aria-label="Rule 1 on / off"]')!);
    draw();
    expect(s.comp.extended.rules[0].on).toBe(false);
    while (s.comp.extended.rules.length < 16) s.addRule();
    draw();
    expect(byText('.btn', '+ New Rule').getAttribute('aria-disabled')).toBe('true');
    pd(byText('.btn', '+ New Rule'));
    expect(s.comp.extended.rules.length).toBe(16);
    ui.robotsWin.selRule = 0;
    draw();
    pd(byText('.btn', 'Delete'));
    draw();
    expect(s.comp.extended.rules.length).toBe(15);
    s.comp.extended.rules = [];
    s.changed('conductors');
    draw();
  });
});

describe('HOME tab', () => {
  it('Capture, move away, RETURN HOME (gradual, with progress), rest, Clear', () => {
    tab('HOME');
    s.clickPosition('noteDensity', 0);
    pd(byText('.btn', 'Capture Home'));
    draw();
    expect(s.comp.extended.home.positions).not.toBeNull();
    expect(win().textContent).toMatch(/At Home/);
    s.clickPosition('noteDensity', 5);
    s.clickPosition('rhythm', 3);
    draw();
    expect(win().textContent).toMatch(/steps? from Home/);
    s.start();
    render(48);
    pd(byText('.btn', 'RETURN HOME'));
    draw();
    expect(s.conductor.ret).not.toBeNull();
    expect(win().textContent).toMatch(/RETURNING… \(stop\)/);
    expect(win().textContent).toMatch(/▸ returning/);
    render(96 * 6);
    expect(win().textContent).toMatch(/Returning: \d of \d steps/);
    render(96 * 10);
    expect(s.conductor.ret).toBeNull();
    expect(win().textContent).toMatch(/resting at Home|At Home/);
    expect(act('noteDensity')).toBe(0);
    s.stop();
    // exclusion
    pd(within('[role=switch]').find((d) => (d.dataset.tip ?? d.title).startsWith('Rhythm:'))!);
    draw();
    expect(s.comp.extended.home.include.rhythm).toBe(false);
    expect(win().textContent).toMatch(/– excluded/);
    pd(within('.btn').filter((b) => b.textContent === 'Clear').at(-1)!);
    draw();
    expect(win().textContent).toMatch(/No Home yet/);
    expect(byText('.btn', 'RETURN HOME').getAttribute('aria-disabled')).toBe('true');
  });
});

describe('keyboard, focus, Undo', () => {
  it('Space / Enter on a focused toggle act on it — not Stop / Play', () => {
    tab('ROBOT');
    const t = byText('[role=switch]', 'Note Density');
    const was = s.comp.extended.robots[1].variables.includes('noteDensity');
    t.focus();
    const ev = key(t, ' ');
    expect(ev.defaultPrevented).toBe(true);
    expect(s.engine.state).toBe('stopped');
    expect(s.comp.extended.robots[1].variables.includes('noteDensity')).toBe(!was);
    key(t, 'Enter');
    expect(s.comp.extended.robots[1].variables.includes('noteDensity')).toBe(was);
  });
  it('Robot edits are undoable and redoable', () => {
    s.history.commit();
    choose('Robot 2 personality', 'Chaotic');
    s.history.commit();
    expect(s.comp.extended.robots[1].personality).toBe('chaotic');
    s.undo();
    draw();
    expect(s.comp.extended.robots[1].personality).not.toBe('chaotic');
    expect(selector('Robot 2 personality').textContent).not.toBe('Chaotic');
    s.redo();
    draw();
    expect(selector('Robot 2 personality').textContent).toBe('Chaotic');
  });
  it('switching to Classic (Extended off) stops every Robot; back on, they run again', () => {
    s.start();
    render(200);
    s.comp.extended.enabled = false;
    s.changed('extended');
    const n = s.conductor.log.length;
    render(1200);
    expect(s.conductor.log.length).toBe(n);
    expect(s.engine.observer).toBeNull();
    s.comp.extended.enabled = true;
    s.changed('extended');
    render(1600);
    expect(s.conductor.log.length).toBeGreaterThan(n);
    s.stop();
    // Classic Mode closed the window: open it again
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', altKey: true, bubbles: true, cancelable: true }));
    draw();
  });
});

describe('selecting a Robot is not switching it', () => {
  const on = (i: number) => s.conductor.robotOn(i);
  const num = (i: number) => win().querySelector<HTMLDivElement>(`[aria-label="Edit Robot ${i + 1}"]`)!;
  const sw = (i: number) => win().querySelector<HTMLDivElement>(`[aria-label="Robot ${i + 1} on / off"]`)!;
  it('clicking an OFF Robot’s number selects it for editing and leaves it OFF; others keep running', () => {
    s.setRobotEnabled(0, true);
    s.setRobotEnabled(1, false);
    s.setRobotEnabled(2, false);
    s.setRobotEnabled(3, true);
    draw();
    pd(num(2));
    draw();
    expect(ui.robotsWin.sel).toBe(2);
    expect(ui.robotsWin.tab).toBe('robot');
    expect([0, 1, 2, 3].map(on)).toEqual([true, false, false, true]);
    expect(num(2).getAttribute('aria-pressed')).toBe('true');
    expect(num(1).getAttribute('aria-pressed')).toBe('false');
    expect(sw(2).textContent).toBe('OFF');
    expect(sw(3).textContent).toBe('ON');
    expect(win().textContent).toMatch(/Robot 3/);
  });
  it('an OFF Robot can be configured completely, and stays OFF', () => {
    choose('Robot 3 personality', 'Chaotic');
    pd(byText('[role=switch]', 'Pattern Group'));
    typeInto(/Rate \(M’s Time Base\)/, '1/2');
    typeInto(/Chaotic: smallest jump/, '2');
    pd(byText('[role=switch]', 'c'));
    draw();
    const r = s.comp.extended.robots[2];
    expect(r.personality).toBe('chaotic');
    expect(r.variables).toContain('patternGroup');
    expect([r.rateNum, r.rateDen]).toEqual([1, 2]);
    expect(r.params.minJump).toBe(2);
    expect(r.groups[2]).toBe(false);
    expect(r.enabled).toBe(false);
    expect([0, 1, 2, 3].map(on)).toEqual([true, false, false, true]);
  });
  it('selecting an ON Robot does not switch it off; going back to another keeps every setting', () => {
    const before = structuredClone(s.comp.extended.robots);
    pd(num(3));
    draw();
    expect(ui.robotsWin.sel).toBe(3);
    expect(on(3)).toBe(true);
    pd(within('div').filter((d) => d.style.width === '336px')[0]); // the row
    draw();
    expect(ui.robotsWin.sel).toBe(0);
    expect(on(0)).toBe(true);
    pd(num(2));
    draw();
    expect(s.comp.extended.robots).toEqual(before);
    expect(selector('Robot 3 personality').textContent).toBe('Chaotic');
  });
  it('the keyboard follows the same split: Enter / Space on a number selects; on ON / OFF they switch', () => {
    num(1).focus();
    key(num(1), 'Enter');
    draw();
    expect(ui.robotsWin.sel).toBe(1);
    expect(on(1)).toBe(false);
    key(num(2), ' ');
    draw();
    expect(ui.robotsWin.sel).toBe(2);
    expect(on(2)).toBe(false);
    expect(s.engine.state).toBe('stopped');
    sw(2).focus();
    key(sw(2), 'Enter');
    draw();
    expect(on(2)).toBe(true);
    expect(sw(2).getAttribute('aria-checked')).toBe('true');
    expect(ui.robotsWin.sel).toBe(2);
    pd(sw(2));
    draw();
    expect(on(2)).toBe(false);
    expect(sw(2).textContent).toBe('OFF');
  });
  it('selecting Robots while playing changes nothing in the music', () => {
    s.setRobotEnabled(1, true);
    // Stop leaves the Variables where the Robots put them: every run starts from the same place
    const comp = s.comp as unknown as Record<string, { active?: number }>;
    const start = Object.fromEntries(Object.keys(comp).filter((k) => typeof comp[k]?.active === 'number').map((k) => [k, comp[k].active]));
    const baton = { ...s.comp.conducting.baton };
    const notes = () => {
      const out: string[] = [];
      for (const [k, a] of Object.entries(start)) comp[k].active = a;
      s.comp.conducting.baton = { ...baton };
      s.start();
      for (let t = 24; t <= 384 * 6; t += 24) {
        const evs = s.engine.render(t);
        s.emitNow(evs);
        for (const e of evs) if (e.kind === 'on' || e.kind === 'change') out.push(JSON.stringify({ ...e, id: undefined })); // (note ids count on)
        if (clicking && t % 96 === 0) {
          pd(num((t / 96) % 4));
          pd(within('div').filter((d) => d.style.width === '336px')[(t / 96 + 1) % 4]);
          draw();
        }
      }
      s.stop();
      return out;
    };
    let clicking = false;
    const plain = notes();
    expect(notes()).toEqual(plain); // the control: two runs without clicks are identical
    clicking = true;
    const clicked = notes();
    expect(clicked).toEqual(plain);
    expect(plain.length).toBeGreaterThan(20);
  });
});

describe('Allowed Groups (ROBOT tab)', () => {
  it('six Group switches a–f; the last allowed one cannot be switched off; All allows every Group again', () => {
    pd(win().querySelector(`[aria-label="Edit Robot 2"]`)!);
    draw();
    s.allowAllGroups(1);
    draw();
    const g = (l: string) => byText('[role=switch]', l);
    expect(['a', 'b', 'c', 'd', 'e', 'f'].map((l) => g(l).getAttribute('aria-checked'))).toEqual(Array(6).fill('true'));
    expect(win().textContent).toMatch(/Allowed Groups: (chooses )?any Pattern Group/);
    for (const l of ['c', 'd', 'e', 'f', 'b']) pd(g(l));
    draw();
    expect(s.comp.extended.robots[1].groups).toEqual([true, false, false, false, false, false]);
    pd(g('a')); // refused
    draw();
    expect(s.comp.extended.robots[1].groups[0]).toBe(true);
    expect(win().textContent).toMatch(/at least one Pattern Group must stay allowed/);
    expect(win().textContent).toMatch(/only Group a/);
    pd(g('c'));
    draw();
    expect(win().textContent).toMatch(/only Groups a c/);
    // the overview shows the restriction when the Robot moves Pattern Group
    if (!s.comp.extended.robots[1].variables.includes('patternGroup')) pd(byText('[role=switch]', 'Pattern Group'));
    draw();
    expect(win().textContent).toMatch(/PGrp:ac/);
    pd(byText('.btn', 'All'));
    draw();
    expect(s.comp.extended.robots[1].groups).toEqual([true, true, true, true, true, true]);
  });
  it('a Robot keeps to its Groups in the music, also when switched on from the overview', () => {
    s.allowAllGroups(1);
    for (const g of [2, 3, 4, 5]) s.setRobotGroup(1, g, false);
    s.setRobot(1, { personality: 'chaotic', variables: ['patternGroup'], rateNum: 1, rateDen: 8 });
    s.setRobotEnabled(1, false);
    draw();
    pd(win().querySelector('[aria-label="Robot 2 on / off"]')!);
    expect(s.conductor.robotOn(1)).toBe(true);
    s.start();
    const seen = new Set<number>();
    // only the music is checked here, so the window is drawn once at the end, not every step
    for (let t = 24; t <= 384 * 12; t += 24) {
      s.emitNow(s.engine.render(t));
      seen.add(act('patternGroup'));
    }
    draw();
    s.stop();
    expect(seen).toEqual(new Set([0, 1]));
    s.allowAllGroups(1);
  });
});

describe('Change Sync, Smart and Genius in the window', () => {
  it('sync and the new personalities are chosen through the controls; selecting a Robot never switches it', () => {
    s.setRobotEnabled(3, false);
    draw();
    pd(win().querySelector<HTMLDivElement>('[aria-label="Edit Robot 4"]')!);
    draw();
    expect(ui.robotsWin.sel).toBe(3);
    expect(options('Robot 4 Change Sync').map((o) => o.text)).toEqual(['FREE', 'BEAT', 'BAR', '2 BARS', '4 BARS', '8 BARS']);
    choose('Robot 4 Change Sync', '4 BARS');
    expect(s.comp.extended.robots[3].sync).toBe(16);
    choose('Robot 4 personality', 'Smart');
    expect(s.comp.extended.robots[3].personality).toBe('smart');
    expect(win().textContent).toMatch(/Thinks in phrases/);
    expect(win().textContent).toMatch(/Change Sync 4 BARS: its own moves take effect at the next 4-bar boundary/);
    choose('Robot 4 personality', 'Genius');
    expect(s.comp.extended.robots[3].personality).toBe('genius');
    expect(within('.label.tiny').map((l) => l.textContent)).toContain('explore %');
    // still off, and the Allowed Groups row is still there
    expect(s.conductor.robotOn(3)).toBe(false);
    expect(win().querySelector('[aria-label="Robot 4 on / off"]')!.textContent).toBe('OFF');
    expect(win().textContent).toMatch(/Allowed Groups:/);
    choose('Robot 4 Change Sync', 'FREE');
    s.setRobot(3, { personality: 'restless' });
  });
});
