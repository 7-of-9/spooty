import {
  normalizePlaylistOwner,
  playlistAttribution,
} from './spotify-playlist-owner';
import { describe, expect, it } from '@jest/globals';

describe('Spotify playlist attribution', () => {
  it('retains only public owner fields and a safe profile URL', () => {
    expect(
      normalizePlaylistOwner({
        id: 'user123',
        display_name: ' Owner ',
        email: 'private@example.test',
        external_urls: {
          spotify: 'https://open.spotify.com/user/user123?si=tracking',
        },
      }),
    ).toEqual({
      id: 'user123',
      displayName: 'Owner',
      spotifyUrl: 'https://open.spotify.com/user/user123',
      source: 'spotify-api',
    });
  });

  it.each([
    'javascript:alert(1)',
    'https://example.test/user/123',
    'https://open.spotify.com/playlist/123',
    'https://user:pass@open.spotify.com/user/123',
    'invalid',
  ])('rejects an invalid owner link: %s', (spotifyUrl) => {
    expect(
      normalizePlaylistOwner({ displayName: 'Owner', spotifyUrl })?.spotifyUrl,
    ).toBeNull();
  });

  it('uses the ID when Spotify does not expose a display name', () => {
    expect(
      normalizePlaylistOwner({ id: 'user name', display_name: null }),
    ).toEqual({
      id: 'user name',
      displayName: null,
      spotifyUrl: 'https://open.spotify.com/user/user%20name',
      source: 'spotify-api',
    });
  });

  it('reads legacy attribution without inventing an owner ID or URL', () => {
    expect(
      playlistAttribution({ subtitle: 'Playlist • Some Curator' }),
    ).toEqual({
      owner: {
        id: null,
        displayName: 'Some Curator',
        spotifyUrl: null,
        source: 'saved-subtitle',
      },
      personalizedFor: null,
    });
  });

  it('does not mistake personalization for ownership', () => {
    expect(
      playlistAttribution({ subtitle: 'Playlist • Made for Listener' }),
    ).toEqual({ owner: null, personalizedFor: 'Listener' });
  });

  it('prefers structured ownership and keeps personalization separate', () => {
    const owner = normalizePlaylistOwner({
      id: 'spotify',
      display_name: 'Spotify',
    });
    expect(
      playlistAttribution({ owner, subtitle: 'Playlist • Made for Listener' }),
    ).toEqual({ owner, personalizedFor: 'Listener' });
    expect(
      playlistAttribution({ owner, subtitle: 'Playlist • Old Owner' }).owner,
    ).toEqual(owner);
  });

  it.each([
    {},
    { owner: null },
    { owner: {} },
    { subtitle: 'Album • Artist' },
    { subtitle: 42 },
  ])(
    'does not invent an owner from missing or unrelated metadata: %j',
    (raw) => {
      expect(playlistAttribution(raw)).toEqual({
        owner: null,
        personalizedFor: null,
      });
    },
  );
});
