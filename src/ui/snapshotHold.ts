/**
 * Press and hold an empty Snapshot letter to Capture All into it (emmm). A quick tap of an
 * empty letter still does nothing (there is nothing to recall); held for SNAPSHOT_HOLD_MS it
 * stores everything a Snapshot can hold, at that moment, through the same Capture All as a
 * double-click on the slot. Occupied letters never come here: they recall at once, as in M.
 */

/** How long an empty Snapshot letter must be held to capture (ms). */
export const SNAPSHOT_HOLD_MS = 400;

export class SnapshotKeyHold {
  private pending: { code: string; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(private capture: (i: number) => void) {}

  /** An empty letter went down (not an auto-repeat): capture slot `i` if it is still held at
   * the threshold — once; its release afterwards does nothing. */
  press(code: string, i: number): void {
    this.cancel();
    const timer = setTimeout(() => {
      this.pending = null;
      this.capture(i);
    }, SNAPSHOT_HOLD_MS);
    this.pending = { code, timer };
  }

  /** Another key went down: the hold is abandoned (e.g. a modifier shortcut). */
  other(code: string): void {
    if (this.pending && this.pending.code !== code) this.cancel();
  }

  /** A key went up: before the threshold, the tap is just a tap. */
  release(code: string): void {
    if (this.pending?.code === code) this.cancel();
  }

  /** Focus lost, page hidden, or torn down: never leave a capture waiting. */
  cancel(): void {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
  }

  get active(): boolean {
    return this.pending !== null;
  }
}
