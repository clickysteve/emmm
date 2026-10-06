/**
 * Midi Assignment (S1 ch.19), the event Monitor (emmm), About, MIDI File import dialog and
 * the browser Library (emmm).
 */
import { noteName } from '../engine/constants';
import { newPattern } from '../engine/patternOps';
import type { Session } from '../app/session';
import * as msg from '../midi/messages';
import { notesToSteps, readSmf, type ParsedSmf } from '../midi/smf';
import { deleteFromLibrary, listLibrary, loadFromLibrary, saveToLibrary } from '../persistence/storage';
import type { UiContext } from './context';
import { el, label } from './dom';
import { noteValueIcon } from './icons';
import { confirmDialog } from './dialogs';
import { Selector, type SelectorOption } from './selector';

const escapeHtml = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
import { MWindow, Numerical } from './widgets';

/** A device pop-up (shared emmm selector). Choices are read live, so devices that are
 * connected or removed while the window is open appear at once. */
function deviceSelector(parent: HTMLElement, x: number, y: number, w: number, label: string, options: () => SelectorOption[], value: () => string, onChange: (v: string) => void): Selector {
  return new Selector(parent, x, y, w, 13, { options, value, onChange, label, fontSize: 8, missingText: () => 'not connected' });
}

// ---------------------------------------------------------------------------- Midi Assignment

export class MidiAssignmentWindow {
  win: MWindow;
  private body: HTMLElement;
  private sig = '';
  private parts: { update(): void }[] = [];
  constructor(private ctx: UiContext, parent: HTMLElement) {
    this.win = new MWindow(parent, { id: 'midiassign', title: 'Midi Assignment', x: 90, y: 30, w: 470, h: 392, closable: true, area: 'midi' });
    this.body = this.win.body;
    this.build();
  }

  private outputOptions(): { value: string; text: string }[] {
    const s = this.ctx.s;
    return [{ value: '', text: '— none —' }, { value: 'monitor', text: 'emmm monitor (internal)' }, ...s.midi.outputs().map((o) => ({ value: o.id, text: o.name }))];
  }
  private inputOptions(): { value: string; text: string }[] {
    const s = this.ctx.s;
    return [{ value: '*', text: 'any input' }, { value: '', text: '— none —' }, ...s.midi.inputs().map((o) => ({ value: o.id, text: o.name })), { value: 'computer', text: 'computer keys' }];
  }

