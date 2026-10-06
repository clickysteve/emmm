/**
 * The six always-open windows of M's main screen (S1 ch.2 "Screen Layout"):
 * Patterns, Conducting, Variables, Cyclic Variables, Midi and Snapshot.
 */
import { NOTE_VALUES, NUM_SNAPSHOTS } from '../engine/constants';
import { clearContinuous } from '../engine/conducting';
import { SNAPSHOT_LETTERS } from '../engine/snapshots';
import type { ArrowDir, ConductTarget, UseMode, VariableName } from '../engine/types';
import { VariableChoice } from './choice';
import { VAR_LABEL, type UiContext } from './context';
import { clamp, el, label, localPoint, setTip, svgEl, setSvg, trackDrag } from './dom';
import { iconSvg, noteValueIcon } from './icons';
import { timingControls } from './patternControls';
import { ConductArrow, MWindow, Numerical, RangeBar, pictureMatrix } from './widgets';

export interface Updatable {
  update(): void;
  win: MWindow;
}

function arrowFor(ctx: UiContext, parent: HTMLElement, x: number, y: number, target: ConductTarget, h = 13): ConductArrow {
  const s = ctx.s;
  const cont =
    target === 'velocityRange' || target === 'legato'
      ? {
          get: () => {
            const c = target === 'velocityRange' ? s.comp.conducting.continuousVelocity : s.comp.conducting.continuousLegato;
            return { on: s.comp.conducting.continuousMode[target], dirs: c.dirs, voices: c.voices };
          },
          setOn: (on: boolean) => {
            s.comp.conducting.continuousMode[target] = on;
            s.changed('arrows');
          },
          setDir: (v: number, d: ArrowDir) => {
            (target === 'velocityRange' ? s.comp.conducting.continuousVelocity : s.comp.conducting.continuousLegato).dirs[v] = d;
            s.changed('arrows');
          },
          toggleVoice: (v: number) => {
            const c = target === 'velocityRange' ? s.comp.conducting.continuousVelocity : s.comp.conducting.continuousLegato;
            c.voices[v] = !c.voices[v];
            if (!c.voices[v]) c.values[v] = null;
            s.changed('arrows');
          },
        }
      : undefined;
  return new ConductArrow(
    parent,
    x,
    y,
    {
      get: () => s.comp.conducting.arrows[target],
      toggle: () => s.toggleArrow(target),
      setDir: (d) => {
        s.comp.conducting.arrows[target].dir = d;
        s.changed('arrows');
      },
      continuous: cont,
      blink: () => !!s.hold?.pending.arrows[target],
    },
    h,
  );
}

// ============================================================================ Patterns

const USE_ITEMS: { value: UseMode; icon: string; title: string }[] = [
  { value: 'off', icon: iconSvg('dash'), title: 'Disable' },
  { value: 'record', icon: iconSvg('R'), title: 'Record' },
  { value: 'control', icon: iconSvg('C'), title: 'Input Control System' },
  { value: 'transpose', icon: iconSvg('sharpflat'), title: 'Keyboard Transpose' },
  { value: 'echomap', icon: iconSvg('echomap'), title: 'Echo Map Enable' },
];

export class PatternsWindow implements Updatable {
  win: MWindow;
  private rows: {
    src: Numerical;
    use: HTMLDivElement;
    play: HTMLDivElement;
    echo: HTMLDivElement;
    mouse: HTMLDivElement;
    select: HTMLDivElement;
    modeIcons: HTMLDivElement[];
    len: Numerical;
    num: Numerical;
    den: Numerical;
    phase: Numerical;
    step: HTMLDivElement;
    lock: HTMLDivElement;
  }[] = [];
  private echoCells: HTMLDivElement[] = [];

