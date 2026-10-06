/**
 * Seeded pseudo-random numbers (M-BEHAVIOUR §13).
 * sfc32 generator, seeded through splitmix32 so that small integer seeds such as 38291
 * give well-mixed, independent streams.
 */

function splitmix32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

export class Rng {
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;

  constructor(seed: number, stream = 0) {
    this.reseed(seed, stream);
  }

  reseed(seed: number, stream = 0): void {
    const sm = splitmix32((seed >>> 0) ^ Math.imul(stream + 1, 0x85ebca6b));
    this.a = sm();
    this.b = sm();
    this.c = sm();
    this.d = sm();
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  nextU32(): number {
    let { a, b, c, d } = this;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    return t >>> 0;
  }

  /** [0, 1) */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number {
    if (hi <= lo) return lo;
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** true with probability pct/100. */
  chance(pct: number): boolean {
    if (pct >= 100) {
      this.nextU32(); // keep stream consumption independent of the value
      return true;
    }
    return this.next() * 100 < pct;
  }

  /** Snapshot / restore internal state (used for persistence of a running session). */
  getState(): [number, number, number, number] {
    return [this.a, this.b, this.c, this.d];
  }
  setState(s: [number, number, number, number]): void {
    [this.a, this.b, this.c, this.d] = s;
  }
}

/** Fisher–Yates permutation of 0..n-1. */
export function permutation(n: number, rng: Rng): number[] {
  const p = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}

/** Random seed for a new session (not deterministic, by design). */
export function freshSeed(): number {
  return Math.floor(Math.random() * 90000) + 10000;
}
