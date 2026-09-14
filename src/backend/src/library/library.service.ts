import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { basename, extname, join, resolve } from 'path';
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
import { materialize } from '../shared/acquisition/publication';

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
}

export interface LibraryListResponse {
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
export class LibraryService {
  private readonly logger = new Logger(LibraryService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly playlistService: PlaylistService,
    private readonly trackService: TrackService,
    private readonly utilsService: UtilsService,
    private readonly spotifyApiService: SpotifyApiService,
    private readonly cdpProxy: CdpProxyClient,
  ) {}

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

  private indexAudioFiles(): Map<string, string> {
    const index = new Map<string, string>();
    const format =
      this.configService.get<string>(EnvironmentEnum.FORMAT) || 'mp3';
    const reusableExtension = `.${format.toLowerCase()}`;
    const walk = (dir: string) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        const full = join(dir, ent.name);
        if (ent.isDirectory()) {
          walk(full);
        } else if (
          extname(ent.name).toLowerCase() === reusableExtension &&
          this.isNonEmptyFile(full)
        ) {
          const key = basename(ent.name, extname(ent.name)).toLowerCase();
          if (key && !index.has(key)) index.set(key, full);
        }
      }
    };
    for (const dir of this.extraScanDirs()) walk(dir);
    return index;
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

