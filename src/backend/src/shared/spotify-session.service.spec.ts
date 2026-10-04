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

  it('does not fabricate an empty playlist when every API request fails', async () => {
    const service = new SpotifySessionService({} as any);
    jest.spyOn(service, 'getAccessToken').mockResolvedValue('fixture-token');
    jest.spyOn(service as any, 'sessionFetch').mockResolvedValue({ ok: false, status: 429 });
    const result = await service.getPlaylistTracks('aaaaaaaaaaaaaaaaaaaaaa').catch(error => error);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toContain('successful playlist response');
  });

  it('recognises a complete empty playlist without metadata hydration', async () => {
    const service = new SpotifySessionService({} as any);
    jest.spyOn(service, 'getAccessToken').mockResolvedValue('fixture-token');
    const request = jest.spyOn(service as any, 'sessionFetch').mockResolvedValue({
      ok: true, json: async () => ({ length: 0, contents: { items: [], truncated: false } }),
    });
    const result = await service.getPlaylistTracks('aaaaaaaaaaaaaaaaaaaaaa');
    expect(result.truncated).toBe(false);
    expect(result.membership?.itemCount).toBe(0);
    expect(result.membership?.trackCount).toBe(0);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not issue completeness evidence when track hydration is incomplete', async () => {
    const service = new SpotifySessionService({} as any);
    jest.spyOn(service, 'getAccessToken').mockResolvedValue('fixture-token');
    jest.spyOn(service as any, 'sessionFetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ length: 1, contents: { items: [{ uri: 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa' }], truncated: false } }) })
      .mockResolvedValue({ ok: false, status: 404 });
    const result = await service.getPlaylistTracks('bbbbbbbbbbbbbbbbbbbbbb');
    expect(result.truncated).toBe(true);
    expect(result.membership).toBeUndefined();
  });

  it('counts episodes/locals separately while retaining repeated song occurrences', async () => {
    const service = new SpotifySessionService({} as any);
    jest.spyOn(service, 'getAccessToken').mockResolvedValue('fixture-token');
    const id = 'aaaaaaaaaaaaaaaaaaaaaa';
    jest.spyOn(service as any, 'sessionFetch').mockResolvedValue({ ok: true, json: async () => ({
      length: 4, contents: { truncated: false, items: [
        { uri: `spotify:track:${id}` }, { uri: 'spotify:local:artist:album:song:123' },
        { uri: `spotify:track:${id}` }, { uri: 'spotify:episode:bbbbbbbbbbbbbbbbbbbbbb' },
      ] },
    }) });
    const result = await service.getPlaylistTracks('cccccccccccccccccccccc', new Map([[id, { name: 'Song', artist: 'Artist' }]]));
    expect(result.truncated).toBe(false);
    expect(result.tracks.map(track => track.id)).toEqual([id, id]);
    expect(result.membership?.itemCount).toBe(4);
    expect(result.membership?.excludedItemCount).toBe(2);
  });

  it('retains owner metadata on every library page without extra profile requests', async () => {
    const service = new SpotifySessionService({} as any);
    jest.spyOn(service, 'getAccessToken').mockResolvedValue('fixture-token');
    const request = jest
      .spyOn(service as any, 'sessionFetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'aaaaaaaaaaaaaaaaaaaaaa',
              name: 'First',
              owner: { id: 'curator', display_name: 'Curator' },
              tracks: { total: 2 },
            },
          ],
          total: 3, offset: 0, limit: 50,
          next: 'https://api.spotify.com/v1/me/playlists?offset=1&limit=50',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'bbbbbbbbbbbbbbbbbbbbbb',
              name: 'Second',
              owner: { id: 'anonymous', display_name: null },
            },
            { id: 'cccccccccccccccccccccc', name: 'Third' },
          ],
          total: 3, offset: 1, limit: 50, next: null,
        }),
      });
    const rows = await service.getLibraryPlaylists();
    expect(rows[0].owner?.displayName).toBe('Curator');
    expect(rows[1].owner?.id).toBe('anonymous');
    expect(rows[2].owner).toBeNull();
    expect(rows[2].trackCount).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
  });
});