  private build(): void {
    const s = this.ctx.s;
    const b = this.body;
    b.innerHTML = '';
    this.parts = [];
    label(b, 22, 4, '<b>Input Channels</b>');
    label(b, 22, 15, 'Port/Device', 'small');
    label(b, 122, 15, 'Chan', 'small');
    label(b, 156, 4, '<b>Output Channels</b>');
    label(b, 156, 15, 'Port/Device', 'small');
    label(b, 254, 15, 'Chan', 'small');
    label(b, 282, 9, '1st<br>Pgm', 'tiny');
    for (let i = 0; i < 16; i++) {
      const y = 26 + i * 15;
      label(b, 4, y + 3, String(i + 1), 'small');
      const ia = s.comp.midi.inputs[i];
      this.parts.push(deviceSelector(b, 20, y, 100, `Input Channel ${i + 1}: port / device`, () => this.inputOptions(), () => ia.port, (v) => ((ia.port = v), s.changed('midi'))));
      this.parts.push(new Numerical(b, 122, y, 22, 13, { get: () => ia.channel, set: (x) => ((ia.channel = x), s.changed('midi')), min: 1, max: 16 }));
      const oa = s.comp.midi.outputs[i];
      this.parts.push(deviceSelector(b, 154, y, 98, `Output Channel ${i + 1}: port / device`, () => this.outputOptions(), () => oa.port, (v) => ((oa.port = v), s.changed('midi'))));
      this.parts.push(new Numerical(b, 254, y, 22, 13, { get: () => oa.channel, set: (x) => ((oa.channel = x), s.changed('midi')), min: 1, max: 16 }));
      const fp = el('div', 'num', b, [280, y, 16, 13]);
      fp.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        s.comp.midi.firstProgramIsOne[i] = !s.comp.midi.firstProgramIsOne[i];
        s.changed('midi');
      });
      this.parts.push({ update: () => (fp.textContent = s.comp.midi.firstProgramIsOne[i] ? '1' : '0') });
    }
    // quick set (emmm convenience): all 16 outputs to one device, channels 1-16
    label(b, 4, 272, '<b>All outputs →</b>', 'small');
    this.parts.push(
      new Selector(b, 70, 270, 130, 13, {
        label: 'All outputs: send M Output Channels 1–16 to one device, on MIDI channels 1–16',
        fontSize: 8,
        options: () => [{ value: '?', text: 'choose a device…', disabled: true }, ...this.outputOptions()],
        value: () => '?',
        onChange: (v) => {
          s.comp.midi.outputs.forEach((o, i) => ((o.port = v), (o.channel = i + 1)));
          s.changed('midi');
        },
      }),
    );
    const mon = el('div', 'btn', b, [206, 270, 92, 14], '');
    mon.style.fontSize = '9px';
    mon.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      s.monitorAll = !s.monitorAll;
      s.monitor.unlock();
      s.changed('midi');
    });
    this.parts.push({ update: () => ((mon.textContent = s.monitorAll ? 'monitor ALL: on' : 'monitor ALL: off'), mon.classList.toggle('on', s.monitorAll)) });
    const st = el('div', 'label small', b, [4, 290, 300, 30]);
    st.style.whiteSpace = 'normal';
    st.style.lineHeight = '10px';
    this.parts.push({
      update: () => {
        const m = s.midi;
        st.textContent =
          m.status === 'ready'
            ? `Web MIDI ready: ${m.outputs().length} output(s), ${m.inputs().length} input(s).`
            : m.status === 'unsupported'
              ? 'This browser has no Web MIDI. Use Chrome, Edge, Opera or Firefox; emmm still runs, with the internal monitor.'
              : m.status === 'denied'
                ? 'MIDI access was denied: ' + m.error
                : 'Requesting MIDI access…';
      },
    });
    const req = el('div', 'btn', b, [4, 322, 90, 14], 'Request MIDI');
    req.style.fontSize = '9px';
    req.addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      await s.midi.request();
      this.build();
    });
    // right column: MIDI conducting, sync, latency, messages
    const RX = 312;
    label(b, RX, 4, '<b>MIDI Conducting</b>');
    label(b, RX, 18, '↔ Ctrl#', 'small');
    this.parts.push(new Numerical(b, RX + 40, 15, 26, 13, { get: () => s.comp.midi.conductCtrlX, set: (x) => ((s.comp.midi.conductCtrlX = x), s.changed('midi')), min: 0, max: 127 }));
    label(b, RX + 76, 18, '↕', 'small');
    this.parts.push(new Numerical(b, RX + 88, 15, 26, 13, { get: () => s.comp.midi.conductCtrlY, set: (x) => ((s.comp.midi.conductCtrlY = x), s.changed('midi')), min: 0, max: 127 }));
    label(b, RX, 38, '<b>Send Sync</b> (MIDI clock)');
    this.parts.push(deviceSelector(b, RX, 50, 150, 'Send Sync: the device that receives MIDI clock', () => [{ value: '', text: '— none —' }, ...s.midi.outputs().map((o) => ({ value: o.id, text: o.name }))], () => s.comp.midi.clockPort, (v) => ((s.comp.midi.clockPort = v), s.changed('midi'))));
    label(b, RX, 70, '<b>Latency</b>');
    this.parts.push(new Numerical(b, RX + 50, 67, 34, 13, { get: () => s.comp.midi.latencyMs, set: (x) => ((s.comp.midi.latencyMs = x), s.changed('midi')), min: 0, max: 999 }));
    label(b, RX + 88, 70, 'ms', 'small');
    label(b, RX, 92, '<b>MIDI Messages</b> → orchestrated channels');
    const chans = () => [...new Set(s.comp.orchestration.positions[s.comp.orchestration.active].flat())];
    const mb = (x: number, y: number, w: number, t: string, f: () => void) => {
      const d = el('div', 'btn', b, [RX + x, y, w, 14], t);
      d.style.fontSize = '9px';
      d.style.borderRadius = '0';
      d.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        f();
      });
    };
    mb(0, 106, 72, 'Omni On', () => s.sendRaw(chans(), (c) => msg.omni(c, true)));
    mb(76, 106, 72, 'Omni Off', () => s.sendRaw(chans(), (c) => msg.omni(c, false)));
    mb(0, 122, 72, 'Mono Mode', () => s.sendRaw(chans(), (c) => msg.monoMode(c)));
    mb(76, 122, 72, 'Poly Mode', () => s.sendRaw(chans(), (c) => msg.polyMode(c)));
    mb(0, 142, 148, 'Local Control On', () => s.sendRaw(chans(), (c) => msg.localControl(c, true)));
    mb(0, 158, 148, 'Local Control Off', () => s.sendRaw(chans(), (c) => msg.localControl(c, false)));
    mb(0, 178, 148, 'All Notes Off  ⌘.', () => s.allNotesOff());
    mb(0, 194, 148, 'Panic', () => s.panic());
    const note = el('div', 'label small', b, [RX, 220, 150, 120]);
    note.style.whiteSpace = 'normal';
    note.style.lineHeight = '10px';
    note.innerHTML =
      'M Output Channels 1–16 are what the Orchestration Variable addresses; here each is mapped to a device and MIDI channel. Input Channels map incoming MIDI to the Src numericals. Choose <b>emmm monitor</b> to hear a channel without hardware.';
    this.sig = this.portSig();
  }

  /** Rebuild when another document is loaded (controls bind to it). Device lists are read
   * live by the selectors, so connecting or removing a device needs no rebuild. */
  private portSig(): string {
    return String(this.compId());
  }
  private compIds = new WeakMap<object, number>();
  private compId(): number {
    const c = this.ctx.s.comp;
    if (!this.compIds.has(c)) this.compIds.set(c, Math.random());
    return this.compIds.get(c)!;
  }

  update(): void {
    if (this.win.open && this.portSig() !== this.sig) this.build();
    this.parts.forEach((p) => p.update());
  }
}

