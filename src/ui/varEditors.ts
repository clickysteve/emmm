/**
 * Variable Edit Windows (S1 ch.17). Each shows the six-box Position selector in its title
 * bar: click = choose which Position to edit, Alt-click = also make it active, pull down =
 * mark. Voice numbers 1–4 can be dragged onto each other to swap (Alt: copy) a voice's
 * settings.
 */
import { NOTE_NAMES, NUM_VOICES } from '../engine/constants';
import { neutralMap } from '../engine/defaults';
import { sanitizePoints } from '../engine/timeDistortion';
import type { TimeMap, VariableName } from '../engine/types';
import type { UiContext } from './context';
import { clamp, el, label, localPoint, svgEl, setSvg, trackDrag } from './dom';
import { noteValueIcon } from './icons';
import { MWindow, Numerical, RangeBar } from './widgets';

type PerVoiceVar = 'noteDensity' | 'velocityRange' | 'noteOrder' | 'transposition' | 'timeDistortion' | 'orchestration';

export abstract class VarEditor {
  win: MWindow;
  editPos = 0;
  protected parts: { update(): void }[] = [];
  constructor(
    protected ctx: UiContext,
    parent: HTMLElement,
    public variable: PerVoiceVar,
    title: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    const s = ctx.s;
    this.win = new MWindow(parent, {
      id: 'edit-' + variable,
      title,
      x,
      y,
      w,
      h,
      closable: true,
      area: variable === 'orchestration' ? 'midi' : 'variables',
      positions: {
        edit: () => this.editPos,
        active: () => s.comp[variable].active,
        marked: () => s.comp[variable].marked,
        select: (i, ev) => {
          this.editPos = i;
          if (ev.altKey) s.clickPosition(variable, i, { shift: ev.shiftKey });
          s.changed('editor');
        },
        mark: (i) => {
          s.comp[variable].marked[i] = !s.comp[variable].marked[i];
          s.changed('mark');
        },
      },
    });
  }

  get locked(): boolean {
    return this.ctx.s.isLocked(this.variable as VariableName, this.editPos);
  }

  /** positions[editPos] */
  protected get pos(): unknown[] {
    return this.ctx.s.comp[this.variable].positions[this.editPos] as unknown[];
  }

  /** Voice number labels that swap/copy voice settings by dragging (S1 ch.17). */
  protected voiceNumbers(x: number, y0: number, dy: number): void {
    for (let v = 0; v < NUM_VOICES; v++) {
      const n = el('div', 'label', this.win.body, [x, y0 + v * dy, 10, 10], String(v + 1));
      n.title = 'Drag onto another voice number to swap (Alt: copy)';
      n.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        trackDrag(ev, n, () => {}, ({ dy: ddy, moved, ev: e }) => {
          if (!moved || this.locked) return;
          const to = clamp(v + Math.round(ddy / dy), 0, 3);
          if (to === v) return;
          const p = this.pos;
          if (ev.altKey || e.altKey) p[to] = structuredClone(p[v]);
          else [p[v], p[to]] = [p[to], p[v]];
          this.ctx.s.changed(this.variable);
        });
      });
    }
  }

  update(): void {
    this.win.updatePositions();
    this.parts.forEach((p) => p.update());
  }

  openAt(pos: number): void {
    this.editPos = pos;
    this.win.show();
    this.ctx.s.changed('editor');
  }
}

// ---------------------------------------------------------------------------- Note Density

export class NoteDensityEditor extends VarEditor {
  constructor(ctx: UiContext, parent: HTMLElement) {
    super(ctx, parent, 'noteDensity', 'Note Density', 160, 150, 214, 106);
    const b = this.win.body;
    const s = ctx.s;
    label(b, 22, 3, '%');
    ['0', '25', '50', '75', '100'].forEach((t, i) => label(b, 60 + i * 34 - t.length * 2, 3, t, 'small'));
    this.voiceNumbers(4, 17, 19);
    for (let v = 0; v < NUM_VOICES; v++) {
      const y = 14 + v * 19;
      this.parts.push(
        new Numerical(b, 14, y, 28, 15, {
          get: () => (this.pos[v] as number),
          set: (x) => {
            if (this.locked) return;
            this.pos[v] = x;
            s.changed('noteDensity');
          },
          min: 0,
          max: 100,
        }),
      );
      // slider
      const track = el('div', '', b, [56, y, 146, 15]);
      track.style.position = 'absolute';
      const line = svgEl(146, 15, '');
      track.appendChild(line);
      const setFrom = (e: PointerEvent) => {
        if (this.locked) return;
        const p = localPoint(track, e);
        this.pos[v] = clamp(Math.round(((p.x - 4) / 136) * 100), 0, 100);
        s.changed('noteDensity');
      };
      track.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        setFrom(ev);
        trackDrag(ev, track, ({ ev: e }) => setFrom(e));
      });
      this.parts.push({
        update: () => {
          const x = 4 + Math.round(((this.pos[v] as number) / 100) * 136);
          setSvg(line, `<rect x="0" y="7" width="146" height="1" fill="var(--ink)"/><rect x="0" y="6" width="${x}" height="3" fill="var(--ink)"/><rect x="${x - 3}" y="3" width="7" height="9" fill="var(--ink)"/>`);
        },
      });
    }
  }
}

