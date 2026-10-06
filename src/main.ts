/**
 * emmm — application entry: builds M's main screen, menus and keyboard commands, runs the
 * display loop, and wires persistence. Musical timing does not depend on this loop.
 */
import './ui/style.css';
import { Session } from './app/session';
import { defaultComposition, demoComposition } from './engine/defaults';
import { freshSeed } from './engine/rng';
import type { VariableName } from './engine/types';
import { writeSmf } from './midi/smf';
import { deserialize } from './persistence/format';
import { autosave, clearStartup, downloadBytes, downloadDocument, loadAutosave, loadStartup, pickFile, saveStartup } from './persistence/storage';
import { noteName } from './engine/constants';
import type { EditorName, FlashState, UiContext } from './ui/context';
import { CyclicEditor } from './ui/cyclicEditor';
import { el, view } from './ui/dom';
import { ConductingWindow, CyclicWindow, MidiWindow, PatternsWindow, SnapshotWindow, VariablesWindow, type Updatable } from './ui/mainWindows';
import { AboutWindow, HelpWindow, ImportWindow, LibraryWindow, MidiAssignmentWindow, MonitorWindow } from './ui/otherWindows';
import { CcCyclesWindow, ExtendedWindow } from './ui/extendedWindow';
import { PatternEditor } from './ui/patternEditor';
import { applyPalette, PaletteLibrary } from './ui/palette';
import { PaletteWindow } from './ui/paletteWindow';
import { NoteDensityEditor, NoteOrderEditor, OrchestrationEditor, TimeDistortionEditor, TranspositionEditor, VarEditor, VelocityRangeEditor } from './ui/varEditors';

const W = 720;
const H = 470;

// ------------------------------------------------------------------ colour palette (a UI preference)
const palettes = new PaletteLibrary();
applyPalette(palettes.selected.colors);

// ------------------------------------------------------------------ document at startup
function newDocument() {
  const c = loadStartup() ?? defaultComposition();
  c.seed = freshSeed();
  return c;
}
const params = new URLSearchParams(location.search);
let initial = params.has('demo') ? demoComposition() : params.has('new') ? newDocument() : (loadAutosave()?.composition ?? demoComposition());
if (params.has('seed')) initial.seed = Number(params.get('seed')) || initial.seed;

const session = new Session(initial);
(window as unknown as { emmm: unknown }).emmm = session; // for debugging / automation

// ------------------------------------------------------------------ screen
const stage = el('div', '', document.body);
stage.id = 'stage';
const screen = el('div', '', stage);
screen.id = 'screen';
screen.style.width = W + 'px';
screen.style.height = H + 'px';

function fit(): void {
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  view.scale = s;
  screen.style.transform = `scale(${s})`;
  screen.style.left = Math.max(0, Math.round((window.innerWidth - W * s) / 2)) + 'px';
  screen.style.top = Math.max(0, Math.round((window.innerHeight - H * s) / 2)) + 'px';
}
window.addEventListener('resize', fit);
fit();

const flash: FlashState = {
  pattern: [0, 0, 0, 0],
  cycle: { rhythm: [0, 0, 0, 0], legato: [0, 0, 0, 0], accent: [0, 0, 0, 0] },
  notes: [0, 1, 2, 3].map(() => ({ pitches: [], until: 0, step: -1 })),
};

let dialog: HTMLDivElement | null = null;
function alertBox(text: string): void {
  dialog?.remove();
  const d = el('div', 'mdialog', screen, [W / 2 - 150, 140, 300]);
  d.innerHTML = `<div style="margin-bottom:10px">${text}</div>`;
  const ok = el('button', 'mbutton', d, undefined, 'OK');
  ok.style.float = 'right';
  ok.addEventListener('click', () => d.remove());
  d.addEventListener('pointerdown', (e) => e.stopPropagation());
  dialog = d;
}

const ctx: UiContext = {
  s: session,
  screen,
  flash,
  now: () => performance.now(),
  openEditor: (name, opts) => openEditor(name, opts),
  alert: alertBox,
};

