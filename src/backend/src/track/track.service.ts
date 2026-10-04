import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TrackEntity, TrackStatusEnum } from './track.entity';
import { PlaylistEntity } from '../playlist/playlist.entity';
import { ConfigService } from '@nestjs/config';
import { basename, dirname, join, resolve } from 'path';
import { existsSync } from 'fs';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { EnvironmentEnum } from '../environmentEnum';
import { UtilsService } from '../shared/utils.service';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { YoutubeService } from '../shared/youtube.service';
import { webActivity } from '../shared/web-activity';
import {
  isRetryableYoutubeFailure,
  MAX_YOUTUBE_ASYNC_RETRIES,
  youtubeRetryDelayMs,
  youtubeRetryJobName,
  youtubeRetryNeedsCookiesFirst,
} from './youtube-async-retry';
import { pickReusedYoutubeUrl } from './track-url-reuse';
import { WebWorkStore } from '../shared/acquisition/web-work-store';
import { classify } from '../shared/acquisition/transport';
import {
  candidateLimits,
  selectionStateOnResume,
  isCandidateOutcome,
  isNetworkFailure,
  networkFailureState,
  recordCandidateOutcome,
} from '../shared/acquisition/candidate-policy';
import {
  DURATION_NO_CANDIDATE,
  DURATION_REJECTED,
} from '../shared/acquisition/duration-policy';
import {
  isNonEmptyFile,
  reuseCompletedTrackMedia,
} from './completed-track-reuse';
import { KeyedWork } from './keyed-work';
import { SpotifyDurationService } from '../shared/spotify-duration.service';
import { durationFailure } from '../shared/youtube-duration';
import { songKey, sourceKey, sourceFileBase, sourceJournal } from '../shared/acquisition/identity';
import { LocalMediaIndex, mediaDurationCache } from '../shared/acquisition/local-media';

enum WsTrackOperation {
  New = 'trackNew',
  Update = 'trackUpdate',
  Delete = 'trackDelete',
}

export type AcquisitionOptions = {
  retryErrors?: boolean;
  retryMissing?: boolean;
  retryNoCandidate?: boolean;
  maxSearches?: number;
  networkRetries?: number;
};

@WebSocketGateway()
@Injectable()
export class TrackService {
  @WebSocketServer() io: Server;
  private readonly logger = new Logger(TrackService.name);
  private mediaIndex: { root: string; at: number; value: LocalMediaIndex } | null = null;
  private readonly keyedWork = new KeyedWork();
  private admittedCache: { at: number; ids: Set<number> } | null = null;

  private async admittedTrackIds(fresh = false): Promise<Set<number>> {
    if (
      !fresh &&
      this.admittedCache &&
      Date.now() - this.admittedCache.at < 2000
    )
      return this.admittedCache.ids;
    const client = await this.trackSearchQueue.client;
    const keys: string[] = [];
    for (const name of ['track-search-processor', 'track-download-processor'])
      for (const kind of ['wait', 'paused', 'active', 'delayed', 'prioritized'])
        keys.push(`bull:${name}:${kind}`);
    const lists = (await client.eval(
      `
      local result = {}
      for i,key in ipairs(KEYS) do
        local kind = (i-1) % 5
        result[i] = redis.call(kind < 3 and 'LRANGE' or 'ZRANGE', key, 0, -1)
      end
      return result`,
      keys.length,
      ...keys,
    )) as string[][];
    const ids = new Set<number>();
    for (const jobId of lists.flat()) {
      const match = /^id-(\d+)-/.exec(jobId);
      if (match) ids.add(Number(match[1]));
    }
    this.admittedCache = { at: Date.now(), ids };
    return ids;
  }

  private projectAdmission(track: TrackEntity, ids: Set<number>): TrackEntity {
    // Old admissions used New. Actual Bull membership is authoritative, but
    // preserved stale jobs must not reopen a parked terminal journal outcome.
    return track.status === TrackStatusEnum.New &&
      !track.acquisitionState &&
      ids.has(track.id)
      ? { ...track, status: TrackStatusEnum.Queued }
      : track;
  }

