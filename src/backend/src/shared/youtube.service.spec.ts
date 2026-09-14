import {
  webAdapterFixture,
  searchDocument,
  videoUrl,
} from './acquisition/web-adapter.fixture';
import { AcquisitionOwner } from './acquisition-owner';
import { DURATION_NO_CANDIDATE } from './acquisition/duration-policy';

describe('web search adapter uses shared CLI Transport', () => {
  let f: ReturnType<typeof webAdapterFixture>;
  beforeEach(() => {
    f = webAdapterFixture();
  });
  afterEach(() => {
    f.close();
    jest.restoreAllMocks();
  });
  const song = (name = 'B') => ({
    artist: 'A',
    name,
    spotifyUrl: null,
    durationMs: 180000,
  });
  it('batches eight logical songs into one process and defaults to ten candidates', async () => {
    (f.transport.process as jest.Mock).mockImplementation(
      async (args, kind, _timeout, line) => {
        expect(kind).toBe('search');
        const queries = args.filter((arg) => arg.startsWith('ytsearch10:'));
        expect(queries).toHaveLength(8);
        for (const query of queries)
          line(
            searchDocument(query.slice(11), [
              { id: 'abcdefghijk', duration: 180 },
            ]),
          );
        return { code: 0, error: null };
      },
    );
    const started = jest.fn();
    const tracks = Array.from({ length: 8 }, (_, i) => song('song' + i));
    const results = await Promise.all(
      tracks.map((track) => f.service.findTrackOnYoutube(track, started)),
    );
    expect(results).toEqual(Array(8).fill(videoUrl('abcdefghijk')));
    expect(f.transport.process).toHaveBeenCalledTimes(1);
    expect(started).toHaveBeenCalledTimes(8);
    expect(tracks[0]).toMatchObject({
      searchLimit: 10,
      youtubeCandidates: [{ durationSeconds: 180 }],
    });
  });
  it('selects the first suitable duration rather than the first search result', async () => {
    (f.transport.process as jest.Mock).mockImplementation(
      async (_args, _kind, _timeout, line) => {
        line(
          searchDocument('A B', [
            { id: 'abcdefghijk', duration: 900 },
            { id: 'aqz-KE-bpKQ', duration: 181 },
          ]),
        );
        return { code: 0 };
      },
    );
    expect(await f.service.findTrackOnYoutube(song())).toBe(
      videoUrl('aqz-KE-bpKQ'),
    );
  });
  it('persists candidate depth and treats nonempty unsuitable results as exhausted selection', async () => {
    (f.transport.process as jest.Mock).mockImplementation(
      async (_args, _kind, _timeout, line) => {
        line(searchDocument('A B', [{ id: 'abcdefghijk' }], 25));
        return { code: 0 };
      },
    );
    const track: any = { ...song(), maxSearches: 25 };
    await expect(f.service.findTrackOnYoutube(track)).rejects.toThrow(
      DURATION_NO_CANDIDATE,
    );
    expect(track.searchLimit).toBe(25);
    expect(track.youtubeCandidates).toHaveLength(1);
    expect((f.transport.process as jest.Mock).mock.calls[0][0]).toContain(
      'ytsearch25:A B',
    );
  });
  it('only explicit zero results are Missing', async () => {
    (f.transport.process as jest.Mock).mockImplementation(
      async (_args, _kind, _timeout, line) => {
        line(searchDocument('A B', []));
        return { code: 0 };
      },
    );
    await expect(f.service.findTrackOnYoutube(song())).rejects.toThrow(
      'No YouTube result',
    );
  });
  it('fails closed for unknown Spotify duration without any process', async () => {
    await expect(
      f.service.findTrackOnYoutube({ ...song(), durationMs: null }),
    ).rejects.toThrow('Spotify source duration');
    expect(f.transport.process).not.toHaveBeenCalled();
  });
  it('rejects owner changes before a batch is admitted', async () => {
    jest
      .spyOn(AcquisitionOwner.prototype, 'assertWebAllowed')
      .mockResolvedValueOnce()
      .mockRejectedValue(new Error('CLI owns acquisition'));
    await expect(f.service.findTrackOnYoutube(song())).rejects.toThrow(
      'CLI owns',
    );
    expect(f.transport.process).not.toHaveBeenCalled();
  });
  it('rejects depth outside1–50 without admission', async () => {
    await expect(
      f.service.findTrackOnYoutube({ ...song(), maxSearches: 51 } as any),
    ).rejects.toThrow('1–50');
    expect(f.transport.process).not.toHaveBeenCalled();
  });
});
import { expect } from '@jest/globals';