// ---------------------------------------------------------------------------- Velocity Range

export class VelocityRangeEditor extends VarEditor {
  constructor(ctx: UiContext, parent: HTMLElement) {
    super(ctx, parent, 'velocityRange', 'Velocity Range', 170, 160, 226, 104);
    const b = this.win.body;
    const s = ctx.s;
    label(b, 16, 2, 'low', 'tiny');
    label(b, 196, 2, 'high', 'tiny');
    this.voiceNumbers(4, 15, 19);
    for (let v = 0; v < NUM_VOICES; v++) {
      const y = 12 + v * 19;
      const r = () => this.pos[v] as { lo: number; hi: number };
      const ch = () => s.changed('velocityRange');
      this.parts.push(
        new Numerical(b, 14, y, 26, 15, {
          get: () => r().lo,
          set: (x) => {
            if (!this.locked) (r().lo = Math.min(x, r().hi)), ch();
          },
          min: 1,
          max: 127,
        }),
      );
      this.parts.push(
        new RangeBar(b, 44, y + 2, 146, 11, {
          min: 1,
          max: 127,
          get: () => [r().lo, r().hi],
          set: (lo, hi) => {
            if (this.locked) return;
            r().lo = lo;
            r().hi = hi;
            ch();
          },
        }),
      );
      this.parts.push(
        new Numerical(b, 194, y, 26, 15, {
          get: () => r().hi,
          set: (x) => {
            if (!this.locked) (r().hi = Math.max(x, r().lo)), ch();
          },
          min: 1,
          max: 127,
        }),
      );
    }
  }
}

// ---------------------------------------------------------------------------- Note Order

export class NoteOrderEditor extends VarEditor {
  constructor(ctx: UiContext, parent: HTMLElement) {
    super(ctx, parent, 'noteOrder', 'Note Order', 180, 170, 236, 128);
    const b = this.win.body;
    const s = ctx.s;
    this.voiceNumbers(4, 6, 19);
    const W = 120;
    for (let v = 0; v < NUM_VOICES; v++) {
      const y = 3 + v * 19;
      const o = () => this.pos[v] as { original: number; cyclic: number };
      const bar = el('div', '', b, [14, y, W + 2, 15]);
      bar.style.position = 'absolute';
      const svg = svgEl(W + 2, 15, '');
      bar.appendChild(svg);
      bar.title = 'Drag the left edge (Original) or the middle edge (Cyclic / Utterly)';
      bar.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        if (this.locked) return;
        const p = localPoint(bar, ev);
        const a = (o().original / 100) * W;
        const m = ((o().original + o().cyclic) / 100) * W;
        const which = Math.abs(p.x - a) <= Math.abs(p.x - m) && !(Math.abs(p.x - a) === Math.abs(p.x - m) && p.x > a) ? 'orig' : 'mid';
        const apply = (e: PointerEvent) => {
          const q = clamp(Math.round((localPoint(bar, e).x / W) * 100), 0, 100);
          const cur = o();
          const boundary = cur.original + cur.cyclic;
          if (which === 'orig') {
            const orig = Math.min(q, boundary);
            cur.cyclic = boundary - orig;
            cur.original = orig;
          } else {
            const bnd = Math.max(q, cur.original);
            cur.cyclic = bnd - cur.original;
          }
          s.changed('noteOrder');
        };
        apply(ev);
        trackDrag(ev, bar, ({ ev: e }) => apply(e));
      });
      const box = (x: number, get: () => number) => {
        const d = el('div', 'num', b, [x, y, 28, 15]);
        this.parts.push({ update: () => (d.textContent = String(get())) });
        return d;
      };
      box(140, () => o().original);
      box(170, () => o().cyclic);
      box(200, () => 100 - o().original - o().cyclic);
      this.parts.push({
        update: () => {
          const a = Math.round((o().original / 100) * W);
          const m = Math.round(((o().original + o().cyclic) / 100) * W);
          setSvg(
            svg,
            `<defs><pattern id="nog${v}" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="1" height="1"/><rect x="1" y="1" width="1" height="1"/></pattern><pattern id="nod${v}" width="4" height="4" patternUnits="userSpaceOnUse"><rect x="1" y="1" width="2" height="2"/></pattern></defs>` +
              `<rect x="0.5" y="0.5" width="${W + 1}" height="14" fill="var(--paper)" stroke="var(--ink)"/>` +
              `<rect x="1" y="1" width="${a}" height="13" fill="var(--ink)"/>` +
              `<rect x="${1 + a}" y="1" width="${m - a}" height="13" fill="url(#nog${v})"/>` +
              `<rect x="${1 + m}" y="1" width="${W - m}" height="13" fill="url(#nod${v})"/>` +
              `<rect x="${a}" y="0" width="2" height="15" fill="var(--ink)"/><rect x="${m}" y="0" width="2" height="15" fill="var(--ink)"/>`,
          );
        },
      });
    }
    label(b, 136, 82, 'Original<br>Order', 'small').style.textAlign = 'center';
    label(b, 168, 82, 'Cyclic<br>Random', 'small').style.textAlign = 'center';
    label(b, 199, 82, 'Utterly<br>Random', 'small').style.textAlign = 'center';
    const sw = (x: number, fill: string) => {
      const d = el('div', 'box ' + fill, b, [x, 100, 26, 6]);
      return d;
    };
    sw(141, 'inv');
    sw(171, 'fill-grey');
    sw(201, 'fill-dots');
  }
}

