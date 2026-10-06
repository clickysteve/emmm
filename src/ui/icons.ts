/**
 * Newly drawn 1-bit icons in the spirit of M's screen (not copies of its bitmaps).
 * Each function returns SVG markup for a w×h box; `c` is the ink colour.
 */

const R = (x: number, y: number, w: number, h: number, c = 'var(--ink)') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
const P = (d: string, c = 'var(--ink)', fill = 'none', sw = 1) => `<path d="${d}" stroke="${c}" stroke-width="${sw}" fill="${fill}" stroke-linecap="square"/>`;

export function arrowIcon(dir: 'right' | 'left' | 'up' | 'down', size = 11, c = 'var(--ink)'): string {
  const m = size / 2;
  const s = size;
  // a bold arrow drawn as a polygon, rotated
  const rot = { right: 0, down: 90, left: 180, up: 270 }[dir];
  return `<g transform="rotate(${rot} ${m} ${m})"><polygon points="${s * 0.15},${m - 1} ${s * 0.55},${m - 1} ${s * 0.55},${s * 0.2} ${s * 0.9},${m} ${s * 0.55},${s * 0.8} ${s * 0.55},${m + 1} ${s * 0.15},${m + 1}" fill="${c}"/></g>`;
}

export const ICON: Record<string, (c?: string) => string> = {
  speaker: (c = 'var(--ink)') => R(1, 4, 3, 4, c) + P('M4 4 L7 1 L7 11 L4 8', c, c) + P('M9 3 Q11 6 9 9', c) + P('M10 1 Q13 6 10 11', c),
  check: (c = 'var(--ink)') => P('M2 6 L5 9 L10 2', c, 'none', 2),
  diamond: (c = 'var(--ink)') => `<polygon points="6,1 11,6 6,11 1,6" fill="${c}"/>`,
  dash: (c = 'var(--ink)') => R(3, 6, 6, 1, c),
  R: (c = 'var(--ink)') => `<text x="6" y="10" font-size="11" font-weight="700" text-anchor="middle" fill="${c}" font-family="Tiny5, sans-serif">R</text>`,
  C: (c = 'var(--ink)') => `<text x="6" y="10" font-size="11" font-weight="700" text-anchor="middle" fill="${c}" font-family="Tiny5, sans-serif">C</text>`,
  sharpflat: (c = 'var(--ink)') => `<text x="1" y="10" font-size="10" font-weight="700" fill="${c}" font-family="Tiny5, sans-serif">#</text><text x="7" y="10" font-size="10" font-weight="700" fill="${c}" font-family="Tiny5, sans-serif">b</text>`,
  echomap: (c = 'var(--ink)') => P('M1 3 L5 3 M3 1 L5 3 L3 5', c) + P('M5 9 L1 9 M3 7 L1 9 L3 11', c) + `<polygon points="7,1 11,2 11,7 9,11 7,9" fill="${c}"/>` + R(8, 4, 1, 1, 'var(--paper)') + R(9, 7, 1, 1, 'var(--paper)'),
  orchMini: (c = 'var(--ink)') => R(1, 1, 10, 10, 'none') + P('M1 1 h10 v10 h-10 z', c) + R(3, 3, 2, 2, c) + R(5, 5, 2, 2, c) + R(7, 7, 2, 2, c),
  mouse: (c = 'var(--ink)') => P('M3 4 h6 v6 q0 2 -3 2 q-3 0 -3 -2 z', c) + P('M6 4 v3 M6 4 Q6 1 9 1', c),
  note: (c = 'var(--ink)') => `<ellipse cx="4.5" cy="9" rx="2.5" ry="2" fill="${c}"/>` + R(6, 1, 1, 8, c) + P('M7 1 L10 4', c),
  chord: (c = 'var(--ink)') => `<ellipse cx="3.5" cy="9.5" rx="2.5" ry="1.6" fill="${c}"/><ellipse cx="3.5" cy="5.5" rx="2.5" ry="1.6" fill="${c}"/>` + R(5, 0, 1, 10, c),
  plus: (c = 'var(--ink)') => R(5, 1, 2, 10, c) + R(1, 5, 10, 2, c),
  insert: (c = 'var(--ink)') => `<circle cx="2.5" cy="7" r="2" fill="${c}"/><circle cx="6" cy="7" r="2" fill="var(--paper)" stroke="${c}"/><circle cx="9.5" cy="7" r="2" fill="${c}"/>`,
  replace: (c = 'var(--ink)') => `<circle cx="3" cy="7" r="2" fill="${c}"/><circle cx="9" cy="7" r="2" fill="var(--paper)" stroke="${c}"/>` + P('M5.5 7 h1', c),
  overdub: (c = 'var(--ink)') => `<circle cx="6" cy="4" r="2.2" fill="var(--paper)" stroke="${c}"/><circle cx="6" cy="9" r="2.2" fill="${c}"/>`,
  repeat: (c = 'var(--ink)') => R(1, 1, 1, 10, c) + R(3, 1, 1, 10, c) + R(5, 4, 1, 1, c) + R(5, 7, 1, 1, c) + R(8, 4, 1, 1, c) + R(8, 7, 1, 1, c) + R(10, 1, 1, 10, c),
  tick: (c = 'var(--ink)') => R(5, 5, 1, 1, c),
  clock: (c = 'var(--ink)') => `<circle cx="6" cy="6" r="4.5" fill="none" stroke="${c}"/>` + P('M6 3 v3 h2', c),
  phase: (c = 'var(--ink)') => P('M0 6 Q2 1 4 6 T8 6 T12 6', c) + P('M0 8 Q2 3 4 8 T8 8 T12 8', c),
  timebase: (c = 'var(--ink)') => R(1, 9, 10, 1, c) + R(1, 6, 1, 4, c) + R(5, 6, 1, 4, c) + R(10, 6, 1, 4, c),
  play: (c = 'var(--ink)') => `<polygon points="3,1 10,6 3,11" fill="${c}"/>`,
  stop: (c = 'var(--ink)') => `<circle cx="6" cy="6" r="4.5" fill="${c}"/>`,
  pause: (c = 'var(--ink)') => R(2, 1, 3, 10, c) + R(7, 1, 3, 10, c),
  sync: (c = 'var(--ink)') => `<text x="0" y="10" font-size="10" font-weight="700" fill="${c}" font-family="Tiny5, sans-serif">Sync</text>`,
  film: (c = 'var(--ink)') => R(0, 2, 18, 9, c) + [1, 4, 7, 10, 13, 16].map((x) => R(x, 3, 1, 1, 'var(--paper)') + R(x, 9, 1, 1, 'var(--paper)')).join('') + R(2, 5, 4, 3, 'var(--paper)') + R(7, 5, 4, 3, 'var(--paper)') + R(12, 5, 4, 3, 'var(--paper)'),
  seq: (c = 'var(--ink)') => P('M2 0.5 h6 l3 3 v8 h-9 z', c, 'var(--paper)') + `<circle cx="6.5" cy="7" r="2" fill="${c}"/>`,
  robot: (c = 'var(--ink)') => R(3, 1, 6, 5, c) + R(4, 2, 1, 1, 'var(--paper)') + R(7, 2, 1, 1, 'var(--paper)') + R(4, 4, 4, 1, 'var(--paper)') + R(5, 0, 2, 1, c) + R(2, 7, 8, 4, c) + R(0, 7, 1, 3, c) + R(11, 7, 1, 3, c) + R(5, 8, 2, 1, 'var(--paper)'),
  camera: (c = 'var(--ink)') => R(1, 4, 16, 9, c) + R(4, 2, 4, 2, c) + `<circle cx="9" cy="8.5" r="3" fill="var(--paper)"/><circle cx="9" cy="8.5" r="1.5" fill="${c}"/>` + R(14, 5, 2, 1, 'var(--paper)'),
  slides: (c = 'var(--ink)') => P('M1.5 3.5 h9 v7 h-9 z', c, 'var(--paper)') + P('M3.5 1.5 h9 v7', c) + R(3, 5, 6, 4, c) + R(4, 6, 1, 1, 'var(--paper)'),
  globe: (c = 'var(--ink)') => `<circle cx="9" cy="9" r="7.5" fill="var(--paper)" stroke="${c}"/>` + P('M4 5 q3 1 3 4 q-1 3 -3 2 M10 3 q3 2 2 5 q2 3 -1 5 M8 13 q2 -2 4 0', c, c),
  pencil: (c = 'var(--ink)') => P('M1.5 3.5 h11 v9 h-11 z', c, 'var(--paper)') + P('M5 11 L13 1 L15 3 L7 13 L4 14 z', c, 'var(--paper)') + R(4, 12, 2, 2, c),
  restore: (c = 'var(--ink)') => P('M1.5 3.5 h11 v9 h-11 z', c, 'var(--paper)') + P('M4.5 1.5 h11 v9', c) + R(4, 6, 2, 2, c) + R(7, 6, 2, 2, c) + R(4, 9, 5, 1, c),
  record: (c = 'var(--ink)') => `<circle cx="6" cy="6" r="4" fill="${c}"/>`,
  loop: (c = 'var(--ink)') => R(1, 1, 1, 10, c) + R(3, 1, 2, 10, c) + R(7, 4, 1, 1, c) + R(7, 7, 1, 1, c),
  wave: (c = 'var(--ink)') => P('M0 7 Q2 2 4 7 T8 7 T12 7', c),
  close: (c = 'var(--ink)') => `<polygon points="1,1 11,1 1,11" fill="none" stroke="${c}"/>`,
  baton: (c = 'var(--ink)') => P('M1 11 L9 3', c, 'none', 1) + `<circle cx="10" cy="2" r="1.5" fill="${c}"/>`,
  eraser: (c = 'var(--ink)') => P('M2 9 L7 3 L11 6 L7 11 H3 Z', c, 'var(--paper)') + P('M5 6 L9 9', c),
  plunger: (c = 'var(--ink)') => R(5, 1, 2, 6, c) + P('M2 11 Q6 5 10 11 Z', c, c),
  scissors: (c = 'var(--ink)') => `<circle cx="3" cy="9" r="2" fill="none" stroke="${c}"/><circle cx="9" cy="9" r="2" fill="none" stroke="${c}"/>` + P('M4 7 L9 1 M8 7 L3 1', c),
  lock: (c = 'var(--ink)') => P('M3.5 6 V3.5 Q3.5 1.5 6 1.5 Q8.5 1.5 8.5 3.5 V6', c) + R(2, 6, 8, 5, c) + R(5, 8, 2, 2, 'var(--paper)'),
  selector: (c = 'var(--ink)') => `<rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="${c}" stroke-dasharray="1 1"/>`,
};

