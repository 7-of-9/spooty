import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as core from './acquisition/transport';
import * as childProcess from 'node:child_process';
import { copyFileSync } from 'fs';
import { webAdapterFixture, videoUrl } from './acquisition/web-adapter.fixture';
import { DURATION_REJECTED } from './acquisition/duration-policy';
const ID3 = require('node-id3');

describe('shared web download and atomic publication', () => {
  let f: ReturnType<typeof webAdapterFixture>;
  beforeEach(() => {
    f = webAdapterFixture();
    jest.spyOn(core, 'verifyMp3').mockResolvedValue(180);
    jest.spyOn(ID3, 'write').mockReturnValue(true);
  });
  afterEach(() => {
    f.close();
    jest.restoreAllMocks();
  });
  const track = (id: string, name = id) => ({
    artist: 'A',
    name,
    durationMs: 180000,
    spotifyUrl: null,
    youtubeUrl: videoUrl(id),
  });
  function output(args: string[], id: string, duration = 180) {
    const path = args[args.indexOf('-o') + 1]
      .replace('%(id)s', id)
      .replace('%(ext)s', 'mp3');
    writeFileSync(path, 'fixture-mp3');
    return (
      'SPOOTY_RESULT:' +
      JSON.stringify({
        id,
        filepath: path,
        title: 'public evidence',
        duration,
        artist: 'A',
      })
    );
  }
  it('uses shared extraction/filter, verifies then writes mandatory tags before publication', async () => {
    const final = join(f.root, 'track.mp3');
    (ID3.write as jest.Mock).mockImplementation((_tags, staged) => {
      expect(existsSync(final)).toBe(false);
      expect(staged).not.toBe(final);
      return true;
    });
    (f.transport.process as jest.Mock).mockImplementation(
      async (args, kind, _timeout, line) => {
        expect(kind).toBe('download');
        expect(args).toContain('--match-filter');
        expect(args).toContain('--no-simulate');
        line(output(args, 'abcdefghijk'));
        return { code: 0 };
      },
    );
    const song: any = track('abcdefghijk');
    await f.service.downloadAndFormat(song, final);
    expect(core.verifyMp3).toHaveBeenCalledTimes(1);
    expect(ID3.write).toHaveBeenCalledWith(
      { title: 'abcdefghijk', artist: 'A' },
      expect.any(String),
    );
    expect(readFileSync(final, 'utf8')).toBe('fixture-mp3');
    expect(song.sourceEvidence).toMatchObject({
      videoId: 'abcdefghijk',
      durationSeconds: 180,
    });
  });
  it('rejects wrong final duration before target publication', async () => {
    (core.verifyMp3 as jest.Mock).mockResolvedValue(900);
    (f.transport.process as jest.Mock).mockImplementation(
      async (args, _kind, _timeout, line) => {
        line(output(args, 'abcdefghijk'));
        return { code: 0 };
      },
    );
    const target = join(f.root, 'wrong.mp3');
    await expect(
      f.service.downloadAndFormat(track('abcdefghijk'), target),
    ).rejects.toThrow(DURATION_REJECTED);
    expect(existsSync(target)).toBe(false);
    expect(ID3.write).not.toHaveBeenCalled();
  });
  it('identifies a filtered member even when a sibling causes nonzero aggregate exit', async () => {
    (f.transport.process as jest.Mock).mockImplementation(
      async (_args, _kind, _timeout, line) => {
        line(
          'SPOOTY_CANDIDATE:' +
            JSON.stringify({ id: 'abcdefghijk', duration: 900 }),
        );
        return { code: 1, error: 'Local network unavailable' };
      },
    );
    const results = await Promise.allSettled([
      f.service.downloadAndFormat(track('abcdefghijk'), join(f.root, 'a.mp3')),
      f.service.downloadAndFormat(track('aqz-KE-bpKQ'), join(f.root, 'b.mp3')),
    ]);
    expect((results[0] as PromiseRejectedResult).reason.message).toBe(
      DURATION_REJECTED,
    );
    expect((results[1] as PromiseRejectedResult).reason.message).toBe(
      'Local network unavailable',
    );
  });
  it('does not publish if mandatory tags fail', async () => {
    (ID3.write as jest.Mock).mockReturnValue(false);
    (f.transport.process as jest.Mock).mockImplementation(
      async (args, _kind, _timeout, line) => {
        line(output(args, 'abcdefghijk'));
        return { code: 0 };
      },
    );
    const target = join(f.root, 'untagged.mp3');
    await expect(
      f.service.downloadAndFormat(track('abcdefghijk'), target),
    ).rejects.toThrow('MP3 tags');
    expect(existsSync(target)).toBe(false);
  });
  it('fast-skips existing media without a new subprocess or tag rewrite', async () => {
    const target = join(f.root, 'existing.mp3');
    writeFileSync(target, 'historical');
    await f.service.downloadAndFormat(track('abcdefghijk'), target);
    expect(f.transport.process).not.toHaveBeenCalled();
    expect(core.verifyMp3).not.toHaveBeenCalled();
    expect(readFileSync(target, 'utf8')).toBe('historical');
  });
  it('publishes a successful member while a sibling process result is still pending', async () => {
    let finish: (value: any) => void;
    (f.transport.process as jest.Mock).mockImplementation(
      (args, _kind, _timeout, line) => {
        line(output(args, 'abcdefghijk'));
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    );
    const first = f.service.downloadAndFormat(
      track('abcdefghijk'),
      join(f.root, 'first.mp3'),
    );
    const second = f.service
      .downloadAndFormat(track('aqz-KE-bpKQ'), join(f.root, 'second.mp3'))
      .catch((error) => error);
    try {
      await first;
      expect(existsSync(join(f.root, 'first.mp3'))).toBe(true);
      expect(existsSync(join(f.root, 'second.mp3'))).toBe(false);
    } finally {
      finish({ code: 1, error: 'YouTube operation timed out' });
    }
    expect((await second).message).toBe('YouTube operation timed out');
  });
  it('web path verifies and tags a real temporary MP3 through the shared engine, without YouTube', async () => {
    const actual = jest.requireActual('node:child_process');
    const generated = join(f.root, 'generated.mp3');
    // The only deliberately allowed real processes are local fixture ffmpeg
    // generation and scoped ffprobe. Every other subprocess remains denied.
    actual.execFileSync(
      '/opt/homebrew/bin/ffmpeg',
      [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'anullsrc=r=44100:cl=mono',
        '-t',
        '3',
        '-q:a',
        '0',
        generated,
      ],
      { stdio: 'ignore' },
    );
    (core.verifyMp3 as jest.Mock).mockRestore();
    (ID3.write as jest.Mock).mockRestore();
    jest.spyOn(childProcess, 'spawn').mockImplementation(((
      binary,
      args,
      options,
    ) => {
      if (
        binary !== '/opt/homebrew/bin/ffprobe' ||
        !String(args[args.length - 1]).startsWith(f.root + '/')
      )
        throw new Error('Non-fixture subprocess forbidden');
      return actual.spawn(binary, args, options);
    }) as any);
    (f.transport.process as jest.Mock).mockImplementation(
      async (args, _kind, _timeout, line) => {
        const path = args[args.indexOf('-o') + 1]
          .replace('%(id)s', 'abcdefghijk')
          .replace('%(ext)s', 'mp3');
        copyFileSync(generated, path);
        line(
          'SPOOTY_RESULT:' +
            JSON.stringify({
              id: 'abcdefghijk',
              filepath: path,
              duration: 3,
              title: 'Fixture',
            }),
        );
        return { code: 0 };
      },
    );
    const target = join(f.root, 'published.mp3');
    await f.service.downloadAndFormat(
      { ...track('abcdefghijk', 'Fixture'), durationMs: 3000 },
      target,
    );
    expect(await core.verifyMp3(target)).toBeGreaterThanOrEqual(3);
    expect(ID3.read(target)).toMatchObject({ artist: 'A', title: 'Fixture' });
  });
});
import { expect } from '@jest/globals';
