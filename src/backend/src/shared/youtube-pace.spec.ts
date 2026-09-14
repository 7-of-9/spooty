import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  YoutubePace,
  inferTripLever,
  isYoutubeRateLimit,
  probeMidpoint,
} from './youtube-pace';

function deferredSleepClock() {
  let now = 0;
  let sleepers: Array<{ until: number; resolve: () => void }> = [];
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      sleepers.push({ until: now + ms, resolve });
    });
  const tick = async (to: number) => {
    now = to;
    const ready = sleepers.filter((s) => s.until <= now);
    sleepers = sleepers.filter((s) => s.until > now);
    for (const s of ready) s.resolve();
    // Flush the sleep promise, the interruptible-sleep wrapper, and the
    // caller's await continuation.
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return {
    now: () => now,
    sleep,
    tick,
    getNow: () => now,
  };
}

describe('YoutubePace', () => {
  it('emits one success event per logical unit', async () => {
    const events: string[] = [];
    const pace = new YoutubePace({
      statePath: null,
      eventsPath: null,
      searchMin: 0,
      searchMax: 0,
    });
    (pace as any).emit = (type: string) => events.push(type);

    await pace.run(
      'search',
      async () => ({ count: 3 }),
      (result) => result.count,
    );

    expect(events).toEqual(['search_ok', 'search_ok', 'search_ok']);
  });

  it('accounts for batched download starts and successes per URL', async () => {
    const events: string[] = [];
    const pace = new YoutubePace({
      statePath: null,
      eventsPath: null,
      downloadMin: 0,
      downloadMax: 0,
      maxPerWindow: 8,
    });
    (pace as any).emit = (type: string) => events.push(type);

    await pace.run(
      'download',
      async () => ({ successes: 2 }),
      (result) => result.successes,
      3,
    );

    expect(pace.snapshot().downloadsInWindow).toBe(3);
    expect(events).toEqual([
      'download_start',
      'download_start',
      'download_start',
      'download_ok',
      'download_ok',
    ]);
  });

  it('waits until enough window slots exist for the whole batch', async () => {
    let now = 1_000;
    const pace = new YoutubePace({
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      statePath: null,
      eventsPath: null,
      downloadConc: 1,
      maxPerWindow: 4,
      windowMs: 100,
      downloadMin: 0,
      downloadMax: 0,
    });
    await pace.run('download', async () => undefined);
    now += 10;
    await pace.run('download', async () => undefined);
    now += 10;
    await pace.run('download', async () => undefined);
    now += 10;

    let startedAt = 0;
    await pace.run(
      'download',
      async () => {
        startedAt = now;
      },
      3,
      3,
    );

    // Three new starts need two of the prior three to expire.
    expect(startedAt).toBe(1_110);
    expect(pace.snapshot().downloadsInWindow).toBe(4);
  });

  it('rejects a batch larger than the live download window', async () => {
    const pace = new YoutubePace({
      statePath: null,
      eventsPath: null,
      maxPerWindow: 4,
      downloadMin: 0,
      downloadMax: 0,
    });

    const error = await pace
      .run('download', async () => undefined, 1, 5)
      .catch((reason) => reason as Error);
    expect(error.message).toContain('exceeds window limit 4');
  });

  it('holds a 9th download until the sliding window has a free slot', async () => {
    let now = 1_000_000;
    const pace = new YoutubePace({
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      statePath: null,
      eventsPath: null,
      conc: 1,
      maxPerWindow: 8,
      windowMs: 600_000,
      downloadMin: 0,
      downloadMax: 0,
      searchMin: 0,
      searchMax: 0,
    });
    const started: number[] = [];
    for (let i = 0; i < 9; i++) {
      await pace.run('download', async () => {
        started.push(now);
      });
    }
    expect(started.length).toBe(9);
    expect(started[7]).toBe(1_000_000);
    expect(started[8]).toBe(1_000_000 + 600_000);
    expect(pace.snapshot().downloadsInWindow).toBe(1);
  });

  it('lets conc downloads overlap', async () => {
    const pace = new YoutubePace({
      statePath: null,
      eventsPath: null,
      conc: 2,
      maxPerWindow: 50,
      windowMs: 600_000,
      downloadMin: 0,
      downloadMax: 0,
      searchMin: 0,
      searchMax: 0,
    });
    let inFlight = 0;
    let maxFlight = 0;
    const job = async () => {
      inFlight++;
      maxFlight = Math.max(maxFlight, inFlight);
      await new Promise((r) => setTimeout(r, 40));
      inFlight--;
    };
    await Promise.all([pace.run('download', job), pace.run('download', job)]);
    expect(maxFlight).toBe(2);
  });

  it('lets 8 downloads overlap while search uses a separate 1–2 cap', async () => {
    const pace = new YoutubePace({
      statePath: null,
      eventsPath: null,
      downloadConc: 8,
      searchConc: 2,
      maxPerWindow: 50,
      windowMs: 600_000,
      downloadMin: 0,
      downloadMax: 0,
      searchMin: 0,
      searchMax: 0,
    });
    let dFlight = 0;
    let sFlight = 0;
    let maxD = 0;
    let maxS = 0;
    const download = async () => {
      dFlight++;
      maxD = Math.max(maxD, dFlight);
      await new Promise((r) => setTimeout(r, 40));
      dFlight--;
    };
    const search = async () => {
      sFlight++;
      maxS = Math.max(maxS, sFlight);
      await new Promise((r) => setTimeout(r, 40));
      sFlight--;
    };
    await Promise.all([
      ...Array.from({ length: 8 }, () => pace.run('download', download)),
      pace.run('search', search),
      pace.run('search', search),
      pace.run('search', search),
    ]);
    expect(maxD).toBe(8);
    expect(maxS).toBe(2);
    expect(pace.snapshot().downloadConc).toBe(8);
    expect(pace.snapshot().searchConc).toBe(2);
  });

  it('rechecks the courtesy gap after a waiter acquires a slot', async () => {
    const clock = deferredSleepClock();
    const pace = new YoutubePace({
      now: clock.now,
      sleep: clock.sleep,
      statePath: null,
      eventsPath: null,
      downloadConc: 1,
      searchConc: 1,
      maxPerWindow: 50,
      windowMs: 600_000,
      downloadMin: 50,
      downloadMax: 50,
      searchMin: 0,
      searchMax: 0,
      botCoolMin: 0,
      botCoolMax: 0,
    });
    const started: number[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const a = pace.run('download', async () => {
      started.push(clock.getNow());
      await firstGate;
    });
    await Promise.resolve();
    await clock.tick(50);
    expect(started).toEqual([50]);
    const b = pace.run('download', async () => {
      started.push(clock.getNow());
    });
    await Promise.resolve();
    releaseFirst();
    await a;
    expect(started).toEqual([50]);
    await clock.tick(100);
    await b;
    expect(started).toEqual([50, 100]);
  });

  it('does not let an acquired waiter bypass a new cooldown', async () => {
    const clock = deferredSleepClock();
    const pace = new YoutubePace({
      now: clock.now,
      sleep: clock.sleep,
      statePath: null,
      eventsPath: null,
      downloadConc: 1,
      maxPerWindow: 50,
      windowMs: 600_000,
      downloadMin: 0,
      downloadMax: 0,
      botCoolMin: 100,
      botCoolMax: 100,
    });
    const started: number[] = [];
    const first = pace.run('download', async () => {
      started.push(clock.getNow());
      pace.coolOff(100, 'test bot');
    });
    const second = pace.run('download', async () => {
      started.push(clock.getNow());
    });
    await first;
    expect(started).toEqual([0]);
    await clock.tick(99);
    expect(started).toEqual([0]);
    await clock.tick(100);
    await second;
    expect(started).toEqual([0, 100]);
  });

  it('applyState raises the window cap used by later downloads', async () => {
    let now = 0;
    const pace = new YoutubePace({
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      statePath: null,
      eventsPath: null,
      conc: 1,
      maxPerWindow: 1,
      windowMs: 60_000,
      downloadMin: 0,
      downloadMax: 0,
    });
    await pace.run('download', async () => undefined);
    pace.applyState({ maxPerWindow: 8, reason: 'test bump' });
    const before = now;
    await pace.run('download', async () => undefined);
    expect(now).toBe(before);
    expect(pace.snapshot().maxPerWindow).toBe(8);
    expect(pace.snapshot().reason).toBe('test bump');
  });

  it('applyState wakes a download sleeping on the previous window cap', async () => {
    const clock = deferredSleepClock();
    const pace = new YoutubePace({
      now: clock.now,
      sleep: clock.sleep,
      statePath: null,
      eventsPath: null,
      downloadConc: 1,
      maxPerWindow: 1,
      windowMs: 60_000,
      downloadMin: 0,
      downloadMax: 0,
    });
    const started: number[] = [];
    await pace.run('download', async () => {
      started.push(clock.getNow());
    });
    const second = pace.run('download', async () => {
      started.push(clock.getNow());
    });
    await Promise.resolve();
    expect(started).toEqual([0]);

    pace.applyState({ maxPerWindow: 8, reason: 'test live bump' });
    await second;

    expect(started).toEqual([0, 0]);
  });

  it('preserves the sliding download window across a process restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yt-pace-state-'));
    const statePath = join(dir, 'state.json');
    let now = 1_000_000;
    const makePace = () =>
      new YoutubePace({
        now: () => now,
        sleep: async (ms) => {
          now += ms;
        },
        statePath,
        eventsPath: null,
        downloadConc: 1,
        maxPerWindow: 1,
        windowMs: 60_000,
        downloadMin: 0,
        downloadMax: 0,
      });
    await makePace().run('download', async () => undefined);
    const restarted = makePace();
    await restarted.run('download', async () => undefined);
    expect(now).toBe(1_060_000);
    rmSync(dir, { recursive: true, force: true });
  });

  it('preserves a bot cooldown across a process restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yt-pace-cooldown-'));
    const statePath = join(dir, 'state.json');
    const now = 1_000_000;
    const first = new YoutubePace({
      now: () => now,
      statePath,
      eventsPath: null,
      downloadConc: 2,
      lastGood: { downloadConc: 1 },
      botCoolMin: 120_000,
      botCoolMax: 120_000,
    });
    first.tripRateLimit('HTTP Error 429', undefined, 'downloadConc');
    const restarted = new YoutubePace({
      now: () => now,
      statePath,
      eventsPath: null,
    });
    expect(restarted.snapshot().coolRemainingMs).toBe(120_000);
    expect(restarted.snapshot().botsInWindow).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('download-attributed 429 trips the entire workload to the floor', () => {
    const pace = new YoutubePace({
      statePath: null,
      eventsPath: null,
      downloadConc: 8,
      searchConc: 2,
      maxPerWindow: 64,
      lastGood: { downloadConc: 4, searchConc: 2, maxPerWindow: 64 },
      downloadMin: 0,
      downloadMax: 0,
      botCoolMin: 0,
      botCoolMax: 0,
    });
    pace.tripRateLimit('HTTP Error 429', 0, 'downloadConc');
    const snap = pace.snapshot();
    expect(snap.downloadConc).toBe(1);
    expect(snap.conc).toBe(1);
    expect(snap.searchConc).toBe(1);
    expect(snap.maxPerWindow).toBe(8);
    expect(snap.lastFail.downloadConc).toBe(8);
    expect(snap.botsInWindow).toBe(1);
  });

  it('search-attributed 429 records search as the cause and trips globally', () => {
    const pace = new YoutubePace({
      statePath: null,
      eventsPath: null,
      downloadConc: 8,
      searchConc: 2,
      maxPerWindow: 64,
      lastGood: { downloadConc: 8, searchConc: 1, maxPerWindow: 64 },
      downloadMin: 0,
      downloadMax: 0,
      botCoolMin: 0,
      botCoolMax: 0,
    });
    pace.tripRateLimit('HTTP Error 429', 0, 'searchConc');
    const snap = pace.snapshot();
    expect(snap.searchConc).toBe(1);
    expect(snap.downloadConc).toBe(1);
    expect(snap.maxPerWindow).toBe(8);
    expect(snap.lastFail.searchConc).toBe(2);
  });

  it('after a clean interval probes the midpoint, not past last-fail', () => {
    let now = 1_000_000;
    const pace = new YoutubePace({
      autoStep: true,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      statePath: null,
      eventsPath: null,
      downloadConc: 8,
      searchConc: 2,
      maxPerWindow: 64,
      lastGood: { downloadConc: 4, searchConc: 2, maxPerWindow: 64 },
      downloadMin: 0,
      downloadMax: 0,
      botCoolMin: 0,
      botCoolMax: 0,
      cleanMsToStep: 1_000,
    });
    pace.tripRateLimit('HTTP Error 429', 0, 'downloadConc');
    expect(pace.snapshot().downloadConc).toBe(1);
    now += 1_000;
    const snap = pace.snapshot();
    expect(snap.downloadConc).toBe(6);
    expect(snap.downloadConc).toBeLessThan(8);
    expect(snap.searchConc).toBe(1);
    expect(probeMidpoint(4, 8)).toBe(6);
    expect(probeMidpoint(4, 5)).toBeNull();
  });

  it('repeated trips at the floor preserve history and remain visible', () => {
    let now = 1_000_000;
    const pace = new YoutubePace({
      autoStep: true,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      statePath: null,
      eventsPath: null,
      downloadConc: 8,
      searchConc: 2,
      maxPerWindow: 64,
      lastGood: { downloadConc: 4, searchConc: 2, maxPerWindow: 64 },
      downloadMin: 0,
      downloadMax: 0,
      botCoolMin: 0,
      botCoolMax: 0,
      cleanMsToStep: 1_000,
    });
    pace.tripRateLimit('HTTP Error 429', 0, 'downloadConc');
    pace.tripRateLimit('HTTP Error 429 chunk', 0, 'downloadConc');
    pace.tripRateLimit('HTTP Error 429 retry', 0, 'downloadConc');
    const snap = pace.snapshot();
    expect(snap.downloadConc).toBe(1);
    expect(snap.lastGood.downloadConc).toBe(4);
    expect(snap.lastFail.downloadConc).toBe(8);
    expect(snap.searchConc).toBe(1);
    expect(snap.botsInWindow).toBe(3);
    now += 1_000;
    expect(pace.snapshot().downloadConc).toBe(6);
  });

  it('does not probe upward while autoStep is disabled', () => {
    let now = 1_000_000;
    const pace = new YoutubePace({
      now: () => now,
      statePath: null,
      eventsPath: null,
      downloadConc: 8,
      lastGood: { downloadConc: 4 },
      cleanMsToStep: 1_000,
      autoStep: false,
      botCoolMin: 0,
      botCoolMax: 0,
    });
    pace.tripRateLimit('HTTP Error 429', 0, 'downloadConc');
    now += 10_000;
    expect(pace.snapshot().downloadConc).toBe(1);
    expect(pace.snapshot().autoStep).toBe(false);
  });

  it('uses a real cooldown for repeated bot-checks at the floor', () => {
    const pace = new YoutubePace({
      now: () => 1_000_000,
      statePath: null,
      eventsPath: null,
      downloadConc: 1,
      lastGood: { downloadConc: 1 },
      lastFail: { downloadConc: 4 },
      botCoolMin: 120_000,
      botCoolMax: 120_000,
    });
    pace.tripRateLimit(
      'Sign in to confirm you are not a bot',
      undefined,
      'downloadConc',
    );
    const snap = pace.snapshot();
    expect(snap.downloadConc).toBe(1);
    expect(snap.coolRemainingMs).toBe(120_000);
    expect(snap.reason).toMatch(/^FLOOR COOLDOWN downloadConc/);
  });

  it('backs off longer after another floor block in the repeat window', () => {
    let now = 1_000_000;
    const pace = new YoutubePace({
      now: () => now,
      statePath: null,
      eventsPath: null,
      downloadConc: 1,
      lastGood: { downloadConc: 1 },
      lastFail: { downloadConc: 4 },
      botCoolMin: 120_000,
      botCoolMax: 120_000,
      repeatBotCoolMin: 900_000,
      repeatBotCoolMax: 900_000,
      repeatBotWindowMs: 3_600_000,
    });

    pace.tripRateLimit('first floor block', undefined, 'downloadConc');
    expect(pace.snapshot().coolRemainingMs).toBe(120_000);
    now += 120_001;
    pace.tripRateLimit('second floor block', undefined, 'downloadConc');

    expect(pace.snapshot().coolRemainingMs).toBe(900_000);
    expect(pace.snapshot().botsInWindow).toBe(2);
  });

  it('a thrown download is not download_ok', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yt-pace-'));
    const eventsPath = join(dir, 'events.jsonl');
    const pace = new YoutubePace({
      statePath: null,
      eventsPath,
      downloadConc: 8,
      searchConc: 2,
      maxPerWindow: 64,
      lastGood: { downloadConc: 4, searchConc: 2, maxPerWindow: 64 },
      downloadMin: 0,
      downloadMax: 0,
      searchMin: 0,
      searchMax: 0,
      botCoolMin: 0,
      botCoolMax: 0,
    });
    let threw = false;
    try {
      await pace.run('download', async () => {
        throw new Error('HTTP Error 429: Too Many Requests');
      });
    } catch (err) {
      threw = /429/.test((err as Error).message);
    }
    expect(threw).toBe(true);
    const text = existsSync(eventsPath) ? readFileSync(eventsPath, 'utf8') : '';
    expect(text).not.toMatch(/download_ok/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('inferTripLever', () => {
  it('does not retarget a search TRIP as downloadConc', () => {
    expect(inferTripLever('TRIP searchConc HTTP Error 429 → 1')).toBe(
      'searchConc',
    );
    expect(inferTripLever('TRIP downloadConc HTTP Error 429 → 4')).toBe(
      'downloadConc',
    );
    expect(inferTripLever('goal: download conc 8')).toBeNull();
  });
});

describe('isYoutubeRateLimit', () => {
  it('trips on 429/bot/API page, not local routing blips', () => {
    expect(isYoutubeRateLimit('HTTP Error 429: Too Many Requests')).toBe(true);
    expect(isYoutubeRateLimit('YouTube rate limit or bot check (stderr)')).toBe(true);
    expect(isYoutubeRateLimit('Sign in to confirm you’re not a bot')).toBe(
      true,
    );
    expect(
      isYoutubeRateLimit('Unable to download API page: HTTP Error 403'),
    ).toBe(true);
    expect(
      isYoutubeRateLimit('unable to download video data: HTTP Error 403'),
    ).toBe(false);
    expect(
      isYoutubeRateLimit(
        'Unable to download API page: Failed to establish a new connection: [Errno 65] No route to host',
      ),
    ).toBe(false);
    expect(isYoutubeRateLimit('No YouTube result')).toBe(false);
  });

  it('does not treat ordinary sign-in age gates as rate limits', () => {
    expect(isYoutubeRateLimit('Sign in to confirm your age...')).toBe(false);
    expect(
      isYoutubeRateLimit(
        'Sign in to confirm this video is appropriate for you',
      ),
    ).toBe(false);
    expect(isYoutubeRateLimit("Sign in to confirm you're not a bot")).toBe(
      true,
    );
  });

  it('does not treat yt-dlp progress KiB/s as HTTP 429', () => {
    expect(
      isYoutubeRateLimit(
        '[download]  48.0% of    2.95MiB at  429.51KiB/s ETA 00:03\n',
      ),
    ).toBe(false);
    expect(
      isYoutubeRateLimit(
        '[download] 100% of 12.00MiB at 1024.00KiB/s ETA 00:00\nHTTP Error 429: Too Many Requests',
      ),
    ).toBe(true);
  });
});
