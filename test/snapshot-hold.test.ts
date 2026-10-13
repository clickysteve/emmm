// @vitest-environment happy-dom
/**
 * Hold an empty Snapshot letter to Capture All into it (the same Capture All as a double-click
 * on the slot). A quick tap of an empty letter does nothing; occupied letters recall at once
 * and are never overwritten; typing, modifiers and focus loss never capture.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../src/app/session';
import { captureAll } from '../src/engine/snapshots';
import { commands, IS_MAC } from '../src/ui/keys';
import { SNAPSHOT_HOLD_MS } from '../src/ui/snapshotHold';

let s: Session;
beforeAll(async () => {
  await import('../src/main');
  s = (window as unknown as { emmm: Session }).emmm;
  document.querySelector('.mdialog')?.remove();
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  s.comp.snapshots.fill(null);
  s.hold = null;
  s.comp.quantization = 0;
  s.comp.extended.enabled = true;
});
afterEach(() => {
  vi.useRealTimers();
  (document.activeElement as HTMLElement)?.blur?.();
});

const I = 18; // S
const down = (k = 's', init: KeyboardEventInit = {}, target: EventTarget = (document.activeElement as HTMLElement) ?? document.body) => {
  const ev = new KeyboardEvent('keydown', { key: k, code: 'Key' + k.toUpperCase(), bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
};
const up = (k = 's') => window.dispatchEvent(new KeyboardEvent('keyup', { key: k, code: 'Key' + k.toUpperCase(), bubbles: true }));
const wait = (ms: number) => vi.advanceTimersByTime(ms);
const slot = (i: number) => [...document.querySelectorAll<HTMLDivElement>('[data-win="snapshot"] .num')].filter((d) => /^Snapshot [A-Z]:/.test(d.dataset.tip || d.title || ''))[i];

describe('press and hold an empty Snapshot letter', () => {
  it('the threshold is one constant: 400 ms', () => {
    expect(SNAPSHOT_HOLD_MS).toBe(400);
  });

  it('a quick tap on an empty slot does nothing', () => {
    const before = JSON.stringify(s.comp);
    down();
    wait(100);
    up();
    wait(1000);
    expect(s.comp.snapshots[I]).toBeNull();
    expect(JSON.stringify(s.comp)).toBe(before);
  });

  it('held, it captures everything once, at the threshold — the same Capture All as a double-click', () => {
    const spy = vi.spyOn(s, 'captureAllInto');
    down();
    wait(SNAPSHOT_HOLD_MS - 50);
    expect(s.comp.snapshots[I]).toBeNull();
    const expected = captureAll(s.comp);
    wait(50);
    expect(s.comp.snapshots[I]).toEqual(expected); // stored while the key is still down
    expect(spy).toHaveBeenCalledTimes(1);
    const stored = JSON.stringify(s.comp.snapshots[I]);
    for (let n = 0; n < 10; n++) (down('s', { repeat: true }), wait(100)); // OS auto-repeat
    up();
    wait(1000);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(s.comp.snapshots[I])).toBe(stored);
    expect(s.currentSnapshot).toBe(I);
    // the slot shows as occupied
    (window as unknown as { emmmUi: { updateAll: () => void } }).emmmUi.updateAll();
    expect(slot(I).dataset.tip).toMatch(/^Snapshot S: (?!empty)/);
    spy.mockRestore();
  });

  it('the saved state can be recalled with a tap', () => {
    down();
    wait(SNAPSHOT_HOLD_MS);
    up();
    const want = s.comp.snapshots[I]!.positions.accent!;
    s.clickPosition('accent', (want + 1) % 6);
    expect(s.comp.accent.active).not.toBe(want);
    down();
    up();
    expect(s.comp.accent.active).toBe(want);
  });

  it('an occupied slot recalls at once and is never overwritten by holding', () => {
    s.comp.snapshots[I] = captureAll(s.comp);
    const stored = JSON.stringify(s.comp.snapshots[I]);
    const want = s.comp.accent.active;
    s.clickPosition('accent', (want + 1) % 6);
    const spy = vi.spyOn(s, 'executeSnapshot');
    down();
    expect(spy).toHaveBeenCalledTimes(1); // no delay
    expect(s.comp.accent.active).toBe(want);
    s.clickPosition('accent', (want + 2) % 6);
    wait(SNAPSHOT_HOLD_MS * 3);
    up();
    expect(JSON.stringify(s.comp.snapshots[I])).toBe(stored);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('double-click Capture All still works', () => {
    slot(5).dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    expect(s.comp.snapshots[5]).toEqual(captureAll(s.comp));
  });

  it('with Hold/Do blinking, the letter stores the selection at once (as before) — never everything', () => {
    s.holdDo();
    s.clickPosition('accent', 2);
    expect(s.hold).not.toBeNull();
    down();
    expect(Object.keys(s.comp.snapshots[I]!.positions)).toEqual(['accent']);
    wait(SNAPSHOT_HOLD_MS * 2);
    up();
    expect(Object.keys(s.comp.snapshots[I]!.positions)).toEqual(['accent']);
  });

  it('a hold leaves a blinking selection alone if one starts during it', () => {
    down();
    s.holdDo();
    s.clickPosition('accent', 3);
    const pending = JSON.stringify(s.hold!.pending);
    wait(SNAPSHOT_HOLD_MS);
    up();
    expect(JSON.stringify(s.hold?.pending)).toBe(pending);
    s.hold = null;
  });

  it('never while typing in a text field or a number box', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    down('s', {}, input);
    wait(SNAPSHOT_HOLD_MS * 2);
    expect(s.comp.snapshots[I]).toBeNull();
    input.remove();
    const tempo = [...document.querySelectorAll<HTMLDivElement>('[data-win="conducting"] .num[role="spinbutton"]')].find((e) => /^Tempo/.test(e.title))!;
    tempo.focus();
    down('1');
    down();
    wait(SNAPSHOT_HOLD_MS * 2);
    expect(s.comp.snapshots[I]).toBeNull();
    down('Escape');
  });

  it('⌘S / Ctrl+S is Save, not Snapshot S; a modifier pressed during the hold cancels it', () => {
    const save = commands.get('save')!;
    const run = save.run;
    let saved = 0;
    save.run = () => saved++;
    down('s', IS_MAC ? { metaKey: true } : { ctrlKey: true });
    wait(SNAPSHOT_HOLD_MS * 2);
    save.run = run;
    expect(saved).toBe(1);
    expect(s.comp.snapshots[I]).toBeNull();
    down();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true, bubbles: true }));
    wait(SNAPSHOT_HOLD_MS * 2);
    expect(s.comp.snapshots[I]).toBeNull();
  });

  it('focus loss or a hidden page cancels a pending hold (no stuck key)', () => {
    down();
    wait(200);
    window.dispatchEvent(new Event('blur'));
    wait(SNAPSHOT_HOLD_MS * 2);
    expect(s.comp.snapshots[I]).toBeNull();
    down();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    wait(SNAPSHOT_HOLD_MS * 2);
    expect(s.comp.snapshots[I]).toBeNull();
  });

  it('playback and the Robots carry on: no stop, no recall, nothing reset', () => {
    s.setRobotEnabled(0, true);
    down(' ', { code: 'Space' } as KeyboardEventInit);
    expect(s.engine.state).toBe('playing');
    const robots = JSON.stringify(s.comp.extended.robots);
    const conducting = JSON.stringify(s.comp.conducting);
    const tick = s.engine.tick;
    down();
    wait(SNAPSHOT_HOLD_MS);
    up();
    expect(s.comp.snapshots[I]).not.toBeNull();
    expect(s.engine.state).toBe('playing');
    expect(s.engine.tick).toBeGreaterThanOrEqual(tick);
    expect(JSON.stringify(s.comp.extended.robots)).toBe(robots);
    expect(JSON.stringify(s.comp.conducting)).toBe(conducting);
    s.stop();
    s.setRobotEnabled(0, false);
  });

  it('Classic Mode: the same restrictions as Capture All (no Octave)', () => {
    s.comp.extended.enabled = false;
    down();
    wait(SNAPSHOT_HOLD_MS);
    up();
    expect(s.comp.snapshots[I]!.positions.octave).toBeUndefined();
    expect(s.comp.snapshots[I]).toEqual(captureAll(s.comp));
  });
});
