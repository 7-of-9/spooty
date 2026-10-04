import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { expect } from '@jest/globals';
import { LibraryChangeWatch, LibraryWatchPaths } from './library-change-watch';

describe('passive library change watch', () => {
  let root: string, paths: LibraryWatchPaths, watcher: LibraryChangeWatch;
  let notify: jest.Mock;
  let observers: Array<{ root: string; callback: (event: string, file: string | null) => void; handle: EventEmitter & { close: jest.Mock } }>;
  beforeEach(() => {
    jest.useFakeTimers();
    root = fs.mkdtempSync(join(tmpdir(), 'spooty-change-watch-'));
    for (const name of ['media', 'playlists', 'data']) fs.mkdirSync(join(root, name));
    paths = { media: [join(root, 'media')], playlists: join(root, 'playlists'),
      metadata: join(root, 'data', 'metadata'), databases: [join(root, 'data', 'spooty.sqlite')], settings: join(root, 'data', 'settings.json') };
    observers = []; notify = jest.fn();
    jest.spyOn(fs, 'watch').mockImplementation(((path, _options, callback) => {
      const handle = Object.assign(new EventEmitter(), { close: jest.fn() });
      observers.push({ root: String(path), callback, handle }); return handle;
    }) as any);
    watcher = new LibraryChangeWatch(paths, notify);
  });
  afterEach(() => { watcher.close(); jest.restoreAllMocks(); jest.useRealTimers(); fs.rmSync(root, { recursive: true, force: true }); });
  function change(base: string, path: string | null) { observers.find(o => o.root === join(root, base))!.callback('rename', path); }

  it('coalesces repeated media and workflow events, ignores private staging and SQLite read-only sidecars', () => {
    change('media', 'Album.v2/Song.mp3'); change('media', 'Album.v2/Song.mp3');
    change('media', '.spooty-download-batch-123/partial.mp3'); change('media', '.acquire-123/partial.mp3');
    change('data', 'spooty.sqlite-wal'); change('data', 'spooty.sqlite-shm');
    jest.advanceTimersByTime(349); expect(notify).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(notify).toHaveBeenCalledWith({ media: [join(root, 'media', 'Album.v2/Song.mp3')], sources: [], workflow: true, membership: false, failed: false });
    notify.mockClear(); change('data', 'spooty.sqlite-shm'); jest.advanceTimersByTime(500);
    expect(notify).not.toHaveBeenCalled();
  });

  it('observes newly created metadata folders and routes an exact source change without a full scan', () => {
    expect(observers.map(o => o.root).sort()).toEqual(['data', 'media', 'playlists'].map(p => join(root, p)));
    change('data', 'metadata/1111111111111111111111.json'); jest.advanceTimersByTime(350);
    expect(notify).toHaveBeenCalledWith({ media: [], sources: ['spotify:1111111111111111111111'], workflow: false, membership: false, failed: false });
  });

  it('invalidates membership/settings and unknown directory changes without following escaped paths', () => {
    change('playlists', '../outside.json'); jest.advanceTimersByTime(350); expect(notify).not.toHaveBeenCalled();
    change('playlists', 'fixture.json'); change('data', 'settings.json'); jest.advanceTimersByTime(350);
    expect(notify.mock.calls[0][0].membership).toBe(true);
    notify.mockClear(); change('data', 'metadata'); jest.advanceTimersByTime(350);
    expect(notify.mock.calls[0][0].membership).toBe(true);
    notify.mockClear(); change('media', null); jest.advanceTimersByTime(350);
    expect(notify.mock.calls[0][0].media).toEqual(paths.media);
  });

  it('handles a media directory being created under a shared existing parent', () => {
    watcher.close(); observers = []; notify.mockClear();
    watcher = new LibraryChangeWatch({ ...paths, media: [join(root, 'new', 'media')], playlists: join(root, 'new', 'playlists') }, notify);
    expect(observers.map(o => o.root)).toEqual([root]);
    observers[0].callback('rename', 'new'); jest.advanceTimersByTime(350);
    expect(notify.mock.calls[0][0]).toMatchObject({ media: [join(root, 'new', 'media')], membership: true });
  });

  it('reports unavailable watching once and closes all handles/timers on disposal', () => {
    observers[0].handle.emit('error', new Error('fixture watch failure')); jest.advanceTimersByTime(350);
    expect(watcher.live).toBe(false); expect(notify.mock.calls[0][0].failed).toBe(true);
    notify.mockClear(); change('media', 'later.mp3'); watcher.close(); jest.advanceTimersByTime(500);
    change('media', 'after-close.mp3'); jest.advanceTimersByTime(500);
    expect(notify).not.toHaveBeenCalled(); expect(observers.every(o => o.handle.close.mock.calls.length === 1)).toBe(true);
  });

  it('does not silently keep watching an old inode after the entire media root moves', () => {
    fs.renameSync(join(root, 'media'), join(root, 'moved-media'));
    change('media', 'media'); jest.advanceTimersByTime(350);
    expect(watcher.live).toBe(false);
    expect(notify.mock.calls[0][0]).toMatchObject({ media: [join(root, 'media')], failed: true });
  });
});
