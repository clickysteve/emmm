/**
 * A deliberately modest internal "monitor" so emmm can be heard without MIDI hardware, and
 * the metronome click (M clicked the computer's speaker). emmm is a MIDI instrument; this is
 * a test aid, not the centre of the application.
 */

export class Monitor {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Map<string, { osc: OscillatorNode; gain: GainNode }>();
  volume = 0.18;

  private ensure(): AudioContext | null {
    if (typeof AudioContext === 'undefined') return null;
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Call from a user gesture so audio can start. */
  unlock(): void {
    this.ensure();
  }

  /** performance.now() ms → AudioContext seconds */
  private when(ms: number): number {
    const ctx = this.ctx!;
    const nowMs = performance.now();
    return Math.max(ctx.currentTime, ctx.currentTime + (ms - nowMs) / 1000);
  }

  noteOn(channel: number, pitch: number, velocity: number, ms: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const key = channel + ':' + pitch;
    this.noteOff(channel, pitch, ms);
    const t = this.when(ms);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    // A different waveform per channel group, so merged voices remain distinguishable.
    osc.type = (['triangle', 'square', 'sawtooth', 'sine'] as OscillatorType[])[(channel - 1) % 4];
    osc.frequency.value = 440 * Math.pow(2, (pitch - 69) / 12);
    const peak = (velocity / 127) * (osc.type === 'sine' || osc.type === 'triangle' ? 0.5 : 0.18);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.4), t + 0.6);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    this.voices.set(key, { osc, gain });
  }

  noteOff(channel: number, pitch: number, ms: number): void {
    const key = channel + ':' + pitch;
    const v = this.voices.get(key);
    if (!v || !this.ctx) return;
    this.voices.delete(key);
    const t = this.when(ms);
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setTargetAtTime(0, t, 0.02);
    v.osc.stop(t + 0.2);
  }

  allOff(): void {
    for (const [k] of this.voices) {
      const [c, p] = k.split(':').map(Number);
      this.noteOff(c, p, performance.now());
    }
  }

  click(ms: number, accent: boolean): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = this.when(ms);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = accent ? 1760 : 1320;
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.04);
  }
}
