import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '../src/app/session';
import { demoComposition, steps } from '../src/engine/defaults';
import { newPattern } from '../src/engine/patternOps';
import { Rng } from '../src/engine/rng';

let sessions: Session[] = [];
function mk(): Session {
  const s = new Session(demoComposition(1234));
  sessions.push(s);
  return s;
}
afterEach(() => {
  sessions.forEach((s) => s.stop());
  sessions = [];
});

/** Capture every MIDI message the session sends: [M output channel, bytes]. */
function spySend(s: Session): [number, number[]][] {
  const out: [number, number[]][] = [];
  (s as unknown as { send: (c: number, b: number[], ms: number) => void }).send = (c, b) => out.push([c, b]);
  return out;
}

describe('Hold/Do (§12)', () => {
  it('collects Position choices and performs them together', () => {
    const s = mk();
    s.holdDo();
    s.clickPosition('transposition', 3);
    s.clickPosition('noteDensity', 2);
    expect(s.comp.transposition.active).toBe(0);
    expect(s.comp.noteDensity.active).toBe(0);
    s.holdDo();
    expect(s.comp.transposition.active).toBe(3);
    expect(s.comp.noteDensity.active).toBe(2);
    expect(s.hold).toBeNull();
  });
  it('clicking a pending Position again removes it from the hold', () => {
    const s = mk();
    s.holdDo();
    s.clickPosition('transposition', 3);
    s.clickPosition('transposition', 3);
    s.holdDo();
    expect(s.comp.transposition.active).toBe(0);
  });
});

describe('Snapshots (§12)', () => {
  it('Hold then a slot stores a Snapshot; typing it recalls the Positions', () => {
    const s = mk();
    s.holdDo();
    s.clickPosition('velocityRange', 4);
    s.clickPosition('transposition', 4);
    s.clickSnapshot(2); // C
    expect(s.comp.snapshots[2]?.positions).toEqual({ velocityRange: 4, transposition: 4 });
    expect(s.currentSnapshot).toBe(2);
    expect(s.comp.transposition.active).toBe(0); // storing does not perform
    s.executeSnapshot(2);
    expect(s.comp.velocityRange.active).toBe(4);
    expect(s.comp.transposition.active).toBe(4);
  });
  it('Blink Everything captures everything; Restore From Snapshot undoes', () => {
    const s = mk();
    s.comp.accent.active = 1;
    s.comp.voices[2].playEnable = false;
    s.blinkEverything();
    s.clickSnapshot(0);
    s.comp.accent.active = 5;
    s.comp.voices[2].playEnable = true;
    s.executeSnapshot(0);
    expect(s.comp.accent.active).toBe(1);
    expect(s.comp.voices[2].playEnable).toBe(false);
    s.restoreFromSnapshot();
    expect(s.comp.accent.active).toBe(5);
    expect(s.comp.voices[2].playEnable).toBe(true);
  });
  it('Edit Snapshot loads the current snapshot as blinking items; storing copies it', () => {
    const s = mk();
    s.holdDo();
    s.clickPosition('rhythm', 2);
    s.clickSnapshot(0);
    s.editSnapshot();
    expect(s.hold?.mode).toBe('edit');
    s.clickPosition('legato', 3);
    s.clickSnapshot(5); // F = A + legato
    expect(s.comp.snapshots[5]?.positions).toEqual({ rhythm: 2, legato: 3 });
    expect(s.comp.snapshots[0]?.positions).toEqual({ rhythm: 2 });
  });
  it('Hold/Do can collect Patterns-window toggles', () => {
    const s = mk();
    s.holdDo();
    s.setVoice(1, 'playEnable', false);
    expect(s.comp.voices[1].playEnable).toBe(true);
    s.holdDo();
    expect(s.comp.voices[1].playEnable).toBe(false);
  });
});

describe('Slideshows (§12)', () => {
  it('records snapshot executions with their times and plays them back', () => {
    const s = mk();
    s.holdDo();
    s.clickPosition('transposition', 2);
    s.clickSnapshot(0);
    s.holdDo();
    s.clickPosition('transposition', 4);
    s.clickSnapshot(1);
    s.start();
    s.recordSlideshowStart(0);
    s.engine.render(100);
    s.executeSnapshot(0); // first event: timing starts here (Record Wait)
    s.engine.render(500);
    s.executeSnapshot(1);
    s.stopSlideshow();
    const show = s.comp.slideshows[0]!;
    expect(show.events.map((e) => [e.kind, Math.round(e.tick)])).toEqual([
      ['snapshot', 0],
      ['snapshot', 400],
    ]);
    s.comp.transposition.active = 0;
    s.clickSlideshow(0);
    const t0 = s.engine.tick;
    s.engine.render(t0 + 10);
    expect(s.comp.transposition.active).toBe(2);
    s.engine.render(t0 + 399);
    expect(s.comp.transposition.active).toBe(2);
    s.engine.render(t0 + 401);
    expect(s.comp.transposition.active).toBe(4);
  });
  it('a looped slideshow repeats', () => {
    const s = mk();
    s.comp.slideshows[1] = { events: [{ tick: 0, kind: 'position', variable: 'noteDensity', position: 3 }, { tick: 100, kind: 'position', variable: 'noteDensity', position: 1 }], loopLength: 200 };
    s.start();
    s.clickSlideshow(1);
    const t0 = s.engine.tick;
    s.engine.render(t0 + 150);
    expect(s.comp.noteDensity.active).toBe(1);
    s.engine.render(t0 + 210);
    expect(s.comp.noteDensity.active).toBe(3);
    s.engine.render(t0 + 310);
    expect(s.comp.noteDensity.active).toBe(1);
    s.stopSlideshow();
    s.engine.render(t0 + 450);
    expect(s.comp.noteDensity.active).toBe(1);
  });
});

