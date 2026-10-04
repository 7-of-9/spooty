import { SpotifyApiService } from './spotify-api.service';
import { completeSpotifyMembership } from './spotify-membership';

describe('Spotify playlist API adapter', () => {
  const id = 'aaaaaaaaaaaaaaaaaaaaaa';
  it('returns a verified empty list without anonymous embed fallback', async () => {
    const membership = completeSpotifyMembership(id, 0, []);
    const session = { getPlaylistTracks: jest.fn().mockResolvedValue({ tracks: [], truncated: false, membership }) };
    const service = new SpotifyApiService(session as any);
    const fallback = jest.spyOn(service as any, 'getEmbedToken');
    const result = await service.getAllPlaylistTracks(`https://open.spotify.com/playlist/${id}`);
    expect(result.length).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.membership).toEqual(membership);
    expect(fallback).not.toHaveBeenCalled();
  });
  it('retains incomplete evidence rather than treating empty as success', async () => {
    const session = { getPlaylistTracks: jest.fn().mockResolvedValue({ tracks: [], truncated: true }) };
    const result = await new SpotifyApiService(session as any).getAllPlaylistTracks(`https://open.spotify.com/playlist/${id}`);
    expect(result.truncated).toBe(true);
    expect(result.membership).toBeUndefined();
  });
  it('propagates session failure without another network/authentication path', async () => {
    const session = { getPlaylistTracks: jest.fn().mockRejectedValue(new Error('fixture outage')) };
    const service = new SpotifyApiService(session as any);
    const fallback = jest.spyOn(service as any, 'getEmbedToken');
    const result = await service.getAllPlaylistTracks(`https://open.spotify.com/playlist/${id}`).catch(error => error);
    expect(result.message).toBe('fixture outage');
    expect(fallback).not.toHaveBeenCalled();
  });
});
