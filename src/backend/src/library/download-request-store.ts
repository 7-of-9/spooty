import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface DownloadReceipt { queued: number; skipped: number; reused?: number }
export interface DownloadRequestStatus {
  requestId: string;
  state: 'preparing' | 'completed' | 'interrupted' | 'failed';
  startedAt: number;
  finishedAt: number | null;
  destination: string;
  receipt: DownloadReceipt | null;
}
interface SavedRequest extends DownloadRequestStatus { fingerprint: string; owner: string }

export function validateDownloadRequestId(value: string): void {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) {
    throw new BadRequestException('Invalid download request ID');
  }
}

export function validDownloadReceipt(value: any): value is DownloadReceipt {
  return !!value && [value.queued, value.skipped, value.reused ?? 0]
    .every(n => Number.isSafeInteger(n) && n >= 0) && (value.reused ?? 0) <= value.skipped;
}

/** Durable acknowledgements, not another scheduler. No automatic work replay.
 * One LibraryService/store owns a backend's DB; old preparing records become
 * interrupted on a new store instance. Completed results survive restarts. */
export class DownloadRequestStore {
  private readonly owner = randomUUID();
  private readonly pending = new Map<string, Promise<DownloadReceipt>>();
  constructor(private readonly directory: string) {}

  private path(id: string): string { validateDownloadRequestId(id); return join(this.directory, `${id}.json`); }

  private read(id: string): SavedRequest | null {
    const file = this.path(id);
    if (!existsSync(file)) return null;
    const row = JSON.parse(readFileSync(file, 'utf8'));
    if (row.requestId !== id || !['preparing', 'completed', 'failed'].includes(row.state) ||
        typeof row.owner !== 'string' || !/^[a-f0-9]{64}$/.test(row.fingerprint) ||
        !Number.isSafeInteger(row.startedAt) || row.startedAt < 0 || typeof row.destination !== 'string' ||
        (row.finishedAt !== null && (!Number.isSafeInteger(row.finishedAt) || row.finishedAt < row.startedAt)) ||
        (row.state === 'preparing' ? row.finishedAt !== null || row.receipt !== null : row.finishedAt === null) ||
        (row.state === 'completed' ? !validDownloadReceipt(row.receipt) : row.receipt !== null)) {
      throw new Error('Invalid saved download receipt; submission outcome is unconfirmed');
    }
    return row;
  }

  get(id: string): DownloadRequestStatus {
    const row = this.read(id);
    if (!row) throw new NotFoundException('Download submission not recorded');
    const { fingerprint, owner, ...status } = row;
    if (status.state === 'preparing' && (owner !== this.owner || !this.pending.has(id))) {
      status.state = 'interrupted';
    }
    return status;
  }

  run(id: string, request: { scope: string; uris: string[]; options: object; destination: string },
      work: () => Promise<DownloadReceipt>): Promise<DownloadReceipt> {
    const file = this.path(id);
    const fingerprint = createHash('sha256').update(JSON.stringify({
      scope: request.scope,
      uris: [...new Set(request.uris)].sort(),
      options: Object.fromEntries(Object.entries(request.options).filter(([, value]) => value !== undefined).sort()),
    })).digest('hex');
    const previous = this.read(id);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new ConflictException('This request ID belongs to a different download submission');
      if (previous.state === 'completed') return Promise.resolve({ ...previous.receipt });
      if (this.pending.has(id)) return this.pending.get(id)!;
      throw new ConflictException('This submission did not finish. Check its saved outcome and current queue before submitting a new request.');
    }
    mkdirSync(this.directory, { recursive: true });
    const row: SavedRequest = { requestId: id, fingerprint, owner: this.owner,
      state: 'preparing', startedAt: Date.now(), finishedAt: null,
      destination: request.destination, receipt: null };
    // Exclusive admission is recorded before any track/file/queue mutation.
    // A failed or corrupt write fails closed; never overwrite it and replay.
    writeFileSync(file, JSON.stringify(row), { flag: 'wx', mode: 0o600 });
    const finish = (state: 'completed' | 'failed', receipt: DownloadReceipt | null) => {
      const temporary = `${file}.${this.owner}.tmp`;
      writeFileSync(temporary, JSON.stringify({ ...row, state, receipt, finishedAt: Date.now() }), { mode: 0o600 });
      renameSync(temporary, file);
    };
    const pending = Promise.resolve().then(work).then(receipt => {
      if (!validDownloadReceipt(receipt)) throw new Error('Invalid download receipt');
      finish('completed', receipt);
      return receipt;
    }).catch(error => {
      // Earlier work may already exist. Do not store guessed partial counts or
      // upstream error/session material, and never retry the mutation here.
      try { finish('failed', null); } catch { /* Keep the incomplete admission. */ }
      throw error;
    }).finally(() => this.pending.delete(id));
    this.pending.set(id, pending);
    return pending;
  }
}
