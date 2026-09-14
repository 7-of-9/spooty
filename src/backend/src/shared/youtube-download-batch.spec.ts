import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  YOUTUBE_DOWNLOAD_ATTEMPTS,
  buildYoutubeDownloadBatchArgs,
  materializeYoutubeDownload,
  parseYoutubeDownloadBatchResults,
  parseYoutubeDownloadProgressLine,
  verifiedYoutubeBatchFile,
  youtubeDownloadBatchTimeoutMs,
  youtubeVideoId,
} from './youtube-download-batch';

describe('youtube download batch helpers', () => {
  it('extracts stable IDs from ordinary YouTube URL forms', () => {
    const cases = [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=x',
      'https://youtu.be/dQw4w9WgXcQ?t=2',
      'https://youtube.com/shorts/dQw4w9WgXcQ',
      'https://youtube.com/embed/dQw4w9WgXcQ',
      'https://youtube.com/live/dQw4w9WgXcQ',
    ];
    for (const url of cases) expect(youtubeVideoId(url)).toBe('dQw4w9WgXcQ');
  });

  it('rejects unsupported URLs', () => {
    const cases = [
      'not a url',
      'https://example.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?v=too-short',
      'https://youtube.com/playlist?list=dQw4w9WgXcQ',
    ];
    for (const url of cases) expect(youtubeVideoId(url)).toBeNull();
  });

  it('builds one no-cookie visionos invocation for all URLs', () => {
    const args = buildYoutubeDownloadBatchArgs({
      urls: ['https://youtu.be/dQw4w9WgXcQ', 'https://youtu.be/aqz-KE-bpKQ'],
      outputDirectory: '/tmp/batch',
      audioFormat: 'mp3',
      quality: '0',
      ffmpegPath: '/opt/homebrew/bin/ffmpeg',
      jsRuntime: 'node:/opt/node22/bin/node',
      cookiesPath: '/secret/cookies.txt',
      attempt: YOUTUBE_DOWNLOAD_ATTEMPTS[0],
    });

    expect(args).toContain('youtube:player_client=visionos');
    expect(args).toContain('/tmp/batch/%(id)s.%(ext)s');
    expect(args).toContain('--no-abort-on-error');
    expect(args).toContain('--no-playlist');
    expect(args).toContain('node:/opt/node22/bin/node');
    expect(args).not.toContain('--cookies');
    expect(args.join(' ')).not.toMatch(/player_client=web(?:\s|$)/);
    expect(args.slice(args.indexOf('--') + 1)).toEqual([
      'https://youtu.be/dQw4w9WgXcQ',
      'https://youtu.be/aqz-KE-bpKQ',
    ]);
  });

  it('adds cookies only for the sdkless fallback', () => {
    const args = buildYoutubeDownloadBatchArgs({
      urls: ['https://youtu.be/dQw4w9WgXcQ'],
      outputDirectory: '/tmp/batch',
      audioFormat: 'mp3',
      quality: '5',
      ffmpegPath: 'ffmpeg',
      jsRuntime: 'node',
      cookiesPath: '/secret/cookies.txt',
      attempt: YOUTUBE_DOWNLOAD_ATTEMPTS[1],
    });
    expect(
      args.slice(args.indexOf('--cookies'), args.indexOf('--cookies') + 2),
    ).toEqual(['--cookies', '/secret/cookies.txt']);
    expect(args).toContain('youtube:player_client=web_creator');
    expect(args).toContain('ba/bestaudio/best/18');
  });

  it('scopes the mweb POT provider to an explicit recovery invocation', () => {
    const args = buildYoutubeDownloadBatchArgs({
      urls: ['https://youtu.be/dQw4w9WgXcQ'],
      outputDirectory: '/tmp/batch',
      audioFormat: 'mp3',
      quality: '0',
      ffmpegPath: 'ffmpeg',
      jsRuntime: 'node:/opt/node22/bin/node',
      cookiesPath: '/secret/cookies.txt',
      attempt: {
        label: 'cookies+mweb+pot',
        useCookies: true,
        client: 'mweb',
        format: 'ba/bestaudio/best/18',
        potProvider: {
          pluginDir: '/repo/data/yt-dlp-plugins',
          baseUrl: 'http://127.0.0.1:4416',
        },
      },
    });

    for (const value of [
      '--no-plugin-dirs',
      '--plugin-dirs',
      '/repo/data/yt-dlp-plugins',
      'youtube:player_client=mweb;fetch_pot=always',
      'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416',
      '--cookies',
      '/secret/cookies.txt',
    ]) {
      expect(args).toContain(value);
    }
    expect(args.join(' ')).not.toMatch(/player_client=web(?:[;\s]|$)/);
    expect(args.join(' ')).not.toContain('formats=missing_pot');
  });

  it('parses tagged results and rejects malformed tagged lines', () => {
    const parsed = parseYoutubeDownloadBatchResults(
      [
        'ordinary yt-dlp output',
        'SPOOTY_RESULT:{"id":"dQw4w9WgXcQ","filepath":"/tmp/a.mp3"}',
        'SPOOTY_RESULT:not-json',
        'SPOOTY_RESULT:{"id":"short","filepath":"/tmp/b.mp3"}',
      ].join('\n'),
    );
    expect(parsed.results).toEqual([
      { id: 'dQw4w9WgXcQ', filepath: '/tmp/a.mp3' },
    ]);
    expect(parsed.malformedLines.length).toBe(2);
  });

  it('parses tagged progress by video ID', () => {
    expect(
      parseYoutubeDownloadProgressLine('SPOOTY_PROGRESS:dQw4w9WgXcQ: 37.5%'),
    ).toEqual({ id: 'dQw4w9WgXcQ', percentage: 37.5 });
    expect(
      parseYoutubeDownloadProgressLine(
        '[download] SPOOTY_PROGRESS:aqz-KE-bpKQ:101.2%',
      ),
    ).toEqual({ id: 'aqz-KE-bpKQ', percentage: 100 });
    expect(parseYoutubeDownloadProgressLine('[download] 22%')).toBeNull();
  });

  it('scales timeout per URL but remains below the Bull lock', () => {
    expect(youtubeDownloadBatchTimeoutMs(90_000, 3)).toBe(270_000);
    expect(youtubeDownloadBatchTimeoutMs(90_000, 99)).toBe(870_000);
  });

  it('copies independent files atomically for duplicate URL destinations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yt-download-helper-'));
    try {
      const source = join(dir, 'dQw4w9WgXcQ.mp3');
      const first = join(dir, 'one', 'Artist - Song.mp3');
      const second = join(dir, 'two', 'Alias - Song.mp3');
      writeFileSync(source, 'audio');
      materializeYoutubeDownload(source, first);
      materializeYoutubeDownload(source, second);
      expect(readFileSync(first, 'utf8')).toBe('audio');
      expect(readFileSync(second, 'utf8')).toBe('audio');
      expect(statSync(first).ino).not.toBe(statSync(second).ino);
      expect(existsSync(`${first}.part`)).toBe(false);
      writeFileSync(source, 'different');
      expect(() => materializeYoutubeDownload(source, first)).toThrow();
      expect(readFileSync(first, 'utf8')).toBe('audio');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prefers the exact ID file and never trusts a printed path outside temp', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yt-download-verify-'));
    const outside = join(tmpdir(), `outside-${process.pid}.mp3`);
    try {
      writeFileSync(outside, 'outside');
      expect(
        verifiedYoutubeBatchFile(dir, 'dQw4w9WgXcQ', 'mp3', outside),
      ).toBeNull();
      const exact = join(dir, 'dQw4w9WgXcQ.mp3');
      writeFileSync(exact, 'inside');
      expect(verifiedYoutubeBatchFile(dir, 'dQw4w9WgXcQ', 'mp3', outside)).toBe(
        exact,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { force: true });
    }
  });
});
