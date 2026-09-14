#!/usr/bin/env node
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acquisitionEvents, acquisitionStatus, progressEta } from './acquire/report.mjs';
import { songKey as trackFileKey } from './acquire/catalog.mjs';

const require = createRequire(import.meta.url);
const sqlite3 = require("sqlite3");
const { Queue } = require("bullmq");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ACQUIRE_DIR = process.env.ACQUIRE_STATE_PATH || join(ROOT, 'data/acquire');
const DB_PATH = process.env.DB_PATH || join(ROOT, "data/spooty.sqlite");
const DOWNLOADS_PATH = process.env.DOWNLOADS_PATH || join(ROOT, "downloads");
const EVENTS_PATH =
  process.env.YT_PACE_EVENTS_PATH ||
  join(ROOT, "src/backend/config/yt-events.jsonl");
const SNAPSHOT_PATH =
  process.env.YT_PROGRESS_SNAPSHOT_PATH ||
  join(ROOT, "src/backend/config/yt-progress-last.json");
const API = process.env.YT_PACE_API || "http://127.0.0.1:3000/api/youtube/pace";
const WRITE = process.argv.includes("--write");
const now = Date.now();

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);
const all = (sql) =>
  new Promise((resolveRows, reject) => {
    db.all(sql, (error, rows) => (error ? reject(error) : resolveRows(rows)));
  });

const statusRows = await all(`
  SELECT status, COUNT(*) rows, COUNT(DISTINCT artist||'|'||name) unique_tracks
  FROM track_entity GROUP BY status ORDER BY status
`);
const trackRows = await all(
  `SELECT artist, name, status, youtubeUrl, error FROM track_entity`,
);
await new Promise((resolveClose) => db.close(resolveClose));

const events = existsSync(EVENTS_PATH)
  ? readFileSync(EVENTS_PATH, "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      })
  : [];
events.push(...acquisitionEvents(ACQUIRE_DIR));

function windowStats(minutes) {
  const recent = events.filter((event) => event.t >= now - minutes * 60_000);
  const downloads = recent.filter(
    (event) => event.type === "download_ok",
  ).length;
  const starts = recent.filter(
    (event) => event.type === "download_start",
  ).length;
  const confirmedBots = recent.filter(
    (event) =>
      event.type === "bot" &&
      !/unable to download video data:\s*http error 403/i.test(
        String(event.detail || ""),
      ),
  );
  return {
    minutes,
    downloadStart: starts,
    downloadOk: downloads,
    mp3PerMin: downloads / minutes,
    // Start events were introduced after completion events and a window can
    // also contain a completion whose admission fell just before its edge.
    // Never publish an impossible ratio from incomparable coverage.
    verifiedPerStart:
      starts > 0 && downloads <= starts ? downloads / starts : null,
    searchOk: recent.filter((event) => event.type === "search_ok").length,
    bots: confirmedBots.length,
  };
}

function eta(rate, remaining) {
  return progressEta(rate, remaining, acquisition, now);
}

function overallStats() {
  const oks = events.filter(
    (event) => event.type === "download_ok" && Number.isFinite(event.t),
  );
  if (!oks.length) return null;
  const startedAt = oks.reduce(
    (min, event) => (event.t < min ? event.t : min),
    oks[0].t,
  );
  const elapsedMs = Math.max(0, now - startedAt);
  const elapsedMin = elapsedMs / 60_000;
  return {
    startedAt: new Date(startedAt).toISOString(),
    elapsedHours: elapsedMs / 3_600_000,
    downloadOk: oks.length,
    mp3PerMin: elapsedMin > 0 ? oks.length / elapsedMin : null,
  };
}

const seenInodes = new Set();
const audioKeys = new Set();
const audioFiles = [];
let uniqueBytes = 0;
let mp3Paths = 0;
const pendingDirs = [DOWNLOADS_PATH];
while (pendingDirs.length) {
  const dir = pendingDirs.pop();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      pendingDirs.push(path);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".mp3")) {
      mp3Paths += 1;
      audioKeys.add(entry.name.slice(0, -4).toLowerCase());
      const stat = statSync(path);
      const inode = `${stat.dev}:${stat.ino}`;
      audioFiles.push({ key: entry.name.slice(0, -4).toLowerCase(), inode, size: stat.size });
      if (!seenInodes.has(inode)) {
        seenInodes.add(inode);
        uniqueBytes += stat.size;
      }
    }
  }
}

