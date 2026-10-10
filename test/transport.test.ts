/**
 * Transport: Stop returns to the initial position at once (distinct from Pause, which keeps
 * the place); what resets and what persists across Stop; external MIDI transport by its MIDI
 * meaning — Start (FA) from the beginning, Stop (FC) halts with the place kept, Continue (FB)
 * resumes, Song Position 0 rewinds — in Hermod+-style (play / stop-to-beginning, clock while
 * stopped) and DAW-style (stop / continue) workflows; and clock output.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '../src/app/session';
import { demoComposition } from '../src/engine/defaults';
import { MEngine, type EngineEvent, type NoteOnEvent } from '../src/engine/engine';

let sessions: Session[] = [];
afterEach(() => {
  sessions.forEach((s) => s.stop());
  sessions = [];
});
function mk(seed = 21): Session {
  const s = new Session(demoComposition(seed));
  s.comp.midi.clockIn.enabled = true;
  sessions.push(s);
  return s;
}
/** note messages handed to MIDI, and every clock-out byte */
function spy(s: Session) {
  const notes: { on: boolean; ch: number; pitch: number }[] = [];
  (s as unknown as { send: (c: number, b: number[]) => void }).send = (_c, b) => {
    const k = b[0] & 0xf0;
    if (k === 0x90 && b[2] > 0) notes.push({ on: true, ch: b[0] & 0x0f, pitch: b[1] });
    else if (k === 0x80 || (k === 0x90 && b[2] === 0)) notes.push({ on: false, ch: b[0] & 0x0f, pitch: b[1] });
  };
  const clock: string[] = [];
  (s.midi as unknown as { send: (p: string, b: number[]) => boolean }).send = (_p, b) => {
    const n = ({ 0xfa: 'start', 0xfb: 'continue', 0xfc: 'stop', 0xf2: 'spp' } as Record<number, string>)[b[0]];
    if (n) clock.push(n);
    return true;
  };
  return { notes, clock };
}
const ons = (evs: EngineEvent[]) => evs.filter((e): e is NoteOnEvent => e.kind === 'on').map((e) => `${e.tick}:${e.voice}:${e.pitch}`);
/** the state that defines "where the performance is" */
const where = (e: MEngine) => ({
  tick: e.tick,
  voices: e.voices.map((v) => ({ origin: v.origin, clock: v.clock, position: v.position, cycle: { ...v.cycle } })),
  pending: e.pendingActions().length,
});

// ---------------------------------------------------------------------------- Stop and Pause

describe('Stop returns to the initial position (distinct from Pause)', () => {
  it('Stop rewinds at once: tick 0, every Voice at its first step and cycle step (after its Phase), nothing pending', () => {
    const c = demoComposition(4);
    c.patternGroups[0].patterns[1].phase = 48;
    const e = new MEngine(c);
    e.start();
    const fresh = where(e);
    e.render(1500);
    e.schedule(1800, 'test', () => undefined);
    expect(where(e)).not.toEqual(fresh);
    e.stop();
    expect(e.state).toBe('stopped');
    expect(where(e)).toEqual(fresh);
    expect(fresh.voices[1].origin).toBe(48);
  });
  it('Start after Stop plays exactly what the first Start played (randomness re-seeded too)', () => {
    const e = new MEngine(demoComposition(6));
    e.start();
    const first = ons(e.render(2000));
    e.render(2600);
    e.stop();
    e.start();
    expect(ons(e.render(2000))).toEqual(first);
  });
  it('Pause keeps the place: no rewind, and Continue goes on exactly as if never paused', () => {
    const a = new MEngine(demoComposition(6));
    a.start();
    const whole = ons(a.render(3000));
    const b = new MEngine(demoComposition(6));
    b.start();
    const part1 = ons(b.render(1200));
    b.pause();
    const held = where(b);
    expect(held.tick).toBeGreaterThan(0);
    b.pause();
    expect(where(b)).toEqual(held);
    expect([...part1, ...ons(b.render(3000))]).toEqual(whole);
  });
  it('Stop releases everything, also the notes a Pause was holding', () => {
    const e = new MEngine(demoComposition(6));
    e.start();
    const on = e.render(300).filter((x): x is NoteOnEvent => x.kind === 'on');
    e.pause();
    const offs = e.stop().filter((x) => x.kind === 'off');
    expect(offs.length).toBeGreaterThan(0);
    expect(on.length).toBeGreaterThan(0);
  });
});

