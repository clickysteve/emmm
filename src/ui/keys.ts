/**
 * emmm's keyboard commands — one table, one dispatcher.
 *
 * Plain keys belong to M's performance keyboard (S1 Appendix A) and stay as they were:
 * Space Start/Sync, Return Stop, Tab Pause, Backspace Hold/Do, A–Z Snapshots, 1–9
 * Slideshows, 0 / \ Slideshow stop / loop, ` and , Pattern Editor audition. So emmm's own
 * commands use a modifier:
 *
 *   ⌘ (Ctrl on Windows / Linux) — document and editing commands, as on any desktop
 *     (M's own ⌘ keys are kept: ⌘S ⌘O ⌘. ⌘0 ⌘U ⌘D ⌘' ⌘] ⌘[ ⌘K ⌘L).
 *   ⌥ (Alt) + a letter — windows and performance helpers. Chosen to avoid the browser's and
 *     the system's own keys (⌘N ⌘T ⌘W ⌘Q ⌘H ⌘M ⌘1–9, ⇧⌘3–5, ⌃⌘F …), Windows' Alt+D / E / F,
 *     and the Mac's accent dead keys (⌥E ⌥I ⌥N ⌥U ⌥`).
 *
 * Letters are matched by physical key (KeyboardEvent.code), so ⌥P works although the Mac
 * types "π" for it. The table below is the single source for the dispatcher, the menus'
 * key labels, tooltips and the Keyboard Shortcuts window.
 */

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

/** One key combination. `key` is a KeyboardEvent.code for letters / digits / punctuation
 * ("KeyP", "Digit0", "Period", "BracketLeft", "Quote") or a KeyboardEvent.key for named keys
 * ("Enter", "Backspace", "ArrowUp"). `mod` = ⌘ on the Mac, Ctrl elsewhere. */
