import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { dirname } from 'path';

export function envNum(key: string, fallback: number, min = 0): number {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

export function jitter(minMs: number, maxMs: number): number {
  if (maxMs <= minMs) return minMs;
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

export const YOUTUBE_RATE_LIMIT_RE =
  /not a bot|too many requests|http error 429|status code 429|\b429\b(?!\.\d)|quota exceeded|precondition check failed|unable to download api page|youtube rate limit or bot check/i;

const LOCAL_NET_RE =
  /no route to host|errno 65|errno 51|network is unreachable|nodename nor servname/i;

export function isYoutubeRateLimit(text: string): boolean {
  const blob = text || '';
  if (!blob) return false;
  if (LOCAL_NET_RE.test(blob)) return false;
  // yt-dlp progress (`[download] 48.0% of 2.95MiB at 429.51KiB/s`) is not a 429.
  const withoutProgress = blob
    .split(/\r?\n/)
    .filter((line) => !/^\[download\]/i.test(line.trim()))
    .join('\n');
  if (!withoutProgress.trim()) return false;
  return YOUTUBE_RATE_LIMIT_RE.test(withoutProgress);
}

export type PaceKind = 'search' | 'download';
export type PaceLever = 'searchConc' | 'downloadConc' | 'maxPerWindow';

export type LeverBook = Record<PaceLever, number | null>;

export type PaceSnapshot = {
  conc: number;
  searchConc: number;
  downloadConc: number;
  active: number;
  searchActive: number;
  downloadActive: number;
  maxPerWindow: number;
  downloadsInWindow: number;
  windowMs: number;
  coolUntil: number;
  coolRemainingMs: number;
  lastBotAt: number | null;
  botsInWindow: number;
  reason: string | null;
  lastGood: LeverBook;
  lastFail: LeverBook;
  autoStep: boolean;
};

export type PaceStateFile = {
  maxPerWindow?: number;
  conc?: number;
  downloadConc?: number;
  searchConc?: number;
  floorPerWindow?: number;
  lastBotAt?: number | null;
  lastStepAt?: number | null;
  reason?: string | null;
  lastGood?: Partial<LeverBook>;
  lastFail?: Partial<LeverBook>;
  tripLever?: PaceLever;
  cleanMsToStep?: number;
  autoStep?: boolean;
  downloadStarts?: number[];
  coolUntil?: number;
  botTimes?: number[];
};

export type PaceIo = {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  statePath?: string | null;
  eventsPath?: string | null;
  searchMin?: number;
  searchMax?: number;
  downloadMin?: number;
  downloadMax?: number;
  windowMs?: number;
  maxPerWindow?: number;
  conc?: number;
  downloadConc?: number;
  searchConc?: number;
  botCoolMin?: number;
  botCoolMax?: number;
  repeatBotCoolMin?: number;
  repeatBotCoolMax?: number;
  repeatBotWindowMs?: number;
  lastGood?: Partial<LeverBook>;
  lastFail?: Partial<LeverBook>;
  cleanMsToStep?: number;
  autoStep?: boolean;
};

function sleepDefault(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function defaultPaceStatePath(): string {
  return (
    process.env.YT_PACE_STATE_PATH || `${process.cwd()}/config/yt-pace.json`
  );
}

export function defaultPaceEventsPath(): string {
  return (
    process.env.YT_PACE_EVENTS_PATH || `${process.cwd()}/config/yt-events.jsonl`
  );
}

const FLOOR: LeverBook = {
  searchConc: 1,
  downloadConc: 1,
  maxPerWindow: 8,
};

const CAP: LeverBook = {
  searchConc: 6,
  downloadConc: 12,
  maxPerWindow: 96,
};

export function inferTripLever(
  reason: string | null | undefined,
): PaceLever | null {
  const r = String(reason || '');
  if (/\bsearchConc\b/.test(r)) return 'searchConc';
  if (/\bmaxPerWindow\b/.test(r)) return 'maxPerWindow';
  if (/\bdownloadConc\b/.test(r)) return 'downloadConc';
  return null;
}

/** Midpoint of last-good and last-fail, strictly between them (never ≥ last-fail). */
export function probeMidpoint(
  lastGood: number,
  lastFail: number,
): number | null {
  if (!Number.isFinite(lastGood) || !Number.isFinite(lastFail)) return null;
  if (lastFail <= lastGood + 1) return null;
  const mid = Math.floor((lastGood + lastFail) / 2);
  if (mid <= lastGood) {
    return lastGood + 1 < lastFail ? lastGood + 1 : null;
  }
  if (mid >= lastFail) return null;
  return mid;
}

function leverFromKind(kind: PaceKind): PaceLever {
  return kind === 'search' ? 'searchConc' : 'downloadConc';
}

/**
 * Shared YouTube gate: separate search vs download yt-dlp pools, a sliding
 * download window, per-lever 429 freeze, and binary-search probe after a
 * clean interval. Courtesy gap is slept *before* acquiring a slot.
 */
export class YoutubePace {
  private searchActive = 0;
  private downloadActive = 0;
  private readonly searchWaiters: Array<() => void> = [];
  private readonly downloadWaiters: Array<() => void> = [];
  private readonly sleepWaiters = new Set<() => void>();
  private lastEnd = 0;
  private coolUntil = 0;
  private downloadStarts: number[] = [];
  private botTimes: number[] = [];
  private lastBotAt: number | null = null;
  private lastStepAt: number | null = null;
  private lastLoad = 0;
  private reason: string | null = null;
  private searchConc: number;
  private downloadConc: number;
  private maxPerWindow: number;
  private floorPerWindow: number;
  private lastGood: LeverBook;
  private lastFail: LeverBook;
  private readonly searchMin: number;
  private readonly searchMax: number;
  private readonly downloadMin: number;
  private readonly downloadMax: number;
  private readonly windowMs: number;
  private readonly botCoolMin: number;
  private readonly botCoolMax: number;
  private readonly repeatBotCoolMin: number;
  private readonly repeatBotCoolMax: number;
  private readonly repeatBotWindowMs: number;
  private readonly cleanMsToStep: number;
  private autoStep: boolean;
  private readonly statePath: string | null;
  private readonly eventsPath: string | null;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(io: PaceIo = {}) {
    this.now = io.now || Date.now;
    this.sleep = io.sleep || sleepDefault;
    this.statePath =
      io.statePath === undefined ? defaultPaceStatePath() : io.statePath;
    this.eventsPath =
      io.eventsPath === undefined ? defaultPaceEventsPath() : io.eventsPath;
    this.searchMin = io.searchMin ?? envNum('YT_SEARCH_GAP_MIN_MS', 400);
    this.searchMax = io.searchMax ?? envNum('YT_SEARCH_GAP_MAX_MS', 1200);
    this.downloadMin =
      io.downloadMin ??
      envNum(
        'YT_DOWNLOAD_GAP_MIN_MS',
        Math.max(envNum('DOWNLOAD_GAP_MS', 800), 400),
      );
    this.downloadMax = io.downloadMax ?? envNum('YT_DOWNLOAD_GAP_MAX_MS', 2500);
    this.windowMs = io.windowMs ?? envNum('YT_DOWNLOAD_WINDOW_MS', 10 * 60_000);
    this.maxPerWindow =
      io.maxPerWindow ?? envNum('YT_DOWNLOAD_PER_WINDOW', 96, 1);
    this.floorPerWindow = envNum('YT_DOWNLOAD_FLOOR', 8, 1);
    this.downloadConc =
      io.downloadConc ?? io.conc ?? envNum('YT_YTDLP_CONC', 12, 1);
    this.searchConc = io.searchConc ?? envNum('YT_SEARCH_CONC', 6, 1);
    this.botCoolMin =
      io.botCoolMin ?? envNum('YT_BOT_COOLDOWN_MIN_MS', 180_000);
    this.botCoolMax =
      io.botCoolMax ?? envNum('YT_BOT_COOLDOWN_MAX_MS', 360_000);
    this.repeatBotCoolMin =
      io.repeatBotCoolMin ??
      envNum('YT_REPEAT_BOT_COOLDOWN_MIN_MS', 15 * 60_000);
    this.repeatBotCoolMax =
      io.repeatBotCoolMax ??
      envNum('YT_REPEAT_BOT_COOLDOWN_MAX_MS', 30 * 60_000);
    this.repeatBotWindowMs =
      io.repeatBotWindowMs ?? envNum('YT_REPEAT_BOT_WINDOW_MS', 60 * 60_000);
    this.cleanMsToStep =
      io.cleanMsToStep ?? envNum('YT_CLEAN_MS_TO_STEP', 900_000);
    this.autoStep = io.autoStep ?? false;
    this.lastGood = {
      searchConc: io.lastGood?.searchConc ?? FLOOR.searchConc,
      downloadConc: io.lastGood?.downloadConc ?? FLOOR.downloadConc,
      maxPerWindow: io.lastGood?.maxPerWindow ?? FLOOR.maxPerWindow,
    };
    this.lastFail = {
      searchConc: io.lastFail?.searchConc ?? null,
      downloadConc: io.lastFail?.downloadConc ?? null,
      maxPerWindow: io.lastFail?.maxPerWindow ?? null,
    };
    this.loadState(true);
  }

  coolOff(ms?: number, detail?: string) {
    const wait = ms ?? jitter(this.botCoolMin, this.botCoolMax);
    const t = this.now();
    this.coolUntil = Math.max(this.coolUntil, t + wait);
    this.lastBotAt = t;
    this.botTimes.push(t);
    this.emit('bot', detail || `cool ${wait}ms`);
    this.wakeSleeps();
  }

  /**
   * A confirmed 429/bot-check/API-page block is an emergency stop: remember
   * which lever exposed the failing boundary, then put the entire YouTube
   * workload back at one search, one download, and 8 starts/10 minutes.
   * Repeated signals at the floor extend the cooldown but do not corrupt the
   * previously observed failure boundary.
   */
  tripRateLimit(
    detail?: string,
    ms?: number,
    lever: PaceLever = 'downloadConc',
  ) {
    const cur = this.getLever(lever);
    const floor = this.floorOf(lever);
    const attributedAtFloor = cur <= floor;
    const t = this.now();
    const repeatedAtFloor =
      attributedAtFloor &&
      this.lastBotAt != null &&
      t - this.lastBotAt >= 0 &&
      t - this.lastBotAt < this.repeatBotWindowMs;
    if (cur > floor) {
      const previousFail = this.lastFail[lever];
      this.lastFail[lever] =
        previousFail == null ? cur : Math.min(previousFail, cur);
      const previousGood = this.lastGood[lever];
      if (previousGood == null || previousGood >= cur) {
        this.lastGood[lever] = floor;
      }
    }
    const cooldown =
      ms ??
      (repeatedAtFloor
        ? jitter(this.repeatBotCoolMin, this.repeatBotCoolMax)
        : undefined);
    this.coolOff(cooldown, detail);
    this.setLever('searchConc', FLOOR.searchConc as number);
    this.setLever('downloadConc', FLOOR.downloadConc as number);
    this.setLever('maxPerWindow', this.floorPerWindow);
    this.lastStepAt = this.now();
    this.reason = `${attributedAtFloor ? 'FLOOR COOLDOWN' : 'TRIP'} ${lever} ${String(detail || 'rate-limit').slice(0, 80)} → 1x8 floor`;
    this.persistState();
    this.wake('search');
    this.wake('download');
  }

  applyState(next: PaceStateFile) {
    if (next.tripLever) {
      this.tripRateLimit(
        next.reason || 'applyState trip',
        undefined,
        next.tripLever,
      );
      return;
    }
    if (typeof next.maxPerWindow === 'number' && next.maxPerWindow >= 1) {
      this.bumpLever('maxPerWindow', Math.floor(next.maxPerWindow));
    }
    const download =
      typeof next.downloadConc === 'number'
        ? next.downloadConc
        : typeof next.conc === 'number'
          ? next.conc
          : null;
    if (download != null && download >= 1) {
      this.bumpLever('downloadConc', Math.floor(download));
    }
    if (typeof next.searchConc === 'number' && next.searchConc >= 1) {
      this.bumpLever('searchConc', Math.floor(next.searchConc));
    }
    if (next.lastGood) {
      this.lastGood = { ...this.lastGood, ...next.lastGood };
    }
    if (next.lastFail) {
      this.lastFail = { ...this.lastFail, ...next.lastFail };
    }
    if (next.reason !== undefined) this.reason = next.reason || null;
    if (next.lastBotAt) this.lastBotAt = next.lastBotAt;
    if (next.lastStepAt) this.lastStepAt = next.lastStepAt;
    if (typeof next.autoStep === 'boolean') this.autoStep = next.autoStep;
    if (Array.isArray(next.downloadStarts)) {
      const t = this.now();
      this.downloadStarts = next.downloadStarts.filter(
        (x) => Number.isFinite(x) && t - x < this.windowMs,
      );
    }
    if (typeof next.coolUntil === 'number') {
      this.coolUntil = Math.max(0, next.coolUntil);
    }
    if (Array.isArray(next.botTimes)) {
      const t = this.now();
      this.botTimes = next.botTimes.filter(
        (x) => Number.isFinite(x) && t - x < this.windowMs,
      );
    }
    this.persistState();
    this.wakeSleeps();
    this.wake('search');
    this.wake('download');
  }

  snapshot(): PaceSnapshot {
    this.loadState(false);
    this.maybeStep();
    const t = this.now();
    this.downloadStarts = this.downloadStarts.filter(
      (x) => t - x < this.windowMs,
    );
    this.botTimes = this.botTimes.filter((x) => t - x < this.windowMs);
    return {
      conc: this.downloadConc,
      searchConc: this.searchConc,
      downloadConc: this.downloadConc,
      active: this.searchActive + this.downloadActive,
      searchActive: this.searchActive,
      downloadActive: this.downloadActive,
      maxPerWindow: this.maxPerWindow,
      downloadsInWindow: this.downloadStarts.length,
      windowMs: this.windowMs,
      coolUntil: this.coolUntil,
      coolRemainingMs: Math.max(0, this.coolUntil - t),
      lastBotAt: this.lastBotAt,
      botsInWindow: this.botTimes.length,
      reason: this.reason,
      lastGood: { ...this.lastGood },
      lastFail: { ...this.lastFail },
      autoStep: this.autoStep,
    };
  }

  async run<T>(
    kind: PaceKind,
    fn: () => Promise<T>,
    successUnits: number | ((result: T) => number) = 1,
    startUnits = 1,
  ): Promise<T> {
    this.loadState(false);
    this.maybeStep();
    const requestedStartUnits = Number.isFinite(startUnits)
      ? Math.max(1, Math.floor(startUnits))
      : 1;
    for (;;) {
      await this.sleepReady(kind, requestedStartUnits);
      await this.acquire(kind);
      const t0 = this.now();
      if (kind === 'download' && requestedStartUnits > this.maxPerWindow) {
        this.release(kind);
        throw new Error(
          `Download batch of ${requestedStartUnits} exceeds window limit ${this.maxPerWindow}`,
        );
      }
      // Several workers can all pass sleepReady before the first one acquires
      // the final slot. Revalidate after acquisition so a bot cooldown, a
      // newly filled window, or the previous job's courtesy gap cannot be
      // bypassed by waiters already queued in acquire().
      if (this.mustYieldAfterAcquire(kind, t0, requestedStartUnits)) {
        this.release(kind);
        continue;
      }
      if (kind === 'download') {
        this.downloadStarts = this.downloadStarts.filter(
          (x) => t0 - x < this.windowMs,
        );
        if (
          this.downloadStarts.length + requestedStartUnits >
          this.maxPerWindow
        ) {
          this.release(kind);
          continue;
        }
        for (let i = 0; i < requestedStartUnits; i += 1) {
          this.downloadStarts.push(t0);
          this.emit('download_start');
        }
        this.persistState();
      }
      try {
        const result = await fn();
        const requestedUnits =
          typeof successUnits === 'function'
            ? successUnits(result)
            : successUnits;
        const units = Number.isFinite(requestedUnits)
          ? Math.max(0, Math.floor(requestedUnits))
          : 0;
        for (let i = 0; i < units; i += 1) {
          if (kind === 'download') this.emit('download_ok');
          if (kind === 'search') this.emit('search_ok');
        }
        if (units > 0) this.noteSuccess(kind);
        return result;
      } finally {
        this.lastEnd = this.now();
        this.release(kind);
      }
    }
  }

  private mustYieldAfterAcquire(
    kind: PaceKind,
    t: number,
    startUnits = 1,
  ): boolean {
    const minGap = kind === 'search' ? this.searchMin : this.downloadMin;
    if (t < this.coolUntil || t < this.lastEnd + minGap) return true;
    if (kind !== 'download') return false;
    this.downloadStarts = this.downloadStarts.filter(
      (started) => t - started < this.windowMs,
    );
    return this.downloadStarts.length + startUnits > this.maxPerWindow;
  }

  /** Courtesy gap + cool-off + window wait, without holding a slot. */
  private async sleepReady(kind: PaceKind, startUnits = 1) {
    const gap =
      kind === 'search'
        ? jitter(this.searchMin, this.searchMax)
        : jitter(this.downloadMin, this.downloadMax);
    for (;;) {
      const t0 = this.now();
      let wait = Math.max(0, this.lastEnd + gap - t0, this.coolUntil - t0);
      if (kind === 'download') {
        if (startUnits > this.maxPerWindow) {
          throw new Error(
            `Download batch of ${startUnits} exceeds window limit ${this.maxPerWindow}`,
          );
        }
        this.downloadStarts = this.downloadStarts.filter(
          (x) => t0 - x < this.windowMs,
        );
        if (this.downloadStarts.length + startUnits > this.maxPerWindow) {
          const overflow =
            this.downloadStarts.length + startUnits - this.maxPerWindow;
          const blocking = this.downloadStarts[overflow - 1];
          wait = Math.max(wait, blocking + this.windowMs - t0);
        }
      }
      if (wait <= 0) return;
      await this.sleepOrStateChange(wait);
    }
  }

  /**
   * Manual pace changes must interrupt workers sleeping on the previous
   * window/cooldown. Otherwise raising an 8-per-window cap can leave all Bull
   * workers idle until the old ten-minute timer expires.
   */
  private sleepOrStateChange(ms: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.sleepWaiters.delete(onStateChange);
        resolve();
      };
      const onStateChange = () => finish();
      this.sleepWaiters.add(onStateChange);
      void this.sleep(ms).then(finish, (error) => {
        if (settled) return;
        settled = true;
        this.sleepWaiters.delete(onStateChange);
        reject(error);
      });
    });
  }

  private wakeSleeps() {
    const waiters = [...this.sleepWaiters];
    this.sleepWaiters.clear();
    for (const wake of waiters) wake();
  }

  private acquire(kind: PaceKind): Promise<void> {
    const cap = kind === 'search' ? this.searchConc : this.downloadConc;
    const active = kind === 'search' ? this.searchActive : this.downloadActive;
    if (active < cap && this.hasTotalCapacity()) {
      this.bumpActive(kind, 1);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const q = kind === 'search' ? this.searchWaiters : this.downloadWaiters;
      q.push(() => {
        this.bumpActive(kind, 1);
        resolve();
      });
    });
  }

  private release(kind: PaceKind) {
    this.bumpActive(kind, -1);
    this.wake(kind);
    this.wake(kind === 'download' ? 'search' : 'download');
  }

  private bumpActive(kind: PaceKind, delta: number) {
    if (kind === 'search') {
      this.searchActive = Math.max(0, this.searchActive + delta);
    } else {
      this.downloadActive = Math.max(0, this.downloadActive + delta);
    }
  }

  private wake(kind: PaceKind) {
    const cap = kind === 'search' ? this.searchConc : this.downloadConc;
    const q = kind === 'search' ? this.searchWaiters : this.downloadWaiters;
    while (q.length) {
      const active =
        kind === 'search' ? this.searchActive : this.downloadActive;
      if (active >= cap || !this.hasTotalCapacity()) break;
      const next = q.shift();
      if (next) next();
    }
  }

  private hasTotalCapacity(): boolean {
    // Emergency floor means ONE total yt-dlp process, not one of each kind.
    const floor = this.downloadConc <= 1 && this.searchConc <= 1 && this.maxPerWindow <= 8;
    return !floor || this.searchActive + this.downloadActive < 1;
  }

  private getLever(lever: PaceLever): number {
    if (lever === 'searchConc') return this.searchConc;
    if (lever === 'downloadConc') return this.downloadConc;
    return this.maxPerWindow;
  }

  private setLever(lever: PaceLever, value: number) {
    const n = Math.max(this.floorOf(lever), Math.floor(value));
    if (lever === 'searchConc') this.searchConc = n;
    else if (lever === 'downloadConc') this.downloadConc = n;
    else this.maxPerWindow = n;
  }

  private floorOf(lever: PaceLever): number {
    if (lever === 'maxPerWindow') return this.floorPerWindow;
    return FLOOR[lever] as number;
  }

  private capOf(lever: PaceLever): number {
    return CAP[lever] as number;
  }

  /** Raising a lever keeps last-good at the previously proven value. */
  private bumpLever(lever: PaceLever, next: number) {
    const cur = this.getLever(lever);
    if (next > cur) {
      this.lastGood[lever] = cur;
    }
    this.setLever(lever, next);
  }

  private noteSuccess(kind: PaceKind) {
    const lever = leverFromKind(kind);
    const cur = this.getLever(lever);
    const fail = this.lastFail[lever];
    const good = this.lastGood[lever];
    if (fail != null && good != null && cur > good && cur < fail) {
      this.lastGood[lever] = cur;
      this.persistState();
    }
  }

  /**
   * After a clean interval, probe a frozen lever at the midpoint of last-good
   * and last-fail. Never steps to or past last-fail. Unfrozen levers stay put.
   */
  maybeStep() {
    if (!this.autoStep) return;
    const t = this.now();
    const lastBot = this.lastBotAt || 0;
    const lastStep = this.lastStepAt || 0;
    if (t - lastBot < this.cleanMsToStep) return;
    if (t - lastStep < this.cleanMsToStep) return;
    const order: PaceLever[] = ['downloadConc', 'searchConc', 'maxPerWindow'];
    for (const lever of order) {
      const fail = this.lastFail[lever];
      const good = this.lastGood[lever];
      if (fail == null || good == null) continue;
      const probe = probeMidpoint(good, fail);
      if (probe == null) continue;
      if (probe >= fail) continue;
      if (probe > this.capOf(lever)) continue;
      this.setLever(lever, probe);
      this.lastStepAt = t;
      this.reason = `probe ${lever} ${good}…${fail} → ${probe}`;
      this.persistState();
      this.wakeSleeps();
      this.wake(lever === 'searchConc' ? 'search' : 'download');
      return;
    }
  }

  private loadState(force: boolean) {
    if (!this.statePath) return;
    const t = this.now();
    if (!force && t - this.lastLoad < 5000) return;
    this.lastLoad = t;
    try {
      if (!existsSync(this.statePath)) return;
      const raw = JSON.parse(
        readFileSync(this.statePath, 'utf8'),
      ) as PaceStateFile;
      if (typeof raw.maxPerWindow === 'number' && raw.maxPerWindow >= 1) {
        this.maxPerWindow = Math.floor(raw.maxPerWindow);
      }
      if (typeof raw.floorPerWindow === 'number' && raw.floorPerWindow >= 1) {
        this.floorPerWindow = Math.floor(raw.floorPerWindow);
      }
      const download =
        typeof raw.downloadConc === 'number'
          ? raw.downloadConc
          : typeof raw.conc === 'number'
            ? raw.conc
            : null;
      if (download != null && download >= 1) {
        this.downloadConc = Math.floor(download);
      }
      if (typeof raw.searchConc === 'number' && raw.searchConc >= 1) {
        this.searchConc = Math.floor(raw.searchConc);
      }
      if (raw.lastGood) this.lastGood = { ...this.lastGood, ...raw.lastGood };
      if (raw.lastFail) this.lastFail = { ...this.lastFail, ...raw.lastFail };
      if (raw.reason !== undefined) this.reason = raw.reason || null;
      if (typeof raw.lastBotAt === 'number') this.lastBotAt = raw.lastBotAt;
      if (typeof raw.lastStepAt === 'number') this.lastStepAt = raw.lastStepAt;
      if (typeof raw.autoStep === 'boolean') this.autoStep = raw.autoStep;
      if (Array.isArray(raw.downloadStarts)) {
        this.downloadStarts = raw.downloadStarts.filter(
          (x) => Number.isFinite(x) && t - x < this.windowMs,
        );
      }
      if (typeof raw.coolUntil === 'number') {
        this.coolUntil = Math.max(0, raw.coolUntil);
      }
      if (Array.isArray(raw.botTimes)) {
        this.botTimes = raw.botTimes.filter(
          (x) => Number.isFinite(x) && t - x < this.windowMs,
        );
      }
    } catch {
      /* keep in-memory values */
    }
  }

  private persistState() {
    if (!this.statePath) return;
    try {
      mkdirSync(dirname(this.statePath), { recursive: true });
      let prev: PaceStateFile = {};
      if (existsSync(this.statePath)) {
        try {
          prev = JSON.parse(
            readFileSync(this.statePath, 'utf8'),
          ) as PaceStateFile;
        } catch {
          prev = {};
        }
      }
      const next: PaceStateFile = {
        ...prev,
        maxPerWindow: this.maxPerWindow,
        conc: this.downloadConc,
        downloadConc: this.downloadConc,
        searchConc: this.searchConc,
        floorPerWindow: this.floorPerWindow,
        lastBotAt: this.lastBotAt,
        lastStepAt: this.lastStepAt,
        lastGood: { ...this.lastGood },
        lastFail: { ...this.lastFail },
        reason: this.reason,
        autoStep: this.autoStep,
        downloadStarts: this.downloadStarts.filter(
          (x) => this.now() - x < this.windowMs,
        ),
        coolUntil: this.coolUntil,
        botTimes: this.botTimes.filter((x) => this.now() - x < this.windowMs),
      };
      writeFileSync(this.statePath, JSON.stringify(next, null, 2) + '\n');
    } catch {
      /* ignore */
    }
  }

  private emit(type: string, detail?: string) {
    if (!this.eventsPath) return;
    try {
      mkdirSync(dirname(this.eventsPath), { recursive: true });
      appendFileSync(
        this.eventsPath,
        JSON.stringify({ t: this.now(), type, detail: detail || null }) + '\n',
      );
    } catch {
      /* ignore */
    }
  }
}
