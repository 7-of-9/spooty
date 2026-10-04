import { BeforeApplicationShutdown, Injectable, Logger, OnApplicationShutdown, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { TrackSearchProcessor } from './track-search.processor';
import { TrackDownloadProcessor } from './track-download.processor';
import { ShutdownTrace } from './shutdown-trace';
import { shutdownTraceFile, workerShutdownDetails } from './shutdown-diagnostics';

/** An idle worker must not make shutdown depend on Redis coming back online. */
@Injectable()
export class WorkerShutdownService implements BeforeApplicationShutdown, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerShutdownService.name);
  private trace?: ShutdownTrace;
  constructor(
    private readonly search: TrackSearchProcessor,
    private readonly download: TrackDownloadProcessor,
    @InjectQueue('track-search-processor') private readonly searchQueue: Queue,
    @InjectQueue('track-download-processor') private readonly downloadQueue: Queue,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async beforeApplicationShutdown(): Promise<void> {
    const processors = [this.search, this.download];
    const writeTrace = shutdownTraceFile(this.config?.get<string>('DB_PATH'));
    this.trace ||= new ShutdownTrace([
      ...processors.map((processor, index) => ({
        name: index ? 'download-worker' : 'search-worker',
        closing: () => processor.worker.closing,
        activity: () => processor.activity.active,
        running: () => processor.worker.isRunning(),
        details: () => workerShutdownDetails(processor.worker),
      })),
      ...[this.searchQueue, this.downloadQueue].map((queue, index) => ({
        name: index ? 'download-producer' : 'search-producer', closing: () => queue.closing,
      })),
    ], message => { writeTrace(message); this.logger.log(message); });
    this.trace.start();
    this.logger.log(`Shutdown: search ${this.search.activity.active ? 'active' : 'idle'}, download ${this.download.activity.active ? 'active' : 'idle'}`);
    // Real operations retain Nest/Bull's graceful drain. Never force-close
    // acquisition merely because Redis is slow or a shutdown was requested.
    if (processors.some(processor => processor.activity.active)) return;
    const workers = processors.map(processor => processor.worker);
    const queues = [this.searchQueue, this.downloadQueue];
    const clients = new Map<object, { status: string; disconnect(): void }>();
    let timer: ReturnType<typeof setTimeout>;
    let ready: boolean;
    try {
      ready = await Promise.race([
        Promise.all([...workers, ...queues].map(async queue => {
          const client = await queue.client;
          clients.set(queue, client);
          return client;
        })).then(values => values.every(client => client.status === 'ready'), () => false),
        new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 300); }),
      ]);
    } finally { clearTimeout(timer); }
    if (ready) {
      this.logger.log('Redis available; retaining normal graceful worker shutdown.');
      return;
    }

    // This pauses only these local consumers, not the durable/global queues.
    // Recheck after the awaits: a job may have entered while reading clients.
    await Promise.all(workers.map(worker => worker.pause(true)));
    if (processors.some(processor => processor.activity.active)) return;
    this.logger.warn('Redis unavailable during shutdown; closing idle web workers. Queued jobs are preserved.');
    await Promise.all(workers.map(worker => worker.close(true)));
    // Queue.close() can also wait forever for an offline QUIT. Disconnect
    // these producer clients before Nest runs their normal shutdown hook.
    // Bull's Queue.disconnect() also waits for an 'end' event which may never
    // fire if the TCP socket was already lost. Ioredis.disconnect() is local
    // and synchronous. An uninitialised Queue is closed by its normal hook.
    for (const queue of queues) clients.get(queue)?.disconnect();
  }

  onApplicationShutdown(): void { this.trace?.stop(); }
}