export function iconSvg(name: string, w = 12, h = 12, c = 'var(--ink)'): string {
  const f = ICON[name];
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${Math.max(12, w)} ${Math.max(12, h)}" shape-rendering="crispEdges">${f ? f(c) : ''}</svg>`;
}

/** Note-value glyph as SVG markup in a 12×12 box (whole … 32nd, triplets get a small 3).
 * den 0 = the "wave" (no quantization). */
export function noteValueSvg(den: number, c = 'var(--ink)'): string {
  if (den === 0) return ICON.wave(c);
  const trip = den % 3 === 0;
  const b = trip ? (den / 3) * 2 : den;
  let out = '';
  const open = b <= 2;
  out += `<ellipse cx="4" cy="9.5" rx="2.6" ry="1.8" fill="${open ? 'var(--paper)' : c}" stroke="${c}" stroke-width="1"/>`;
  if (b >= 2) out += R(6, 1, 1, 8, c);
  if (b >= 8) out += P('M7 1 L10 4', c);
  if (b >= 16) out += P('M7 3 L10 6', c);
  if (b >= 32) out += P('M7 5 L10 8', c);
  if (trip) out += `<text x="12" y="5" font-size="6" text-anchor="end" fill="${c}" font-family="Silkscreen, monospace">3</text>`;
  return out;
}

export function noteValueIcon(den: number, w = 12, h = 12, c = 'var(--ink)'): string {
  return `<svg width="${w}" height="${h}" viewBox="0 0 12 12" shape-rendering="crispEdges">${noteValueSvg(den, c)}</svg>`;
}

/** Plain-text short names for note values (fallback when glyph fonts are missing). */
export function noteValueName(den: number): string {
  const map: Record<number, string> = { 0: 'off', 1: 'w', 2: 'h', 3: 'h3', 4: 'q', 6: 'q3', 8: 'e', 12: 'e3', 16: 's', 24: 's3', 32: 't' };
  return map[den] ?? '1/' + den;
}