// ------------------------------------------------------------------ windows
const desktop = el('div', '', screen, [0, 16, W, H - 16]);
desktop.style.position = 'absolute';
desktop.style.top = '0';
desktop.style.height = H + 'px';

const main: Updatable[] = [
  new PatternsWindow(ctx, desktop),
  new ConductingWindow(ctx, desktop),
  new VariablesWindow(ctx, desktop),
  new CyclicWindow(ctx, desktop),
  new MidiWindow(ctx, desktop),
  new SnapshotWindow(ctx, desktop),
];

const editors: Record<string, VarEditor> = {
  noteDensity: new NoteDensityEditor(ctx, desktop),
  velocityRange: new VelocityRangeEditor(ctx, desktop),
  noteOrder: new NoteOrderEditor(ctx, desktop),
  transposition: new TranspositionEditor(ctx, desktop),
  timeDistortion: new TimeDistortionEditor(ctx, desktop),
  orchestration: new OrchestrationEditor(ctx, desktop),
};
const cyclic = new CyclicEditor(ctx, desktop);
const patternEditor = new PatternEditor(ctx, desktop);
const midiAssign = new MidiAssignmentWindow(ctx, desktop);
const monitorWin = new MonitorWindow(ctx, desktop);
const about = new AboutWindow(ctx, desktop);
const importWin = new ImportWindow(ctx, desktop);
const library = new LibraryWindow(ctx, desktop);
const extendedWin = new ExtendedWindow(ctx, desktop);
const helpWin = new HelpWindow(ctx, desktop);
const ccWin = new CcCyclesWindow(ctx, desktop);
extendedWin.openCc = () => ccWin.win.show();
const paletteWin = new PaletteWindow(palettes, desktop);
const floating = [...Object.values(editors), cyclic, patternEditor, midiAssign, monitorWin, about, importWin, library, extendedWin, helpWin, ccWin, paletteWin];
floating.forEach((f) => f.win.el.classList.add('hidden'));

/** The Macintosh "zoom rects": dotted rectangles growing from the click to the window. */
function zoomRects(from: Element | undefined, to: HTMLElement): void {
  if (session.comp.options.noZoomRects || !from) return;
  const sr = screen.getBoundingClientRect();
  const k = view.scale;
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const r0 = [(a.left - sr.left) / k, (a.top - sr.top) / k, a.width / k, a.height / k];
  const r1 = [(b.left - sr.left) / k, (b.top - sr.top) / k, b.width / k, b.height / k];
  const N = 8;
  for (let i = 1; i <= N; i++) {
    setTimeout(() => {
      const t = i / N;
      const r = r0.map((v, j) => v + (r1[j] - v) * t);
      const z = el('div', '', screen, [r[0], r[1], r[2], r[3]]);
      z.style.position = 'absolute';
      z.style.border = '1px dotted var(--paper)';
      z.style.outline = '1px dotted var(--ink)';
      z.style.zIndex = '25000';
      z.style.pointerEvents = 'none';
      setTimeout(() => z.remove(), 60);
    }, i * 14);
  }
}

function openEditor(name: EditorName, opts: { position?: number; variable?: VariableName; voice?: number; from?: Element } = {}): void {
  const target =
    name in editors ? editors[name].win : name === 'cyclic' ? cyclic.win : name === 'patternEditor' ? patternEditor.win : null;
  if (target && !target.open) {
    target.el.classList.remove('hidden');
    zoomRects(opts.from, target.el);
    target.el.classList.add('hidden');
  }
  if (name in editors) {
    const e = editors[name];
    e.openAt(opts.position ?? session.comp[e.variable].active);
  } else if (name === 'cyclic') {
    const v = (opts.variable ?? cyclic.which) as 'rhythm' | 'legato' | 'accent';
    cyclic.openAt(v, opts.position ?? session.comp[v].active);
  } else if (name === 'patternEditor') patternEditor.openFor(opts.voice ?? session.selected.findIndex(Boolean));
  else if (name === 'midiAssignment') midiAssign.win.show();
  else if (name === 'monitor') monitorWin.win.show();
  else if (name === 'about') about.win.show();
  else if (name === 'library') {
    library.refresh();
    library.win.show();
  }
  session.changed('window');
}

