/** Retained benchmark, deliberately separate from mutable live pace/history. */
export const CLI_PROVEN_PROFILE = Object.freeze({
  id: 'cli-guarded-2026-09-13-4x240',
  downloadConc: 4,
  searchConc: 1,
  maxPerWindow: 240,
  windowMs: 600_000,
  batchSize: 8,
  searchBuffer: 192,
  maxSearches: 10,
  networkRetries: 5,
  downloadClient: 'mweb',
  searchClient: 'web_creator',
  authenticated: true,
  potProvider: 'http://127.0.0.1:4416',
  potVersion: '2.0.0',
  audioFormat: 'mp3',
  audioQuality: '0',
  formatSelector: 'ba/bestaudio/18/best',
  autoStep: false,
  measuredMp3PerMinute: 9.437068403019246,
  baselineMp3PerMinute: 3,
  measuredWindowMinutes: 941.07615,
  measuredAt: '2026-09-13T23:48:37.095Z',
  evidence:
    'Completed duration-guarded CLI run: 8,881 new MP3s in 941.07615 minutes (9.437/min, 3.146x baseline), zero blocks. Spotify source duration, pre-media candidate evidence and final MP3 duration checked for new acquisitions. This is whole-run throughput, including cached URLs and exception recovery; not full recording-identity proof or a web benchmark. Historical unguarded 4/1/216 transition window: 210 codec-verified MP3s in 10 minutes (21/min), with carryover and reviewed source mismatches; that figure is not the guarded workflow rate',
  historicalBenchmark: {
    measuredMp3PerMinute: 21,
    maxPerWindow: 216,
    measuredWindowMinutes: 10,
    durationGuard: false,
  },
  webBenchmark: 'Not yet run; web queues remain paused during CLI ownership',
});

/** Custom opts out deliberately; old process env does not silently select it. */
export function usesCliProvenProfile(): boolean {
  return process.env.YT_WEB_PROFILE !== 'custom';
}

export function webPaceDefaults() {
  return usesCliProvenProfile()
    ? {
        downloadConc: CLI_PROVEN_PROFILE.downloadConc,
        searchConc: CLI_PROVEN_PROFILE.searchConc,
        maxPerWindow: CLI_PROVEN_PROFILE.maxPerWindow,
        windowMs: CLI_PROVEN_PROFILE.windowMs,
        autoStep: false,
      }
    : { autoStep: false };
}

// Bull slots are logical songs, not yt-dlp processes. Four full batches need 32
// download jobs; YoutubePace independently limits actual subprocesses to four.
export function webWorkerConcurrency(kind: 'search' | 'download'): number {
  if (usesCliProvenProfile()) {
    return (
      CLI_PROVEN_PROFILE.batchSize *
      (kind === 'download'
        ? CLI_PROVEN_PROFILE.downloadConc
        : CLI_PROVEN_PROFILE.searchConc)
    );
  }
  const parsed = Number(
    process.env[
      kind === 'download' ? 'DOWNLOAD_CONCURRENCY' : 'SEARCH_CONCURRENCY'
    ],
  );
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 8;
}
