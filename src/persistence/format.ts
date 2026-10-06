/**
 * The emmm document format: transparent, versioned JSON.
 *
 *   { "format": "emmm", "version": 1, "mode": "classic", "savedAt": "...",
 *     "composition": { ...Composition... }, "ui": { ... } }
 *
 * Loading goes through `migrate`, which upgrades older versions step by step and then fills
 * any missing field from the defaults, so files survive additions to the model.
 */
import { NUM_CHANNELS, NUM_POSITIONS, NUM_VOICES } from '../engine/constants';
import { defaultComposition } from '../engine/defaults';
import type { Composition } from '../engine/types';

export const FORMAT_ID = 'emmm';
export const FORMAT_VERSION = 1;

export interface UiState {
  windows?: Record<string, { x: number; y: number; open: boolean }>;
  [k: string]: unknown;
}

export interface EmmmDocument {
  format: typeof FORMAT_ID;
  version: number;
  mode: 'classic' | 'extended';
  savedAt: string;
  composition: Composition;
  ui?: UiState;
}

export function serialize(comp: Composition, ui?: UiState): string {
  const doc: EmmmDocument = {
    format: FORMAT_ID,
    version: FORMAT_VERSION,
    mode: 'classic',
    savedAt: new Date().toISOString(),
    composition: comp,
    ui,
  };
  return JSON.stringify(doc, null, 1);
}

export class FormatError extends Error {}

/** Fill gaps in `value` from `template` (same shape). Arrays of fixed size are padded. */
function fill<T>(value: unknown, template: T): T {
  if (template === null) return (value ?? null) as T;
  if (value === undefined || value === null) return structuredClone(template);
  if (Array.isArray(template)) {
    if (!Array.isArray(value)) return structuredClone(template);
    // Arrays whose template has a fixed length (positions, voices, channels) are padded.
    const out = value.map((v, i) => (i < template.length ? fill(v, template[i]) : v));
    for (let i = out.length; i < template.length; i++) out.push(structuredClone(template[i]));
    return out as T;
  }
  if (typeof template === 'object' && template !== null) {
    if (typeof value !== 'object') return structuredClone(template);
    const out: Record<string, unknown> = { ...(value as object) };
    for (const [k, tv] of Object.entries(template)) out[k] = fill((value as Record<string, unknown>)[k], tv);
    return out as T;
  }
  return (typeof value === typeof template ? value : template) as T;
}

/** Arrays inside these keys have variable length and must not be padded from defaults. */
function restoreVariableArrays(comp: Composition, raw: Composition): void {
  // pattern steps / scrambled lists, cycles and time-map points are user-length data
  comp.patternGroups.forEach((g, gi) =>
    g.patterns.forEach((p, pi) => {
      const rp = raw.patternGroups?.[gi]?.patterns?.[pi];
      p.steps = Array.isArray(rp?.steps) ? rp.steps.map((s) => (Array.isArray(s) ? s.filter((n) => Number.isInteger(n)) : [])) : [];
      p.scrambled = Array.isArray(rp?.scrambled) ? [...rp.scrambled] : p.steps.map((_, i) => i);
      if (p.scrambled.length !== p.steps.length) p.scrambled = p.steps.map((_, i) => i);
      p.outputLength = Math.max(0, Math.min(p.outputLength, p.steps.length));
    }),
  );
  for (const k of ['accent', 'legato', 'rhythm'] as const) {
    comp[k].positions.forEach((pos, pi) =>
      pos.forEach((_, v) => {
        const rc = raw[k]?.positions?.[pi]?.[v];
        if (Array.isArray(rc) && rc.length > 0) pos[v] = rc.map((s) => ({ lo: s.lo ?? 1, hi: s.hi ?? s.lo ?? 1 }));
      }),
    );
  }
  comp.timeDistortion.positions.forEach((pos, pi) =>
    pos.forEach((m, v) => {
      const rm = raw.timeDistortion?.positions?.[pi]?.[v];
      m.points = Array.isArray(rm?.points) ? rm.points.map((p) => [p[0], p[1]] as [number, number]) : [];
    }),
  );
  comp.orchestration.positions.forEach((pos, pi) =>
    pos.forEach((_, v) => {
      const ro = raw.orchestration?.positions?.[pi]?.[v];
      pos[v] = Array.isArray(ro) ? ro.filter((c) => c >= 1 && c <= NUM_CHANNELS) : [];
    }),
  );
  comp.extended.ccCycles.positions.forEach((pos, pi) =>
    pos.forEach((vc, v) => {
      const rc = raw.extended?.ccCycles?.positions?.[pi]?.[v]?.cycle;
      if (Array.isArray(rc) && rc.length > 0) vc.cycle = rc.map((s) => ({ lo: s.lo ?? 1, hi: s.hi ?? s.lo ?? 1 }));
    }),
  );
  comp.snapshots = comp.snapshots.map((_, i) => (raw.snapshots?.[i] ? structuredClone(raw.snapshots[i]) : null));
  comp.slideshows = comp.slideshows.map((_, i) => (raw.slideshows?.[i] ? structuredClone(raw.slideshows[i]) : null));
}