(window as unknown as { emmmUi: unknown }).emmmUi = {
  openEditor,
  /** redraw everything once (used by automated checks) */
  updateAll: () => {
    for (const m of main) m.update();
    for (const f of floating) if (f.win.open) f.update();
  },
};

// ------------------------------------------------------------------ menus
interface MenuItem {
  label: string;
  key?: string;
  action?: () => void;
  checked?: () => boolean;
  enabled?: () => boolean;
  sep?: boolean;
}

const regionTarget = (): { voice: number; region?: [number, number] } | undefined => {
  if (patternEditor.win.open && patternEditor.region && patternEditor.region[1] > patternEditor.region[0]) return { voice: patternEditor.voice, region: patternEditor.region };
  if (patternEditor.win.open && !session.selected.some(Boolean)) return { voice: patternEditor.voice };
  return undefined;
};
const anySelected = () => session.selected.some(Boolean) || patternEditor.win.open;
const patOp = (op: string) => () => session.patternOp(op, regionTarget());
const editOp = (op: Parameters<Session['editOp']>[0]) => () => session.editOp(op, regionTarget());

async function openDocument(): Promise<void> {
  const f = await pickFile('.json,.emmm,application/json');
  if (!f) return;
  try {
    const doc = deserialize(await f.text());
    session.load(doc.composition);
  } catch (e) {
    alertBox('Could not open: ' + (e as Error).message);
  }
}

function saveAs(): void {
  const name = prompt('Save emmm document as:', session.comp.name || 'Untitled');
  if (!name) return;
  session.comp.name = name;
  session.changed('name');
  downloadDocument(session.comp);
}

const opt = (k: keyof typeof session.comp.options, label: string, key?: string): MenuItem => ({
  label,
  key,
  checked: () => session.comp.options[k],
  action: () => {
    session.comp.options[k] = !session.comp.options[k];
    session.changed('options');
  },
});

