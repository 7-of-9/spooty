import { youtubeVideoId } from './youtube-download-batch';

export type YoutubeSearchCandidate = { url: string; videoId: string; durationSeconds: number | null; title: string };

export type YoutubeSearchBatchDocument = {
  query: string;
  url: string | null;
  candidates: YoutubeSearchCandidate[];
  emptyResults: boolean;
};

export type YoutubeSearchBatchParseResult = {
  documents: YoutubeSearchBatchDocument[];
  malformedLines: string[];
};

const SEARCH_PREFIX = /^ytsearch\d+:/;

export function youtubeSearchQuery(artist: string, name: string): string {
  return `${artist} ${name}`.replace(/"/g, '').replace(/&/g, ' ');
}

export function buildYoutubeSearchBatchArgs(opts: {
  queries: string[];
  cookiesPath: string | null;
  useCookies: boolean;
  client: string;
  candidateLimit?: number;
}): string[] {
  const args = [
    '--flat-playlist',
    '--dump-single-json',
    '--no-abort-on-error',
    '--no-playlist',
    '--no-warnings',
    '--socket-timeout',
    '20',
    '--extractor-args',
    `youtube:player_client=${opts.client}`,
  ];
  if (opts.useCookies && opts.cookiesPath) {
    args.push('--cookies', opts.cookiesPath);
  }
  const limit = opts.candidateLimit === undefined ? 1 : opts.candidateLimit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('YouTube candidate limit must be 1–50');
  args.push('--', ...opts.queries.map((query) => `ytsearch${limit}:${query}`));
  return args;
}

export function youtubeSearchBatchTimeoutMs(
  perQueryTimeoutMs: number,
  batchSize: number,
  lockDurationMs = 15 * 60_000,
): number {
  const perQuery = Math.max(30_000, Math.floor(perQueryTimeoutMs));
  const size = Math.max(1, Math.floor(batchSize));
  const lockSafeMaximum = Math.max(30_000, Math.floor(lockDurationMs) - 30_000);
  return Math.min(perQuery * size, lockSafeMaximum);
}

function queryFromDocument(value: Record<string, unknown>): string | null {
  const originalUrl = value.original_url;
  if (
    typeof originalUrl === 'string' &&
    SEARCH_PREFIX.test(originalUrl)
  ) {
    return originalUrl.replace(SEARCH_PREFIX, '');
  }
  return typeof value.id === 'string' && value.id ? value.id : null;
}

function resultUrl(value: Record<string, unknown>): string | null {
  const entries = Array.isArray(value.entries) ? value.entries : [];
  const entry = entries.find(
    (candidate): candidate is Record<string, unknown> =>
      !!candidate && typeof candidate === 'object',
  );
  if (!entry) return null;
  for (const field of ['webpage_url', 'original_url', 'url']) {
    const candidate = entry[field];
    if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resultCandidates(value: Record<string, unknown>, limit: number): YoutubeSearchCandidate[] {
  const entries = Array.isArray(value.entries) ? value.entries : [];
  const candidates: YoutubeSearchCandidate[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    let url: string | null = null;
    for (const field of ['webpage_url', 'original_url', 'url']) {
      if (typeof entry[field] === 'string' && youtubeVideoId(entry[field])) { url = entry[field]; break; }
    }
    if (!url && typeof entry.id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(entry.id)) url = `https://www.youtube.com/watch?v=${entry.id}`;
    const videoId = url && youtubeVideoId(url);
    if (!url || !videoId || seen.has(videoId)) continue;
    seen.add(videoId);
    const duration = entry.duration;
    candidates.push({ url, videoId, durationSeconds: typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : null,
      title: typeof entry.title === 'string' ? entry.title.slice(0, 500) : '' });
    if (candidates.length >= limit) break;
  }
  return candidates;
}

/** Parse yt-dlp --dump-single-json output without relying on output order. */
export function parseYoutubeSearchBatch(
  stdout: string,
): YoutubeSearchBatchParseResult {
  const documents: YoutubeSearchBatchDocument[] = [];
  const malformedLines: string[] = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      malformedLines.push(line);
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      malformedLines.push(line);
      continue;
    }
    const record = value as Record<string, unknown>;
    const query = queryFromDocument(record);
    if (!query) {
      malformedLines.push(line);
      continue;
    }
    const requested = typeof record.original_url === 'string' ? Number(record.original_url.match(/^ytsearch(\d+):/)?.[1]) : 5;
    const candidateLimit = Number.isInteger(requested) && requested >= 1 && requested <= 50 ? requested : 5;
    documents.push({ query, url: resultUrl(record), candidates: resultCandidates(record, candidateLimit), emptyResults: Array.isArray(record.entries) && record.entries.length === 0 });
  }
  return { documents, malformedLines };
}