  constructor(
    @InjectRepository(TrackEntity)
    private repository: Repository<TrackEntity>,
    @InjectQueue('track-download-processor') private trackDownloadQueue: Queue,
    @InjectQueue('track-search-processor') private trackSearchQueue: Queue,
    private readonly configService: ConfigService,
    private readonly utilsService: UtilsService,
    private readonly youtubeService: YoutubeService,
    @Optional()
    private readonly spotifyDurationService?: SpotifyDurationService,
  ) {}

  async getAll(
    where?: { [key: string]: any },
    relations: Record<string, boolean> = {},
  ): Promise<TrackEntity[]> {
    const rows = await this.repository.find({ where, relations });
    const journal = new Map(
      (await this.store().all()).map((row) => [row.key, row]),
    );
    const admitted = await this.admittedTrackIds();
    return rows.map((track) =>
      this.projectAdmission(
        this.projectJournal(
          track,
          sourceJournal(track, journal),
        ),
        admitted,
      ),
    );
  }

  getAllByPlaylist(id: number): Promise<TrackEntity[]> {
    return this.repository.find({ where: { playlist: { id } } });
  }

  async getActive(): Promise<TrackEntity[]> {
    const rows = await this.getAll(
      {
        status: In([
          TrackStatusEnum.New,
          TrackStatusEnum.Searching,
          TrackStatusEnum.Queued,
          TrackStatusEnum.Downloading,
          TrackStatusEnum.RetryWaiting,
        ]),
      },
      { playlist: true },
    );
    return rows.filter((row) =>
      [
        TrackStatusEnum.Searching,
        TrackStatusEnum.Queued,
        TrackStatusEnum.Downloading,
        TrackStatusEnum.RetryWaiting,
      ].includes(row.status),
    );
  }

  get(id: number): Promise<TrackEntity | null> {
    return this.repository.findOne({ where: { id }, relations: ['playlist'] });
  }

  searchEvidence(artist: string, name: string, spotifyUrl?: string) {
    return this.youtubeService.searchEvidence(
      sourceKey({ artist, name, spotifyUrl }),
    );
  }

  async journalSnapshot(): Promise<Map<string, any>> {
    return new Map((await this.store().all()).map(row => [row.key, row]));
  }

  projectStoredOutcome(track: TrackEntity, old: any): TrackEntity {
    return this.projectJournal(track, old);
  }

  async remove(id: number): Promise<void> {
    await this.dropJobsForTrack(id);
    await this.repository.delete(id);
    this.io?.emit(WsTrackOperation.Delete, { id });
  }

  private async dropJobsForTrack(trackId: number): Promise<void> {
    const prefix = `id-${trackId}-`;
    for (const queue of [this.trackSearchQueue, this.trackDownloadQueue]) {
      try {
        const jobs = await queue.getJobs(['waiting', 'wait', 'paused', 'delayed', 'prioritized', 'active']);
        for (const job of jobs) {
          if (job?.id && String(job.id).startsWith(prefix)) {
            try { await job.remove(); } catch { /* Playlist membership and files still follow Spotify. */ }
          }
        }
      } catch { /* Redis unavailable: files still unlinked. */ }
    }
  }

  private workStore: WebWorkStore;
  private store(): WebWorkStore {
    return (this.workStore ||= new WebWorkStore(
      join(this.youtubeService.acquisitionDirectory(), 'work.sqlite'),
    ));
  }

  private async restoreJournal(track: TrackEntity): Promise<TrackEntity> {
    const key = sourceKey(track);
    const exact = await this.store().get(key);
    const legacy = !exact && key !== songKey(track.artist, track.name)
      ? await this.store().get(songKey(track.artist, track.name)) : null;
    const old = sourceJournal(track, new Map([...(exact ? [[key, exact] as [string, any]] : []),
      ...(legacy ? [[songKey(track.artist, track.name), legacy] as [string, any]] : [])]));
    return this.projectJournal(track, old);
  }

  private projectJournal(track: TrackEntity, old: any): TrackEntity {
    if (!old) return track;
    const state =
      old.state === 'no-candidate'
        ? 'no-candidate'
        : old.state === 'missing'
          ? 'missing'
          : old.state === 'retry'
            ? 'retry'
            : old.state === 'error'
              ? 'failed'
              : null;
    return {
      ...track,
      youtubeUrl: old.url || null,
      acquisitionState: state,
      error: old.error || null,
      retryAt: old.retry_at || null,
      searchLimit: old.search_limit || track.searchLimit || 0,
      networkAttempts: old.network_attempts || 0,
      operationAttempts: old.attempts || 0,
      ...(state === 'missing' || state === 'no-candidate' || state === 'failed'
        ? { status: TrackStatusEnum.Error }
        : {}),
    };
  }

