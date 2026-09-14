import { join } from 'path';
import {
  webAdapterFixture,
  videoUrl,
  searchDocument,
} from './acquisition/web-adapter.fixture';
import {
  DurationCandidates,
  DURATION_NO_CANDIDATE,
} from './acquisition/duration-policy';
import { candidateResultsFromLine } from './acquisition/source';

describe('durable shared candidate selection across CLI/web handback', () => {
  let f: ReturnType<typeof webAdapterFixture>;
  beforeEach(() => {
    f = webAdapterFixture();
  });
  afterEach(() => {
    f.close();
    jest.restoreAllMocks();
  });
  it('a long-lived web adapter reloads exclusions written by another owner', () => {
    const track: any = {
      artist: 'A',
      name: 'B',
      durationMs: 180000,
      youtubeUrl: videoUrl('abcdefghijk'),
    };
    expect(f.service.isRejectedCandidate(track, track.youtubeUrl)).toBe(false);
    new DurationCandidates(join(f.state, 'duration-rejections.json')).reject(
      f.service.song(track),
    );
    expect(
      f.service.isRejectedCandidate(track, 'https://youtu.be/abcdefghijk'),
    ).toBe(true);
  });
  it('automatically advances to the next duration-matched non-rejected candidate', () => {
    const track: any = {
      artist: 'A',
      name: 'B',
      durationMs: 180000,
      youtubeUrl: videoUrl('abcdefghijk'),
      youtubeCandidates: [
        { url: videoUrl('abcdefghijk'), durationSeconds: 180 },
        { url: videoUrl('aqz-KE-bpKQ'), durationSeconds: 182 },
      ],
    };
    expect(f.service.rejectCandidate(track)).toBe(videoUrl('aqz-KE-bpKQ'));
    expect(f.service.rejectCandidate(track)).toBeNull();
  });
  it('empty results after a previously rejected source stay no-candidate, not Missing', async () => {
    const track: any = {
      artist: 'A',
      name: 'B',
      durationMs: 180000,
      youtubeUrl: videoUrl('abcdefghijk'),
    };
    f.service.rejectCandidate(track);
    (f.transport.process as jest.Mock).mockImplementation(
      async (_args, _kind, _timeout, line) => {
        line(searchDocument('A B', []));
        return { code: 0 };
      },
    );
    await expect(f.service.findTrackOnYoutube(track)).rejects.toThrow(
      DURATION_NO_CANDIDATE,
    );
  });
  it('review evidence parser accepts10 or50 and rejects out-of-contract depth', () => {
    const entries = Array.from({ length: 12 }, () => ({
      id: 'abcdefghijk',
      duration: 180,
    }));
    expect(
      candidateResultsFromLine(searchDocument('A B', entries, 10)).candidates,
    ).toHaveLength(10);
    expect(
      candidateResultsFromLine(searchDocument('A B', entries, 50)).candidates,
    ).toHaveLength(12);
    expect(
      candidateResultsFromLine(searchDocument('A B', entries, 51)),
    ).toBeNull();
  });
});
import { expect } from '@jest/globals';
