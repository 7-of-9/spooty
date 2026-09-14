import {
  copyFileSync,
  existsSync,
  mkdirSync,
  linkSync,
  statSync,
  unlinkSync,
} from 'fs';
import { dirname, resolve, sep } from 'path';

export const YOUTUBE_DOWNLOAD_RESULT_PREFIX = 'SPOOTY_RESULT:';
export const YOUTUBE_DOWNLOAD_PROGRESS_PREFIX = 'SPOOTY_PROGRESS:';

export type YoutubeDownloadBatchResult = {
  id: string;
  filepath: string | null;
};

export type YoutubeDownloadProgress = {
  id: string;
  percentage: number;
};

export type YoutubeDownloadAttempt = {
  label: string;
  useCookies: boolean;
  client: 'visionos' | 'web_creator' | 'mweb';
  format: string;
  potProvider?: {
    pluginDir: string;
    baseUrl: string;
  };
};

export const YOUTUBE_DOWNLOAD_ATTEMPTS: YoutubeDownloadAttempt[] = [
  {
    label: 'visionos',
    useCookies: false,
    client: 'visionos',
    format: 'ba/bestaudio/best/18',
  },
  {
    label: 'cookies+web_creator',
    useCookies: true,
    client: 'web_creator',
    format: 'ba/bestaudio/best/18',
  },
];

/** Return the stable video ID for ordinary YouTube URL forms. */
export function youtubeVideoId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  let candidate: string | null = null;
  if (host === 'youtu.be') {
    candidate = parsed.pathname.split('/').filter(Boolean)[0] || null;
  } else if (
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com'
  ) {
    if (parsed.pathname === '/watch') candidate = parsed.searchParams.get('v');
    else {
      const match = parsed.pathname.match(
        /^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]+)/,
      );
      candidate = match?.[1] || null;
    }
  }
  return candidate && /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
}

export function buildYoutubeDownloadBatchArgs(opts: {
  urls: string[];
  outputDirectory: string;
  audioFormat: string;
  quality: string;
  ffmpegPath: string;
  jsRuntime: string;
  cookiesPath: string | null;
  attempt: YoutubeDownloadAttempt;
}): string[] {
  const args: string[] = [];
  if (opts.attempt.potProvider) {
    // Keep the recovery plugin scoped to this invocation. In particular, do
    // not install it beside the packaged binary or in a user-global directory.
    args.push(
      '--no-plugin-dirs',
      '--plugin-dirs',
      opts.attempt.potProvider.pluginDir,
    );
  }
  args.push(
    '--js-runtimes',
    opts.jsRuntime,
    '-o',
    resolve(opts.outputDirectory, '%(id)s.%(ext)s'),
    '--extract-audio',
    '--audio-format',
    opts.audioFormat,
    '-f',
    opts.attempt.format,
    '--extractor-args',
    `youtube:player_client=${opts.attempt.client}${opts.attempt.potProvider ? ';fetch_pot=always' : ''}`,
    '--progress',
    '--newline',
    '--progress-template',
    `download:${YOUTUBE_DOWNLOAD_PROGRESS_PREFIX}%(info.id)s:%(progress._percent_str)s`,
    '--print',
    `after_move:${YOUTUBE_DOWNLOAD_RESULT_PREFIX}%(.{id,filepath})j`,
    '--no-abort-on-error',
    '--no-playlist',
    // POT warnings distinguish a missing/unused GVS token from a genuine
    // format-selector miss. Ordinary high-volume work stays quiet.
    ...(opts.attempt.potProvider ? [] : ['--no-warnings']),
    '--socket-timeout',
    '20',
    '--ffmpeg-location',
    opts.ffmpegPath,
    '--audio-quality',
    opts.quality || '0',
  );
  if (opts.attempt.potProvider) {
    args.push(
      '--extractor-args',
      `youtubepot-bgutilhttp:base_url=${opts.attempt.potProvider.baseUrl}`,
    );
  }
  if (opts.attempt.useCookies && opts.cookiesPath) {
    args.push('--cookies', opts.cookiesPath);
  }
  args.push('--', ...opts.urls);
  return args;
}