// ---------------------------------------------------------------------------- Monitor (emmm)

export class MonitorWindow {
  win: MWindow;
  private log: HTMLDivElement;
  private lines: string[] = [];
  private vu: HTMLDivElement[] = [];
  private timing: HTMLDivElement;
  constructor(private ctx: UiContext, parent: HTMLElement) {
    this.win = new MWindow(parent, { id: 'monitor', title: 'Monitor', x: 380, y: 150, w: 228, h: 210, closable: true, area: 'midi' });
    const b = this.win.body;
    label(b, 4, 3, 'voice: step · pitches · vel', 'tiny');
    for (let v = 0; v < 4; v++) {
      const d = el('div', 'label', b, [4, 14 + v * 11, 220, 10]);
      d.style.fontSize = '9px';
      this.vu.push(d);
    }
    this.timing = el('div', 'label tiny', b, [4, 60, 220, 8]);
    label(b, 4, 70, 'event log (out ▸ / in ◂)', 'tiny');
    this.log = el('div', 'monitor-log', b, [4, 80, 220, 110]);
  }

  /** Called by the UI loop with events whose time has come. */
  push(text: string): void {
    this.lines.push(text);
    if (this.lines.length > 14) this.lines.splice(0, this.lines.length - 14);
  }

  update(): void {
    if (!this.win.open) return;
    const s = this.ctx.s;
    for (let v = 0; v < 4; v++) {
      const st = s.nowPlaying[v];
      const t = st ? `${v + 1}: ${st.stepIndex >= 0 ? 'step ' + (st.stepIndex + 1) : '—'} ${st.played ? st.pitches.map(noteName).join(' ') + ' v' + st.velocity : st.stepIndex >= 0 ? '(rest)' : ''} ${st.scheme !== 'original' && st.scheme !== 'none' ? '[' + st.scheme + ']' : ''}` : `${v + 1}: —`;
      if (this.vu[v].textContent !== t) this.vu[v].textContent = t;
    }
    const t = s.timing;
    const tt = `notes ${t.events}  late ${t.late}${t.late ? ' (max ' + t.maxLateMs.toFixed(1) + 'ms)' : ''}  min lead ${Number.isFinite(t.minLeadMs) ? t.minLeadMs.toFixed(1) : '-'}ms`;
    if (this.timing.textContent !== tt) this.timing.textContent = tt;
    const txt = this.lines.join('\n');
    if (this.log.textContent !== txt) this.log.textContent = txt;
  }
}