  constructor(private ctx: UiContext, parent: HTMLElement) {
    const s = ctx.s;
    this.win = new MWindow(parent, { id: 'patterns', title: 'Patterns a', x: 6, y: 22, w: 272, h: 112, area: 'patterns' });
    const b = this.win.body;
    // Echo Map in the title area: two rows of channel numbers (S1 ch.11)
    const tb = this.win.el.querySelector('.titlebar') as HTMLDivElement;
    const em = el('div', '', tb, [150, 0, 120, 15]);
    em.style.position = 'absolute';
    em.style.background = 'var(--paper)';
    const emi = el('div', '', em, [0, 1, 14, 13]);
    emi.style.position = 'absolute';
    emi.innerHTML = iconSvg('echomap', 13, 13);
    emi.title = 'Echo Map';
    for (let i = 0; i < 16; i++) {
      const c = el('div', 'label tiny', em, [17 + (i % 8) * 12.5, i < 8 ? 1 : 8, 12, 7], String(i + 1));
      c.style.textAlign = 'center';
      c.title = `Echo Map: output channel ${i + 1}`;
      c.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        s.comp.echoMap[i] = !s.comp.echoMap[i];
        s.changed('echomap');
      });
      this.echoCells.push(c);
    }
    // column headings
    const hy = 2;
    label(b, 3, hy, 'Src');
    label(b, 26, hy, 'Use').style.fontSize = '8px';
    const hp = el('div', '', b, [40, 0, 14, 12]);
    hp.style.position = 'absolute';
    hp.innerHTML = iconSvg('speaker', 12, 12);
    hp.title = 'Play-Enable';
    const he = el('div', '', b, [54, 0, 14, 12]);
    he.style.position = 'absolute';
    he.innerHTML = iconSvg('orchMini', 12, 12);
    he.title = 'Echo-Thru-Orchestration';
    const hm = el('div', '', b, [68, 0, 14, 12]);
    hm.style.position = 'absolute';
    hm.innerHTML = iconSvg('mouse', 12, 12);
    hm.title = 'Mouse Advance';
    label(b, 100, hy, 'Select');
    const hl = el('div', '', b, [160, 0, 14, 12]);
    hl.style.position = 'absolute';
    hl.innerHTML = iconSvg('timebase', 12, 12);
    hl.title = 'Output Length';
    const hc = el('div', '', b, [200, 0, 14, 12]);
    hc.style.position = 'absolute';
    hc.innerHTML = iconSvg('clock', 12, 12);
    hc.title = 'Time Base';
    const hph = el('div', '', b, [244, 0, 14, 12]);
    hph.style.position = 'absolute';
    hph.innerHTML = iconSvg('phase', 12, 12);
    hph.title = 'Phase';
    // grid lines
    const grid = el('div', 'box', b, [0, 13, 270, 1]);
    grid.style.borderWidth = '1px 0 0 0';
    for (let v = 0; v < 4; v++) {
      const y = 15 + v * 19;
      const H = 18;
      const pat = () => s.pattern(v);
      const hold = (k: 'src' | 'outputLength' | 'tbNum' | 'tbDen' | 'phase') => (ev: PointerEvent) => {
        if (!s.hold) return false;
        ev.preventDefault();
        s.holdVoiceItem(v, k);
        return true;
      };
      const src = new Numerical(b, 1, y, 25, H, {
        get: () => s.comp.voices[v].src,
        set: (x) => s.setVoice(v, 'src', x),
        min: 0,
        max: 16,
        format: (x) => (x === 0 ? 'All' : String(x)),
        chars: 'al',
        parse: (t) => (/^a/i.test(t) ? 0 : /^\d+$/.test(t) ? Number(t) : null),
        intercept: hold('src'),
        title: 'Source Channel (M Input Channel; 0 or "a" = All)',
      });
      const use = el('div', 'num', b, [26, y, 14, H]);
      use.title = 'Use: how MIDI input affects this voice';
      use.addEventListener('pointerdown', (ev) =>
        pictureMatrix(use, ev, USE_ITEMS, s.comp.voices[v].use, (val) => s.setVoice(v, 'use', val)),
      );
      const toggle = (x: number, k: 'playEnable' | 'echoThru' | 'mouseAdvance', title: string) => {
        const t = el('div', 'num', b, [x, y, 14, H]);
        t.title = title;
        t.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          s.setVoice(v, k, !s.comp.voices[v][k]);
          // drag across the column to set several voices the same way (S1 ch.4)
          const val = s.comp.voices[v][k];
          trackDrag(ev, t, ({ ev: e }) => {
            const p = localPoint(b, e);
            const vv = clamp(Math.floor((p.y - 15) / 19), 0, 3);
            if (s.comp.voices[vv][k] !== val && !s.hold) s.setVoice(vv, k, val);
          });
        });
        return t;
      };
      const play = toggle(40, 'playEnable', 'Play-Enable');
      const echo = toggle(54, 'echoThru', 'Echo-Thru-Orchestration');
      const mouse = toggle(68, 'mouseAdvance', 'Mouse Advance');
      // Select box with three record-mode icons
      const select = el('div', 'num', b, [84, y, 70, H]);
      select.style.borderLeftWidth = '2px';
      select.title = 'Select (click) · Pattern Editor (double-click) · Alt-click an icon for record modes';
      const modeIcons: HTMLDivElement[] = [];
      for (let k = 0; k < 3; k++) {
        const m = el('div', '', select, [4 + k * 20, 2, 14, 13]);
        m.style.position = 'absolute';
        modeIcons.push(m);
        m.addEventListener('pointerdown', (ev) => {
          if (!ev.altKey) return;
          ev.stopPropagation();
          const p = pat();
          if (k === 0)
            pictureMatrix(m, ev, [
              { value: 'single', icon: iconSvg('note'), title: 'Single Note' },
              { value: 'chord', icon: iconSvg('chord'), title: 'Chord' },
              { value: 'build', icon: iconSvg('plus'), title: 'Build' },
            ], p.chordMode, (val) => ((p.chordMode = val as typeof p.chordMode), s.changed('patterns')));
          else if (k === 1)
            pictureMatrix(m, ev, [
              { value: 'insert', icon: iconSvg('insert'), title: 'Insert' },
              { value: 'replace', icon: iconSvg('replace'), title: 'Replace' },
              { value: 'overdub', icon: iconSvg('overdub'), title: 'Overdub' },
            ], p.insertMode, (val) => ((p.insertMode = val as typeof p.insertMode), s.changed('patterns')));
          else
            pictureMatrix(m, ev, [
              { value: false, icon: iconSvg('dash'), title: 'Drum Machine off' },
              { value: true, icon: iconSvg('repeat'), title: 'Drum Machine Record' },
            ], p.drumMachine, (val) => ((p.drumMachine = val as boolean), s.changed('patterns')));
        });
      }
      let lastSel = 0;
      select.addEventListener('pointerdown', (ev) => {
        if (ev.defaultPrevented) return;
        // the press's own time, so a busy screen cannot turn a double-click into two clicks
        const now = ev.timeStamp;
        if (now - lastSel < 350) {
          ctx.openEditor('patternEditor', { voice: v, from: select });
          lastSel = 0;
          return;
        }
        lastSel = now;
        if (ev.shiftKey) s.selected[v] = !s.selected[v];
        else s.selected = s.selected.map((_, k) => k === v && !s.selected[v]);
        // drag down the column to select several
        trackDrag(ev, select, ({ ev: e }) => {
          const p = localPoint(b, e);
          const vv = clamp(Math.floor((p.y - 15) / 19), 0, 3);
          for (let k = Math.min(v, vv); k <= Math.max(v, vv); k++) s.selected[k] = true;
          s.changed('select');
        });
        s.changed('select');
      });
      const { len, num, den, phase } = timingControls(ctx, b, () => v, { len: [156, y, 30, H], num: [188, y, 22, H], den: [214, y, 22, H], phase: [240, y, 28, H] }, hold);
      const step = el('div', '', select, [64, 3, 4, 11]);
      step.style.position = 'absolute';
      // EXTENDED: padlock when this Voice is locked against Mutation / Reroll
      const lock = el('div', 'lockbadge hidden', b, [148, y + 3, 12, 12]);
      lock.innerHTML = iconSvg('lock', 10, 10);
      lock.title = `Voice ${v + 1} is locked: Mutation leaves it alone and Reroll keeps its random choices`;
      this.rows.push({ src, use, play, echo, mouse, select, modeIcons, len, num, den, phase, step, lock });
    }
  }

  update(): void {
    const s = this.ctx.s;
    this.win.setTitle('Patterns ' + 'abcdef'[s.comp.patternGroup.active]);
    this.echoCells.forEach((c, i) => c.classList.toggle('inv', s.comp.echoMap[i]));
    const hold = s.hold?.pending;
    this.rows.forEach((r, v) => {
      const vs = s.comp.voices[v];
      const p = s.pattern(v);
      r.lock.classList.toggle('hidden', !(s.comp.extended.enabled && s.comp.extended.locks.voices[v]));
      r.src.update();
      r.len.update();
      r.num.update();
      r.den.update();
      r.phase.update();
      const useIcon = USE_ITEMS.find((u) => u.value === vs.use)!.icon;
      if (r.use.dataset.v !== vs.use) {
        r.use.innerHTML = useIcon;
        r.use.dataset.v = vs.use;
      }
      const setIcon = (e: HTMLDivElement, on: boolean, icon: string) => {
        const key = on ? icon : '';
        if (e.dataset.v !== key) {
          e.innerHTML = on ? iconSvg(icon) : '';
          e.dataset.v = key;
        }
      };
      setIcon(r.play, vs.playEnable, 'speaker');
      setIcon(r.echo, vs.echoThru, 'check');
      setIcon(r.mouse, vs.mouseAdvance, 'diamond');
      r.mouse.classList.toggle('inv', vs.mouseAdvance && s.engine.mouseAdvanceActive);
      const hv = hold?.voices[v] ?? {};
      r.play.classList.toggle('blink', 'playEnable' in hv);
      r.echo.classList.toggle('blink', 'echoThru' in hv);
      r.mouse.classList.toggle('blink', 'mouseAdvance' in hv);
      r.src.el.classList.toggle('blink', 'src' in hv);
      r.len.el.classList.toggle('blink', 'outputLength' in hv);
      r.num.el.classList.toggle('blink', 'tbNum' in hv);
      r.den.el.classList.toggle('blink', 'tbDen' in hv);
      r.phase.el.classList.toggle('blink', 'phase' in hv);
      const sel = s.selected[v];
      r.select.classList.toggle('inv', sel);
      r.select.classList.toggle('selected', sel);
      const c = sel ? 'var(--paper)' : 'var(--ink)';
      const icons = [{ single: 'note', chord: 'chord', build: 'plus' }[p.chordMode], p.insertMode, p.drumMachine ? 'repeat' : 'tick'];
      icons.forEach((ic, k) => {
        const key = ic + c;
        if (r.modeIcons[k].dataset.v !== key) {
          r.modeIcons[k].innerHTML = iconSvg(ic, 13, 13, c);
          r.modeIcons[k].dataset.v = key;
        }
      });
      // a tiny "now playing" tick flashes as the voice steps (emmm visual aid)
      const f = this.ctx.flash.notes[v];
      r.step.style.background = f.until > this.ctx.now() ? (sel ? 'var(--paper)' : 'var(--activity)') : 'transparent';
    });
  }
}

