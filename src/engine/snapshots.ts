/**
 * Snapshot capture helpers (M-BEHAVIOUR §12). A Snapshot records *which Position* each
 * included Variable is on, conducting arrows, per-voice Patterns-window settings and Sync.
 */
import { NUM_VOICES } from './constants';
import { CONDUCT_TARGETS } from './defaults';
import type { Composition, Snapshot, SnapshotVoiceItems, VariableName } from './types';

export const SNAPSHOT_VARIABLES: VariableName[] = [
  'patternGroup',
  'noteDensity',
  'velocityRange',
  'noteOrder',
  'transposition',
  'timeDistortion',
  'accent',
  'legato',
  'rhythm',
  'orchestration',
  'soundChoice',
];

export const VOICE_ITEMS: (keyof SnapshotVoiceItems)[] = ['src', 'playEnable', 'echoThru', 'mouseAdvance', 'outputLength', 'tbNum', 'tbDen', 'phase'];

export function emptySnapshot(): Snapshot {
  return { positions: {}, arrows: {}, voices: Array.from({ length: NUM_VOICES }, () => ({})), sync: false };
}

export function currentVoiceItem(comp: Composition, v: number, k: keyof SnapshotVoiceItems): number | boolean {
  const vs = comp.voices[v];
  const p = comp.patternGroups[comp.patternGroup.active].patterns[v];
  switch (k) {
    case 'src':
      return vs.src;
    case 'playEnable':
      return vs.playEnable;
    case 'echoThru':
      return vs.echoThru;
    case 'mouseAdvance':
      return vs.mouseAdvance;
    case 'outputLength':
      return p.outputLength;
    case 'tbNum':
      return p.tbNum;
    case 'tbDen':
      return p.tbDen;
    case 'phase':
      return p.phase;
  }
}

/** "Blink Everything": every storable control at its current value. Sync is included, as in
 * M (users then often un-blink it). */
export function captureAll(comp: Composition): Snapshot {
  const s = emptySnapshot();
  for (const v of SNAPSHOT_VARIABLES) s.positions[v] = (comp[v] as { active: number }).active;
  for (const t of CONDUCT_TARGETS) s.arrows[t] = { ...comp.conducting.arrows[t] };
  for (let v = 0; v < NUM_VOICES; v++) for (const k of VOICE_ITEMS) (s.voices[v] as Record<string, unknown>)[k] = currentVoiceItem(comp, v, k);
  s.sync = true;
  return s;
}

/** The current values of exactly the items in `snap` — used by Restore From Snapshot. */
export function captureLike(comp: Composition, snap: Snapshot): Snapshot {
  const s = emptySnapshot();
  for (const k of Object.keys(snap.positions) as VariableName[]) s.positions[k] = (comp[k] as { active: number }).active;
  for (const k of Object.keys(snap.arrows) as (keyof Composition['conducting']['arrows'])[]) s.arrows[k] = { ...comp.conducting.arrows[k] };
  snap.voices.forEach((vi, v) => {
    for (const k of Object.keys(vi ?? {}) as (keyof SnapshotVoiceItems)[]) (s.voices[v] as Record<string, unknown>)[k] = currentVoiceItem(comp, v, k);
  });
  s.sync = false;
  return s;
}

export function snapshotSize(s: Snapshot): number {
  return Object.keys(s.positions).length + Object.keys(s.arrows).length + s.voices.reduce((n, v) => n + Object.keys(v ?? {}).length, 0) + (s.sync ? 1 : 0);
}

export const SNAPSHOT_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