const MENUS: { title: string; cls?: string; items: MenuItem[] }[] = [
  {
    title: 'emmm',
    cls: 'logo',
    items: [
      { label: 'About emmm…', action: () => openEditor('about') },
      { label: 'Help…', action: () => helpWin.win.show() },
      { label: 'Monitor', action: () => openEditor('monitor') },
      { sep: true, label: '' },
      { label: 'New random seed', action: () => session.setSeed(freshSeed()) },
    ],
  },
  {
    title: 'File',
    items: [
      { label: 'New', action: () => confirm('Start a new document? Unsaved changes are kept only in the autosave.') && session.load(newDocument()) },
      { label: 'Open…', key: '⌘O', action: () => void openDocument() },
      { label: 'Open Demo', action: () => session.load(demoComposition()) },
      { label: 'Open Midi File…', action: async () => {
          const f = await pickFile('.mid,.midi,audio/midi');
          if (f) await importWin.openFile(f);
        } },
      { sep: true, label: '' },
      { label: 'Save', key: '⌘S', action: () => downloadDocument(session.comp) },
      { label: 'Save As…', action: saveAs },
      { label: 'Browser Library…', action: () => openEditor('library') },
      { label: 'Save Movie As Midi File…', enabled: () => session.movie.length > 0 && !session.movieRecording, action: () => downloadBytes(`${session.comp.name || 'M'} Movie.mid`, writeSmf(session.movie, session.movieTempos, (session.comp.name || 'emmm') + ' movie') as BlobPart, 'audio/midi') },
      { label: 'Save State As Startup', action: () => (saveStartup(session.comp) ? alertBox('The current state (without Pattern contents and Time Distortion maps) is now what <b>New</b> gives you.') : alertBox('Could not save the startup state in this browser.')) },
      { label: 'Forget Startup State', enabled: () => !!loadStartup(), action: () => clearStartup() },
      { sep: true, label: '' },
      { label: 'Midi Assignment…', action: () => openEditor('midiAssignment') },
    ],
  },
  {
    title: 'Edit',
    items: [
      { label: 'Undo', key: '⌘Z', enabled: () => false },
      { sep: true, label: '' },
      { label: 'Cut', enabled: anySelected, action: editOp('cut') },
      { label: 'Copy', enabled: anySelected, action: editOp('copy') },
      { label: 'Paste', enabled: () => anySelected() && !!session.clipboard, action: editOp('paste') },
      { label: 'Clear', enabled: anySelected, action: editOp('clear') },
      { sep: true, label: '' },
      { label: 'Paste Notes', enabled: () => anySelected() && !!session.clipboard, action: editOp('pasteNotes') },
      { label: 'Change to Rests', key: '⌘K', enabled: anySelected, action: editOp('changeToRests') },
      { label: 'Fill With Rests', enabled: anySelected, action: editOp('fillWithRests') },
      { label: 'Paste at End / Insert Paste', enabled: () => anySelected() && !!session.clipboard, action: editOp('pasteAtEnd') },
      { sep: true, label: '' },
      { label: 'Erase Snapshot', enabled: () => session.currentSnapshot !== null, action: () => session.eraseSnapshot() },
    ],
  },
  {
    title: 'Variables',
    items: [
      { label: 'Note Density…', action: () => openEditor('noteDensity') },
      { label: 'Velocity Range…', action: () => openEditor('velocityRange') },
      { label: 'Note Order…', action: () => openEditor('noteOrder') },
      { label: 'Transposition…', action: () => openEditor('transposition') },
      { label: 'Time Distortion…', action: () => openEditor('timeDistortion') },
      { label: 'Orchestration…', action: () => openEditor('orchestration') },
      { sep: true, label: '' },
      { label: 'Rhythm…', action: () => openEditor('cyclic', { variable: 'rhythm' }) },
      { label: 'Legato…', action: () => openEditor('cyclic', { variable: 'legato' }) },
      { label: 'Accent…', action: () => openEditor('cyclic', { variable: 'accent' }) },
    ],
  },
  {
    title: 'Pattern',
    items: [
      { label: 'Edit…', action: () => openEditor('patternEditor', { voice: Math.max(0, session.selected.findIndex(Boolean)) }) },
      { sep: true, label: '' },
      { label: 'Transpose Up Half-Step', key: "⌘U", enabled: anySelected, action: patOp('transposeUp') },
      { label: 'Transpose Up Octave', enabled: anySelected, action: patOp('octaveUp') },
      { label: 'Transpose Down Half-Step', key: "⌘D", enabled: anySelected, action: patOp('transposeDown') },
      { label: 'Transpose Down Octave', enabled: anySelected, action: patOp('octaveDown') },
      { label: 'ReScramble', key: "⌘'", enabled: anySelected, action: patOp('rescramble') },
      { label: 'Original -> Scrambled', enabled: anySelected, action: patOp('originalToScrambled') },
      { label: 'Swap Scrambled and Original', enabled: anySelected, action: patOp('swapScrambled') },
      { label: 'Rotate Forward', key: "⌘]", enabled: anySelected, action: patOp('rotateForward') },
      { label: 'Rotate Backward', key: "⌘[", enabled: anySelected, action: patOp('rotateBackward') },
      { label: 'Reverse Order', enabled: anySelected, action: patOp('reverse') },
      { label: 'Double with Rests', enabled: anySelected, action: patOp('double') },
      { label: 'Triple with Rests', enabled: anySelected, action: patOp('triple') },
      { label: 'Eliminate Chords', enabled: anySelected, action: patOp('eliminateChords') },
      { label: 'Eliminate Rests', enabled: anySelected, action: patOp('eliminateRests') },
    ],
  },
  {
    title: 'Windows',
    items: [
      { label: 'Close Edit Windows', key: '⌘0', action: () => floating.forEach((f) => f.win.open && f.win.close()) },
      { sep: true, label: '' },
      ...main.map((m) => ({ label: m.win.o.title.replace(/ [a-f]$/, ''), action: () => m.win.front() })),
      { label: 'Cyclic Editor', action: () => openEditor('cyclic') },
      { label: 'Pattern Editor', action: () => openEditor('patternEditor', { voice: patternEditor.voice }) },
      { label: 'Monitor', action: () => openEditor('monitor') },
    ],
  },
  {
    title: 'Options',
    items: [
      opt('useMetronome', 'Use Metronome', '⌘M'),
      opt('sendClock', 'Send Clock'),
      opt('tapAffectsVelocity', 'Tap Affects Velocity'),
      opt('dontScrambleRests', "Don't Scramble Rests"),
      opt('slideshowRecordWait', 'Slideshow Record Wait'),
      opt('sustainEntersRests', 'Sustain Enters Rests'),
      opt('midiConduct', 'Midi Conduct'),
      opt('secondOrderTranspose', 'Second Order Transpose'),
      opt('noCyclicBlinking', 'No Cyclic Blinking'),
      opt('editorSoundWhilePlaying', 'Editor Sound While Playing'),
      opt('lockMarkedVariables', 'Locked Marked Variables', '⌘L'),
      opt('noZoomRects', 'No Zoom Rects'),
      { sep: true, label: '' },
      { label: 'Palette…', action: () => paletteWin.show() },
      { label: 'Extended…  (not Classic M)', checked: () => session.comp.extended.enabled, action: () => extendedWin.win.show() },
      { label: 'Monitor All Output (internal)', checked: () => session.monitorAll, action: () => ((session.monitorAll = !session.monitorAll), session.monitor.unlock(), session.changed('midi')) },
    ],
  },
];

