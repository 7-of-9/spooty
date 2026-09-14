import { resolveYoutubeUrlForTrack } from './track-url-reuse';

describe('resolveYoutubeUrlForTrack', () => {
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