export function youtubeDownloadBatchTimeoutMs(
  perUrlTimeoutMs: number,
  urlCount: number,
  lockDurationMs = 15 * 60_000,
): number {
  const perUrl = Math.max(30_000, Math.floor(perUrlTimeoutMs));
  const count = Math.max(1, Math.floor(urlCount));
  const lockSafeMaximum = Math.max(30_000, Math.floor(lockDurationMs) - 30_000);
  return Math.min(perUrl * count, lockSafeMaximum);
}

export function parseYoutubeDownloadBatchResults(stdout: string): {
  results: YoutubeDownloadBatchResult[];
  malformedLines: string[];
} {
  const results: YoutubeDownloadBatchResult[] = [];
  const malformedLines: string[] = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith(YOUTUBE_DOWNLOAD_RESULT_PREFIX)) continue;
    const encoded = line.slice(YOUTUBE_DOWNLOAD_RESULT_PREFIX.length);
    try {
      const value = JSON.parse(encoded) as Record<string, unknown>;
      const id = typeof value?.id === 'string' ? value.id : '';
      const filepath =
        typeof value?.filepath === 'string' ? value.filepath : null;
      if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error('invalid id');
      results.push({ id, filepath });
    } catch {
      malformedLines.push(line);
    }
  }
  return { results, malformedLines };
}

/** Parse complete tagged progress lines. Callers retain an incomplete tail. */
export function parseYoutubeDownloadProgressLine(
  line: string,
): YoutubeDownloadProgress | null {
  const index = line.indexOf(YOUTUBE_DOWNLOAD_PROGRESS_PREFIX);
  if (index < 0) return null;
  const tagged = line.slice(index + YOUTUBE_DOWNLOAD_PROGRESS_PREFIX.length);
  const match = tagged.match(/^([A-Za-z0-9_-]{11}):\s*(\d+(?:\.\d+)?)%/);
  if (!match) return null;
  return {
    id: match[1],
    percentage: Math.min(100, Number(match[2])),
  };
}

export function isNonEmptyBatchFile(path: string): boolean {
  try {
    return (
      existsSync(path) && statSync(path).isFile() && statSync(path).size > 0
    );
  } catch {
    return false;
  }
}

/**
 * Copy, rather than hard-link, so duplicate URLs can receive independent ID3
 * metadata later. Linking the completed private copy publishes atomically and
 * refuses EEXIST rather than overwriting a pre-existing original.
 */
export function materializeYoutubeDownload(
  source: string,
  destination: string,
): void {
  if (!isNonEmptyBatchFile(source)) {
    throw new Error(`yt-dlp did not create a non-empty MP3 for ${destination}`);
  }
  mkdirSync(dirname(destination), { recursive: true });
  const partial = `${destination}.spooty-part-${process.pid}-${Math.random()
    .toString(16)
    .slice(2)}`;
  try {
    copyFileSync(source, partial);
    if (!isNonEmptyBatchFile(partial)) {
      throw new Error(`Copied MP3 is empty for ${destination}`);
    }
    linkSync(partial, destination);
  } finally {
    if (existsSync(partial)) unlinkSync(partial);
  }
}

/** Accept a printed path only when it is the exact verified file in temp. */
export function verifiedYoutubeBatchFile(
  tempDirectory: string,
  id: string,
  audioFormat: string,
  printedPath?: string | null,
): string | null {
  const root = resolve(tempDirectory);
  const exact = resolve(root, `${id}.${audioFormat}`);
  if (isNonEmptyBatchFile(exact)) return exact;
  if (!printedPath) return null;
  const printed = resolve(printedPath);
  if (printed !== root && !printed.startsWith(root + sep)) return null;
  return isNonEmptyBatchFile(printed) ? printed : null;
}