export interface Chord {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface KeyDef {
  id: string;
  label: string;
  group: string;
  keys: Chord[];
}

const c = (key: string, m: Partial<Chord> = {}): Chord => ({ key, ...m });
const mod = (key: string, m: Partial<Chord> = {}) => c(key, { mod: true, ...m });
const alt = (key: string, m: Partial<Chord> = {}) => c(key, { alt: true, ...m });

export const KEYS: KeyDef[] = [
  // File
  { id: 'open', label: 'Open…', group: 'File', keys: [mod('KeyO')] },
  { id: 'save', label: 'Save', group: 'File', keys: [mod('KeyS')] },
  { id: 'midiAssignment', label: 'Midi Assignment…', group: 'File', keys: [alt('KeyM')] },
  // Edit
  { id: 'undo', label: 'Undo', group: 'Edit', keys: [mod('KeyZ')] },
  { id: 'redo', label: 'Redo', group: 'Edit', keys: [mod('KeyZ', { shift: true })] },
  { id: 'cut', label: 'Cut', group: 'Edit', keys: [mod('KeyX')] },
  { id: 'copy', label: 'Copy', group: 'Edit', keys: [mod('KeyC')] },
  { id: 'paste', label: 'Paste', group: 'Edit', keys: [mod('KeyV')] },
  { id: 'changeToRests', label: 'Change to Rests', group: 'Edit', keys: [mod('KeyK')] },
  { id: 'selectAll', label: 'Select All steps (Pattern Editor)', group: 'Edit', keys: [mod('KeyA')] },
  // Pattern
  { id: 'patternEditor', label: 'Pattern Editor', group: 'Pattern', keys: [alt('KeyG')] },
  { id: 'clearPattern', label: 'Clear Pattern', group: 'Pattern', keys: [mod('Backspace')] },
  { id: 'prevVoice', label: 'Select the previous Pattern (Voice)', group: 'Pattern', keys: [alt('ArrowUp')] },
  { id: 'nextVoice', label: 'Select the next Pattern (Voice)', group: 'Pattern', keys: [alt('ArrowDown')] },
  { id: 'transposeUp', label: 'Transpose Up Half-Step', group: 'Pattern', keys: [mod('KeyU')] },
  { id: 'transposeDown', label: 'Transpose Down Half-Step', group: 'Pattern', keys: [mod('KeyD')] },
  { id: 'rescramble', label: 'ReScramble', group: 'Pattern', keys: [mod('Quote')] },
  { id: 'rotateForward', label: 'Rotate Forward', group: 'Pattern', keys: [mod('BracketRight')] },
  { id: 'rotateBackward', label: 'Rotate Backward', group: 'Pattern', keys: [mod('BracketLeft')] },
  // Variables
  { id: 'prevPosition', label: 'Previous Position (of the Variable last clicked)', group: 'Variables', keys: [alt('BracketLeft')] },
  { id: 'nextPosition', label: 'Next Position (of the Variable last clicked)', group: 'Variables', keys: [alt('BracketRight')] },
  // Windows
  { id: 'closeEditWindows', label: 'Close Edit Windows', group: 'Windows', keys: [mod('Digit0')] },
  { id: 'conductingWindow', label: 'Conducting window', group: 'Windows', keys: [alt('KeyK')] },
  { id: 'patternsWindow', label: 'Patterns window', group: 'Windows', keys: [alt('KeyP')] },
  { id: 'variablesWindow', label: 'Variables window', group: 'Windows', keys: [alt('KeyV')] },
  { id: 'cyclicWindow', label: 'Cyclic Variables window', group: 'Windows', keys: [alt('KeyC')] },
  { id: 'cyclicEditor', label: 'Cyclic Editor', group: 'Windows', keys: [alt('KeyY')] },
  // Performing
  { id: 'allNotesOff', label: 'All Notes Off', group: 'Performing', keys: [mod('Period')] },
  { id: 'metronome', label: 'Use Metronome', group: 'Performing', keys: [alt('KeyT'), mod('KeyM')] },
  { id: 'lockMarked', label: 'Locked Marked Variables', group: 'Performing', keys: [mod('KeyL')] },
  // Extended
  { id: 'mutate', label: 'Mutate', group: 'Extended', keys: [alt('KeyX')] },
  { id: 'reroll', label: 'Reroll', group: 'Extended', keys: [alt('KeyR')] },
  { id: 'recallA', label: 'Recall A', group: 'Extended', keys: [alt('KeyA')] },
  { id: 'recallB', label: 'Recall B', group: 'Extended', keys: [alt('KeyB')] },
  { id: 'captureA', label: 'Capture A', group: 'Extended', keys: [alt('KeyA', { shift: true })] },
  { id: 'captureB', label: 'Capture B', group: 'Extended', keys: [alt('KeyB', { shift: true })] },
  { id: 'feedback', label: 'Performance Feedback', group: 'Extended', keys: [alt('KeyO')] },
  { id: 'trajectoryWindow', label: 'Trajectory window', group: 'Extended', keys: [alt('KeyJ')] },
  // View / Help
  { id: 'fullScreen', label: 'Full Screen', group: 'View', keys: [alt('Enter')] },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', group: 'View', keys: [alt('KeyH')] },
];

/** M's performance keys (plain keys) — handled by the performance keyboard, listed here for
 * the Keyboard Shortcuts window. */
export const PERFORMANCE_KEYS: [string, string][] = [
  ['Space', 'Start; while playing, Sync'],
  ['Return', 'Stop (all notes off)'],
  ['Tab', 'Pause / continue (⌥Tab: pause a Slideshow)'],
  ['⌫', 'Hold/Do (⇧⌫ quantized)'],
  ['A – Z', 'Recall Snapshot (store it while holding); ⇧ = with Sync'],
  ['1 – 9', 'Play Slideshow (⌥: record)'],
  ['0 · \\ · ⌥\\', 'Stop Slideshow · loop point · remove loop'],
  ['Caps Lock + move the mouse', 'Mouse Advance'],
  ['` and ,', 'Pattern Editor: hear the step at the counter / under the mouse'],
];

export const PATTERN_EDITOR_KEYS: [string, string][] = [
  ['← →', 'move the insertion point a step (⇧: extend the selection)'],
  ['↑ ↓', 'scroll the keyboard a semitone (⇧: an octave)'],
  ['⌫ / Delete', 'delete the selected steps (only with steps selected)'],
  [`${IS_MAC ? '⌘' : 'Ctrl+'}A`, 'select every step'],
  ['Escape', 'clear the selection'],
];

export const NUMBER_KEYS: [string, string][] = [
  ['click a number, then type', 'type the value you want; Return keeps it, Escape cancels'],
  ['(3 seconds)', 'a clicked number lets go of the keyboard after 3 s without a key'],
  ['Return', 'edit the selected number (its value is shown highlighted)'],
  ['↑ ↓', 'one step up / down (⇧: ten steps)'],
  ['Page Up / Down', 'ten steps'],
  ['Home / End', 'minimum / maximum'],
  ['Time Base', 'type "3/8" for both numbers; "sa" for step advance'],
  ['Range bars', 'type "40-100" (or one number)'],
];

const NAMES: Record<string, string> = {
  Enter: '↩',
  Backspace: '⌫',
  Delete: '⌦',
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Period: '.',
  Comma: ',',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Slash: '/',
  Space: 'Space',
};
const PC_NAMES: Record<string, string> = { Enter: 'Enter', Backspace: 'Backspace', Delete: 'Del' };

export function chordLabel(ch: Chord, mac = IS_MAC): string {
  const k = ch.key.startsWith('Key') ? ch.key.slice(3) : ch.key.startsWith('Digit') ? ch.key.slice(5) : (!mac && PC_NAMES[ch.key]) || NAMES[ch.key] || ch.key;
  if (mac) return `${ch.alt ? '⌥' : ''}${ch.shift ? '⇧' : ''}${ch.mod ? '⌘' : ''}${k}`;
  return [ch.mod && 'Ctrl', ch.alt && 'Alt', ch.shift && 'Shift', k].filter(Boolean).join('+');
}

const byId = new Map(KEYS.map((k) => [k.id, k]));

/** The (first) key label of a command, for menus and tooltips; '' if it has none. */
export function keyLabel(id: string): string {
  const d = byId.get(id);
  return d ? chordLabel(d.keys[0]) : '';
}

/** Does a key event match a chord? Modifiers must match exactly (no extra ones). */
export function matches(e: KeyboardEvent, ch: Chord, mac = IS_MAC): boolean {
  const modDown = mac ? e.metaKey : e.ctrlKey;
  const otherDown = mac ? e.ctrlKey : e.metaKey;
  if (!!ch.mod !== modDown || otherDown || !!ch.alt !== e.altKey || !!ch.shift !== e.shiftKey) return false;
  return /^(Key|Digit)|^(Period|Comma|Quote|BracketLeft|BracketRight|Backslash|Slash)$/.test(ch.key) ? e.code === ch.key : e.key === ch.key;
}

export function findKey(e: KeyboardEvent, mac = IS_MAC): KeyDef | undefined {
  return KEYS.find((d) => d.keys.some((ch) => matches(e, ch, mac)));
}

export interface Command {
  run: () => void;
  enabled?: () => boolean;
}

/** The commands' actions, registered by the app (main.ts). */
export const commands = new Map<string, Command>();

/**
 * Run the command for a key event. Returns true (and prevents the browser's default) only
 * when emmm actually did something, so unused combinations still reach the browser.
 */
export function dispatch(e: KeyboardEvent): boolean {
  const def = findKey(e);
  if (!def) return false;
  const cmd = commands.get(def.id);
  if (!cmd || (cmd.enabled && !cmd.enabled())) return false;
  e.preventDefault();
  cmd.run();
  return true;
}
