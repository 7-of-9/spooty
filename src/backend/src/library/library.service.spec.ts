import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EnvironmentEnum } from '../environmentEnum';
import { UtilsService } from '../shared/utils.service';
import { SpotifyTrackList } from '../shared/spotify-api.service';
import { TrackStatusEnum } from '../track/track.entity';
import { LibraryService, StaticPlaylistFile } from './library.service';

describe('LibraryService safety-critical flows', () => {
  let root: string;
  let playlistsDir: string;
  let downloadsDir: string;
  let playlistService: {
    findBySpotifyUrl: jest.Mock;
    save: jest.Mock;
  };
  let trackService: {
    verifyLocalAudio: jest.Mock;
    getAll: jest.Mock;
    update: jest.Mock;
    addCompletedTrack: jest.Mock;
    create: jest.Mock;
    retry: jest.Mock;
  };
  let spotifyApiService: {
    getAllPlaylistTracks: jest.Mock;
    getLibraryPlaylists: jest.Mock;
  };
  let cdpProxy: {
    healthy: jest.Mock;
    tab: jest.Mock;
    send: jest.Mock;
    evaluate: jest.Mock;
  };
  let service: LibraryService;

  const playlistId = 'aaaaaaaaaaaaaaaaaaaaaa';
  const playlistUri = `spotify:playlist:${playlistId}`;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'spooty-library-service-'));
    playlistsDir = join(root, 'playlists');
    downloadsDir = join(root, 'downloads');
    mkdirSync(playlistsDir, { recursive: true });
    mkdirSync(downloadsDir, { recursive: true });

    const configService = {
      get: jest.fn((key: EnvironmentEnum) => {
        if (key === EnvironmentEnum.STATIC_PLAYLISTS_PATH) return playlistsDir;
        if (key === EnvironmentEnum.DOWNLOADS_PATH) return downloadsDir;
        if (key === EnvironmentEnum.FORMAT) return 'mp3';
        return undefined;
      }),
    };
    playlistService = {
      findBySpotifyUrl: jest.fn(),
      save: jest.fn(),
    };
    trackService = {
      verifyLocalAudio: jest.fn().mockResolvedValue(180000),
      getAll: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      addCompletedTrack: jest.fn(),
      create: jest.fn().mockResolvedValue(true),
      retry: jest.fn().mockResolvedValue(true),
    };
    spotifyApiService = {
      getAllPlaylistTracks: jest.fn(),
      getLibraryPlaylists: jest.fn(),
    };
    cdpProxy = {
      healthy: jest.fn().mockResolvedValue(false),
      tab: jest.fn(),
      send: jest.fn().mockResolvedValue({}),
      evaluate: jest.fn(),
    };
    const utilsService = new UtilsService(configService as any);
    service = new LibraryService(
      configService as any,
      playlistService as any,
      trackService as any,
      utilsService,
      spotifyApiService as any,
      cdpProxy as any,
    );
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function writePlaylist(overrides: Partial<StaticPlaylistFile> = {}): string {
    const file = join(playlistsDir, '0001_fixture.json');
    const playlist: StaticPlaylistFile = {
      id: playlistId,
      uri: playlistUri,
      name: 'Fixture',
      rank: 1,
      trackCount: 2,
      snapshotId: 'snapshot-old',
      tracks: [
        {
          n: 1,
          id: '1111111111111111111111',
          artist: 'Artist One',
          name: 'Song One',
        },
        {
          n: 2,
          id: '2222222222222222222222',
          artist: 'Artist Two',
          name: 'Song Two',
        },
      ],
      syncedAt: '2026-09-10T00:00:00.000Z',
      ...overrides,
    };
    writeFileSync(file, JSON.stringify(playlist, null, 2));
    return file;
  }

  it('does not overwrite a good dump with an equally-sized truncated Spotify response', async () => {
    const file = writePlaylist();
    const before = readFileSync(file, 'utf8');
    const truncated = [
      {
        n: 1,
        id: '3333333333333333333333',
        artist: 'Replacement One',
        name: 'Replacement One',
      },
      {
        n: 2,
        id: '4444444444444444444444',
        artist: 'Replacement Two',
        name: 'Replacement Two',
      },
    ] as SpotifyTrackList;
    truncated.truncated = true;
    spotifyApiService.getAllPlaylistTracks.mockResolvedValue(truncated);

    let failure: unknown;
    try {
      await service.resync(playlistId);
    } catch (error) {
      failure = error;
    }
    expect(String(failure)).toContain(
      'Could not load the live Spotify track list',
    );
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('treats a snapshot change as work even when the track count is unchanged', async () => {
    const file = writePlaylist();
    spotifyApiService.getLibraryPlaylists.mockResolvedValue([
      {
        id: playlistId,
        uri: playlistUri,
        name: 'Fixture',
        trackCount: 2,
        snapshotId: 'snapshot-new',
      },
    ]);
    const resync = jest.spyOn(service, 'resync').mockResolvedValue({
      id: playlistId,
      name: 'Fixture',
      before: 2,
      after: 2,
    });

    await (service as any).runLibrarySync();

    expect(resync).toHaveBeenCalledTimes(1);
    expect(resync).toHaveBeenCalledWith(playlistId);
    const status = service.librarySyncStatus();
    expect(status.running).toBe(false);
    expect(status.done).toBe(1);
    expect(status.total).toBe(1);
    expect(status.discovered).toBe(0);
    expect(status.changed).toBe(1);
    expect(status.errors).toEqual([]);
    expect(JSON.parse(readFileSync(file, 'utf8')).snapshotId).toBe(
      'snapshot-new',
    );
  });

  it('hydrates a legacy dump before establishing its first live snapshot baseline', async () => {
    const file = writePlaylist({ snapshotId: null });
    spotifyApiService.getLibraryPlaylists.mockResolvedValue([
      {
        id: playlistId,
        uri: playlistUri,
        name: 'Fixture',
        trackCount: 2,
        snapshotId: 'snapshot-first-live',
      },
    ]);
    const resync = jest
      .spyOn(service, 'resync')
      .mockImplementation(async () => {
        expect(JSON.parse(readFileSync(file, 'utf8')).snapshotId).toBeNull();
        return {
          id: playlistId,
          name: 'Fixture',
          before: 2,
          after: 2,
        };
      });

    await (service as any).runLibrarySync();

    expect(resync).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(file, 'utf8')).snapshotId).toBe(
      'snapshot-first-live',
    );
    expect(service.librarySyncStatus().changed).toBe(1);
    expect(service.librarySyncStatus().errors).toEqual([]);
  });

  it('does not advance a snapshot when resync refuses a shorter live list', async () => {
    const file = writePlaylist({ snapshotId: null });
    spotifyApiService.getLibraryPlaylists.mockResolvedValue([
      {
        id: playlistId,
        uri: playlistUri,
        name: 'Fixture',
        trackCount: 2,
        snapshotId: 'snapshot-new',
      },
    ]);
    spotifyApiService.getAllPlaylistTracks.mockResolvedValue([
      {
        n: 1,
        id: '1111111111111111111111',
        artist: 'Artist One',
        name: 'Song One',
      },
    ]);

    await (service as any).runLibrarySync();

    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.snapshotId).toBeNull();
    expect(saved.tracks.length).toBe(2);
    expect(service.librarySyncStatus().changed).toBe(0);
    expect(service.librarySyncStatus().errors[0]).toContain(
      'Refusing to shrink',
    );
  });

  it('does not advance a snapshot from an incomplete HTML fallback', async () => {
    const file = writePlaylist({ snapshotId: null });
    spotifyApiService.getLibraryPlaylists.mockResolvedValue([
      {
        id: playlistId,
        uri: playlistUri,
        name: 'Fixture',
        trackCount: 2,
        snapshotId: 'snapshot-new',
      },
    ]);
    spotifyApiService.getAllPlaylistTracks.mockRejectedValue(
      new Error('session unavailable'),
    );
    cdpProxy.healthy.mockResolvedValue(true);
    cdpProxy.tab.mockResolvedValue({
      targetId: 'target',
      sessionId: 'session',
    });
    cdpProxy.evaluate
      .mockResolvedValueOnce({
        pathId: playlistId,
        live: 3,
        h1: 'Fixture',
      })
      .mockResolvedValueOnce({
        tracks: [
          {
            n: 1,
            id: '1111111111111111111111',
            artist: 'Artist One',
            name: 'Song One',
          },
          {
            n: 2,
            id: '2222222222222222222222',
            artist: 'Artist Two',
            name: 'Song Two',
          },
        ],
        expectedCount: 3,
        truncated: true,
      });

    await (service as any).runLibrarySync();

    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.snapshotId).toBeNull();
    expect(saved.tracks.length).toBe(2);
    expect(service.librarySyncStatus().changed).toBe(0);
    expect(service.librarySyncStatus().errors[0]).toContain(
      'Could not load the live Spotify track list',
    );
  });

  it('preserves duplicate track occurrences from a complete HTML fallback', async () => {
    const file = writePlaylist();
    spotifyApiService.getAllPlaylistTracks.mockRejectedValue(
      new Error('session unavailable'),
    );
    cdpProxy.healthy.mockResolvedValue(true);
    cdpProxy.tab.mockResolvedValue({
      targetId: 'target',
      sessionId: 'session',
    });
    cdpProxy.evaluate
      .mockResolvedValueOnce({
        pathId: playlistId,
        live: 2,
        h1: 'Fixture',
      })
      .mockResolvedValueOnce({
        tracks: [
          {
            n: 1,
            id: 'same-track-id',
            artist: 'Repeated Artist',
            name: 'Repeated Song',
          },
          {
            n: 2,
            id: 'same-track-id',
            artist: 'Repeated Artist',
            name: 'Repeated Song',
          },
        ],
        expectedCount: 2,
        truncated: false,
      });

    await service.resync(playlistId);

    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.tracks.length).toBe(2);
    expect(
      saved.tracks.map(
        (track: StaticPlaylistFile['tracks'][number]) => track.id,
      ),
    ).toEqual(['same-track-id', 'same-track-id']);
  });

  it('hardlinks completed audio and never enqueues the same playlist track', async () => {
    writePlaylist({
      name: 'Target',
      trackCount: 1,
      tracks: [
        {
          n: 1,
          id: '1111111111111111111111',
          artist: 'Artist',
          name: 'Song',
        },
      ],
    });
    const sourceDir = join(downloadsDir, 'Source');
    const destinationDir = join(downloadsDir, 'Target');
    const source = join(sourceDir, 'Artist - Song.mp3');
    const destination = join(destinationDir, 'Artist - Song.mp3');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(source, 'audio bytes');

    const prior = {
      id: 7,
      artist: 'Artist',
      name: 'Song',
      status: TrackStatusEnum.Queued,
      error: 'stale failure',
    };
    const playlist = {
      id: 3,
      name: 'Target',
      spotifyUrl: `https://open.spotify.com/playlist/${playlistId}`,
      tracks: [prior],
    };
    playlistService.findBySpotifyUrl.mockResolvedValue(playlist);
    trackService.update.mockImplementation(
      async (_id: number, next: typeof prior) => Object.assign(prior, next),
    );

    expect(await service.download([playlistUri])).toEqual({
      queued: 0,
      skipped: 1,
    });
    expect(await service.download([playlistUri])).toEqual({
      queued: 0,
      skipped: 1,
    });

    expect(readFileSync(destination, 'utf8')).toBe('audio bytes');
    expect(statSync(destination).ino).toBe(statSync(source).ino);
    expect(prior.status).toBe(TrackStatusEnum.Completed);
    expect(prior.error).toBeNull();
    expect(trackService.update).toHaveBeenCalledTimes(1);
    expect(trackService.create).not.toHaveBeenCalled();
    expect(trackService.retry).not.toHaveBeenCalled();
    expect(trackService.addCompletedTrack).not.toHaveBeenCalled();
  });

  it('bulk download skips permanent misses while an explicit playlist retry opts in', async () => {
    writePlaylist({
      trackCount: 1,
      tracks: [
        {
          n: 1,
          id: '1111111111111111111111',
          artist: 'Artist One',
          name: 'Song One',
        },
      ],
    });
    const prior = {
      id: 11,
      artist: 'Artist One',
      name: 'Song One',
      status: TrackStatusEnum.Error,
      error: 'No YouTube result',
    };
    playlistService.findBySpotifyUrl.mockResolvedValue({
      id: 4,
      name: 'Fixture',
      spotifyUrl: `https://open.spotify.com/playlist/${playlistId}`,
      tracks: [prior],
    });

    expect(await service.downloadRemaining()).toEqual({
      queued: 0,
      skipped: 1,
    });
    expect(trackService.retry).not.toHaveBeenCalled();

    expect(
      await service.download([playlistUri], { retryMissing: true }),
    ).toEqual({
      queued: 1,
      skipped: 0,
    });
    expect(trackService.retry).toHaveBeenCalledTimes(1);
    expect(trackService.retry).toHaveBeenCalledWith(prior.id, {
      retryMissing: true,
    });
  });

  it('does not copy a wrong-duration source and queues durable handling instead', async () => {
    writePlaylist({
      trackCount: 1,
      tracks: [
        { id: '1111111111111111111111', artist: 'Artist', name: 'Song' },
      ],
    });
    const sourceDir = join(downloadsDir, 'Source');
    mkdirSync(sourceDir);
    const source = join(sourceDir, 'Artist - Song.mp3');
    writeFileSync(source, 'original');
    playlistService.findBySpotifyUrl.mockResolvedValue({
      id: 3,
      name: 'Fixture',
      tracks: [],
    });
    trackService.verifyLocalAudio.mockRejectedValue(
      new Error('duration mismatch'),
    );
    expect(await service.download([playlistUri])).toEqual({
      queued: 1,
      skipped: 0,
    });
    expect(() =>
      statSync(join(downloadsDir, 'Fixture', 'Artist - Song.mp3')),
    ).toThrow();
    expect(readFileSync(source, 'utf8')).toBe('original');
    expect(trackService.addCompletedTrack).not.toHaveBeenCalled();
    expect(trackService.create).toHaveBeenCalledTimes(1);
  });

  it('resync preserves trusted duration and carries newly hydrated source duration', async () => {
    const path = writePlaylist({
      tracks: [
        {
          id: '1111111111111111111111',
          artist: 'Artist One',
          name: 'Song One',
          durationMs: 180000,
        },
        {
          id: '2222222222222222222222',
          artist: 'Artist Two',
          name: 'Song Two',
        },
      ],
    });
    spotifyApiService.getAllPlaylistTracks.mockResolvedValue([
      { id: '1111111111111111111111', artist: 'Artist One', name: 'Song One' },
      {
        id: '2222222222222222222222',
        artist: 'Artist Two',
        name: 'Song Two',
        durationMs: 210000,
      },
    ]);
    await service.resync(playlistId);
    expect(
      JSON.parse(readFileSync(path, 'utf8')).tracks.map(
        (track) => track.durationMs,
      ),
    ).toEqual([180000, 210000]);
  });

  it('does not reuse empty or differently encoded files as an MP3', async () => {
    writePlaylist({
      trackCount: 1,
      tracks: [
        {
          n: 1,
          id: '1111111111111111111111',
          artist: 'Artist One',
          name: 'Song One',
        },
      ],
    });
    const sourceDir = join(downloadsDir, 'Source');
    const targetDir = join(downloadsDir, 'Fixture');
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(sourceDir, 'Artist One - Song One.m4a'), 'aac bytes');
    writeFileSync(join(targetDir, 'Artist One - Song One.mp3'), '');
    playlistService.findBySpotifyUrl.mockResolvedValue({
      id: 5,
      name: 'Fixture',
      spotifyUrl: `https://open.spotify.com/playlist/${playlistId}`,
      tracks: [],
    });

    expect(await service.download([playlistUri])).toEqual({
      queued: 1,
      skipped: 0,
    });
    expect(trackService.create).toHaveBeenCalledTimes(1);
    expect(trackService.addCompletedTrack).not.toHaveBeenCalled();
    expect(statSync(join(targetDir, 'Artist One - Song One.mp3')).size).toBe(0);
  });

  it('keeps operational failures actionable instead of counting them as done', async () => {
    writePlaylist({
      trackCount: 1,
      tracks: [
        {
          n: 1,
          id: '1111111111111111111111',
          artist: 'Artist One',
          name: 'Song One',
        },
      ],
    });
    trackService.getAll.mockResolvedValue([
      {
        artist: 'Artist One',
        name: 'Song One',
        status: TrackStatusEnum.Error,
        error: 'Temporary YouTube failure: socket timed out',
      },
    ]);

    const listed = await service.list();
    const detailed = await service.detail(playlistId);

    expect(listed.playlists[0].failed).toBe(0);
    expect(listed.playlists[0].done).toBe(false);
    expect(detailed.playlist.failed).toBe(0);
    expect(detailed.playlist.done).toBe(false);
    expect(detailed.tracks[0].missing).not.toBe(true);
    expect(detailed.tracks[0].error).toMatch(/temporary youtube failure/i);
  });

  it('surfaces a delayed search retry as actionable rather than missing', async () => {
    writePlaylist({
      trackCount: 1,
      tracks: [
        {
          n: 1,
          id: '1111111111111111111111',
          artist: 'Artist One',
          name: 'Song One',
        },
      ],
    });
    trackService.getAll.mockResolvedValue([
      {
        artist: 'Artist One',
        name: 'Song One',
        status: TrackStatusEnum.RetryWaiting,
        error: 'Temporary YouTube failure; search retry 1/3 in 15m',
      },
    ]);

    const listed = await service.list();
    const detailed = await service.detail(playlistId);

    expect(listed.playlists[0].failed).toBe(0);
    expect(listed.playlists[0].done).toBe(false);
    expect(detailed.tracks[0].missing).not.toBe(true);
    expect(detailed.tracks[0].error).toMatch(/search retry 1\/3/i);
  });

  it('counts a genuine no-result search as terminal missing', async () => {
    writePlaylist({
      trackCount: 1,
      tracks: [
        {
          n: 1,
          id: '1111111111111111111111',
          artist: 'Artist One',
          name: 'Song One',
        },
      ],
    });
    trackService.getAll.mockResolvedValue([
      {
        artist: 'Artist One',
        name: 'Song One',
        status: TrackStatusEnum.Error,
        error: 'No YouTube result',
      },
    ]);

    const listed = await service.list();
    const detailed = await service.detail(playlistId);

    expect(listed.playlists[0].failed).toBe(1);
    expect(listed.playlists[0].done).toBe(true);
    expect(detailed.playlist.failed).toBe(1);
    expect(detailed.playlist.done).toBe(true);
    expect(detailed.tracks[0].missing).toBe(true);
  });
});