// ---------------------------------------------------------------------------- Transposition

export class TranspositionEditor extends VarEditor {
  constructor(ctx: UiContext, parent: HTMLElement) {
    super(ctx, parent, 'transposition', 'Transposition', 190, 180, 196, 106);
    const b = this.win.body;
    const s = ctx.s;
    label(b, 16, 3, 'Note', 'small');
    label(b, 42, 3, 'Octave', 'small');
    this.voiceNumbers(4, 16, 19);
    for (let v = 0; v < NUM_VOICES; v++) {
      const y = 13 + v * 19;
      const get = () => this.pos[v] as number;
      const set = (x: number) => {
        if (this.locked) return;
        this.pos[v] = clamp(x, -60, 60);
        s.changed('transposition');
      };
      // Note numerical steps in semitones and carries into the octave (S1 ch.7)
      this.parts.push(
        new Numerical(b, 14, y, 28, 15, {
          get,
          set,
          min: -60,
          max: 60,
          format: (x) => NOTE_NAMES[((x % 12) + 12) % 12],
        }),
      );
      this.parts.push(
        new Numerical(b, 44, y, 22, 15, {
          get: () => Math.floor(get() / 12) + 3,
          set: (o) => set((o - 3) * 12 + (((get() % 12) + 12) % 12)),
          min: -2,
          max: 8,
        }),
      );
    }
    label(b, 78, 34, 'Middle C = <b>C3</b>', 'small');
    label(b, 78, 46, '(No Transposition)', 'small');
  }
}

// ---------------------------------------------------------------------------- Orchestration

export class OrchestrationEditor extends VarEditor {
  constructor(ctx: UiContext, parent: HTMLElement) {
    super(ctx, parent, 'orchestration', 'Orchestration', 200, 190, 222, 104);
    const b = this.win.body;
    const s = ctx.s;
    label(b, 22, 2, 'MIDI Channel', 'small');
    for (let i = 0; i < 16; i++) label(b, 18 + i * 12.5 + (i < 9 ? 3 : 0), 12, String(i + 1), 'tiny');
    this.voiceNumbers(4, 25, 15);
    for (let v = 0; v < NUM_VOICES; v++) {
      const y = 22 + v * 15;
      const row = el('div', 'box', b, [16, y, 201, 14]);
      const svg = svgEl(199, 12, '');
      row.appendChild(svg);
      row.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        if (this.locked) return;
        const chOf = (e: PointerEvent) => clamp(Math.floor(localPoint(row, e).x / 12.5), 0, 15) + 1;
        const list = () => this.pos[v] as number[];
        const c0 = chOf(ev);
        const val = !list().includes(c0);
        const apply = (c: number) => {
          const l = list();
          if (val && !l.includes(c)) l.push(c);
          if (!val && l.includes(c)) l.splice(l.indexOf(c), 1);
          l.sort((a, b2) => a - b2);
          s.changed('orchestration');
        };
        apply(c0);
        trackDrag(ev, row, ({ ev: e }) => apply(chOf(e)));
      });
      this.parts.push({
        update: () => {
          const l = this.pos[v] as number[];
          let inner = `<defs><pattern id="oh${v}" width="4" height="4" patternUnits="userSpaceOnUse"><rect x="3" width="1" height="1"/><rect x="2" y="1" width="1" height="1"/><rect x="1" y="2" width="1" height="1"/><rect y="3" width="1" height="1"/></pattern></defs>`;
          for (let i = 0; i < 16; i++) {
            const x = Math.round(i * 12.5);
            inner += `<rect x="${x}" y="0" width="1" height="12" fill="var(--ink)"/>`;
            if (l.includes(i + 1)) inner += `<rect x="${x + 1}" y="0" width="${Math.round(12.5) - 1}" height="12" fill="url(#oh${v})"/><rect x="${x + 3}" y="3" width="6" height="6" fill="var(--ink)"/>`;
          }
          setSvg(svg, inner);
        },
      });
    }
  }
}

