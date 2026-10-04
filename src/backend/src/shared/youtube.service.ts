import {
  ConflictException,
  Injectable,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sourceKey } from './acquisition/identity';
import { mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { TrackEntity } from '../track/track.entity';
import { AcquisitionOwner } from './acquisition-owner';
import { webActivity } from './web-activity';
import {
  YoutubePace,
  PaceLever,
  PaceSnapshot,
  PaceStateFile,
} from './youtube-pace';
import {
  CLI_PROVEN_PROFILE,
  usesCliProvenProfile,
  webPaceDefaults,
} from './youtube-ingest-profile';
import { Transport, verifyMp3 } from './acquisition/transport';
import {
  assertDuration,
  DurationCandidates,
  DURATION_NO_CANDIDATE,
  DURATION_REJECTED,
  DURATION_SOURCE_MISSING,
} from './acquisition/duration-policy';
import { candidateLimits } from './acquisition/candidate-policy';
import { publishMp3ForTrack, PublishedMedia } from './acquisition/publication';
import { mediaFingerprint, mediaUnchanged } from './acquisition/media-file';
import { SearchDiagnostics } from './acquisition/search-diagnostics';
import { youtubeVideoId } from './youtube-download-batch';
import { UtilsService } from './utils.service';
const NodeID3 = require('node-id3');

type Work = {
  song: any;
  track?: TrackEntity;
  output?: string;
  onStart?: () => void | Promise<void>;
  onProgress?: (progress: { percentage: number }) => void;
  resolve: (value?: any) => void;
  reject: (error: unknown) => void;
};

/**
 * Nest/Bull adapter only. All YouTube subprocesses, protocol/client selection,
 * batching, duration evidence, private cookies and MP3 publication use the same
 * framework-neutral core as the CLI. No network activity occurs on construction.
 */
@Injectable()
export class YoutubeService implements OnApplicationShutdown {
  private readonly pace = new YoutubePace(webPaceDefaults());
  private readonly provenProfile = usesCliProvenProfile();
  private readonly owner: AcquisitionOwner;
  private transport: Transport;
  private candidates: DurationCandidates;
  private readonly pendingSearches: Work[] = [];
  private readonly pendingDownloads: Work[] = [];
  private readonly active = new Set<Work>();
  private readonly progress = new Map<string, Set<Work>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private shuttingDown = false;

  constructor(private readonly configService: ConfigService) {
    this.owner = new AcquisitionOwner(configService);
  }

  ownerSnapshot() {
    return this.owner.snapshot();
  }
  webQueueSnapshot() {
    return this.owner.webQueueSnapshot();
  }
  async webActivitySnapshot() {
    const queue = await this.owner.webActivityQueue();
    return queue ? webActivity.snapshot(queue) : null;
  }
  resumeWebQueues() {
    return this.owner.resumeWebQueues();
  }
  assertWebAllowed() {
    return this.owner.assertWebAllowed();
  }
  paceSnapshot(): PaceSnapshot {
    return this.pace.snapshot();
  }
  setPace(next: PaceStateFile) {
    this.pace.applyState(next);
  }
  coolOff(ms?: number, detail?: string) {
    this.pace.coolOff(ms, detail);
  }
  tripRateLimit(
    detail?: string,
    ms?: number,
    lever: PaceLever = 'downloadConc',
  ) {
    if (this.transport)
      this.transport.trip(lever === 'searchConc' ? 'search' : 'download');
    else this.pace.tripRateLimit(detail, ms, lever);
  }

  acquisitionDirectory() {
    const db = this.configService.get<string>('DB_PATH') || process.env.DB_PATH;
    return (
      this.configService.get<string>('ACQUIRE_STATE_PATH') ||
      process.env.ACQUIRE_STATE_PATH ||
      this.configService.get<string>('ACQUIRE_STATE_DIR') ||
      process.env.ACQUIRE_STATE_DIR ||
      (db
        ? join(dirname(resolve(db)), 'acquire')
        : resolve(__dirname, '../../../../data/acquire'))
    );
  }

  searchEvidence(key: string) {
    return new SearchDiagnostics(
      join(this.acquisitionDirectory(), 'search-diagnostics'),
    ).read(key);
  }

  configurationError(): string | null {
    const format =
      this.configService.get<string>('FORMAT') || process.env.FORMAT || 'mp3';
    const quality = String(
      this.configService.get('QUALITY') ?? process.env.QUALITY ?? '',
    ).trim() || '0';
    if (format !== 'mp3' || quality !== '0')
      return 'Acquisition configuration requires FORMAT=mp3 and QUALITY=0';
    // The retained shared profile owns batching (8). Legacy single-item web
    // worker env vars are not transport overrides in this mode. Rejecting them
    // stranded resumed queues before any YouTube request could start.
    for (const key of this.provenProfile ? [] : ['YT_SEARCH_BATCH_SIZE', 'YT_DOWNLOAD_BATCH_SIZE']) {
      const configured = this.configService.get(key) ?? process.env[key];
      if (configured !== undefined && String(configured).trim() !== '' && Number(configured) !== 8)
        return 'Acquisition configuration requires batch size8; remove legacy web batch overrides';
    }
    return null;
  }

  private engine(): Transport {
    if (this.transport) return this.transport;
    const configurationError = this.configurationError();
    if (configurationError) throw new Error(configurationError);
    const state = this.acquisitionDirectory();
    const root = resolve(dirname(require.resolve('ytdlp-nodejs')), '../../..');
    const temporary = join(dirname(state), 'web-acquisition-tmp');
    mkdirSync(temporary, { recursive: true });
    this.transport = new Transport(
      {
        root,
        temp: temporary,
        cookies:
          this.configService.get<string>('COOKIES_PATH') ||
          process.env.COOKIES_PATH ||
          join(root, 'cookies.txt'),
      },
      {
        authenticated: this.provenProfile,
        'pot-recovery':
          this.provenProfile ||
          /^(1|true)$/i.test(process.env.YT_POT_RECOVERY_ENABLED || ''),
        'max-searches': 10,
      },
      () => {},
      {
        pace: this.pace,
        beforeProcess: () => this.owner.assertWebAllowed(),
        onProgress: (id, percentage) => {
          for (const work of this.progress.get(id) || [])
            work.onProgress?.({ percentage });
        },
      },
    );
    return this.transport;
  }

  private rejectionLedger(): DurationCandidates {
    // Same ledger as CLI; the Redis owner and paused-queue handback prohibit
    // concurrent owners. Re-open at the start of each web workload, not boot.
    return (this.candidates ||= new DurationCandidates(
      join(this.acquisitionDirectory(), 'duration-rejections.json'),
    ));
  }

  song(track: TrackEntity): any {
    return {
      key: sourceKey(track),
      artist: track.artist,
      name: track.name,
      album: track.searchAlbum,
      durationMs: track.durationMs,
      url: track.youtubeUrl || null,
      durationCandidates: track.youtubeCandidates ?? undefined,
      searchLimit: track.searchLimit || 0,
    };
  }

  async findTrackOnYoutube(
    track: TrackEntity,
    onStart?: () => void | Promise<void>,
  ): Promise<string> {
    const song = this.song(track);
    try {
      const url = await this.enqueue('search', { song, track, onStart });
      track.youtubeUrl = url;
      return url;
    } finally {
      track.youtubeCandidates = song.durationCandidates || null;
      track.searchLimit = song.searchLimit || track.searchLimit || 0;
    }
  }

  // Compatibility facade for callers that are not a persisted TrackEntity.
  async findOnYoutubeOne(
    artist: string,
    name: string,
    onStart?: () => void | Promise<void>,
    expectedMs?: number,
    excludedIds: string[] = [],
  ): Promise<string> {
    const track: TrackEntity = {
      artist,
      name,
      spotifyUrl: null,
      durationMs: expectedMs,
    };
    const song = this.song(track);
    for (const id of excludedIds)
      this.rejectionLedger().reject({
        ...song,
        url: 'https://www.youtube.com/watch?v=' + id,
      });
    return this.enqueue('search', { song, track, onStart });
  }

  async downloadAndFormat(
    track: TrackEntity,
    output: string,
    onProgress?: (progress: { percentage: number }) => void,
    onStart?: () => void | Promise<void>,
    cookiesFirst = false,
  ): Promise<PublishedMedia> {
    // A file may have arrived after worker preparation. Existing bytes are not
    // enough: verify this source's duration before skipping the media request.
    const existing = mediaFingerprint(output);
    if (existing) {
      try {
        await this.verifyAudioDuration(output, track.durationMs);
        if (mediaUnchanged(output, existing)) return { path: output, created: false };
      } catch { /* Preserve it; a verified new source can use another filename. */ }
    }
    const song = { ...this.song(track), cookiesNext: cookiesFirst };
    return this.enqueue('download', {
      song,
      track,
      output,
      onProgress,
      onStart,
    });
  }

  /** Advance selection durably without consuming a network retry. */
  rejectCandidate(track: TrackEntity): string | null {
    const song = this.song(track);
    this.rejectionLedger().advance(song);
    track.youtubeUrl = song.url;
    return song.url;
  }

  isRejectedCandidate(track: TrackEntity, url: string): boolean {
    const song = this.song(track);
    return this.rejectionLedger()
      .rejected(song)
      .some(
        (item) =>
          youtubeVideoId(item.url) === youtubeVideoId(url) &&
          item.expectedMs === song.durationMs,
      );
  }

  private async enqueue(
    kind: 'search' | 'download',
    request: Omit<Work, 'resolve' | 'reject'>,
  ): Promise<any> {
    await this.owner.assertWebAllowed();
    if (this.shuttingDown) throw new Error('Acquisition admission cancelled');
    if (
      !(request.song.durationMs > 0) ||
      !Number.isFinite(request.song.durationMs)
    )
      throw new Error(DURATION_SOURCE_MISSING);
    const limits = candidateLimits({
      'max-searches': request.track?.maxSearches ?? 10,
      'network-retries': request.track?.networkRetryLimit ?? 5,
    });
    request.song.maxSearches = limits.maxSearches;
    // Engine construction checks compatibility but launches no child. Doing it
    // here ensures configuration failures reject a job rather than its timer.
    this.engine();
    return new Promise((resolveWork, reject) => {
      const queue =
        kind === 'search' ? this.pendingSearches : this.pendingDownloads;
      queue.push({ ...request, resolve: resolveWork, reject });
      if (!this.timers.has(kind))
        this.timers.set(
          kind,
          setTimeout(() => {
            this.timers.delete(kind);
            void this.flush(kind);
          }, 25),
        );
    });
  }

  private async flush(kind: 'search' | 'download'): Promise<void> {
    const queue =
      kind === 'search' ? this.pendingSearches : this.pendingDownloads;
    if (!queue.length) return;
    const depth = queue[0].song.maxSearches;
    const capacity =
      kind === 'download'
        ? Math.min(
            CLI_PROVEN_PROFILE.batchSize,
            this.pace.snapshot().maxPerWindow,
          )
        : CLI_PROVEN_PROFILE.batchSize;
    const work: Work[] = [];
    for (let i = 0; i < queue.length && work.length < capacity; ) {
      if (kind === 'download' || queue[i].song.maxSearches === depth)
        work.push(...queue.splice(i, 1));
      else i++;
    }
    for (const item of work) this.active.add(item);
    if (queue.length) void this.flush(kind);
    const byKey = new Map(work.map((item) => [item.song.key, item]));
    const settle = (key: string, error?: unknown, value?: any) => {
      // Duplicate songs may represent separate playlist destinations.
      for (const item of work.filter((item) => item.song.key === key)) {
        if (!this.active.delete(item)) continue;
        error ? item.reject(error) : item.resolve(value);
      }
    };
    try {
      await this.owner.assertWebAllowed();
      const engine = this.engine();
      const admitted = async (songs: any[]) => {
        for (const song of songs) await byKey.get(song.key)?.onStart?.();
      };
      if (kind === 'search') {
        const failures = await engine.search(
          work.map((item) => item.song),
          (song, url) => {
            if (!url) settle(song.key, new Error('No YouTube result'));
            else settle(song.key, undefined, url);
          },
          this.rejectionLedger(),
          admitted,
          depth,
        );
        for (const failure of failures)
          settle(failure.song.key, new Error(failure.error));
      } else {
        for (const item of work) {
          const id = youtubeVideoId(item.song.url);
          if (!this.progress.has(id)) this.progress.set(id, new Set());
          this.progress.get(id).add(item);
        }
        const failures = await engine.download(
          work.map((item) => item.song),
          async (song, stagedPath, evidence) => {
            const proof = mediaFingerprint(stagedPath);
            await this.verifyAudioDuration(stagedPath, song.durationMs);
            for (const item of work.filter(
              (item) => item.song.key === song.key,
            )) {
              const publication = publishMp3ForTrack(
                stagedPath,
                item.output,
                item.track,
                (tags, path) => NodeID3.write(tags, path),
                proof,
              );
              item.track.sourceEvidence = evidence || null;
              item.onProgress?.({ percentage: 100 });
              if (this.active.delete(item)) item.resolve(publication);
            }
          },
          admitted,
          true,
        );
        for (const failure of failures)
          settle(failure.song.key, new Error(failure.error));
      }
    } catch (error) {
      for (const item of work) settle(item.song.key, error);
    } finally {
      for (const item of work) {
        this.progress.get(youtubeVideoId(item.song.url))?.delete(item);
        if (this.active.delete(item))
          item.reject(
            new Error('YouTube attempt did not produce a verified result'),
          );
      }
    }
  }

  async verifyAudioDuration(path: string, expectedMs?: number): Promise<void> {
    assertDuration(expectedMs, await verifyMp3(path));
  }

  async addImage(
    path: string,
    url: string,
    title: string,
    artist: string,
  ): Promise<void> {
    // Optional enrichment happens after mandatory title/artist tagged publication.
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('Cover art unavailable');
    if (
      !NodeID3.update(
        { title, artist, image: Buffer.from(await response.arrayBuffer()) },
        path,
      )
    )
      throw new Error('Cover art could not be written');
  }

  async selectProvenProfile(): Promise<PaceSnapshot> {
    if (!this.provenProfile)
      throw new ConflictException(
        'Restart in cli-proven profile mode before selecting its pace',
      );
    return this.owner.withPausedWebQueues(() => {
      const state = this.pace.snapshot();
      if (
        state.active > 0 ||
        state.coolRemainingMs > 0 ||
        this.pendingDownloads.length ||
        this.pendingSearches.length
      )
        throw new ConflictException(
          'Active work or recovery cooldown prevents profile activation',
        );
      if (
        state.downloadConc <= 1 &&
        state.searchConc <= 1 &&
        state.maxPerWindow <= 8
      )
        throw new ConflictException(
          'Safety floor remains active; verified recovery is required before a measured pace increase',
        );
      this.pace.applyState({
        downloadConc: CLI_PROVEN_PROFILE.downloadConc,
        searchConc: CLI_PROVEN_PROFILE.searchConc,
        maxPerWindow: CLI_PROVEN_PROFILE.maxPerWindow,
        autoStep: false,
        reason: 'Selected retained ' + CLI_PROVEN_PROFILE.id,
      });
      return this.pace.snapshot();
    });
  }

  onApplicationShutdown() {
    this.shuttingDown = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.transport?.stopAdmissions();
    this.transport?.killChildren();
    for (const item of [
      ...this.active,
      ...this.pendingSearches.splice(0),
      ...this.pendingDownloads.splice(0),
    ])
      item.reject(new Error('Acquisition admission cancelled'));
    this.active.clear();
    this.owner.onApplicationShutdown();
  }
}