const expectedKeys = new Set(
  trackRows.map((row) => trackFileKey(row.artist, row.name)),
);
const savedExpectedKeys = new Set(
  [...audioKeys].filter((key) => expectedKeys.has(key)),
);
const savedExpectedInodes = new Set();
let savedExpectedBytes = 0;
for (const file of audioFiles) {
  if (
    expectedKeys.has(file.key) &&
    !savedExpectedInodes.has(file.inode)
  ) {
    savedExpectedInodes.add(file.inode);
    savedExpectedBytes += file.size;
  }
}

const youtubeByKey = new Map();
for (const row of trackRows) {
  const key = trackFileKey(row.artist, row.name);
  const state = youtubeByKey.get(key) || {
    found: false,
    noResult: false,
    temporary: false,
    searching: false,
  };
  const error = String(row.error || '').trim();
  state.found ||= !!String(row.youtubeUrl || '').trim();
  state.noResult ||= /^no youtube result$/i.test(error);
  state.temporary ||= !!error && !/^no youtube result$/i.test(error);
  state.searching ||= row.status === 1;
  youtubeByKey.set(key, state);
}
const youtubeFound = [...youtubeByKey.values()].filter((x) => x.found).length;
const youtubeNoResult = [...youtubeByKey.values()].filter(
  (x) => !x.found && x.noResult,
).length;
const youtubeTemporary = [...youtubeByKey.values()].filter(
  (x) => !x.found && !x.noResult && x.temporary,
).length;
const youtubeSearching = [...youtubeByKey.values()].filter(
  (x) => !x.found && !x.noResult && !x.temporary && x.searching,
).length;
const youtubeResolved = youtubeFound + youtubeNoResult;
const youtubeAttempted = youtubeResolved + youtubeTemporary;

const openKeys = new Set(
  trackRows
    .filter((row) => [0, 1, 2, 3, 6].includes(row.status))
    .map((row) => trackFileKey(row.artist, row.name)),
);
const remainingKeys = new Set(
  [...openKeys].filter((key) => !audioKeys.has(key)),
);

const connection = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT || 6379),
};
const queues = {};
let cliOwner = null;
for (const name of ["track-download-processor", "track-search-processor"]) {
  const queue = new Queue(name, { connection });
  if (name === 'track-download-processor') cliOwner = await (await queue.client).get('spooty:acquire:owner');
  const counts = await queue.getJobCounts(
    "waiting",
    "active",
    "paused",
    "delayed",
    "failed",
  );
  queues[name] = {
    isPaused: await queue.isPaused(),
    counts,
  };
  await queue.close();
}
const acquisition = acquisitionStatus(ACQUIRE_DIR, cliOwner);

let pace = null;
try {
  const response = await fetch(API);
  if (response.ok) pace = await response.json();
} catch {
  // Report local state even if Nest is restarting.
}

let libraryTotals = null;
try {
  const response = await fetch('http://127.0.0.1:3000/api/library');
  if (response.ok) libraryTotals = (await response.json()).totals || null;
} catch {
  // The unique-song report remains available while Nest is restarting.
}

let previous = null;
try {
  previous = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
} catch {
  // No prior report yet.
}

const windows = Object.fromEntries(
  [10, 30, 60, 120].map((minutes) => [minutes, windowStats(minutes)]),
);
const overall = overallStats();
const remaining = remainingKeys.size;
const uniqueStillToSave = expectedKeys.size - savedExpectedKeys.size;
const averageSavedBytes = savedExpectedKeys.size
  ? savedExpectedBytes / savedExpectedKeys.size
  : null;
const estimatedFinalBytes = averageSavedBytes
  ? uniqueBytes + uniqueStillToSave * averageSavedBytes
  : null;