  private async checkpoint(track: TrackEntity, state: string): Promise<void> {
    await this.store().save({
      key: sourceKey(track),
      url: track.youtubeUrl,
      state,
      attempts: track.operationAttempts || 0,
      retryAt: track.retryAt || 0,
      error: track.error,
      networkAttempts: track.networkAttempts || 0,
      searchLimit: track.searchLimit || 0,
    });
    await this.update(track.id, track);
    if (['ready', 'retry', 'missing', 'no-candidate', 'failed', 'error'].includes(state))
      webActivity.result(track.id, state === 'error' ? (track.acquisitionState || 'failed') : state);
  }

  private shouldSkip(track: TrackEntity, options: AcquisitionOptions): boolean {
    const max = candidateLimits({
      'max-searches': options.maxSearches ?? track.maxSearches ?? 10,
      'network-retries': options.networkRetries ?? track.networkRetryLimit ?? 5,
    }).maxSearches;
    if (
      (track.acquisitionState === 'missing' ||
        /^No YouTube result$/i.test(track.error || '')) &&
      !options.retryMissing
    )
      return true;
    if (track.acquisitionState === 'failed' && !options.retryErrors)
      return true;
    return (
      !options.retryNoCandidate &&
      selectionStateOnResume(
        {
          state: track.acquisitionState,
          error: track.error,
          search_limit: track.searchLimit,
        },
        max,
      ) === 'no-candidate'
    );
  }

  async create(
    track: TrackEntity,
    playlist?: PlaylistEntity,
    options: AcquisitionOptions = {},
  ): Promise<boolean> {
    await this.youtubeService.assertWebAllowed();
    const savedTrack = await this.repository.save({
      ...track,
      playlist,
      createdAt: track.createdAt ?? Date.now(),
    });
    this.io.emit(WsTrackOperation.New, {
      track: savedTrack,
      playlistId: playlist?.id,
    });
    return this.enqueueSaved(savedTrack, options);
  }

  async update(id: number, track: TrackEntity): Promise<void> {
    // Search-only context is intentionally not a TypeORM column. Preserve it
    // in the in-flight object, but never send it to the database update API.
    const { searchAlbum: _searchAlbum, ...persisted } = track;
    await this.repository.update(id, persisted);
    this.io.emit(WsTrackOperation.Update, track);
  }

  async retry(
    id: number,
    options: AcquisitionOptions = { retryErrors: true },
  ): Promise<boolean> {
    await this.youtubeService.assertWebAllowed();
    const track = await this.get(id);
    if (!track) return false;
    return this.enqueueSaved(track, options);
  }

  private async enqueueSaved(
    input: TrackEntity,
    options: AcquisitionOptions,
  ): Promise<boolean> {
    const local = input.playlist ? await this.localMedia(input) : null;
    if (local?.local) {
      input = { ...input, audioFilename: basename(local.local), durationMs: local.expectedMs || input.durationMs };
      await this.reconcileExistingMedia(input);
      return false;
    }
    if (local) input = { ...input, audioFilename: basename(local.destination) };
    let track = await this.restoreJournal(input);
    if (this.shouldSkip(track, options)) {
      await this.update(track.id, {
        ...track,
        status: TrackStatusEnum.Error,
        retryAt: null,
      });
      return false;
    }
    if (
      input.status === TrackStatusEnum.New &&
      (await this.admittedTrackIds(true)).has(input.id)
    ) {
      // Reconcile the old label, not the job or its already selected source.
      await this.update(track.id, { ...track, status: TrackStatusEnum.Queued });
      return false;
    }
    const limits = candidateLimits({
      'max-searches': options.maxSearches ?? track.maxSearches ?? 10,
      'network-retries': options.networkRetries ?? track.networkRetryLimit ?? 5,
    });
    track = {
      ...track,
      // Queue admission is Waiting, not never-submitted Pending. Persist before
      // adding so a fast worker cannot have its Searching/Completed state
      // overwritten by a late post-admission update.
      status: TrackStatusEnum.Queued,
      error: null,
      acquisitionState: null,
      retryAt: null,
      maxSearches: limits.maxSearches,
      networkRetryLimit: limits.networkRetries,
    };
    if (
      options.retryErrors ||
      options.retryMissing ||
      options.retryNoCandidate ||
      limits.maxSearches > (track.searchLimit || 0)
    ) {
      track.youtubeCandidates = null;
      track.youtubeUrl = null;
      track.networkAttempts = 0;
      track.operationAttempts = 0;
    }
    await this.checkpoint(track, track.youtubeUrl ? 'ready' : 'pending');
    try {
      await this.trackSearchQueue.add('', track, {
        jobId: 'id-' + track.id + '-' + Date.now(),
      });
    } catch {
      await this.checkpoint(
        {
          ...track,
          status: TrackStatusEnum.Error,
          acquisitionState: 'failed',
          error: 'Could not queue YouTube search',
        },
        'error',
      );
      throw new Error('Could not queue YouTube search');
    }
    return true;
  }

