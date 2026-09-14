import {
  buildYoutubeSearchBatchArgs,
  parseYoutubeSearchBatch,
  youtubeSearchBatchTimeoutMs,
  youtubeSearchQuery,
} from './youtube-search-batch';

describe('YouTube search batch helpers', () => {
  it('builds a no-cookie visionos invocation for every query', () => {
    const args = buildYoutubeSearchBatchArgs({
      queries: ['Artist One', 'Artist Two'],
      cookiesPath: '/tmp/cookies.txt',
      useCookies: false,
      client: 'visionos',
    });

    expect(args).toContain('--dump-single-json');
    expect(args).toContain('--no-abort-on-error');
    expect(args).toContain('--flat-playlist');
    expect(args).not.toContain('--cookies');
    expect(args.slice(args.indexOf('--') + 1)).toEqual([
      'ytsearch1:Artist One',
      'ytsearch1:Artist Two',
    ]);
    expect(args[args.indexOf('--extractor-args') + 1]).toBe(
      'youtube:player_client=visionos',
    );
  });

  it('only adds cookies when explicitly requested', () => {
    const args = buildYoutubeSearchBatchArgs({
      queries: ['Artist One'],
      cookiesPath: '/tmp/cookies.txt',
      useCookies: true,
      client: 'web_creator',
    });

    expect(
      args.slice(args.indexOf('--cookies'), args.indexOf('--cookies') + 2),
    ).toEqual(['--cookies', '/tmp/cookies.txt']);
  });

  it('normalizes queries exactly like the existing single search', () => {
    expect(youtubeSearchQuery('A & B', 'The "Song"')).toBe('A   B The Song');
  });

  it('maps JSON documents by original query, independent of line order', () => {
    const stdout = [
      JSON.stringify({
        original_url: 'ytsearch1:Second Song',
        entries: [{ webpage_url: 'https://youtube.test/second' }],
      }),
      JSON.stringify({
        original_url: 'ytsearch1:First Song',
        entries: [{ url: 'https://youtube.test/first' }],
      }),
    ].join('\n');

    expect(parseYoutubeSearchBatch(stdout)).toEqual({
      documents: [
        { query: 'Second Song', url: 'https://youtube.test/second', candidates: [], emptyResults: false },
        { query: 'First Song', url: 'https://youtube.test/first', candidates: [], emptyResults: false },
      ],
      malformedLines: [],
    });
  });

  it('preserves empty results, duplicates, and malformed output', () => {
    const malformed = 'not-json';
    const stdout = [
      JSON.stringify({ id: 'Same Song', entries: [] }),
      malformed,
      JSON.stringify({
        original_url: 'ytsearch1:Same Song',
        entries: [{ original_url: 'https://youtube.test/same' }],
      }),
      JSON.stringify({ original_url: 'https://example.test', entries: [] }),
    ].join('\n');

    expect(parseYoutubeSearchBatch(stdout)).toEqual({
      documents: [
        { query: 'Same Song', url: null, candidates: [], emptyResults: true },
        { query: 'Same Song', url: 'https://youtube.test/same', candidates: [], emptyResults: false },
      ],
      malformedLines: [
        malformed,
        JSON.stringify({ original_url: 'https://example.test', entries: [] }),
      ],
    });
  });

  it('rejects non-http result URLs', () => {
    const parsed = parseYoutubeSearchBatch(
      JSON.stringify({
        original_url: 'ytsearch1:Unsafe',
        entries: [{ url: 'javascript:alert(1)' }],
      }),
    );

    expect(parsed.documents).toEqual([{ query: 'Unsafe', url: null, candidates: [], emptyResults: false }]);
  });

  it('requests five bounded candidates and preserves later IDs, durations and titles', () => {
    const args = buildYoutubeSearchBatchArgs({ queries: ['A B'], cookiesPath: null, useCookies: false, client: 'visionos', candidateLimit: 5 });
    expect(args.at(-1)).toBe('ytsearch5:A B');
    const parsed = parseYoutubeSearchBatch(JSON.stringify({ original_url: 'ytsearch5:A B', entries: [
      { id: 'dQw4w9WgXcQ', title: 'Album', duration: 4000 },
      { id: 'aqz-KE-bpKQ', title: 'Song', duration: 180.5 },
      { id: 'aqz-KE-bpKQ', title: 'Duplicate', duration: 180.5 },
      { id: 'abcdefghijk', title: 'Unknown', duration: null },
    ] }));
    expect(parsed.documents[0].candidates).toEqual([
      { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', videoId: 'dQw4w9WgXcQ', title: 'Album', durationSeconds: 4000 },
      { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', videoId: 'aqz-KE-bpKQ', title: 'Song', durationSeconds: 180.5 },
      { url: 'https://www.youtube.com/watch?v=abcdefghijk', videoId: 'abcdefghijk', title: 'Unknown', durationSeconds: null },
    ]);
    expect(() => buildYoutubeSearchBatchArgs({ queries: ['A'], cookiesPath: null, useCookies: false, client: 'visionos', candidateLimit: 51 })).toThrow();
  });

  it('scales timeout per query while staying below the Bull lock', () => {
    expect(youtubeSearchBatchTimeoutMs(90_000, 3)).toBe(270_000);
    expect(youtubeSearchBatchTimeoutMs(90_000, 20)).toBe(870_000);
    expect(youtubeSearchBatchTimeoutMs(1, 1)).toBe(30_000);
  });

  it('preserves ten requested results but keeps an explicit five-result limit', () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({ id: `candidate${String(i).padStart(2, '0')}`, duration: 180 }));
    for (const count of [5, 10]) {
      const args = buildYoutubeSearchBatchArgs({ queries: ['A Song'], cookiesPath: null, useCookies: false, client: 'visionos', candidateLimit: count });
      expect(args.at(-1)).toBe(`ytsearch${count}:A Song`);
      const parsed = parseYoutubeSearchBatch(JSON.stringify({ original_url: args.at(-1), entries }));
      expect(parsed.documents[0].candidates.length).toBe(count);
      expect(parsed.documents[0].candidates.at(-1)?.videoId).toBe(`candidate${String(count - 1).padStart(2, '0')}`);
    }
  });
});
