import { collectSpotifyLibrary } from './spotify-library-pages';
import { describe, it, expect } from '@jest/globals';

const first = { id: 'aaaaaaaaaaaaaaaaaaaaaa', name: 'First' };
const second = { id: 'bbbbbbbbbbbbbbbbbbbbbb', name: 'Second' };
const next = 'https://api.spotify.com/v1/me/playlists?limit=50&offset=1';
const page = (overrides = {}) => ({ items: [first], total: 1, offset: 0, limit: 50, next: null, ...overrides });

describe('complete Spotify library discovery', () => {
  it('accepts a positively empty library', async () => {
    expect(await collectSpotifyLibrary(jest.fn().mockResolvedValue(page({ items: [], total: 0 })))).toEqual([]);
  });

  it('collects all pages and preserves owner, revision and unknown-count metadata', async () => {
    const fetch = jest.fn()
      .mockResolvedValueOnce(page({ next, total: 2, items: [{ ...first, items: { total: 0 }, snapshot_id: 'revision', owner: { id: 'curator', display_name: 'Curator' } }] }))
      .mockResolvedValueOnce(page({ items: [second], total: 2, offset: 1 }));
    const result = await collectSpotifyLibrary(fetch);
    expect(result.map(item => item.id)).toEqual([first.id, second.id]);
    expect(result[0]).toMatchObject({ trackCount: 0, snapshotId: 'revision', owner: { displayName: 'Curator' } });
    expect(result[1].trackCount).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps an unnamed playlist visible instead of silently omitting it', async () => {
    const result = await collectSpotifyLibrary(jest.fn().mockResolvedValue(page({ items: [{ ...first, name: '' }] })));
    expect(result[0].name).toBe('Untitled playlist');
  });

  it.each([
    null, {}, page({ items: undefined }), page({ items: {} }), page({ total: undefined }),
    page({ total: -1 }), page({ total: '1' }), page({ total: 1.5 }), page({ offset: undefined }),
    page({ offset: 1 }), page({ limit: undefined }), page({ limit: 20 }), page({ next: undefined }),
    page({ next: '' }), page({ items: [null] }), page({ items: [{ id: first.id }] }),
    page({ items: [{ ...first, id: '../unsafe' }] }), page({ items: [{ ...first, uri: `spotify:playlist:${second.id}` }] }),
    page({ total: 2 }), page({ total: 0 }), page({ next }),
    page({ items: [], total: 1, next }),
  ])('rejects malformed or incomplete discovery without returning a partial library (%#)', async body => {
    const fetch = jest.fn().mockResolvedValue(body);
    await expect(collectSpotifyLibrary(fetch)).rejects.toThrow('Spotify library discovery incomplete');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    'https://example.test/v1/me/playlists?offset=1',
    'https://api.spotify.com/v1/me/tracks?offset=1',
    'https://user:pass@api.spotify.com/v1/me/playlists?offset=1',
    'https://api.spotify.com/v1/me/playlists?offset=0',
    'https://api.spotify.com/v1/me/playlists?offset=2',
    'https://api.spotify.com/v1/me/playlists?offset=1&offset=2',
    'https://api.spotify.com/v1/me/playlists?offset=1&limit=0',
    'not a URL',
  ])('rejects unsafe or noncontiguous next links before requesting them (%s)', async next => {
    const fetch = jest.fn().mockResolvedValue(page({ total: 2, next }));
    await expect(collectSpotifyLibrary(fetch)).rejects.toThrow('Spotify library discovery incomplete');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    page({ items: [second], total: 3, offset: 1 }),
    page({ items: [first], total: 2, offset: 1 }),
    page({ items: [], total: 2, offset: 1 }),
  ])('rejects changing totals, duplicates and prematurely terminated pages (%#)', async last => {
    const fetch = jest.fn().mockResolvedValueOnce(page({ total: 2, next })).mockResolvedValueOnce(last);
    await expect(collectSpotifyLibrary(fetch)).rejects.toThrow('Spotify library discovery incomplete');
  });

  it('propagates an upstream failure instead of returning the successful first page', async () => {
    const fetch = jest.fn().mockResolvedValueOnce(page({ total: 2, next })).mockRejectedValueOnce(new Error('Spotify library request failed: 429'));
    await expect(collectSpotifyLibrary(fetch)).rejects.toThrow('429');
  });
});