// ---------------------------------------------------------------------------- About

export class AboutWindow {
  win: MWindow;
  constructor(_ctx: UiContext, parent: HTMLElement) {
    this.win = new MWindow(parent, { id: 'about', title: 'About emmm', x: 190, y: 96, w: 340, h: 262, closable: true });
    const b = this.win.body;
    const t = el('div', 'label', b, [12, 8, 316, 236]);
    t.style.whiteSpace = 'normal';
    t.style.lineHeight = '12px';
    t.style.fontSize = '10px';
    t.style.pointerEvents = 'auto';
    t.innerHTML = `<div style="font-size:22px;font-weight:600;line-height:24px">emmm</div>
      <div>An interactive composing and performing instrument for MIDI, after <b>M</b>.</div>
      <br><div>emmm is an independent, unofficial recreation of the concepts and workflow of M, the
      interactive composition program originally developed at Intelligent Music by Joel Chadabe,
      David Zicarelli, John Offenhartz and Antony Widoff.</div>
      <br><div>It is not affiliated with or endorsed by Intelligent Music, Cycling '74, David Zicarelli,
      or the original developers or rights holders. emmm is an independently written implementation
      and does not distribute the original M application or its original assets.</div>
      <br><div>Runs entirely in your browser: your music and MIDI stay on this computer.</div>
      <br><div><a href="docs/quick-start.html" target="_blank" rel="noopener" style="color:inherit">Quick Start guide</a> · emmm ▸ Help…</div>`;
  }
  update(): void {}
}

// ---------------------------------------------------------------------------- MIDI file import