  async preparedSearchBufferSize(): Promise<number> {
    const rows = await this.repository.find({
      where: { status: TrackStatusEnum.Queued },
    });
    const keys = new Set(
      rows
        .filter((track) =>
          track.youtubeCandidates?.some(
            (candidate) => candidate.url === track.youtubeUrl,
          ),
        )
        .map((track) =>
          sourceKey(track),
        ),
    );
    return keys.size;
  }

  async findOnYoutube(track: TrackEntity, retryAttempt = 0): Promise<void> {
    return this.keyedWork.run(
      sourceKey(track),
      () => webActivity.run(track, () => this.findOnYoutubeSerial(track, retryAttempt)),
    );
  }

  private async findOnYoutubeSerial(
    track: TrackEntity,
    _legacyRetryAttempt = 0,
  ): Promise<void> {
    await this.youtubeService.assertWebAllowed();
    const prepared = await this.prepareWork(track, 'search');
    if (!prepared || prepared.completed) return;
    track = await this.restoreJournal(prepared.track);
    if (this.shouldSkip(track, {})) return;
    if (await this.deferRestoredRetry(track, 'search')) return;
    if (
      track.status === TrackStatusEnum.Searching ||
      track.status === TrackStatusEnum.RetryWaiting
    ) {
      track = { ...track, status: TrackStatusEnum.New, retryAt: null };
      await this.update(track.id, track);
    }
    try {
      track = await this.withSourceDuration(track);
      if (
        track.youtubeUrl &&
        this.youtubeService.isRejectedCandidate(track, track.youtubeUrl)
      )
        this.youtubeService.rejectCandidate(track);
      if (!track.youtubeUrl) {
        webActivity.phase(track, 'waiting-search');
        const siblings = await this.repository.find({
          where: { artist: track.artist, name: track.name },
        });
        // Never reintroduce a rejected cached source after selection advanced.
        const reused = !Array.isArray(track.youtubeCandidates)
          ? pickReusedYoutubeUrl(track, siblings)
          : null;
        track.youtubeUrl =
          reused && !this.youtubeService.isRejectedCandidate(track, reused)
            ? reused
            : await this.youtubeService.findTrackOnYoutube(track, () => {
                webActivity.phase(track, 'searching');
                return this.update(track.id, {
                  ...track,
                  status: TrackStatusEnum.Searching,
                });
              });
      }
      track = {
        ...track,
        status: TrackStatusEnum.Queued,
        error: null,
        acquisitionState: null,
        retryAt: null,
      };
      await this.checkpoint(track, 'ready');
      await this.trackDownloadQueue.add('', track, {
        jobId: 'id-' + track.id + '-' + Date.now(),
      });
      webActivity.result(track.id, 'ready');
    } catch (error) {
      await this.handleFailure(track, error, 'search');
    }
  }

  async downloadFromYoutube(
    track: TrackEntity,
    retryAttempt = 0,
    cookiesFirst = false,
  ): Promise<void> {
    return this.keyedWork.run(
      sourceKey(track),
      () => webActivity.run(track, () => this.downloadFromYoutubeSerial(track, retryAttempt, cookiesFirst)),
    );
  }

