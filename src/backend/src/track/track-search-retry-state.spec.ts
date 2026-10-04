import { expect } from '@jest/globals';
import { trackFixture } from './acquisition.fixture';
import { TrackStatusEnum } from './track.entity';
import {
  DURATION_NO_CANDIDATE,
  DURATION_SOURCE_MISSING,
} from '../shared/acquisition/duration-policy';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { MediaDurationCache } from '../shared/acquisition/local-media';

describe('durable acquisition outcomes and independent retry budgets', () => {
  let f: ReturnType<typeof trackFixture>;
  beforeEach(() => {
    f = trackFixture();
  });
  afterEach(() => {
    f.close();
    jest.restoreAllMocks();
  });
  it('persists a real delayed source-metadata retry without a media/search request', async () => {
    f.metadata.ensure.mockRejectedValue(new Error(DURATION_SOURCE_MISSING));
    await f.service.findOnYoutube(f.row);
    expect(f.row).toMatchObject({
      status: TrackStatusEnum.RetryWaiting,
      acquisitionState: 'retry',
      operationAttempts: 1,
    });
    expect(f.row.retryAt).toBeGreaterThan(Date.now());
    expect(f.search.add).toHaveBeenCalledTimes(1);
    expect(f.transport.process).not.toHaveBeenCalled();
    expect(await f.journal.get(f.key)).toMatchObject({
      state: 'retry',
      attempts: 1,
      network_attempts: 0,
    });
  });
  it('candidate exhaustion is durable, not a fictitious retry or a network failure', async () => {
    await (f.service as any).handleFailure(
      f.row,
      new Error(DURATION_NO_CANDIDATE),
      'search',
    );
    expect(f.row).toMatchObject({
      status: TrackStatusEnum.Error,
      acquisitionState: 'no-candidate',
      retryAt: null,
    });
    expect(await f.journal.get(f.key)).toMatchObject({
      state: 'no-candidate',
      network_attempts: 0,
      attempts: 0,
      retry_at: 0,
    });
    expect(f.search.add).not.toHaveBeenCalled();
  });
  it('five additional network retries allow exactly six failed requests', async () => {
    for (let n = 1; n <= 6; n++) {
      await (f.service as any).handleFailure(
        { ...f.row },
        new Error('Local network unavailable'),
        'search',
      );
      expect(f.row.networkAttempts).toBe(n);
      expect(f.row.acquisitionState).toBe(n === 6 ? 'failed' : 'retry');
    }
    expect(f.search.add).toHaveBeenCalledTimes(5);
  });
  it('operational errors stop on the fifth total failure without spending network retries', async () => {
    for (let n = 1; n <= 5; n++) {
      await (f.service as any).handleFailure(
        { ...f.row },
        new Error('MP3 tags could not be written'),
        'download',
      );
      expect(f.row.operationAttempts).toBe(n);
      expect(f.row.acquisitionState).toBe(n === 5 ? 'failed' : 'retry');
    }
    expect(f.download.add).toHaveBeenCalledTimes(4);
    expect(f.row.networkAttempts || 0).toBe(0);
  });
  it('never says retry scheduled if durable queue admission failed', async () => {
    f.search.add.mockRejectedValue(new Error('Redis unavailable'));
    await (f.service as any).handleFailure(
      f.row,
      new Error('Local network unavailable'),
      'search',
    );
    expect(f.row).toMatchObject({
      status: TrackStatusEnum.Error,
      acquisitionState: 'failed',
      retryAt: null,
      error: 'Could not schedule acquisition retry',
    });
  });
  it('same-depth CLI no-candidate skips normal web actions and larger depth reopens it', async () => {
    await f.journal.save({
      key: f.key,
      state: 'no-candidate',
      searchLimit: 10,
      error: DURATION_NO_CANDIDATE,
    });
    expect(await f.service.retry(f.row.id, {})).toBe(false);
    expect(f.search.add).not.toHaveBeenCalled();
    expect(await f.service.retry(f.row.id, { maxSearches: 25 })).toBe(true);
    expect(f.row.maxSearches).toBe(25);
    expect(await f.journal.get(f.key)).toMatchObject({
      state: 'pending',
      error: null,
    });
  });
  it('normal actions retain exhausted errors; error retry is explicit and does not reopen Missing', async () => {
    await f.journal.save({
      key: f.key,
      state: 'error',
      attempts: 5,
      networkAttempts: 6,
      error: 'Local network unavailable',
    });
    expect(await f.service.retry(f.row.id, {})).toBe(false);
    expect(await f.service.retry(f.row.id, { retryErrors: true })).toBe(true);
    expect(f.row).toMatchObject({ operationAttempts: 0, networkAttempts: 0 });
    await f.journal.save({
      key: f.key,
      state: 'missing',
      error: 'No YouTube result',
    });
    expect(await f.service.retry(f.row.id, { retryErrors: true })).toBe(false);
    expect(await f.service.retry(f.row.id, { retryMissing: true })).toBe(true);
  });
  it('stale queued jobs honor CLI durable exhaustion rather than doing another search', async () => {
    await f.journal.save({
      key: f.key,
      state: 'no-candidate',
      searchLimit: 10,
      error: DURATION_NO_CANDIDATE,
    });
    await f.service.findOnYoutube(f.row);
    expect(f.transport.process).not.toHaveBeenCalled();
    expect(f.search.add).not.toHaveBeenCalled();
  });

  it('preserves parked legacy history while an explicit retry writes only the exact source key', async () => {
    const legacy = 'a - b';
    await f.journal.save({ key: legacy, state: 'no-candidate', searchLimit: 10, error: DURATION_NO_CANDIDATE, url: 'legacy-other-version' });
    f.row.durationMs = 30000;
    mkdirSync(dirname(f.destination), { recursive: true });
    writeFileSync(f.destination, 'wrong version');
    jest.spyOn(MediaDurationCache.prototype, 'duration').mockResolvedValue(60);
    expect(await f.service.retry(f.row.id, {})).toBe(false);
    expect(f.search.add).not.toHaveBeenCalled();
    expect(await f.service.retry(f.row.id, { retryNoCandidate: true })).toBe(true);
    expect(await f.journal.get(f.key)).toMatchObject({ state: 'pending', url: null });
    expect(await f.journal.get(legacy)).toMatchObject({ state: 'no-candidate', url: 'legacy-other-version' });
    expect(f.row.audioFilename).toContain(']-2.mp3');
    expect(f.search.add).toHaveBeenCalledTimes(1);
  });
  it('read-only library projection shows CLI no-candidate depth without another attempt', async () => {
    await f.journal.save({
      key: f.key,
      state: 'no-candidate',
      searchLimit: 10,
      error: DURATION_NO_CANDIDATE,
      networkAttempts: 2,
    });
    const [projected] = await f.service.getAll();
    expect(projected).toMatchObject({
      acquisitionState: 'no-candidate',
      searchLimit: 10,
      networkAttempts: 2,
      retryAt: null,
    });
    expect(f.repository.update).not.toHaveBeenCalled();
    expect(f.search.add).not.toHaveBeenCalled();
  });
  it('physical fast-reuse clears an old terminal journal state durably', async () => {
    await f.journal.save({
      key: f.key,
      state: 'no-candidate',
      searchLimit: 10,
      error: DURATION_NO_CANDIDATE,
    });
    mkdirSync(dirname(f.destination), { recursive: true });
    writeFileSync(f.destination, 'existing');
    expect(await f.service.retry(f.row.id, {})).toBe(false);
    expect(await f.journal.get(f.key)).toMatchObject({
      state: 'done',
      error: null,
    });
    expect(f.metadata.ensure).not.toHaveBeenCalled();
  });
});
