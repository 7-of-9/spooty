import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { TrackService } from './track.service';
import { TrackEntity } from './track.entity';
import { webWorkerConcurrency } from '../shared/youtube-ingest-profile';
import {
  youtubeRetryAttempt,
  youtubeRetryCookiesFirst,
} from './youtube-async-retry';

/**
 * Bull owns logical song jobs. Thirty-two jobs feed four batches of eight;
 * the separate YoutubePace gate limits actual yt-dlp subprocesses to four. This
 * decorator is evaluated before Nest configuration injection exists.
 */
const DOWNLOAD_CONCURRENCY = webWorkerConcurrency('download');

@Processor('track-download-processor', {
  concurrency: DOWNLOAD_CONCURRENCY,
  lockDuration: 15 * 60 * 1000,
})
export class TrackDownloadProcessor extends WorkerHost {
  constructor(private readonly trackService: TrackService) {
    super();
  }

  async process(job: Job<TrackEntity, void>): Promise<void> {
    // Gaps and cool-off live in YoutubePace; search and download use separate slot pools.
    await this.trackService.downloadFromYoutube(
      job.data,
      youtubeRetryAttempt(job.name),
      youtubeRetryCookiesFirst(job.name),
    );
  }
}