  private async downloadFromYoutubeSerial(
    track: TrackEntity,
    _legacyRetryAttempt = 0,
    cookiesFirst = false,
  ): Promise<void> {
    await this.youtubeService.assertWebAllowed();
    const prepared = await this.prepareWork(track, 'download');
    if (!prepared || prepared.completed) return;
    track = await this.restoreJournal(prepared.track);
    if (this.shouldSkip(track, {})) return;
    if (await this.deferRestoredRetry(track, 'download')) return;
    if (
      track.status === TrackStatusEnum.Downloading ||
      track.status === TrackStatusEnum.RetryWaiting
    ) {
      track = { ...track, status: TrackStatusEnum.Queued, retryAt: null };
      await this.update(track.id, track);
    }
    let destination = this.getFolderName(track, track.playlist);
    try {
      track = await this.withSourceDuration(track);
      if (
        track.youtubeUrl &&
        this.youtubeService.isRejectedCandidate(track, track.youtubeUrl)
      )
        throw new Error(DURATION_REJECTED);
      if (!track.youtubeUrl) {
        await this.trackSearchQueue.add('', track, {
          jobId: 'id-' + track.id + '-selection-' + Date.now(),
        });
        return;
      }
      webActivity.phase(track, 'waiting-download');
      const publication = await this.youtubeService.downloadAndFormat(
        track,
        destination,
        (progress) => {
          webActivity.phase(track, 'downloading', progress.percentage);
          this.io.emit('trackProgress', {
            id: track.id,
            percent: Math.round(progress.percentage),
          });
        },
        () => {
          webActivity.phase(track, 'downloading', 0);
          return this.update(track.id, {
            ...track,
            status: TrackStatusEnum.Downloading,
          });
        },
        youtubeRetryNeedsCookiesFirst(cookiesFirst, track.error || ''),
      );
      destination = publication.path;
      track.audioFilename = basename(destination);
      if (!isNonEmptyFile(destination))
        throw new Error('YouTube attempt did not produce a verified result');
      // The shared engine verified source duration and final MP3 before atomic,
      // mandatory-tagged publication. Do not run a second media pipeline here.
      await this.checkpoint(
        {
          ...track,
          status: TrackStatusEnum.Completed,
          error: null,
          acquisitionState: null,
          retryAt: null,
        },
        'done',
      );
      this.rememberCompletedAudio(track, destination);
      webActivity.result(track.id, publication.created ? 'downloaded' : 'reused');
      const coverUrl = track.coverUrl || track.playlist?.coverUrl;
      if (coverUrl && publication.created) {
        try {
          await this.youtubeService.addImage(
            destination,
            coverUrl,
            track.name,
            track.artist,
          );
        } catch {
          this.logger.warn('MP3 saved; optional cover art unavailable');
        }
      }
    } catch (error) {
      await this.handleFailure(track, error, 'download');
    }
  }

