import { PlaylistService } from './playlist.service';

describe('PlaylistService', () => {
  function setup() {
    const repository = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (value) => value),
    };
    const service = new PlaylistService(
      repository as any,
      {} as any,
      {} as any,
      {} as any,
    );
    service.io = { emit: jest.fn() } as any;
    return { repository, service };
  }

  it('queries only subscribed playlist rows during the hourly check', async () => {
    const { repository, service } = setup();

    await service.checkActivePlaylists();

    expect(repository.find).toHaveBeenCalledWith({
      where: { active: true, isTrack: false },
      relations: {},
    });
  });

  it('sets a fresh creation time when saving a new playlist', async () => {
    const { repository, service } = setup();

    await service.save({ spotifyUrl: 'https://example.test/playlist' } as any);

    const saved = repository.save.mock.calls[0][0];
    expect(typeof saved.createdAt).toBe('number');
  });
});