describe('MIDI input routing (§9, §14)', () => {
  it('Input Control: middle C starts, B2 stops, A#2 + D1 selects Transposition Position 1', () => {
    const s = mk();
    s.comp.voices[0].use = 'control';
    s.comp.transposition.active = 3;
    s.midiIn('x', [0x90, 60, 100], 0);
    expect(s.engine.state).toBe('playing');
    s.midiIn('x', [0x90, 58, 100], 0); // A#2 code (M octave numbering, C3 = 60)
    s.midiIn('x', [0x90, 38, 100], 0); // D1 = value 1
    expect(s.comp.transposition.active).toBe(0);
    s.midiIn('x', [0x90, 59, 100], 0);
    expect(s.engine.state).toBe('stopped');
  });
  it('Input Control: D#1 then E1 sets voice 1 time base denominator to 2', () => {
    const s = mk();
    s.comp.voices[3].use = 'control';
    s.midiIn('x', [0x90, 39, 100], 0);
    s.midiIn('x', [0x90, 40, 100], 0);
    expect(s.pattern(0).tbDen).toBe(2);
  });
  it('Keyboard Transpose follows incoming notes for voices using it', () => {
    const s = mk();
    s.comp.voices[1].use = 'transpose';
    s.midiIn('x', [0x90, 64, 100], 0);
    expect(s.engine.voices[1].keyTranspose).toBe(4);
    expect(s.engine.voices[0].keyTranspose).toBeNull();
  });
  it('Src channel filters which voices hear the input', () => {
    const s = mk();
    s.comp.voices[0].use = 'transpose';
    s.comp.voices[0].src = 2;
    s.midiIn('x', [0x90, 62, 100], 0); // channel 1
    expect(s.engine.voices[0].keyTranspose).toBeNull();
    s.midiIn('x', [0x91, 62, 100], 0); // channel 2
    expect(s.engine.voices[0].keyTranspose).toBe(2);
  });
  it('Record writes incoming notes into the pattern at the edit counter', () => {
    const s = mk();
    const g = s.comp.patternGroups[s.comp.patternGroup.active];
    g.patterns[2] = newPattern([], new Rng(1));
    s.setVoice(2, 'use', 'record');
    for (const n of [60, 64, 67]) {
      s.midiIn('x', [0x90, n, 100], 0);
      s.midiIn('x', [0x80, n, 0], 0);
    }
    expect(g.patterns[2].steps).toEqual(steps('C3 E3 G3'));
    expect(g.patterns[2].outputLength).toBe(3);
  });
  it('Echo-Thru-Orchestration sends input to the voice\'s orchestration channels', () => {
    const s = mk();
    const sent = spySend(s);
    s.comp.voices[1].echoThru = true; // orchestration position 1: voice 2 -> channel 2
    s.midiIn('x', [0x90, 70, 99], 0);
    s.midiIn('x', [0x80, 70, 0], 0);
    expect(sent).toEqual([
      [2, [0x91, 70, 99]],
      [2, [0x81, 70, 0]],
    ]);
  });
  it('Echo Map sends input to the mapped channels', () => {
    const s = mk();
    const sent = spySend(s);
    s.comp.voices[0].use = 'echomap';
    s.comp.echoMap[4] = true;
    s.comp.echoMap[6] = true;
    s.midiIn('x', [0x90, 50, 80], 0);
    expect(sent.map((x) => x[0])).toEqual([5, 7]);
  });
});

describe('output routing', () => {
  it('M Output Channels are remapped to device channels', () => {
    const s = mk();
    const out: { port: string; data: number[] }[] = [];
    (s.midi as unknown as { send: (p: string, d: number[]) => boolean }).send = (port, data) => (out.push({ port, data }), true);
    s.comp.midi.outputs[0] = { port: 'synthA', channel: 10 };
    s.comp.voices.forEach((v, i) => (v.playEnable = i === 0));
    s.start();
    s.scheduler.wake();
    s.emitNow(s.engine.render(1));
    const on = out.find((o) => (o.data[0] & 0xf0) === 0x90)!;
    expect(on.port).toBe('synthA');
    expect(on.data[0]).toBe(0x99); // channel 10
  });
});

describe('Pattern menu through the session', () => {
  it('operates on the selected patterns only', () => {
    const s = mk();
    const before1 = JSON.stringify(s.pattern(1).steps);
    s.selected = [true, false, false, false];
    s.patternOp('reverse');
    expect(s.pattern(0).steps.map((x) => x[0])).toEqual([72, 71, 69, 67, 65, 64, 62, 60]);
    expect(JSON.stringify(s.pattern(1).steps)).toBe(before1);
  });
  it('copy and paste a whole pattern brings its time base along', () => {
    const s = mk();
    s.selected = [false, false, true, false];
    s.editOp('copy');
    s.selected = [false, false, false, true];
    s.editOp('paste');
    expect(s.pattern(3).steps).toEqual(s.pattern(2).steps);
    expect(s.pattern(3).tbDen).toBe(s.pattern(2).tbDen);
  });
});

describe('Movie', () => {
  it('captures output while armed and stops with the music', () => {
    const s = mk();
    s.toggleMovie();
    s.start();
    expect(s.movieRecording).toBe(true);
    s.emitNow(s.engine.render(400));
    s.stop();
    expect(s.movieRecording).toBe(false);
    expect(s.movie.filter((m) => (m.data[0] & 0xf0) === 0x90).length).toBeGreaterThan(3);
  });
});