// ============================================================================ Conducting

export class ConductingWindow implements Updatable {
  win: MWindow;
  private btn: Record<string, HTMLDivElement> = {};
  private tempoArrow: ConductArrow;
  private tempoBar: RangeBar;
  private tempoLo: HTMLDivElement;
  private tempoHi: HTMLDivElement;
  private tempo: Numerical;
  private ratio: Numerical;
  private grid: HTMLDivElement;
  private dot: HTMLDivElement;
  private robot: HTMLDivElement;
  private hRange: RangeBar;
  private vRange: HTMLDivElement;
  private rate: Numerical;
  private seed: Numerical;

  constructor(private ctx: UiContext, parent: HTMLElement) {
    const s = ctx.s;
    this.win = new MWindow(parent, { id: 'conducting', title: 'Untitled', x: 282, y: 22, w: 330, h: 112, area: 'conducting' });
    const b = this.win.body;
    // Two transport strips with slanted separators, as on M's Conducting window.
    const strip = (y: number, items: [string, string, string, (ev: PointerEvent) => void][]) => {
      const W = 118;
      const H = 19;
      const box = el('div', 'transport', b, [2, y, W, H]);
      const cuts = [0, 40, 80, W];
      const sl = 5;
      items.forEach(([name, icon, title, fn], i) => {
        const L = cuts[i];
        const R = cuts[i + 1];
        const x0 = Math.max(0, L - sl);
        const x1 = Math.min(W, R + sl);
        const seg = el('div', 'seg', box, [x0, 0, x1 - x0]);
        const pt = (x: number, yy: number) => `${x - x0}px ${yy}px`;
        const lt = i === 0 ? pt(0, 0) : pt(L + sl, 0);
        const lb = i === 0 ? pt(0, H) : pt(L - sl, H);
        const rt = i === items.length - 1 ? pt(W, 0) : pt(R + sl, 0);
        const rb = i === items.length - 1 ? pt(W, H) : pt(R - sl, H);
        seg.style.clipPath = `polygon(${lt}, ${rt}, ${rb}, ${lb})`;
        seg.innerHTML = icon;
        seg.title = title;
        seg.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          fn(ev);
        });
        this.btn[name] = seg;
      });
      box.appendChild(svgEl(W, H, [40, 80].map((c) => `<line x1="${c + sl + 0.5}" y1="0" x2="${c - sl + 0.5}" y2="${H}" stroke="var(--ink)" stroke-width="1.2" shape-rendering="geometricPrecision"/>`).join('')));
    };
    strip(2, [
      ['start', iconSvg('play'), 'Start (Space)', () => s.start()],
      ['stop', iconSvg('stop'), 'Stop (Return)', () => s.stop()],
      ['pause', iconSvg('pause'), 'Pause (Tab)', () => s.pause()],
    ]);
    strip(22, [
      ['sync', '<span style="font-size:10px">Sync</span>', 'Sync (Shift-click in Snapshots also syncs)', () => s.sync()],
      ['movie', iconSvg('film', 18, 12), 'Movie: capture the performance', () => s.toggleMovie()],
      [
        'seq',
        iconSvg('seq', 12, 12),
        'Sequence Play-Enable',
        () => {
          if (!s.comp.sequence && !s.hold) ctx.alert('No Sequence loaded. Use File ▸ Open Midi File… and choose “Import as Sequence”.');
          else s.toggleSequence();
        },
      ],
    ]);
    // tempo
    this.tempoArrow = arrowFor(ctx, b, 2, 46, 'tempo');
    this.tempoBar = new RangeBar(b, 18, 47, 100, 11, {
      min: 20,
      max: 300,
      get: () => [s.comp.tempo.lo, s.comp.tempo.hi],
      set: (lo, hi) => s.setTempoRange(lo, hi),
      cur: () => (s.playing ? s.comp.tempo.value : null),
    });
    this.tempoLo = el('div', 'label', b, [18, 61, 22, 9]);
    this.tempoHi = el('div', 'label', b, [96, 61, 22, 9]);
    this.tempoHi.style.textAlign = 'right';
    label(b, 38, 62, 'Tempo', 'small');
    this.tempo = new Numerical(b, 64, 59, 26, 13, {
      get: () => s.comp.tempo.value,
      set: (x) => s.setTempoFree(x), // widens the range if needed (@m-uncertain U22)
      min: 20,
      max: 300,
      format: (x) => (s.tapConduct.active ? 'Tap' : String(Math.round(x))),
      title: 'Tempo',
    });
    this.ratio = new Numerical(b, 98, 75, 20, 15, {
      get: () => s.comp.syncRatio,
      set: (x) => ((s.comp.syncRatio = x), s.changed('tempo')),
      values: [1, 2, 3, 4, 6, 8, 12, 16],
      format: () => '',
      title: 'Sync / Metronome ratio',
    });
    label(b, 64, 79, '♩ → ', 'small');
    // seed (an emmm addition, deliberately unobtrusive)
    label(b, 2, 79, 'seed', 'tiny');
    this.seed = new Numerical(b, 20, 75, 40, 15, {
      get: () => s.comp.seed,
      set: (x) => s.setSeed(x),
      min: 0,
      max: 99999,
      pxPerUnit: 1,
      title: 'Random seed (emmm): identical seed + settings reproduce the same performance from Start',
    });
    this.seed.el.style.fontWeight = '400';
    this.seed.el.style.fontSize = '9px';
    // conducting grid
    this.grid = el('div', 'box c-baton', b, [126, 2, 90, 90]);
    this.grid.style.background = 'var(--paper)';
    this.grid.appendChild(
      svgEl(
        88,
        88,
        Array.from({ length: 5 }, (_, i) => {
          const p = Math.round(((i + 1) * 88) / 6) + 0.5;
          return `<line x1="${p}" y1="0" x2="${p}" y2="88" stroke="var(--dim)" stroke-dasharray="1 2"/><line x1="0" y1="${p}" x2="88" y2="${p}" stroke="var(--dim)" stroke-dasharray="1 2"/>`;
        }).join(''),
      ),
    );
    this.grid.title = 'Conducting Grid — drag the Baton (Shift quantizes, Alt-click clears continuous conducting)';
    this.dot = el('div', '', this.grid, [0, 0, 5, 5]);
    this.dot.style.position = 'absolute';
    this.dot.style.background = 'var(--activity)';
    this.dot.style.borderRadius = '50%';
    this.grid.addEventListener('pointerdown', (ev) => this.conductDown(ev));
    // robot conductor
    this.robot = el('div', 'btn', b, [222, 2, 22, 19]);
    this.robot.innerHTML = iconSvg('robot', 12, 12);
    this.robot.title = 'Automatic Conducting (Robot Conductor)';
    this.robot.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      s.comp.conducting.robot.enabled = !s.comp.conducting.robot.enabled;
      s.changed('robot');
    });
    label(b, 248, 4, 'jump', 'tiny');
    this.hRange = new RangeBar(b, 248, 12, 46, 8, {
      min: 0,
      max: 100,
      get: () => [0, Math.round(s.comp.conducting.robot.hRange * 100)],
      set: (_lo, hi) => ((s.comp.conducting.robot.hRange = hi / 100), s.changed('robot')),
      fill: 'black',
      single: true,
      label: 'Robot horizontal jump range',
    });
    this.vRange = el('div', 'range', b, [298, 2, 8, 40]);
    const vfill = el('div', 'fill inv', this.vRange);
    vfill.style.left = '0';
    vfill.style.right = '0';
    this.vRange.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      const setV = (e: PointerEvent) => {
        const p = localPoint(this.vRange, e);
        s.comp.conducting.robot.vRange = clamp(1 - p.y / p.h, 0, 1);
        s.changed('robot');
      };
      setV(ev);
      trackDrag(ev, this.vRange, ({ ev: e }) => setV(e));
    });
    this.vRange.title = 'Robot vertical jump range';
    this.hRange.el.title = 'Robot horizontal jump range';
    label(b, 248, 26, 'rate', 'tiny');
    this.rate = new Numerical(b, 268, 23, 24, 17, {
      get: () => s.comp.conducting.robot.rate,
      set: (x) => ((s.comp.conducting.robot.rate = x), s.changed('robot')),
      values: [1, 2, 4, 8],
      format: () => '',
      title: 'Robot rate (whole … eighth note)',
    });
    // status: playing tick / bar:beat (emmm aid)
    this.statusEl = el('div', 'label tiny', b, [222, 48, 100, 40]);
    this.statusEl.style.lineHeight = '9px';
  }
  private statusEl: HTMLDivElement;

  private conductDown(ev: PointerEvent): void {
    ev.preventDefault();
    const s = this.ctx.s;
    if (ev.altKey) {
      clearContinuous(s.comp);
      s.changed('baton');
      return;
    }
    const at = (e: PointerEvent, fresh: boolean) => {
      const p = localPoint(this.grid, e);
      s.conduct(clamp(p.x / p.w, 0, 0.999), clamp(1 - p.y / p.h, 0, 0.999), fresh, e.shiftKey);
    };
    at(ev, true);
    trackDrag(ev, this.grid, ({ ev: e }) => at(e, false));
  }

  update(): void {
    const s = this.ctx.s;
    this.win.setTitle(s.comp.name || 'Untitled');
    const st = s.engine.state;
    this.btn.start.classList.toggle('on', st === 'playing');
    this.btn.pause.classList.toggle('on', st === 'paused');
    this.btn.movie.classList.toggle('on', s.movieArmed || s.movieRecording);
    this.btn.movie.classList.toggle('blink', s.movieRecording);
    this.btn.sync.classList.toggle('blink', !!s.hold?.pending.sync);
    this.btn.seq.classList.toggle('on', s.comp.sequenceEnable && !!s.comp.sequence);
    this.btn.seq.classList.toggle('blink', s.hold?.pending.sequenceEnable !== undefined && !!s.hold);
    this.btn.seq.style.opacity = s.comp.sequence ? '1' : '0.45';
    setTip(this.btn.seq, s.comp.sequence ? `Sequence Play-Enable: ${s.comp.sequence.name}` : 'Sequence Play-Enable (no Sequence loaded)');
    const filmC = s.movieArmed || s.movieRecording ? 'var(--paper)' : 'var(--ink)';
    const key = 'film' + filmC;
    if (this.btn.movie.dataset.v !== key) {
      this.btn.movie.innerHTML = iconSvg('film', 18, 12, filmC);
      this.btn.movie.dataset.v = key;
    }
    const sc = st === 'playing' ? 'var(--paper)' : 'var(--ink)';
    if (this.btn.start.dataset.v !== sc) {
      this.btn.start.innerHTML = iconSvg('play', 12, 12, sc);
      this.btn.start.dataset.v = sc;
    }
    const pc = st === 'paused' ? 'var(--paper)' : 'var(--ink)';
    if (this.btn.pause.dataset.v !== pc) {
      this.btn.pause.innerHTML = iconSvg('pause', 12, 12, pc);
      this.btn.pause.dataset.v = pc;
    }
    this.tempoArrow.update();
    this.tempoBar.update();
    this.tempoLo.textContent = String(s.comp.tempo.lo);
    this.tempoHi.textContent = String(s.comp.tempo.hi);
    this.tempo.update();
    this.seed.update();
    if (this.ratio.el.dataset.v !== String(s.comp.syncRatio)) {
      this.ratio.el.innerHTML = noteValueIcon(s.comp.syncRatio, 12, 12);
      this.ratio.el.dataset.v = String(s.comp.syncRatio);
    }
    if (this.rate.el.dataset.v !== String(s.comp.conducting.robot.rate)) {
      this.rate.el.innerHTML = noteValueIcon(s.comp.conducting.robot.rate, 12, 12);
      this.rate.el.dataset.v = String(s.comp.conducting.robot.rate);
    }
    const bt = s.comp.conducting.baton;
    this.dot.style.left = Math.round(bt.x * 88 - 2) + 'px';
    this.dot.style.top = Math.round((1 - bt.y) * 88 - 2) + 'px';
    const r = s.comp.conducting.robot;
    this.robot.classList.toggle('on', r.enabled);
    const rc = r.enabled ? 'var(--paper)' : 'var(--ink)';
    if (this.robot.dataset.v !== rc) {
      this.robot.innerHTML = iconSvg('robot', 12, 12, rc);
      this.robot.dataset.v = rc;
    }
    this.hRange.update();
    const vf = this.vRange.firstChild as HTMLDivElement;
    vf.style.top = Math.round((1 - r.vRange) * 38) + 'px';
    vf.style.bottom = '0';
    const t = s.scheduler.nowTick();
    const beat = Math.floor(t / 96);
    const status = st === 'stopped' ? 'stopped' : `${Math.floor(beat / 4) + 1}:${(beat % 4) + 1}${st === 'paused' ? ' paused' : ''}`;
    const midi = s.midi.status === 'ready' ? 'midi ok' : s.midi.status === 'unsupported' ? 'no web midi' : s.midi.status === 'denied' ? 'midi denied' : 'midi …';
    const txt = `${status}\n${midi}\n${s.monitorAll ? 'monitor on' : ''}${s.scheduler.lastError ? '\nENGINE ERROR (console)' : ''}`;
    if (this.statusEl.textContent !== txt) this.statusEl.textContent = txt;
    this.statusEl.style.whiteSpace = 'pre';
  }
}