const menubar = el('div', '', screen);
menubar.id = 'menubar';
let openMenu: { el: HTMLDivElement; drop: HTMLDivElement } | null = null;
function closeMenu(): void {
  if (!openMenu) return;
  openMenu.el.classList.remove('open');
  openMenu.drop.remove();
  openMenu = null;
}
for (const m of MENUS) {
  const me = el('div', 'menu ' + (m.cls ?? ''), menubar, undefined, m.title);
  const show = () => {
    closeMenu();
    me.classList.add('open');
    const drop = el('div', 'dropdown', me);
    // a press inside the open menu must not close it (click-then-click as well as
    // press-drag-release menu use)
    drop.addEventListener('pointerdown', (e) => e.stopPropagation());
    for (const it of m.items) {
      if (it.sep) {
        el('div', 'sep', drop);
        continue;
      }
      const enabled = it.enabled ? it.enabled() : true;
      const d = el('div', 'item' + (enabled ? '' : ' disabled') + (it.checked?.() ? ' checked' : ''), drop);
      el('span', '', d, undefined, it.label);
      if (it.key) el('span', 'key', d, undefined, it.key);
      d.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        if (!enabled) return;
        closeMenu();
        it.action?.();
      });
    }
    openMenu = { el: me, drop };
  };
  me.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (openMenu?.el === me) closeMenu();
    else show();
  });
  me.addEventListener('pointerenter', () => openMenu && openMenu.el !== me && show());
}
const statusEl = el('div', 'status', menubar);
const outEl = el('div', 'menu', menubar);
outEl.style.fontWeight = '400';
outEl.title = 'Where M Output Channel 1 goes — click for Midi Assignment';
outEl.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  openEditor('midiAssignment');
});
window.addEventListener('pointerdown', () => closeMenu());

