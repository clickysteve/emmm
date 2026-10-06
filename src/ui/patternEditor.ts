/**
 * The Pattern Editor (S1 ch.5, ch.14): a step grid with pitch vertical and steps horizontal.
 * Patterns hold no durations — a column is a step (note, chord or rest).
 * Tools: Selector, Eraser, Plunger (insert), Scissors (delete) operate in the strip above
 * the grid. View 1–4 (Shift: show a second pattern in grey). MIDI Edit Counter and Range.
 */
import { MAX_PATTERN_STEPS, noteName } from '../engine/constants';
import * as ops from '../engine/patternOps';
import type { UiContext } from './context';
import { clamp, el, label, localPoint, svgEl, setSvg, trackDrag } from './dom';
import { iconSvg } from './icons';
import { MWindow, Numerical, pictureMatrix } from './widgets';

type Tool = 'selector' | 'eraser' | 'plunger' | 'scissors';

const CW = 8; // step width
const RH = 5; // semitone height
const ROWS = 40;
const COLS = 36;
const GX = 26;
const GY = 18;

export class PatternEditor {
  win: MWindow;
  voice = 0;
  ghost: number | null = null;
  low = 48; // lowest visible pitch
  scroll = 0; // first visible step
  tool: Tool = 'selector';
  /** selected region [a,b) or insertion point (a===b) */
  region: [number, number] | null = null;
  hover: { step: number; pitch: number } | null = null;
  sound = true;
  velocity = 64;
  private grid: SVGSVGElement;
  private kb: SVGSVGElement;
  private strip: SVGSVGElement;
  private bottom: SVGSVGElement;
  private toolEls: Record<Tool, HTMLDivElement> = {} as Record<Tool, HTMLDivElement>;
  private viewEls: HTMLDivElement[] = [];
  private modeEls: HTMLDivElement[][] = [];
  private parts: { update(): void }[] = [];
  private legend: HTMLDivElement;
  private soundBtn: HTMLDivElement;