// ---------------------------------------------------------------------------- Time Distortion

const TD_UNITS = [1, 2, 4, 8, 16];

export class TimeDistortionEditor extends VarEditor {
  private voice = 0;
  private drawing: [number, number][] | null = null;
  private cursor: [number, number] | null = null;
  private svg: SVGSVGElement;
  private editBtns: HTMLDivElement[] = [];
  constructor(ctx: UiContext, parent: HTMLElement) {
    super(ctx, parent, 'timeDistortion', 'Time Distortion', 210, 100, 236, 252);
    const b = this.win.body;
    const s = ctx.s;
    label(b, 4, 4, 'Edit:', 'small');
    for (let v = 0; v < 4; v++) {
      const d = el('div', 'num', b, [28 + v * 13, 1, 12, 13], String(v + 1));
      d.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        const from = v;
        trackDrag(ev, d, () => {}, ({ dx, moved, ev: e }) => {
          const to = clamp(from + Math.round(dx / 13), 0, 3);
          if (moved && to !== from && !this.locked) {
            const p = this.pos;
            if (e.altKey || ev.altKey) p[to] = structuredClone(p[from]);
            else [p[from], p[to]] = [p[to], p[from]];
          } else this.voice = from;
          this.drawing = null;
          s.changed('timeDistortion');
        });
      });
      this.editBtns.push(d);
    }
    const clear = el('div', 'btn', b, [84, 1, 32, 13], 'Clear');
    clear.style.fontSize = '9px';
    clear.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      if (this.locked) return;
      const m = this.map();
      m.points = [];
      this.drawing = null;
      s.changed('timeDistortion');
    });
    label(b, 122, 4, 'Length', 'small');
    this.parts.push(
      new Numerical(b, 154, 1, 22, 13, {
        get: () => this.map().count,
        set: (x) => {
          if (!this.locked) (this.map().count = x), s.changed('timeDistortion');
        },
        min: 1,
        max: 64,
      }),
    );
    label(b, 179, 4, '×', 'small');
    const unit = new Numerical(b, 188, 1, 20, 13, {
      get: () => this.map().unit,
      set: (x) => {
        if (!this.locked) (this.map().unit = x), s.changed('timeDistortion');
      },
      values: TD_UNITS,
      format: () => '',
    });
    this.parts.push({
      update: () => {
        const u = String(this.map().unit);
        if (unit.el.dataset.v !== u) {
          unit.el.innerHTML = noteValueIcon(this.map().unit, 11, 11);
          unit.el.dataset.v = u;
        }
      },
    });
    const G = 200;
    const area = el('div', 'box', b, [16, 18, G + 2, G + 2]);
    area.style.background = 'var(--paper)';
    area.title = 'Click breakpoints from lower-left to upper-right; double-click to finish. Drag a breakpoint to tug it.';
    this.svg = svgEl(G, G, '');
    area.appendChild(this.svg);
    const ck = label(b, -8, 110, 'Clock', 'tiny');
    ck.style.transform = 'rotate(-90deg)';
    label(b, 96, 224, 'Real Time', 'tiny');
    const toUnit = (e: PointerEvent): [number, number] => {
      const p = localPoint(area, e);
      return [clamp(p.x / G, 0, 1), clamp(1 - p.y / G, 0, 1)];
    };
    let lastDown = 0;
    let finishedAt = -1e9;
    let lastXY: [number, number] = [-1, -1];
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.drawing) {
        this.drawing = null;
        s.changed('timeDistortion');
      }
    });
    area.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      if (this.locked) return;
      const [x, y] = toUnit(ev);
      const now = ev.timeStamp; // the press's own time (robust when the screen is busy)
      const dbl = now - lastDown < 350 && Math.hypot((x - lastXY[0]) * G, (y - lastXY[1]) * G) < 6;
      lastDown = now;
      lastXY = [x, y];
      const m = this.map();
      // the second click of the double-click that finished a map must not start a new one
      if (!this.drawing && now - finishedAt < 450) return;
      if (this.drawing) {
        if (dbl || (x > 0.95 && y > 0.95)) {
          m.points = sanitizePoints(this.drawing);
          this.drawing = null;
          finishedAt = now;
        } else {
          const last = this.drawing[this.drawing.length - 1] ?? [0, 0];
          if (x > last[0] + 0.01 && y > last[1] + 0.01) this.drawing.push([x, y]);
        }
        s.changed('timeDistortion');
        return;
      }
      // tug an existing breakpoint?
      const hit = m.points.findIndex(([px, py]) => Math.hypot((px - x) * G, (py - y) * G) < 6);
      if (hit >= 0) {
        trackDrag(ev, area, ({ ev: e }) => {
          const [nx, ny] = toUnit(e);
          const prev = m.points[hit - 1] ?? [0, 0];
          const next = m.points[hit + 1] ?? [1, 1];
          m.points[hit] = [clamp(nx, prev[0] + 0.01, next[0] - 0.01), clamp(ny, prev[1] + 0.01, next[1] - 0.01)];
          s.changed('timeDistortion');
        });
        return;
      }
      // start a new map (the "bombsight")
      this.drawing = [[x, y]];
      if (x < 0.02 && y < 0.02) this.drawing = [];
      s.changed('timeDistortion');
    });
    area.addEventListener('pointermove', (e) => {
      if (!this.drawing) return;
      this.cursor = toUnit(e);
      this.draw();
    });
    this.parts.push({ update: () => this.draw() });
  }

  private map(): TimeMap {
    const p = this.pos as TimeMap[];
    if (!p[this.voice]) p[this.voice] = neutralMap();
    return p[this.voice];
  }

  private draw(): void {
    const G = 200;
    const pt = ([x, y]: [number, number] | number[]) => `${(x * G).toFixed(1)},${((1 - y) * G).toFixed(1)}`;
    let inner = `<line x1="0" y1="${G}" x2="${G}" y2="0" stroke="var(--dim)" stroke-dasharray="1 3"/>`;
    (this.pos as TimeMap[]).forEach((m, v) => {
      if (v === this.voice && this.drawing) return;
      const pts = [[0, 0], ...m.points, [1, 1]].map(pt).join(' ');
      inner += `<polyline points="${pts}" fill="none" stroke="var(--ink)" stroke-width="${v === this.voice ? 2.5 : 1}" shape-rendering="geometricPrecision"/>`;
      if (v === this.voice) m.points.forEach((p) => (inner += `<rect x="${p[0] * G - 2}" y="${(1 - p[1]) * G - 2}" width="5" height="5" fill="var(--ink)"/>`));
    });
    if (this.drawing) {
      const pts = [[0, 0], ...this.drawing].map(pt).join(' ');
      inner += `<polyline points="${pts}" fill="none" stroke="var(--ink)" stroke-width="2.5"/>`;
      const last = this.drawing[this.drawing.length - 1] ?? [0, 0];
      if (this.cursor) inner += `<line x1="${last[0] * G}" y1="${(1 - last[1]) * G}" x2="${this.cursor[0] * G}" y2="${(1 - this.cursor[1]) * G}" stroke="var(--ink)" stroke-dasharray="2 2"/>` + `<circle cx="${this.cursor[0] * G}" cy="${(1 - this.cursor[1]) * G}" r="4" fill="none" stroke="var(--ink)"/><line x1="${this.cursor[0] * G - 7}" y1="${(1 - this.cursor[1]) * G}" x2="${this.cursor[0] * G + 7}" y2="${(1 - this.cursor[1]) * G}" stroke="var(--ink)"/><line x1="${this.cursor[0] * G}" y1="${(1 - this.cursor[1]) * G - 7}" x2="${this.cursor[0] * G}" y2="${(1 - this.cursor[1]) * G + 7}" stroke="var(--ink)"/>`;
    }
    setSvg(this.svg, inner);
    this.editBtns.forEach((d, v) => d.classList.toggle('inv', v === this.voice));
  }
}