  private async handleFailure(
    track: TrackEntity,
    raw: unknown,
    kind: 'search' | 'download',
  ): Promise<void> {
    const original = this.tidyError(raw);
    webActivity.result(track.id, 'failed');
    const error = /^No YouTube result$/i.test(original)
      ? 'No YouTube result'
      : classify(original);
    if (error === 'No YouTube result') {
      await this.checkpoint(
        {
          ...track,
          youtubeUrl: null,
          status: TrackStatusEnum.Error,
          acquisitionState: 'missing',
          retryAt: null,
          error,
        },
        'missing',
      );
      return;
    }
    if (isCandidateOutcome(error)) {
      if (error === DURATION_REJECTED)
        this.youtubeService.rejectCandidate(track);
      const song = this.youtubeService.song(track);
      recordCandidateOutcome(song, {
        exhausted: error === DURATION_NO_CANDIDATE,
        coolUntil: this.youtubeService.paceSnapshot().coolUntil || 0,
      });
      const exhausted = song.state === 'no-candidate';
      const next = {
        ...track,
        youtubeUrl: song.url,
        error: song.error,
        acquisitionState: exhausted ? ('no-candidate' as const) : null,
        status: exhausted
          ? TrackStatusEnum.Error
          : song.url
            ? TrackStatusEnum.Queued
            : TrackStatusEnum.New,
        retryAt: song.retryAt || null,
      };
      await this.checkpoint(next, song.state);
      if (!exhausted) {
        const queue = song.url
          ? this.trackDownloadQueue
          : this.trackSearchQueue;
        await queue.add('', next, {
          jobId: 'id-' + track.id + '-candidate-' + Date.now(),
          delay: Math.max(0, (song.retryAt || 0) - Date.now()),
        });
      }
      return;
    }
    const network = isNetworkFailure(error);
    const attempts =
      (network ? track.networkAttempts || 0 : track.operationAttempts || 0) + 1;
    const limit = network ? (track.networkRetryLimit ?? 5) : 5;
    const terminal = network
      ? networkFailureState(attempts, limit) === 'error'
      : attempts >= limit;
    const delay = Math.max(
      Math.min(30 * 60_000, 60_000 * 2 ** Math.min(attempts - 1, 5)),
      this.youtubeService.paceSnapshot().coolRemainingMs || 0,
    );
    const next: TrackEntity = {
      ...track,
      [network ? 'networkAttempts' : 'operationAttempts']: attempts,
      error,
      acquisitionState: terminal ? 'failed' : 'retry',
      status: terminal ? TrackStatusEnum.Error : TrackStatusEnum.RetryWaiting,
      retryAt: terminal ? null : Date.now() + delay,
    };
    if (!terminal) {
      const queue =
        kind === 'search' ? this.trackSearchQueue : this.trackDownloadQueue;
      try {
        await queue.add(
          youtubeRetryJobName(
            attempts,
            youtubeRetryNeedsCookiesFirst(false, error),
          ),
          next,
          {
            jobId: 'id-' + track.id + '-' + kind + '-retry-' + next.retryAt,
            delay,
          },
        );
      } catch {
        // Never claim a retry is scheduled unless Bull accepted durable work.
        next.acquisitionState = 'failed';
        next.status = TrackStatusEnum.Error;
        next.retryAt = null;
        next.error = 'Could not schedule acquisition retry';
      }
    }
    await this.checkpoint(
      next,
      next.acquisitionState === 'retry' ? 'retry' : 'error',
    );
  }

  private async prepareWork(track: TrackEntity, kind: 'search' | 'download') {
    try {
      return await this.completeFromLocalAudio(track);
    } catch (error) {
      await this.handleFailure(track, error, kind);
      return null;
    }
  }

  private async deferRestoredRetry(
    track: TrackEntity,
    kind: 'search' | 'download',
  ): Promise<boolean> {
    if (track.acquisitionState !== 'retry' || !(track.retryAt > Date.now()))
      return false;
    const queue =
      kind === 'search' ? this.trackSearchQueue : this.trackDownloadQueue;
    await queue.add('', track, {
      jobId: 'id-' + track.id + '-' + kind + '-retry-' + track.retryAt,
      delay: track.retryAt - Date.now(),
    });
    await this.update(track.id, {
      ...track,
      status: TrackStatusEnum.RetryWaiting,
    });
    return true;
  }

  private async withSourceDuration(track: TrackEntity): Promise<TrackEntity> {
    webActivity.phase(track, 'metadata');
    if (!this.spotifyDurationService)
      throw durationFailure('Spotify source metadata service is unavailable');
    const durationMs = await this.spotifyDurationService.ensure(track);
    if (track.durationMs !== durationMs) {
      await this.repository.update(track.id, { durationMs });
    }
    return { ...track, durationMs };
  }

  private async reconcileExistingMedia(track: TrackEntity): Promise<void> {
    const completed = {
      ...track,
      status: TrackStatusEnum.Completed,
      error: null,
      acquisitionState: null,
      retryAt: null,
    };
    // Checkpoint the source, never clear another edition's legacy outcome.
    await this.checkpoint(completed, 'done');
  }

  async verifyLocalAudio(track: TrackEntity, path: string): Promise<number> {
    if (!this.spotifyDurationService)
      throw durationFailure('Spotify source metadata service is unavailable');
    const durationMs = await this.spotifyDurationService.ensure(track);
    await this.youtubeService.verifyAudioDuration(path, durationMs);
    return durationMs;
  }

  private rememberCompletedAudio(track: TrackEntity, path: string): void {
    this.mediaIndex = null;
  }

