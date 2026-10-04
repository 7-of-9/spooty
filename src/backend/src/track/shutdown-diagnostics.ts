import { appendFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

const states = new Set(['ready', 'connecting', 'connect', 'reconnecting', 'close', 'end', 'wait', 'initializing', 'closing', 'closed']);
const state = (value: unknown) => typeof value === 'string' && states.has(value) ? value : 'unknown';
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;

/** Inspect only state flags and queue lengths. Never serialize a Redis client,
 * command, job, URL, connection options, arguments or environment. */
export function workerShutdownDetails(worker: any): string {
  try {
    const main = worker.connection?._client, blocking = worker.blockingConnection?._client;
    return JSON.stringify({ waiting: !!worker.waiting, paused: !!worker.paused,
      main: state(main?.status), blocking: state(blocking?.status),
      commands: count(main?.commandQueue?.length), offline: count(main?.offlineQueue?.length),
      blockingCommands: count(blocking?.commandQueue?.length), blockingOffline: count(blocking?.offlineQueue?.length),
      rateLimited: typeof worker.limitUntil === 'number' && worker.limitUntil > Date.now() });
  } catch { return 'unavailable'; }
}

/** Owner-local, bounded diagnostic artifact. No file replacement or deletion.
 * Keeping this before the console write also distinguishes a stalled event loop
 * or blocked log output from a worker promise that continues to be observed. */
export function shutdownTraceFile(dbPath?: string): (message: string) => void {
  if (!dbPath || !isAbsolute(dbPath)) return () => undefined;
  const directory = join(dirname(dbPath), 'shutdown-traces');
  const file = join(directory, `${process.pid}.jsonl`);
  let disabled = false;
  return message => {
    if (disabled) return;
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      let bytes = 0;
      try { bytes = statSync(file).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const line = JSON.stringify({ at: new Date().toISOString(), pid: process.pid, message }) + '\n';
      if (bytes + Buffer.byteLength(line) > 128 * 1024) { disabled = true; return; }
      appendFileSync(file, line, { mode: 0o600 });
    } catch { disabled = true; /* Diagnostics must never block graceful drain. */ }
  };
}
