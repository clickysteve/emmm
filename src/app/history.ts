/**
 * Undo / Redo for document edits.
 *
 * History works on whole-document snapshots (JSON strings), taken when an edit has settled
 * — at the end of a gesture — so a drag that changes a value a hundred times is one step.
 * What counts as the "document" is decided by the caller's `snap` function: emmm leaves out
 * performance state (which Positions are active, tempo, the Baton, MIDI routing), so undoing
 * an edit never jumps the music somewhere else and playing never fills the history.
 */
export class History {
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private base: string;

  constructor(
    private snap: () => string,
    public limit = 100,
  ) {
    this.base = snap();
  }

  /** Record the current state if it differs from the last one. Returns true if it did. */
  commit(): boolean {
    const now = this.snap();
    if (now === this.base) return false;
    this.undoStack.push(this.base);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.base = now;
    return true;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0 || this.snap() !== this.base;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0 && this.snap() === this.base;
  }

  /** Step back. `apply` puts a snapshot into the live document. */
  undo(apply: (state: string) => void): boolean {
    this.commit();
    const prev = this.undoStack.pop();
    if (prev === undefined) return false;
    this.redoStack.push(this.base);
    apply(prev);
    this.base = this.snap();
    return true;
  }

  redo(apply: (state: string) => void): boolean {
    if (this.commit()) return false; // a new edit since the undo: nothing to redo
    const next = this.redoStack.pop();
    if (next === undefined) return false;
    this.undoStack.push(this.base);
    apply(next);
    this.base = this.snap();
    return true;
  }

  /** Forget everything (a different document was loaded). */
  reset(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.base = this.snap();
  }

  get depth(): { undo: number; redo: number } {
    return { undo: this.undoStack.length, redo: this.redoStack.length };
  }
}
