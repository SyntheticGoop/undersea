export class Atomic {
  constructor(private readonly limit: number) {}

  private step = 0;

  public get next() {
    const step = this.step;
    this.step = (step + 1) % this.limit;
    return step;
  }

  public clone(): Atomic {
    const atomic = new Atomic(this.limit);
    atomic.step = this.step;
    return atomic;
  }
}
