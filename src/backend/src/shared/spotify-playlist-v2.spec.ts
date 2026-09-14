import {
  collectPlaylistV2TrackIds,
  mergePlaylistV2Pages,
  nextPlaylistOffset,
  PlaylistV2Page,
} from './spotify-playlist-v2';

function page(
  length: number,
  uris: string[],
  truncated: boolean,
  pos = 0,
): PlaylistV2Page {
  return {
    length,
    attributes: { name: 'Fixture PL' },
    contents: {
      pos,
      truncated,
      items: uris.map((uri) => ({ uri })),
    },
  };
}

describe('spotify-playlist-v2', () => {
  it('merges truncated playlist/v2 pages until ids match length', async () => {
    const first = page(
      5,
      [
        'spotify:track:aaaaaaaaaaaaaaaaaaaaaa',
        'spotify:track:bbbbbbbbbbbbbbbbbbbbbb',
      ],
      true,
      0,
    );
    const second = page(
      5,
      [
        'spotify:track:cccccccccccccccccccccc',
        'spotify:track:dddddddddddddddddddddd',
        'spotify:track:eeeeeeeeeeeeeeeeeeeeee',
      ],
      false,
      2,
    );

    expect(nextPlaylistOffset(first, 2, 5)).toBe(2);
    expect(nextPlaylistOffset(second, 5, 5)).toBeNull();

    const pages = [first, second];
    const merged = mergePlaylistV2Pages(pages);
    expect(merged.length).toBe(5);
    expect(merged.trackIds).toEqual([
      'aaaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbbb',
      'cccccccccccccccccccccc',
      'dddddddddddddddddddddd',
      'eeeeeeeeeeeeeeeeeeeeee',
    ]);
    expect(merged.trackIds.length).toBe(merged.length);

    const fetchedFrom: number[] = [];
    const result = await collectPlaylistV2TrackIds(async (from) => {
      fetchedFrom.push(from);
      return from === 0 ? first : second;
    });
    expect(fetchedFrom).toEqual([0, 2]);
    expect(result.trackIds.length).toBe(result.length);
    expect(result.length).toBe(5);
    expect(result.name).toBe('Fixture PL');
    expect(result.truncated).toBe(false);
  });

  it('stops when the first page already matches length', async () => {
    const only = page(
      2,
      [
        'spotify:track:aaaaaaaaaaaaaaaaaaaaaa',
        'spotify:track:bbbbbbbbbbbbbbbbbbbbbb',
      ],
      false,
    );
    const result = await collectPlaylistV2TrackIds(async () => only);
    expect(result.trackIds.length).toBe(2);
    expect(result.length).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('does not keep paging when length includes non-track rows and truncated is false', async () => {
    const only = page(
      5,
      [
        'spotify:track:aaaaaaaaaaaaaaaaaaaaaa',
        'spotify:track:bbbbbbbbbbbbbbbbbbbbbb',
      ],
      false,
    );
    const fetchedFrom: number[] = [];
    const result = await collectPlaylistV2TrackIds(async (from) => {
      fetchedFrom.push(from);
      return only;
    });
    expect(fetchedFrom).toEqual([0]);
    expect(result.trackIds.length).toBe(2);
    expect(result.length).toBe(5);
    expect(result.truncated).toBe(false);
  });

  it('preserves repeated tracks as separate playlist occurrences', async () => {
    const repeated = 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa';
    const only = page(2, [repeated, repeated], false);
    const result = await collectPlaylistV2TrackIds(async () => only);
    expect(result.trackIds).toEqual([
      'aaaaaaaaaaaaaaaaaaaaaa',
      'aaaaaaaaaaaaaaaaaaaaaa',
    ]);
    expect(result.truncated).toBe(false);
  });

  it('marks a non-advancing truncated response incomplete', async () => {
    const stuck = page(5, ['spotify:track:aaaaaaaaaaaaaaaaaaaaaa'], true);
    const result = await collectPlaylistV2TrackIds(async () => stuck);
    expect(result.trackIds.length).toBe(1);
    expect(result.truncated).toBe(true);
  });
});