export class ImportWindow {
  win: MWindow;
  private file: ParsedSmf | null = null;
  private name = '';
  private chans: boolean[][] = [0, 1, 2, 3].map((v) => Array.from({ length: 16 }, (_, i) => i === v));
  private chord: ('single' | 'chord')[] = ['chord', 'chord', 'chord', 'chord'];
  private rests: ('none' | 'dur')[] = ['none', 'none', 'none', 'none'];
  private quant = [8, 8, 8, 8];
  private asSequence = false;
  private cells: HTMLDivElement[][] = [];
  private parts: { update(): void }[] = [];
  constructor(private ctx: UiContext, parent: HTMLElement) {
    this.win = new MWindow(parent, { id: 'import', title: 'Import MIDI File', x: 100, y: 120, w: 360, h: 132, closable: true });
    const b = this.win.body;
    const btn = (x: number, t: string, f: () => void) => {
      const d = el('div', 'btn', b, [x, 2, 56, 14], t);
      d.style.fontSize = '9px';
      d.addEventListener('pointerdown', (e) => (e.preventDefault(), f()));
    };
    const seqT = el('div', 'num', b, [150, 2, 86, 14]);
    seqT.style.fontSize = '8px';
    seqT.title = 'Import as Sequence: keep the timing and play the file along with the four voices (channels from row 1)';
    seqT.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.asSequence = !this.asSequence;
      if (this.asSequence) this.chans[0] = this.chans[0].map(() => true);
      this.update();
    });
    this.parts.push({ update: () => ((seqT.textContent = (this.asSequence ? '☒' : '☐') + ' as Sequence'), seqT.classList.toggle('inv', this.asSequence)) });
    btn(240, 'Import', () => this.doImport());
    btn(298, 'Cancel', () => this.win.close());
    const nameEl = el('div', 'label', b, [4, 5, 144, 10]);
    nameEl.style.overflow = 'hidden';
    this.parts.push({ update: () => (nameEl.textContent = this.name ? `${this.name} (${this.file?.notes.length ?? 0})` : '') });
    label(b, 4, 22, 'Chord', 'tiny');
    label(b, 30, 22, 'Rests', 'tiny');
    label(b, 58, 22, 'Quant', 'tiny');
    label(b, 92, 22, 'Source Channels 1–16 (All/None)', 'tiny');
    for (let v = 0; v < 4; v++) {
      const y = 32 + v * 22;
      label(b, 0, y + 5, String(v + 1), 'small');
      const ch = el('div', 'num', b, [8, y, 20, 18]);
      ch.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.chord[v] = this.chord[v] === 'chord' ? 'single' : 'chord';
        this.update();
      });
      this.parts.push({ update: () => (ch.textContent = this.chord[v] === 'chord' ? '♫' : '♩') });
      const rs = el('div', 'num', b, [30, y, 26, 18]);
      rs.style.fontSize = '8px';
      rs.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.rests[v] = this.rests[v] === 'none' ? 'dur' : 'none';
        this.update();
      });
      this.parts.push({ update: () => (rs.textContent = this.rests[v] === 'none' ? 'None' : 'Dur') });
      const q = new Numerical(b, 58, y, 26, 18, { get: () => this.quant[v], set: (x) => (this.quant[v] = x), values: [1, 2, 4, 8, 16, 32], format: () => '' });
      this.parts.push({ update: () => (q.el.innerHTML = noteValueIcon(this.quant[v], 12, 12)) });
      const all = el('div', 'num', b, [88, y, 14, 18], 'A');
      all.style.fontSize = '8px';
      all.addEventListener('pointerdown', (e) => (e.preventDefault(), (this.chans[v] = this.chans[v].map(() => true)), this.update()));
      const none = el('div', 'num', b, [101, y, 14, 18], 'N');
      none.style.fontSize = '8px';
      none.addEventListener('pointerdown', (e) => (e.preventDefault(), (this.chans[v] = this.chans[v].map(() => false)), this.update()));
      const row: HTMLDivElement[] = [];
      for (let i = 0; i < 16; i++) {
        const c = el('div', 'num', b, [118 + i * 14.5, y, 15, 18]);
        c.style.fontSize = '7px';
        c.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          this.chans[v][i] = !this.chans[v][i];
          this.update();
        });
        row.push(c);
      }
      this.cells.push(row);
    }
  }

  async openFile(f: File): Promise<void> {
    try {
      this.file = readSmf(new Uint8Array(await f.arrayBuffer()));
      this.name = f.name;
      // default: one pattern per used channel, in order
      const used = [...new Set(this.file.notes.map((n) => n.channel))].sort((a, b) => a - b);
      this.chans = [0, 1, 2, 3].map((v) => Array.from({ length: 16 }, (_, i) => used[v] === i + 1 || (used.length === 1 && v === 0 && used[0] === i + 1)));
      this.win.show();
      this.update();
    } catch (e) {
      this.ctx.alert('Could not read MIDI file: ' + (e as Error).message);
    }
  }

  private doImport(): void {
    const s: Session = this.ctx.s;
    if (!this.file) return;
    if (this.asSequence) {
      const channels = new Set(this.chans[0].map((on, i) => (on ? i + 1 : 0)).filter(Boolean));
      const notes = this.file.notes
        .filter((n) => channels.has(n.channel))
        .map((n) => ({ tick: n.beat * 96, dur: n.durBeats * 96, channel: n.channel, pitch: n.pitch, velocity: n.velocity }));
      s.comp.sequence = { name: this.name, notes, lengthTicks: notes.reduce((m, n) => Math.max(m, n.tick + n.dur), 0) };
      s.comp.sequenceEnable = false; // as in M: enable it with the Sequence Play-Enable toggle
      this.win.close();
      s.changed('sequence');
      return;
    }
    const g = s.comp.patternGroups[s.comp.patternGroup.active];
    for (let v = 0; v < 4; v++) {
      const channels = this.chans[v].map((on, i) => (on ? i + 1 : 0)).filter(Boolean);
      if (!channels.length) continue;
      const steps = notesToSteps(this.file.notes, { channels, chord: this.chord[v], rests: this.rests[v], quant: this.quant[v] });
      if (!steps.length) continue;
      const old = g.patterns[v];
      g.patterns[v] = { ...newPattern(steps.slice(0, 999), s.editRng), tbNum: old.tbNum, tbDen: old.tbDen, phase: old.phase };
    }
    this.win.close();
    s.changed('patterns');
  }

  update(): void {
    this.cells.forEach((row, v) =>
      row.forEach((c, i) => {
        c.classList.toggle('fill-hatch', this.chans[v][i]);
        c.textContent = String(i + 1);
      }),
    );
    this.parts.forEach((p) => p.update());
  }
}

