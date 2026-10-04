import { expect } from '@jest/globals';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { trackFixture } from './acquisition.fixture';
import { TrackStatusEnum } from './track.entity';
import { DURATION_REJECTED } from '../shared/acquisition/duration-policy';
import { videoUrl } from '../shared/acquisition/web-adapter.fixture';
import { MediaDurationCache } from '../shared/acquisition/local-media';
import { sourceFileBase } from '../shared/acquisition/identity';

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
  it('projects old Pending rows with actual jobs as Waiting without rewriting the queue', async () => {
    f.queueRead.mockResolvedValue([['id-1-123'], [], [], [], []]);
    expect((await f.service.getActive())[0].status).toBe(
      TrackStatusEnum.Queued,
    );
    expect(f.row.status).toBe(TrackStatusEnum.New);
    expect(f.search.add).not.toHaveBeenCalled();
  });
  it('does not fabricate queue membership for never-admitted Pending tracks', async () => {
    expect(await f.service.getActive()).toEqual([]);
  });
  it('old preserved jobs cannot reopen parked journal outcomes during a read', async () => {
    f.queueRead.mockResolvedValue([['id-1-123']]);
    await f.journal.save({
      key: f.key,
      state: 'no-candidate',
      searchLimit: 10,
    });
    expect(await f.service.getActive()).toEqual([]);
  });
  it('a Pending admission with an existing job reconciles the label without adding another or clearing its URL', async () => {
    f.queueRead.mockResolvedValue([['id-1-123']]);
    const url = f.row.youtubeUrl;
    expect(await (f.service as any).enqueueSaved(f.row, {})).toBe(false);
    expect(f.row.status).toBe(TrackStatusEnum.Queued);
    expect(f.row.youtubeUrl).toBe(url);
    expect(f.search.add).not.toHaveBeenCalled();
  });
  it('publishes Waiting on search admission so paused jobs are not shown as Pending', async () => {
    f.row.youtubeUrl = null;
    await (f.service as any).enqueueSaved(f.row, { retryNoCandidate: true });
    expect(f.search.add).toHaveBeenCalledTimes(1);
    expect(f.row.status).toBe(TrackStatusEnum.Queued);
    expect(await f.journal.get(f.key)).toMatchObject({ state: 'pending' });
  });
  it('does not leave a false Waiting label when search admission fails', async () => {
    f.search.add.mockRejectedValue(new Error('queue unavailable'));
    await expect((f.service as any).enqueueSaved(f.row, {})).rejects.toThrow(
      'Could not queue YouTube search',
    );
    expect(f.row).toMatchObject({
      status: TrackStatusEnum.Error,
      acquisitionState: 'failed',
    });
    expect(await f.journal.get(f.key)).toMatchObject({ state: 'error' });
  });
  it('persists Spotify duration and marks Completed only after shared verified publication', async () => {
    jest
      .spyOn(f.youtube, 'downloadAndFormat')
      .mockImplementation(async (track) => {
        mkdirSync(dirname(f.destination), { recursive: true });
        writeFileSync(f.destination, 'shared-verified-output');
        track.sourceEvidence = { videoId: 'abcdefghijk', durationSeconds: 180 };
        return { path: f.destination, created: true };
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
  it('unknown historical presence skips admission without claiming new verified ingestion', async () => {
    mkdirSync(dirname(f.destination), { recursive: true });
    writeFileSync(f.destination, 'historical');
    await f.service.retry(f.row.id, {});
    expect(f.row.status).toBe(TrackStatusEnum.Completed);
    expect(f.metadata.ensure).not.toHaveBeenCalled();
    expect(f.transport.process).not.toHaveBeenCalled();
  });
  it('a wrong-duration local reuse source is never copied or changed', async () => {
    const source = join(f.downloads, 'A - B.mp3');
    writeFileSync(source, 'original');
    f.row.durationMs = 180000;
    const probe = jest.spyOn(MediaDurationCache.prototype, 'duration').mockResolvedValue(600);
    jest
      .spyOn(f.youtube, 'downloadAndFormat')
      .mockRejectedValue(new Error('Local network unavailable'));
    await f.service.downloadFromYoutube(f.row);
    expect(existsSync(f.destination)).toBe(false);
    expect(readFileSync(source, 'utf8')).toBe('original');
    expect(f.row.status).toBe(TrackStatusEnum.RetryWaiting);
    expect(probe).toHaveBeenCalledWith(source);
  });

  it('worker reuse recovers a late occupied destination without a network request or failed-job budget', async () => {
    const source = join(f.downloads, 'A - B.mp3');
    writeFileSync(source, 'verified source');
    f.row.durationMs = 180000;
    jest.spyOn(MediaDurationCache.prototype, 'duration').mockResolvedValue(180);
    let intervened = false;
    f.repository.update.mockImplementation(async (_id, update) => {
      Object.assign(f.row, update);
      if (!intervened && update.audioFilename) {
        intervened = true;
        mkdirSync(dirname(f.destination), { recursive: true });
        writeFileSync(f.destination, 'another writer');
      }
    });
    await f.service.downloadFromYoutube(f.row);
    const actual = join(dirname(f.destination), sourceFileBase(f.row, 2) + '.mp3');
    expect(f.row).toMatchObject({ status: TrackStatusEnum.Completed, audioFilename: sourceFileBase(f.row, 2) + '.mp3' });
    expect(readFileSync(actual, 'utf8')).toBe('verified source');
    expect(readFileSync(f.destination, 'utf8')).toBe('another writer');
    expect(await f.journal.get(f.key)).toMatchObject({ state: 'done', attempts: 0, network_attempts: 0 });
    expect(f.transport.process).not.toHaveBeenCalled();
    expect(f.search.add).not.toHaveBeenCalled();
    expect(f.download.add).not.toHaveBeenCalled();
  });

  it('download completion persists the actual publication path, not its superseded requested name', async () => {
    const actual = join(dirname(f.destination), sourceFileBase(f.row, 2) + '.mp3');
    jest.spyOn(f.youtube, 'downloadAndFormat').mockImplementation(async () => {
      mkdirSync(dirname(actual), { recursive: true });
      writeFileSync(f.destination, 'unrelated file');
      writeFileSync(actual, 'verified downloaded MP3');
      return { path: actual, created: true };
    });
    await f.service.downloadFromYoutube(f.row);
    expect(f.row).toMatchObject({ status: TrackStatusEnum.Completed, audioFilename: sourceFileBase(f.row, 2) + '.mp3' });
    expect(readFileSync(f.destination, 'utf8')).toBe('unrelated file');
    expect(await f.journal.get(f.key)).toMatchObject({ state: 'done', attempts: 0, network_attempts: 0 });
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
