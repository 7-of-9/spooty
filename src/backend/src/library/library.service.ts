import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import {
  copyFileSync,
  constants,
  existsSync,
  linkSync,
  mkdirSync,
  renameSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';
import { basename, dirname, extname, join, resolve } from 'path';
import { emptyLibrarySync, LibrarySyncState, PlaylistSyncResult, SpotifyLibraryObservation, SpotifySyncScope, readLibrarySync, spotifySyncFailure, validLibraryObservation, writeLibrarySync } from './library-sync-state';
import { EnvironmentEnum } from '../environmentEnum';
import { PlaylistService } from '../playlist/playlist.service';
import { AcquisitionOptions, TrackService } from '../track/track.service';
import { TrackEntity, TrackStatusEnum } from '../track/track.entity';
import { isPermanentYoutubeMissing } from '../track/youtube-async-retry';
import { UtilsService } from '../shared/utils.service';
import {
  SpotifyApiService,
  SpotifyTrackList,
} from '../shared/spotify-api.service';
import { CdpProxyClient } from '../shared/cdp-proxy.client';
import { isCandidateOutcome } from '../shared/acquisition/candidate-policy';
import { hasCompleteSpotifyMembership, SpotifyMembership } from '../shared/spotify-membership';
import { materializeForTrack, unpublishPlaylistCopies } from '../shared/acquisition/publication';
import { webAdmission } from '../shared/web-admission-state';
import { DownloadRequestStore } from './download-request-store';
import { songKey, sourceKey, sourceJournal, trackSourceId } from '../shared/acquisition/identity';
import { LocalMediaIndex, MediaResolution, mediaDurationCache } from '../shared/acquisition/local-media';
import { CoveragePlaylist, CoverageProgress, LibraryCoverageScan, LibraryViewTrack } from './library-coverage-scan';
import { LibraryChangeWatch, LibraryChanges, LibraryWatchPaths } from './library-change-watch';
import {
  playlistAttribution,
  PlaylistOwner,
} from '../shared/spotify-playlist-owner';

export interface StaticTrack {
  n?: number;
  name?: string;
  artist?: string;
  href?: string;
  id?: string;
  coverUrl?: string;
  durationMs?: number;
}

interface ScrapedPlaylistResult {
  tracks: StaticTrack[];
  expectedCount: number | null;
  truncated: boolean;
}

export interface StaticPlaylistFile {
  name?: string;
  id?: string;
  uri?: string;
  rank?: number;
  skipped?: boolean;
  skipReason?: string;
  trackCount?: number;
  tracks?: StaticTrack[];
  lastPlayedAt?: string | null;
  syncedAt?: string | null;
  snapshotId?: string | null;
  membership?: SpotifyMembership;
  subtitle?: string;
  owner?: PlaylistOwner | null;
}

export interface LibraryPlaylist {
  uri: string;
  id: string;
  name: string;
  rank: number;
  skipped: boolean;
  skipReason?: string;
  trackCount: number;
  onDisk: number;
  available: number;
  percentOnDisk: number;
  percentAvailable: number;
  file: string;
  spotifyUrl: string;
  failed: number;
  done: boolean;
  lastPlayedAt?: string | null;
  syncedAt?: string | null;
  owner?: PlaylistOwner | null;
  personalizedFor?: string | null;
  membershipVerified?: boolean;
  excludedItems?: number;
  coveragePending?: number;
  libraryPresence?: { state: 'present' | 'not-returned'; checkedAt: string };
}

export interface LibraryListResponse {
  coverage?: CoverageProgress;
  playlists: LibraryPlaylist[];
  totals: {
    playlists: number;
    tracks: number;
    onDisk: number;
    available: number;
  };
}

const AUDIO_EXT = new Set([
  '.mp3',
  '.m4a',
  '.flac',
  '.opus',
  '.ogg',
  '.wav',
  '.aac',
]);

@Injectable()
@WebSocketGateway()
export class LibraryService {
  @WebSocketServer() io?: Server;
  private readonly logger = new Logger(LibraryService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly playlistService: PlaylistService,
    private readonly trackService: TrackService,
    private readonly utilsService: UtilsService,
    private readonly spotifyApiService: SpotifyApiService,
    private readonly cdpProxy: CdpProxyClient,
  ) {
    const dbPath = this.configService.get<string>(EnvironmentEnum.DB_PATH);
    this.syncStatusFile = dbPath ? join(dirname(resolve(dbPath)), 'spotify-library-sync.json') : null;
    try {
      this.librarySync = readLibrarySync(this.syncStatusFile);
      // Persist the interrupted result once; future page/server reloads must
      // not resurrect the pre-restart running flag.
      if (this.librarySync.finishedAt) this.persistLibrarySync();
    } catch (error) {
      this.logger.warn(`Could not restore Spotify sync status: ${error}`);
    }
  }

  private staticPlaylistsDir(): string {
    const configured = this.configService.get<string>(
      EnvironmentEnum.STATIC_PLAYLISTS_PATH,
    );
    if (configured) return resolve(configured);
    return resolve(process.cwd(), '../../PLAYLISTS_2026-09-08/playlists');
  }

  private extraScanDirs(): string[] {
    const root = this.utilsService.getRootDownloadsPath();
    const extras = [root, resolve(root, '..', '2024')];
    return extras.filter((d, i, arr) => existsSync(d) && arr.indexOf(d) === i);
  }

  private indexAudioFiles(): LocalMediaIndex {
    const data = dirname(this.configService.get<string>(EnvironmentEnum.DB_PATH) || resolve(process.cwd(), 'data/spooty.sqlite'));
    return new LocalMediaIndex(this.extraScanDirs(),
      this.configService.get<string>('SPOTIFY_TRACK_METADATA_PATH') || process.env.SPOTIFY_TRACK_METADATA_PATH || join(data, 'spotify-track-metadata'),
      mediaDurationCache(join(data, 'media-duration-cache')),
      this.configService.get<string>(EnvironmentEnum.FORMAT) || 'mp3');
  }

  private readPlaylistFile(filePath: string): StaticPlaylistFile | null {
    try {
      return JSON.parse(readFileSync(filePath, 'utf8')) as StaticPlaylistFile;
    } catch (err) {
      this.logger.warn(`Bad playlist JSON ${filePath}: ${err}`);
      return null;
    }
  }

  private writePlaylistFile(
    filePath: string,
    playlist: StaticPlaylistFile,
  ): void {
    const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(temp, JSON.stringify(playlist, null, 2));
    renameSync(temp, filePath);
    this.libraryRevision++;
    this.coverageScan?.cancel();
  }

  private isExcludedName(name: string): boolean {
    const n = (name || '').trim();
    // Spotify-generated rotating mixes. Radio playlists stay.
    if (/^daily mix(es)?\b/i.test(n)) return true;
    if (/^dj$/i.test(n)) return true;
    if (/^discover weekly$/i.test(n)) return true;
    if (/^release radar$/i.test(n)) return true;
    if (/^on repeat$/i.test(n)) return true;
    if (/^repeat rewind$/i.test(n)) return true;
    if (/^(your )?daily drive$/i.test(n)) return true;
    return false;
  }

  private onDiskFile(folder: string, base: string): string | null {
    for (const ext of AUDIO_EXT) {
      const full = join(folder, `${base}${ext}`);
      if (this.isNonEmptyFile(full)) return full;
    }
    return null;
  }

  private isNonEmptyFile(path: string): boolean {
    try {
      if (!existsSync(path)) return false;
      const stat = statSync(path);
      return stat.isFile() && stat.size > 0;
    } catch {
      return false;
    }
  }

  private async jobByKey(): Promise<(track: any) => TrackEntity | undefined> {
    const jobs = await this.trackService.getAll();
    const journal = await this.trackService.journalSnapshot?.() || new Map();
    const map = new Map<string, TrackEntity>();
    const rank = (status?: TrackStatusEnum): number => {
      switch (status) {
        case TrackStatusEnum.Completed:
          return 7;
        case TrackStatusEnum.Downloading:
          return 6;
        case TrackStatusEnum.Queued:
          return 5;
        case TrackStatusEnum.Searching:
          return 4;
        case TrackStatusEnum.RetryWaiting:
          return 3;
        case TrackStatusEnum.New:
          return 2;
        case TrackStatusEnum.Error:
          return 1;
        default:
          return 0;
      }
    };
    for (const job of jobs) {
      const key = sourceKey(job);
      const current = map.get(key);
      if (key && (!current || rank(job.status) > rank(current.status))) {
        map.set(key, job);
      }
    }
    return track => {
      const key = sourceKey(track);
      const current = map.get(key);
      const old = sourceJournal(track, journal);
      return old ? this.trackService.projectStoredOutcome(current || {
        artist: track.artist, name: track.name, status: TrackStatusEnum.New,
        spotifyUrl: trackSourceId(track) ? `https://open.spotify.com/track/${trackSourceId(track)}` : null,
      }, old) : current;
    };
  }

  private playlistId(raw: StaticPlaylistFile, file: string): string | null {
    if (raw.id) return raw.id;
    if (raw.uri && raw.uri.startsWith('spotify:playlist:')) {
      return raw.uri.split(':').pop() || null;
    }
    const m = file.match(/^[0-9]+_(.+)\.json$/);
    return m ? m[1] : null;
  }

  private coverageScan: LibraryCoverageScan | null = null;
  private libraryRevision = 0;
  private coverageStarting: Promise<LibraryCoverageScan> | null = null;
  private coverageWatch: LibraryChangeWatch | null = null;
  private coverageToken: object | null = null;
  private coverageDisposed = false;
  private coverageChanges: Promise<void> = Promise.resolve();
  private coverageContext: { token: object; audio: LocalMediaIndex; refreshJobs: () => Promise<void>; project: (row: LibraryViewTrack) => LibraryViewTrack } | null = null;

  onModuleDestroy(): void {
    this.coverageDisposed = true;
    this.coverageToken = null;
    this.coverageWatch?.close();
    this.coverageScan?.cancel();
  }

  private createCoverageWatch(paths: LibraryWatchPaths, notify: (changes: LibraryChanges) => void): LibraryChangeWatch {
    return new LibraryChangeWatch(paths, notify);
  }

  private emitCoverage(): void {
    this.io?.emit('libraryCoverageChanged', { id: this.coverageScan?.id || null, invalidated: this.coverageScan?.invalidated || false });
  }

  private async applyCoverageChanges(changes: LibraryChanges, token: object): Promise<void> {
    if (this.coverageStarting) await this.coverageStarting;
    if (token !== this.coverageToken || !this.coverageScan || this.coverageScan.invalidated) return;
    if (changes.failed) this.coverageScan.updates = 'manual';
    if (changes.membership) {
      this.libraryRevision++;
      this.coverageScan.cancel();
      this.emitCoverage();
      return;
    }
    const context = this.coverageContext;
    if (!context || context.token !== token) return;
    const keys = new Set(changes.sources);
    for (const path of changes.media) context.audio.refreshPath(path).forEach(key => keys.add(key));
    const next = this.coverageScan.changes(keys);
    if (next) {
      this.coverageScan = next;
      next.finished.then(() => { if (this.coverageScan === next && token === this.coverageToken) this.emitCoverage(); });
      this.emitCoverage();
    }
    if (changes.workflow) {
      await context.refreshJobs();
      if (context !== this.coverageContext || token !== this.coverageToken || this.coverageScan.invalidated) return;
      this.coverageScan.updateWorkflow(context.project);
      this.emitCoverage();
    }
    if (changes.failed) this.emitCoverage();
  }

  private workflowFields(job: any, onDisk: boolean) {
    return {
      acquisitionState: !onDisk ? job?.acquisitionState : null, retryAt: !onDisk ? job?.retryAt : null,
      searchLimit: job?.searchLimit, networkAttempts: job?.networkAttempts, operationAttempts: job?.operationAttempts,
      error: !onDisk && (job?.status === TrackStatusEnum.Error || job?.status === TrackStatusEnum.RetryWaiting) ? job.error : undefined,
      missing: !onDisk && job?.status === TrackStatusEnum.Error ? isPermanentYoutubeMissing(job.error) : undefined,
    };
  }

  private viewTrack(t: StaticTrack, media: MediaResolution | null, job: any): LibraryViewTrack {
    const disk = media?.local;
    const format = this.configService.get<string>(EnvironmentEnum.FORMAT) || 'mp3';
    const id = trackSourceId(t);
    return {
      n: t.n, name: t.name!, artist: t.artist!, sourceKey: sourceKey(t),
      spotifyUrl: id ? `https://open.spotify.com/track/${id}` : null,
      durationMs: media?.expectedMs || null, mediaVerification: media?.verification || 'checking',
      onDisk: !!disk, available: !!disk || !!media?.source,
      filename: disk ? basename(disk) : `${this.utilsService.trackFileBase(t.artist!, t.name!)}.${format}`,
      ...this.workflowFields(job, !!disk),
    };
  }

  private async buildCoverageScan(destination: string): Promise<LibraryCoverageScan> {
    const dir = this.staticPlaylistsDir();
    const db = resolve(this.configService.get<string>(EnvironmentEnum.DB_PATH) || process.env.DB_PATH || 'data/spooty.sqlite');
    const data = dirname(db);
    const token = this.coverageToken = {};
    this.coverageWatch?.close();
    const paths = {
      media: this.extraScanDirs(), playlists: dir, settings: join(data, 'settings.json'),
      metadata: this.configService.get<string>('SPOTIFY_TRACK_METADATA_PATH') || process.env.SPOTIFY_TRACK_METADATA_PATH || join(data, 'spotify-track-metadata'),
      databases: [db, join(this.configService.get<string>('ACQUIRE_STATE_PATH') || process.env.ACQUIRE_STATE_PATH ||
        this.configService.get<string>('ACQUIRE_STATE_DIR') || process.env.ACQUIRE_STATE_DIR || join(data, 'acquire'), 'work.sqlite')],
    };
    this.coverageWatch = this.createCoverageWatch(paths, changes => {
      this.coverageChanges = this.coverageChanges.then(() => this.applyCoverageChanges(changes, token)).catch(() => {
        if (token === this.coverageToken && this.coverageScan) { this.coverageScan.updates = 'manual'; this.emitCoverage(); }
      });
    });
    const audio = this.indexAudioFiles();
    let jobs = await this.jobByKey();
    if (this.coverageDisposed || token !== this.coverageToken) throw new HttpException('Saved-file checking stopped with the server', HttpStatus.SERVICE_UNAVAILABLE);
    this.coverageContext = { token, audio, refreshJobs: async () => { jobs = await this.jobByKey(); },
      project: row => ({ ...row, ...this.workflowFields(jobs(row), row.onDisk) }) };
    const records: CoveragePlaylist[] = [];
    const files = existsSync(dir) ? readdirSync(dir).filter(file => file.endsWith('.json')) : [];
    for (const file of files) {
      const raw = this.readPlaylistFile(join(dir, file));
      if (!raw) continue;
      const id = this.playlistId(raw, file);
      if (!id) continue;
      const name = raw.name || id;
      if (this.isExcludedName(name) || raw.skipped) continue;
      const tracks = (raw.tracks || []).filter(track => track.artist && track.name);
      const folder = this.utilsService.getPlaylistFolderPath(name);
      const membershipVerified = hasCompleteSpotifyMembership(raw.membership, id, tracks);
      records.push({
        playlist: { ...playlistAttribution(raw), id, uri: raw.uri || `spotify:playlist:${id}`, name,
          rank: raw.rank || 0, skipped: false, trackCount: tracks.length,
          onDisk: 0, available: 0, failed: 0, done: false, percentOnDisk: 0, percentAvailable: 0,
          lastPlayedAt: raw.lastPlayedAt || null, syncedAt: raw.syncedAt || null, membershipVerified,
          excludedItems: membershipVerified ? raw.membership!.excludedItemCount : undefined,
          file, spotifyUrl: `https://open.spotify.com/playlist/${id}` },
        tracks: tracks.map(track => this.viewTrack(track, null, jobs(track))),
        resolve: tracks.map(track => async () => this.viewTrack(track, await audio.resolve(track, folder), jobs(track))),
      });
    }
    records.sort((a, b) => a.playlist.rank - b.playlist.rank || a.playlist.name.localeCompare(b.playlist.name));
    const scan = new LibraryCoverageScan(records, destination);
    scan.updates = this.coverageWatch.live ? 'live' : 'manual';
    return scan;
  }

  private async ensureCoverageScan(refresh: boolean): Promise<LibraryCoverageScan> {
    if (this.coverageDisposed) throw new HttpException('Saved-file checking stopped with the server', HttpStatus.SERVICE_UNAVAILABLE);
    const destination = resolve(this.utilsService.getRootDownloadsPath());
    if (this.coverageStarting) {
      const scan = await this.coverageStarting;
      if (!scan.invalidated && scan.destination === destination && destination === resolve(this.utilsService.getRootDownloadsPath())) return scan;
      // Another caller may already be creating the replacement generation.
      // Re-enter the single-flight gate instead of overwriting its promise.
      return this.ensureCoverageScan(refresh);
    }
    if (this.coverageScan?.destination === destination && !this.coverageScan.invalidated && (this.coverageScan.running || !refresh)) return this.coverageScan;
    this.coverageScan?.cancel();
    const revision = this.libraryRevision;
    this.coverageStarting = this.buildCoverageScan(destination);
    try {
      const scan = await this.coverageStarting;
      if (revision === this.libraryRevision && destination === resolve(this.utilsService.getRootDownloadsPath())) return this.coverageScan = scan;
      scan.cancel();
    }
    finally { this.coverageStarting = null; }
    return this.ensureCoverageScan(true);
  }

  private observedScan(id: string): LibraryCoverageScan {
    if (!this.coverageScan || this.coverageScan.invalidated || this.coverageScan.id !== id || this.coverageScan.destination !== resolve(this.utilsService.getRootDownloadsPath())) {
      throw new ConflictException('Saved-file check changed; reload the saved library. No download has started.');
    }
    return this.coverageScan;
  }

  async view(scanId?: string, refresh = false): Promise<LibraryListResponse> {
    if (scanId !== undefined) return this.withLibraryObservation(this.observedScan(scanId).snapshot());
    const scan = await this.ensureCoverageScan(refresh);
    // Warm reads usually finish within this short grace period. Cold reads
    // return metadata/progress instead of holding HTTP open through ffprobe.
    await new Promise<void>(yes => {
      const timer = setTimeout(yes, 75);
      scan.finished.then(() => { clearTimeout(timer); yes(); });
    });
    if (scan.invalidated) return this.view();
    return this.withLibraryObservation(scan.snapshot());
  }

  async viewDetail(id: string, scanId: string) {
    const result = this.observedScan(scanId).detail(id);
    if (!result) throw new NotFoundException(`Playlist ${id} not found in saved library`);
    return { ...result, playlist: this.withLibraryPresence(result.playlist) };
  }

  async list(): Promise<LibraryListResponse> {
    const scan = await this.ensureCoverageScan(true);
    await scan.finished;
    const result = scan.snapshot();
    if (result.coverage?.state === 'failed') throw new Error('Saved-file check failed; no missing-file conclusion is valid');
    return this.withLibraryObservation(result);
  }

  async detail(id: string): Promise<{
    playlist: LibraryPlaylist;
    tracks: Array<{
      n?: number;
      name: string;
      artist: string;
      sourceKey: string;
      spotifyUrl: string | null;
      durationMs: number | null;
      mediaVerification: string;
      onDisk: boolean;
      available: boolean;
      filename: string;
      error?: string;
      missing?: boolean;
    }>;
  }> {
    const dir = this.staticPlaylistsDir();
    const audio = this.indexAudioFiles();
    const jobs = await this.jobByKey();
    const format =
      this.configService.get<string>(EnvironmentEnum.FORMAT) || 'mp3';
    const files = existsSync(dir)
      ? readdirSync(dir).filter((f) => f.endsWith('.json'))
      : [];
    for (const file of files) {
      const raw = this.readPlaylistFile(join(dir, file));
      if (!raw) continue;
      const pid = this.playlistId(raw, file);
      if (
        !pid ||
        (pid !== id && raw.uri !== id && raw.uri !== `spotify:playlist:${id}`)
      ) {
        continue;
      }
      const name = raw.name || pid;
      const uri = raw.uri || `spotify:playlist:${pid}`;
      const skipped = !!raw.skipped;
      const folder = this.utilsService.getPlaylistFolderPath(name);
      const tracks = await Promise.all((raw.tracks || [])
        .filter((t) => t.artist && t.name)
        .map(async (t) => this.viewTrack(t, await audio.resolve(t, folder), jobs(t))));
      const onDisk = tracks.filter((t) => t.onDisk).length;
      const available = tracks.filter((t) => t.available).length;
      const failed = tracks.filter((t) => !t.onDisk && t.missing).length;
      const trackCount = skipped && tracks.length === 0 ? 0 : tracks.length;
      const membershipVerified = hasCompleteSpotifyMembership(raw.membership, pid, raw.tracks || []);
      return {
        playlist: this.withLibraryPresence({
          ...playlistAttribution(raw),
          uri,
          id: pid,
          name,
          rank: raw.rank || 0,
          skipped,
          skipReason: raw.skipReason,
          trackCount,
          onDisk,
          available,
          failed,
          done: trackCount > 0 && onDisk + failed >= trackCount,
          percentOnDisk: trackCount
            ? Math.round((onDisk / trackCount) * 100)
            : 0,
          percentAvailable: trackCount
            ? Math.round((available / trackCount) * 100)
            : 0,
          lastPlayedAt: raw.lastPlayedAt || null,
          syncedAt: raw.syncedAt || null,
          membershipVerified,
          excludedItems: membershipVerified ? raw.membership!.excludedItemCount : undefined,
          file,
          spotifyUrl: `https://open.spotify.com/playlist/${pid}`,
        }),
        tracks,
      };
    }
    throw new NotFoundException(`Playlist ${id} not found in static library`);
  }

  async resolveAudioPath(
    playlistId: string,
    n: number,
  ): Promise<{ path: string; filename: string }> {
    const dir = this.staticPlaylistsDir();
    const files = existsSync(dir)
      ? readdirSync(dir).filter((f) => f.endsWith('.json'))
      : [];
    for (const file of files) {
      const raw = this.readPlaylistFile(join(dir, file));
      if (!raw) continue;
      const pid = this.playlistId(raw, file);
      if (
        !pid ||
        (pid !== playlistId && raw.uri !== `spotify:playlist:${playlistId}`)
      ) {
        continue;
      }
      const name = raw.name || pid;
      const folder = this.utilsService.getPlaylistFolderPath(name);
      const root = resolve(this.utilsService.getRootDownloadsPath());
      const track = (raw.tracks || []).find(
        (t) => t.n === n && t.artist && t.name,
      );
      if (!track) break;
      const disk = (await this.indexAudioFiles().resolve(track, folder)).local;
      if (!disk) {
        throw new NotFoundException('No audio file on disk for that track');
      }
      const resolved = resolve(disk);
      if (resolved !== root && !resolved.startsWith(root + '/')) {
        throw new NotFoundException('Invalid audio path');
      }
      return { path: resolved, filename: basename(resolved) };
    }
    throw new NotFoundException(`Playlist ${playlistId} not found`);
  }

  async download(
    uris: string[],
    options: AcquisitionOptions = {},
    requestId?: string,
  ): Promise<{ queued: number; skipped: number; reused?: number }> {
    if (requestId) return this.downloadRequests().run(requestId, {
      scope: 'selected', uris, options, destination: this.utilsService.getRootDownloadsPath(),
    }, () => webAdmission.run(() => this.prepareDownloads(uris, options)));
    return webAdmission.run(() => this.prepareDownloads(uris, options));
  }

  private requestStore: DownloadRequestStore | null = null;
  private downloadRequests(): DownloadRequestStore {
    const db = this.configService.get<string>(EnvironmentEnum.DB_PATH);
    if (!db) throw new Error('DB_PATH is required for durable download receipts');
    return this.requestStore ||= new DownloadRequestStore(join(dirname(resolve(db)), 'download-requests'));
  }

  downloadRequestStatus(id: string) { return this.downloadRequests().get(id); }

  private async prepareDownloads(
    uris: string[], options: AcquisitionOptions,
  ): Promise<{ queued: number; skipped: number; reused?: number }> {
    const dir = this.staticPlaylistsDir();
    const audio = this.indexAudioFiles();
    const wanted = new Set(uris);
    let queued = 0;
    let skipped = 0;
    let reused = 0;
    let done = 0;
    const files = existsSync(dir)
      ? readdirSync(dir).filter((f) => f.endsWith('.json'))
      : [];

    const plans = files.flatMap(file => {
      const raw = this.readPlaylistFile(join(dir, file));
      if (!raw || raw.skipped) return [];
      const id = this.playlistId(raw, file);
      if (!id) return [];
      const uri = raw.uri || `spotify:playlist:${id}`;
      if (!wanted.has(uri) && !wanted.has(id)) return [];
      const name = raw.name || id;
      if (this.isExcludedName(name)) return [];
      return [{ raw, id, name, tracks: (raw.tracks || []).filter(t => t.artist && t.name) }];
    });
    webAdmission.update({ total: plans.reduce((sum, plan) => sum + plan.tracks.length, 0) });
    for (const { raw, id, name, tracks } of plans) {
      webAdmission.update({ playlist: name, artist: '', name: '', phase: 'checking' });
      const spotifyUrl = `https://open.spotify.com/playlist/${id}`;
      let playlist = await this.playlistService.findBySpotifyUrl(spotifyUrl);
      if (!playlist) {
        playlist = await this.playlistService.save({
          name,
          spotifyUrl,
          active: false,
          isTrack: false,
        } as any);
      }
      const folder = this.utilsService.getPlaylistFolderPath(name);
      if (!existsSync(folder)) mkdirSync(folder, { recursive: true });

      const existing = new Map(
        (playlist.tracks || []).map((t) => [
          sourceKey(t),
          t,
        ]),
      );

      const prepared = new Set<string>();
      for (const track of tracks) {
        webAdmission.update({ artist: track.artist, name: track.name, phase: 'checking' });
        const fileKey = sourceKey(track);
        if (prepared.has(fileKey)) { skipped++; webAdmission.update({ done: ++done }); continue; }
        prepared.add(fileKey);
        const prior = existing.get(fileKey);
        const fileBase = this.utilsService.trackFileBase(
          track.artist,
          track.name,
        );
        const format =
          this.configService.get<string>(EnvironmentEnum.FORMAT) || 'mp3';
        const media = await audio.resolve(track, folder);
        const dest = media.destination;
        const alreadyHere = !!media.local;
        const source = media.source;

        const payload = {
          artist: track.artist,
          name: track.name,
          spotifyUrl:
            track.href ||
            (track.id ? `https://open.spotify.com/track/${track.id}` : null),
          durationMs: media.expectedMs || null,
          audioFilename: basename(dest),
          coverUrl: track.coverUrl || playlist.coverUrl,
        };

        if (source && (!alreadyHere || media.verification !== 'duration-match')) {
          webAdmission.update({ phase: 'verifying' });
          try {
            payload.durationMs = await this.trackService.verifyLocalAudio(
              payload,
              source,
            );
          } catch {
            // A bad/unknown local source remains untouched. Let the durable
            // worker record a needs-retry outcome rather than copy it as success.
            if (prior?.id) await this.trackService.update(prior.id, { ...prior, ...payload });
            const added = prior?.id
              ? await this.trackService.retry(prior.id, options)
              : await this.trackService.create(payload, playlist, options);
            added ? queued++ : skipped++;
            webAdmission.update({ done: ++done });
            continue;
          }
        }

        if (source) {
          if (!alreadyHere) webAdmission.update({ phase: 'copying' });
          const copied = materializeForTrack(source, [dest], payload, {
            source: media.sourceFingerprint,
            local: media.local ? { [media.local]: media.localFingerprint } : {},
          });
          payload.audioFilename = basename(copied.destinations[0]);
          reused += copied.added;
        }

        webAdmission.update({ phase: 'queueing' });
        if (source || alreadyHere) {
          if (prior?.id) {
            if (prior.status !== TrackStatusEnum.Completed || prior.error ||
                prior.audioFilename !== payload.audioFilename || prior.durationMs !== payload.durationMs ||
                prior.acquisitionState || prior.retryAt) {
              await this.trackService.update(prior.id, {
                ...prior,
                ...payload,
                durationMs: payload.durationMs || prior.durationMs,
                status: TrackStatusEnum.Completed,
                error: null,
                acquisitionState: null,
                retryAt: null,
              });
            }
          } else {
            await this.trackService.addCompletedTrack(payload, playlist);
          }
          skipped++;
        } else if (prior) {
          if (
            (prior.status === TrackStatusEnum.New ||
              prior.status === TrackStatusEnum.Error ||
              prior.acquisitionState === 'no-candidate' ||
              isCandidateOutcome(prior.error) ||
              prior.status === TrackStatusEnum.Completed) &&
            prior.id
          ) {
            if (
              prior.status === TrackStatusEnum.Error &&
              options.retryMissing === false &&
              isPermanentYoutubeMissing(prior.error)
            ) {
              skipped++;
            } else {
              await this.trackService.update(prior.id, { ...prior, ...payload });
              const added = await this.trackService.retry(prior.id, options);
              added ? queued++ : skipped++;
            }
          } else {
            skipped++;
          }
        } else {
          const added = await this.trackService.create(
            payload,
            playlist,
            options,
          );
          added ? queued++ : skipped++;
        }
        if (!prior) existing.set(fileKey, payload as any);
        webAdmission.update({ done: ++done });
      }
    }

    if (queued === 0 && skipped === 0 && uris.length) {
      throw new NotFoundException(
        'No matching static playlists for those URIs',
      );
    }
    this.logger.debug(`Library download queued=${queued} skipped=${skipped}`);
    // Keep skipped's compatibility meaning, but distinguish newly materialized
    // local copies from genuine no-op entries in the web acknowledgement.
    return { queued, skipped, ...(reused ? { reused } : {}) };
  }

  async resync(id: string): Promise<PlaylistSyncResult> {
    const current = this.playlistSyncs.get(id);
    if (current) return current;
    const work = this.resyncPlaylist(id).finally(() => this.playlistSyncs.delete(id));
    this.playlistSyncs.set(id, work);
    return work;
  }

  private readonly playlistSyncs = new Map<string, Promise<PlaylistSyncResult>>();

  private async resyncPlaylist(id: string): Promise<PlaylistSyncResult> {
    const dir = this.staticPlaylistsDir();
    if (!existsSync(dir)) {
      throw new NotFoundException('Static playlists path missing');
    }
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const full = join(dir, file);
      const raw = this.readPlaylistFile(full);
      if (!raw) continue;
      const pid = this.playlistId(raw, file);
      if (!pid || (pid !== id && raw.uri !== `spotify:playlist:${id}`)) {
        continue;
      }
      const name = raw.name || pid;
      if (this.isExcludedName(name) || raw.skipped) {
        throw new NotFoundException('That playlist is excluded');
      }
      const before = (raw.tracks || []).filter(
        (t) => t.artist && t.name,
      ).length;
      const spotifyUrl = `https://open.spotify.com/playlist/${pid}`;
      let fetched: SpotifyTrackList = [];
      let verifiedMembership = false;
      let apiFailure = '';
      /* Array element shape is supplied by SpotifyApiService. */
      let fetchedRows: Array<{
        id?: string;
        name?: string;
        artist?: string;
        coverUrl?: string;
        n?: number;
        href?: string;
        durationMs?: number;
      }> = fetched;
      try {
        const known = new Map(
          (raw.tracks || [])
            .filter((t) => t.id && t.name && t.artist)
            .map((t) => [t.id as string, t]),
        );
        fetched = await this.spotifyApiService.getAllPlaylistTracks(
          spotifyUrl,
          known,
        );
        fetchedRows = fetched;
      } catch (err) {
        apiFailure = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Spotify API resync failed for ${pid}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
      if (/CDP.*(?:down|unavailable|not connected|disconnected)|Chrome (?:bridge|connection)/i.test(apiFailure)) {
        throw new HttpException('The Chrome connection for Spotify is unavailable. Saved membership kept.', HttpStatus.SERVICE_UNAVAILABLE);
      }
      // An explicitly incomplete API result must never be rescued by a page
      // scrape that merely happens to have the expected number of rows.
      if (fetched.truncated) {
        throw new HttpException(
          `Could not load the live Spotify track list: incomplete response for ${pid}. Saved membership kept.`,
          HttpStatus.BAD_GATEWAY,
        );
      }
      verifiedMembership = hasCompleteSpotifyMembership(fetched.membership, pid, fetchedRows);
      if (fetched.membership && !verifiedMembership) {
        throw new HttpException('Spotify membership evidence did not match the returned tracks. Saved membership kept.', HttpStatus.BAD_GATEWAY);
      }
      // Session/spclient returns the full list. HTML scrape is last resort.
      if (!fetchedRows.length && !verifiedMembership) {
        try {
          const scraped = await this.scrapePlaylistPage(pid);
          if (scraped.truncated) {
            throw new Error(
              `Spotify page scrape was incomplete for ${pid}: ${scraped.tracks.length}/${scraped.expectedCount ?? 'unknown'} tracks`,
            );
          }
          if (scraped.tracks.length > fetchedRows.length) {
            fetchedRows = scraped.tracks;
          }
        } catch (err) {
          this.logger.warn(
            `Playlist page scrape failed for ${pid}: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }
      if (!fetchedRows.length && !verifiedMembership) {
        throw new HttpException(
          'Could not load the live Spotify track list (API quota and page scrape both failed)',
          HttpStatus.BAD_GATEWAY,
        );
      }
      const tracks: StaticTrack[] = fetchedRows
        .filter((t) => t?.name && t?.artist)
        .map((t, i) => ({
          n: t.n || i + 1,
          name: t.name,
          artist: t.artist,
          id: t.id,
          href:
            t.href ||
            (t.id ? `https://open.spotify.com/track/${t.id}` : undefined),
          coverUrl: t.coverUrl || undefined,
          durationMs:
            t.durationMs ||
            (raw.tracks || []).find(
              (old) =>
                old.id === t.id &&
                old.name === t.name &&
                old.artist === t.artist,
            )?.durationMs,
        }));
      if (!tracks.length && !verifiedMembership) {
        throw new NotFoundException(
          'Spotify returned no tracks for that playlist',
        );
      }
      if (tracks.length < before) {
        if (!verifiedMembership) {
          throw new HttpException(
            `Refusing to shrink ${name}: Spotify membership was not fully verified. Saved membership kept.`,
            HttpStatus.BAD_GATEWAY,
          );
        }
        // Removals (including emptying a playlist) require a second complete,
        // matching API observation. Read again; never infer a removal from a
        // short/error response or the discovery endpoint's count alone.
        const confirmed = await this.spotifyApiService.getAllPlaylistTracks(
          spotifyUrl,
          new Map(fetchedRows.map(track => [track.id!, track])),
        );
        if (confirmed.truncated ||
            !hasCompleteSpotifyMembership(confirmed.membership, pid, confirmed) ||
            confirmed.membership!.itemCount !== fetched.membership!.itemCount ||
            confirmed.membership!.orderedTrackIdsHash !== fetched.membership!.orderedTrackIdsHash) {
          throw new HttpException(
            `Spotify playlist changed or was incomplete while confirming removals from ${name}. Saved membership kept; sync again.`,
            HttpStatus.BAD_GATEWAY,
          );
        }
      }
      const previous = (raw.tracks || []).filter(track => track.artist && track.name);
      const kept = new Set(tracks.map(track => sourceKey(track)));
      const removed = verifiedMembership
        ? previous.filter(track => !kept.has(sourceKey(track)))
        : [];
      let removedFiles = 0;
      if (removed.length) {
        const folder = this.utilsService.getPlaylistFolderPath(name);
        removedFiles = unpublishPlaylistCopies(folder, removed, tracks).removedPaths.length;
        await this.dropRemovedPlaylistWork(spotifyUrl, removed, tracks);
      }
      const next = {
        ...raw,
        trackCount: tracks.length,
        tracks,
        // A focused/API read does not supply the discovery snapshot ID. The
        // previous ID cannot certify newly fetched membership. Library sync
        // establishes its next baseline only after this verified read succeeds.
        snapshotId: null,
        membership: verifiedMembership ? fetched.membership : undefined,
        syncedAt: new Date().toISOString(),
      };
      this.writePlaylistFile(full, next);
      this.logger.debug(
        `Resynced ${name} (${pid}): ${before} -> ${tracks.length}; removed ${removedFiles} playlist copies`,
      );
      return { id: pid, name, before, after: tracks.length, removedFiles };
    }
    throw new NotFoundException(`Playlist ${id} not found in static library`);
  }

  private async dropRemovedPlaylistWork(
    spotifyUrl: string,
    removed: StaticTrack[],
    remaining: StaticTrack[],
  ): Promise<void> {
    const playlist = await this.playlistService.findBySpotifyUrl(spotifyUrl);
    if (!playlist?.id) return;
    const remainingIds = new Set(remaining.map(track => trackSourceId(track)).filter((id): id is string => !!id));
    const remainingSongs = new Set(remaining.map(track => songKey(track.artist!, track.name!)));
    const removedIds = new Set(removed.map(track => trackSourceId(track)).filter((id): id is string => !!id && !remainingIds.has(id)));
    const removedSongs = new Set(
      removed.map(track => songKey(track.artist!, track.name!)).filter(key => !remainingSongs.has(key)),
    );
    const rows = await this.trackService.getAllByPlaylist(playlist.id);
    for (const row of rows) {
      const id = trackSourceId(row);
      const drop = id ? removedIds.has(id) : removedSongs.has(songKey(row.artist, row.name));
      if (drop) await this.trackService.remove(row.id);
    }
  }

  private async scrapePlaylistPage(
    playlistId: string,
  ): Promise<ScrapedPlaylistResult> {
    if (!(await this.cdpProxy.healthy())) {
      throw new Error(
        'Chrome bridge is disconnected. Saved playlists remain available; reconnect only on an explicit user request.',
      );
    }
    const { targetId, sessionId } = await this.cdpProxy.tab();
    await this.cdpProxy
      .send('Page.enable', {}, sessionId)
      .catch(() => undefined);
    await this.cdpProxy.send(
      'Page.navigate',
      {
        url: `https://open.spotify.com/playlist/${playlistId}?spooty-resync=1`,
      },
      sessionId,
    );
    const started = Date.now();
    let expectedCount: number | null = null;
    while (Date.now() - started < 18000) {
      const header = await this.cdpProxy.evaluate(
        targetId,
        `(() => {
          const pathId = (location.pathname.split('/playlist/')[1] || '').split('?')[0];
          const h1 =
            document.querySelector('[data-testid="entityTitle"]') ||
            document.querySelector('main h1') ||
            [...document.querySelectorAll('h1')].at(-1);
          const root = h1?.closest('section, [data-testid="playlist-page"], main') || h1?.parentElement;
          const text = (root && root.innerText) || '';
          const m = text.match(/([\\d,]+)\\s+songs?/i);
          return {
            pathId,
            live: m ? Number(m[1].replace(/,/g, '')) : null,
            h1: h1 ? h1.innerText : '',
          };
        })()`,
      );
      if (
        header?.pathId === playlistId &&
        Number.isFinite(header.live) &&
        header.live > 0
      ) {
        expectedCount = header.live;
        break;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    const scraped = await this.cdpProxy.evaluate(
      targetId,
      `(async () => {
        const readExpectedCount = () => {
          const h1 =
            document.querySelector('[data-testid="entityTitle"]') ||
            document.querySelector('main h1') ||
            [...document.querySelectorAll('h1')].at(-1);
          const root = h1?.closest('section, [data-testid="playlist-page"], main') || h1?.parentElement;
          const match = ((root && root.innerText) || '').match(/([\\d,]+)\\s+songs?/i);
          return match ? Number(match[1].replace(/,/g, '')) : null;
        };
        const scroller = [...document.querySelectorAll('*')].find((el) => {
          const s = getComputedStyle(el);
          return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 400;
        });
        if (!scroller) {
          const expectedCount = readExpectedCount() || ${expectedCount ?? 'null'};
          return { tracks: [], expectedCount, truncated: true };
        }
        const parseRow = (row) => {
          const trackA = row.querySelector('a[href*="/track/"]');
          if (!trackA) return null;
          const id = (trackA.getAttribute('href') || '').split('/track/')[1]?.split('?')[0];
          const name = (trackA.textContent || '').trim();
          const artist = [...row.querySelectorAll('a[href*="/artist/"]')].map((a) => a.textContent.trim()).filter(Boolean).join(', ');
          const nEl = row.querySelector('[aria-colindex="1"] span');
          const n = nEl ? parseInt(nEl.textContent.trim(), 10) : null;
          const position = row.getAttribute('aria-rowindex') || (Number.isFinite(n) && n > 0 ? String(n) : null);
          if (!id || !name || !artist) return null;
          return { n, position, id, name, artist, href: 'https://open.spotify.com/track/' + id };
        };
        // A playlist may contain the same Spotify track more than once. Key by
        // its row/playlist position so those occurrences are not collapsed.
        const byPosition = new Map();
        scroller.scrollTop = 0;
        await new Promise((r) => setTimeout(r, 250));
        let stagnant = 0;
        let lastTop = -1;
        for (let i = 0; i < 260; i++) {
          const before = byPosition.size;
          for (const row of document.querySelectorAll('[data-testid="tracklist-row"]')) {
            const t = parseRow(row);
            if (t) {
              const key = t.position ? 'position:' + t.position : 'track:' + t.id;
              byPosition.set(key, t);
            }
          }
          const top = scroller.scrollTop;
          const want = readExpectedCount() || ${expectedCount ?? 'null'} || 0;
          const numbered = [...byPosition.values()].filter((t) => t.n > 0).length;
          if (want && numbered >= want && stagnant >= 2) break;
          if (byPosition.size === before && top === lastTop) stagnant++;
          else stagnant = 0;
          lastTop = top;
          if (stagnant >= 22) break;
          const max = scroller.scrollHeight - scroller.clientHeight;
          const next = Math.min(max, scroller.scrollTop + Math.max(520, Math.floor(scroller.clientHeight * 0.9)));
          scroller.scrollTop = next <= scroller.scrollTop ? max : next;
          await new Promise((r) => setTimeout(r, 110));
        }
        const tracks = [...byPosition.values()].map(({ position, ...track }) => track);
        const expectedCount = readExpectedCount() || ${expectedCount ?? 'null'};
        return {
          tracks,
          expectedCount,
          truncated: !expectedCount || tracks.length !== expectedCount,
        };
      })()`,
    );
    const tracks = (scraped?.tracks || []).filter((t) => t?.name && t?.artist);
    const liveCount = Number.isFinite(scraped?.expectedCount)
      ? scraped.expectedCount
      : expectedCount;
    const truncated =
      scraped?.truncated !== false || !liveCount || tracks.length !== liveCount;
    this.logger.debug(
      `CDP proxy scrape ${playlistId}: ${tracks.length}/${liveCount ?? 'unknown'} tracks${truncated ? ' (incomplete)' : ''}`,
    );
    return { tracks, expectedCount: liveCount, truncated };
  }

  /** Compatibility endpoints share the same durable operation as every sync. */
  resyncAllStatus() {
    const state = this.librarySyncStatus();
    return { ...state, updated: state.changed };
  }

  startResyncAll() {
    return this.startSpotifySync('saved-playlists', () => this.runResyncAll());
  }

  private includedDumpIds(): Array<{ id: string; uri: string; name: string }> {
    const dir = this.staticPlaylistsDir();
    const out: Array<{ id: string; uri: string; name: string }> = [];
    if (!existsSync(dir)) return out;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const raw = this.readPlaylistFile(join(dir, file));
      if (!raw || raw.skipped) continue;
      const id = this.playlistId(raw, file);
      if (!id) continue;
      const name = raw.name || id;
      if (this.isExcludedName(name)) continue;
      out.push({
        id,
        uri: raw.uri || `spotify:playlist:${id}`,
        name,
      });
    }
    return out;
  }

  private async runResyncAll(): Promise<void> {
    const ids = this.includedDumpIds();
    this.librarySync.total = ids.length;
    this.persistLibrarySync();
    for (const row of ids) {
      this.librarySync.current = row.name;
      this.persistLibrarySync();
      try {
        const res = await this.resync(row.id);
        if (res.after !== res.before) this.librarySync.changed++;
      } catch (err) {
        this.librarySync.errors.push(
          `${row.name}: ${err instanceof Error ? err.message : err}`,
        );
      }
      this.librarySync.done++;
      this.persistLibrarySync();
    }
  }

  async downloadRemaining(
    options: AcquisitionOptions = {},
    requestId?: string,
  ): Promise<{ queued: number; skipped: number; reused?: number }> {
    if (requestId) return this.downloadRequests().run(requestId, {
      scope: 'remaining', uris: [], options, destination: this.utilsService.getRootDownloadsPath(),
    }, () => this.downloadRemaining(options));
    const uris = this.includedDumpIds().map((r) => r.uri);
    return this.download(uris, {
      ...options,
      retryMissing: options.retryMissing === true,
      retryNoCandidate: options.retryNoCandidate === true,
      retryErrors: options.retryErrors === true,
    });
  }

  private syncStatusFile: string | null = null;
  private librarySync: LibrarySyncState = emptyLibrarySync();
  private observedLibrary: SpotifyLibraryObservation | undefined;
  private observedLibraryIds = new Set<string>();

  private withLibraryPresence(playlist: LibraryPlaylist): LibraryPlaylist {
    const observation = this.librarySync.libraryObservation;
    if (!observation) return playlist;
    if (observation !== this.observedLibrary) {
      this.observedLibraryIds = new Set(observation.playlistIds);
      this.observedLibrary = observation;
    }
    return { ...playlist, libraryPresence: {
      state: this.observedLibraryIds.has(playlist.id) ? 'present' : 'not-returned',
      checkedAt: observation.checkedAt,
    } };
  }

  // Project metadata on read, without invalidating or rebuilding the audio index.
  private withLibraryObservation(result: LibraryListResponse): LibraryListResponse {
    if (!this.librarySync.libraryObservation) return result;
    return { ...result, playlists: result.playlists.map(p => this.withLibraryPresence(p)) };
  }

  private persistLibrarySync(): boolean {
    try { writeLibrarySync(this.syncStatusFile, this.librarySync); return true; }
    catch (error) { this.logger.warn(`Could not persist Spotify sync status: ${error}`); return false; }
  }

  librarySyncStatus() {
    const { libraryObservation: _privateLibrary, ...status } = this.librarySync;
    return { ...status, errors: status.errors.slice(-20) };
  }

  spotifyConnectionState() {
    return this.cdpProxy.connectionState();
  }

  connectSpotifyChrome() {
    return this.cdpProxy.connectOnce();
  }

  private syncTask: Promise<void> | null = null;

  private startSpotifySync(scope: SpotifySyncScope, work: () => Promise<void>, playlistId: string | null = null) {
    if (this.librarySync.running) return { started: false, already: true, operationId: this.librarySync.operationId, scope: this.librarySync.scope };
    const state: LibrarySyncState = {
      ...emptyLibrarySync(), running: true, scope, playlistId,
      ...(this.librarySync.libraryObservation ? { libraryObservation: this.librarySync.libraryObservation } : {}),
      operationId: randomUUID(), startedAt: new Date().toISOString(),
      total: scope === 'playlist' ? 1 : 0,
      current: playlistId ? this.includedDumpIds().find(row => row.id === playlistId)?.name || playlistId : '',
    };
    const previous = this.librarySync;
    this.librarySync = state;
    state.playlistName = scope === 'playlist' ? state.current : null;
    if (!this.persistLibrarySync()) {
      this.librarySync = previous;
      throw new HttpException('Could not save Spotify sync status. No sync was started.', HttpStatus.SERVICE_UNAVAILABLE);
    }
    // Work belongs to the server. It is not cancelled by a lost HTTP client.
    const task = new Promise<void>(resolve => setImmediate(resolve)).then(work);
    this.syncTask = task;
    const finish = (error?: unknown) => {
      if (error) state.errors.push(error instanceof Error ? error.message : String(error));
      state.running = false;
      state.current = '';
      state.finishedAt = new Date().toISOString();
      state.failureKind = state.errors.length ? spotifySyncFailure(state.errors.at(-1)!) : null;
      this.persistLibrarySync();
      this.syncTask = null;
    };
    // Observe rejection even for callers using the non-blocking start endpoint.
    task.then(() => finish(), error => finish(error));
    return { started: true, operationId: state.operationId, scope };
  }

  startLibrarySync() {
    return this.startSpotifySync('library', () => this.runLibrarySync());
  }

  startPlaylistSync(id: string) {
    if (!this.librarySync.running && !this.includedDumpIds().some(row => row.id === id)) {
      throw new NotFoundException('Playlist not found in saved library');
    }
    return this.startSpotifySync('playlist', async () => {
      this.librarySync.result = await this.resync(id);
      this.librarySync.done = 1;
      this.librarySync.changed = 1;
    }, id);
  }

  /** Retain the historical blocking endpoint without giving it a second lane. */
  async resyncAndWait(id: string): Promise<PlaylistSyncResult> {
    if (this.librarySync.running &&
        (this.librarySync.scope !== 'playlist' || this.librarySync.playlistId !== id)) {
      throw new ConflictException('A Spotify sync is already running. Follow it in Current activity.');
    }
    if (!this.librarySync.running) this.startPlaylistSync(id);
    const state = this.librarySync;
    await this.syncTask;
    if (!state.result) throw new HttpException('Spotify sync ended without a result', HttpStatus.BAD_GATEWAY);
    return { ...state.result };
  }

  private localPlaylistFiles(): Map<
    string,
    { file: string; full: string; raw: StaticPlaylistFile }
  > {
    const dir = this.staticPlaylistsDir();
    const byId = new Map<
      string,
      { file: string; full: string; raw: StaticPlaylistFile }
    >();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    for (const file of readdirSync(dir).filter((name) =>
      name.endsWith('.json'),
    )) {
      const full = join(dir, file);
      const raw = this.readPlaylistFile(full);
      if (!raw) continue;
      const id = this.playlistId(raw, file);
      if (id) byId.set(id, { file, full, raw });
    }
    return byId;
  }

  private async runLibrarySync(): Promise<void> {
    // getLibraryPlaylists collects and validates every page before returning.
    // A rejected/partial discovery must never imply that a playlist disappeared.
    const live = await this.spotifyApiService.getLibraryPlaylists();
    const observation = { checkedAt: new Date().toISOString(), playlistIds: live.map(item => item.id) };
    if (!validLibraryObservation(observation)) throw new Error('Spotify library discovery incomplete: invalid playlist identities. Saved library kept.');
    const previousObservation = this.librarySync.libraryObservation;
    const previousTotal = this.librarySync.total;
    this.librarySync.libraryObservation = observation;
    this.librarySync.total = live.length;
    if (!this.persistLibrarySync()) {
      if (previousObservation) this.librarySync.libraryObservation = previousObservation;
      else delete this.librarySync.libraryObservation;
      this.librarySync.total = previousTotal;
      throw new Error('Could not save Spotify library observation');
    }
    this.emitCoverage();
    const local = this.localPlaylistFiles();
    const dir = this.staticPlaylistsDir();

    for (let i = 0; i < live.length; i++) {
      const item = live[i];
      this.librarySync.current = item.name;
      try {
        if (this.isExcludedName(item.name)) continue;
        const rank = i + 1;
        let entry = local.get(item.id);
        if (!entry) {
          const file = `live_${item.id}.json`;
          const full = join(dir, file);
          const raw: StaticPlaylistFile = {
            name: item.name,
            id: item.id,
            uri: item.uri,
            rank,
            trackCount: 0,
            tracks: [],
            snapshotId: null,
            owner: item.owner || null,
          };
          this.writePlaylistFile(full, raw);
          entry = { file, full, raw };
          local.set(item.id, entry);
          this.librarySync.discovered++;
        }

        const storedCount = (entry.raw.tracks || []).filter(
          (track) => track.artist && track.name,
        ).length;
        const snapshotChanged =
          !!entry.raw.snapshotId &&
          !!item.snapshotId &&
          entry.raw.snapshotId !== item.snapshotId;
        const snapshotBaselineMissing =
          !entry.raw.snapshotId && !!item.snapshotId;
        const completeBaseline = hasCompleteSpotifyMembership(entry.raw.membership, item.id, entry.raw.tracks || []);
        const storedItemCount = completeBaseline ? entry.raw.membership!.itemCount : storedCount;
        const countChanged = Number.isSafeInteger(item.trackCount) && item.trackCount >= 0 &&
          storedItemCount !== item.trackCount;
        const needsTracks =
          !completeBaseline ||
          !item.snapshotId ||
          snapshotBaselineMissing ||
          snapshotChanged ||
          countChanged;

        if (needsTracks) {
          await this.resync(item.id);
          const refreshed = this.readPlaylistFile(entry.full) || entry.raw;
          entry.raw = refreshed;
          if (!hasCompleteSpotifyMembership(refreshed.membership, item.id, refreshed.tracks || [])) {
            throw new Error('Spotify playlist membership was not fully verified. No new snapshot baseline was saved.');
          }
          this.librarySync.changed++;
        }

        const metadata: StaticPlaylistFile = {
          ...entry.raw,
          name: item.name,
          id: item.id,
          uri: item.uri,
          rank,
          snapshotId: item.snapshotId || null,
          owner: item.owner || entry.raw.owner || null,
        };
        // No-op sync must not churn every dump's inode/mtime or imply that its
        // track list was refreshed. Owner/name/order changes still persist.
        if (JSON.stringify(metadata) !== JSON.stringify(entry.raw)) {
          this.writePlaylistFile(entry.full, metadata);
        }
        entry.raw = metadata;
      } catch (error) {
        this.librarySync.errors.push(
          `${item.name}: ${error instanceof Error ? error.message : error}`,
        );
      } finally {
        this.librarySync.done++;
        this.persistLibrarySync();
      }
    }
    this.logger.debug(
      `library sync finished ${this.librarySync.done}/${this.librarySync.total} discovered=${this.librarySync.discovered} changed=${this.librarySync.changed} errors=${this.librarySync.errors.length}`,
    );
  }
}
