/**
 * Monitor Output (emmm, Options ▸ Monitor Output…): an output chain of Slop Factory Core
 * engines on the internal monitor sound (audio/output.ts). Left, the chain in signal order
 * (select · On · ▲ ▼ · Remove), Add and Bypass All, presets; right, the selected stage's engine
 * and parameters. Every control is built from the engines' parameter descriptions: M-style
 * numericals for numbers, pop-up selectors for choices.
 *
 * Only the monitor is processed: MIDI to devices never is, nor the metronome click. The chain
 * is an application preference (it belongs to this setup, like the MIDI mappings), not part of
 * a document, so it is not in undo or in saved compositions.
 */
import { formatParam, matchChainPreset, OutputChain, presetsFor, type ParamDef, type StageConfig } from '@slopfactory/core/engines';
import type { Prefs } from '../app/prefs';
import type { Monitor } from '../audio/monitor';
import { MONITOR_ENGINES } from '../audio/output';
import { el, label, setTip } from './dom';
import { Selector } from './selector';
import { MWindow, Numerical } from './widgets';

const ROW = 16;
const RX = 200;
const W = 404;
const H = 262;

type Part = { update(): void };

export class OutputWindow {
  win: MWindow;
  readonly chain: OutputChain;
  private parts: Part[] = [];
  private fixed: Part[] = [];
  private rows: HTMLDivElement;
  private detail: HTMLDivElement;
  private shape = '';
  private selected: string | null;

  constructor(
    prefs: Prefs,
    private monitor: Monitor,
    parent: HTMLElement,
  ) {
    this.win = new MWindow(parent, { id: 'monitorout', title: 'Monitor Output', x: 160, y: 70, w: W, h: H, closable: true, area: 'midi' });
    this.chain = new OutputChain(MONITOR_ENGINES, prefs.monitorOutput);
    this.selected = this.chain.stages[0]?.id ?? null;
    monitor.setChain(this.chain.config);
    this.chain.subscribe((c) => {
      prefs.monitorOutput = c;
      prefs.saveMonitorOutput();
      monitor.setChain(c);
      this.update();
    });
    monitor.onChainState = () => this.update();
    const b = this.win.body;
    b.addEventListener('keydown', (e) => e.stopPropagation());

    label(b, 4, 4, '<b>Chain</b> · monitor → 1 → 2 → … → speakers', 'small');
    this.rows = el('div', '', b, [0, 18, RX - 6, ROW * 8]);
    this.rows.style.position = 'absolute';
    const empty = el('div', 'label small', b, [6, 22, RX - 16]);
    empty.style.whiteSpace = 'normal';
    empty.style.lineHeight = '10px';
    empty.textContent = 'No engines: the monitor plays as it always did. Add one below, or choose a preset.';
    this.fixed.push({ update: () => (empty.style.display = this.chain.stages.length ? 'none' : 'block') });

    const y0 = 18 + ROW * 8 + 4;
    this.fixed.push(
      new Selector(b, 4, y0, 98, 14, {
        label: 'Add an engine at the end of the chain (up to 8)',
        fontSize: 9,
        options: () => [{ value: '', text: 'Add engine…', disabled: true }, ...this.chain.available().map((e) => ({ value: e.id, text: e.name, disabled: !this.chain.canAdd }))],
        value: () => '',
        onChange: (id) => {
          const s = this.chain.add(id);
          if (s) this.select(s);
        },
      }),
    );
    const bypass = this.button(b, 106, y0, 84, 'Bypass All', 'Hear the monitor without the chain (settings kept)', () => this.chain.setBypass(!this.chain.config.bypass));
    this.fixed.push({ update: () => bypass.classList.toggle('on', this.chain.config.bypass) });
    const presets = presetsFor(MONITOR_ENGINES);
    this.fixed.push(
      new Selector(b, 4, y0 + 18, 186, 14, {
        label: 'Preset: replace the chain with a starting point',
        fontSize: 9,
        options: () => [{ value: '', text: 'Preset: (custom)', disabled: true }, ...presets.map((p) => ({ value: p.key, text: `Preset: ${p.label}` }))],
        value: () => matchChainPreset(this.chain.config, presets) ?? '',
        onChange: (k) => {
          const p = presets.find((x) => x.key === k);
          if (p && this.chain.applyPreset(p)) this.select(this.chain.stages[0]?.id ?? null);
        },
      }),
    );

    const rule = el('div', '', b, [RX - 6, 4, 0, y0 + 30]);
    Object.assign(rule.style, { position: 'absolute', borderLeft: '1px dotted var(--ink)' });
    this.detail = el('div', '', b, [RX, 0, W - RX - 6, y0 + 34]);
    this.detail.style.position = 'absolute';

    const note = el('div', 'label small', b, [4, H - 44, W - 12, 26]);
    Object.assign(note.style, { whiteSpace: 'normal', lineHeight: '10px' });
    this.fixed.push({
      update: () => {
        note.textContent =
          (this.monitor.chainProcessing ? '' : 'The chain starts with the monitor sound (it needs AudioWorklet: https or localhost). ') +
          'Only the internal monitor is processed: MIDI to your devices never is, nor the metronome click. Saved in this browser.';
      },
    });
    this.update();
  }

