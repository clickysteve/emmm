import type { Prefs } from '../app/prefs';
import type { Session } from '../app/session';
import type { VariableName } from '../engine/types';

export type EditorName =
  | 'noteDensity'
  | 'velocityRange'
  | 'noteOrder'
  | 'transposition'
  | 'timeDistortion'
  | 'orchestration'
  | 'cyclic'
  | 'patternEditor'
  | 'midiAssignment'
  | 'monitor'
  | 'about'
  | 'library'
  | 'importMidi';

export interface FlashState {
  /** performance.now() until which the pattern brick of voice v flashes */
  pattern: number[];
  /** cycle restart flash per cyclic variable per voice */
  cycle: Record<'rhythm' | 'legato' | 'accent', number[]>;
  /** last played pitches per voice and when */
  notes: { pitches: number[]; until: number; step: number }[];
}

export interface UiContext {
  s: Session;
  /** application preferences and editor assistance (not part of the document) */
  prefs: Prefs;
  screen: HTMLElement;
  flash: FlashState;
  openEditor(name: EditorName, opts?: { position?: number; variable?: VariableName; voice?: number; from?: Element }): void;
  /** Variables whose position cells should blink (Hold/Do pending) */
  now(): number;
  alert(text: string): void;
}

export const VAR_LABEL: Record<VariableName, string> = {
  patternGroup: 'Pattern<br>Group',
  noteDensity: 'Note<br>Density',
  velocityRange: 'Vel<br>Range',
  noteOrder: 'Note<br>Order',
  transposition: 'Trans-<br>position',
  timeDistortion: 'Time<br>Distort',
  accent: 'Accent',
  legato: 'Legato',
  rhythm: 'Rhythm',
  orchestration: 'Chan<br>Orch',
  soundChoice: 'Sound<br>Choice',
};

export const EDITOR_FOR: Partial<Record<VariableName, EditorName>> = {
  noteDensity: 'noteDensity',
  velocityRange: 'velocityRange',
  noteOrder: 'noteOrder',
  transposition: 'transposition',
  timeDistortion: 'timeDistortion',
  orchestration: 'orchestration',
  accent: 'cyclic',
  legato: 'cyclic',
  rhythm: 'cyclic',
};
