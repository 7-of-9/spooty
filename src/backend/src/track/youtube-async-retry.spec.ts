import {
  isPermanentYoutubeMissing,
  isRetryableYoutubeFailure,
  youtubeRetryAttempt,
  youtubeRetryCookiesFirst,
  youtubeRetryDelayMs,
  youtubeRetryJobName,
  youtubeRetryNeedsCookiesFirst,
} from './youtube-async-retry';

describe('YouTube asynchronous retry helpers', () => {
  it('round-trips retry attempts through Bull job names', () => {
    expect(youtubeRetryAttempt('')).toBe(0);
    expect(youtubeRetryAttempt(youtubeRetryJobName(2))).toBe(2);
    expect(youtubeRetryAttempt(youtubeRetryJobName(3, true))).toBe(3);
    expect(youtubeRetryCookiesFirst(youtubeRetryJobName(3, true))).toBe(true);
    expect(youtubeRetryCookiesFirst(youtubeRetryJobName(3))).toBe(false);
    expect(youtubeRetryAttempt('unrelated')).toBe(0);
  });

  it('switches bot retries to cookies-first without misclassifying age gates', () => {
    expect(
      youtubeRetryNeedsCookiesFirst(
        false,
        'Sign in to confirm you are not a bot',
      ),
    ).toBe(true);
    expect(
      youtubeRetryNeedsCookiesFirst(false, 'Sign in to confirm your age'),
    ).toBe(false);
    expect(youtubeRetryNeedsCookiesFirst(true, 'socket timed out')).toBe(true);
  });

  it('uses exponential delays without occupying a Bull worker', () => {
    expect(youtubeRetryDelayMs(0)).toBe(15 * 60_000);
    expect(youtubeRetryDelayMs(0, 60_000)).toBe(60_000);
    expect(youtubeRetryDelayMs(1, 60_000)).toBe(120_000);
    expect(youtubeRetryDelayMs(2, 60_000)).toBe(240_000);
  });

  it('retries bot checks, timeouts, and local routing failures but not misses', () => {
    expect(
      isRetryableYoutubeFailure('Sign in to confirm you are not a bot'),
    ).toBe(true);
    expect(isRetryableYoutubeFailure('yt-dlp timed out after 90000ms')).toBe(
      true,
    );
    expect(isRetryableYoutubeFailure('YouTube search failed (1)')).toBe(true);
    expect(isRetryableYoutubeFailure('No route to host [Errno 65]')).toBe(true);
    expect(isRetryableYoutubeFailure('Application shutting down')).toBe(true);
    expect(
      isRetryableYoutubeFailure(
        'Temporary YouTube failure: downloader produced no file',
      ),
    ).toBe(true);
    expect(
      isRetryableYoutubeFailure(
        '[download] Got error: 235 bytes read, 2803403 more expected. Giving up after 10 retries',
      ),
    ).toBe(true);
    expect(isRetryableYoutubeFailure('No YouTube result')).toBe(false);
  });

  it('only treats a genuine no-result search as a permanent missing track', () => {
    expect(isPermanentYoutubeMissing('No YouTube result')).toBe(true);
    expect(
      isPermanentYoutubeMissing(
        'Temporary YouTube failure: download produced no non-empty output file',
      ),
    ).toBe(false);
  });
});
