import { describe, it, expect } from '@jest/globals';
import { WebActivity } from './web-activity';
import { YoutubeService } from './youtube.service';

describe('web activity telemetry', () => {
  it('reports actual phase and clears it on failure without counting a download', async () => {
    const activity = new WebActivity();
    const track = { id: 1, artist: 'Artist', name: 'Track', playlist: { name: 'Playlist' } };
    await expect(activity.run(track, async () => {
      activity.phase(track, 'metadata');
      expect(activity.snapshot({ active: [track], nextRetryAt: null }).active[0].phase).toBe('metadata');
      throw new Error('operation failed');
    })).rejects.toThrow('operation failed');
    const snapshot = activity.snapshot({ active: [], nextRetryAt: 123 });
    expect(snapshot.active).toEqual([]);
    expect(snapshot.recent[0].result).toBe('failed');
    expect(snapshot.nextRetryAt).toBe(123);
    expect(snapshot.totals.downloaded).toBe(0);
  });
  it('separates local reuse from newly downloaded MP3s and bounds progress', async () => {
    const activity = new WebActivity();
    const track = { id: 1, artist: 'Artist', name: 'Track' };
    for (const result of ['reused', 'downloaded']) await activity.run(track, async () => {
      activity.phase(track, 'downloading', 150);
      expect(activity.snapshot({ active: [track], nextRetryAt: null }).active[0]).toMatchObject({ percent: 100 });
      activity.result(1, result);
    });
    expect(activity.snapshot({ active: [], nextRetryAt: null }).totals).toEqual({ reused: 1, downloaded: 1, checked: 0 });
  });
  it('does not present a completed job as active after it leaves Bull', async () => {
    const activity = new WebActivity();
    const track = { id: 1, artist: 'Artist', name: 'Track' };
    await activity.run(track, async () => {
      expect(activity.snapshot({ active: [], nextRetryAt: null }).active).toEqual([]);
    });
  });
});

describe('web acquisition configuration defaults', () => {
  it.each(['', ' ', '0', 0])('treats QUALITY=%j as the documented quality-zero default', (quality) => {
    const youtube = new YoutubeService({ get: (key: string) => ({ QUALITY: quality, FORMAT: 'mp3' })[key] } as any);
    expect(youtube.configurationError()).toBeNull();
    youtube.onApplicationShutdown();
  });
  it('still rejects an explicitly incompatible quality', () => {
    const youtube = new YoutubeService({ get: (key: string) => ({ QUALITY: '5', FORMAT: 'mp3' })[key] } as any);
    expect(youtube.configurationError()).toContain('QUALITY=0');
    youtube.onApplicationShutdown();
  });
});
