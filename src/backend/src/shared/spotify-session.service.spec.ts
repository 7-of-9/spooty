import { SpotifySessionService } from './spotify-session.service';

describe('SpotifySessionService HTTP timeouts', () => {
  const originalTimeout = process.env.SPOTIFY_HTTP_TIMEOUT_MS;

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    if (originalTimeout === undefined)
      delete process.env.SPOTIFY_HTTP_TIMEOUT_MS;
    else process.env.SPOTIFY_HTTP_TIMEOUT_MS = originalTimeout;
  });

  it('releases a gated request with a bounded error when Spotify is half-open', async () => {
    jest.useFakeTimers();
    process.env.SPOTIFY_HTTP_TIMEOUT_MS = '100';
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const service = new SpotifySessionService({} as any);

    const pending = (
      (service as any).sessionFetch(
        'https://spclient.wg.spotify.com/test',
        {},
      ) as Promise<Response>
    ).then(
      () => null,
      (error) => error as Error,
    );
    await jest.advanceTimersByTimeAsync(101);

    expect((await pending)?.message).toBe(
      'Spotify request timed out after 100ms',
    );
  });

  it('hydrates duration by exact ID using the authenticated metadata gate', async () => {
    const service = new SpotifySessionService({} as any);
    jest.spyOn(service, 'getAccessToken').mockResolvedValue('fixture-token');
    const request = jest.spyOn(service as any, 'sessionFetch').mockResolvedValue({ ok: true, json: async () => ({ name: 'Song', artist: [{ name: 'Artist' }], duration: 180123, album: { name: 'Album' } }) });
    const row = await service.getTrackDurationMetadata('1uzHGWTdxFBKAan5lUXMCe');
    expect(row.durationMs).toBe(180123);
    expect(request.mock.calls[0][0]).toMatch(/^https:\/\/spclient\.wg\.spotify\.com\/metadata\/4\/track\//);
  });
});
