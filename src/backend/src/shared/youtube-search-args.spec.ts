import {
  YOUTUBE_SEARCH_ATTEMPTS,
  buildYoutubeSearchArgs,
} from './youtube-search-args';

describe('buildYoutubeSearchArgs', () => {
  it('custom anonymous attempt uses the supported visionos client', () => {
    const first = YOUTUBE_SEARCH_ATTEMPTS[0];
    expect(first.useCookies).toBe(false);
    expect(first.client).toBe('visionos');
    const args = buildYoutubeSearchArgs({
      query: 'Artist Title',
      cookiesPath: '/Users/dom/src/spooty/cookies.txt',
      useCookies: first.useCookies,
      client: first.client,
    });
    expect(args).not.toContain('--cookies');
    expect(args.join(' ')).not.toContain('cookies.txt');
    const extractor = args[args.indexOf('--extractor-args') + 1];
    expect(extractor).toContain('visionos');
    expect(args[0]).toBe('ytsearch1:Artist Title');
  });

  it('uses only web_creator for the cookies fallback too', () => {
    const fallback = YOUTUBE_SEARCH_ATTEMPTS[1];
    expect(fallback.useCookies).toBe(true);
    expect(fallback.client).toBe('web_creator');
  });
});
