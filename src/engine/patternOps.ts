/**
 * Pattern editing operations (M-BEHAVIOUR §3, §15): Pattern menu and Edit menu behaviour.
 * All functions mutate the given pattern in place and keep `scrambled` and `outputLength`
 * consistent. Regions are [start, end) step index ranges.
 */
import { MAX_PATTERN_STEPS } from './constants';
import { permutation, Rng } from './rng';
import type { Pattern, Step } from './types';

export function newPattern(steps: Step[] = [], rng?: Rng): Pattern {
  const p: Pattern = {
    steps: steps.map((s) => [...s]),
    scrambled: [],
    outputLength: steps.length,
    tbNum: 1,
    tbDen: 4,
    phase: 0,
    chordMode: 'single',
    insertMode: 'insert',
    drumMachine: false,
    size: Math.max(32, steps.length),
  };
  rescramble(p, rng ?? new Rng(steps.length * 7919 + 1), false);
  return p;
}

export function clonePattern(p: Pattern): Pattern {
  return { ...p, steps: p.steps.map((s) => [...s]), scrambled: [...p.scrambled] };
}

export function isRest(s: Step): boolean {
  return s.length === 0;
}

export function hasNotes(p: Pattern): boolean {
  return p.steps.some((s) => s.length > 0);
}

/**
 * ReScramble: new Cyclic Random ordering (§3). With dontScrambleRests, rest indices keep
 * their place and only note-bearing indices are permuted among themselves.
 */
export function rescramble(p: Pattern, rng: Rng, dontScrambleRests: boolean, region?: [number, number]): void {
  const n = p.steps.length;
  // a whole-pattern scramble starts from the identity so rests (if kept) map to themselves
  if (p.scrambled.length !== n || !region) p.scrambled = Array.from({ length: n }, (_, i) => i);
  const [a, b] = region ?? [0, n];
  const idx: number[] = [];
  for (let i = a; i < b; i++) {
    if (dontScrambleRests && isRest(p.steps[i])) continue;
    idx.push(i);
  }
  const perm = permutation(idx.length, rng);
  const sources = idx.map((i) => (region ? p.scrambled[i] : i));
  idx.forEach((slot, k) => {
    p.scrambled[slot] = sources[perm[k]];
  });
}

/** Keep the scrambled list a valid permutation after structural edits. New indices are
 * inserted at random places; removed indices are dropped and the rest renumbered. */
export function repairScrambled(p: Pattern, rng: Rng, dontScrambleRests: boolean, removed: number[] = [], inserted: { at: number; count: number }[] = []): void {
  let s = [...p.scrambled];
  if (removed.length) {
    const rm = new Set(removed);
    s = s.filter((i) => !rm.has(i));
    const sorted = [...removed].sort((x, y) => x - y);
    s = s.map((i) => i - sorted.filter((r) => r < i).length);
  }
  for (const ins of inserted) {
    s = s.map((i) => (i >= ins.at ? i + ins.count : i));
    for (let k = 0; k < ins.count; k++) {
      const newIdx = ins.at + k;
      const pos = dontScrambleRests && isRest(p.steps[newIdx]) ? Math.min(newIdx, s.length) : rng.int(0, s.length);
      s.splice(pos, 0, newIdx);
    }
  }
  // Final safety net: guarantee a permutation of 0..n-1.
  const n = p.steps.length;
  const seen = new Set<number>();
  s = s.filter((i) => i >= 0 && i < n && !seen.has(i) && (seen.add(i), true));
  for (let i = 0; i < n; i++) if (!seen.has(i)) s.splice(rng.int(0, s.length), 0, i);
  p.scrambled = s;
}

function clampOutput(p: Pattern, wasFull: boolean): void {
  if (wasFull) p.outputLength = p.steps.length;
  p.outputLength = Math.max(0, Math.min(p.outputLength, p.steps.length));
  p.size = Math.max(p.size, p.steps.length);
}

function fullRegion(p: Pattern, region?: [number, number]): [number, number] {
  if (!region) return [0, p.steps.length];
  return [Math.max(0, region[0]), Math.min(p.steps.length, region[1])];
}

