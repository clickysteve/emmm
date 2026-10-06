/**
 * Performance Feedback (Extended, Options ▸ Performance Feedback): a small inspector that
 * shows what M just decided for each Voice — which step, which source note, whether Note
 * Density let it through, the transposition, the Rhythm / Legato / Accent levels picked,
 * the velocity and the output channels — plus the active Positions, Locks and A/B state.
 *
 * It only reads the step events the engine already produces (Session.nowPlaying), redraws
 * at most ~12 times a second and only while open, so it costs MIDI timing nothing.
 */
import { noteName } from '../engine/constants';
import { LOCK_DIMS } from '../extended/extended';
import type { UiContext } from './context';
import { el } from './dom';
import { MWindow } from './widgets';

const POS_KEYS = [
  ['noteDensity', 'ND'],
  ['velocityRange', 'VR'],
  ['noteOrder', 'NO'],
  ['transposition', 'TR'],
  ['timeDistortion', 'TD'],
  ['rhythm', 'R'],
  ['legato', 'L'],
  ['accent', 'A'],
  ['orchestration', 'OR'],
] as const;

const SCHEME = { original: 'ORIG', cyclic: 'CYC', utterly: 'RND' } as Record<string, string>;

export class FeedbackWindow {
  win: MWindow;
  private head: HTMLDivElement;
  private rows: HTMLDivElement[] = [];
  private foot: HTMLDivElement;
  private last = 0;
  private lastKey = '';

  constructor(private ctx: UiContext, parent: HTMLElement) {
    this.win = new MWindow(parent, { id: 'feedback', title: 'Performance Feedback', x: 300, y: 330, w: 412, h: 132, closable: true });
    const b = this.win.body;
    const mono = (y: number, h = 10) => {
      const d = el('div', 'label tiny', b, [6, y, 400, h]);
      d.style.whiteSpace = 'pre';
      d.style.color = 'var(--ink)';
      d.style.fontSize = '7px';
      d.style.lineHeight = '9px';
      return d;
    };
    this.head = mono(3, 20);
    const cols = mono(24);
    cols.textContent = 'V  STEP      ORDER  SOURCE→OUT   DENSITY  TRANS  R L A   VEL  CHANNELS';
    cols.style.color = 'var(--dim)';
    for (let v = 0; v < 4; v++) {
      const r = mono(36 + v * 13, 12);
      r.setAttribute('aria-live', 'off');
      this.rows.push(r);
    }
    this.foot = mono(92, 18);
  }

  update(): void {
    const now = performance.now();
    if (now - this.last < 80) return; // ≤ 12 redraws a second
    this.last = now;
    const s = this.ctx.s;
    const c = s.comp;
    const key = String(s.rev) + s.nowPlaying.map((e) => e?.tick ?? -1).join();
    if (key === this.lastKey) return;
    this.lastKey = key;
    const pos = POS_KEYS.map(([k, n]) => `${n}${(c[k] as { active: number }).active + 1}`).join(' ');
    this.head.textContent = `GROUP ${'abcdef'[c.patternGroup.active]}   ${pos}\n${s.engine.state.toUpperCase()}  TEMPO ${c.tempo.value.toFixed(c.tempo.value % 1 ? 1 : 0)}  SEED ${c.seed}`;
    for (let v = 0; v < 4; v++) {
      const ev = s.nowPlaying[v];
      const p = s.pattern(v);
      const vs = c.voices[v];
      let t = `${v + 1}  `;
      if (!ev) t += vs.playEnable ? '—' : 'MUTED';
      else {
        const src = ev.stepIndex >= 0 ? p.steps[ev.stepIndex] ?? [] : [];
        const step = `#${ev.stepIndex + 1}/${p.outputLength}`.padEnd(10);
        const order = (SCHEME[ev.scheme] ?? ev.scheme).padEnd(7);
        const srcTxt = src.length ? src.slice(0, 2).map(noteName).join('+') + (src.length > 2 ? '…' : '') : 'rest';
        const outTxt = ev.played ? ev.pitches.slice(0, 2).map(noteName).join('+') : '';
        const io = (outTxt ? `${srcTxt}→${outTxt}` : srcTxt).padEnd(13);
        const verdict = !src.length ? 'REST' : !vs.playEnable ? 'MUTE' : ev.levels.accent === 0 ? 'ACC 0' : ev.played ? 'PASS' : 'SKIP';
        const tr = ev.played && src.length ? ev.pitches[0] - src[0] : null;
        const trTxt = tr === null ? '' : tr > 0 ? `+${tr}` : String(tr);
        const lv = `${ev.levels.rhythm} ${ev.levels.legato} ${ev.levels.accent}`;
        const vel = ev.played ? String(ev.velocity) : '';
        const ch = ev.played ? c.orchestration.positions[c.orchestration.active][v].join(' ') : '';
        t += `${step}${order}${io}${verdict.padEnd(9)}${trTxt.padEnd(7)}${lv.padEnd(8)}${vel.padEnd(5)}${ch}`;
      }
      if (this.rows[v].textContent !== t) this.rows[v].textContent = t;
    }
    const ext = c.extended;
    let f = '';
    if (ext.enabled) {
      const locks = [...ext.locks.voices.map((l, i) => (l ? `V${i + 1}` : '')).filter(Boolean), ...LOCK_DIMS.filter((d) => ext.locks.dims[d.id]).map((d) => d.label.toUpperCase())];
      f = `LOCKS ${locks.length ? locks.join(' ') : 'none'}   MUTATION ${ext.mutation.amount} (#${ext.mutation.count})   A/B ${ext.ab.a ? 'A' : '-'}${ext.ab.b ? 'B' : '-'}${ext.ab.last ? ' now ' + ext.ab.last.toUpperCase() : ''}`;
      if (s.status) f += `\n${s.status}`;
    } else f = 'Extended is off (Locks, Mutation and A/B live in the Extended window).';
    if (this.foot.textContent !== f) this.foot.textContent = f;
  }
}