// ---------------------------------------------------------------------------- Library (emmm)

export class LibraryWindow {
  win: MWindow;
  private list: HTMLDivElement;
  private input: HTMLInputElement;
  private selected = '';
  constructor(private ctx: UiContext, parent: HTMLElement) {
    this.win = new MWindow(parent, { id: 'library', title: 'Browser Library', x: 220, y: 90, w: 260, h: 220, closable: true });
    const b = this.win.body;
    label(b, 6, 4, 'Documents kept in this browser', 'small');
    this.list = el('div', 'box', b, [6, 16, 160, 150]);
    this.list.style.overflowY = 'auto';
    this.list.style.background = 'var(--paper)';
    this.input = el('input', 'mtext', b, [6, 174, 160, 16]);
    this.input.style.position = 'absolute';
    this.input.placeholder = 'name';
    this.input.addEventListener('keydown', (e) => e.stopPropagation());
    const btn = (y: number, t: string, f: () => void) => {
      const d = el('button', 'mbutton', b, [176, y, 76, 18], t);
      d.style.position = 'absolute';
      d.addEventListener('click', f);
    };
    btn(16, 'Open', () => {
      const d = loadFromLibrary(this.selected);
      if (d) {
        this.ctx.s.load(d.composition);
        this.win.close();
      }
    });
    btn(40, 'Delete', () => {
      const name = this.selected;
      if (!name) return;
      void confirmDialog(this.ctx.screen, `Delete “${escapeHtml(name)}” from this browser?`, 'Delete').then((ok) => {
        if (ok) deleteFromLibrary(name);
        this.refresh();
      });
    });
    btn(174, 'Save', () => {
      const name = this.input.value.trim() || this.ctx.s.comp.name || 'Untitled';
      this.ctx.s.comp.name = name;
      saveToLibrary(name, this.ctx.s.comp);
      this.ctx.s.changed('name');
      this.refresh();
    });
  }

  refresh(): void {
    this.list.innerHTML = '';
    for (const n of listLibrary()) {
      const d = el('div', 'label', this.list, undefined, n);
      d.style.position = 'relative';
      d.style.padding = '2px 4px';
      if (n === this.selected) d.classList.add('inv');
      d.addEventListener('pointerdown', () => {
        this.selected = n;
        this.input.value = n;
        this.refresh();
      });
      d.addEventListener('dblclick', () => {
        const doc = loadFromLibrary(n);
        if (doc) {
          this.ctx.s.load(doc.composition);
          this.win.close();
        }
      });
    }
  }

  update(): void {}
}

// ---------------------------------------------------------------------------- Help (emmm)

