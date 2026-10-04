import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { shutdownTraceFile, workerShutdownDetails } from './shutdown-diagnostics';

describe('private shutdown diagnostics', () => {
  let root: string;
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); jest.restoreAllMocks(); });
  it('extracts only known state flags and counts from live worker internals', () => {
    const result = workerShutdownDetails({ waiting: Promise.resolve(), paused: false, limitUntil: Date.now() + 10000,
      connection: { _client: { status: 'ready', options: { password: 'private' }, commandQueue: ['private command'], offlineQueue: [] } },
      blockingConnection: { _client: { status: 'end', commandQueue: [], offlineQueue: [] } } });
    expect(JSON.parse(result)).toEqual({ waiting: true, paused: false, main: 'ready', blocking: 'end', commands: 1,
      offline: 0, blockingCommands: 0, blockingOffline: 0, rateLimited: true });
    expect(result).not.toMatch(/private|password|options/);
  });
  it('does not expose arbitrary states, missing internals or property errors', () => {
    expect(workerShutdownDetails({ connection: { _client: { status: 'private state' } } })).not.toContain('private');
    expect(workerShutdownDetails({ get connection() { throw new Error('private error'); } })).toBe('unavailable');
    expect(JSON.parse(workerShutdownDetails({})).commands).toBeNull();
  });
  it('writes an owner-only bounded trace beside the database and preserves an existing file at the limit', () => {
    root = mkdtempSync(join(tmpdir(), 'spooty-shutdown-trace-'));
    const write = shutdownTraceFile(join(root, 'library.sqlite')); write('Shutdown trace started');
    const directory = join(root, 'shutdown-traces'), file = join(directory, `${process.pid}.jsonl`);
    expect(statSync(file).mode & 0o777).toBe(0o600); expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(JSON.parse(readFileSync(file, 'utf8')).message).toBe('Shutdown trace started');
    const existing = 'fixture'.repeat(20000); writeFileSync(file, existing); write('must not grow or overwrite');
    expect(readFileSync(file, 'utf8')).toBe(existing);
  });
  it('skips missing/relative database paths and tolerates unwritable destinations', () => {
    root = mkdtempSync(join(tmpdir(), 'spooty-shutdown-trace-'));
    shutdownTraceFile()('no destination'); shutdownTraceFile('relative.sqlite')('no destination');
    const occupied = join(root, 'occupied'); writeFileSync(occupied, 'preserve');
    expect(() => shutdownTraceFile(join(occupied, 'library.sqlite'))('cannot write')).not.toThrow();
    expect(readdirSync(root)).toEqual(['occupied']); expect(readFileSync(occupied, 'utf8')).toBe('preserve');
  });
});
