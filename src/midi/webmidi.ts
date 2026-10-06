/**
 * Web MIDI device management. Degrades gracefully when Web MIDI is unavailable or denied:
 * emmm still runs, showing events on screen and (optionally) through the internal monitor.
 */

export interface PortInfo {
  id: string;
  name: string;
  manufacturer: string;
  state: string;
}

export type MidiStatus = 'unrequested' | 'unsupported' | 'denied' | 'ready' | 'pending';

export type InputHandler = (portId: string, data: Uint8Array, timeStamp: number) => void;

export class MidiManager {
  status: MidiStatus = 'unrequested';
  error = '';
  private access: MIDIAccess | null = null;
  private inputHandler: InputHandler | null = null;
  private listeners = new Set<() => void>();

  get supported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    this.listeners.forEach((f) => f());
  }

  async request(): Promise<MidiStatus> {
    if (!this.supported) {
      this.status = 'unsupported';
      this.emit();
      return this.status;
    }
    this.status = 'pending';
    this.emit();
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.status = 'ready';
      this.access.onstatechange = () => {
        this.bindInputs();
        this.emit();
      };
      this.bindInputs();
    } catch (e) {
      this.status = 'denied';
      this.error = String((e as Error)?.message ?? e);
    }
    this.emit();
    return this.status;
  }

  outputs(): PortInfo[] {
    if (!this.access) return [];
    return [...this.access.outputs.values()].map((p) => ({ id: p.id, name: p.name ?? p.id, manufacturer: p.manufacturer ?? '', state: p.state }));
  }

  inputs(): PortInfo[] {
    if (!this.access) return [];
    return [...this.access.inputs.values()].map((p) => ({ id: p.id, name: p.name ?? p.id, manufacturer: p.manufacturer ?? '', state: p.state }));
  }

  setInputHandler(fn: InputHandler): void {
    this.inputHandler = fn;
    this.bindInputs();
  }

  private bindInputs(): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = (e: MIDIMessageEvent) => {
        if (e.data) this.inputHandler?.(input.id, e.data, e.timeStamp);
      };
    }
  }

  /** Send bytes to a port at a performance.now() timestamp (undefined = now). */
  send(portId: string, data: number[], timestamp?: number): boolean {
    const out = this.access?.outputs.get(portId);
    if (!out) return false;
    try {
      out.send(data, timestamp);
      return true;
    } catch {
      return false;
    }
  }

  portName(id: string): string {
    return this.access?.outputs.get(id)?.name ?? this.access?.inputs.get(id)?.name ?? id;
  }
}
