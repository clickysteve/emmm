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
  if (comp.sequence) s.sequenceEnable = comp.sequenceEnable;
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
  if (snap.sequenceEnable !== undefined) s.sequenceEnable = comp.sequenceEnable;
  return s;
}

export function snapshotSize(s: Snapshot): number {
  return Object.keys(s.positions).length + Object.keys(s.arrows).length + s.voices.reduce((n, v) => n + Object.keys(v ?? {}).length, 0) + (s.sync ? 1 : 0) + (s.sequenceEnable !== undefined ? 1 : 0);
}

export const SNAPSHOT_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const NAMES: Record<string, string> = {
  patternGroup: 'Pattern Group',
  noteDensity: 'Note Density',
  velocityRange: 'Velocity Range',
  noteOrder: 'Note Order',
  transposition: 'Transposition',
  timeDistortion: 'Time Distortion',
  accent: 'Accent',
  legato: 'Legato',
  rhythm: 'Rhythm',
  orchestration: 'Orchestration',
  soundChoice: 'Sound Choice',
  tempo: 'Tempo',
  snapshot: 'Snapshots',
};
const VOICE_NAMES: Record<keyof SnapshotVoiceItems, string> = { src: 'Src', playEnable: 'Play', echoThru: 'Echo', mouseAdvance: 'Mouse Adv', outputLength: 'Length', tbNum: 'Time Base n', tbDen: 'Time Base d', phase: 'Phase' };

/**
 * What a Snapshot holds, in words (for its tooltip): which Position each Variable goes to
 * (not the Position's contents), conducting arrows, per-voice Patterns-window items, Sync and
 * the Sequence enable.
 */
export function describeSnapshot(s: Snapshot): string[] {
  const out: string[] = [];
  for (const [k, p] of Object.entries(s.positions)) {
    if (p === undefined) continue;
    out.push(`${NAMES[k] ?? k} ${k === 'patternGroup' ? 'abcdef'[p] : p + 1}`);
  }
  for (const [k, a] of Object.entries(s.arrows)) if (a) out.push(`${NAMES[k] ?? k} conducting ${a.enabled ? 'on' : 'off'}`);
  s.voices.forEach((vi, v) => {
    const items = Object.entries(vi ?? {}).map(([k, x]) => `${VOICE_NAMES[k as keyof SnapshotVoiceItems] ?? k} ${typeof x === 'boolean' ? (x ? 'on' : 'off') : x}`);
    if (items.length) out.push(`Voice ${v + 1}: ${items.join(', ')}`);
  });
  if (s.sync) out.push('Sync');
  if (s.sequenceEnable !== undefined) out.push(`Sequence ${s.sequenceEnable ? 'on' : 'off'}`);
  return out;
}
