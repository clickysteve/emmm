/**
 * The Cyclic Variable edit windows (S1 ch.7 and ch.17). M had one Cyclic Editor with Rhythm /
 * Legato / Accent buttons; emmm gives each Cyclic Variable its own window, like the other
 * Variable edit windows: the six-box Position selector in the title bar (click = choose which
 * Position to edit, Alt-click = also make it active, pull down = mark), four editing grids (one
 * per Voice) of 16 steps × levels 0–4 with M's gestures, and the Variable's own value scale on
 * the right. Octave (emmm, levels 0–4 = −2…+2 octaves) is not available in Classic Mode.
 */
import { MAX_CYCLE_STEPS, NUM_VOICES } from '../engine/constants';
import type { Cycle } from '../engine/types';
import type { UiContext } from './context';
import { clamp, el, label, localPoint, svgEl, setSvg, trackDrag } from './dom';
import { MWindow, Numerical } from './widgets';

export type CycVar = 'rhythm' | 'legato' | 'accent' | 'octave';
export const CYC_VARS: CycVar[] = ['rhythm', 'legato', 'accent', 'octave'];
const TITLE: Record<CycVar, string> = { rhythm: 'Rhythm Editor', legato: 'Legato Editor', accent: 'Accent Editor', octave: 'Octave Editor' };
const RHYTHM_VALUES = [0.25, 0.33, 0.5, 0.66, 0.75, 1, 1.25, 1.33, 1.5, 1.66, 1.75, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 12, 16];
/** Octave levels 0–4 as the octaves they add */
export const OCTAVE_LABEL = ['−2', '−1', '0', '+1', '+2'];

const SX = 12; // step spacing
const LY = 7; // level spacing
const GH = 4 * LY; // grid height (levels 0..4)
const OX = 18; // first step, inside a grid's svg (level labels to its left)
const OY = 4; // level 4, inside a grid's svg
const GW = OX + SX * 15 + 8; // grid svg width
const BLOCK = 48; // one Voice
const GX = 12; // grid svg left (Voice number to its left)
const PX = GX + GW + 6; // right-hand value panel

export class CyclicVarEditor {
  win: MWindow;
  editPos = 0;
  private grids: SVGSVGElement[] = [];
  private status: HTMLDivElement;
  private parts: { update(): void }[] = [];
  /** where the pointer is: a step of a Voice's grid, or (len) its step-number row */
  private hover: { v: number; step: number; len: boolean } | null = null;

  constructor(
    private ctx: UiContext,
    parent: HTMLElement,
    public which: CycVar,
    x: number,
    y: number,
  ) {
    const s = ctx.s;
    this.win = new MWindow(parent, {
      id: 'edit-' + which,
      title: TITLE[which],
      x,
      y,
      w: PX + 74,
      h: 18 + NUM_VOICES * BLOCK + 16,
      closable: true,
      area: 'cyclic',
      positions: {
        edit: () => this.editPos,
        active: () => s.comp[which].active,
        marked: () => s.comp[which].marked,
        select: (i, ev) => {
          this.editPos = i;
          if (ev.altKey) s.clickPosition(which, i, { shift: ev.shiftKey });
          s.changed('editor');
        },
        mark: (i) => {
          s.comp[which].marked[i] = !s.comp[which].marked[i];
          s.changed('mark');
        },
      },
    });
    const b = this.win.body;
    for (let v = 0; v < NUM_VOICES; v++) {
      const y0 = 2 + v * BLOCK;
      label(b, 2, y0 + OY + GH / 2 - 6, String(v + 1)).style.fontSize = '12px';
      const area = el('div', 'cgrid', b, [GX, y0, GW, BLOCK]);
      area.style.position = 'absolute';
      area.dataset.voice = String(v);
      area.title = 'Click a step at a level · drag up/down for a range · drag across for a run · click a number below to set the cycle length';
      const svg = svgEl(GW, BLOCK, '');
      area.appendChild(svg);
      this.grids.push(svg);
      area.addEventListener('pointerdown', (ev) => this.down(ev, v, area));
      area.addEventListener('pointermove', (ev) => {
        const a = this.at(area, ev);
        this.hover = { v, step: clamp(a.step, 0, MAX_CYCLE_STEPS - 1), len: a.len };
      });
      area.addEventListener('pointerleave', () => (this.hover = null));
    }
    this.status = label(b, 4, 2 + NUM_VOICES * BLOCK + 1, '', 'small');
    Object.assign(this.status.style, { width: PX + 66 + 'px', whiteSpace: 'nowrap', overflow: 'hidden' });
    this.valuePanel();
    this.parts.push({ update: () => this.drawAll() });
  }

