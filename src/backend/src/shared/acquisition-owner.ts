import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  Injectable,
  OnApplicationShutdown,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { pause as bullPause } from 'bullmq/dist/cjs/scripts/pause-7';

/** Routine checks are read-only. Explicit idle profile activation briefly takes
 * its own maintenance lease; it never renews, releases or replaces a CLI lease. */
@Injectable()
export class AcquisitionOwner implements OnApplicationShutdown {
  private redis: Redis | null = null;
  constructor(private readonly config: ConfigService) {}

  private client(): Redis {
    if (!this.redis) {
      this.redis = new Redis({
        host: this.config.get<string>('REDIS_HOST') || '127.0.0.1',
        port: Number(this.config.get('REDIS_PORT') || 6379),
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        connectTimeout: 1500,
        retryStrategy: () => null,
      });
      // Never log connection details or the lease value.
      this.redis.on('error', () => undefined);
    }
    return this.redis;
  }

  async assertWebAllowed(): Promise<void> {
    let owned: boolean;
    try {
      owned = Boolean(await this.client().exists('spooty:acquire:owner'));
    } catch {
      this.redis?.disconnect();
      this.redis = null;
      throw new ServiceUnavailableException(
        'Cannot verify YouTube ownership; web acquisition held safely',
      );
    }
    if (owned)
      throw new ConflictException(
        'CLI owns YouTube acquisition; web queues are preserved and paused',
      );
  }

  async snapshot(): Promise<{ state: 'owned' | 'available' | 'unknown' }> {
    try {
      return {
        state: (await this.client().exists('spooty:acquire:owner'))
          ? 'owned'
          : 'available',
      };
    } catch {
      return { state: 'unknown' };
    }
  }

  async webQueueSnapshot(): Promise<{
    search: { paused: boolean; active: number; queued: number };
    download: { paused: boolean; active: number; queued: number };
  } | null> {
    try {
      // Atomic, read-only Bull state. Paused queues may still be draining an
      // active job, so report pause and execution separately. Never resume here.
      const result = (await this.client().eval(
        `return {
          redis.call('HGET', KEYS[1], 'paused') == '1' and 1 or 0,
          redis.call('LLEN', KEYS[2]),
          redis.call('HGET', KEYS[3], 'paused') == '1' and 1 or 0,
          redis.call('LLEN', KEYS[4]),
          redis.call('LLEN', KEYS[5]) + redis.call('LLEN', KEYS[6]) + redis.call('ZCARD', KEYS[7]) + redis.call('ZCARD', KEYS[8]),
          redis.call('LLEN', KEYS[9]) + redis.call('LLEN', KEYS[10]) + redis.call('ZCARD', KEYS[11]) + redis.call('ZCARD', KEYS[12])
        }`,
        12,
        'bull:track-search-processor:meta',
        'bull:track-search-processor:active',
        'bull:track-download-processor:meta',
        'bull:track-download-processor:active',
        'bull:track-search-processor:paused',
        'bull:track-search-processor:wait',
        'bull:track-search-processor:delayed',
        'bull:track-search-processor:prioritized',
        'bull:track-download-processor:paused',
        'bull:track-download-processor:wait',
        'bull:track-download-processor:delayed',
        'bull:track-download-processor:prioritized',
      )) as number[];
      return {
        search: {
          paused: result[0] === 1,
          active: result[1],
          queued: result[4],
        },
        download: {
          paused: result[2] === 1,
          active: result[3],
          queued: result[5],
        },
      };
    } catch {
      return null; // Unknown is not an unpaused queue.
    }
  }

/** Names and next wake-up from actual Bull membership, never stale DB status. */
  async webActivityQueue(): Promise<{ active: Array<{ id: number; artist: string; name: string; playlist?: { name?: string } }>; nextRetryAt: number | null } | null> {
    try {
      const raw = await this.client().eval(`
        local active = {}
        local nextAt = 0
        for _, prefix in ipairs(KEYS) do
          for _, id in ipairs(redis.call('LRANGE', prefix .. ':active', 0, -1)) do
            local raw = redis.call('HGET', prefix .. ':' .. id, 'data')
            if raw then
              local ok, data = pcall(cjson.decode, raw)
              if ok then
                table.insert(active, { id = data.id, artist = data.artist, name = data.name, playlist = { name = data.playlist and data.playlist.name or '' } })
              end
            end
          end
          local delayed = redis.call('ZRANGE', prefix .. ':delayed', 0, 0, 'WITHSCORES')
          if delayed[2] then
            local at = math.floor(tonumber(delayed[2]) / 4096)
            if nextAt == 0 or at < nextAt then nextAt = at end
          end
        end
        return cjson.encode({ active = active, nextRetryAt = nextAt })
      `, 2, 'bull:track-search-processor', 'bull:track-download-processor');
      const result = JSON.parse(String(raw));
      return { active: Array.isArray(result.active) ? result.active : [], nextRetryAt: result.nextRetryAt || null };
    } catch { return null; }
  }

