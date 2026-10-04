/** Read-only lifecycle diagnostics. Never waits for or changes queue work. */
export interface ShutdownResource {
  name: string;
  closing: () => Promise<unknown> | undefined;
  activity?: () => boolean;
  running?: () => boolean;
  details?: () => string;
}

export class ShutdownTrace {
  private timer?: ReturnType<typeof setInterval>;
  private startedAt = 0;
  private lastNotice = 0;
  private stopped = false;
  private readonly observed = new Map<string, Promise<unknown>>();
  private readonly state = new Map<string, string>();

  constructor(private readonly resources: ShutdownResource[], private readonly log: (message: string) => void) {}

  start(): void {
    if (this.timer || this.stopped) return;
    this.startedAt = Date.now();
    this.lastNotice = this.startedAt - 25000;
    this.log('Shutdown trace started. Observing only; no timeout will terminate work.');
    this.timer = setInterval(() => this.sample(), 1000);
    this.timer.unref?.();
  }

  private sample(): void {
    if (this.stopped) return;
    for (const resource of this.resources) {
      const closing = resource.closing();
      if (!closing || this.observed.get(resource.name) === closing) continue;
      this.observed.set(resource.name, closing);
      this.state.set(resource.name, 'closing');
      closing.then(() => this.closed(resource.name, 'closed'), () => this.closed(resource.name, 'close-rejected'));
    }
    const now = Date.now();
    if (now - this.startedAt < 5000 || now - this.lastNotice < 30000) return;
    this.lastNotice = now;
    const states = this.resources.map(resource => {
      const activity = resource.activity ? `,handler=${resource.activity() ? 'active' : 'idle'}` : '';
      const running = resource.running ? `,loop=${resource.running() ? 'running' : 'stopped'}` : '';
      const details = resource.details ? `,state=${resource.details()}` : '';
      return `${resource.name}:${this.state.get(resource.name) || 'close-not-started'}${activity}${running}${details}`;
    });
    this.log(`Shutdown waiting ${Math.floor((now - this.startedAt) / 1000)}s; ${states.join('; ')}`);
  }

  private closed(name: string, state: string): void {
    if (this.stopped) return;
    this.state.set(name, state);
    this.log(`Shutdown resource ${name}: ${state}`);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.log('Application shutdown hook reached. Trace stopped.');
  }
}