  private button(parent: HTMLElement, x: number, y: number, w: number, text: string, tip: string, f: () => void): HTMLDivElement {
    const d = el('div', 'btn', parent, [x, y, w, 14], text);
    d.style.fontSize = '9px';
    d.setAttribute('role', 'button');
    setTip(d, tip);
    d.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!d.classList.contains('disabled')) f();
    });
    return d;
  }

  private select(id: string | null): void {
    this.selected = id;
    this.update();
  }

  private paramControl(parent: HTMLElement, x: number, y: number, w: number, def: ParamDef, stage: () => StageConfig | undefined): Part {
    const get = () => stage()?.params[def.id] ?? def.default;
    const set = (v: number | boolean | string) => {
      const s = stage();
      if (s) this.chain.setParam(s.id, def.id, v);
    };
    if (def.type === 'enum') {
      return new Selector(parent, x, y, w, 14, {
        label: `${def.label}${def.description ? `: ${def.description}` : ''}`,
        fontSize: 9,
        options: () => def.options.map((o) => ({ value: o.value, text: o.label })),
        value: () => String(get()),
        onChange: (v) => set(v),
      });
    }
    if (def.type === 'boolean') {
      const t = this.button(parent, x, y, 40, '', def.description ?? def.label, () => set(!get()));
      return { update: () => ((t.textContent = get() ? 'On' : 'Off'), t.classList.toggle('on', !!get())) };
    }
    const step = def.type === 'integer' ? 1 : (def.step ?? 1);
    const span = def.max - def.min;
    return new Numerical(parent, x, y, Math.min(w, 70), 14, {
      get: () => Number(get()),
      set: (v) => set(Math.round(v / step) * step),
      min: def.min,
      max: def.max,
      format: (v) => formatParam(def, v),
      // a full sweep in about 200 px of drag
      pxPerUnit: Math.max(0.01, 200 / (span / step)) / step,
      bigStep: Math.max(step, Math.round(span / 10 / step) * step),
      title: `${def.label}: ${def.min}–${def.max}${def.unit ? ` ${def.unit}` : ''}${def.neutral !== undefined ? ` (${def.neutral} = off)` : ''}${def.description ? `. ${def.description}` : ''}`,
    });
  }

  private build(): void {
    this.rows.replaceChildren();
    this.detail.replaceChildren();
    this.parts = [];
    this.chain.stages.forEach((s, i) => {
      const y = i * ROW;
      const def = this.chain.engine(s);
      label(this.rows, 4, y + 3, String(i + 1), 'small');
      const name = this.button(this.rows, 14, y, 82, def ? def.name : 'Unavailable', def ? `${def.name}: ${def.description}` : `“${s.engine}” is not an engine emmm has (saved by another application). It passes audio through.`, () => this.select(s.id));
      if (!def) name.style.borderStyle = 'dotted';
      const on = this.button(this.rows, 98, y, 24, 'On', 'Off: this engine is bypassed (settings kept)', () => this.chain.setEnabled(s.id, !this.chain.stage(s.id)!.enabled));
      const up = this.button(this.rows, 124, y, 14, '▲', 'Earlier in the chain', () => this.chain.move(s.id, -1));
      const dn = this.button(this.rows, 140, y, 14, '▼', 'Later in the chain', () => this.chain.move(s.id, 1));
      this.button(this.rows, 156, y, 36, 'Remove', 'Remove this engine from the chain', () => {
        const k = this.chain.stages.findIndex((x) => x.id === s.id);
        this.chain.remove(s.id);
        if (this.selected === s.id) this.selected = this.chain.stages[Math.min(k, this.chain.stages.length - 1)]?.id ?? null;
        this.update();
      });
      this.parts.push({
        update: () => {
          const cur = this.chain.stage(s.id);
          const k = this.chain.stages.findIndex((x) => x.id === s.id);
          name.classList.toggle('on', this.selected === s.id);
          on.classList.toggle('on', !!cur?.enabled);
          up.classList.toggle('disabled', k === 0);
          dn.classList.toggle('disabled', k === this.chain.stages.length - 1);
        },
      });
    });
    const i = this.chain.stages.findIndex((s) => s.id === this.selected);
    const s = this.chain.stages[i];
    const DW = W - RX - 6;
    if (!s) {
      label(this.detail, 0, 4, this.chain.stages.length ? 'Select an engine to edit it.' : '', 'small');
      return;
    }
    const def = this.chain.engine(s);
    if (!def) {
      const t = el('div', 'label small', this.detail, [0, 4, DW, 60]);
      Object.assign(t.style, { whiteSpace: 'normal', lineHeight: '10px' });
      t.textContent = `${i + 1} · “${s.engine}” was saved by an application with an engine emmm does not have. It is kept unchanged and passes audio through; Remove drops it.`;
      return;
    }
    label(this.detail, 0, 4, `<b>${i + 1}</b>`, 'small');
    this.parts.push(
      new Selector(this.detail, 12, 1, 110, 14, {
        label: 'Swap this stage for another engine (same place in the chain)',
        fontSize: 9,
        options: () => this.chain.available().map((e) => ({ value: e.id, text: e.name })),
        value: () => s.engine,
        onChange: (id) => this.chain.replace(s.id, id),
      }),
    );
    this.button(this.detail, DW - 52, 1, 52, 'Defaults', `Every ${def.name} parameter back to its default`, () => this.chain.resetParams(s.id));
    const desc = el('div', 'label small', this.detail, [0, 19, DW, 30]);
    Object.assign(desc.style, { whiteSpace: 'normal', lineHeight: '10px' });
    desc.textContent = def.description;
    const stage = () => this.chain.stage(s.id);
    def.params.forEach((p, k) => {
      const y = 52 + k * 18;
      const l = el('div', 'label small', this.detail, [0, y + 3, 70], p.label);
      l.style.whiteSpace = 'nowrap';
      this.parts.push(this.paramControl(this.detail, 72, y, DW - 72, p, stage));
    });
  }

  update(): void {
    if (!this.selected || !this.chain.stage(this.selected)) this.selected = this.chain.stages[0]?.id ?? null;
    const shape = JSON.stringify([this.chain.stages.map((s) => [s.id, s.engine]), this.selected]);
    if (shape !== this.shape) {
      this.shape = shape;
      this.build();
    }
    for (const p of this.fixed) p.update();
    for (const p of this.parts) p.update();
  }
}
