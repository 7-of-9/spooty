/** Local processor execution, not database labels or Redis availability. */
export class WorkerActivity {
  private count = 0;
  get active(): boolean { return this.count > 0; }
  async run<T>(work: () => Promise<T>): Promise<T> {
    this.count++;
    try { return await work(); } finally { this.count--; }
  }
}