  private async completeFromLocalAudio(track: TrackEntity): Promise<{
    track: TrackEntity;
    completed: boolean;
  } | null> {
    let persisted = await this.get(track.id);
    if (!persisted) return null;
    webActivity.phase(persisted, 'preparing');
    if (!persisted.name || !persisted.artist || !persisted.playlist) {
      return { track: persisted, completed: false };
    }

    let media = await this.localMedia(persisted);
    if (media.source && media.verification === 'unverified') {
      persisted = await this.withSourceDuration(persisted);
      media = await this.localMedia(persisted);
    }
    const { source, destination } = media;
    persisted = { ...persisted, audioFilename: basename(destination), durationMs: media.expectedMs || persisted.durationMs };
    await this.repository.update(persisted.id, { audioFilename: persisted.audioFilename, durationMs: persisted.durationMs });
    if (!source) return { track: persisted, completed: false };
    webActivity.phase(persisted, 'copying');
    const savedPath = reuseCompletedTrackMedia(persisted, media, this.utilsService.getRootDownloadsPath());
    if (!savedPath) {
      return { track: persisted, completed: false };
    }

    persisted.audioFilename = basename(savedPath);
    this.rememberCompletedAudio(persisted, savedPath);
    await this.reconcileExistingMedia(persisted);
    webActivity.result(track.id, source === savedPath ? 'checked' : 'reused');
    this.logger.debug(
      `Reused local MP3 for ${persisted.artist} - ${persisted.name}`,
    );
    return { track: persisted, completed: true };
  }

  async localMedia(track: TrackEntity) {
    const root = this.utilsService.getRootDownloadsPath();
    const data = dirname(this.configService.get<string>(EnvironmentEnum.DB_PATH) || resolve(process.cwd(), 'data/spooty.sqlite'));
    if (!this.mediaIndex || this.mediaIndex.root !== root || Date.now() - this.mediaIndex.at > 30000) {
      this.mediaIndex = { root, at: Date.now(), value: new LocalMediaIndex([root],
        this.configService.get<string>('SPOTIFY_TRACK_METADATA_PATH') || process.env.SPOTIFY_TRACK_METADATA_PATH || join(data, 'spotify-track-metadata'),
        mediaDurationCache(join(data, 'media-duration-cache')),
        this.configService.get<string>(EnvironmentEnum.FORMAT) || 'mp3') };
    }
    const folder = track.playlist?.isTrack ? root : this.utilsService.getPlaylistFolderPath(track.playlist?.name || 'unknown_playlist');
    return this.mediaIndex.value.resolve(track, folder);
  }

  private tidyError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    return raw.replace(/^Error:\s*/i, '').slice(0, 280);
  }

  getTrackFileName(track: TrackEntity): string {
    const format =
      this.configService.get<string>(EnvironmentEnum.FORMAT) || 'mp3';
    if (track.audioFilename && basename(track.audioFilename) === track.audioFilename && track.audioFilename.endsWith(`.${format}`)) return track.audioFilename;
    return `${sourceFileBase(track)}.${format}`;
  }

  async addCompletedTrack(
    track: TrackEntity,
    playlist: PlaylistEntity,
  ): Promise<void> {
    // Existing physical media is historical reuse, not a new acquisition; do
    // not spend network requests or re-audit it on a normal download action.
    const durationMs = track.durationMs || null;
    const savedTrack = await this.repository.save({
      ...track,
      durationMs,
      playlist,
      status: TrackStatusEnum.Completed,
      createdAt: track.createdAt ?? Date.now(),
    });
    this.io.emit(WsTrackOperation.New, {
      track: savedTrack,
      playlistId: playlist.id,
    });
  }

  getFolderName(track: TrackEntity, playlist: PlaylistEntity): string {
    // Individual tracks (isTrack=true) go in root downloads folder, playlists in subfolders
    if (playlist?.isTrack) {
      return resolve(
        this.utilsService.getRootDownloadsPath(),
        this.getTrackFileName(track),
      );
    }

    const safePlaylistName = playlist?.name || 'unknown_playlist';
    return resolve(
      this.utilsService.getPlaylistFolderPath(safePlaylistName),
      this.getTrackFileName(track),
    );
  }
}
