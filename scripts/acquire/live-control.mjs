import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Fail closed for writes, but let status report its last snapshot offline.
// Never return or log the Redis owner token.
export async function verifyLiveOwner(status, { env = process.env, kill = process.kill, clientFactory } = {}) {
  let pidExists = false;
  if (Number.isSafeInteger(status?.pid) && status.pid > 0) {
    try { kill(status.pid, 0); pidExists = true; } catch {}
  }
  let redis;
  try {
    const Redis = clientFactory || require('ioredis');
    redis = new Redis({ host: env.REDIS_HOST || '127.0.0.1', port: Number(env.REDIS_PORT || 6379),
      lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 1500, commandTimeout: 2000,
      retryStrategy: () => null });
    redis.on('error', () => {});
    const owner = await redis.get('spooty:acquire:owner');
    return { liveOwnerVerified: pidExists && Boolean(status?.runId) && owner?.startsWith(`${status.pid}-`) === true,
      ownerCheck: 'verified', anotherOwnerPresent: Boolean(owner) && !owner.startsWith(`${status?.pid}-`) };
  } catch {
    return { liveOwnerVerified: false, ownerCheck: 'unavailable', anotherOwnerPresent: null };
  } finally { redis?.disconnect(); }
}

export function controlForOwner(status, ownership, request, previous) {
  if (ownership.ownerCheck !== 'verified') throw new Error('Cannot verify the CLI owner; control was not changed.');
  if (!ownership.liveOwnerVerified) throw new Error('No matching live CLI owner; control was not changed. Use run to start acquisition.');
  const sameRun = previous?.targetRunId === status.runId;
  return { ...(sameRun && previous.stop ? { stop: true } : {}), ...request,
    targetRunId: status.runId, targetPid: status.pid };
}

export function controlMatchesRun(control, runId, pid) {
  // Legacy files are cleared on startup; accepting them preserves compatibility
  // with the historical command while a new runner is being rolled out.
  return !control?.targetRunId || (control.targetRunId === runId && control.targetPid === pid);
}
