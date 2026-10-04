import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { DelayedError, Job, Queue } from 'bullmq';
import { Optional } from '@nestjs/common';
import {
  CLI_PROVEN_PROFILE,
  usesCliProvenProfile,
  webWorkerConcurrency,
} from '../shared/youtube-ingest-profile';
import { TrackService } from './track.service';
import { TrackEntity } from './track.entity';
import { youtubeRetryAttempt } from './youtube-async-retry';
import { WorkerActivity } from './worker-activity';

/**
 * See track-download.processor.ts for why this reads `process.env` directly
 * rather than going through ConfigService.
 *
 * Eight logical jobs fill one search batch. YoutubePace limits the actual
 * search process pool separately; the durable buffer gate bounds look-ahead.
 */
const SEARCH_CONCURRENCY = webWorkerConcurrency('search');

@Processor('track-search-processor', {
  concurrency: SEARCH_CONCURRENCY,
  lockDuration: 15 * 60 * 1000,
})
export class TrackSearchProcessor extends WorkerHost {
  readonly activity = new WorkerActivity();
  constructor(
    private readonly trackService: TrackService,
    @Optional()
    @InjectQueue('track-download-processor')
    private readonly downloadQueue?: Queue,
  ) {
    super();
  }

  async process(job: Job<TrackEntity, void, string>): Promise<void> {
    return this.activity.run(() => this.processTrack(job));
  }

  private async processTrack(job: Job<TrackEntity, void, string>): Promise<void> {
    // Only duration-selected ready candidates count. Old cached URLs must not
    // fill this buffer and starve the searches needed to replace wrong sources.
    if (
      usesCliProvenProfile() &&
      (await this.trackService.preparedSearchBufferSize()) >=
        CLI_PROVEN_PROFILE.searchBuffer
    ) {
      await job.moveToDelayed(Date.now() + 30_000, job.token);
      throw new DelayedError();
    }
    await this.trackService.findOnYoutube(
      job.data,
      youtubeRetryAttempt(job.name),
    );
  }
}
