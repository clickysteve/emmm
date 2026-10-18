// @vitest-environment happy-dom
/**
 * Monitor Output: the internal monitor's output chain (Slop Factory Core engines). The window is
 * built from engine metadata, every change reaches the monitor and is saved as an application
 * preference, unknown engines are kept, and MIDI is never routed through it.
 */
import { describe, expect, it } from 'vitest';
import { Prefs, type PrefStore } from '../src/app/prefs';
import { Monitor } from '../src/audio/monitor';
import { MONITOR_ENGINES } from '../src/audio/output';
import { OutputWindow } from '../src/ui/outputWindow';

function store(init: Record<string, string> = {}): PrefStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

function setup(init: Record<string, string> = {}) {
  const st = store(init);
  const prefs = new Prefs(st);
  const monitor = new Monitor();
  const sent: unknown[] = [];
  const setChain = monitor.setChain.bind(monitor);
  monitor.setChain = (c) => (sent.push(c), setChain(c));
  document.body.innerHTML = '';
  const w = new OutputWindow(prefs, monitor, document.body);
  return { st, prefs, monitor, sent, w, body: w.win.body };
}

describe('Monitor Output', () => {
  it('offers the audio engines only (emmm has no MIDI engines to offer)', () => {
    expect(MONITOR_ENGINES.list({ kind: 'audio' }).map((e) => e.id)).toEqual(['goodbits.output-stage', 'goodbits.drive', 'goodbits.crunch', 'core.tone']);
    expect(MONITOR_ENGINES.list({ kind: 'midi' })).toEqual([]);
  });

  it('starts empty: the monitor sounds as before', () => {
    const { prefs, sent } = setup();
    expect(prefs.monitorOutput).toEqual({ version: 1, bypass: false, stages: [] });
    expect(sent).toEqual([prefs.monitorOutput]);
  });

  it('changes reach the monitor and are saved; controls come from the engines', () => {
    const { w, st, sent, body, prefs } = setup();
    const id = w.chain.add('goodbits.drive')!;
    w.chain.add('goodbits.output-stage');
    w.chain.setParam(id, 'amountPct', 65);
    w.chain.move(id, 1);
    w.chain.setBypass(true);
    const saved = JSON.parse(st.data.get('emmm.monitorOutput')!);
    expect(saved).toEqual(w.chain.config);
    expect(sent.at(-1)).toEqual(w.chain.config);
    expect(saved.stages.map((s: { engine: string }) => s.engine)).toEqual(['goodbits.output-stage', 'goodbits.drive']);
    expect(prefs.monitorOutput.stages[1]!.params.amountPct).toBe(65);
    // the selected stage (Drive, followed when it moved) shows its parameters by their metadata
    expect(body.textContent).toContain('Type');
    expect(body.textContent).toContain('Amount');
    expect(body.textContent).toContain('65%');
    expect(body.querySelectorAll('.msel').length).toBeGreaterThan(0);
    // a reload restores it
    expect(new Prefs(st).monitorOutput).toEqual(w.chain.config);
  });

  it('keeps stages of engines emmm does not have, and shows them as unavailable', () => {
    const { w, body } = setup({ 'emmm.monitorOutput': JSON.stringify({ stages: [{ id: 's1', engine: 'other.app-reverb', enabled: true, params: { size: 2 } }] }) });
    expect(w.chain.stages[0]).toEqual({ id: 's1', engine: 'other.app-reverb', enabled: true, params: { size: 2 } });
    expect(body.textContent).toContain('Unavailable');
  });

  it('a corrupt preference does not stop emmm', () => {
    const { prefs } = setup({ 'emmm.monitorOutput': '{not json' });
    expect(prefs.monitorOutput.stages).toEqual([]);
  });
});
