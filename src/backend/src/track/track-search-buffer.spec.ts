import { TrackSearchProcessor } from './track-search.processor';
import { DelayedError } from 'bullmq';

describe('URL-ready web search buffer', () => {
  const original = process.env.YT_WEB_PROFILE;
  beforeEach(() => {
    process.env.YT_WEB_PROFILE = 'cli-proven';
  });
  afterEach(() => {
    if (original === undefined) delete process.env.YT_WEB_PROFILE;
    else process.env.YT_WEB_PROFILE = original;
  });
  it('defers durably at 192 jobs without starting search or consuming a retry attempt', async () => {
    const track = {
      findOnYoutube: jest.fn(),
      preparedSearchBufferSize: jest.fn().mockResolvedValue(192),
    };
    const queue = { getWaitingCount: jest.fn().mockResolvedValue(192) };
    const job = {
      token: 'fixture-lock',
      moveToDelayed: jest.fn().mockResolvedValue(undefined),
      data: {},
      name: 'youtube-retry-2',
    };
    await expect(
      new TrackSearchProcessor(track as any, queue as any).process(job as any),
    ).rejects.toBeInstanceOf(DelayedError);
    expect(job.moveToDelayed).toHaveBeenCalledWith(
      expect.any(Number),
      'fixture-lock',
    );
    expect(track.findOnYoutube).not.toHaveBeenCalled();
  });
  it('admits search normally when the URL buffer has room', async () => {
    const track = {
      findOnYoutube: jest.fn().mockResolvedValue(undefined),
      preparedSearchBufferSize: jest.fn().mockResolvedValue(191),
    };
    const queue = { getWaitingCount: jest.fn().mockResolvedValue(191) };
    const job = { data: { artist: 'A' }, name: 'youtube-retry-2' };
    await new TrackSearchProcessor(track as any, queue as any).process(
      job as any,
    );
    expect(track.findOnYoutube).toHaveBeenCalledWith(job.data, 2);
  });
});
import { expect } from '@jest/globals';
