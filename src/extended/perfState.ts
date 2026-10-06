/**
 * EXTENDED — A/B performance states.
 *
 * A state captures how the music is being *played*: every Variable (its six Positions and
 * which one is active), the cyclic value tables, tempo, the Voices' Patterns-window
 * settings, each Pattern's Output Length / Time Base / Phase / Cyclic Random order, and the
 * conducting arrows. It does not capture the Patterns' notes, MIDI routing, Snapshots,
 * Slideshows, options, the palette or anything about the screen.
 *
 * The format is a plain object keyed by composition field, so a later "morph" between A
 * and B can interpolate field by field.
 */
import { assignDeep } from '../app/assign';
import type { Composition } from '../engine/types';
import type { PerfStateData } from './extended';

const VARIABLE_KEYS = ['noteDensity', 'velocityRange', 'noteOrder', 'transposition', 'timeDistortion', 'accent', 'legato', 'rhythm', 'orchestration', 'soundChoice'] as const;

export function capturePerfState(c: Composition): PerfStateData {
  const out: PerfStateData = {
    patternGroupActive: c.patternGroup.active,
    rhythmValues: c.rhythmValues,
    legatoValues: c.legatoValues,
    tempo: c.tempo,
    voices: c.voices,
    arrows: c.conducting.arrows,
    continuousMode: c.conducting.continuousMode,
    patternTiming: c.patternGroups.map((g) => g.patterns.map((p) => ({ outputLength: p.outputLength, tbNum: p.tbNum, tbDen: p.tbDen, phase: p.phase, scrambled: p.scrambled }))),
  };
  for (const k of VARIABLE_KEYS) out[k] = c[k];
  return structuredClone(out);
}

/**
 * Recall a captured state into `c`, in place (safe while playing). `setTimeBaseDen` lets
 * the engine wake step-advance voices properly; Pattern Group changes are left to the
 * caller (`patternGroup`), which performs them the M way (with a Sync).
 */
export function recallPerfState(c: Composition, s: PerfStateData, setTimeBaseDen: (group: number, voice: number, den: number) => void): { patternGroup: number } {
  for (const k of VARIABLE_KEYS) if (s[k]) assignDeep(c[k], s[k]);
  if (Array.isArray(s.rhythmValues)) assignDeep(c.rhythmValues, s.rhythmValues);
  if (Array.isArray(s.legatoValues)) assignDeep(c.legatoValues, s.legatoValues);
  if (s.tempo) assignDeep(c.tempo, s.tempo);
  if (Array.isArray(s.voices)) assignDeep(c.voices, s.voices);
  if (s.arrows) assignDeep(c.conducting.arrows, s.arrows);
  if (s.continuousMode) assignDeep(c.conducting.continuousMode, s.continuousMode);
  const timing = s.patternTiming as { outputLength: number; tbNum: number; tbDen: number; phase: number; scrambled: number[] }[][] | undefined;
  timing?.forEach((g, gi) =>
    g.forEach((t, v) => {
      const p = c.patternGroups[gi]?.patterns[v];
      if (!p) return;
      p.outputLength = Math.min(t.outputLength, p.steps.length);
      p.tbNum = t.tbNum;
      p.phase = t.phase;
      // a reshuffled order only applies if the Pattern still has the same number of steps
      if (t.scrambled.length === p.steps.length) p.scrambled = [...t.scrambled];
      if (p.tbDen !== t.tbDen) setTimeBaseDen(gi, v, t.tbDen);
    }),
  );
  return { patternGroup: Number(s.patternGroupActive) || 0 };
}
