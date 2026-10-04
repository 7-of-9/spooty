import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EnvironmentEnum } from '../environmentEnum';
import { UtilsService } from '../shared/utils.service';
import { SpotifyApiService, SpotifyTrackList } from '../shared/spotify-api.service';
import { SpotifySessionService } from '../shared/spotify-session.service';
import { completeSpotifyMembership } from '../shared/spotify-membership';
import { TrackStatusEnum } from '../track/track.entity';
import { LibraryService, StaticPlaylistFile } from './library.service';
import { webAdmission } from '../shared/web-admission-state';
import { expect } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { LibraryController } from './library.controller';
import * as request from 'supertest';
import { MediaDurationCache } from '../shared/acquisition/local-media';
import { sourceFileBase } from '../shared/acquisition/identity';
import { io as socketClient } from 'socket.io-client';

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
    getAllByPlaylist: jest.Mock;
    update: jest.Mock;
    addCompletedTrack: jest.Mock;
    create: jest.Mock;
    retry: jest.Mock;
    remove: jest.Mock;
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
  let utils: UtilsService;

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
        if (key === EnvironmentEnum.DB_PATH)
          return join(root, 'data', 'spooty.sqlite');
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
      getAllByPlaylist: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      addCompletedTrack: jest.fn(),
      create: jest.fn().mockResolvedValue(true),
      retry: jest.fn().mockResolvedValue(true),
      remove: jest.fn(),
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
    utils = utilsService;
    service = new LibraryService(
      configService as any,
      playlistService as any,
      trackService as any,
      utilsService,
      spotifyApiService as any,
      cdpProxy as any,
    );
    jest.spyOn(service as any, 'createCoverageWatch').mockReturnValue({ live: true, close: jest.fn() });
  });

  afterEach(() => { service.onModuleDestroy(); jest.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

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

  function verified(tracks: StaticPlaylistFile['tracks'], itemCount = tracks!.length): SpotifyTrackList {
    const result = [...tracks!] as SpotifyTrackList;
    result.truncated = false;
    result.membership = completeSpotifyMembership(playlistId, itemCount, tracks!.map(track => track.id!));
    return result;
  }

  it('does not infer Spotify library absence before a complete library check', async () => {
    writePlaylist();
    expect((await service.detail(playlistId)).playlist).not.toHaveProperty('libraryPresence');
    expect((await service.view()).playlists[0]).not.toHaveProperty('libraryPresence');
    expect(spotifyApiService.getLibraryPlaylists).not.toHaveBeenCalled();
  });

  it('projects a complete empty Spotify library as kept-local without rewriting files or rescanning audio', async () => {
    const file = writePlaylist();
    const before = readFileSync(file, 'utf8'), beforeStat = statSync(file);
    const first = await service.view();
    const index = jest.spyOn(service as any, 'indexAudioFiles');
    const emit = jest.fn(); (service as any).io = { emit };
    spotifyApiService.getLibraryPlaylists.mockResolvedValue([]);
    await (service as any).runLibrarySync();
    const view = await service.view();
    expect(view.coverage!.id).toBe(first.coverage!.id);
    expect(view.playlists[0]).toHaveProperty('libraryPresence.state', 'not-returned');
    expect((await service.viewDetail(playlistId, view.coverage!.id)).playlist).toHaveProperty('libraryPresence.state', 'not-returned');
    expect(index).not.toHaveBeenCalled();
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(statSync(file).ino).toBe(beforeStat.ino);
    expect(statSync(file).mtimeMs).toBe(beforeStat.mtimeMs);
    expect(emit).toHaveBeenCalledWith('libraryCoverageChanged', expect.any(Object));
    expect(service.librarySyncStatus()).not.toHaveProperty('libraryObservation');
    for (const action of [trackService.create, trackService.retry, trackService.update, spotifyApiService.getAllPlaylistTracks]) expect(action).not.toHaveBeenCalled();
  });

  it('retains the last complete library observation across failed checks and focused sync', async () => {
    writePlaylist(); spotifyApiService.getLibraryPlaylists.mockResolvedValue([]);
    await (service as any).runLibrarySync();
    const before = (await service.detail(playlistId)).playlist as any;
    expect(before.libraryPresence?.state).toBe('not-returned');
    for (const message of ['Spotify library discovery incomplete: page gap', 'Spotify request failed: 429', 'Chrome bridge unavailable']) {
      spotifyApiService.getLibraryPlaylists.mockRejectedValue(new Error(message));
      service.startLibrarySync();
      await expect((service as any).syncTask).rejects.toThrow(message);
      expect((await service.detail(playlistId)).playlist).toHaveProperty('libraryPresence', before.libraryPresence);
    }
    jest.spyOn(service, 'resync').mockResolvedValue({ id: playlistId, name: 'Fixture', before: 2, after: 2 });
    service.startPlaylistSync(playlistId); await (service as any).syncTask;
    expect((await service.detail(playlistId)).playlist).toHaveProperty('libraryPresence', before.libraryPresence);
    service.startResyncAll(); await (service as any).syncTask;
    expect((await service.detail(playlistId)).playlist).toHaveProperty('libraryPresence', before.libraryPresence);
  });

  it('keeps a complete library observation even when refreshing its track list fails', async () => {
    const file = writePlaylist(), before = readFileSync(file, 'utf8');
    spotifyApiService.getLibraryPlaylists.mockResolvedValue([{ id: playlistId, uri: playlistUri, name: 'Fixture' }]);
    jest.spyOn(service, 'resync').mockRejectedValue(new Error('Spotify request failed: 429'));
    service.startLibrarySync(); await (service as any).syncTask;
    expect(service.librarySyncStatus().failureKind).toBe('rate-limit');
    expect((await service.detail(playlistId)).playlist).toHaveProperty('libraryPresence.state', 'present');
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('does not publish malformed or repeated discovery identities', async () => {
    writePlaylist();
    for (const ids of [['bad-id'], [playlistId, playlistId]]) {
      spotifyApiService.getLibraryPlaylists.mockResolvedValue(ids.map(id => ({ id, name: 'Fixture', uri: `spotify:playlist:${id}` })));
      await expect((service as any).runLibrarySync()).rejects.toThrow('Spotify library discovery incomplete');
      expect((await service.detail(playlistId)).playlist).not.toHaveProperty('libraryPresence');
    }
    expect(spotifyApiService.getAllPlaylistTracks).not.toHaveBeenCalled();
  });

  it('replaces a kept-local observation only after a later complete library check returns the playlist', async () => {
    writeVerifiedPlaylist(); spotifyApiService.getLibraryPlaylists.mockResolvedValue([]);
    await (service as any).runLibrarySync();
    expect((await service.detail(playlistId)).playlist).toHaveProperty('libraryPresence.state', 'not-returned');
    spotifyApiService.getLibraryPlaylists.mockResolvedValue([{ id: playlistId, uri: playlistUri, name: 'Fixture', trackCount: 2, snapshotId: 'snapshot-old' }]);
    await (service as any).runLibrarySync();
    expect((await service.list()).playlists[0]).toHaveProperty('libraryPresence.state', 'present');
    expect(spotifyApiService.getAllPlaylistTracks).not.toHaveBeenCalled();
  });

  it('restores library presence after backend restart without any Spotify request', async () => {
    writePlaylist(); spotifyApiService.getLibraryPlaylists.mockResolvedValue([]);
    await (service as any).runLibrarySync();
    const original = (await service.detail(playlistId)).playlist as any;
    const restored = new LibraryService((service as any).configService, playlistService as any, trackService as any, utils, spotifyApiService as any, cdpProxy as any);
    spotifyApiService.getLibraryPlaylists.mockClear();
    try { expect((await restored.detail(playlistId)).playlist).toHaveProperty('libraryPresence', original.libraryPresence); }
    finally { restored.onModuleDestroy(); }
    expect(spotifyApiService.getLibraryPlaylists).not.toHaveBeenCalled();
  });

  it('does not publish a new library observation when its durable write fails', async () => {
    writeVerifiedPlaylist(); spotifyApiService.getLibraryPlaylists.mockResolvedValue([]);
    await (service as any).runLibrarySync();
    const original = (await service.detail(playlistId)).playlist as any;
    jest.spyOn(service as any, 'persistLibrarySync').mockReturnValue(false);
    spotifyApiService.getLibraryPlaylists.mockResolvedValue([{ id: playlistId, uri: playlistUri, name: 'Fixture' }]);
    await expect((service as any).runLibrarySync()).rejects.toThrow('Could not save Spotify library observation');
    expect((await service.detail(playlistId)).playlist).toHaveProperty('libraryPresence', original.libraryPresence);
    expect(spotifyApiService.getAllPlaylistTracks).not.toHaveBeenCalled();
  });

  it('notifies an HTTP/socket client after a complete empty discovery without changing files or the audio scan', async () => {
    const file = writeVerifiedPlaylist(), before = readFileSync(file, 'utf8');
    const folder = utils.getPlaylistFolderPath('Fixture'); mkdirSync(folder, { recursive: true });
    const audio = join(folder, 'Artist One - Song One.mp3'); writeFileSync(audio, 'existing fixture MP3');
    const audioInode = statSync(audio).ino;
    jest.spyOn(MediaDurationCache.prototype, 'duration').mockResolvedValue(180);
    const session = new SpotifySessionService(cdpProxy as any);
    jest.spyOn(session, 'getAccessToken').mockResolvedValue('fixture-token');
    const upstream = jest.spyOn(session as any, 'sessionFetch').mockResolvedValue({ ok: true,
      json: async () => ({ items: [], total: 0, offset: 0, limit: 50, next: null }) });
    (service as any).spotifyApiService = new SpotifyApiService(session);
    const dependencies = Reflect.getMetadata('design:paramtypes', LibraryService);
    const values = ['configService', 'playlistService', 'trackService', 'utilsService', 'spotifyApiService', 'cdpProxy'].map(name => (service as any)[name]);
    service.onModuleDestroy();
    const module = await Test.createTestingModule({ controllers: [LibraryController], providers: [LibraryService,
      ...dependencies.map((provide, index) => ({ provide, useValue: values[index] }))] }).compile();
    service = module.get(LibraryService);
    jest.spyOn(service as any, 'createCoverageWatch').mockReturnValue({ live: true, close: jest.fn() });
    const app = module.createNestApplication(); app.setGlobalPrefix('api'); await app.listen(0, '127.0.0.1');
    const socket = socketClient(await app.getUrl(), { autoConnect: false, transports: ['websocket'], reconnection: false });
    const events: any[] = []; socket.on('libraryCoverageChanged', event => events.push(event));
    const until = async (check: () => boolean) => {
      const deadline = Date.now() + 4000;
      while (!check() && Date.now() < deadline) await new Promise(yes => setTimeout(yes, 20));
      expect(check()).toBe(true);
    };
    try {
      socket.connect(); await until(() => socket.connected);
      const first = (await request(app.getHttpServer()).get('/api/library/view').expect(200)).body;
      const index = jest.spyOn(service as any, 'indexAudioFiles');
      const priorEvents = events.length;
      await request(app.getHttpServer()).post('/api/library/sync').expect(201);
      await until(() => events.length > priorEvents && !service.librarySyncStatus().running);
      const next = (await request(app.getHttpServer()).get(`/api/library/view?scan=${first.coverage.id}`).expect(200)).body;
      expect(next.playlists[0]).toHaveProperty('libraryPresence.state', 'not-returned');
      expect(next.totals).toEqual(first.totals); expect(next.coverage.id).toBe(first.coverage.id);
      const detail = (await request(app.getHttpServer()).get(`/api/library/view/detail/${playlistId}?scan=${first.coverage.id}`).expect(200)).body;
      expect(detail.playlist.libraryPresence).toEqual(next.playlists[0].libraryPresence);
      expect(detail.tracks[0].onDisk).toBe(true); expect(index).not.toHaveBeenCalled();
      expect(readFileSync(file, 'utf8')).toBe(before);
      expect(readFileSync(audio, 'utf8')).toBe('existing fixture MP3'); expect(statSync(audio).ino).toBe(audioInode);
      expect(upstream).toHaveBeenCalledTimes(1);
      for (const mutation of [trackService.create, trackService.retry, trackService.update, playlistService.save, cdpProxy.tab]) expect(mutation).not.toHaveBeenCalled();
    } finally { socket.disconnect(); await app.close(); }
  }, 12000);

  async function notifyChange(partial: object): Promise<void> {
    const factory = (service as any).createCoverageWatch as jest.Mock;
    factory.mock.calls[factory.mock.calls.length - 1][1]({ media: [], sources: [], workflow: false, membership: false, failed: false, ...partial });
    await (service as any).coverageChanges;
    await (service as any).coverageScan.finished;
  }

  it('refreshes changed media and socket notices without rebuilding the whole index or probing unrelated songs', async () => {
    writePlaylist({ tracks: [
      { id: '1111111111111111111111', artist: 'Artist One', name: 'Song One', durationMs: 180000 },
      { id: '2222222222222222222222', artist: 'Artist Two', name: 'Song Two', durationMs: 180000 },
    ] });
    const folder = utils.getPlaylistFolderPath('Fixture'); mkdirSync(folder, { recursive: true });
    const first = join(folder, 'Artist One - Song One.mp3'), second = join(folder, 'Artist Two - Song Two.mp3');
    writeFileSync(second, 'fixture-media');
    const probe = jest.spyOn(MediaDurationCache.prototype, 'duration').mockResolvedValue(180);
    const index = jest.spyOn(service as any, 'indexAudioFiles');
    service.io = { emit: jest.fn() } as any;
    const before = await service.view(); expect(before.totals.onDisk).toBe(1);
    const id = before.coverage!.id;
    expect((await service.view()).coverage!.id).toBe(id);
    writeFileSync(first, 'fixture-media'); await notifyChange({ media: [first] });
    const added = await service.view();
    expect(added.coverage).toMatchObject({ scope: 'changes', total: 1, checked: 1, updates: 'live' });
    expect(added.totals.onDisk).toBe(2); expect(added.coverage!.id).not.toBe(id);
    expect(service.io!.emit).toHaveBeenCalledWith('libraryCoverageChanged', expect.objectContaining({ id: added.coverage!.id }));
    expect(probe).toHaveBeenCalledTimes(2); expect(index).toHaveBeenCalledTimes(1);
    rmSync(first); await notifyChange({ media: [first] });
    expect((await service.view()).totals.onDisk).toBe(1);
    expect(probe).toHaveBeenCalledTimes(2); expect(index).toHaveBeenCalledTimes(1);
    expect(trackService.create).not.toHaveBeenCalled(); expect(cdpProxy.tab).not.toHaveBeenCalled();
  });

  it('projects changed workflow rows and watch failure without repeating local media checks', async () => {
    writePlaylist(); const first = await service.view();
    const index = jest.spyOn(service as any, 'indexAudioFiles');
    trackService.getAll.mockResolvedValue([{ id: 1, artist: 'Artist One', name: 'Song One',
      spotifyUrl: 'spotify:track:1111111111111111111111', status: TrackStatusEnum.Error,
      error: 'No YouTube results found', acquisitionState: 'missing' }]);
    await notifyChange({ workflow: true });
    expect((await service.viewDetail(playlistId, first.coverage!.id)).tracks[0].error).toBe('No YouTube results found');
    expect(index).not.toHaveBeenCalled();
    await notifyChange({ failed: true });
    expect((await service.view()).coverage!.updates).toBe('manual');
    expect(index).not.toHaveBeenCalled();
    await service.view(undefined, true); expect(index).toHaveBeenCalledTimes(1);
  });

  it('rechecks the exact source when new Spotify duration evidence disqualifies a previously unverified file', async () => {
    writePlaylist({ tracks: [{ id: '1111111111111111111111', artist: 'Artist', name: 'Unknown length' }] });
    const folder = utils.getPlaylistFolderPath('Fixture'); mkdirSync(folder, { recursive: true });
    const file = join(folder, 'Artist - Unknown length.mp3'); writeFileSync(file, 'fixture-media');
    jest.spyOn(MediaDurationCache.prototype, 'duration').mockResolvedValue(180);
    const first = await service.view(); expect(first.totals.onDisk).toBe(1);
    expect((await service.viewDetail(playlistId, first.coverage!.id)).tracks[0].mediaVerification).toBe('unverified');
    const metadata = join(root, 'data', 'spotify-track-metadata'); mkdirSync(metadata, { recursive: true });
    writeFileSync(join(metadata, '1111111111111111111111.json'), JSON.stringify({ version: 1,
      spotifyId: '1111111111111111111111', name: 'Unknown length', artist: 'Artist', durationMs: 60000 }));
    await notifyChange({ sources: ['spotify:1111111111111111111111'] });
    const next = await service.view(); expect(next.totals.onDisk).toBe(0);
    expect((await service.viewDetail(playlistId, next.coverage!.id)).tracks[0].mediaVerification).toBe('mismatch');
    expect(readFileSync(file, 'utf8')).toBe('fixture-media'); expect(trackService.create).not.toHaveBeenCalled();
  });

  it('invalidates external playlist changes and ignores notifications from replaced watchers', async () => {
    writePlaylist(); const first = await service.view();
    const factory = (service as any).createCoverageWatch as jest.Mock;
    const oldNotify = factory.mock.calls[0][1];
    writePlaylist({ name: 'Updated externally' }); await notifyChange({ membership: true });
    await expect(service.view(first.coverage!.id)).rejects.toThrow(/check changed/);
    const next = await service.view(); expect(next.playlists[0].name).toBe('Updated externally');
    oldNotify({ media: [], sources: [], workflow: false, membership: true, failed: true });
    await (service as any).coverageChanges;
    expect((await service.view(next.coverage!.id)).coverage!.updates).toBe('live');
  });

  it('does not recreate a file watcher or return a usable scan after disposal during preparation', async () => {
    writePlaylist(); let finish!: (rows: any[]) => void;
    trackService.getAll.mockReturnValueOnce(new Promise(yes => { finish = yes; }));
    const pending = service.view(); service.onModuleDestroy(); finish([]);
    await expect(pending).rejects.toThrow(/stopped with the server/);
    await expect(service.view()).rejects.toThrow(/stopped with the server/);
    expect((service as any).createCoverageWatch).toHaveBeenCalledTimes(1);
  });

  it('delivers native filesystem changes through the real Nest socket and HTTP view on an isolated fixture', async () => {
    writePlaylist({ tracks: [{ id: '1111111111111111111111', artist: 'Artist', name: 'Native watch', durationMs: 180000 }] });
    const folder = utils.getPlaylistFolderPath('Fixture'); mkdirSync(folder, { recursive: true });
    jest.spyOn(MediaDurationCache.prototype, 'duration').mockResolvedValue(180);
    const dependencies = Reflect.getMetadata('design:paramtypes', LibraryService);
    const values = ['configService', 'playlistService', 'trackService', 'utilsService', 'spotifyApiService', 'cdpProxy'].map(name => (service as any)[name]);
    service.onModuleDestroy();
    const module = await Test.createTestingModule({ controllers: [LibraryController], providers: [LibraryService,
      ...dependencies.map((provide, index) => ({ provide, useValue: values[index] }))] }).compile();
    service = module.get(LibraryService);
    const app = module.createNestApplication(); app.setGlobalPrefix('api'); await app.listen(0, '127.0.0.1');
    const socket = socketClient(await app.getUrl(), { autoConnect: false, transports: ['websocket'], reconnection: false });
    const events: any[] = []; socket.on('libraryCoverageChanged', event => events.push(event));
    const until = async (check: () => boolean) => {
      const deadline = Date.now() + 5000;
      while (!check() && Date.now() < deadline) await new Promise(yes => setTimeout(yes, 20));
      expect(check()).toBe(true);
    };
    try {
      socket.connect(); await until(() => socket.connected);
      const first = (await request(app.getHttpServer()).get('/api/library/view')).body;
      expect(first.coverage.updates).toBe('live'); expect(first.totals.onDisk).toBe(0);
      const file = join(folder, 'Artist - Native watch.mp3'); writeFileSync(file, 'fixture-media');
      await until(() => events.length > 0); await (service as any).coverageChanges; await (service as any).coverageScan.finished;
      const next = (await request(app.getHttpServer()).get('/api/library/view')).body;
      expect(next.coverage).toMatchObject({ scope: 'changes', total: 1, state: 'complete' });
      expect(next.totals.onDisk).toBe(1); expect(next.coverage.id).not.toBe(first.coverage.id);
      const detail = (await request(app.getHttpServer()).get(`/api/library/view/detail/${playlistId}?scan=${next.coverage.id}`)).body;
      expect(detail.tracks[0]).toMatchObject({ onDisk: true, filename: 'Artist - Native watch.mp3' });
      const count = events.length; rmSync(file); await until(() => events.length > count);
      await (service as any).coverageChanges; await (service as any).coverageScan.finished;
      expect((await service.view()).totals.onDisk).toBe(0);
      expect(trackService.create).not.toHaveBeenCalled(); expect(cdpProxy.tab).not.toHaveBeenCalled(); expect(spotifyApiService.getLibraryPlaylists).not.toHaveBeenCalled();
    } finally { socket.disconnect(); await app.close(); }
  }, 15000);

  it('returns browsable metadata during a cold scan and observes it without restarting or contacting Spotify', async () => {
    writePlaylist({ tracks: [{ n: 1, id: '1111111111111111111111', artist: 'Artist', name: 'Slow local audio', durationMs: 180000 }] });
    const folder = utils.getPlaylistFolderPath('Fixture');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'Artist - Slow local audio.mp3'), 'fixture-media');
    let finish!: (seconds: number) => void;
    const pending = new Promise<number>(yes => { finish = yes; });
    const probe = jest.spyOn(MediaDurationCache.prototype, 'duration').mockReturnValue(pending);
    const view = await service.view();
    expect(view.coverage).toMatchObject({ state: 'checking', checked: 0, total: 1 });
    expect(view.playlists[0]).toMatchObject({ name: 'Fixture', coveragePending: 1, done: false });
    const id = view.coverage!.id;
    expect((await service.view(id)).coverage!.id).toBe(id);
    expect((await service.view()).coverage!.id).toBe(id);
    expect((await service.viewDetail(playlistId, id)).tracks[0]).toMatchObject({ onDisk: false, mediaVerification: 'checking' });
    expect(probe).toHaveBeenCalledTimes(1);
    finish(180);
    await (service as any).coverageScan.finished;
    expect((await service.view(id)).playlists[0]).toMatchObject({ onDisk: 1, coveragePending: 0, done: true });
    expect((await service.viewDetail(playlistId, id)).tracks[0].filename).toBe('Artist - Slow local audio.mp3');
    expect(spotifyApiService.getLibraryPlaylists).not.toHaveBeenCalled();
    expect(cdpProxy.tab).not.toHaveBeenCalled();
    expect(trackService.create).not.toHaveBeenCalled();
    expect(trackService.update).not.toHaveBeenCalled();
  });

  it('rejects stale scan identities after a folder change without applying old file evidence', async () => {
    writePlaylist();
    const first = await service.view();
    const other = join(root, 'moved'); mkdirSync(other);
    jest.spyOn(utils, 'getRootDownloadsPath').mockReturnValue(other);
    await expect(service.view(first.coverage!.id)).rejects.toThrow(/check changed/);
    await expect(service.viewDetail(playlistId, first.coverage!.id)).rejects.toThrow(/check changed/);
    const next = await service.view();
    expect(next.coverage!.id).not.toBe(first.coverage!.id);
    expect(next.coverage!.destination).toBe(other);
    expect(next.totals.onDisk).toBe(0);
    await expect(service.view('old-backend-scan')).rejects.toThrow(/check changed/);
  });

  it('serves the real HTTP view and focused rows before a slow local probe finishes', async () => {
    writePlaylist({ tracks: [{ n: 1, id: '1111111111111111111111', artist: 'Artist', name: 'Cold HTTP file', durationMs: 180000 }] });
    const folder = utils.getPlaylistFolderPath('Fixture'); mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'Artist - Cold HTTP file.mp3'), 'fixture-media');
    let finish!: (seconds: number) => void;
    const pending = new Promise<number>(yes => { finish = yes; });
    jest.spyOn(MediaDurationCache.prototype, 'duration').mockReturnValue(pending);
    const module = await Test.createTestingModule({ controllers: [LibraryController],
      providers: [{ provide: LibraryService, useValue: service }] }).compile();
    const app = module.createNestApplication(); app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    try {
      const response = await request(app.getHttpServer()).get('/api/library/view').timeout(1500);
      expect(response.status).toBe(200);
      const body = response.body;
      expect(body.playlists).toHaveLength(1);
      expect(body.coverage.state).toBe('checking');
      const trackResponse = await request(app.getHttpServer()).get(`/api/library/view/detail/${playlistId}?scan=${body.coverage.id}`).timeout(1500);
      expect(trackResponse.body.tracks[0].mediaVerification).toBe('checking');
      finish(180); await (service as any).coverageScan.finished;
      const complete = await request(app.getHttpServer()).get(`/api/library/view?scan=${body.coverage.id}`);
      expect(complete.body.coverage.state).toBe('complete');
      expect(trackService.create).not.toHaveBeenCalled();
      expect(cdpProxy.tab).not.toHaveBeenCalled();
    } finally { finish(180); await app.close(); }
  });

  it('invalidates a completed scan when Spotify writes a new saved membership', async () => {
    const file = writePlaylist(); const first = await service.view();
    await (service as any).coverageScan.finished;
    (service as any).writePlaylistFile(file, { id: playlistId, name: 'New name', tracks: [] });
    await expect(service.view(first.coverage!.id)).rejects.toThrow(/check changed/);
    const next = await service.view();
    expect(next.coverage!.id).not.toBe(first.coverage!.id);
    expect(next.playlists[0]).toMatchObject({ name: 'New name', trackCount: 0, coveragePending: 0 });
  });

  it('coalesces concurrent view reads when the folder changes during initial preparation', async () => {
    writePlaylist();
    let finish!: (rows: any[]) => void;
    trackService.getAll.mockReturnValueOnce(new Promise(yes => { finish = yes; }));
    const index = jest.spyOn(service as any, 'indexAudioFiles');
    const first = service.view(), second = service.view();
    const other = join(root, 'new-root'); mkdirSync(other);
    jest.spyOn(utils, 'getRootDownloadsPath').mockReturnValue(other);
    finish([]);
    const [a, b] = await Promise.all([first, second]);
    expect(a.coverage!.id).toBe(b.coverage!.id);
    expect(a.coverage!.destination).toBe(other);
    expect(index).toHaveBeenCalledTimes(2); // Old generation plus one replacement.
  });

  function writeVerifiedPlaylist(overrides: Partial<StaticPlaylistFile> = {}): string {
    const file = writePlaylist({ owner: null, ...overrides });
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    raw.membership = completeSpotifyMembership(playlistId, raw.tracks.length, raw.tracks.map(track => track.id));
    writeFileSync(file, JSON.stringify(raw, null, 2));
    return file;
  }

  it('reflects twice-confirmed Spotify removals by unlinking this playlist copy and dropping its queued work', async () => {
    const file = writePlaylist();
    const original = JSON.parse(readFileSync(file, 'utf8'));
    const folder = join(downloadsDir, 'Fixture');
    const other = join(downloadsDir, 'Other');
    mkdirSync(folder);
    mkdirSync(other);
    const audio = join(folder, 'Artist Two - Song Two.mp3');
    const sibling = join(other, 'Artist Two - Song Two.mp3');
    writeFileSync(audio, 'existing MP3 fixture');
    const { linkSync } = await import('fs');
    linkSync(audio, sibling);
    const inode = statSync(sibling).ino;
    const queued = {
      id: 12,
      artist: 'Artist Two',
      name: 'Song Two',
      spotifyUrl: 'https://open.spotify.com/track/2222222222222222222222',
      status: TrackStatusEnum.Queued,
    };
    playlistService.findBySpotifyUrl.mockResolvedValue({ id: 7, name: 'Fixture' });
    trackService.getAllByPlaylist.mockResolvedValue([queued]);
    spotifyApiService.getAllPlaylistTracks.mockResolvedValue(verified(original.tracks.slice(0, 1)));

    const result = await service.resync(playlistId);

    expect(result).toEqual({ id: playlistId, name: 'Fixture', before: 2, after: 1, removedFiles: 1 });
    expect(spotifyApiService.getAllPlaylistTracks).toHaveBeenCalledTimes(2);
    expect(JSON.parse(readFileSync(file, 'utf8')).tracks.length).toBe(1);
    expect((await service.list()).totals.tracks).toBe(1);
    expect((await service.detail(playlistId)).tracks.length).toBe(1);
    expect(existsSync(audio)).toBe(false);
    expect(statSync(sibling).ino).toBe(inode);
    expect(readFileSync(sibling, 'utf8')).toBe('existing MP3 fixture');
    expect(trackService.remove).toHaveBeenCalledWith(12);
    for (const mutation of [trackService.create, trackService.retry, trackService.update, trackService.addCompletedTrack, playlistService.save]) {
      expect(mutation).not.toHaveBeenCalled();
    }
    expect(cdpProxy.tab).not.toHaveBeenCalled();
  });

  it('accepts a twice-confirmed empty playlist and does not repeatedly refresh its verified empty baseline', async () => {
    const file = writePlaylist();
    spotifyApiService.getAllPlaylistTracks.mockResolvedValue(verified([]));
    spotifyApiService.getLibraryPlaylists.mockResolvedValue([{ id: playlistId, uri: playlistUri, name: 'Fixture', trackCount: 0, snapshotId: 'snapshot-empty' }]);
    await (service as any).runLibrarySync();
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.tracks).toEqual([]);
    expect(saved.trackCount).toBe(0);
    expect(saved.snapshotId).toBe('snapshot-empty');
    expect(saved.membership.itemCount).toBe(0);
    expect((await service.detail(playlistId)).tracks).toEqual([]);
    expect(spotifyApiService.getAllPlaylistTracks).toHaveBeenCalledTimes(2);
    expect(service.librarySyncStatus().errors).toEqual([]);
    await (service as any).runLibrarySync();
    expect(spotifyApiService.getAllPlaylistTracks).toHaveBeenCalledTimes(2);
    expect(cdpProxy.tab).not.toHaveBeenCalled();
  });

  it('compares discovery counts to all API items, including excluded non-music rows', async () => {
    const file = writePlaylist();
    const rows = JSON.parse(readFileSync(file, 'utf8')).tracks;
    spotifyApiService.getAllPlaylistTracks.mockResolvedValue(verified(rows.slice(0, 1), 3));
    spotifyApiService.getLibraryPlaylists.mockResolvedValue([{ id: playlistId, uri: playlistUri, name: 'Fixture', trackCount: 3, snapshotId: 'with-episodes' }]);
    await (service as any).runLibrarySync();
    expect(spotifyApiService.getAllPlaylistTracks).toHaveBeenCalledTimes(2);
    await (service as any).runLibrarySync();
    expect(spotifyApiService.getAllPlaylistTracks).toHaveBeenCalledTimes(2);
    expect(JSON.parse(readFileSync(file, 'utf8')).membership.excludedItemCount).toBe(2);
  });

  it('retains the exact saved snapshot when removal confirmation changes, is truncated, or fails', async () => {
    const file = writePlaylist();
    const before = readFileSync(file, 'utf8');
    const rows = JSON.parse(before).tracks;
    const incomplete = verified(rows.slice(0, 1));
    incomplete.truncated = true;
    for (const confirmation of [verified(rows.slice(1)), incomplete, new Error('fixture network failure')]) {
      spotifyApiService.getAllPlaylistTracks.mockReset().mockResolvedValueOnce(verified(rows.slice(0, 1)));
      if (confirmation instanceof Error) spotifyApiService.getAllPlaylistTracks.mockRejectedValueOnce(confirmation);
      else spotifyApiService.getAllPlaylistTracks.mockResolvedValueOnce(confirmation);
      const result = await service.resync(playlistId).catch(error => error);
      expect(result).toBeInstanceOf(Error);
      expect(readFileSync(file, 'utf8')).toBe(before);
    }
    expect(cdpProxy.tab).not.toHaveBeenCalled();
    expect(trackService.update).not.toHaveBeenCalled();
  });

  it('rejects membership evidence attached to different same-sized track rows', async () => {
    const file = writePlaylist();
    const before = readFileSync(file, 'utf8');
    const rows = JSON.parse(before).tracks;
    const wrong = verified(rows);
    wrong.reverse();
    spotifyApiService.getAllPlaylistTracks.mockResolvedValue(wrong);
    const result = await service.resync(playlistId).catch(error => error);
    expect(result.message).toContain('evidence did not match');
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('runs confirmed removals through the real collector, hydration adapter and library writer', async () => {
    const file = writePlaylist();
    const session = new SpotifySessionService(cdpProxy as any);
    jest.spyOn(session, 'getAccessToken').mockResolvedValue('fixture-token');
    const request = jest.spyOn(session as any, 'sessionFetch').mockResolvedValue({
      ok: true, json: async () => ({
        length: 1, attributes: { name: 'Fixture' },
        contents: { items: [{ uri: 'spotify:track:1111111111111111111111' }], truncated: false, pos: 0 },
      }),
    });
    (service as any).spotifyApiService = new SpotifyApiService(session);
    const result = await service.resync(playlistId);
    expect(result.after).toBe(1);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.every(call => String(call[0]).includes('/playlist/v2/playlist/'))).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8')).membership.trackCount).toBe(1);
    expect((await service.detail(playlistId)).playlist.membershipVerified).toBe(true);
    expect(cdpProxy.tab).not.toHaveBeenCalled();
  });

  it('syncs same-count reordering through real discovery, collector and writer while preserving local playback', async () => {
    const file = writeVerifiedPlaylist();
    const folder = join(downloadsDir, 'Fixture');
    mkdirSync(folder);
    const audio = join(folder, 'Artist Two - Song Two.mp3');
    writeFileSync(audio, 'existing local audio fixture');
    const inode = statSync(audio).ino;
    const session = new SpotifySessionService(cdpProxy as any);
    jest.spyOn(session, 'getAccessToken').mockResolvedValue('fixture-token');
    const request = jest.spyOn(session as any, 'sessionFetch').mockImplementation(async (url: string) => {
      if (url.includes('/v1/me/playlists')) return {
        ok: true, json: async () => ({ items: [{ id: playlistId, uri: playlistUri,
          name: 'Fixture', snapshot_id: 'snapshot-new', tracks: { total: 2 } }], next: null, total: 1, offset: 0, limit: 50 }),
      };
      expect(url).toContain('/playlist/v2/playlist/');
      return { ok: true, json: async () => ({ length: 2, attributes: { name: 'Fixture' },
        contents: { pos: 0, truncated: false, items: [
          { uri: 'spotify:track:2222222222222222222222' },
          { uri: 'spotify:track:1111111111111111111111' },
        ] },
      }) };
    });
    (service as any).spotifyApiService = new SpotifyApiService(session);

    await (service as any).runLibrarySync();

    const detail = await service.detail(playlistId);
    expect(detail.tracks.map(track => [track.n, track.name])).toEqual([[1, 'Song Two'], [2, 'Song One']]);
    expect(detail.tracks[0].onDisk).toBe(true);
    expect((await service.resolveAudioPath(playlistId, 1)).path).toBe(audio);
    expect(statSync(audio).ino).toBe(inode);
    expect(readFileSync(audio, 'utf8')).toBe('existing local audio fixture');
    expect(JSON.parse(readFileSync(file, 'utf8')).snapshotId).toBe('snapshot-new');
    expect(detail.playlist.membershipVerified).toBe(true);
    expect(service.librarySyncStatus().errors).toEqual([]);
    const after = readFileSync(file, 'utf8');
    const afterInode = statSync(file).ino;
    await (service as any).runLibrarySync();
    expect(readFileSync(file, 'utf8')).toBe(after);
    expect(statSync(file).ino).toBe(afterInode);
    expect(request).toHaveBeenCalledTimes(3); // Discovery twice, membership once; known IDs need no hydration.
    for (const mutation of [trackService.create, trackService.retry, trackService.update, playlistService.save]) expect(mutation).not.toHaveBeenCalled();
    expect(cdpProxy.tab).not.toHaveBeenCalled();
  });

  it('keeps all saved metadata and reports incomplete when real library discovery loses its second page', async () => {
    const file = writeVerifiedPlaylist();
    const before = readFileSync(file, 'utf8');
    const inode = statSync(file).ino;
    const session = new SpotifySessionService(cdpProxy as any);
    jest.spyOn(session, 'getAccessToken').mockResolvedValue('fixture-token');
    const request = jest.spyOn(session as any, 'sessionFetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        items: [{ id: 'bbbbbbbbbbbbbbbbbbbbbb', name: 'New playlist' }], total: 2, offset: 0, limit: 50,
        next: 'https://api.spotify.com/v1/me/playlists?limit=50&offset=1',
      }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    (service as any).spotifyApiService = new SpotifyApiService(session);
    const accepted = service.startLibrarySync();
    await new Promise(resolve => setImmediate(resolve));
    const result = service.librarySyncStatus();
    expect(result.running).toBe(false);
    expect(result.operationId).toBe(accepted.operationId);
    expect(result.failureKind).toBe('incomplete');
    expect(result.errors[0]).toContain('library discovery incomplete');
    expect(result.discovered).toBe(0);
    expect(result.changed).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(statSync(file).ino).toBe(inode);
    expect(readdirSync(playlistsDir)).toEqual(['0001_fixture.json']);
    expect(request).toHaveBeenCalledTimes(2);
    const persisted = JSON.parse(readFileSync(join(root, 'data', 'spotify-library-sync.json'), 'utf8'));
    expect(persisted.failureKind).toBe('incomplete');
    expect(persisted.libraryObservation).toBeUndefined();
    expect((await service.view()).playlists[0]).not.toHaveProperty('libraryPresence');
    for (const mutation of [trackService.create, trackService.retry, trackService.update, playlistService.save]) expect(mutation).not.toHaveBeenCalled();
    expect(cdpProxy.tab).not.toHaveBeenCalled();
  });

  it('imports a newly followed playlist through real discovery and hydration without downloading audio', async () => {
    const file = writeVerifiedPlaylist();
    const before = readFileSync(file, 'utf8');
    const newId = 'bbbbbbbbbbbbbbbbbbbbbb';
    const session = new SpotifySessionService(cdpProxy as any);
    jest.spyOn(session, 'getAccessToken').mockResolvedValue('fixture-token');
    const request = jest.spyOn(session as any, 'sessionFetch').mockImplementation(async (url: string) => {
      if (url.includes('/v1/me/playlists')) return { ok: true, json: async () => ({
        items: [
          { id: playlistId, uri: playlistUri, name: 'Fixture', snapshot_id: 'snapshot-old', tracks: { total: 2 } },
          { id: newId, name: 'Newly followed', snapshot_id: 'new', items: { total: 1 }, owner: { id: 'curator', display_name: 'Curator' } },
        ], next: null, total: 2, offset: 0, limit: 50,
      }) };
      if (url.includes('/playlist/v2/playlist/')) {
        expect(url).toContain(newId);
        return { ok: true, json: async () => ({ length: 1, attributes: { name: 'Newly followed' },
          contents: { pos: 0, truncated: false, items: [{ uri: 'spotify:track:cccccccccccccccccccccc' }] },
        }) };
      }
      expect(url).toContain('/metadata/4/track/');
      return { ok: true, json: async () => ({ name: 'New song', artist: [{ name: 'New artist' }], duration: 180000 }) };
    });
    (service as any).spotifyApiService = new SpotifyApiService(session);
    service.startLibrarySync();
    await new Promise(resolve => setImmediate(resolve));
    const result = service.librarySyncStatus();
    expect(result.running).toBe(false);
    expect(result.done).toBe(2);
    expect(result.discovered).toBe(1);
    expect(result.changed).toBe(1);
    expect(result.errors).toEqual([]);
    const detail = await service.detail(newId);
    expect(detail.playlist.name).toBe('Newly followed');
    expect(detail.playlist.owner?.displayName).toBe('Curator');
    expect(detail.playlist.membershipVerified).toBe(true);
    expect(detail.tracks[0].name).toBe('New song');
    expect(detail.tracks[0].onDisk).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(request).toHaveBeenCalledTimes(3);
    expect(readdirSync(downloadsDir)).toEqual([]);
    for (const mutation of [trackService.create, trackService.retry, trackService.update, playlistService.save]) expect(mutation).not.toHaveBeenCalled();
    expect(cdpProxy.tab).not.toHaveBeenCalled();
  });

  it('rescans and resolves playback in the newly selected folder without copying or enqueueing', async () => {
    writePlaylist();
    const moved = join(root, 'moved');
    mkdirSync(join(moved, 'Fixture'), { recursive: true });
    const audio = join(moved, 'Fixture', 'Artist One - Song One.mp3');
    writeFileSync(audio, 'nonempty fixture');
    expect((await service.list()).playlists[0].onDisk).toBe(0);
    utils.setDownloadLocation(moved);
    expect((await service.list()).playlists[0].onDisk).toBe(1);
    expect((await service.detail(playlistId)).tracks[0].onDisk).toBe(true);
    expect((await service.resolveAudioPath(playlistId, 1)).path).toBe(audio);
    expect(trackService.create).not.toHaveBeenCalled();
    expect(trackService.retry).not.toHaveBeenCalled();
    expect(readFileSync(audio, 'utf8')).toBe('nonempty fixture');
  });

  it('returns cached owner attribution in both list and detail without changing the dump or calling Spotify', async () => {
    const file = writePlaylist({ subtitle: 'Playlist • Saved Curator' });
    const before = readFileSync(file, 'utf8');
    const list = await service.list();
    const detail = await service.detail(playlistId);
    expect(list.playlists[0].owner?.displayName).toBe('Saved Curator');
    expect(list.playlists[0].owner?.source).toBe('saved-subtitle');
    expect(detail.playlist.owner).toEqual(list.playlists[0].owner);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(spotifyApiService.getLibraryPlaylists).not.toHaveBeenCalled();
    expect(spotifyApiService.getAllPlaylistTracks).not.toHaveBeenCalled();
  });

  it('updates owner metadata without refetching unchanged tracks and preserves it when upstream omits the owner', async () => {
    const file = writeVerifiedPlaylist({ subtitle: 'Playlist • Previous Owner' });
    const owner = {
      id: 'curator',
      displayName: 'Current Owner',
      spotifyUrl: 'https://open.spotify.com/user/curator',
      source: 'spotify-api' as const,
    };
    const item = {
      id: playlistId,
      uri: playlistUri,
      name: 'Fixture',
      trackCount: 2,
      snapshotId: 'snapshot-old',
      owner,
    };
    spotifyApiService.getLibraryPlaylists.mockResolvedValue([item]);
    await (service as any).runLibrarySync();
    expect(JSON.parse(readFileSync(file, 'utf8')).owner).toEqual(owner);
    expect((await service.list()).playlists[0].owner).toEqual(owner);
    spotifyApiService.getLibraryPlaylists.mockResolvedValue([
      { ...item, owner: null },
    ]);
    await (service as any).runLibrarySync();
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.owner).toEqual(owner);
    expect(saved.subtitle).toBe('Playlist • Previous Owner');
    expect(saved.tracks.length).toBe(2);
    expect(spotifyApiService.getAllPlaylistTracks).not.toHaveBeenCalled();
  });

  it('does not mistake an omitted discovery count for an empty playlist', async () => {
    const file = writeVerifiedPlaylist();
    spotifyApiService.getLibraryPlaylists.mockResolvedValue([{ id: playlistId, uri: playlistUri, name: 'Fixture', snapshotId: 'snapshot-old' }]);
    await (service as any).runLibrarySync();
    expect(spotifyApiService.getAllPlaylistTracks).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(file, 'utf8')).tracks.length).toBe(2);
  });

  it('shares an in-flight playlist sync across callers without starting downloads', async () => {
    const file = writePlaylist();
    let finish!: (tracks: SpotifyTrackList) => void;
    spotifyApiService.getAllPlaylistTracks.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const first = service.resync(playlistId);
    const second = service.resync(playlistId);
    expect(spotifyApiService.getAllPlaylistTracks).toHaveBeenCalledTimes(1);
    finish(JSON.parse(readFileSync(file, 'utf8')).tracks);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(trackService.create).not.toHaveBeenCalled();
    expect(trackService.retry).not.toHaveBeenCalled();
    expect(playlistService.save).not.toHaveBeenCalled();
  });

  it('reports unavailable Chrome clearly without HTML fallback or saved-file changes', async () => {
    const file = writePlaylist();
    const before = readFileSync(file, 'utf8');
    spotifyApiService.getAllPlaylistTracks.mockRejectedValue(new Error('CDP proxy is down'));
    const result = await service.resync(playlistId).catch(error => error);
    expect(result.message).toContain('Chrome connection for Spotify is unavailable');
    expect(result.getStatus()).toBe(503);
    expect(cdpProxy.tab).not.toHaveBeenCalled();
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('restores persisted library progress as interrupted without starting Spotify work', () => {
    const state = { running: true, done: 2, total: 5, discovered: 1, changed: 1, errors: [], current: 'Test', startedAt: new Date().toISOString(), finishedAt: null };
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(join(root, 'data', 'spotify-library-sync.json'), JSON.stringify(state));
    const restored = new LibraryService((service as any).configService, playlistService as any, trackService as any, utils, spotifyApiService as any, cdpProxy as any);
    const progress = restored.librarySyncStatus();
    expect(progress.running).toBe(false);
    expect(progress.done).toBe(2);
    expect(progress.errors.join(' ')).toContain('interrupted');
    expect(spotifyApiService.getLibraryPlaylists).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(join(root, 'data', 'spotify-library-sync.json'), 'utf8')).running).toBe(false);
  });

  it('accepts only one library sync while the operation is running', async () => {
    let finish!: (items: any[]) => void;
    spotifyApiService.getLibraryPlaylists.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const accepted = service.startLibrarySync();
    expect(accepted.started).toBe(true);
    expect(accepted.scope).toBe('library');
    expect(accepted.operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(service.startLibrarySync()).toEqual({ started: false, already: true, operationId: accepted.operationId, scope: 'library' });
    await new Promise(resolve => setImmediate(resolve));
    expect(spotifyApiService.getLibraryPlaylists).toHaveBeenCalledTimes(1);
    finish([]);
    await new Promise(resolve => setImmediate(resolve));
    expect(service.librarySyncStatus().running).toBe(false);
  });

  it('acknowledges and persists focused sync before work, with one mutual-exclusion lane for all scopes', async () => {
    const file = writePlaylist();
    let finish!: (tracks: SpotifyTrackList) => void;
    spotifyApiService.getAllPlaylistTracks.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const first = service.startPlaylistSync(playlistId);
    expect(first.started).toBe(true);
    expect(spotifyApiService.getAllPlaylistTracks).not.toHaveBeenCalled();
    const persisted = JSON.parse(readFileSync(join(root, 'data', 'spotify-library-sync.json'), 'utf8'));
    expect(persisted.running).toBe(true);
    expect(persisted.scope).toBe('playlist');
    expect(persisted.playlistId).toBe(playlistId);
    expect(persisted.playlistName).toBe('Fixture');
    expect(persisted.operationId).toBe(first.operationId);
    for (const repeated of [service.startPlaylistSync(playlistId), service.startLibrarySync(), service.startResyncAll()]) {
      expect(repeated.started).toBe(false);
      expect(repeated.operationId).toBe(first.operationId);
      expect(repeated.scope).toBe('playlist');
    }
    await new Promise(resolve => setImmediate(resolve));
    const legacy = service.resyncAndWait(playlistId);
    finish(JSON.parse(readFileSync(file, 'utf8')).tracks);
    const result = await legacy;
    expect(result.after).toBe(2);
    const completed = JSON.parse(readFileSync(join(root, 'data', 'spotify-library-sync.json'), 'utf8'));
    expect(completed.running).toBe(false);
    expect(completed.result).toEqual(result);
    expect(completed.operationId).toBe(first.operationId);
    expect(spotifyApiService.getAllPlaylistTracks).toHaveBeenCalledTimes(1);
    expect(trackService.create).not.toHaveBeenCalled();
  });

  it('records a focused failure durably with a typed recovery reason', async () => {
    writePlaylist();
    spotifyApiService.getAllPlaylistTracks.mockRejectedValue(new Error('CDP proxy is down'));
    service.startPlaylistSync(playlistId);
    const failure = await service.resyncAndWait(playlistId).catch(error => error);
    expect(failure.getStatus()).toBe(503);
    const saved = JSON.parse(readFileSync(join(root, 'data', 'spotify-library-sync.json'), 'utf8'));
    expect(saved.running).toBe(false);
    expect(saved.result).toBeNull();
    expect(saved.failureKind).toBe('connection');
    expect(saved.finishedAt).toBeTruthy();
    expect(saved.playlistName).toBe('Fixture');
  });

  it('does not create a second sync through the blocking compatibility endpoint', async () => {
    writePlaylist();
    let finish!: (items: any[]) => void;
    spotifyApiService.getLibraryPlaylists.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    service.startLibrarySync();
    await new Promise(resolve => setImmediate(resolve));
    const failure = await service.resyncAndWait(playlistId).catch(error => error);
    expect(failure.getStatus()).toBe(409);
    expect(spotifyApiService.getAllPlaylistTracks).not.toHaveBeenCalled();
    finish([]);
    await new Promise(resolve => setImmediate(resolve));
  });

  it('uses durable shared status for saved-playlist bulk sync without a separate in-memory runner', async () => {
    const file = writePlaylist();
    spotifyApiService.getAllPlaylistTracks.mockResolvedValue(JSON.parse(readFileSync(file, 'utf8')).tracks);
    const result = service.startResyncAll();
    expect(result.scope).toBe('saved-playlists');
    await new Promise(resolve => setImmediate(resolve));
    expect(service.librarySyncStatus().running).toBe(false);
    expect(service.resyncAllStatus().done).toBe(1);
    expect(service.resyncAllStatus().updated).toBe(0);
    const saved = JSON.parse(readFileSync(join(root, 'data', 'spotify-library-sync.json'), 'utf8'));
    expect(saved.scope).toBe('saved-playlists');
    expect(saved.done).toBe(1);
    expect(saved.finishedAt).toBeTruthy();
  });

  it('does not begin a Spotify operation when its admission cannot be persisted', () => {
    writeFileSync(join(root, 'not-a-directory'), 'fixture');
    (service as any).syncStatusFile = join(root, 'not-a-directory', 'sync.json');
    let failure: any;
    try { service.startLibrarySync(); } catch (error) { failure = error; }
    expect(failure.getStatus()).toBe(503);
    expect(service.librarySyncStatus().running).toBe(false);
    expect(spotifyApiService.getLibraryPlaylists).not.toHaveBeenCalled();
  });

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
    const file = writeVerifiedPlaylist();
    spotifyApiService.getLibraryPlaylists.mockResolvedValue([
      {
        id: playlistId,
        uri: playlistUri,
        name: 'Fixture',
        trackCount: 2,
        snapshotId: 'snapshot-new',
      },
    ]);
    const replacement = JSON.parse(readFileSync(file, 'utf8')).tracks.reverse();
    spotifyApiService.getAllPlaylistTracks.mockResolvedValue(verified(replacement));
    const resync = jest.spyOn(service, 'resync');

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
    expect(JSON.parse(readFileSync(file, 'utf8')).tracks.map(track => track.id)).toEqual(replacement.map(track => track.id));
  });

  it('hydrates a legacy dump before establishing its first live snapshot baseline', async () => {
    const file = writePlaylist({ snapshotId: null });
    const original = JSON.parse(readFileSync(file, 'utf8'));
    spotifyApiService.getLibraryPlaylists.mockResolvedValue([
      {
        id: playlistId,
        uri: playlistUri,
        name: 'Fixture',
        trackCount: 2,
        snapshotId: 'snapshot-first-live',
      },
    ]);
    spotifyApiService.getAllPlaylistTracks.mockImplementation(async () => {
        expect(JSON.parse(readFileSync(file, 'utf8')).snapshotId).toBeNull();
        return verified(original.tracks);
      });
    const resync = jest.spyOn(service, 'resync');

    await (service as any).runLibrarySync();

    expect(resync).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(file, 'utf8')).snapshotId).toBe(
      'snapshot-first-live',
    );
    expect(service.librarySyncStatus().changed).toBe(1);
    expect(service.librarySyncStatus().errors).toEqual([]);
    await (service as any).runLibrarySync();
    expect(resync).toHaveBeenCalledTimes(1);
  });

  it('does not trust an existing snapshot ID attached to an unverified same-count dump', async () => {
    const file = writePlaylist();
    const original = JSON.parse(readFileSync(file, 'utf8'));
    const replacement = [...original.tracks];
    replacement[1] = { ...replacement[1], id: '3333333333333333333333', name: 'Replacement song' };
    spotifyApiService.getLibraryPlaylists.mockResolvedValue([{ id: playlistId, uri: playlistUri, name: 'Fixture', trackCount: 2, snapshotId: 'snapshot-old' }]);
    spotifyApiService.getAllPlaylistTracks.mockResolvedValue(verified(replacement));

    await (service as any).runLibrarySync();

    expect(spotifyApiService.getAllPlaylistTracks).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(file, 'utf8')).tracks[1].name).toBe('Replacement song');
    expect(JSON.parse(readFileSync(file, 'utf8')).membership).toBeDefined();
    await (service as any).runLibrarySync();
    expect(spotifyApiService.getAllPlaylistTracks).toHaveBeenCalledTimes(1);
  });

  it('checks unknown revisions even at the same count and does not keep an unrelated old snapshot ID', async () => {
    const file = writeVerifiedPlaylist();
    const replacement = JSON.parse(readFileSync(file, 'utf8')).tracks.reverse();
    const live = { id: playlistId, uri: playlistUri, name: 'Fixture', trackCount: 2 };
    spotifyApiService.getLibraryPlaylists.mockResolvedValue([live]);
    spotifyApiService.getAllPlaylistTracks.mockResolvedValue(verified(replacement));

    await (service as any).runLibrarySync();

    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.tracks.map(track => track.id)).toEqual(replacement.map(track => track.id));
    expect(saved.snapshotId).toBeNull();
    await (service as any).runLibrarySync();
    expect(spotifyApiService.getAllPlaylistTracks).toHaveBeenCalledTimes(2);
    spotifyApiService.getLibraryPlaylists.mockResolvedValue([{ ...live, snapshotId: 'snapshot-returned' }]);
    await (service as any).runLibrarySync();
    expect(spotifyApiService.getAllPlaylistTracks).toHaveBeenCalledTimes(3);
    await (service as any).runLibrarySync();
    expect(spotifyApiService.getAllPlaylistTracks).toHaveBeenCalledTimes(3);
  });

  it('leaves verified unchanged playlists byte-for-byte and inode-for-inode untouched', async () => {
    const file = writeVerifiedPlaylist();
    const before = readFileSync(file, 'utf8');
    const beforeStat = statSync(file);
    spotifyApiService.getLibraryPlaylists.mockResolvedValue([{ id: playlistId, uri: playlistUri, name: 'Fixture', trackCount: 2, snapshotId: 'snapshot-old', owner: null }]);
    await (service as any).runLibrarySync();
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(statSync(file).ino).toBe(beforeStat.ino);
    expect(statSync(file).mtimeMs).toBe(beforeStat.mtimeMs);
    expect(spotifyApiService.getAllPlaylistTracks).not.toHaveBeenCalled();
    expect(service.librarySyncStatus().changed).toBe(0);
  });

  it('does not certify a discovery snapshot using unverified fallback membership', async () => {
    const file = writePlaylist({ snapshotId: null });
    const tracks = JSON.parse(readFileSync(file, 'utf8')).tracks;
    spotifyApiService.getLibraryPlaylists.mockResolvedValue([{ id: playlistId, uri: playlistUri, name: 'Fixture', trackCount: 2, snapshotId: 'new-snapshot' }]);
    spotifyApiService.getAllPlaylistTracks.mockResolvedValue(tracks); // Legacy/fallback shape, no completeness evidence.
    await (service as any).runLibrarySync();
    expect(JSON.parse(readFileSync(file, 'utf8')).snapshotId).toBeNull();
    expect(service.librarySyncStatus().errors[0]).toContain('membership was not fully verified');
    expect(service.librarySyncStatus().changed).toBe(0);
  });

  it('preserves a verified saved list if a same-count unknown-revision check fails', async () => {
    const file = writeVerifiedPlaylist();
    const before = readFileSync(file, 'utf8');
    spotifyApiService.getLibraryPlaylists.mockResolvedValue([{ id: playlistId, uri: playlistUri, name: 'Fixture', trackCount: 2 }]);
    spotifyApiService.getAllPlaylistTracks.mockRejectedValue(new Error('CDP proxy is down'));
    await (service as any).runLibrarySync();
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(service.librarySyncStatus().changed).toBe(0);
    expect(service.librarySyncStatus().errors[0]).toContain('Chrome connection');
    expect(cdpProxy.tab).not.toHaveBeenCalled();
  });

  it('a focused sync invalidates the old discovery baseline before the next library check', async () => {
    const file = writeVerifiedPlaylist();
    const replacement = JSON.parse(readFileSync(file, 'utf8')).tracks.reverse();
    spotifyApiService.getAllPlaylistTracks.mockResolvedValue(verified(replacement));
    await service.resync(playlistId);
    expect(JSON.parse(readFileSync(file, 'utf8')).snapshotId).toBeNull();
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
    jest.spyOn(MediaDurationCache.prototype, 'duration').mockResolvedValue(180);
    writePlaylist({
      name: 'Target',
      trackCount: 1,
      tracks: [
        {
          n: 1,
          id: '1111111111111111111111',
          artist: 'Artist',
          name: 'Song',
          durationMs: 180000,
        },
      ],
    });
    const sourceDir = join(downloadsDir, 'Source');
    const destinationDir = join(downloadsDir, 'Target');
    const source = join(sourceDir, 'Artist - Song.mp3');
    const destination = join(destinationDir, sourceFileBase({ artist: 'Artist', name: 'Song', id: '1111111111111111111111' }) + '.mp3');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(source, 'audio bytes');

    const prior = {
      id: 7,
      spotifyUrl: 'spotify:track:1111111111111111111111',
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
      reused: 1,
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

  it('a destination appearing during verification is preserved and the real copied filename is persisted', async () => {
    const track = { n: 1, id: '1111111111111111111111', artist: 'Artist', name: 'Song', durationMs: 180000 };
    writePlaylist({ name: 'Target', trackCount: 1, tracks: [track] });
    const sourceDir = join(downloadsDir, 'Source'), folder = join(downloadsDir, 'Target');
    mkdirSync(sourceDir); mkdirSync(folder);
    const source = join(sourceDir, 'Artist - Song.mp3');
    const occupied = join(folder, sourceFileBase(track) + '.mp3');
    const copied = join(folder, sourceFileBase(track, 2) + '.mp3');
    writeFileSync(source, 'intended recording');
    jest.spyOn(MediaDurationCache.prototype, 'duration').mockImplementation(async path => readFileSync(path, 'utf8') === 'intended recording' ? 180 : 600);
    const prior: any = { ...track, id: 7, spotifyUrl: `spotify:track:${track.id}`, status: TrackStatusEnum.Completed, audioFilename: 'stale.mp3' };
    const playlist = { id: 3, name: 'Target', tracks: [prior] };
    playlistService.findBySpotifyUrl.mockResolvedValue(playlist);
    trackService.update.mockImplementation(async (_id, next) => Object.assign(prior, next));
    trackService.verifyLocalAudio.mockImplementation(async () => {
      writeFileSync(occupied, 'different recording');
      return 180000;
    });
    expect(await service.download([playlistUri])).toEqual({ queued: 0, skipped: 1, reused: 1 });
    expect(prior).toMatchObject({ status: TrackStatusEnum.Completed, audioFilename: sourceFileBase(track, 2) + '.mp3', error: null, acquisitionState: null, retryAt: null });
    expect(readFileSync(occupied, 'utf8')).toBe('different recording');
    expect(readFileSync(copied, 'utf8')).toBe('intended recording');
    expect(trackService.create).not.toHaveBeenCalled();
    expect(trackService.retry).not.toHaveBeenCalled();
    const detail = await service.detail(playlistId);
    expect(detail.tracks[0]).toMatchObject({ onDisk: true, filename: sourceFileBase(track, 2) + '.mp3', mediaVerification: 'duration-match' });
    expect(await service.resolveAudioPath(playlistId, 1)).toEqual({ path: copied, filename: sourceFileBase(track, 2) + '.mp3' });
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
      spotifyUrl: 'spotify:track:1111111111111111111111',
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

  it('normal download admits a genuinely unqueued New row and then skips its Waiting state', async () => {
    writePlaylist({
      tracks: [
        { artist: 'Artist', name: 'Pending', id: '1111111111111111111111' },
      ],
    });
    const prior = {
      id: 77,
      spotifyUrl: 'spotify:track:1111111111111111111111',
      artist: 'Artist',
      name: 'Pending',
      status: TrackStatusEnum.New,
    };
    playlistService.findBySpotifyUrl.mockResolvedValue({
      id: 1,
      name: 'Fixture',
      tracks: [prior],
    });
    trackService.retry.mockImplementation(async () => {
      prior.status = TrackStatusEnum.Queued;
      return true;
    });
    expect(await service.download([playlistUri])).toEqual({
      queued: 1,
      skipped: 0,
    });
    expect(await service.download([playlistUri])).toEqual({
      queued: 0,
      skipped: 1,
    });
    expect(trackService.retry).toHaveBeenCalledTimes(1);
  });

  it('reports held admission progress and refuses a second batch before any duplicate writes', async () => {
    writePlaylist();
    let finish: (value: any) => void;
    playlistService.findBySpotifyUrl.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const pending = service.download([playlistUri]);
    expect(webAdmission.snapshot()).toMatchObject({ running: true, total: 2, done: 0, playlist: 'Fixture' });
    await expect(service.download([playlistUri])).rejects.toThrow('still preparing');
    expect(playlistService.findBySpotifyUrl).toHaveBeenCalledTimes(1);
    finish!({ id: 4, name: 'Fixture', tracks: [] });
    await expect(pending).resolves.toEqual({ queued: 2, skipped: 0 });
    expect(webAdmission.snapshot().running).toBe(false);
    expect(trackService.create).toHaveBeenCalledTimes(2);
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
        spotifyUrl: 'spotify:track:1111111111111111111111',
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
        spotifyUrl: 'spotify:track:1111111111111111111111',
      },
    ]);

    const listed = await service.list();
    const detailed = await service.detail(playlistId);

    expect(listed.playlists[0].failed).toBe(0);
    expect(listed.playlists[0].done).toBe(false);
    expect(detailed.tracks[0].missing).not.toBe(true);
    expect(detailed.tracks[0].error).toMatch(/search retry 1\/3/i);
  });

  it('keeps two same-named Spotify versions distinct through coverage, copying and playback', async () => {
    const a = '1111111111111111111111', b = '2222222222222222222222';
    const tracks = [a, b].map((id, index) => ({ id, n: index + 1, artist: 'Artist', name: 'Track', durationMs: index ? 60000 : 30000 }));
    writePlaylist({ tracks, trackCount: 2 });
    mkdirSync(join(downloadsDir, 'Fixture'));
    mkdirSync(join(downloadsDir, 'Other'));
    const old = join(downloadsDir, 'Fixture', 'Artist - Track.mp3');
    const correct = join(downloadsDir, 'Other', 'Artist - Track.mp3');
    writeFileSync(old, '60'); writeFileSync(correct, '30');
    const inode = statSync(old).ino;
    jest.spyOn(MediaDurationCache.prototype, 'duration').mockImplementation(async path => Number(readFileSync(path, 'utf8')));
    trackService.verifyLocalAudio.mockResolvedValue(30000);
    playlistService.findBySpotifyUrl.mockResolvedValue({ id: 3, name: 'Fixture', tracks: [] });
    const detail = await service.detail(playlistId);
    expect(detail.playlist).toMatchObject({ onDisk: 1, available: 2, done: false });
    expect((await service.list()).playlists[0]).toMatchObject({ onDisk: 1, available: 2 });
    expect(detail.tracks[0]).toMatchObject({ onDisk: false, available: true, sourceKey: `spotify:${a}` });
    expect(detail.tracks[1]).toMatchObject({ onDisk: true, sourceKey: `spotify:${b}` });
    await expect(service.resolveAudioPath(playlistId, 1)).rejects.toThrow('No audio');
    expect((await service.resolveAudioPath(playlistId, 2)).path).toBe(old);
    expect(await service.download([playlistUri])).toMatchObject({ queued: 0, skipped: 2, reused: 1 });
    const copied = (await service.resolveAudioPath(playlistId, 1)).path;
    expect(copied).not.toBe(old);
    expect(readFileSync(copied, 'utf8')).toBe('30');
    expect(readFileSync(old, 'utf8')).toBe('60'); expect(statSync(old).ino).toBe(inode);
    expect(await service.download([playlistUri])).toEqual({ queued: 0, skipped: 2 });
    expect(trackService.create).not.toHaveBeenCalled(); expect(trackService.retry).not.toHaveBeenCalled();
    expect(spotifyApiService.getAllPlaylistTracks).not.toHaveBeenCalled(); expect(cdpProxy.tab).not.toHaveBeenCalled();
  });

  it('queues a separate destination for a known local mismatch instead of reporting saved or copying it', async () => {
    const track = { id: '1111111111111111111111', n: 1, artist: 'Artist', name: 'Track', durationMs: 30000 };
    writePlaylist({ tracks: [track], trackCount: 1 });
    mkdirSync(join(downloadsDir, 'Fixture'));
    const old = join(downloadsDir, 'Fixture', 'Artist - Track.mp3');
    writeFileSync(old, '60');
    jest.spyOn(MediaDurationCache.prototype, 'duration').mockResolvedValue(60);
    playlistService.findBySpotifyUrl.mockResolvedValue({ id: 3, name: 'Fixture', tracks: [] });
    const detail = await service.detail(playlistId);
    expect(detail.tracks[0]).toMatchObject({ onDisk: false, available: false, mediaVerification: 'mismatch' });
    expect(detail.playlist.done).toBe(false);
    expect(await service.download([playlistUri])).toEqual({ queued: 1, skipped: 0 });
    expect(trackService.create.mock.calls[0][0].audioFilename).toBe(sourceFileBase(track) + '.mp3');
    expect(readFileSync(old, 'utf8')).toBe('60');
    expect(trackService.addCompletedTrack).not.toHaveBeenCalled();
  });

  it('one version search failure cannot paint another same-named source as missing', async () => {
    const tracks = ['1111111111111111111111', '2222222222222222222222'].map((id, n) => ({ id, n, artist: 'Artist', name: 'Track' }));
    writePlaylist({ tracks });
    trackService.getAll.mockResolvedValue([{ artist: 'Artist', name: 'Track', spotifyUrl: `spotify:track:${tracks[0].id}`, status: TrackStatusEnum.Error, error: 'No YouTube result' }]);
    const detail = await service.detail(playlistId);
    expect(detail.tracks[0].missing).toBe(true);
    expect(detail.tracks[1].missing).not.toBe(true);
    expect(detail.tracks[1].error).toBeUndefined();
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
        spotifyUrl: 'spotify:track:1111111111111111111111',
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
