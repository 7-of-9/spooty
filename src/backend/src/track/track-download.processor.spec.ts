import { Job } from 'bullmq';
import { TrackDownloadProcessor } from './track-download.processor';
import { TrackEntity } from './track.entity';
import { TrackService } from './track.service';
import { youtubeRetryJobName } from './youtube-async-retry';

describe('TrackDownloadProcessor', () => {
  it('passes the delayed cookies-first marker to TrackService', async () => {
    const track = {
      artist: 'Artist',
      name: 'Song',
      spotifyUrl: '',
      youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
    } as TrackEntity;
    const trackService = {
      downloadFromYoutube: jest.fn().mockResolvedValue(undefined),
    } as unknown as TrackService;
    const processor = new TrackDownloadProcessor(trackService);

    await processor.process({
      data: track,
      name: youtubeRetryJobName(2, true),
    } as Job<TrackEntity, void>);

    expect(trackService.downloadFromYoutube).toHaveBeenCalledWith(
      track,
      2,
      true,
    );
  });
});
