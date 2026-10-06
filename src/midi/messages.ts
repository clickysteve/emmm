/** MIDI message encoding. Channels are 1..16 here; bytes use 0..15. */

const ch = (c: number) => (Math.max(1, Math.min(16, c)) - 1) & 0x0f;
const b7 = (x: number) => Math.max(0, Math.min(127, Math.round(x))) & 0x7f;

export const noteOn = (c: number, pitch: number, vel: number) => [0x90 | ch(c), b7(pitch), Math.max(1, b7(vel))];
export const noteOff = (c: number, pitch: number) => [0x80 | ch(c), b7(pitch), 0];
export const programChange = (c: number, prog: number) => [0xc0 | ch(c), b7(prog)];
export const controlChange = (c: number, ctrl: number, val: number) => [0xb0 | ch(c), b7(ctrl), b7(val)];
export const allNotesOff = (c: number) => controlChange(c, 123, 0);
export const allSoundOff = (c: number) => controlChange(c, 120, 0);
export const localControl = (c: number, on: boolean) => controlChange(c, 122, on ? 127 : 0);
export const omni = (c: number, on: boolean) => controlChange(c, on ? 125 : 124, 0);
export const monoMode = (c: number) => controlChange(c, 126, 0);
export const polyMode = (c: number) => controlChange(c, 127, 0);
export const CLOCK = [0xf8];
export const START = [0xfa];
export const STOP = [0xfc];
export const CONTINUE = [0xfb];
export const SYSTEM_RESET = [0xff];

export interface ParsedMessage {
  type: 'noteon' | 'noteoff' | 'cc' | 'program' | 'other';
  channel: number; // 1..16
  data1: number;
  data2: number;
}

export function parse(data: ArrayLike<number>): ParsedMessage {
  const status = data[0] ?? 0;
  const kind = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  const d1 = data[1] ?? 0;
  const d2 = data[2] ?? 0;
  if (kind === 0x90 && d2 > 0) return { type: 'noteon', channel, data1: d1, data2: d2 };
  if (kind === 0x80 || (kind === 0x90 && d2 === 0)) return { type: 'noteoff', channel, data1: d1, data2: d2 };
  if (kind === 0xb0) return { type: 'cc', channel, data1: d1, data2: d2 };
  if (kind === 0xc0) return { type: 'program', channel, data1: d1, data2: 0 };
  return { type: 'other', channel, data1: d1, data2: d2 };
}