// ============================================================================ Variables

const VAR_ROWS: VariableName[] = ['patternGroup', 'noteDensity', 'velocityRange', 'noteOrder', 'transposition', 'timeDistortion'];

export class VariablesWindow implements Updatable {
  win: MWindow;
  private choices: VariableChoice[] = [];
  private arrows: ConductArrow[] = [];
  constructor(ctx: UiContext, parent: HTMLElement) {
    this.win = new MWindow(parent, { id: 'variables', title: 'Variables', x: 6, y: 140, w: 298, h: 222, area: 'variables' });
    const b = this.win.body;
    VAR_ROWS.forEach((v, i) => {
      const y = 3 + i * 33.5;
      const lab = label(b, 2, y + 7, VAR_LABEL[v], 'small');
      lab.style.width = '40px';
      lab.style.textAlign = 'right';
      this.arrows.push(arrowFor(ctx, b, v === 'velocityRange' ? 44 : 48, y + (v === 'velocityRange' ? 0 : 8), v, v === 'velocityRange' ? 30 : 13));
      this.choices.push(new VariableChoice(ctx, b, v, 66, y, 38, 31));
    });
  }
  update(): void {
    this.choices.forEach((c) => c.update());
    this.arrows.forEach((a) => a.update());
  }
}

// ============================================================================ Cyclic Variables