/** Upgrade any supported older document to the current version. */
export function migrate(doc: Record<string, unknown>): EmmmDocument {
  if (doc.format !== FORMAT_ID) throw new FormatError('Not an emmm document');
  let version = Number(doc.version);
  if (!Number.isFinite(version) || version < 1) throw new FormatError('Unknown emmm document version');
  if (version > FORMAT_VERSION) throw new FormatError(`This document was saved by a newer emmm (format v${version})`);
  // Future: while (version < FORMAT_VERSION) { doc = MIGRATIONS[version](doc); version++; }
  version = FORMAT_VERSION;
  const raw = (doc.composition ?? {}) as Composition;
  const comp = fill(raw, defaultComposition(typeof raw.seed === 'number' ? raw.seed : 38291));
  restoreVariableArrays(comp, raw);
  validate(comp);
  return { format: FORMAT_ID, version, mode: doc.mode === 'extended' ? 'extended' : 'classic', savedAt: String(doc.savedAt ?? ''), composition: comp, ui: (doc.ui as UiState) ?? {} };
}

export function deserialize(text: string): EmmmDocument {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new FormatError('File is not valid JSON');
  }
  if (!obj || typeof obj !== 'object') throw new FormatError('Not an emmm document');
  return migrate(obj as Record<string, unknown>);
}

/** Clamp values into legal ranges so a hand-edited file cannot crash the engine. */
export function validate(c: Composition): void {
  const clamp = (x: number, lo: number, hi: number) => (Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : lo);
  c.patternGroup.active = clamp(c.patternGroup.active, 0, NUM_POSITIONS - 1);
  for (const k of ['noteDensity', 'velocityRange', 'noteOrder', 'transposition', 'timeDistortion', 'accent', 'legato', 'rhythm', 'orchestration'] as const) {
    c[k].active = clamp(c[k].active, 0, NUM_POSITIONS - 1);
  }
  c.soundChoice.active = clamp(c.soundChoice.active, 0, 15);
  c.noteDensity.positions.forEach((p) => p.forEach((x, v) => (p[v] = clamp(x, 0, 100))));
  c.velocityRange.positions.forEach((p) => p.forEach((r) => ((r.lo = clamp(r.lo, 1, 127)), (r.hi = clamp(r.hi, 1, 127)))));
  c.noteOrder.positions.forEach((p) =>
    p.forEach((o) => {
      o.original = clamp(o.original, 0, 100);
      o.cyclic = clamp(o.cyclic, 0, 100 - o.original);
    }),
  );
  c.transposition.positions.forEach((p) => p.forEach((x, v) => (p[v] = clamp(Math.round(x), -60, 60))));
  for (const k of ['accent', 'legato', 'rhythm'] as const)
    c[k].positions.forEach((p) =>
      p.forEach((cy) => {
        if (cy.length > 16) cy.length = 16;
        cy.forEach((s) => ((s.lo = clamp(s.lo, 0, 4)), (s.hi = clamp(s.hi, 0, 4))));
      }),
    );
  c.patternGroups.forEach((g) =>
    g.patterns.forEach((p) => {
      p.tbNum = clamp(p.tbNum, 1, 99);
      p.phase = clamp(p.phase, 0, 199);
    }),
  );
  c.tempo.value = clamp(c.tempo.value, 10, 400);
  if (c.voices.length > NUM_VOICES) c.voices.length = NUM_VOICES;
}
