import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { DownloadLocationController } from './download-location.controller';
import { UtilsService } from './utils.service';
import { webAdmission } from './web-admission-state';
import {
  downloadSettingsPath,
  resolveDownloadLocation,
  validateDownloadLocation,
} from './acquisition/download-location';

describe('persistent download location', () => {
  let root: string, original: string, moved: string, db: string;
  let utils: UtilsService, controller: DownloadLocationController;
  let owner: {
    withIdleWebQueues: jest.Mock<(apply: () => unknown) => Promise<unknown>>;
  };
  const request = () =>
    ({
      headers: {
        host: '127.0.0.1:3000',
        origin: 'http://127.0.0.1:4200',
        'content-type': 'application/json',
      },
      socket: { remoteAddress: '127.0.0.1' },
    }) as any;
  const config = () =>
    ({
      get: (key: string) =>
        key === 'DB_PATH'
          ? db
          : key === 'DOWNLOADS_PATH'
            ? original
            : undefined,
    }) as any;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'spooty-location-')));
    original = join(root, 'original');
    moved = join(root, 'moved library');
    db = join(root, 'data', 'spooty.sqlite');
    mkdirSync(original);
    mkdirSync(moved);
    utils = new UtilsService(config());
    owner = {
      withIdleWebQueues: jest.fn(async (apply: () => unknown) => apply()),
    };
    controller = new DownloadLocationController(utils, owner as any);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('persists across a new backend instance and shares resolution with CLI without touching media', async () => {
    writeFileSync(join(moved, 'saved.mp3'), 'untouched fixture bytes');
    const file = downloadSettingsPath(db);
    mkdirSync(join(root, 'data'));
    writeFileSync(file, JSON.stringify({ otherSetting: 'preserved' }));
    expect(controller.get()).toEqual({ path: original, source: 'environment' });
    const result = await controller.set({ path: moved }, request());
    expect(result).toEqual({ path: resolve(moved), source: 'saved' });
    expect(new UtilsService(config()).getRootDownloadsPath()).toBe(
      resolve(moved),
    );
    expect(resolveDownloadLocation(original, file)).toEqual(result);
    expect(utils.getPlaylistFolderPath('Playlist')).toBe(
      join(moved, 'Playlist'),
    );
    expect(JSON.parse(readFileSync(file, 'utf8')).otherSetting).toBe(
      'preserved',
    );
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(moved, 'saved.mp3'), 'utf8')).toBe(
      'untouched fixture bytes',
    );
    expect(readdirSync(original)).toEqual([]);
    expect(readdirSync(join(root, 'data'))).toEqual(['settings.json']);
  });

  it.each([
    'relative',
    '',
    '/',
    null,
    { path: 'nested' },
    '/path/with\nnewline',
  ])(
    'rejects an invalid folder without changing configuration: %j',
    async (path) => {
      await expect(controller.set({ path }, request())).rejects.toMatchObject({
        status: 400,
      });
      expect(controller.get().path).toBe(original);
      expect(owner.withIdleWebQueues).not.toHaveBeenCalled();
      expect(existsSync(downloadSettingsPath(db))).toBe(false);
    },
  );

  it('does not create a nonexistent directory or accept a file as a folder', async () => {
    const absent = join(root, 'absent');
    await expect(
      controller.set({ path: absent }, request()),
    ).rejects.toMatchObject({ status: 400 });
    expect(existsSync(absent)).toBe(false);
    const file = join(root, 'file');
    writeFileSync(file, 'not a directory');
    await expect(
      controller.set({ path: file }, request()),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('canonicalizes a symlink to an existing directory', () => {
    const link = join(root, 'link');
    symlinkSync(moved, link);
    expect(validateDownloadLocation(link)).toBe(moved);
  });

  it('leaves the path unchanged when running work blocks the maintenance lease', async () => {
    owner.withIdleWebQueues.mockRejectedValue(new Error('busy'));
    await expect(controller.set({ path: moved }, request())).rejects.toThrow(
      'busy',
    );
    expect(controller.get().path).toBe(original);
    expect(existsSync(downloadSettingsPath(db))).toBe(false);
  });

  it('keeps the folder fixed while HTTP-side preparation is still running with idle queues', async () => {
    let finish: () => void;
    const held = new Promise<void>(resolve => { finish = resolve; });
    const work = webAdmission.run(() => held);
    try {
      await expect(controller.set({ path: moved }, request())).rejects.toMatchObject({ status: 409 });
      expect(controller.get().path).toBe(original);
      expect(existsSync(downloadSettingsPath(db))).toBe(false);
    } finally { finish!(); await work; }
    await expect(controller.set({ path: moved }, request())).resolves.toMatchObject({ path: moved });
  });

  it.each(['origin', 'host', 'remote', 'form'])(
    'rejects %s filesystem-setting attacks before any mutation',
    async (kind) => {
      const req = request();
      if (kind === 'origin') req.headers.origin = 'https://evil.example';
      if (kind === 'host') req.headers.host = 'evil.example:3000';
      if (kind === 'remote') req.socket.remoteAddress = '192.0.2.1';
      if (kind === 'form')
        req.headers['content-type'] = 'application/x-www-form-urlencoded';
      await expect(controller.set({ path: moved }, req)).rejects.toMatchObject({
        status: 403,
      });
      expect(owner.withIdleWebQueues).not.toHaveBeenCalled();
    },
  );

  it('does not fall back to the old directory when persisted configuration is corrupt', () => {
    mkdirSync(join(root, 'data'));
    writeFileSync(downloadSettingsPath(db), '{broken');
    expect(() => new UtilsService(config())).toThrow(
      'Invalid download-location settings',
    );
    writeFileSync(downloadSettingsPath(db), '{"downloadsPath":"relative"}');
    expect(() =>
      resolveDownloadLocation(original, downloadSettingsPath(db)),
    ).toThrow('Invalid saved download location');
  });
});