const CYC: VariableName[] = ['rhythm', 'legato', 'accent'];

export class CyclicWindow implements Updatable {
  win: MWindow;
  private choices: VariableChoice[] = [];
  private arrows: ConductArrow[] = [];
  constructor(ctx: UiContext, parent: HTMLElement) {
    this.win = new MWindow(parent, { id: 'cyclic', title: 'Cyclic Variables', x: 310, y: 140, w: 302, h: 222, area: 'cyclic' });
    const b = this.win.body;
    CYC.forEach((v, i) => {
      const x = 3 + i * 99;
      label(b, x + 2, 4, VAR_LABEL[v]);
      this.arrows.push(arrowFor(ctx, b, x + 72, v === 'legato' ? 0 : 1, v, v === 'legato' ? 17 : 13));
      this.choices.push(new VariableChoice(ctx, b, v, x, 19, 96, 31, true));
    });
  }
  update(): void {
    this.choices.forEach((c) => c.update());
    this.arrows.forEach((a) => a.update());
  }
}

// ============================================================================ Midi

export class MidiWindow implements Updatable {
  win: MWindow;
  private orch: VariableChoice;
  private orchArrow: ConductArrow;
  private scArrow: ConductArrow;
  private scCells: HTMLDivElement[] = [];
  private progs: Numerical[] = [];
  constructor(private ctx: UiContext, parent: HTMLElement) {
    const s = ctx.s;
    this.win = new MWindow(parent, { id: 'midi', title: 'Midi', x: 6, y: 368, w: 606, h: 96, area: 'midi' });
    const b = this.win.body;
    const l1 = label(b, 2, 8, VAR_LABEL.orchestration, 'small');
    l1.style.width = '40px';
    l1.style.textAlign = 'right';
    this.orchArrow = arrowFor(ctx, b, 48, 9, 'orchestration');
    this.orch = new VariableChoice(ctx, b, 'orchestration', 66, 1, 70, 31);
    const l2 = label(b, 2, 46, VAR_LABEL.soundChoice, 'small');
    l2.style.width = '40px';
    l2.style.textAlign = 'right';
    this.scArrow = arrowFor(ctx, b, 48, 47, 'soundChoice');
    for (let i = 0; i < 16; i++) {
      const x = 66 + i * 33;
      const c = el('div', 'num', b, [x, 37, 34, 14], String(i + 1));
      c.title = `Sound Choice Position ${i + 1} — the program numbers below are sent on M Output Channels 1–16`;
      c.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        s.clickPosition('soundChoice', i, { shift: ev.shiftKey });
      });
      this.scCells.push(c);
      const ch = i + 1;
      // Numerical for output channel `ch` in the *active* Sound Choice Position
      const n = new Numerical(b, x, 50, 34, 26, {
        get: () => {
          const v = s.comp.soundChoice.positions[s.comp.soundChoice.active][ch - 1];
          return v === null ? -1 : v;
        },
        set: (x, info) => s.setProgram(s.comp.soundChoice.active, ch, x < 0 ? null : x, info.final),
        min: -1,
        max: 127,
        format: (x) => (x < 0 ? '' : String(x + (s.comp.midi.firstProgramIsOne[ch - 1] ? 1 : 0))),
        // typed as shown (1–128 or 0–127 for this channel); "-" = no program change
        parse: (t) => {
          if (t === '-') return -1;
          if (!/^\d+$/.test(t)) return null;
          const p = Number(t) - (s.comp.midi.firstProgramIsOne[ch - 1] ? 1 : 0);
          return p >= 0 && p <= 127 ? p : null;
        },
        editText: (x) => (x < 0 ? '-' : String(x + (s.comp.midi.firstProgramIsOne[ch - 1] ? 1 : 0))),
        title: `Program change for output channel ${ch} (blank = none; type - for none). Sent when released.`,
      });
      this.progs.push(n);
    }
  }
  update(): void {
    const s = this.ctx.s;
    this.orch.update();
    this.orchArrow.update();
    this.scArrow.update();
    const pend = s.hold?.pending.positions.soundChoice;
    this.scCells.forEach((c, i) => {
      c.classList.toggle('inv', i === s.comp.soundChoice.active);
      c.classList.toggle('blink', pend === i);
    });
    this.progs.forEach((p) => p.update());
  }
}