  private async jobByKey(): Promise<Map<string, TrackEntity>> {
    const jobs = await this.trackService.getAll();
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
      const key = this.utilsService.trackFileKey(job.artist, job.name);
      const current = map.get(key);
      if (key && (!current || rank(job.status) > rank(current.status))) {
        map.set(key, job);
      }
    }
    return map;
  }

  private playlistId(raw: StaticPlaylistFile, file: string): string | null {
    if (raw.id) return raw.id;
    if (raw.uri && raw.uri.startsWith('spotify:playlist:')) {
      return raw.uri.split(':').pop() || null;
    }
    const m = file.match(/^[0-9]+_(.+)\.json$/);
    return m ? m[1] : null;
  }

  async list(): Promise<LibraryListResponse> {
    const dir = this.staticPlaylistsDir();
    const audio = this.indexAudioFiles();
    const jobs = await this.jobByKey();
    const playlists: LibraryPlaylist[] = [];
    if (!existsSync(dir)) {
      this.logger.warn(`STATIC_PLAYLISTS_PATH does not exist: ${dir}`);
      return {
        playlists: [],
        totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 },
      };
    }

    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const raw = this.readPlaylistFile(join(dir, file));
      if (!raw) continue;
      const id = this.playlistId(raw, file);
      if (!id) continue;
      const uri = raw.uri || `spotify:playlist:${id}`;
      const name = raw.name || id;
      if (this.isExcludedName(name) || raw.skipped) continue;
      const tracks = (raw.tracks || []).filter((t) => t.artist && t.name);
      const skipped = false;
      let onDisk = 0;
      let available = 0;
      let failed = 0;
      const folder = this.utilsService.getPlaylistFolderPath(name);
      for (const track of tracks) {
        const key = this.utilsService.trackFileKey(track.artist, track.name);
        const base = this.utilsService.trackFileBase(track.artist, track.name);
        const inFolder = !!this.onDiskFile(folder, base);
        if (inFolder) {
          onDisk++;
          available++;
        } else if (audio.has(key)) {
          available++;
          if (
            jobs.get(key)?.status === TrackStatusEnum.Error &&
            isPermanentYoutubeMissing(jobs.get(key)?.error)
          ) {
            failed++;
          }
        } else if (
          jobs.get(key)?.status === TrackStatusEnum.Error &&
          isPermanentYoutubeMissing(jobs.get(key)?.error)
        ) {
          failed++;
        }
      }
      const trackCount = skipped && tracks.length === 0 ? 0 : tracks.length;
      playlists.push({
        uri,
        id,
        name,
        rank: raw.rank || 0,
        skipped,
        skipReason: raw.skipReason,
        trackCount,
        onDisk,
        available,
        failed,
        done: trackCount > 0 && onDisk + failed >= trackCount,
        percentOnDisk: trackCount ? Math.round((onDisk / trackCount) * 100) : 0,
        percentAvailable: trackCount
          ? Math.round((available / trackCount) * 100)
          : 0,
        lastPlayedAt: raw.lastPlayedAt || null,
        syncedAt: raw.syncedAt || null,
        file,
        spotifyUrl: `https://open.spotify.com/playlist/${id}`,
      });
    }

    playlists.sort(
      (a, b) => (a.rank || 0) - (b.rank || 0) || a.name.localeCompare(b.name),
    );
    const totals = playlists.reduce(
      (acc, p) => {
        if (p.skipped) return acc;
        acc.playlists += 1;
        acc.tracks += p.trackCount;
        acc.onDisk += p.onDisk;
        acc.available += p.available;
        return acc;
      },
      { playlists: 0, tracks: 0, onDisk: 0, available: 0 },
    );
    return { playlists, totals };
  }

  async detail(id: string): Promise<{
    playlist: LibraryPlaylist;
    tracks: Array<{
      n?: number;
      name: string;
      artist: string;
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
      const tracks = (raw.tracks || [])
        .filter((t) => t.artist && t.name)
        .map((t) => {
          const base = this.utilsService.trackFileBase(t.artist!, t.name!);
          const key = this.utilsService.trackFileKey(t.artist!, t.name!);
          const disk = this.onDiskFile(folder, base);
          const job = jobs.get(key);
          return {
            n: t.n,
            name: t.name as string,
            artist: t.artist as string,
            onDisk: !!disk,
            available: !!disk || audio.has(key),
            filename: disk ? basename(disk) : `${base}.${format}`,
            acquisitionState: !disk ? job?.acquisitionState : null,
            retryAt: !disk ? job?.retryAt : null,
            searchLimit: job?.searchLimit,
            networkAttempts: job?.networkAttempts,
            operationAttempts: job?.operationAttempts,
            error:
              !disk &&
              (job?.status === TrackStatusEnum.Error ||
                job?.status === TrackStatusEnum.RetryWaiting)
                ? job.error
                : undefined,
            missing:
              !disk && job?.status === TrackStatusEnum.Error
                ? isPermanentYoutubeMissing(job.error)
                : undefined,
          };
        });
      const onDisk = tracks.filter((t) => t.onDisk).length;
      const available = tracks.filter((t) => t.available).length;
      const failed = tracks.filter((t) => !t.onDisk && t.missing).length;
      const trackCount = skipped && tracks.length === 0 ? 0 : tracks.length;
      return {
        playlist: {
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
          file,
          spotifyUrl: `https://open.spotify.com/playlist/${pid}`,
        },
        tracks,
      };
    }
    throw new NotFoundException(`Playlist ${id} not found in static library`);
  }

  resolveAudioPath(
    playlistId: string,
    n: number,
  ): { path: string; filename: string } {
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
      const base = this.utilsService.trackFileBase(track.artist!, track.name!);
      const disk = this.onDiskFile(folder, base);
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
  ): Promise<{ queued: number; skipped: number }> {
    const dir = this.staticPlaylistsDir();
    const audio = this.indexAudioFiles();
    const wanted = new Set(uris);
    let queued = 0;
    let skipped = 0;
    const files = existsSync(dir)
      ? readdirSync(dir).filter((f) => f.endsWith('.json'))
      : [];

    for (const file of files) {
      const raw = this.readPlaylistFile(join(dir, file));
      if (!raw || raw.skipped) continue;
      const id = this.playlistId(raw, file);
      if (!id) continue;
      const uri = raw.uri || `spotify:playlist:${id}`;
      if (!wanted.has(uri) && !wanted.has(id)) continue;

      const name = raw.name || id;
      if (this.isExcludedName(name)) continue;
      const spotifyUrl = `https://open.spotify.com/playlist/${id}`;
      const tracks = (raw.tracks || []).filter((t) => t.artist && t.name);
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
          this.utilsService.trackFileKey(t.artist, t.name),
          t,
        ]),
      );

      for (const track of tracks) {
        const fileKey = this.utilsService.trackFileKey(
          track.artist,
          track.name,
        );
        const prior = existing.get(fileKey);
        const fileBase = this.utilsService.trackFileBase(
          track.artist,
          track.name,
        );
        const format =
          this.configService.get<string>(EnvironmentEnum.FORMAT) || 'mp3';
        const dest = join(folder, `${fileBase}.${format}`);
        const alreadyHere = this.isNonEmptyFile(dest);
        const source = alreadyHere ? dest : audio.get(fileKey);

        const payload = {
          artist: track.artist,
          name: track.name,
          spotifyUrl:
            track.href ||
            (track.id ? `https://open.spotify.com/track/${track.id}` : null),
          durationMs: track.durationMs || null,
          coverUrl: track.coverUrl || playlist.coverUrl,
        };

        if (source && !alreadyHere) {
          try {
            payload.durationMs = await this.trackService.verifyLocalAudio(
              payload,
              source,
            );
          } catch {
            // A bad/unknown local source remains untouched. Let the durable
            // worker record a needs-retry outcome rather than copy it as success.
            const added = prior?.id
              ? await this.trackService.retry(prior.id, options)
              : await this.trackService.create(payload, playlist, options);
            added ? queued++ : skipped++;
            continue;
          }
        }

        if (source && !alreadyHere) {
          materialize(source, [dest]);
        }

        if (source || alreadyHere) {
          if (prior?.id) {
            if (prior.status !== TrackStatusEnum.Completed || prior.error) {
              await this.trackService.update(prior.id, {
                ...prior,
                durationMs: payload.durationMs || prior.durationMs,
                status: TrackStatusEnum.Completed,
                error: null,
              });
            }
          } else {
            await this.trackService.addCompletedTrack(payload, playlist);
          }
          skipped++;
        } else if (prior) {
          if (
            (prior.status === TrackStatusEnum.Error ||
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
      }
    }

    if (queued === 0 && skipped === 0 && uris.length) {
      throw new NotFoundException(
        'No matching static playlists for those URIs',
      );
    }
    this.logger.debug(`Library download queued=${queued} skipped=${skipped}`);
    return { queued, skipped };
  }

  async resync(id: string): Promise<{
    id: string;
    name: string;
    before: number;
    after: number;
  }> {
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
        if (fetched.truncated) {
          throw new Error(
            `Spotify returned an incomplete playlist snapshot for ${pid}`,
          );
        }
        fetchedRows = fetched;
      } catch (err) {
        this.logger.warn(
          `Spotify API resync failed for ${pid}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
      // Session/spclient returns the full list. HTML scrape is last resort.
      if (!fetchedRows.length) {
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
      if (!fetchedRows.length) {
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
      if (!tracks.length) {
        throw new NotFoundException(
          'Spotify returned no tracks for that playlist',
        );
      }
      if (tracks.length < before) {
        throw new HttpException(
          `Refusing to shrink ${name} (${pid}) ${before} -> ${tracks.length}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
      const next = {
        ...raw,
        trackCount: tracks.length,
        tracks,
        syncedAt: new Date().toISOString(),
      };
      this.writePlaylistFile(full, next);
      this.logger.debug(
        `Resynced ${name} (${pid}): ${before} -> ${tracks.length}`,
      );
      return { id: pid, name, before, after: tracks.length };
    }
    throw new NotFoundException(`Playlist ${id} not found in static library`);
  }

  private async scrapePlaylistPage(
    playlistId: string,
  ): Promise<ScrapedPlaylistResult> {
    if (!(await this.cdpProxy.healthy())) {
      throw new Error(
        'CDP proxy is down. Start scripts/cdp-keepalive.mjs once and click Allow in Chrome a single time.',
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

  private bulkResync: {
    running: boolean;
    done: number;
    total: number;
    updated: number;
    errors: string[];
    current: string;
    startedAt: string | null;
    finishedAt: string | null;
  } = {
    running: false,
    done: 0,
    total: 0,
    updated: 0,
    errors: [],
    current: '',
    startedAt: null,
    finishedAt: null,
  };

  resyncAllStatus() {
    return { ...this.bulkResync, errors: this.bulkResync.errors.slice(-20) };
  }

  startResyncAll(): { started: boolean; already?: boolean } {
    if (this.bulkResync.running) {
      return { started: false, already: true };
    }
    this.bulkResync = {
      running: true,
      done: 0,
      total: 0,
      updated: 0,
      errors: [],
      current: '',
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    setImmediate(() => {
      this.runResyncAll().catch((err) => {
        this.logger.error(`resync-all failed: ${err}`);
        this.bulkResync.running = false;
        this.bulkResync.finishedAt = new Date().toISOString();
        this.bulkResync.errors.push(String(err?.message || err));
      });
    });
    return { started: true };
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
    this.bulkResync.total = ids.length;
    for (const row of ids) {
      this.bulkResync.current = row.name;
      try {
        const res = await this.resync(row.id);
        if (res.after !== res.before) this.bulkResync.updated++;
      } catch (err) {
        this.bulkResync.errors.push(
          `${row.name}: ${err instanceof Error ? err.message : err}`,
        );
      }
      this.bulkResync.done++;
    }
    this.bulkResync.running = false;
    this.bulkResync.current = '';
    this.bulkResync.finishedAt = new Date().toISOString();
    this.logger.debug(
      `resync-all finished ${this.bulkResync.done}/${this.bulkResync.total} updated=${this.bulkResync.updated} errors=${this.bulkResync.errors.length}`,
    );
  }

  async downloadRemaining(
    options: AcquisitionOptions = {},
  ): Promise<{ queued: number; skipped: number }> {
    const uris = this.includedDumpIds().map((r) => r.uri);
    return this.download(uris, {
      ...options,
      retryMissing: options.retryMissing === true,
      retryNoCandidate: options.retryNoCandidate === true,
      retryErrors: options.retryErrors === true,
    });
  }

  private librarySync: {
    running: boolean;
    done: number;
    total: number;
    discovered: number;
    changed: number;
    errors: string[];
    current: string;
    startedAt: string | null;
    finishedAt: string | null;
  } = {
    running: false,
    done: 0,
    total: 0,
    discovered: 0,
    changed: 0,
    errors: [],
    current: '',
    startedAt: null,
    finishedAt: null,
  };

  librarySyncStatus() {
    return { ...this.librarySync, errors: this.librarySync.errors.slice(-20) };
  }

  startLibrarySync(): { started: boolean; already?: boolean } {
    if (this.librarySync.running) return { started: false, already: true };
    this.librarySync = {
      running: true,
      done: 0,
      total: 0,
      discovered: 0,
      changed: 0,
      errors: [],
      current: '',
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    setImmediate(() => {
      this.runLibrarySync().catch((error) => {
        this.logger.error(`library sync failed: ${error}`);
        this.librarySync.running = false;
        this.librarySync.finishedAt = new Date().toISOString();
        this.librarySync.errors.push(
          error instanceof Error ? error.message : String(error),
        );
      });
    });
    return { started: true };
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
    const live = await this.spotifyApiService.getLibraryPlaylists();
    const local = this.localPlaylistFiles();
    const dir = this.staticPlaylistsDir();
    this.librarySync.total = live.length;

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
        const countChanged =
          item.trackCount > 0 && storedCount !== item.trackCount;
        const needsTracks =
          storedCount === 0 ||
          snapshotBaselineMissing ||
          snapshotChanged ||
          countChanged;

        if (needsTracks) {
          await this.resync(item.id);
          this.librarySync.changed++;
          const refreshed = this.readPlaylistFile(entry.full) || entry.raw;
          entry.raw = refreshed;
        }

        const metadata: StaticPlaylistFile = {
          ...entry.raw,
          name: item.name,
          id: item.id,
          uri: item.uri,
          rank,
          snapshotId: item.snapshotId || entry.raw.snapshotId || null,
        };
        this.writePlaylistFile(entry.full, metadata);
        entry.raw = metadata;
      } catch (error) {
        this.librarySync.errors.push(
          `${item.name}: ${error instanceof Error ? error.message : error}`,
        );
      } finally {
        this.librarySync.done++;
      }
    }
    this.librarySync.running = false;
    this.librarySync.current = '';
    this.librarySync.finishedAt = new Date().toISOString();
    this.logger.debug(
      `library sync finished ${this.librarySync.done}/${this.librarySync.total} discovered=${this.librarySync.discovered} changed=${this.librarySync.changed} errors=${this.librarySync.errors.length}`,
    );
  }
}