const HELP = `
<b>New to emmm?</b> Read the <a href="docs/quick-start.html" target="_blank" rel="noopener" style="color:inherit"><b>Quick Start guide</b></a> (opens in a new tab).<br><br>
<b>emmm in one minute</b><br>
Four <b>Patterns</b> hold notes and chords (no rhythm). Each becomes a <b>Voice</b> through the
<b>Variables</b>. Every Variable has six <b>Positions</b> (Sound Choice: sixteen); one is active
(inverted). Perform by switching Positions while the music runs.<br><br>
<b>Variables</b> — Pattern Group (which four Patterns) · Note Density (chance a note sounds) ·
Vel Range (velocities) · Note Order (Original / Cyclic Random / Utterly Random) · Transposition ·
Time Distort (swing / rubato maps).<br>
<b>Cyclic Variables</b> — Rhythm (time to the next note, × the Time Base), Legato (note length as %
of that time), Accent (level 1–4 within Vel Range; 0 = rest). Cycles are 1–16 steps; a step can be
a range of levels, picked at random each time.<br>
<b>Midi</b> — Orchestration sends each voice to any of 16 output channels; Sound Choice sends
program changes.<br><br>
<b>Mouse</b> — click a Position to choose it · double-click to edit it · drag onto another to swap
(Alt: copy) · Shift-click: wait for the quantization point.<br>
Numericals: press the top half to increase, bottom half to decrease, or drag up/down outside the box.
Range bars: drag out a range; click for one value. Conducting arrows: click to enable, hold to
rotate, or drag around them; then move the Baton in the Conducting Grid.<br><br>
<b>Patterns window</b> — Src (input channel) · Use (– off, R record, C Input Control, ♯♭ keyboard
transpose, Echo Map) · speaker = Play-Enable · ✓ = Echo-Thru-Orchestration · ◆ = Mouse Advance ·
Select (double-click: Pattern Editor; Alt-click an icon: record modes) · Output Length (Alt: add
rests) · Time Base (n | d; sa = step advance) · Phase (ticks; 96 = a quarter note).<br><br>
<b>Snapshots</b> — Hold/Do (camera, Backspace): click controls, then Hold/Do again to do them all at
once, or click a Snapshot box to store them. Letters A–Z recall. Globe = Blink Everything ·
pencil = Edit Snapshot · frames = Restore. <b>Slideshows</b> 1–9: Alt-click to record, click to play,
0 stops, \\ loops.<br><br>
<b>Speed of a Voice</b> — Tempo sets the beat; each Pattern's Time Base n | d makes one step last
n/d of a whole note (1|8 = eighths); Rhythm multiplies each step; Time Distortion bends the timing;
Phase delays the start. Also in the Pattern Editor (Length, T Base, Phase).<br>
<b>Pattern Editor</b> — Length = steps the Voice plays (Alt: cut / extend the Pattern) · Clear
Pattern · Root + Scale of the Pattern (changing it moves the notes by scale degree; new notes snap
into it; M plays the notes as written).<br>
<b>Typing numbers</b> — click any number, type the value, Return (Escape cancels); ↑ ↓ step it.
Time Base takes "3/8". Range bars take "40-100". emmm ▸ Keyboard Shortcuts… (⌥H) lists every key.<br>
<b>Undo</b> — ⌘Z / ⇧⌘Z undo and redo edits; the performance (active Positions, tempo, Baton) is
never rewound.<br><br>
<b>Keys</b> — Space Start/Sync · Return Stop · Tab Pause · Caps Lock or ⌘⌥ + moving the mouse =
Mouse Advance · ⌘. All Notes Off · ⌘S Save · ⌘O Open · ⌘Z Undo · Escape closes pop-ups.<br><br>
<b>MIDI</b> — File ▸ Midi Assignment… maps M Output Channels to devices (or the internal monitor).
Set a voice's Use to <b>C</b> to drive emmm from a MIDI keyboard: middle C (C3) Start, B2 Stop,
B3 Hold/Do, F3 Sync, black keys + white keys select Positions.<br><br>
<b>Seed</b> — emmm's randomness is seeded (Conducting window). Same document + seed + gestures =
same music from Start.<br><br>
<b>Extended</b> (emmm's additions, not M) — Options ▸ Extended…: Seed &amp; Reroll, Locks, Mutation
(subtle → chaos), A/B states, MIDI clock input, MIDI Learn, CC Cycles, and <b>Trajectory</b> (⌥J):
rows of values moved through at a musical rate, driving a MIDI controller, Density, Transposition,
Tempo, the Baton or a Position. Options ▸ Performance Feedback shows what M decides for each note.<br>
<b>Comfort</b> — rest the mouse on a control for a tip (Options ▸ Show Tips) · ⤢ in the menu bar =
full screen.<br><br>
<b>Colours</b> — Options ▸ Palette… changes emmm's colours (Classic, Dark, Colour or your own).
Editing a built-in palette makes a copy; Export/Import exchange palette files. Palettes are a
preference of this browser and never change the music or the saved document.`;

export class HelpWindow {
  win: MWindow;
  constructor(_ctx: UiContext, parent: HTMLElement) {
    this.win = new MWindow(parent, { id: 'help', title: 'Help', x: 120, y: 24, w: 420, h: 436, closable: true });
    const t = el('div', 'label', this.win.body, [8, 6, 404, 410]);
    t.style.whiteSpace = 'normal';
    t.style.lineHeight = '11px';
    t.style.fontSize = '9px';
    t.style.overflowY = 'auto';
    t.style.pointerEvents = 'auto';
    t.innerHTML = HELP;
  }
  update(): void {}
}
