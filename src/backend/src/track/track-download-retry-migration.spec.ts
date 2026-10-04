import { expect } from '@jest/globals';
import { trackFixture } from './acquisition.fixture';
import { TrackStatusEnum } from './track.entity';
import { videoUrl } from '../shared/acquisition/web-adapter.fixture';

describe('legacy Bull job migration into shared acquisition', () => {
  let f: ReturnType<typeof trackFixture>;
  beforeEach(() => {
    f = trackFixture();
    f.row.youtubeUrl = videoUrl('abcdefghijk');
  });
  afterEach(() => {
    f.close();
    jest.restoreAllMocks();
  });
  it('preserves a persisted bot-cookie recovery hint', async () => {
    f.row.error = 'Sign in to confirm you are not a bot';
    const download = jest
      .spyOn(f.youtube, 'downloadAndFormat')
      .mockRejectedValue(new Error('Local network unavailable'));
    await f.service.downloadFromYoutube(f.row);
    expect(download.mock.calls[0][4]).toBe(true);
  });
  it('does not turn an age restriction into a bot recovery hint', async () => {
    f.row.error = 'YouTube age verification requires cookies';
    const download = jest
      .spyOn(f.youtube, 'downloadAndFormat')
      .mockRejectedValue(new Error('Local network unavailable'));
    await f.service.downloadFromYoutube(f.row);
    expect(download.mock.calls[0][4]).toBe(false);
  });
  it('clears stale Downloading before waiting for actual shared admission', async () => {
    f.row.status = TrackStatusEnum.Downloading;
    jest
      .spyOn(f.youtube, 'downloadAndFormat')
      .mockImplementation(async (_track, _path, _progress, onStart) => {
        expect(f.row.status).toBe(TrackStatusEnum.Queued);
        await onStart();
        expect(f.row.status).toBe(TrackStatusEnum.Downloading);
        throw new Error('Local network unavailable');
      });
    await f.service.downloadFromYoutube(f.row);
    expect(f.row.status).toBe(TrackStatusEnum.RetryWaiting);
  });
  it('a successful callback without a published file cannot become Completed', async () => {
    jest.spyOn(f.youtube, 'downloadAndFormat').mockResolvedValue({ path: f.destination, created: true });
    await f.service.downloadFromYoutube(f.row);
    expect(f.row.status).toBe(TrackStatusEnum.RetryWaiting);
    expect(f.row.operationAttempts).toBe(1);
  });
  it('restores a future CLI retryAt without a new media request or consumed failure', async () => {
    const retryAt = Date.now() + 60000;
    await f.journal.save({
      key: f.key,
      url: f.row.youtubeUrl,
      state: 'retry',
      retryAt,
      networkAttempts: 2,
      error: 'Local network unavailable',
    });
    await f.service.downloadFromYoutube(f.row);
    expect(f.download.add).toHaveBeenCalledWith(
      '',
      expect.anything(),
      expect.objectContaining({ delay: expect.any(Number) }),
    );
    expect(f.row).toMatchObject({
      status: TrackStatusEnum.RetryWaiting,
      retryAt,
      networkAttempts: 2,
    });
    expect(f.transport.process).not.toHaveBeenCalled();
  });
});