// ------------------------------------------------------------------ keyboard (S1 Appendix A)
let capsLock = false;
window.addEventListener('keydown', (e) => {
  const tgt = e.target as HTMLElement;
  if (tgt.tagName === 'INPUT' || tgt.tagName === 'SELECT' || tgt.tagName === 'TEXTAREA') return;
  capsLock = e.getModifierState?.('CapsLock') ?? capsLock;
  const cmd = e.metaKey || e.ctrlKey;
  if (cmd) {
    const k = e.key.toLowerCase();
    if (k === '.') session.allNotesOff();
    else if (k === 's') downloadDocument(session.comp);
    else if (k === 'o') void openDocument();
    else if (k === '0') floating.forEach((f) => f.win.open && f.win.close());
    else if (k === 'm') MENUS[6].items[0].action?.();
    else if (k === 'l') MENUS[6].items[10].action?.();
    else if (k === 'u' && anySelected()) patOp('transposeUp')();
    else if (k === 'd' && anySelected()) patOp('transposeDown')();
    else if (k === "'" && anySelected()) patOp('rescramble')();
    else if (k === ']' && anySelected()) patOp('rotateForward')();
    else if (k === '[' && anySelected()) patOp('rotateBackward')();
    else if (k === 'k' && anySelected()) editOp('changeToRests')();
    else return;
    e.preventDefault();
    return;
  }
  if (e.repeat && e.key !== 'Backspace') return;
  switch (e.key) {
    case ' ':
      session.start();
      break;
    case 'Enter':
      session.stop();
      break;
    case 'Tab':
      if (e.altKey) session.pauseSlideshow();
      else session.pause();
      break;
    case 'Backspace':
    case 'Delete':
      session.holdDo(e.shiftKey);
      break;
    case '\\':
    case '|':
      session.loopSlideshow(e.altKey);
      break;
    case 'Escape':
      closeMenu();
      dialog?.remove();
      break;
    case '`':
    case '~':
    case ',':
    case '<': {
      // Pattern Editor audition: ` plays the step at the MIDI Edit Counter, , the step under the cursor
      if (!patternEditor.win.open) return;
      const p = session.pattern(patternEditor.voice);
      const idx = e.key === '`' || e.key === '~' ? session.recorders[patternEditor.voice].counter : patternEditor.hover?.step ?? -1;
      if (p.steps[idx]?.length) session.auditionStep(patternEditor.voice, p.steps[idx], patternEditor.velocity);
      break;
    }
    default: {
      if (/^[a-zA-Z]$/.test(e.key) && !e.altKey) {
        const i = e.key.toUpperCase().charCodeAt(0) - 65;
        session.clickSnapshot(i, { shift: e.key === e.key.toUpperCase() && e.shiftKey });
        if (!session.comp.snapshots[i] && !session.hold) return;
      } else if (/^Digit[0-9]$/.test(e.code)) {
        const n = Number(e.code.slice(5));
        if (n === 0) session.stopSlideshow();
        else session.clickSlideshow(n - 1, { alt: e.altKey });
      } else return;
    }
  }
  e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  capsLock = e.getModifierState?.('CapsLock') ?? capsLock;
});

// ------------------------------------------------------------------ Mouse Advance (S1 ch.11)
let lastMove = 0;
let lastX = 0;
let lastY = 0;
let speed = 0;
window.addEventListener('pointermove', (e) => {
  capsLock = e.getModifierState?.('CapsLock') ?? capsLock;
  const gate = capsLock || (e.metaKey && e.altKey);
  const d = Math.hypot(e.clientX - lastX, e.clientY - lastY);
  lastX = e.clientX;
  lastY = e.clientY;
  speed = speed * 0.7 + d * 0.3;
  if (gate) lastMove = performance.now();
});

// ------------------------------------------------------------------ display loop
let lastSave = 0;
let saveDirty = false;
session.onChange((w) => {
  if (w !== 'baton' && w !== 'step') saveDirty = true;
});

function consumeVisual(now: number): boolean {
  const vis = session.visual;
  let changed = false;
  let i = 0;
  for (; i < vis.length && vis[i].ms <= now; i++) {
    const { ev } = vis[i];
    changed = true;
    if (ev.kind === 'step') {
      session.nowPlaying[ev.voice] = ev;
      if (ev.patternRestart) flash.pattern[ev.voice] = now + 110;
      (['rhythm', 'legato', 'accent'] as const).forEach((k) => ev.cycleRestart[k] && (flash.cycle[k][ev.voice] = now + 110));
      flash.notes[ev.voice] = { pitches: ev.pitches, until: now + Math.max(60, Math.min(200, ev.interval * 3)), step: ev.stepIndex };
    } else if (ev.kind === 'on') {
      monitorWin.push(`▸ ${ev.channel.toString().padStart(2)} on  ${noteName(ev.pitch).padEnd(4)} ${ev.velocity}  v${ev.voice + 1}`);
    } else if (ev.kind === 'program') {
      monitorWin.push(`▸ ${ev.channel.toString().padStart(2)} pgm ${ev.program}`);
    }
  }
  if (i) vis.splice(0, i);
  // incoming MIDI
  for (const l of session.log.splice(0)) monitorWin.push('◂ ' + l.text);
  return changed;
}