describe('Stop in the session: what resets and what persists', () => {
  it('resets: Slideshow playback, Trajectories, the Movie recording, quantized actions, the display', () => {
    const s = mk();
    spy(s);
    s.comp.extended.enabled = true;
    s.setTrajectory(0, { on: true, target: { kind: 'transpose' }, values: [0, 5], rateDen: 4 });
    s.toggleMovie();
    s.comp.quantization = 1;
    s.holdDo();
    s.clickPosition('transposition', 2);
    s.clickSnapshot(0);
    s.start();
    s.emitNow(s.engine.render(500));
    s.executeSnapshot(0); // quantized: waits for tick 768
    expect(s.pendingSnapshots()).toEqual([0]);
    expect(s.movieRecording).toBe(true);
    s.stop();
    expect(s.pendingSnapshots()).toEqual([]);
    expect(s.engine.pendingActions()).toEqual([]);
    expect(s.movieRecording).toBe(false);
    expect(s.movie.length).toBeGreaterThan(0); // the captured Movie is kept for saving
    expect(s.traj[0].index).toBeLessThanOrEqual(0);
    expect(s.engine.mod.transpose).toEqual([0, 0, 0, 0]);
    expect(s.nowPlaying.every((x) => x === null)).toBe(true);
    expect(s.visual.length).toBe(0);
    expect(s.engine.tick).toBe(0);
  });
  it('persists: active Positions, tempo, Baton, Play-Enable, the current Snapshot, a Hold/Do in progress', () => {
    const s = mk();
    spy(s);
    s.start();
    s.emitNow(s.engine.render(400));
    s.clickPosition('noteDensity', 3);
    s.comp.tempo.value = 97;
    s.conduct(0.8, 0.2, true);
    s.comp.voices[2].playEnable = false;
    s.holdDo();
    s.clickPosition('accent', 1);
    s.clickSnapshot(4);
    s.holdDo();
    s.clickPosition('rhythm', 2); // pending, still holding
    const before = { nd: s.comp.noteDensity.active, tempo: s.comp.tempo.value, baton: { ...s.comp.conducting.baton! }, pe: s.comp.voices.map((v) => v.playEnable), cur: s.currentSnapshot };
    s.stop();
    expect({ nd: s.comp.noteDensity.active, tempo: s.comp.tempo.value, baton: { ...s.comp.conducting.baton! }, pe: s.comp.voices.map((v) => v.playEnable), cur: s.currentSnapshot }).toEqual(before);
    expect(s.hold?.pending.positions.rhythm).toBe(2);
  });
  it('the keys: Return stops (back to the beginning); Space after Stop starts from the top', () => {
    const s = mk();
    spy(s);
    s.start();
    s.emitNow(s.engine.render(900));
    s.stop();
    expect(s.engine.tick).toBe(0);
    s.start();
    expect(s.engine.state).toBe('playing');
    expect(s.scheduler.nowTick()).toBe(0); // sounding from the top (the render frontier runs a few ticks ahead)
  });
});

// ---------------------------------------------------------------------------- external transport

