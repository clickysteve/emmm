/**
 * The emmm document format: transparent, versioned JSON.
 *
 *   { "format": "emmm", "version": 2, "mode": "classic", "savedAt": "...",
 *     "composition": { ...Composition... }, "ui": { ... } }
 *
 * Loading goes through `migrate`, which upgrades older versions step by step and then fills
 * any missing field from the defaults, so files survive additions to the model.
 *
 * Version history:
 *   1  first release.
 *   2  Extended gains Locks, Mutation, A/B states and per-voice seeds (filled from defaults
 *      for older files). MIDI Learn mappings leave the document: they describe the user's
 *      hardware and are now an application preference. A version-1 file's mappings are
 *      returned as `legacyLearn` so the app can adopt them once.
 *   3  Extended gains four Trajectories (filled from defaults — switched off — for older
 *      files).
 *
 * Each Pattern may carry an emmm `scale` ({ root, scale }); files without it load as
 * Chromatic with their notes untouched (no version change was needed: it is optional).
 *
 * Not in the document at all: colour palettes, tooltips, Performance Feedback, MIDI Learn
 * (see app/prefs.ts, ui/palette.ts).
 */
import { NUM_CHANNELS, NUM_POSITIONS, NUM_VOICES } from '../engine/constants';
import { defaultComposition } from '../engine/defaults';
import type { Composition } from '../engine/types';
import { cleanChoice } from '../app/scales';
import { cleanTrajectory } from '../extended/trajectory';

export const FORMAT_ID = 'emmm';
export const FORMAT_VERSION = 3;

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
  /** MIDI Learn mappings found in a version-1 document (see the version history above) */
  legacyLearn?: unknown[];
}

export function serialize(comp: Composition, ui?: UiState): string {
  const doc: EmmmDocument = {
    format: FORMAT_ID,
    version: FORMAT_VERSION,
    mode: comp.extended.enabled ? 'extended' : 'classic',
    savedAt: new Date().toISOString(),
    composition: comp,
    ui,
  };
  return JSON.stringify(doc, null, 1);
}

export class FormatError extends Error {}

let legacyLearnHandler: ((mappings: unknown[]) => void) | null = null;
/** The app adopts MIDI Learn mappings found in version-1 documents, wherever they load from. */
export function onLegacyLearn(f: ((mappings: unknown[]) => void) | null): void {
  legacyLearnHandler = f;
}

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
  // Trajectory value lists have their own lengths (never padded from the defaults)
  const rt = (raw.extended as { trajectories?: unknown[] } | undefined)?.trajectories;
  comp.extended.trajectories = comp.extended.trajectories.map((d, i) => cleanTrajectory(Array.isArray(rt) && rt[i] ? rt[i] : d));
  comp.snapshots = comp.snapshots.map((_, i) => (raw.snapshots?.[i] ? structuredClone(raw.snapshots[i]) : null));
  comp.slideshows = comp.slideshows.map((_, i) => (raw.slideshows?.[i] ? structuredClone(raw.slideshows[i]) : null));
}

/** Upgrade any supported older document to the current version. */
export function migrate(doc: Record<string, unknown>): EmmmDocument {
  if (doc.format !== FORMAT_ID) throw new FormatError('Not an emmm document');
  let version = Number(doc.version);
  if (!Number.isFinite(version) || version < 1) throw new FormatError('Unknown emmm document version');
  if (version > FORMAT_VERSION) throw new FormatError(`This document was saved by a newer emmm (format v${version})`);
  const raw = (doc.composition ?? {}) as Composition;
  let legacyLearn: unknown[] | undefined;
  if (version < 3) {
    // v2 → v3: nothing to move; Trajectories arrive from the defaults (all off)
  }
  if (version < 2) {
    // v1 → v2: MIDI Learn mappings move out of the document (see the version history)
    const ext = (raw as { extended?: { learn?: unknown } }).extended;
    if (ext && Array.isArray(ext.learn)) {
      legacyLearn = ext.learn;
      legacyLearnHandler?.(legacyLearn);
    }
    version = 2;
  }
  version = FORMAT_VERSION;
  const comp = fill(raw, defaultComposition(typeof raw.seed === 'number' ? raw.seed : 38291));
  delete (comp.extended as { learn?: unknown }).learn;
  restoreVariableArrays(comp, raw);
  validate(comp);
  return { format: FORMAT_ID, version, mode: doc.mode === 'extended' ? 'extended' : 'classic', savedAt: String(doc.savedAt ?? ''), composition: comp, ui: (doc.ui as UiState) ?? {}, legacyLearn };
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
      // emmm Pattern scale: optional; absent (older files) = Chromatic, notes untouched
      if (p.scale !== undefined) p.scale = cleanChoice(p.scale);
    }),
  );
  c.tempo.value = clamp(c.tempo.value, 10, 400);
  const ext = c.extended;
  ext.mutation.amount = clamp(ext.mutation.amount, 0, 100);
  ext.mutation.count = clamp(Math.floor(ext.mutation.count), 0, 1e9);
  ext.voiceSeeds = [0, 1, 2, 3].map((v) => (typeof ext.voiceSeeds[v] === 'number' && Number.isFinite(ext.voiceSeeds[v]) ? (ext.voiceSeeds[v] as number) >>> 0 : null));
  if (c.voices.length > NUM_VOICES) c.voices.length = NUM_VOICES;
}
