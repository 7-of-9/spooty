import { resolveYoutubeUrlForTrack } from './track-url-reuse';

describe('resolveYoutubeUrlForTrack', () => {
  it('does not reuse another Spotify version URL just because its artist and title match', async () => {
    const track = { id: 2, artist: 'Artist', name: 'Track', spotifyUrl: 'spotify:track:1111111111111111111111' };
    const sibling = { id: 1, artist: 'Artist', name: 'Track', spotifyUrl: 'spotify:track:2222222222222222222222', youtubeUrl: 'https://youtu.be/old-version' };
    const search = jest.fn().mockResolvedValue('https://youtu.be/this-version');
    const result = await resolveYoutubeUrlForTrack(track, [sibling], search);
    expect(result).toEqual({ youtubeUrl: 'https://youtu.be/this-version', reused: false });
    expect(search).toHaveBeenCalledTimes(1);
  });
  it('reuses an existing youtubeUrl and does not call search', async () => {
    const track = { id: 2, artist: 'Jeff Beck', name: 'Shame' };
    const siblings = [
      {
        id: 1,
        artist: 'Jeff Beck',
        name: 'Shame',
        youtubeUrl: 'https://www.youtube.com/watch?v=4ZzPUbhEKP4',
      },
      track,
    ];
    const search = jest.fn(async () => {
      throw new Error('search should not be invoked');
    });
    const resolved = await resolveYoutubeUrlForTrack(track, siblings, search);
    expect(resolved.reused).toBe(true);
    expect(resolved.youtubeUrl).toBe(
      'https://www.youtube.com/watch?v=4ZzPUbhEKP4',
    );
    expect(search).not.toHaveBeenCalled();
  });

  it('calls search when no sibling has a url', async () => {
    const track = { id: 2, artist: 'Jeff Beck', name: 'Shame' };
    const search = jest.fn(
      async (_artist: string, _name: string) =>
        'https://www.youtube.com/watch?v=new',
    );
    const resolved = await resolveYoutubeUrlForTrack(
      track,
      [{ id: 2, artist: 'Jeff Beck', name: 'Shame' }],
      search,
    );
    expect(resolved.reused).toBe(false);
    expect(resolved.youtubeUrl).toBe('https://www.youtube.com/watch?v=new');
    expect(search).toHaveBeenCalledWith('Jeff Beck', 'Shame');
  });
});