const perf = { frames: 0, total: 0, max: 0 };
(window as unknown as { emmmPerf: unknown }).emmmPerf = perf;
let lastStatus = '';
function frame(): void {
  const now = performance.now();
  // mouse advance gate: moving within the last 90 ms with Caps Lock or ⌘⌥
  const active = now - lastMove < 90;
  if (active !== session.engine.mouseAdvanceActive) session.changed('mouse');
  session.setMouseAdvance(active, speed);
  const vis = consumeVisual(now);
  const flashing = flash.pattern.some((t) => t > now - 50) || flash.notes.some((n) => n.until > now - 50);
  if (session.dirty || vis || flashing || session.playing) {
    const t0 = performance.now();
    session.dirty = false;
    for (const m of main) m.update();
    for (const f of floating) if (f.win.open) f.update();
    const dt = performance.now() - t0;
    perf.frames++;
    perf.total += dt;
    perf.max = Math.max(perf.max, dt);
  }
  const o = session.comp.midi.outputs[0];
  const outName = !o.port ? 'no output' : o.port === 'monitor' ? 'monitor' : session.midi.portName(o.port);
  const st = `${session.comp.extended.enabled ? 'EXT  ' : ''}${session.hold ? 'HOLD  ' : ''}${session.playing ? '▶' : session.engine.state === 'paused' ? '❚❚' : '■'}|→ ${outName}${session.monitorAll && o.port !== 'monitor' ? ' + monitor' : ''}`;
  if (st !== lastStatus) {
    const [a, b] = st.split('|');
    statusEl.textContent = a;
    outEl.textContent = b;
    lastStatus = st;
  }
  if (saveDirty && now - lastSave > 1500) {
    autosave(session.comp);
    lastSave = now;
    saveDirty = false;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// unlock audio on first gesture; ask for MIDI
window.addEventListener('pointerdown', () => session.monitor.unlock(), { once: true });
void session.midi.request().then((st) => {
  // With no MIDI outputs at all, route output channels to the internal monitor so a first
  // visit is audible; once a device appears the user chooses it in Midi Assignment.
  const unassigned = session.comp.midi.outputs.every((o) => !o.port);
  if (unassigned) {
    const outs = session.midi.outputs();
    session.comp.midi.outputs.forEach((o, i) => {
      o.port = outs.length ? outs[0].id : 'monitor';
      o.channel = i + 1;
    });
    session.changed('midi');
  }
  if (st === 'unsupported' || st === 'denied') {
    let shown = false;
    try {
      shown = sessionStorage.getItem('emmm.midiNotice') === '1';
      sessionStorage.setItem('emmm.midiNotice', '1');
    } catch {
      /* ignore */
    }
    if (!shown)
      alertBox(
        st === 'unsupported'
          ? 'This browser has no Web MIDI, so emmm cannot reach MIDI hardware here. It will play through its internal monitor instead. For MIDI, use Chrome, Edge, Opera or Firefox.'
          : 'MIDI access was not granted, so emmm will play through its internal monitor. Allow MIDI for this site, then use <b>File ▸ Midi Assignment…</b> ▸ Request MIDI.',
      );
  }
});
window.addEventListener('beforeunload', () => autosave(session.comp));

// palette control for automation / testing (the Palette window is the user interface)
(window as unknown as { emmmPalette: unknown }).emmmPalette = {
  library: palettes,
  select(id: string) {
    applyPalette(palettes.select(id).colors);
    paletteWin.refresh();
  },
};