  constructor(private ctx: UiContext, parent: HTMLElement) {
    const s = ctx.s;
    this.win = new MWindow(parent, { id: 'edit-pattern', title: 'Pattern Editor a', x: 120, y: 40, w: 420, h: 292, closable: true });
    const b = this.win.body;
    // tools in the title bar area, top right
    const tb = this.win.el.querySelector('.titlebar') as HTMLDivElement;
    (['selector', 'eraser', 'plunger', 'scissors'] as Tool[]).forEach((t, i) => {
      const d = el('div', 'btn', tb, [330 + i * 21, 0, 21, 16]);
      d.innerHTML = iconSvg(t, 12, 12);
      d.title = { selector: 'Selector', eraser: 'Eraser', plunger: 'Plunger (insert step)', scissors: 'Scissors (delete step)' }[t];
      d.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        this.tool = t;
        s.changed('editor');
      });
      this.toolEls[t] = d;
    });
    // keyboard
    const kbBox = el('div', 'box', b, [2, GY, 22, ROWS * RH + 2]);
    this.kb = svgEl(20, ROWS * RH, '');
    kbBox.appendChild(this.kb);
    kbBox.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      const p = localPoint(kbBox, ev);
      const pitch = this.low + ROWS - 1 - Math.floor((p.y - 1) / RH);
      if (this.sound) s.auditionStep(this.voice, [pitch], this.velocity);
    });
    const scrollBtn = (x: number, y: number, txt: string, d: number, title: string) => {
      const e = el('div', 'btn', b, [x, y, 11, 9], txt);
      e.style.fontSize = '7px';
      e.title = title;
      e.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        const go = () => {
          this.low = clamp(this.low + d, 0, 127 - ROWS + 1);
          s.changed('editor');
        };
        go();
        const t = setInterval(go, 120);
        const up = () => (clearInterval(t), window.removeEventListener('pointerup', up));
        window.addEventListener('pointerup', up);
      });
    };
    scrollBtn(2, 2, '▲', 1, 'Scroll up a semitone');
    scrollBtn(13, 2, '8va', 12, 'Scroll up an octave');
    scrollBtn(2, GY + ROWS * RH + 3, '▼', -1, 'Scroll down a semitone');
    scrollBtn(13, GY + ROWS * RH + 3, '8vb', -12, 'Scroll down an octave');
    // tool strip above the grid
    const stripBox = el('div', '', b, [GX, 2, COLS * CW + 1, GY - 3]);
    stripBox.style.position = 'absolute';
    this.strip = svgEl(COLS * CW + 1, GY - 3, '');
    stripBox.appendChild(this.strip);
    stripBox.title = 'Tools operate here';
    stripBox.addEventListener('pointerdown', (ev) => this.toolDown(ev, stripBox));
    // grid
    const gridBox = el('div', 'box', b, [GX, GY, COLS * CW + 2, ROWS * RH + 2]);
    gridBox.style.background = '#fff';
    this.grid = svgEl(COLS * CW, ROWS * RH, '');
    gridBox.appendChild(this.grid);
    gridBox.addEventListener('pointerdown', (ev) => this.gridDown(ev, gridBox));
    gridBox.addEventListener('pointermove', (ev) => {
      const p = localPoint(gridBox, ev);
      this.hover = { step: this.scroll + Math.floor((p.x - 1) / CW), pitch: this.low + ROWS - 1 - Math.floor((p.y - 1) / RH) };
      this.draw();
    });
    gridBox.addEventListener('pointerleave', () => {
      this.hover = null;
      this.draw();
    });
    this.legend = el('div', 'label', b, [GX + COLS * CW + 8, 120, 80, 20]);
    this.legend.style.whiteSpace = 'pre';
    this.legend.style.lineHeight = '10px';
    this.legend.style.pointerEvents = 'none';
    // bottom: MIDI edit range, counter, scroll bar
    const bot = el('div', '', b, [GX, GY + ROWS * RH + 3, COLS * CW + 2, 30]);
    bot.style.position = 'absolute';
    this.bottom = svgEl(COLS * CW + 2, 30, '');
    bot.appendChild(this.bottom);
    bot.addEventListener('pointerdown', (ev) => this.bottomDown(ev, bot));
    // right panel: View 1-4, Chd Ins Dr, Size
    const RX = GX + COLS * CW + 8;
    label(b, RX, 2, 'View', 'small');
    label(b, RX + 22, 2, 'Chd', 'small');
    label(b, RX + 40, 2, 'Ins', 'small');
    label(b, RX + 56, 2, 'Dr', 'small');
    for (let v = 0; v < 4; v++) {
      const y = 14 + v * 18;
      const vd = el('div', 'num', b, [RX, y, 16, 16], String(v + 1));
      vd.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        if (ev.shiftKey) this.ghost = this.ghost === v ? null : v;
        else {
          this.voice = v;
          this.region = null;
          if (this.ghost === v) this.ghost = null;
        }
        s.changed('editor');
      });
      this.viewEls.push(vd);
      const modes: HTMLDivElement[] = [];
      for (let k = 0; k < 3; k++) {
        const m = el('div', 'num', b, [RX + 20 + k * 17, y, 17, 16]);
        m.addEventListener('pointerdown', (ev) => {
          const p = s.pattern(v);
          if (k === 0)
            pictureMatrix(m, ev, [
              { value: 'single', icon: iconSvg('note'), title: 'Single Note' },
              { value: 'chord', icon: iconSvg('chord'), title: 'Chord' },
              { value: 'build', icon: iconSvg('plus'), title: 'Build' },
            ], p.chordMode, (val) => ((p.chordMode = val as typeof p.chordMode), s.changed('patterns')));
          else if (k === 1)
            pictureMatrix(m, ev, [
              { value: 'insert', icon: iconSvg('insert'), title: 'Insert' },
              { value: 'replace', icon: iconSvg('replace'), title: 'Replace' },
              { value: 'overdub', icon: iconSvg('overdub'), title: 'Overdub' },
            ], p.insertMode, (val) => ((p.insertMode = val as typeof p.insertMode), s.changed('patterns')));
          else
            pictureMatrix(m, ev, [
              { value: false, icon: iconSvg('dash'), title: 'Drum Machine off' },
              { value: true, icon: iconSvg('repeat'), title: 'Drum Machine Record' },
            ], p.drumMachine, (val) => ((p.drumMachine = val as boolean), s.changed('patterns')));
        });
        modes.push(m);
      }
      this.modeEls.push(modes);
    }
    label(b, RX, 92, 'Size', 'small');
    this.parts.push(
      new Numerical(b, RX + 24, 88, 34, 15, {
        get: () => s.pattern(this.voice).size,
        set: (x) => {
          const p = s.pattern(this.voice);
          p.size = Math.max(x, p.steps.length);
          s.changed('patterns');
        },
        min: 1,
        max: MAX_PATTERN_STEPS,
        title: 'Pattern Size (maximum steps)',
      }),
    );
    label(b, RX, 108, 'Steps', 'small');
    const stepsLbl = el('div', 'label', b, [RX + 26, 108, 30, 10]);
    this.parts.push({ update: () => (stepsLbl.textContent = String(s.pattern(this.voice).steps.length)) });
    // edit-range buttons, sound
    const allBtn = el('div', 'btn', b, [RX, 250, 20, 14], 'All');
    allBtn.style.fontSize = '9px';
    allBtn.title = 'MIDI Edit Range = whole pattern';
    allBtn.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      s.recorders[this.voice].range = null;
      s.changed('editor');
    });
    const ctrBtn = el('div', 'btn', b, [RX + 21, 250, 20, 14], 'Ctr');
    ctrBtn.style.fontSize = '9px';
    ctrBtn.title = 'MIDI Edit Range = the counter step';
    ctrBtn.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      const r = s.recorders[this.voice];
      r.range = { start: r.counter, end: r.counter + 1 };
      s.changed('editor');
    });
    this.soundBtn = el('div', 'btn', b, [RX, 228, 20, 18]);
    this.soundBtn.title = 'Editor Sound Enable';
    this.soundBtn.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      this.sound = !this.sound;
      s.changed('editor');
    });
    this.parts.push(
      new Numerical(b, RX + 22, 230, 26, 15, {
        get: () => this.velocity,
        set: (x) => (this.velocity = x),
        min: 1,
        max: 127,
        title: 'Editor Sound Velocity',
      }),
    );
    label(b, RX, 150, 'click: add or<br>remove a note<br>drag →: repeat<br>drag ↕: cluster<br>Shift-View:<br>show another', 'tiny').style.lineHeight = '8px';
    this.parts.push({ update: () => this.draw() });
  }

  private get pattern() {
    return this.ctx.s.pattern(this.voice);
  }

  private stepAt(box: HTMLElement, e: PointerEvent): number {
    return this.scroll + Math.floor((localPoint(box, e).x - 1) / CW);
  }

  private gridDown(ev: PointerEvent, box: HTMLElement): void {
    ev.preventDefault();
    const s = this.ctx.s;
    const p = this.pattern;
    const at = (e: PointerEvent) => {
      const q = localPoint(box, e);
      return { step: this.scroll + clamp(Math.floor((q.x - 1) / CW), 0, COLS - 1), pitch: clamp(this.low + ROWS - 1 - Math.floor((q.y - 1) / RH), 0, 127) };
    };
    const a = at(ev);
    const has = a.step < p.steps.length && p.steps[a.step].includes(a.pitch);
    const want = !has;
    const dsr = s.comp.options.dontScrambleRests;
    const apply = (step: number, pitch: number) => {
      if (!want && step >= p.steps.length) return;
      ops.togglePitch(p, step, pitch, s.editRng, dsr, want);
    };
    apply(a.step, a.pitch);
    if (want && this.sound) s.auditionStep(this.voice, [...p.steps[a.step]], this.velocity);
    s.patternEdited();
    let lastKey = a.step + ':' + a.pitch;
    trackDrag(ev, box, ({ ev: e }) => {
      const b2 = at(e);
      // horizontal = repeat the note; vertical = chromatic cluster
      const step = Math.abs(b2.step - a.step) >= 1 && Math.abs(b2.pitch - a.pitch) < 2 ? b2.step : a.step;
      const pitch = step === a.step ? b2.pitch : a.pitch;
      const k = step + ':' + pitch;
      if (k === lastKey) return;
      lastKey = k;
      if (step === a.step) {
        for (let q = Math.min(a.pitch, pitch); q <= Math.max(a.pitch, pitch); q++) apply(step, q);
      } else {
        for (let st = Math.min(a.step, step); st <= Math.max(a.step, step); st++) apply(st, a.pitch);
      }
      s.patternEdited();
    });
  }

  private toolDown(ev: PointerEvent, box: HTMLElement): void {
    ev.preventDefault();
    const s = this.ctx.s;
    const p = this.pattern;
    const dsr = s.comp.options.dontScrambleRests;
    const a = clamp(this.stepAt(box, ev), 0, p.steps.length);
    const inRegion = this.region && this.region[1] > this.region[0] && a >= this.region[0] && a < this.region[1];
    switch (this.tool) {
      case 'selector': {
        this.region = [a, a];
        trackDrag(ev, box, ({ ev: e }) => {
          const b2 = clamp(this.stepAt(box, e), 0, p.steps.length - 1);
          this.region = [Math.min(a, b2), Math.min(p.steps.length, Math.max(a, b2) + 1)];
          s.changed('editor');
        }, ({ moved }) => {
          if (!moved) this.region = [a, a]; // pointwise selection (insert point)
          s.changed('editor');
        });
        break;
      }
      case 'eraser':
        if (inRegion) ops.changeToRests(p, this.region!);
        else if (a < p.steps.length) {
          ops.changeToRests(p, [a, a + 1]);
          trackDrag(ev, box, ({ ev: e }) => {
            const b2 = clamp(this.stepAt(box, e), 0, p.steps.length - 1);
            ops.changeToRests(p, [Math.min(a, b2), Math.max(a, b2) + 1]);
            s.patternEdited();
          });
        }
        break;
      case 'plunger':
        ops.insertSteps(p, a, [[]], s.editRng, dsr);
        break;
      case 'scissors':
        if (inRegion) {
          const [r0, r1] = this.region!;
          ops.deleteSteps(p, Array.from({ length: r1 - r0 }, (_, i) => r0 + i), s.editRng, dsr);
          this.region = null;
        } else if (a < p.steps.length) ops.deleteSteps(p, [a], s.editRng, dsr);
        break;
    }
    s.patternEdited();
  }

  private bottomDown(ev: PointerEvent, box: HTMLElement): void {
    ev.preventDefault();
    const s = this.ctx.s;
    const p = this.pattern;
    const q = localPoint(box, ev);
    const rec = s.recorders[this.voice];
    if (q.y < 8) {
      // MIDI Edit Range bar
      const a = clamp(this.stepAt(box, ev), 0, p.steps.length);
      rec.range = { start: a, end: a + 1 };
      trackDrag(ev, box, ({ ev: e }) => {
        const b2 = clamp(this.stepAt(box, e), 0, p.steps.length);
        rec.range = { start: Math.min(a, b2), end: Math.max(a, b2) + 1 };
        s.changed('editor');
      });
    } else if (q.y < 18) {
      // MIDI Edit Counter: drag to play each step
      const move = (e: PointerEvent) => {
        let st = clamp(this.stepAt(box, e), 0, p.steps.length);
        if (rec.range) st = clamp(st, rec.range.start, rec.range.end - 1);
        if (st !== rec.counter) {
          rec.counter = st;
          if (this.sound && p.steps[st]) s.auditionStep(this.voice, p.steps[st], this.velocity);
          // keep the counter in view
          if (st >= this.scroll + COLS) this.scroll = st - COLS + 1;
          if (st < this.scroll) this.scroll = st;
          s.changed('editor');
        }
      };
      move(ev);
      trackDrag(ev, box, ({ ev: e }) => move(e));
    } else {
      // scroll bar: arrows at the ends, thumb proportional to the pattern's size
      const W = COLS * CW + 2;
      const span = Math.max(p.size, p.steps.length) + 4;
      if (q.x < 10) this.scroll = Math.max(0, this.scroll - 1);
      else if (q.x > W - 10) this.scroll = Math.min(span, this.scroll + 1);
      else {
        const set = (e: PointerEvent) => {
          const x = localPoint(box, e).x;
          this.scroll = clamp(Math.round(((x - 10) / (W - 20)) * span), 0, span);
          s.changed('editor');
        };
        set(ev);
        trackDrag(ev, box, ({ ev: e }) => set(e));
      }
      s.changed('editor');
    }
  }

  private drawnKey = '';
  draw(): void {
    const s = this.ctx.s;
    const p = this.pattern;
    const len = p.steps.length;
    const playingNow = s.engine.state !== 'stopped' && this.ctx.flash.notes[this.voice].until > this.ctx.now() ? this.ctx.flash.notes[this.voice].step : -1;
    const key = [s.rev, playingNow, this.hover?.step, this.hover?.pitch, this.low, this.scroll, this.voice, this.ghost, this.region?.join(), s.recorders[this.voice].counter, this.tool].join('|');
    if (key === this.drawnKey) return;
    this.drawnKey = key;
    let g = '';
    // grid lines: black within the pattern, grey beyond its end
    for (let c = 0; c <= COLS; c++) {
      const st = this.scroll + c;
      const x = c * CW + 0.5;
      g += `<line x1="${x}" y1="0" x2="${x}" y2="${ROWS * RH}" stroke="#000" ${st <= len ? '' : 'stroke-dasharray="1 2"'}/>`;
    }
    for (let r = 0; r <= ROWS; r++) {
      const pitch = this.low + ROWS - r;
      const y = r * RH + 0.5;
      const isC = pitch % 12 === 0;
      g += `<line x1="0" y1="${y}" x2="${COLS * CW}" y2="${y}" stroke="#000" stroke-dasharray="${isC ? '0' : '1 3'}"/>`;
    }
    // output length marker
    if (p.outputLength < len && p.outputLength >= this.scroll && p.outputLength <= this.scroll + COLS) {
      const x = (p.outputLength - this.scroll) * CW;
      g += `<rect x="${x - 1}" y="0" width="2" height="${ROWS * RH}" fill="#000"/>`;
    }
    // region
    if (this.region && this.region[1] > this.region[0]) {
      const x0 = (this.region[0] - this.scroll) * CW;
      const x1 = (this.region[1] - this.scroll) * CW;
      g += `<rect x="${x0}" y="0" width="${x1 - x0}" height="${ROWS * RH}" fill="#000" fill-opacity="0.15"/>`;
    }
    // ghost pattern
    if (this.ghost !== null && this.ghost !== this.voice) {
      const gp = s.pattern(this.ghost);
      for (let c = 0; c < COLS; c++) {
        const st = gp.steps[this.scroll + c];
        if (!st) continue;
        for (const n of st) {
          const r = this.low + ROWS - 1 - n;
          if (r < 0 || r >= ROWS) continue;
          g += `<rect x="${c * CW + 2}" y="${r * RH + 1}" width="${CW - 3}" height="${RH - 1}" fill="url(#peg)"/>`;
        }
      }
    }
    // notes
    const playing = s.engine.state !== 'stopped' && s.nowPlaying[this.voice] && this.ctx.flash.notes[this.voice].until > this.ctx.now() ? this.ctx.flash.notes[this.voice].step : -1;
    for (let c = 0; c < COLS; c++) {
      const st = this.scroll + c;
      const step = p.steps[st];
      if (st === playing) g += `<rect x="${c * CW + 1}" y="0" width="${CW - 1}" height="${ROWS * RH}" fill="url(#peg)"/>`;
      if (!step) continue;
      for (const n of step) {
        const r = this.low + ROWS - 1 - n;
        if (r < 0) g += `<rect x="${c * CW + 2}" y="0" width="${CW - 3}" height="2" fill="#000"/>`;
        else if (r >= ROWS) g += `<rect x="${c * CW + 2}" y="${ROWS * RH - 2}" width="${CW - 3}" height="2" fill="#000"/>`;
        else g += `<rect x="${c * CW + 1}" y="${r * RH + 1}" width="${CW - 1}" height="${RH - 1}" fill="#000"/>`;
      }
    }
    if (this.hover) {
      const c = this.hover.step - this.scroll;
      const r = this.low + ROWS - 1 - this.hover.pitch;
      g += `<line x1="${c * CW + 4}" y1="0" x2="${c * CW + 4}" y2="${ROWS * RH}" stroke="#000" stroke-dasharray="1 1"/><line x1="0" y1="${r * RH + 3}" x2="${COLS * CW}" y2="${r * RH + 3}" stroke="#000" stroke-dasharray="1 1"/>`;
    }
    g = `<defs><pattern id="peg" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="1" height="1"/><rect x="1" y="1" width="1" height="1"/></pattern></defs>` + g;
    setSvg(this.grid, g);
    // keyboard
    let k = '';
    for (let r = 0; r < ROWS; r++) {
      const pitch = this.low + ROWS - 1 - r;
      const black = [1, 3, 6, 8, 10].includes(pitch % 12);
      k += black ? `<rect x="0" y="${r * RH}" width="12" height="${RH}" fill="#000"/>` : `<rect x="0" y="${r * RH + RH - 0.5}" width="20" height="0.5" fill="#000"/>`;
      if (pitch % 12 === 0) k += `<text x="19" y="${r * RH + RH}" font-size="5" text-anchor="end" font-family="Silkscreen">${noteName(pitch)}</text>`;
      if (this.hover && this.hover.pitch === pitch) k += `<rect x="13" y="${r * RH}" width="7" height="${RH}" fill="#000"/>`;
    }
    setSvg(this.kb, k);
    // strip: step numbers, selection, pointwise triangle
    let t = '';
    for (let c = 0; c < COLS; c += 4) t += `<text x="${c * CW + 1}" y="7" font-size="6" font-family="Silkscreen">${this.scroll + c + 1}</text>`;
    if (this.region) {
      const x0 = (this.region[0] - this.scroll) * CW;
      if (this.region[1] > this.region[0]) t += `<rect x="${x0}" y="9" width="${(this.region[1] - this.region[0]) * CW}" height="5" fill="#000"/>`;
      else t += `<polygon points="${x0 - 3},9 ${x0 + 3},9 ${x0},14" fill="#000"/>`;
    }
    setSvg(this.strip, t);
    // bottom: edit range bar, counter, scroll bar
    const rec = s.recorders[this.voice];
    let bt = '';
    const r0 = rec.range ? rec.range.start : 0;
    const r1 = rec.range ? rec.range.end : len + 1;
    for (let i = 0; i < 3; i++) bt += `<line x1="${(r0 - this.scroll) * CW}" y1="${1.5 + i * 2}" x2="${(r1 - this.scroll) * CW}" y2="${1.5 + i * 2}" stroke="#000"/>`;
    const cx = (rec.counter - this.scroll) * CW;
    bt += `<rect x="${cx}" y="9" width="${CW}" height="7" fill="#000"/>`;
    const W = COLS * CW + 2;
    const span = Math.max(p.size, len) + 4;
    bt += `<rect x="0.5" y="19.5" width="${W - 1}" height="10" fill="url(#pbg)" stroke="#000"/>`;
    bt += `<rect x="0.5" y="19.5" width="10" height="10" fill="#fff" stroke="#000"/><polygon points="7,22 3,24.5 7,27" fill="#000"/>`;
    bt += `<rect x="${W - 10.5}" y="19.5" width="10" height="10" fill="#fff" stroke="#000"/><polygon points="${W - 7},22 ${W - 3},24.5 ${W - 7},27" fill="#000"/>`;
    const th = 10 + (this.scroll / span) * (W - 32);
    bt += `<rect x="${th}" y="20" width="12" height="9" fill="#fff" stroke="#000"/>`;
    bt = `<defs><pattern id="pbg" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="1" height="1"/><rect x="1" y="1" width="1" height="1"/></pattern></defs>` + bt;
    setSvg(this.bottom, bt);
    // legend
    this.legend.textContent = this.hover ? `${noteName(this.hover.pitch)}\nstep ${this.hover.step + 1}` : `out ${p.outputLength}`;
  }

  update(): void {
    const s = this.ctx.s;
    this.win.setTitle('Pattern Editor ' + 'abcdef'[s.comp.patternGroup.active]);
    (Object.keys(this.toolEls) as Tool[]).forEach((t) => {
      const on = t === this.tool;
      this.toolEls[t].classList.toggle('on', on);
      const key = t + on;
      if (this.toolEls[t].dataset.v !== key) {
        this.toolEls[t].innerHTML = iconSvg(t, 12, 12, on ? '#fff' : '#000');
        this.toolEls[t].dataset.v = key;
      }
    });
    this.viewEls.forEach((d, v) => {
      d.classList.toggle('inv', v === this.voice);
      d.style.outline = this.ghost === v ? '1px dotted #000' : '';
    });
    this.modeEls.forEach((m, v) => {
      const p = s.pattern(v);
      const icons = [{ single: 'note', chord: 'chord', build: 'plus' }[p.chordMode], p.insertMode, p.drumMachine ? 'repeat' : 'dash'];
      m.forEach((e, k) => {
        if (e.dataset.v !== icons[k]) {
          e.innerHTML = iconSvg(icons[k], 12, 12);
          e.dataset.v = icons[k];
        }
      });
    });
    const sk = this.sound ? 'on' : 'off';
    if (this.soundBtn.dataset.v !== sk) {
      this.soundBtn.innerHTML = iconSvg('speaker', 12, 12, this.sound ? '#fff' : '#000');
      this.soundBtn.classList.toggle('on', this.sound);
      this.soundBtn.dataset.v = sk;
    }
    // follow the recording counter
    const rec = s.recorders[this.voice];
    if (rec.counter >= this.scroll + COLS) this.scroll = rec.counter - COLS + 1;
    this.parts.forEach((p) => p.update());
  }

  openFor(voice: number): void {
    this.voice = voice;
    this.region = null;
    // centre the view on the pattern's notes
    const notes = this.ctx.s.pattern(voice).steps.flat();
    if (notes.length) this.low = clamp(Math.round((Math.min(...notes) + Math.max(...notes)) / 2) - ROWS / 2, 0, 127 - ROWS + 1);
    this.win.show();
    this.ctx.s.changed('editor');
  }
}