  /** Explicit whole-web-queue resume. Reuse the installed Bull script inside
   * one atomic ownership check, so neither CLI takeover nor workers can race
   * between releasing ownership and resuming the two queues. */
  async resumeWebQueues(): Promise<void> {
    const keys = ['spooty:acquire:owner'];
    for (const name of ['track-search-processor', 'track-download-processor']) {
      for (const kind of [
        'paused',
        'wait',
        'meta',
        'prioritized',
        'events',
        'delayed',
        'marker',
      ])
        keys.push(`bull:${name}:${kind}`);
    }
    const result = Number(
      await this.client().eval(
        `
      if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
      -- Preflight BOTH queues before mutating either. Never rename over work.
      for _, offset in ipairs({1, 8}) do
        if redis.call('EXISTS', KEYS[offset+1]) == 1 and
           redis.call('EXISTS', KEYS[offset+2]) == 1 then return -1 end
      end
      local function resume(KEYS, ARGV)
        ${bullPause.content}
      end
      for _, offset in ipairs({1, 8}) do
        if redis.call('HGET', KEYS[offset+3], 'paused') == '1' then
          local queue = {}
          for i=1,7 do queue[i] = KEYS[offset+i] end
          resume(queue, {'resumed'})
        end
      end
      return 1`,
        keys.length,
        ...keys,
      ),
    );
    if (result === 0)
      throw new ConflictException('CLI owns YouTube; web queues remain paused');
    if (result !== 1)
      throw new ConflictException(
        'Queue state needs repair; no jobs were changed',
      );
  }

  async withPausedWebQueues<T>(apply: () => T): Promise<T> {
    return this.withWebMaintenance(apply, false);
  }

  async withIdleWebQueues<T>(apply: () => T): Promise<T> {
    return this.withWebMaintenance(apply, true);
  }

  private async withWebMaintenance<T>(
    apply: () => T,
    allowIdle: boolean,
  ): Promise<T> {
    const token = `web-preset-${randomUUID()}`;
    const redis = this.client();
    const keys = [
      'spooty:acquire:owner',
      'bull:track-download-processor:meta',
      'bull:track-download-processor:active',
      'bull:track-search-processor:meta',
      'bull:track-search-processor:active',
      'bull:track-download-processor:wait',
      'bull:track-download-processor:delayed',
      'bull:track-download-processor:prioritized',
      'bull:track-download-processor:waiting-children',
      'bull:track-search-processor:wait',
      'bull:track-search-processor:delayed',
      'bull:track-search-processor:prioritized',
      'bull:track-search-processor:waiting-children',
    ];
    // A short exclusive lease closes the race with a simultaneous CLI takeover.
    // This endpoint NEVER resumes queues; all checks precede the settings write.
    const result = await redis.eval(
      `
      if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
      if redis.call('LLEN', KEYS[3]) ~= 0 or redis.call('LLEN', KEYS[5]) ~= 0 then return -1 end
      local function safe(meta, wait, delayed, priority, children)
        if redis.call('HGET', meta, 'paused') == '1' then return true end
        if ARGV[1] ~= 'idle' then return false end
        return redis.call('LLEN', wait) == 0 and redis.call('ZCARD', delayed) == 0 and redis.call('ZCARD', priority) == 0 and redis.call('ZCARD', children) == 0
      end
      if not safe(KEYS[2], KEYS[6], KEYS[7], KEYS[8], KEYS[9]) or not safe(KEYS[4], KEYS[10], KEYS[11], KEYS[12], KEYS[13]) then return -1 end
      redis.call('SET', KEYS[1], ARGV[2], 'PX', 10000, 'NX')
      return 1`,
      keys.length,
      ...keys,
      allowIdle ? 'idle' : 'paused',
      token,
    );
    if (Number(result) === 0)
      throw new ConflictException(
        'CLI owns YouTube acquisition; settings were not changed',
      );
    if (Number(result) !== 1)
      throw new ConflictException(
        allowIdle
          ? 'Download location was not changed: let active work finish and pause any queued work first'
          : 'Pause and drain both web queues before selecting the retained profile',
      );
    try {
      return await apply();
    } finally {
      await redis.eval(
        `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`,
        1,
        keys[0],
        token,
      );
    }
  }

  onApplicationShutdown() {
    this.redis?.disconnect();
    this.redis = null;
  }
}

export function isWebAcquisitionRequest(method: string, path: string): boolean {
  const pathname = path.split('?')[0].replace(/\/+$/, '');
  return (
    (method === 'POST' &&
      /^\/api\/library\/download(?:-remaining)?$/.test(pathname)) ||
    (method === 'POST' && pathname === '/api/playlist') ||
    (method === 'GET' &&
      /^\/api\/(?:track|playlist)\/retry\/[^/]+$/.test(pathname))
  );
}

@Injectable()
export class AcquisitionOwnerGuard implements CanActivate {
  constructor(private readonly owner: AcquisitionOwner) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (
      isWebAcquisitionRequest(
        request.method,
        request.originalUrl || request.url,
      )
    ) {
      await this.owner.assertWebAllowed();
    }
    return true;
  }
}
