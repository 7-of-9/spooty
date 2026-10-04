import { completeSpotifyMembership, hasCompleteSpotifyMembership } from './spotify-membership';

describe('Spotify membership evidence', () => {
  const playlistId = 'aaaaaaaaaaaaaaaaaaaaaa';
  const one = { id: 'bbbbbbbbbbbbbbbbbbbbbb', name: 'One', artist: 'Artist' };
  const two = { id: 'cccccccccccccccccccccc', name: 'Two', artist: 'Artist' };
  it('binds complete metadata to the playlist, ordered IDs and repeated occurrences', () => {
    const tracks = [one, two, one];
    const proof = completeSpotifyMembership(playlistId, 5, tracks.map(track => track.id));
    expect(hasCompleteSpotifyMembership(proof, playlistId, tracks)).toBe(true);
    expect(hasCompleteSpotifyMembership(proof, 'another-playlist', tracks)).toBe(false);
    expect(hasCompleteSpotifyMembership(proof, playlistId, [one, one, two])).toBe(false);
    expect(hasCompleteSpotifyMembership(proof, playlistId, [one, two])).toBe(false);
  });
  it('rejects absent evidence, inconsistent counts, bad IDs and missing metadata', () => {
    const proof = completeSpotifyMembership(playlistId, 1, [one.id]);
    expect(hasCompleteSpotifyMembership(undefined, playlistId, [one])).toBe(false);
    expect(hasCompleteSpotifyMembership({ ...proof, excludedItemCount: -1 }, playlistId, [one])).toBe(false);
    expect(hasCompleteSpotifyMembership({ ...proof, itemCount: 2 }, playlistId, [one])).toBe(false);
    expect(hasCompleteSpotifyMembership(proof, playlistId, [{ ...one, artist: '' }])).toBe(false);
    expect(hasCompleteSpotifyMembership(completeSpotifyMembership(playlistId, 1, ['invalid']), playlistId, [{ ...one, id: 'invalid' }])).toBe(false);
  });
  it('represents verified empty and non-music-only playlists without inventing songs', () => {
    expect(hasCompleteSpotifyMembership(completeSpotifyMembership(playlistId, 0, []), playlistId, [])).toBe(true);
    expect(hasCompleteSpotifyMembership(completeSpotifyMembership(playlistId, 2, []), playlistId, [])).toBe(true);
  });
});