// ============================================================================ Snapshot

export class SnapshotWindow implements Updatable {
  win: MWindow;
  private slots: HTMLDivElement[] = [];
  private shows: HTMLDivElement[] = [];
  private holdBtn: HTMLDivElement;
  private arrow: ConductArrow;
  private quant: Numerical;
  private ctl: Record<string, HTMLDivElement> = {};
  constructor(private ctx: UiContext, parent: HTMLElement) {
    const s = ctx.s;
    this.win = new MWindow(parent, { id: 'snapshot', title: 'Snap', x: 618, y: 22, w: 96, h: 442, area: 'snapshots' });
    const b = this.win.body;
    this.holdBtn = el('div', 'btn', b, [2, 2, 90, 24]);
    this.holdBtn.innerHTML = iconSvg('camera', 18, 14) + '&nbsp;' + iconSvg('slides', 14, 12);
    this.holdBtn.title = 'Hold/Do (Backspace)';
    this.holdBtn.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      s.holdDo(ev.shiftKey);
    });
    this.arrow = arrowFor(ctx, b, 2, 29, 'snapshot');
    this.quant = new Numerical(b, 17, 28, 26, 15, {
      get: () => s.comp.quantization,
      set: (x) => ((s.comp.quantization = x), s.changed('quant')),
      values: [0, ...NOTE_VALUES.filter((x) => x <= 16)],
      format: () => '',
      title: 'Snapshot Quantization (wave = none)',
    });
    // slideshow controls
    const ctl = (name: string, x: number, icon: string, title: string, fn: (ev: PointerEvent) => void) => {
      const d = el('div', 'btn', b, [x, 28, 16, 15]);
      d.innerHTML = icon;
      d.title = title;
      d.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        fn(ev);
      });
      this.ctl[name] = d;
    };
    ctl('stop', 45, iconSvg('stop', 10, 10), 'Slideshow Stop (0)', () => s.stopSlideshow());
    ctl('pause', 60, iconSvg('pause', 10, 10), 'Slideshow Pause', () => s.pauseSlideshow());
    ctl('loop', 75, iconSvg('loop', 10, 10), 'Slideshow Loop (\\) — Alt removes the loop', (ev) => s.loopSlideshow(ev.altKey));
    for (let i = 0; i < NUM_SNAPSHOTS; i++) {
      const col = i < 13 ? 0 : 1;
      const row = i % 13;
      const c = el('div', 'num', b, [2 + col * 29, 46 + row * 22, 30, 23]);
      c.title = `Snapshot ${SNAPSHOT_LETTERS[i]} (Shift: force Sync)`;
      c.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        s.clickSnapshot(i, { shift: ev.shiftKey });
      });
      this.slots.push(c);
    }
    for (let i = 0; i < 9; i++) {
      const c = el('div', 'num', b, [62, 46 + i * 22, 30, 23]);
      c.title = `Slideshow ${i + 1} (Alt-click: record)`;
      c.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        s.clickSlideshow(i, { alt: ev.altKey });
      });
      this.shows.push(c);
    }
    const tool = (x: number, y: number, w: number, h: number, icon: string, title: string, fn: () => void) => {
      const d = el('div', 'btn', b, [x, y, w, h]);
      d.innerHTML = icon;
      d.title = title;
      d.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        fn();
      });
      return d;
    };
    tool(62, 248, 30, 20, iconSvg('pencil', 16, 15), 'Edit Snapshot', () => s.editSnapshot());
    tool(62, 267, 30, 20, iconSvg('restore', 16, 14), 'Restore From Snapshot', () => s.restoreFromSnapshot());
    tool(62, 286, 30, 46, iconSvg('globe', 18, 18), 'Blink Everything', () => s.blinkEverything());
    label(b, 4, 342, 'emmm', '');
    label(b, 4, 354, 'classic', 'tiny');
  }

  update(): void {
    const s = this.ctx.s;
    this.holdBtn.classList.toggle('blink', !!s.hold);
    this.arrow.update();
    if (this.quant.el.dataset.v !== String(s.comp.quantization)) {
      this.quant.el.innerHTML = s.comp.quantization ? noteValueIcon(s.comp.quantization, 12, 12) : iconSvg('wave', 12, 12);
      this.quant.el.dataset.v = String(s.comp.quantization);
    }
    this.slots.forEach((c, i) => {
      const has = !!s.comp.snapshots[i];
      const cur = s.currentSnapshot === i;
      const key = `${has}${cur}`;
      if (c.dataset.v !== key) {
        // "a picture of the letter posing in the sun"; the current snapshot has a mark in its sun
        const rays = [0, 45, 90, 135, 180, 225, 270, 315]
          .map((a) => {
            const r = (a * Math.PI) / 180;
            return `<line x1="${21 + Math.cos(r) * 5}" y1="${6 + Math.sin(r) * 5}" x2="${21 + Math.cos(r) * 7}" y2="${6 + Math.sin(r) * 7}" stroke="var(--ink)"/>`;
          })
          .join('');
        c.innerHTML = has
          ? `<svg width="28" height="21" viewBox="0 0 28 21" shape-rendering="crispEdges">${rays}<circle cx="21" cy="6" r="3.5" fill="${cur ? 'var(--ink)' : 'var(--paper)'}" stroke="var(--ink)"/><rect x="0" y="18" width="28" height="3" fill="url(#snapg)"/><text x="3" y="16" font-size="13" font-weight="700" font-family="Tiny5, sans-serif" fill="var(--ink)">${SNAPSHOT_LETTERS[i]}</text><defs><pattern id="snapg" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="1" height="1"/><rect x="1" y="1" width="1" height="1"/></pattern></defs></svg>`
          : '';
        c.dataset.v = key;
      }
      c.style.position = 'absolute';
      c.classList.toggle('blink', !!s.hold && s.hold.mode === 'edit' && s.currentSnapshot === i);
    });
    this.shows.forEach((c, i) => {
      const show = s.comp.slideshows[i];
      const rec = s.slideshowRec?.index === i;
      const play = s.slideshowPlay?.index === i;
      const txt = rec ? `●${i + 1}` : play ? `▶${i + 1}` : show ? (show.loopLength ? `‖${i + 1}:` : String(i + 1)) : '';
      if (c.textContent !== txt) c.textContent = txt;
      c.classList.toggle('inv', rec || play);
    });
    this.ctl.pause.classList.toggle('on', !!s.slideshowRec && s.slideshowRec.start === null || !!s.slideshowPlay?.paused || !!s.slideshowPlay?.waiting);
  }
}

export { setSvg };