const report = {
  t: new Date(now).toISOString(),
  t_ms: now,
  unique_remaining: remaining,
  unique_open_rows: openKeys.size,
  locally_reusable_open: openKeys.size - remaining,
  files: {
    uniqueSaved: savedExpectedKeys.size,
    uniqueTotal: expectedKeys.size,
    uniqueStillToSave,
    uniquePercent: expectedKeys.size
      ? (savedExpectedKeys.size / expectedKeys.size) * 100
      : 0,
    occurrenceSaved: libraryTotals?.onDisk ?? null,
    occurrenceTotal: libraryTotals?.tracks ?? null,
    occurrencePercent: libraryTotals?.tracks
      ? (libraryTotals.onDisk / libraryTotals.tracks) * 100
      : null,
  },
  youtube: {
    found: youtubeFound,
    confirmedNoResult: youtubeNoResult,
    temporaryUnresolved: youtubeTemporary,
    searchingNow: youtubeSearching,
    resolved: youtubeResolved,
    attempted: youtubeAttempted,
    resolvedFindPercent: youtubeResolved
      ? (youtubeFound / youtubeResolved) * 100
      : null,
    conservativeAttemptSuccessPercent: youtubeAttempted
      ? (youtubeFound / youtubeAttempted) * 100
      : null,
    attemptedCoveragePercent: expectedKeys.size
      ? (youtubeAttempted / expectedKeys.size) * 100
      : null,
  },
  status: Object.fromEntries(
    statusRows.map((row) => [
      String(row.status),
      { rows: row.rows, unique: row.unique_tracks },
    ]),
  ),
  windows,
  overall,
  trend_vs_previous_30:
    previous && typeof previous.mp3_per_min_30 === "number"
      ? windows[30].mp3PerMin - previous.mp3_per_min_30
      : null,
  eta_60: eta(windows[60].mp3PerMin, remaining),
  eta_30: eta(windows[30].mp3PerMin, remaining),
  eta_120: eta(windows[120].mp3PerMin, remaining),
  eta_overall: eta(overall?.mp3PerMin, remaining),
  eta_basis: acquisition?.liveOwnerVerified
    ? "Historical window rates, limited by the current CLI profile and admission cap; recovery wait included"
    : "Historical window rates",
  disk: {
    uniqueInodes: seenInodes.size,
    uniqueBytes,
    uniqueGB: uniqueBytes / 1_000_000_000,
    estimatedFinalGB:
      estimatedFinalBytes == null ? null : estimatedFinalBytes / 1_000_000_000,
    averageSavedMB:
      averageSavedBytes == null ? null : averageSavedBytes / 1_000_000,
    paths: mp3Paths,
  },
  queues,
  pace,
  acquisition,
};

console.log(JSON.stringify(report, null, 2));

if (WRITE) {
  const snapshot = {
    t: report.t,
    t_ms: report.t_ms,
    unique_remaining: remaining,
    obs_per_hour: windows[30].mp3PerMin * 60,
    mp3_per_min_10: windows[10].mp3PerMin,
    mp3_per_min_30: windows[30].mp3PerMin,
    mp3_per_min_60: windows[60].mp3PerMin,
    mp3_per_min_120: windows[120].mp3PerMin,
    mp3_per_min_overall: overall?.mp3PerMin ?? null,
    overall_started_at: overall?.startedAt ?? null,
    download_ok_10: windows[10].downloadOk,
    download_ok_30: windows[30].downloadOk,
    download_ok_60: windows[60].downloadOk,
    download_ok_120: windows[120].downloadOk,
    download_start_10: windows[10].downloadStart,
    download_start_30: windows[30].downloadStart,
    download_start_120: windows[120].downloadStart,
    eta_utc: report.eta_30?.at || null,
    eta_hours: report.eta_30?.hours || null,
    representative_eta_utc: report.eta_120?.at || null,
    unique_GB: report.disk.uniqueGB,
    unique_inodes: report.disk.uniqueInodes,
    unique_saved: report.files.uniqueSaved,
    unique_total: report.files.uniqueTotal,
    estimated_final_GB: report.disk.estimatedFinalGB,
    youtube_resolved_find_percent: report.youtube.resolvedFindPercent,
    downloadConc: pace?.downloadConc ?? null,
    searchConc: pace?.searchConc ?? null,
    maxPerWindow: pace?.maxPerWindow ?? null,
    queuesPaused:
      queues["track-download-processor"].isPaused &&
      queues["track-search-processor"].isPaused,
    lastBotAt: pace?.lastBotAt ?? null,
  };
  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
}