  /** The value scale on the right: Rhythm and Legato tables (global), Accent's Velocity Range
   * reminder, Octave's octaves. */
  private valuePanel(): void {
    const s = this.ctx.s;
    const b = this.win.body;
    const cv = this.which;
    label(b, PX, 3, { rhythm: '× Time Base', legato: '% of the gap', accent: 'in Vel Range', octave: 'octaves' }[cv], 'small');
    if (cv === 'rhythm' || cv === 'legato') {
      for (let lv = 4; lv >= 0; lv--) {
        const y = 16 + (4 - lv) * 15;
        label(b, PX, y + 3, `${lv} =`, 'small');
        this.parts.push(
          new Numerical(b, PX + 20, y, 40, 13, {
            get: () => (cv === 'rhythm' ? s.comp.rhythmValues : s.comp.legatoValues)[lv],
            set: (x) => {
              (cv === 'rhythm' ? s.comp.rhythmValues : s.comp.legatoValues)[lv] = x;
              s.changed(cv);
            },
            ...(cv === 'rhythm' ? { values: RHYTHM_VALUES, format: (x: number) => String(x) } : { min: 1, max: 400 }),
            title: cv === 'rhythm' ? `Rhythm Value for level ${lv}: multiple of the Time Base (global)` : `Legato Value for level ${lv}: percent of the time to the next note (global)`,
          }),
        );
      }
      label(b, PX, 94, 'shared by', 'tiny');
      label(b, PX, 102, 'all cycles', 'tiny');
    } else if (cv === 'accent') {
      // reminder: accent levels 1..4 are quarters of the Velocity Range
      const d = svgEl(70, 40, '');
      const box = el('div', '', b, [PX - 2, 18, 70, 40]);
      box.style.position = 'absolute';
      box.appendChild(d);
      setSvg(
        d,
        `<defs><pattern id="acg" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="1" height="1"/><rect x="1" y="1" width="1" height="1"/></pattern></defs>` +
          [1, 2, 3, 4].map((n, i) => `<text x="${14 + i * 14}" y="8" font-size="8" text-anchor="middle" font-family="Tiny5">${n}</text><rect x="${14 + i * 14}" y="10" width="1" height="6" fill="var(--ink)"/>`).join('') +
          `<rect x="4" y="16" width="62" height="1" fill="var(--ink)"/><rect x="14" y="14" width="42" height="5" fill="url(#acg)" stroke="var(--ink)" stroke-width="0.5"/><text x="35" y="32" font-size="8" text-anchor="middle" font-family="Tiny5">Vel Range</text>`,
      );
      label(b, PX, 62, '0 = silent', 'small');
    } else {
      const words = ['down two', 'down one', 'as played', 'up one', 'up two'];
      for (let lv = 4; lv >= 0; lv--) label(b, PX, 18 + (4 - lv) * 13, `<b>${OCTAVE_LABEL[lv]}</b> ${words[lv]}`, 'small');
      label(b, PX, 86, 'added to', 'tiny');
      label(b, PX, 94, 'Transposition', 'tiny');
    }
  }

  private cycles(): Cycle[] {
    return this.ctx.s.comp[this.which].positions[this.editPos];
  }

  private get locked(): boolean {
    return this.ctx.s.isLocked(this.which, this.editPos);
  }

  /** a level as the Variable means it */
  private levelText(lv: number): string {
    const s = this.ctx.s;
    if (this.which === 'octave') return OCTAVE_LABEL[lv] + ' oct';
    if (this.which === 'rhythm') return `level ${lv} (×${s.comp.rhythmValues[lv]})`;
    if (this.which === 'legato') return `level ${lv} (${s.comp.legatoValues[lv]}%)`;
    return lv === 0 ? 'level 0 (silent)' : `level ${lv}`;
  }

  private statusText(): string {
    const s = this.ctx.s;
    const pos = `Position ${this.editPos + 1}`;
    const h = this.hover;
    if (!h) {
      const act = s.comp[this.which].active;
      return `${pos}${act === this.editPos ? ' (playing)' : ` · Position ${act + 1} is playing`}${this.locked ? ' · locked' : ''}`;
    }
    const cyc = this.cycles()[h.v];
    const vs = `${pos} · Voice ${h.v + 1}`;
    if (h.len) return `${vs} · click: cycle of ${h.step + 1} step${h.step ? 's' : ''}`;
    if (h.step >= cyc.length) return `${vs} · step ${h.step + 1}: past the ${cyc.length}-step cycle`;
    const c = cyc[h.step];
    return `${vs} · Step ${h.step + 1} of ${cyc.length} · ${c.lo === c.hi ? this.levelText(c.lo) : `${this.levelText(c.lo)} to ${this.levelText(c.hi)}, random`}`;
  }

  private at(area: HTMLElement, e: PointerEvent): { step: number; level: number; len: boolean } {
    const p = localPoint(area, e);
    return { step: Math.round((p.x - OX) / SX), level: clamp(Math.round(4 - (p.y - OY) / LY), 0, 4), len: p.y > OY + GH + 4 };
  }

