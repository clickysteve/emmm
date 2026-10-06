/**
 * Browser-local persistence: an autosave slot plus named documents in localStorage, and
 * file download / upload of .emmm.json documents. All storage access is guarded — private
 * windows and blocked storage must not break the app.
 */
import type { Composition } from '../engine/types';
import { deserialize, serialize, type EmmmDocument, type UiState } from './format';

const AUTOSAVE = 'emmm.autosave';
const STARTUP = 'emmm.startup';
const LIBRARY = 'emmm.library.';

function ls(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function autosave(comp: Composition, ui?: UiState): void {
  try {
    ls()?.setItem(AUTOSAVE, serialize(comp, ui));
  } catch {
    /* quota or blocked: ignore */
  }
}

export function loadAutosave(): EmmmDocument | null {
  try {
    const t = ls()?.getItem(AUTOSAVE);
    return t ? deserialize(t) : null;
  } catch {
    return null;
  }
}

export function saveToLibrary(name: string, comp: Composition, ui?: UiState): boolean {
  try {
    ls()?.setItem(LIBRARY + name, serialize(comp, ui));
    return true;
  } catch {
    return false;
  }
}

export function listLibrary(): string[] {
  const s = ls();
  if (!s) return [];
  const out: string[] = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(LIBRARY)) out.push(k.slice(LIBRARY.length));
    }
  } catch {
    return [];
  }
  return out.sort();
}

export function loadFromLibrary(name: string): EmmmDocument | null {
  try {
    const t = ls()?.getItem(LIBRARY + name);
    return t ? deserialize(t) : null;
  } catch {
    return null;
  }
}

export function deleteFromLibrary(name: string): void {
  try {
    ls()?.removeItem(LIBRARY + name);
  } catch {
    /* ignore */
  }
}

export function downloadBytes(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadDocument(comp: Composition, ui?: UiState): void {
  const safe = (comp.name || 'untitled').replace(/[^\w\- ]+/g, '').trim() || 'untitled';
  downloadBytes(`${safe}.emmm.json`, serialize(comp, ui), 'application/json');
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/**
 * Save State As Startup (S1 ch.19): the current screen becomes what New gives you —
 * without the contents of Patterns and without Time Distortion maps, as in M.
 */
export function saveStartup(comp: Composition): boolean {
  const c = structuredClone(comp);
  c.patternGroups.forEach((g) =>
    g.patterns.forEach((p) => {
      p.steps = [];
      p.scrambled = [];
      p.outputLength = 0;
    }),
  );
  c.timeDistortion.positions.forEach((pos) => pos.forEach((m) => (m.points = [])));
  c.sequence = null;
  c.sequenceEnable = false;
  c.name = 'Untitled';
  try {
    ls()?.setItem(STARTUP, serialize(c));
    return true;
  } catch {
    return false;
  }
}

export function loadStartup(): Composition | null {
  try {
    const t = ls()?.getItem(STARTUP);
    return t ? deserialize(t).composition : null;
  } catch {
    return null;
  }
}

export function clearStartup(): void {
  try {
    ls()?.removeItem(STARTUP);
  } catch {
    /* ignore */
  }
}
