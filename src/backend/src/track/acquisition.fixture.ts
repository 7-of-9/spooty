import { mkdirSync } from 'fs';
import { join } from 'path';
import { webAdapterFixture } from '../shared/acquisition/web-adapter.fixture';
import { UtilsService } from '../shared/utils.service';
import { TrackService } from './track.service';
import { TrackEntity, TrackStatusEnum } from './track.entity';
import { WebWorkStore } from '../shared/acquisition/web-work-store';
import { sourceKey } from '../shared/acquisition/identity';

export function trackFixture() {
  const web = webAdapterFixture();
  const downloads = join(web.root, 'downloads');
  mkdirSync(downloads);
  const config = {
    get: (key) =>
      key === 'DOWNLOADS_PATH'
        ? downloads
        : key === 'FORMAT'
          ? 'mp3'
          : key === 'DB_PATH' ? join(web.root, 'data/spooty.sqlite') : undefined,
  };
  const utils = new UtilsService(config as any);
  const row: TrackEntity = {
    id: 1,
    artist: 'A',
    name: 'B',
    spotifyUrl: 'https://open.spotify.com/track/1uzHGWTdxFBKAan5lUXMCe',
    playlist: { id: 2, name: 'Fixture', isTrack: false } as any,
    status: TrackStatusEnum.New,
  };
  const repository = {
    findOne: jest.fn(async () => ({ ...row })),
    find: jest.fn(async (options) =>
      options?.where?.status === TrackStatusEnum.Completed ? [] : [{ ...row }],
    ),
    update: jest.fn(async (_id, update) => {
      Object.assign(row, update);
    }),
    save: jest.fn(async (value) => {
      Object.assign(row, value);
      return { ...row };
    }),
  };
  const queueRead = jest.fn().mockResolvedValue([]);
  const search = {
    add: jest.fn().mockResolvedValue({}),
    client: Promise.resolve({ eval: queueRead }),
  };
  const download = { add: jest.fn().mockResolvedValue({}) };
  const metadata = { ensure: jest.fn().mockResolvedValue(180000) };
  const service = new TrackService(
    repository as any,
    download as any,
    search as any,
    config as any,
    utils,
    web.service,
    metadata as any,
  );
  service.io = { emit: jest.fn() } as any;
  const journal = new WebWorkStore(join(web.state, 'work.sqlite'));
  const key = sourceKey(row);
  return {
    ...web,
    service,
    youtube: web.service,
    row,
    repository,
    search,
    queueRead,
    download,
    metadata,
    journal,
    key,
    downloads,
    destination: service.getFolderName(row, row.playlist),
  };
}
