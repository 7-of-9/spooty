import { ConfigService } from '@nestjs/config';
import {
  AcquisitionOwner,
  AcquisitionOwnerGuard,
  isWebAcquisitionRequest,
} from './acquisition-owner';

describe('exclusive acquisition owner', () => {
  function owner(exists: jest.Mock) {
    const value = new AcquisitionOwner({
      get: jest.fn(),
    } as unknown as ConfigService);
    (value as any).redis = { exists, disconnect: jest.fn() };
    return value;
  }
  it('rejects web acquisition whenever the CLI lease exists, without reading or changing its value', async () => {
    const exists = jest.fn().mockResolvedValue(1);
    await expect(owner(exists).assertWebAllowed()).rejects.toMatchObject({
      status: 409,
    });
    expect(exists).toHaveBeenCalledWith('spooty:acquire:owner');
  });
  it('allows web work only when no lease exists', async () => {
    await expect(
      owner(jest.fn().mockResolvedValue(0)).assertWebAllowed(),
    ).resolves.toBeUndefined();
  });
  it('fails closed when ownership cannot be verified', async () => {
    await expect(
      owner(
        jest.fn().mockRejectedValue(new Error('offline')),
      ).assertWebAllowed(),
    ).rejects.toMatchObject({ status: 503 });
  });
  it('guards all acquisition ingress but leaves local playback, metadata and pace mirroring alone', () => {
    for (const [method, path] of [
      ['POST', '/api/library/download'],
      ['POST', '/api/library/download-remaining'],
      ['POST', '/api/playlist'],
      ['GET', '/api/track/retry/1'],
      ['GET', '/api/playlist/retry/1'],
    ]) {
      expect(isWebAcquisitionRequest(method, path)).toBe(true);
    }
    for (const [method, path] of [
      ['GET', '/api/library'],
      ['GET', '/api/library/audio/a/1'],
      ['GET', '/api/track/download/1'],
      ['POST', '/api/youtube/pace'],
      ['POST', '/api/library/resync/a'],
    ]) {
      expect(isWebAcquisitionRequest(method, path)).toBe(false);
    }
  });
  it('HTTP guard checks ownership before permitting a matching controller', async () => {
    const check = {
      assertWebAllowed: jest.fn().mockRejectedValue(new Error('owned')),
    };
    const guard = new AcquisitionOwnerGuard(check as any);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          originalUrl: '/api/library/download?x=1',
        }),
      }),
    };
    await expect(guard.canActivate(context as any)).rejects.toThrow('owned');
  });
  it('does not run profile activation with an owner or unpaused/active queues', async () => {
    for (const result of [0, -1]) {
      const check = owner(jest.fn());
      (check as any).redis.eval = jest.fn().mockResolvedValue(result);
      const apply = jest.fn();
      await expect(check.withPausedWebQueues(apply)).rejects.toMatchObject({
        status: 409,
      });
      expect(apply).not.toHaveBeenCalled();
      expect((check as any).redis.eval).toHaveBeenCalledTimes(1);
    }
  });
  it('releases only its own short maintenance lease even when activation rejects', async () => {
    const check = owner(jest.fn());
    const evaluate = jest
      .fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    (check as any).redis.eval = evaluate;
    await expect(
      check.withPausedWebQueues(() => {
        throw new Error('cooldown');
      }),
    ).rejects.toThrow('cooldown');
    expect(evaluate).toHaveBeenCalledTimes(2);
    const acquireToken = evaluate.mock.calls[0].at(-1);
    expect(evaluate.mock.calls[1].at(-1)).toBe(acquireToken);
    expect(evaluate.mock.calls[1][0]).toContain(
      "redis.call('GET', KEYS[1]) == ARGV[1]",
    );
  });
});
import { expect } from '@jest/globals';
