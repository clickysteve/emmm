/**
 * Generate Pattern (emmm, Pattern ▸ Generate Pattern…): choose a generator and its settings,
 * Generate (as often as you like) to see the proposed Pattern drawn here, then Apply to put it
 * into the destination Pattern — fixed when the window opens, so the music changing Group
 * never moves it — or Cancel. Nothing changes before Apply; Apply is one Undo step.
 * The preview is a picture only (no sound).
 */
import { generate, GENERATORS, type GenParams } from '../app/generate';
import { ROOT_NAMES, SCALES } from '../app/scales';
import { noteName } from '../engine/constants';
import { parseNote } from '../engine/defaults';
import { freshSeed, Rng } from '../engine/rng';
import type { Step } from '../engine/types';
import type { UiContext } from './context';
import { el, label, setSvg, svgEl } from './dom';
import { Selector } from './selector';
import { MWindow, Numerical } from './widgets';

const PW = 296;
const PH = 70;

export class GenerateWindow {
  win: MWindow;
  /** the Pattern Apply replaces: Group and Voice, captured when the window opens */
  dest = { group: 0, voice: 0 };
  params: GenParams = { generator: 'walk', scale: { root: 0, scale: 'minor' }, lo: 60, hi: 84, steps: 16, density: 75, variation: 50, direction: 'up' };
  /** the generated, not yet applied steps */
  pending: Step[] | null = null;
  private parts: { update(): void }[] = [];
  private preview: SVGSVGElement;
  private msg: HTMLDivElement;
  private destEl: HTMLDivElement;

  constructor(private ctx: UiContext, parent: HTMLElement) {
    const s = ctx.s;
    this.win = new MWindow(parent, { id: 'generate', title: 'Generate Pattern', x: 160, y: 70, w: 310, h: 236, closable: true, onClose: () => (this.pending = null) });
    const b = this.win.body;
    const P = this.params;
    const sel = (x: number, y: number, w: number, o: ConstructorParameters<typeof Selector>[5]) => this.parts.push(new Selector(b, x, y, w, 14, o));
    const num = (x: number, y: number, w: number, o: ConstructorParameters<typeof Numerical>[5]) => this.parts.push(new Numerical(b, x, y, w, 15, o));
    const changed = () => s.changed('editor');

    label(b, 6, 6, 'Generator', 'small');
    sel(62, 3, 110, {
      label: 'Generator',
      options: () => GENERATORS.map((g) => ({ value: g.id, text: g.name })),
      value: () => P.generator,
      onChange: (v) => ((P.generator = v as GenParams['generator']), changed()),
    });
    const help = el('div', 'label tiny', b, [178, 3, 126, 26]);
    help.style.whiteSpace = 'normal';
    help.style.lineHeight = '8px';
    this.parts.push({ update: () => (help.textContent = GENERATORS.find((g) => g.id === P.generator)!.help) });

    label(b, 6, 24, 'Scale', 'small');
    sel(62, 21, 30, { label: 'Root of the scale', options: () => ROOT_NAMES.map((n, i) => ({ value: String(i), text: n })), value: () => String(P.scale.root), onChange: (v) => ((P.scale = { ...P.scale, root: Number(v) }), changed()) });
    sel(94, 21, 78, { label: 'Scale the notes come from', options: () => SCALES.map((x) => ({ value: x.id, text: x.name })), value: () => P.scale.scale, onChange: (v) => ((P.scale = { ...P.scale, scale: v }), changed()) });

    label(b, 6, 42, 'Range', 'small');
    const noteBox = (x: number, k: 'lo' | 'hi', title: string) =>
      num(x, 39, 34, {
        get: () => P[k],
        set: (v) => ((P[k] = v), changed()),
        min: 0,
        max: 127,
        format: (v) => noteName(v),
        parse: (t) => {
          try {
            return parseNote(t.trim().toUpperCase().replace('♯', '#'));
          } catch {
            return /^\d+$/.test(t) ? Number(t) : null;
          }
        },
        chars: 'abcdefg#-',
        title,
      });
    noteBox(62, 'lo', 'Lowest note (inclusive), e.g. C3');
    label(b, 99, 42, 'to', 'small');
    noteBox(114, 'hi', 'Highest note (inclusive), e.g. C5');
    label(b, 178, 42, 'Steps', 'small');
    num(212, 39, 30, { get: () => P.steps, set: (v) => ((P.steps = v), changed()), min: 1, max: 64, title: 'Steps in the generated Pattern (rests included)' });

    label(b, 6, 60, 'Density', 'small');
    num(62, 57, 30, { get: () => P.density, set: (v) => ((P.density = v), changed()), min: 0, max: 100, title: 'Density %: the share of steps that get a note (the rest are rests)' });
    label(b, 96, 60, '%  Variation', 'small');
    num(152, 57, 30, { get: () => P.variation, set: (v) => ((P.variation = v), changed()), min: 0, max: 100, title: 'Variation %: how much the material leaps, wanders or changes between repeats' });
    label(b, 186, 60, '%', 'small');
    sel(212, 57, 60, {
      label: 'Arpeggio direction (Arpeggio only)',
      options: () => [
        { value: 'up', text: 'Up' },
        { value: 'down', text: 'Down' },
        { value: 'updown', text: 'Up-Down' },
      ],
      value: () => P.direction,
      onChange: (v) => ((P.direction = v as GenParams['direction']), changed()),
    });

    this.destEl = el('div', 'label small', b, [6, 77, 298, 10]);
    const box = el('div', 'box', b, [6, 90, PW + 2, PH + 2]);
    box.style.background = 'var(--paper)';
    this.preview = svgEl(PW, PH, '');
    box.appendChild(this.preview);
    box.title = 'Preview of the generated Pattern (a picture: it is not played until you Apply)';
    this.msg = el('div', 'label tiny', b, [6, 165, 298, 10]);

    const btn = (x: number, w: number, text: string, f: () => void, id: string) => {
      const d = el('div', 'btn', b, [x, 196, w, 16], text);
      d.id = id;
      d.style.fontSize = '10px';
      d.setAttribute('role', 'button');
      d.addEventListener('pointerdown', (ev) => (ev.preventDefault(), f()));
      return d;
    };
    btn(6, 80, 'Generate', () => this.generate(), 'gen-generate');
    const apply = btn(150, 74, 'Apply', () => this.apply(), 'gen-apply');
    btn(230, 74, 'Cancel', () => this.win.close(), 'gen-cancel');
    this.parts.push({ update: () => apply.classList.toggle('on', !!this.pending) });
    this.parts.push({ update: () => this.draw() });
  }

