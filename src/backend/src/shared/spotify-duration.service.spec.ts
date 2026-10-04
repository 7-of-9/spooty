import { expect } from '@jest/globals';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  SpotifyDurationService,
  spotifyTrackId,
} from './spotify-duration.service';

describe('durable authenticated Spotify duration cache', () => {
  let directory: string;
  const id = '1uzHGWTdxFBKAan5lUXMCe';
  const track = {
    spotifyUrl: `https://open.spotify.com/track/${id}`,
    name: 'Song',
    artist: 'Artist',
  };
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'spotify-duration-'));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  function fixture() {
    const session = {
      getTrackDurationMetadata: jest
        .fn()
        .mockResolvedValue({
          id,
          name: 'Song',
          artist: 'Artist',
          durationMs: 180000,
        }),
    };
    const service = new SpotifyDurationService(
      session as any,
      { get: () => directory } as any,
    );
    return { service, session };
  }
  it('lazily hydrates once, atomically writes only safe fields, and reuses matching cache', async () => {
    const { service, session } = fixture();
    expect(
      await Promise.all([service.ensure(track), service.ensure(track)]),
    ).toEqual([180000, 180000]);
    expect(session.getTrackDurationMetadata).toHaveBeenCalledTimes(1);
    const path = join(directory, `${id}.json`);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(directory)).toEqual([`${id}.json`]);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({
      version: 1,
      spotifyId: id,
      name: 'Song',
      artist: 'Artist',
      durationMs: 180000,
    });
    const next = fixture();
    expect(
      await next.service.ensure({
        ...track,
        name: ' SONG ',
        artist: 'Artist  ',
      }),
    ).toBe(180000);
    expect(next.session.getTrackDurationMetadata).not.toHaveBeenCalled();
  });
  it('rejects conflicting identities and missing source durations without an anonymous fallback', async () => {
    const { service, session } = fixture();
    session.getTrackDurationMetadata.mockResolvedValue({
      id,
      name: 'Another Song',
      artist: 'Artist',
      durationMs: 180000,
    });
    await expect(service.ensure(track)).rejects.toThrow(
      'Spotify source duration unavailable',
    );
    expect(readdirSync(directory)).toEqual([]);
    await expect(service.ensure({ ...track, spotifyUrl: '' })).rejects.toThrow(
      'Spotify source duration unavailable',
    );
    expect(session.getTrackDurationMetadata).toHaveBeenCalledTimes(1);
  });
  it('does not trust a cache for another ID, invalid duration, or conflicting identity', async () => {
    const { service, session } = fixture();
    writeFileSync(
      join(directory, `${id}.json`),
      JSON.stringify({
        version: 1,
        spotifyId: id,
        name: 'Wrong Song',
        artist: 'Artist',
        durationMs: 0,
      }),
    );
    expect(await service.ensure(track)).toBe(180000);
    expect(session.getTrackDurationMetadata).toHaveBeenCalledTimes(1);
  });
  it('preserves valid imported duration and accepts only exact Spotify track IDs', async () => {
    const { service, session } = fixture();
    expect(await service.ensure({ ...track, durationMs: 123456 })).toBe(123456);
    expect(session.getTrackDurationMetadata).not.toHaveBeenCalled();
    expect(spotifyTrackId(`spotify:track:${id}`)).toBe(id);
    expect(
      spotifyTrackId(`https://open.spotify.com/track/${id}/garbage`),
    ).toBeNull();
    expect(spotifyTrackId(`https://attacker.test/track/${id}`)).toBeNull();
  });
  it('provides album query context from a matching cache without another Spotify request', async () => {
    const { service, session } = fixture();
    writeFileSync(join(directory, `${id}.json`), JSON.stringify({ version: 1, spotifyId: id,
      name: track.name, artist: track.artist, durationMs: 180000, album: 'Earth, Vol. 6' }));
    const known: any = { ...track, durationMs: 180000 };
    expect(await service.ensure(known)).toBe(180000);
    expect(known.searchAlbum).toBe('Earth, Vol. 6');
    const otherEdition: any = { ...track, durationMs: 200000 };
    expect(await service.ensure(otherEdition)).toBe(200000);
    expect(otherEdition.searchAlbum).toBeUndefined();
    expect(session.getTrackDurationMetadata).not.toHaveBeenCalled();
  });
});
