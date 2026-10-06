/**
 * EXTENDED window: switch Extended mode on, MIDI clock input, MIDI Learn mappings.
 * Drawn in the same visual language, but clearly labelled as not part of Classic M.
 */
import { sourceLabel, targetLabel } from '../extended/extended';
import type { UiContext } from './context';
import { el, label } from './dom';
import { MWindow } from './widgets';

export class ExtendedWindow {
  win: MWindow;
  private parts: { update(): void }[] = [];
  private builtFor: object | null = null;
  private portSig = '';
  constructor(private ctx: UiContext, parent: HTMLElement) {
    this.win = new MWindow(parent, { id: 'extended', title: 'Extended', x: 150, y: 40, w: 300, h: 360, closable: true });
  }

  private toggle(x: number, y: number, w: number, get: () => boolean, set: (v: boolean) => void, text: string, title = ''): void {
    const d = el('div', 'num', this.win.body, [x, y, w, 14]);
    d.style.fontSize = '9px';
    d.style.justifyContent = 'flex-start';
    d.style.paddingLeft = '3px';
    d.title = title;
    d.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      set(!get());
      this.ctx.s.changed('extended');
    });
    this.parts.push({ update: () => ((d.textContent = (get() ? '☒ ' : '☐ ') + text), d.classList.toggle('inv', get())) });
  }

  private build(): void {
    const s = this.ctx.s;
    const ext = s.comp.extended;
    const b = this.win.body;
    b.innerHTML = '';
    this.parts = [];
    this.builtFor = s.comp;
    const note = el('div', 'label small', b, [6, 4, 288, 22]);
    note.style.whiteSpace = 'normal';
    note.style.lineHeight = '10px';
    note.innerHTML = 'Not part of Classic M — ideas for what M might have become. Nothing here changes how notes are generated.';
    this.toggle(6, 28, 140, () => ext.enabled, (v) => (ext.enabled = v), 'Extended mode on');
    label(b, 6, 50, '<b>MIDI clock input</b>');
    this.toggle(6, 62, 110, () => ext.clockIn.enabled, (v) => (ext.clockIn.enabled = v), 'follow clock', 'Follow an external MIDI clock (24 ppq) tempo');
    this.toggle(120, 62, 120, () => ext.clockIn.transport, (v) => (ext.clockIn.transport = v), 'Start/Stop/Cont', 'Follow external Start, Stop and Continue');
    const sel = el('select', 'mselect', b, [6, 80, 180, 14]);
    sel.style.position = 'absolute';
    sel.style.fontSize = '8px';
    for (const o of [{ id: '*', name: 'any input' }, ...s.midi.inputs()]) {
      const op = document.createElement('option');
      op.value = o.id;
      op.textContent = o.name;
      sel.appendChild(op);
    }
    sel.value = ext.clockIn.port;
    sel.addEventListener('change', () => ((ext.clockIn.port = sel.value), s.changed('extended')));
    sel.addEventListener('pointerdown', (e) => e.stopPropagation());
    const st = el('div', 'label small', b, [192, 83, 100, 10]);
    this.parts.push({ update: () => (st.textContent = ext.enabled && ext.clockIn.enabled ? (s.extStatus.bpm ? `${s.extStatus.bpm.toFixed(1)} bpm in` : 'waiting…') : '') });

    label(b, 6, 104, '<b>MIDI Learn</b>');
    label(b, 70, 105, 'click Learn, then move a knob or press a key', 'tiny');
    ext.learn.forEach((m, i) => {
      const col = i < 16 ? 0 : 1;
      const x = 6 + col * 146;
      const y = 116 + (i % 16) * 14;
      label(b, x, y + 3, targetLabel(m.target), 'small');
      const src = el('div', 'label tiny', b, [x + 64, y + 4, 46, 8]);
      const learn = el('div', 'btn', b, [x + 110, y, 32, 13], 'Learn');
      learn.style.fontSize = '8px';
      learn.title = 'Learn: then move a controller or press a key. Alt-click clears.';
      learn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (e.altKey) {
          m.source = null;
          if (s.learnArmed === i) s.learnArmed = null;
        } else s.learnArmed = s.learnArmed === i ? null : i;
        s.changed('learn');
      });
      this.parts.push({
        update: () => {
          src.textContent = sourceLabel(m.source);
          learn.classList.toggle('on', s.learnArmed === i);
          learn.classList.toggle('blink', s.learnArmed === i);
        },
      });
    });
  }

  update(): void {
    const s = this.ctx.s;
    const sig = s.midi.inputs().map((i) => i.id).join();
    if (this.builtFor !== s.comp || sig !== this.portSig) {
      this.portSig = sig;
      this.build();
    }
    this.parts.forEach((p) => p.update());
  }
}
