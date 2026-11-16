/**
 * Deterministic 32-bit PRNG (Mulberry32) for reproducible simulation steps,
 * seeded tests across frame rates, and replay integrity.
 */
export class SeededRng {
  private state: number;

  constructor(seed = 0x5a17c0de) {
    this.state = seed >>> 0 || 0x12345678;
  }

  public next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  public range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  public signedRange(magnitude: number): number {
    return (this.next() * 2 - 1) * magnitude;
  }

  public getState(): number {
    return this.state >>> 0;
  }

  public setState(state: number): void {
    this.state = state >>> 0 || 0x12345678;
  }
}
