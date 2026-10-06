/**
 * Miniature representations of Variable Positions (S1 ch.16): each shows four rows, one per
 * voice, echoing the design of the Variable's edit window. Returns SVG markup.
 * `c` is ink, `bg` is paper (they swap on the active Position).
 */
import { hasNotes } from '../engine/patternOps';
import { mapLength } from '../engine/timeDistortion';
import type { Composition, Cycle, VariableName } from '../engine/types';

let pid = 0;
/** 50% dither / dots / hatch pattern defs with unique ids */
function defs(c: string): { defs: string; grey: string; dots: string } {
  const g = 'g' + ++pid;
  const d = 'd' + pid;
  return {
    defs: `<defs><pattern id="${g}" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="1" height="1" fill="${c}"/><rect x="1" y="1" width="1" height="1" fill="${c}"/></pattern><pattern id="${d}" width="3" height="3" patternUnits="userSpaceOnUse"><rect x="1" y="1" width="1" height="1" fill="${c}"/></pattern></defs>`,
    grey: `url(#${g})`,
    dots: `url(#${d})`,
  };
}

const rect = (x: number, y: number, w: number, h: number, f: string) => `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${Math.max(0, h)}" fill="${f}"/>`;

function rows(h: number): { y: (v: number) => number; rh: number } {
  const rh = (h - 2) / 4;
  return { y: (v) => 1 + v * rh, rh };
}

export function miniNoteDensity(vals: number[], w: number, h: number, c: string): string {
  const { y, rh } = rows(h);
  let s = '';
  vals.forEach((p, v) => {
    const cy = Math.round(y(v) + rh / 2);
    const len = Math.round(((w - 7) * p) / 100);
    s += rect(2, cy, len, 1, c) + rect(2 + len, cy - 1, 3, 3, c);
  });
  return s;
}

export function miniVelocity(vals: { lo: number; hi: number }[], w: number, h: number, c: string): string {
  const { y, rh } = rows(h);
  const d = defs(c);
  let s = d.defs;
  vals.forEach((r, v) => {
    const a = 2 + Math.round(((w - 4) * Math.min(r.lo, r.hi)) / 127);
    const b = 2 + Math.round(((w - 4) * Math.max(r.lo, r.hi)) / 127);
    s += rect(a, Math.round(y(v) + 1), Math.max(1, b - a), Math.max(2, Math.round(rh) - 2), d.grey);
  });
  return s;
}

export function miniNoteOrder(vals: { original: number; cyclic: number }[], w: number, h: number, c: string): string {
  const { y, rh } = rows(h);
  const d = defs(c);
  let s = d.defs;
  const W = w - 4;
  vals.forEach((o, v) => {
    const a = Math.round((W * o.original) / 100);
    const b = Math.round((W * (o.original + o.cyclic)) / 100);
    const yy = Math.round(y(v) + 1);
    const hh = Math.max(2, Math.round(rh) - 2);
    s += rect(2, yy, a, hh, c) + rect(2 + a, yy, b - a, hh, d.grey) + rect(2 + b, yy, W - b, hh, d.dots);
  });
  return s;
}

export function miniTransposition(vals: number[], w: number, h: number, c: string): string {
  const { y, rh } = rows(h);
  const mid = Math.round(w / 2);
  let s = rect(mid, 1, 1, h - 2, c);
  vals.forEach((t, v) => {
    const off = Math.max(-mid + 3, Math.min(mid - 6, Math.round((t / 24) * (w / 2 - 4))));
    s += rect(mid + off - (t < 0 ? 2 : t > 0 ? 0 : 1), Math.round(y(v) + 1), 4, Math.max(2, Math.round(rh) - 2), c);
  });
  return s;
}

