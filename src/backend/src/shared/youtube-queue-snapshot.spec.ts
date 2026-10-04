import { AcquisitionOwner } from './acquisition-owner';
import { YoutubePaceController } from './youtube-pace.controller';

describe('read-only web queue telemetry', () => {
  it('requires explicit all-web-queues scope before calling resume', async () => {
    const youtube = {
      resumeWebQueues: jest.fn<() => Promise<void>>().mockResolvedValue(),
    };
    const controller = new YoutubePaceController(
      youtube as any,
      { get: () => undefined } as any,
    );
    await expect(controller.resumeQueues({})).rejects.toThrow('Confirm scope');
    expect(youtube.resumeWebQueues).not.toHaveBeenCalled();
    jest.spyOn(controller, 'snapshot').mockResolvedValue({ ok: true } as any);
    await expect(
      controller.resumeQueues({ scope: 'all-web-queues' }),
    ).resolves.toEqual({ ok: true });
    expect(youtube.resumeWebQueues).toHaveBeenCalledTimes(1);
  });
  it.each([
    [[1, 0, 1, 0, 30, 4], true, true, 0],
    [[1, 2, 0, 0, 30, 4], true, false, 2],
    [[0, 0, 0, 0, 30, 4], false, false, 0],
  ])(
    'separates pause from draining work: %j',
    async (values, searchPaused, downloadPaused, active) => {
      const owner = new AcquisitionOwner({ get: () => undefined } as any);
      const evalRead = jest
        .fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue(values);
      (owner as any).redis = { eval: evalRead };
      expect(await owner.webQueueSnapshot()).toEqual({
        search: { paused: searchPaused, active, queued: 30 },
        download: { paused: downloadPaused, active: 0, queued: 4 },
      });
      const [script, keyCount, ...keys] = evalRead.mock.calls[0];
      expect(keyCount).toBe(12);
      expect(keys).toHaveLength(12);
      expect(script).not.toMatch(
        /redis\.call\('(SET|DEL|HSET|HDEL|LPUSH|LPOP|RPOPLPUSH)'/,
      );
    },
  );

  it('reports unknown on Redis failure rather than inventing unpaused queues', async () => {
    const owner = new AcquisitionOwner({ get: () => undefined } as any);
    (owner as any).redis = {
      eval: jest
        .fn<() => Promise<any>>()
        .mockRejectedValue(new Error('offline')),
    };
    expect(await owner.webQueueSnapshot()).toBeNull();
  });

  it('includes queue telemetry independently of available CLI ownership', async () => {
    const webQueues = {
      search: { paused: true, active: 0 },
      download: { paused: true, active: 0 },
    };
    const youtube = {
      ownerSnapshot: jest
        .fn<() => Promise<any>>()
        .mockResolvedValue({ state: 'available' }),
      webActivitySnapshot: jest.fn<() => Promise<any>>().mockResolvedValue(null),
      configurationError: jest.fn().mockReturnValue(null),
      paceSnapshot: jest
        .fn()
        .mockReturnValue({ searchActive: 0, downloadActive: 0 }),
      webQueueSnapshot: jest
        .fn<() => Promise<any>>()
        .mockResolvedValue(webQueues),
    };
    const controller = new YoutubePaceController(
      youtube as any,
      { get: () => undefined } as any,
    );
    expect(await controller.snapshot()).toMatchObject({
      webQueues,
      acquisition: null,
    });
  });
});
import { describe, it, expect, jest } from '@jest/globals';
