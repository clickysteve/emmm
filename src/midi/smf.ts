/**
 * Standard MIDI File writing (Movies, M-BEHAVIOUR §17) and reading (import into Patterns).
 */
import { TICKS_PER_QUARTER } from '../engine/constants';
import type { Step } from '../engine/types';

export interface MovieEvent {
  /** master tick (96 ppq) */
  tick: number;
  data: number[];
}
export interface TempoChange {
  tick: number;
  bpm: number;
}

function vlq(n: number): number[] {
  n = Math.max(0, Math.round(n));
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return bytes;
}

const str = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];

/** Format-0 SMF at 96 ppq (M's own resolution), with a tempo map. */
export function writeSmf(events: MovieEvent[], tempos: TempoChange[], name = 'emmm movie'): Uint8Array {
  type E = { tick: number; bytes: number[]; order: number };
  const all: E[] = [];
  const nameBytes = str(name);
  all.push({ tick: 0, bytes: [0xff, 0x03, ...vlq(nameBytes.length), ...nameBytes], order: 0 });
  for (const t of tempos) {
    const us = Math.round(60000000 / t.bpm);
    all.push({ tick: t.tick, bytes: [0xff, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255], order: 1 });
  }
  // note-offs before note-ons at the same tick
  for (const e of events) all.push({ tick: e.tick, bytes: e.data, order: (e.data[0] & 0xf0) === 0x80 ? 2 : 3 });
  all.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const track: number[] = [];
  let last = 0;
  for (const e of all) {
    const t = Math.round(e.tick);
    track.push(...vlq(Math.max(0, t - last)), ...e.bytes);
    last = Math.max(last, t);
  }
  track.push(0, 0xff, 0x2f, 0);
  return new Uint8Array([...str('MThd'), ...u32(6), ...u16(0), ...u16(1), ...u16(TICKS_PER_QUARTER), ...str('MTrk'), ...u32(track.length), ...track]);
}

export interface SmfNote {
  /** time in quarter notes */
  beat: number;
  durBeats: number;
  channel: number; // 1..16
  pitch: number;
  velocity: number;
}

export interface ParsedSmf {
  ppq: number;
  notes: SmfNote[];
}

/** Read notes from an SMF (format 0 or 1). Tempo is ignored: we keep musical (beat) time. */
export function readSmf(buf: Uint8Array): ParsedSmf {
  let p = 0;
  const rd = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 8) | buf[p++];
    return v >>> 0;
  };
  const tag = () => String.fromCharCode(buf[p++], buf[p++], buf[p++], buf[p++]);
  if (tag() !== 'MThd') throw new Error('Not a MIDI file');
  const hlen = rd(4);
  const hstart = p;
  rd(2);
  const ntrks = rd(2);
  const division = rd(2);
  if (division & 0x8000) throw new Error('SMPTE time division is not supported');
  const ppq = division;
  p = hstart + hlen;
  const notes: SmfNote[] = [];
  for (let t = 0; t < ntrks && p < buf.length; t++) {
    if (tag() !== 'MTrk') break;
    const len = rd(4);
    const end = p + len;
    let tick = 0;
    let running = 0;
    const open = new Map<string, { tick: number; vel: number }>();
    while (p < end) {
      let delta = 0;
      let b: number;
      do {
        b = buf[p++];
        delta = (delta << 7) | (b & 0x7f);
      } while (b & 0x80);
      tick += delta;
      let status = buf[p];
      if (status & 0x80) p++;
      else status = running;
      if (status === 0xff) {
        p++; // type
        let l = 0;
        do {
          b = buf[p++];
          l = (l << 7) | (b & 0x7f);
        } while (b & 0x80);
        p += l;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        let l = 0;
        do {
          b = buf[p++];
          l = (l << 7) | (b & 0x7f);
        } while (b & 0x80);
        p += l;
        continue;
      }
      running = status;
      const kind = status & 0xf0;
      const ch = (status & 0x0f) + 1;
      const d1 = buf[p++];
      const d2 = kind === 0xc0 || kind === 0xd0 ? 0 : buf[p++];
      const key = ch + ':' + d1;
      if (kind === 0x90 && d2 > 0) {
        open.set(key, { tick, vel: d2 });
      } else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) {
        const o = open.get(key);
        if (o) {
          notes.push({ beat: o.tick / ppq, durBeats: (tick - o.tick) / ppq, channel: ch, pitch: d1, velocity: o.vel });
          open.delete(key);
        }
      }
    }
    for (const [key, o] of open) {
      const [ch, pitch] = key.split(':').map(Number);
      notes.push({ beat: o.tick / ppq, durBeats: (tick - o.tick) / ppq, channel: ch, pitch, velocity: o.vel });
    }
    p = end;
  }
  notes.sort((a, b) => a.beat - b.beat || a.pitch - b.pitch);
  return { ppq, notes };
}

export interface ImportOptions {
  /** channels to include (1..16) */
  channels: number[];
  chord: 'single' | 'chord';
  /** 'none' = ignore gaps; 'dur' = insert rests for gaps */
  rests: 'none' | 'dur';
  /** quantization unit as note value denominator (8 = eighth) */
  quant: number;
}

/**
 * M's import into a Pattern (§17): notes closer together than the quantization unit merge
 * into a chord (Chord method); gaps of two or more units become rests when Rests = Dur.
 * [DOC rule from S1 ch.19; exact algorithm UNK.]
 */
export function notesToSteps(notes: SmfNote[], opts: ImportOptions): Step[] {
  const unit = 4 / opts.quant; // in beats
  const sel = notes.filter((n) => opts.channels.includes(n.channel));
  const steps: Step[] = [];
  let groupStart = -Infinity;
  let prevOnset = -Infinity;
  for (const n of sel) {
    if (opts.chord === 'chord' && n.beat - groupStart < unit - 1e-9 && steps.length) {
      const s = steps[steps.length - 1];
      if (!s.includes(n.pitch)) s.push(n.pitch);
      continue;
    }
    if (opts.rests === 'dur' && prevOnset > -Infinity) {
      const gapUnits = Math.round((n.beat - prevOnset) / unit);
      for (let i = 1; i < gapUnits; i++) steps.push([]);
    }
    steps.push([n.pitch]);
    groupStart = n.beat;
    prevOnset = n.beat;
  }
  return steps;
}
