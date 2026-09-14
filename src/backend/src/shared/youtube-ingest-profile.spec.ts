import {
  CLI_PROVEN_PROFILE,
  usesCliProvenProfile,
  webPaceDefaults,
  webWorkerConcurrency,
} from './youtube-ingest-profile';
import { YoutubePace } from './youtube-pace';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('retained CLI-proven web profile', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });
  it('retains measured settings, not the experimental live trial or old env ceilings', () => {
    delete process.env.YT_WEB_PROFILE;
    Object.assign(process.env, {
      YT_YTDLP_CONC: '12',
      YT_SEARCH_CONC: '6',
      YT_DOWNLOAD_PER_WINDOW: '96',
      DOWNLOAD_CONCURRENCY: '12',
      SEARCH_CONCURRENCY: '6',
    });
    expect(usesCliProvenProfile()).toBe(true);
    expect(CLI_PROVEN_PROFILE).toMatchObject({
      downloadConc: 4,
      searchConc: 1,
      maxPerWindow: 240,
      batchSize: 8,
      searchBuffer: 192,
      measuredMp3PerMinute: 9.437068403019246,
      measuredAt: '2026-09-13T23:48:37.095Z',
      maxSearches: 10,
      networkRetries: 5,
    });
    expect(CLI_PROVEN_PROFILE.evidence).toContain(
      'Completed duration-guarded CLI run',
    );
    expect(CLI_PROVEN_PROFILE.evidence).toContain('8,881 new MP3s');
    expect(CLI_PROVEN_PROFILE.evidence).toContain(
      'not full recording-identity proof or a web benchmark',
    );
    expect(CLI_PROVEN_PROFILE.historicalBenchmark).toMatchObject({
      measuredMp3PerMinute: 21,
      durationGuard: false,
    });
    expect(webWorkerConcurrency('download')).toBe(32);
    expect(webWorkerConcurrency('search')).toBe(8);
    const pace = new YoutubePace({
      ...webPaceDefaults(),
      statePath: null,
      eventsPath: null,
    });
    expect(pace.snapshot()).toMatchObject({
      downloadConc: 4,
      searchConc: 1,
      maxPerWindow: 240,
      autoStep: false,
    });
  });
  it('does not overwrite persisted safety floor, cooldown or admission history', () => {
    const root = mkdtempSync(join(tmpdir(), 'web-profile-'));
    try {
      const path = join(root, 'pace.json');
      const now = Date.now();
      const state = JSON.stringify({
        downloadConc: 1,
        searchConc: 1,
        maxPerWindow: 8,
        autoStep: false,
        coolUntil: now + 60000,
        downloadStarts: [now - 1000],
      });
      writeFileSync(path, state);
      const pace = new YoutubePace({
        ...webPaceDefaults(),
        statePath: path,
        eventsPath: null,
        now: () => now,
      });
      expect(pace.snapshot()).toMatchObject({
        downloadConc: 1,
        searchConc: 1,
        maxPerWindow: 8,
        coolRemainingMs: 60000,
        downloadsInWindow: 1,
        autoStep: false,
      });
      expect(readFileSync(path, 'utf8')).toBe(state);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('requires explicit custom mode to use legacy environment tuning', () => {
    process.env.YT_WEB_PROFILE = 'custom';
    process.env.DOWNLOAD_CONCURRENCY = '5';
    expect(usesCliProvenProfile()).toBe(false);
    expect(webWorkerConcurrency('download')).toBe(5);
  });
});
import { expect } from '@jest/globals';
