import { expect } from '@jest/globals';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { trackFixture } from './acquisition.fixture';
import { TrackStatusEnum } from './track.entity';
import { DURATION_REJECTED } from '../shared/acquisition/duration-policy';
import { videoUrl } from '../shared/acquisition/web-adapter.fixture';

describe('Track/Bull adapter delegates acquisition and records durable source evidence', () => {
  let f: ReturnType<typeof trackFixture>;
  beforeEach(() => {
    f = trackFixture();
    f.row.youtubeUrl = videoUrl('abcdefghijk');
  });
  afterEach(() => {
    f.close();
    jest.restoreAllMocks();
  });
  it('persists Spotify duration and marks Completed only after shared verified publication', async () => {
    jest
      .spyOn(f.youtube, 'downloadAndFormat')
      .mockImplementation(async (track) => {
        mkdirSync(dirname(f.destination), { recursive: true });
        writeFileSync(f.destination, 'shared-verified-output');
        track.sourceEvidence = { videoId: 'abcdefghijk', durationSeconds: 180 };
      });
    await f.service.downloadFromYoutube(f.row);
    expect(f.row).toMatchObject({
      status: TrackStatusEnum.Completed,
      durationMs: 180000,
      sourceEvidence: { videoId: 'abcdefghijk' },
    });
    expect(await f.journal.get(f.key)).toMatchObject({ state: 'done' });
  });
  it('final mismatch advances automatically without incrementing either failure budget', async () => {
    f.row.durationMs = 180000;
    f.row.youtubeCandidates = [
      {
        url: videoUrl('abcdefghijk'),
        videoId: 'abcdefghijk',
        durationSeconds: 180,
        title: 'wrong',
      },
      {
        url: videoUrl('aqz-KE-bpKQ'),
        videoId: 'aqz-KE-bpKQ',
        durationSeconds: 182,
        title: 'next',
      },
    ];
    jest
      .spyOn(f.youtube, 'downloadAndFormat')
      .mockRejectedValue(new Error(DURATION_REJECTED));
    await f.service.downloadFromYoutube(f.row);
    expect(f.row).toMatchObject({
      status: TrackStatusEnum.Queued,
      youtubeUrl: videoUrl('aqz-KE-bpKQ'),
      acquisitionState: null,
    });
    expect(f.download.add).toHaveBeenCalledTimes(1);
    expect(await f.journal.get(f.key)).toMatchObject({
      network_attempts: 0,
      attempts: 0,
      state: 'ready',
    });
    expect(existsSync(f.destination)).toBe(false);
  });
  it('existing physical media fast-skips without Spotify lookup or re-audit', async () => {
    mkdirSync(dirname(f.destination), { recursive: true });
    writeFileSync(f.destination, 'historical');
    await f.service.downloadFromYoutube(f.row);
    expect(f.row.status).toBe(TrackStatusEnum.Completed);
    expect(f.metadata.ensure).not.toHaveBeenCalled();
    expect(f.transport.process).not.toHaveBeenCalled();
  });
  it('a wrong-duration local reuse source is never copied or changed', async () => {
    const source = join(f.downloads, 'source.mp3');
    writeFileSync(source, 'original');
    (f.service as any).completedAudioIndex = Promise.resolve(
      new Map([[f.key, source]]),
    );
    jest
      .spyOn(f.youtube, 'verifyAudioDuration')
      .mockRejectedValue(new Error(DURATION_REJECTED));
    jest
      .spyOn(f.youtube, 'downloadAndFormat')
      .mockRejectedValue(new Error('Local network unavailable'));
    await f.service.downloadFromYoutube(f.row);
    expect(existsSync(f.destination)).toBe(false);
    expect(readFileSync(source, 'utf8')).toBe('original');
    expect(f.row.status).toBe(TrackStatusEnum.RetryWaiting);
  });
  it('cached URLs that the prior owner rejected never reach download again', async () => {
    f.row.durationMs = 180000;
    f.youtube.rejectCandidate({ ...f.row });
    const download = jest.spyOn(f.youtube, 'downloadAndFormat');
    await f.service.downloadFromYoutube(f.row);
    expect(download).not.toHaveBeenCalled();
    expect(f.search.add).toHaveBeenCalledTimes(1);
    expect(await f.journal.get(f.key)).toMatchObject({
      state: 'pending',
      network_attempts: 0,
      attempts: 0,
    });
  });
});