export function transpose(p: Pattern, semis: number, region?: [number, number]): void {
  const [a, b] = fullRegion(p, region);
  for (let i = a; i < b; i++) p.steps[i] = p.steps[i].map((n) => Math.max(0, Math.min(127, n + semis)));
}

/** Rotate Forward: the first step becomes the last (§15 [DOC ch.21]). */
export function rotateForward(p: Pattern, region?: [number, number]): void {
  const [a, b] = fullRegion(p, region);
  if (b - a < 2) return;
  const first = p.steps.splice(a, 1)[0];
  p.steps.splice(b - 1, 0, first);
}

/** Rotate Backward: the last step becomes the first. */
export function rotateBackward(p: Pattern, region?: [number, number]): void {
  const [a, b] = fullRegion(p, region);
  if (b - a < 2) return;
  const last = p.steps.splice(b - 1, 1)[0];
  p.steps.splice(a, 0, last);
}

export function reverse(p: Pattern, region?: [number, number]): void {
  const [a, b] = fullRegion(p, region);
  const seg = p.steps.slice(a, b).reverse();
  p.steps.splice(a, b - a, ...seg);
}

/** Insert `restsAfter` rests after every step in the region (Double = 1, Triple = 2). */
export function withRests(p: Pattern, restsAfter: number, rng: Rng, dontScrambleRests: boolean, region?: [number, number]): void {
  const [a, b] = fullRegion(p, region);
  const wasFull = p.outputLength === p.steps.length;
  const out: Step[] = [];
  for (let i = a; i < b; i++) {
    out.push(p.steps[i]);
    for (let k = 0; k < restsAfter; k++) out.push([]);
  }
  p.steps.splice(a, b - a, ...out);
  if (p.steps.length > MAX_PATTERN_STEPS) p.steps.length = MAX_PATTERN_STEPS;
  clampOutput(p, wasFull);
  rescramble(p, rng, dontScrambleRests);
}

/** Eliminate Chords: each chord becomes a run of single-note steps (in stored order). */
export function eliminateChords(p: Pattern, rng: Rng, dontScrambleRests: boolean, region?: [number, number]): void {
  const [a, b] = fullRegion(p, region);
  const wasFull = p.outputLength === p.steps.length;
  const out: Step[] = [];
  for (let i = a; i < b; i++) {
    const s = p.steps[i];
    if (s.length <= 1) out.push(s);
    else for (const n of s) out.push([n]);
  }
  p.steps.splice(a, b - a, ...out);
  if (p.steps.length > MAX_PATTERN_STEPS) p.steps.length = MAX_PATTERN_STEPS;
  clampOutput(p, wasFull);
  rescramble(p, rng, dontScrambleRests);
}

export function eliminateRests(p: Pattern, rng: Rng, dontScrambleRests: boolean, region?: [number, number]): void {
  const [a, b] = fullRegion(p, region);
  const wasFull = p.outputLength === p.steps.length;
  const removed: number[] = [];
  for (let i = a; i < b; i++) if (isRest(p.steps[i])) removed.push(i);
  deleteSteps(p, removed, rng, dontScrambleRests);
  clampOutput(p, wasFull);
}

/** Scissors / Clear-region: delete steps by index. */
export function deleteSteps(p: Pattern, indices: number[], rng: Rng, dontScrambleRests: boolean): void {
  if (!indices.length) return;
  const wasFull = p.outputLength === p.steps.length;
  const rm = new Set(indices);
  const removedBeforeOutput = indices.filter((i) => i < p.outputLength).length;
  p.steps = p.steps.filter((_, i) => !rm.has(i));
  repairScrambled(p, rng, dontScrambleRests, indices);
  if (!wasFull) p.outputLength -= removedBeforeOutput;
  clampOutput(p, wasFull);
}

/** Plunger: insert blank (rest) steps before `at`. */
export function insertSteps(p: Pattern, at: number, steps: Step[], rng: Rng, dontScrambleRests: boolean): void {
  const wasFull = p.outputLength === p.steps.length;
  at = Math.max(0, Math.min(at, p.steps.length));
  const room = MAX_PATTERN_STEPS - p.steps.length;
  const ins = steps.slice(0, Math.max(0, room)).map((s) => [...s]);
  if (!ins.length) return;
  p.steps.splice(at, 0, ...ins);
  repairScrambled(p, rng, dontScrambleRests, [], [{ at, count: ins.length }]);
  if (!wasFull && at < p.outputLength) p.outputLength += ins.length;
  clampOutput(p, wasFull);
}