  private down(ev: PointerEvent, v: number, area: HTMLElement): void {
    ev.preventDefault();
    if (this.locked) return;
    const s = this.ctx.s;
    const a = this.at(area, ev);
    const cyc = this.cycles()[v];
    // step-number row: set the cycle length
    if (a.len) {
      const n = clamp(a.step + 1, 1, MAX_CYCLE_STEPS);
      // new steps default to level 1 [DOC]; Octave's to its neutral level (no shift)
      while (cyc.length < n) cyc.push(this.which === 'octave' ? { lo: 2, hi: 2 } : { lo: 1, hi: 1 });
      cyc.length = n;
      s.changed(this.which);
      return;
    }
    if (a.step < 0 || a.step >= cyc.length) return;
    cyc[a.step] = { lo: a.level, hi: a.level };
    s.changed(this.which);
    trackDrag(ev, area, ({ ev: e }) => {
      const b = this.at(area, e);
      if (b.step === a.step) {
        cyc[a.step] = { lo: Math.min(a.level, b.level), hi: Math.max(a.level, b.level) };
      } else {
        // horizontal drag: a run of steps at the same level, within the cycle length
        const lo = Math.max(0, Math.min(a.step, b.step));
        const hi = Math.min(cyc.length - 1, Math.max(a.step, b.step));
        for (let k = lo; k <= hi; k++) cyc[k] = { lo: a.level, hi: a.level };
      }
      s.changed(this.which);
    });
  }

  private drawnKey = '';
  private drawAll(): void {
    const s = this.ctx.s;
    const w = this.which;
    const cycles = this.cycles();
    const flashNow = this.ctx.now();
    const h = this.hover;
    const key = [s.rev, this.editPos, s.engine.state, h?.v, h?.step, h?.len, ...s.engine.voices.map((v) => v.cycle[w]), ...this.ctx.flash.cycle[w].map((t) => t > flashNow)].join('|');
    if (key === this.drawnKey) return;
    this.drawnKey = key;
    const isActive = s.comp[w].active === this.editPos;
    cycles.forEach((cyc, v) => {
      let inner = '';
      // levels (horizontal lines, labelled with what they mean for Octave) and steps (vertical)
      for (let lv = 0; lv <= 4; lv++) {
        const y = OY + (4 - lv) * LY + 0.5;
        const centre = w === 'octave' && lv === 2;
        inner += `<text x="${OX - 4}" y="${y + 2}" font-size="6" text-anchor="end" font-family="Silkscreen">${w === 'octave' ? OCTAVE_LABEL[lv] : lv}</text>`;
        inner += `<line x1="${OX}" y1="${y}" x2="${OX + SX * 15}" y2="${y}" stroke="${centre ? 'var(--ink)' : 'var(--dim)'}"${centre ? '' : ' stroke-dasharray="1 1"'}/>`;
      }
      for (let st = 0; st < 16; st++) {
        const x = OX + st * SX + 0.5;
        const on = st < cyc.length;
        inner += `<line x1="${x}" y1="${OY}" x2="${x}" y2="${OY + GH}" stroke="var(--ink)" stroke-dasharray="${on ? '0' : '1 2'}"/>`;
        inner += `<text x="${x}" y="${OY + GH + 10}" font-size="6" text-anchor="middle" font-family="Silkscreen"${on ? '' : ' fill="var(--dim)" fill-opacity="0.467"'}>${st + 1}</text>`;
        if (st === cyc.length - 1) inner += `<rect x="${x - 4.5}" y="${OY + GH + 3}" width="10" height="9" fill="none" stroke="var(--ink)"/>`;
        else if (h && h.v === v && h.len && h.step === st) inner += `<rect x="${x - 4.5}" y="${OY + GH + 3}" width="10" height="9" fill="none" stroke="var(--ink)" stroke-dasharray="1 1"/>`;
        if (on) {
          const c = cyc[st];
          const y1 = OY + (4 - c.hi) * LY;
          const y2 = OY + (4 - c.lo) * LY;
          if (c.hi !== c.lo) inner += `<rect x="${x - 1.5}" y="${y1}" width="3" height="${y2 - y1}" fill="var(--ink)"/>`;
          for (let lv = c.lo; lv <= c.hi; lv++) inner += `<rect x="${x - 2.5}" y="${OY + (4 - lv) * LY - 2}" width="5" height="5" fill="var(--ink)"/>`;
        }
      }
      // where the cycle is now (emmm visual aid): the step just played
      const vr = s.engine.voices[v];
      if (isActive && s.engine.state !== 'stopped' && cyc.length > 0) {
        const cur = (vr.cycle[w] - 1 + cyc.length) % cyc.length;
        inner += `<rect x="${OX + cur * SX - 3.5}" y="${OY + GH + 13}" width="7" height="2" fill="var(--activity)"/>`;
      }
      if (this.ctx.flash.cycle[w][v] > flashNow && isActive) inner += `<rect x="${OX - 16}" y="0" width="2" height="${GH + 6}" fill="var(--activity)"/>`;
      setSvg(this.grids[v], inner);
    });
  }

  update(): void {
    this.win.updatePositions();
    this.parts.forEach((p) => p.update());
    const t = this.statusText();
    if (this.status.textContent !== t) this.status.textContent = t;
  }

  openAt(pos: number): void {
    this.editPos = pos;
    this.win.show();
    this.ctx.s.changed('editor');
  }
}