export function miniTimeDistortion(maps: Composition['timeDistortion']['positions'][number], w: number, h: number, c: string): string {
  // four tiny graphs side by side, each a unit square
  const gw = (w - 4) / 4;
  let s = '';
  maps.forEach((m, v) => {
    const x0 = 2 + v * gw;
    const pts = [[0, 0], ...m.points, [1, 1]].map(([px, py]) => `${(x0 + px * (gw - 1)).toFixed(1)},${(h - 2 - py * (h - 4)).toFixed(1)}`);
    s += `<polyline points="${pts.join(' ')}" fill="none" stroke="${c}" stroke-width="1" shape-rendering="geometricPrecision"/>`;
    void mapLength;
  });
  return s;
}

export function miniCycle(cycles: Cycle[], w: number, h: number, c: string): string {
  const { y, rh } = rows(h);
  let s = '';
  cycles.forEach((cy, v) => {
    const top = y(v);
    const unit = (rh - 1) / 4;
    cy.forEach((st, i) => {
      const x = 2 + i * ((w - 4) / 16);
      const y1 = Math.round(top + (4 - st.hi) * unit);
      const y2 = Math.round(top + (4 - st.lo) * unit);
      s += rect(Math.round(x), y1, 2, Math.max(1, y2 - y1 + 1), c);
    });
  });
  return s;
}

export function miniOrchestration(chs: number[][], w: number, h: number, c: string): string {
  const { y, rh } = rows(h);
  const cw = (w - 4) / 16;
  let s = '';
  chs.forEach((list, v) => {
    for (let i = 0; i < 16; i++) {
      const on = list.includes(i + 1);
      const x = Math.round(2 + i * cw);
      const yy = Math.round(y(v) + 1);
      if (on) s += rect(x, yy, Math.max(1, Math.round(cw) - 1), Math.max(1, Math.round(rh) - 1), c);
      else s += rect(x, yy + Math.round(rh / 2) - 1, 1, 1, c);
    }
  });
  return s;
}

/** Pattern Group: the letter plus a brick per non-empty pattern (bricks flash on restart). */
export function miniPatternGroup(comp: Composition, g: number, w: number, h: number, c: string, flash: boolean[]): string {
  const pats = comp.patternGroups[g].patterns;
  let s = `<text x="${w - 3}" y="${h - 2}" font-size="9" font-weight="600" text-anchor="end" fill="${c}" font-family="Pixelify Sans, sans-serif">${'abcdef'[g]}</text>`;
  const bh = (h - 4) / 4;
  pats.forEach((p, v) => {
    if (!hasNotes(p)) return;
    const yy = 2 + v * bh;
    if (flash[v]) s += rect(2, Math.round(yy), 14, Math.max(2, Math.round(bh) - 1), c === '#000' ? '#000' : '#fff') + rect(4, Math.round(yy) + 1, 10, Math.max(0, Math.round(bh) - 3), c === '#000' ? '#fff' : '#000');
    else s += rect(2, Math.round(yy), 14, Math.max(2, Math.round(bh) - 1), c);
  });
  return s;
}

export function miniFor(comp: Composition, v: VariableName, pos: number, w: number, h: number, c: string, flash: boolean[] = []): string {
  switch (v) {
    case 'noteDensity':
      return miniNoteDensity(comp.noteDensity.positions[pos], w, h, c);
    case 'velocityRange':
      return miniVelocity(comp.velocityRange.positions[pos], w, h, c);
    case 'noteOrder':
      return miniNoteOrder(comp.noteOrder.positions[pos], w, h, c);
    case 'transposition':
      return miniTransposition(comp.transposition.positions[pos], w, h, c);
    case 'timeDistortion':
      return miniTimeDistortion(comp.timeDistortion.positions[pos], w, h, c);
    case 'accent':
    case 'legato':
    case 'rhythm':
      return miniCycle(comp[v].positions[pos], w, h, c);
    case 'orchestration':
      return miniOrchestration(comp.orchestration.positions[pos], w, h, c);
    case 'patternGroup':
      return miniPatternGroup(comp, pos, w, h, c, flash);
    default:
      return '';
  }
}
