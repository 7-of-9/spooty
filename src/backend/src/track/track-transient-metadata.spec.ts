import { trackFixture } from './acquisition.fixture';
import { describe, it, expect } from '@jest/globals';

describe('search metadata persistence boundary', () => {
  it('keeps album search context in flight but never sends it to TypeORM', async () => {
    const f = trackFixture();
    try {
      const track = { ...f.row, searchAlbum: 'Earth Vol. 7' };
      await f.service.update(track.id, track);
      expect(f.repository.update).toHaveBeenCalledWith(track.id, expect.not.objectContaining({ searchAlbum: expect.anything() }));
      expect(track.searchAlbum).toBe('Earth Vol. 7');
      expect(f.service.io.emit).toHaveBeenCalledWith(expect.anything(), track);
    } finally { f.close(); }
  });
});