  /** Open for one Pattern (Group g, Voice v): the destination stays put while the window is open. */
  openFor(group: number, voice: number): void {
    this.dest = { group, voice };
    this.pending = null;
    this.msg.textContent = '';
    this.win.show();
    this.ctx.s.changed('editor');
  }

  generate(rng = new Rng(freshSeed(), 77)): void {
    const steps = generate(this.params, rng);
    this.pending = steps;
    this.msg.textContent = steps ? `${steps.filter((x) => x.length).length} notes, ${steps.length} steps — Generate again for another, Apply to use it` : 'No notes of this scale lie in that range: widen the range or change the scale.';
    this.ctx.s.changed('editor');
  }

  apply(): void {
    if (!this.pending) return;
    this.ctx.s.applyGenerated(this.dest.group, this.dest.voice, this.pending, this.params.scale);
    this.pending = null;
    this.win.close();
  }

  private drawnKey = '';
  private draw(): void {
    const { group, voice } = this.dest;
    const s = this.ctx.s;
    const has = s.hasNotes(group, voice);
    const t = `Into Pattern ${'abcdef'[group]}${voice + 1} (Group ${'abcdef'[group]}, Voice ${voice + 1})${has ? ' — Apply replaces its notes' : ''}`;
    if (this.destEl.textContent !== t) this.destEl.textContent = t;
    const key = JSON.stringify([this.pending, this.params.lo, this.params.hi]);
    if (key === this.drawnKey) return;
    this.drawnKey = key;
    const st = this.pending ?? [];
    const notes = st.flat();
    const lo = Math.min(this.params.lo, this.params.hi, ...notes);
    const hi = Math.max(this.params.lo, this.params.hi, ...notes);
    const cw = PW / Math.max(16, st.length);
    const rh = (PH - 2) / Math.max(12, hi - lo + 1);
    let g = '';
    st.forEach((step, i) => {
      if (i % 4 === 0) g += `<rect x="${(i * cw).toFixed(1)}" y="0" width="0.5" height="${PH}" fill="var(--dim)"/>`;
      for (const p of step) g += `<rect x="${(i * cw + 0.5).toFixed(1)}" y="${(PH - 1 - (p - lo + 1) * rh).toFixed(1)}" width="${Math.max(1, cw - 1).toFixed(1)}" height="${Math.max(1.5, rh).toFixed(1)}" fill="var(--ink)"/>`;
    });
    if (!st.length) g = `<text x="${PW / 2}" y="${PH / 2 + 3}" font-size="8" text-anchor="middle" font-family="Silkscreen" fill="var(--dim)">Press Generate</text>`;
    setSvg(this.preview, g);
  }

  update(): void {
    this.parts.forEach((p) => p.update());
  }
}
