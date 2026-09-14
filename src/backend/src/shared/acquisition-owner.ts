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

  async withPausedWebQueues<T>(apply: () => T): Promise<T> {
    const token = `web-preset-${randomUUID()}`;
    const redis = this.client();
    const keys = [
      'spooty:acquire:owner',
      'bull:track-download-processor:meta',
      'bull:track-download-processor:active',
      'bull:track-search-processor:meta',
      'bull:track-search-processor:active',
    ];
    // A short exclusive lease closes the race with a simultaneous CLI takeover.
    // This endpoint NEVER resumes queues; all checks precede the pace write.
    const result = await redis.eval(
      `
      if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
      if redis.call('HGET', KEYS[2], 'paused') ~= '1' or redis.call('HGET', KEYS[4], 'paused') ~= '1' then return -1 end
      if redis.call('LLEN', KEYS[3]) ~= 0 or redis.call('LLEN', KEYS[5]) ~= 0 then return -1 end
      redis.call('SET', KEYS[1], ARGV[1], 'PX', 10000, 'NX')
      return 1`,
      keys.length,
      ...keys,
      token,
    );
    if (Number(result) === 0)
      throw new ConflictException(
        'CLI owns YouTube acquisition; profile was not changed',
      );
    if (Number(result) !== 1)
      throw new ConflictException(
        'Pause and drain both web queues before selecting the retained profile',
      );
    try {
      return apply();
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