/** Eraser / Change to Rests. */
export function changeToRests(p: Pattern, region?: [number, number]): void {
  const [a, b] = fullRegion(p, region);
  for (let i = a; i < b; i++) p.steps[i] = [];
}

/** Fill With Rests: whole pattern up to its Size becomes rests. */
export function fillWithRests(p: Pattern): void {
  p.steps = Array.from({ length: p.size }, () => []);
  p.scrambled = p.steps.map((_, i) => i);
  p.outputLength = p.steps.length;
}

/** Clear entire pattern. */
export function clearPattern(p: Pattern): void {
  p.steps = [];
  p.scrambled = [];
  p.outputLength = 0;
}

/**
 * Output Length numerical with the modifier key (§3 [DOC]): set the actual number of steps;
 * extra steps are rests, fewer deletes from the end.
 */
export function setLengthWithRests(p: Pattern, len: number, rng: Rng, dontScrambleRests: boolean): void {
  len = Math.max(0, Math.min(MAX_PATTERN_STEPS, Math.round(len)));
  const n = p.steps.length;
  if (len > n) insertSteps(p, n, Array.from({ length: len - n }, () => []), rng, dontScrambleRests);
  else if (len < n) deleteSteps(p, Array.from({ length: n - len }, (_, i) => len + i), rng, dontScrambleRests);
  p.outputLength = len;
}

/** Toggle one pitch in a step (Pattern Editor click). Clicking past the end pads with rests. */
export function togglePitch(p: Pattern, stepIndex: number, pitch: number, rng: Rng, dontScrambleRests: boolean, force?: boolean): void {
  if (stepIndex >= MAX_PATTERN_STEPS) return;
  if (stepIndex >= p.steps.length) {
    const wasFull = p.outputLength === p.steps.length;
    insertSteps(p, p.steps.length, Array.from({ length: stepIndex + 1 - p.steps.length }, () => []), rng, dontScrambleRests);
    if (wasFull) p.outputLength = p.steps.length;
  }
  const s = p.steps[stepIndex];
  const has = s.includes(pitch);
  const want = force ?? !has;
  if (want && !has) s.push(pitch);
  if (!want && has) s.splice(s.indexOf(pitch), 1);
}

/** Swap Scrambled and Original (§15): the playing order of the scrambled list becomes the
 * stored order and vice versa. */
export function swapScrambledAndOriginal(p: Pattern): void {
  const n = p.steps.length;
  const newSteps = p.scrambled.map((i) => p.steps[i]);
  // inverse permutation becomes the new scrambled list
  const inv = new Array<number>(n);
  p.scrambled.forEach((src, pos) => (inv[src] = pos));
  p.steps = newSteps;
  p.scrambled = inv;
}

/** Original -> Scrambled: scrambled list becomes identity. */
export function originalToScrambled(p: Pattern): void {
  p.scrambled = p.steps.map((_, i) => i);
}

/** Paste semantics (§15): returns copied steps for a region. */
export function copySteps(p: Pattern, region?: [number, number]): Step[] {
  const [a, b] = fullRegion(p, region);
  return p.steps.slice(a, b).map((s) => [...s]);
}

/** Paste into region: truncate to region size or pad region with rests. */
export function pasteIntoRegion(p: Pattern, clip: Step[], region: [number, number]): void {
  const [a, b] = fullRegion(p, region);
  for (let i = a; i < b; i++) p.steps[i] = i - a < clip.length ? [...clip[i - a]] : [];
}

export function pasteAtEnd(p: Pattern, clip: Step[], rng: Rng, dontScrambleRests: boolean): void {
  const wasFull = p.outputLength === p.steps.length;
  insertSteps(p, p.steps.length, clip, rng, dontScrambleRests);
  if (wasFull) p.outputLength = p.steps.length;
}