describe('external MIDI transport: FA Start, FB Continue, FC Stop, F2 Song Position', () => {
  const clk = (s: Session, n: number, t0 = 0, bpm = 120) => {
    const per = 60000 / (bpm * 24);
    for (let i = 0; i < n; i++) s.midiIn('hermod', [0xf8], t0 + i * per);
  };
  it('Hermod+ style: clock while stopped never starts emmm; Play (FA) starts from the beginning', () => {
    const s = mk();
    spy(s);
    clk(s, 48); // "CLOCK ON STOP"
    expect(s.engine.state).toBe('stopped');
    expect(s.clockStatus(47 * (60000 / 2880) + 5)).toBe('waiting');
    s.midiIn('hermod', [0xfa], 0);
    expect(s.engine.state).toBe('playing');
    expect(s.scheduler.nowTick()).toBe(0);
  });
  it('the first clock after Start is the downbeat (tick 0), so emmm does not run a pulse ahead', () => {
    const s = mk();
    spy(s);
    s.midiIn('hermod', [0xfa], 0);
    clk(s, 25);
    expect(s.clockFollower.expectedTick()).toBe(96); // pulse 25 = one quarter note after the downbeat
  });
  it('Hermod+ style: Stop (FC) halts with notes off; Play again (FA) restarts from the beginning, the same take', () => {
    const s = mk();
    const { notes } = spy(s);
    s.midiIn('hermod', [0xfa], 0);
    const first = ons(s.engine.render(1500));
    const sounding = notes.length;
    s.midiIn('hermod', [0xfc], 1);
    expect(s.playing).toBe(false);
    expect(s.extHalted).toBe(true);
    expect(notes.length).toBeGreaterThanOrEqual(sounding); // note-offs went out
    expect(notes.slice(sounding).every((n) => !n.on)).toBe(true);
    s.midiIn('hermod', [0xfa], 2);
    expect(s.scheduler.nowTick()).toBe(0);
    expect(s.extHalted).toBe(false);
    expect(ons(s.engine.render(1500))).toEqual(first);
  });
  it('DAW style: Stop (FC) then Continue (FB) resumes from the kept place — exactly as if never stopped', () => {
    const a = mk(9);
    spy(a);
    a.midiIn('daw', [0xfa], 0);
    const whole = ons(a.engine.render(3000));
    const b = mk(9);
    spy(b);
    b.midiIn('daw', [0xfa], 0);
    const part1 = ons(b.engine.render(1400));
    b.midiIn('daw', [0xfc], 1);
    const kept = where(b.engine);
    expect(kept.tick).toBeGreaterThan(0);
    b.midiIn('daw', [0xfb], 2);
    expect(b.engine.state).toBe('playing');
    expect(where(b.engine)).toEqual(kept);
    expect([...part1, ...ons(b.engine.render(3000))]).toEqual(whole);
  });
  it('Song Position 0 then Continue (a DAW playing from the top) = from the beginning', () => {
    const s = mk(9);
    spy(s);
    s.midiIn('daw', [0xfa], 0);
    const first = ons(s.engine.render(1500));
    s.engine.render(2200);
    s.midiIn('daw', [0xfc], 1);
    s.midiIn('daw', [0xf2, 0, 0], 2);
    expect(s.engine.state).toBe('stopped');
    expect(s.engine.tick).toBe(0);
    s.midiIn('daw', [0xfb], 3);
    expect(s.engine.state).toBe('playing');
    expect(ons(s.engine.render(1500))).toEqual(first);
  });
  it('another Song Position is not located (M is not a timeline): Continue resumes where emmm stopped', () => {
    const s = mk(9);
    spy(s);
    s.midiIn('daw', [0xfa], 0);
    s.engine.render(1500);
    s.midiIn('daw', [0xfc], 1);
    const kept = where(s.engine);
    s.midiIn('daw', [0xf2, 32, 0], 2);
    s.midiIn('daw', [0xfb], 3);
    expect(where(s.engine)).toEqual(kept);
  });
  it('Continue (FB) when stopped is a Start from the beginning; Continue while playing does nothing', () => {
    const s = mk();
    spy(s);
    s.midiIn('x', [0xfb], 0);
    expect(s.engine.state).toBe('playing');
    expect(s.scheduler.nowTick()).toBe(0);
    s.engine.render(800);
    s.midiIn('x', [0xfb], 1);
    expect(s.engine.tick).toBeGreaterThan(0);
  });
  it('after a master’s Stop, Space continues and Return is emmm’s Stop (back to the beginning)', () => {
    const s = mk();
    spy(s);
    s.midiIn('x', [0xfa], 0);
    s.engine.render(900);
    s.midiIn('x', [0xfc], 1);
    const kept = s.engine.tick;
    s.pause(); // what Space does when paused
    expect(s.engine.state).toBe('playing');
    expect(s.engine.tick).toBe(kept);
    s.midiIn('x', [0xfc], 2);
    s.stop(); // Return
    expect(s.engine.state).toBe('stopped');
    expect(s.engine.tick).toBe(0);
    expect(s.extHalted).toBe(false);
  });
  it('with Start / Stop / Continue not followed, transport messages are ignored (clock still followed)', () => {
    const s = mk();
    spy(s);
    s.comp.midi.clockIn.transport = false;
    s.midiIn('x', [0xfa], 0);
    expect(s.engine.state).toBe('stopped');
    s.start();
    s.midiIn('x', [0xfc], 1);
    s.midiIn('x', [0xf2, 0, 0], 2);
    expect(s.engine.state).toBe('playing');
  });
});

// ---------------------------------------------------------------------------- clock out

describe('clock out: emmm as the master (e.g. clocking Hermod+)', () => {
  it('Start = FA; Pause = FC and Continue = FB; Stop = FC; Start after Stop = FA (never Continue)', () => {
    const s = mk();
    s.comp.midi.clockIn.enabled = false;
    const { clock } = spy(s);
    s.comp.options.sendClock = true;
    s.comp.midi.clockPort = 'hermod';
    s.start();
    s.pause();
    s.pause();
    s.stop();
    s.start();
    s.stop();
    expect(clock).toEqual(['start', 'stop', 'continue', 'stop', 'start', 'stop']);
  });
  it('a master’s Stop passes on once to the device emmm clocks', () => {
    const s = mk();
    const { clock } = spy(s);
    s.comp.options.sendClock = true;
    s.comp.midi.clockPort = 'synth';
    s.midiIn('x', [0xfa], 0);
    s.midiIn('x', [0xfc], 1);
    s.midiIn('x', [0xfb], 2);
    expect(clock).toEqual(['start', 'stop', 'continue']);
  });
});
