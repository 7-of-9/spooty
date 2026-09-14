import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { YoutubeService } from '../youtube.service';
import { YoutubePace } from '../youtube-pace';
import { AcquisitionOwner } from '../acquisition-owner';
import { DurationCandidates } from './duration-policy';
import { Transport } from './transport';

export function webAdapterFixture() {
  const root = mkdtempSync(join(tmpdir(), 'web-common-core-'));
  const state = join(root, 'acquire');
  const temporary = join(root, 'temp');
  mkdirSync(temporary);
  const service = new YoutubeService({
    get: (name) => (name === 'ACQUIRE_STATE_PATH' ? state : undefined),
  } as any);
  const pace = new YoutubePace({
    statePath: null,
    eventsPath: null,
    downloadConc: 4,
    searchConc: 1,
    maxPerWindow: 240,
    autoStep: false,
  });
  const transport = Object.assign(Object.create(Transport.prototype), {
    opts: { 'max-searches': 10 },
    paths: { root, temp: temporary, cookies: join(root, 'fixture-cookie.txt') },
    pace,
    runtime: 'fixture-runtime',
    emit: jest.fn(),
    children: new Map(),
    sleepers: new Set(),
    hooks: { beforeProcess: () => (service as any).owner.assertWebAllowed() },
    process: jest.fn(async () => {
      throw new Error('Unconfigured transport forbidden');
    }),
  }) as Transport;
  (service as any).pace = pace;
  (service as any).transport = transport;
  (service as any).candidates = new DurationCandidates(
    join(state, 'duration-rejections.json'),
  );
  jest
    .spyOn(AcquisitionOwner.prototype, 'assertWebAllowed')
    .mockResolvedValue();
  return {
    root,
    state,
    service,
    pace,
    transport,
    close: () => {
      service.onApplicationShutdown();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export const videoUrl = (id: string) => 'https://www.youtube.com/watch?v=' + id;
export const searchDocument = (query: string, entries: any[], limit = 10) =>
  JSON.stringify({ original_url: 'ytsearch' + limit + ':' + query, entries });
