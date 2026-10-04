import { ConflictException } from '@nestjs/common';

export interface WebAdmissionSnapshot {
  running: boolean;
  startedAt: number | null;
  done: number;
  total: number | null;
  phase: 'checking' | 'verifying' | 'copying' | 'queueing';
  playlist: string;
  artist: string;
  name: string;
}

/** Covers HTTP-side preparation before Bull owns jobs. Not a second scheduler.
 * A lost HTTP client cannot hide still-running work or permit a folder change. */
export class WebAdmissionState {
  private state: WebAdmissionSnapshot = this.empty();

  private empty(): WebAdmissionSnapshot {
    return { running: false, startedAt: null, done: 0, total: null,
      phase: 'checking', playlist: '', artist: '', name: '' };
  }

  snapshot(): WebAdmissionSnapshot { return { ...this.state }; }

  update(value: Partial<Omit<WebAdmissionSnapshot, 'running' | 'startedAt'>>): void {
    if (this.state.running) this.state = { ...this.state, ...value };
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.state.running) throw new ConflictException('A playlist request is still preparing tracks. Follow Current activity before adding another batch.');
    this.state = { ...this.empty(), running: true, startedAt: Date.now() };
    try { return await work(); }
    finally { this.state = this.empty(); }
  }
}

export const webAdmission = new WebAdmissionState();
