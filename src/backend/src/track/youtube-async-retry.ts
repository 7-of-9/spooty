import { isYoutubeRateLimit } from '../shared/youtube-pace';

export const MAX_YOUTUBE_ASYNC_RETRIES = 3;

export function youtubeRetryAttempt(jobName: string | undefined): number {
  const match = String(jobName || '').match(
    /^youtube-retry-(\d+)(?:-cookies-first)?$/,
  );
  return match ? Math.max(0, Number(match[1]) || 0) : 0;
}

export function youtubeRetryJobName(
  attempt: number,
  cookiesFirst = false,
): string {
  return `youtube-retry-${Math.max(0, Math.floor(attempt))}${cookiesFirst ? '-cookies-first' : ''}`;
}

export function youtubeRetryCookiesFirst(jobName: string | undefined): boolean {
  return /^youtube-retry-\d+-cookies-first$/.test(String(jobName || ''));
}

export function youtubeRetryNeedsCookiesFirst(
  alreadyCookiesFirst: boolean,
  error: string,
): boolean {
  return alreadyCookiesFirst || isYoutubeRateLimit(error);
}

export function youtubeRetryDelayMs(
  attempt: number,
  baseMs = 15 * 60_000,
): number {
  const base =
    Number.isFinite(baseMs) && baseMs >= 60_000 ? baseMs : 15 * 60_000;
  return base * 2 ** Math.max(0, Math.floor(attempt));
}

export function isRetryableYoutubeFailure(error: string): boolean {
  return (
    isYoutubeRateLimit(error) ||
    /application shutting down|yt-dlp timed out|youtube search failed \(\d+\)|socket timed out|connection (?:reset|refused)|network is unreachable|no route to host|temporary (?:youtube )?failure|got error: .*bytes read|giving up after \d+ retries|fetch failed/i.test(
      error,
    )
  );
}

export function isPermanentYoutubeMissing(
  error: string | null | undefined,
): boolean {
  return /^no youtube result\s*$/i.test(String(error || '').trim());
}
