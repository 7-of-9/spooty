#!/usr/bin/env node
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  appendFileSync,
  statfsSync,
  statSync,
} from "node:fs";
import {
  catalog,
  database,
  summary,
  scanAudio,
  eta,
  nonempty,
  mergeAdmissions,
  sourceJournal,
} from "./acquire/catalog.mjs";
import { publishMp3ForTrack, materializeForTrack, mediaFingerprint, bestEffortPaceMirror } from "./acquire/publication.mjs";
import { assertClientCompatibility } from "./acquire/client-policy.mjs";
import { pacedEta, acquisitionBenchmark, acquisitionMetrics } from "./acquire/report.mjs";
import { createDurationResolver } from './acquire/spotify-duration.mjs';
import { DurationCandidates, assertDuration, DURATION_REJECTED, DURATION_NO_CANDIDATE } from './acquire/duration-policy.mjs';
import { candidateLimits, recordCandidateOutcome, isNetworkFailure, networkFailureState, preparedSearchBufferSize, readyDownloadCandidates } from './acquire/candidate-policy.mjs';
import { recordDurationReplacement } from './acquire/duration-repair-ledger.mjs';
import { SourceReviewIndex } from './acquire/review-identity.mjs';
import { parseCommandLine, helpText } from './acquire/cli-options.mjs';
import { resumedSong, resumePlan, readJournal } from './acquire/resume-state.mjs';
import { verifyLiveOwner, controlForOwner, controlMatchesRun } from './acquire/live-control.mjs';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { downloadSettingsPath, resolveDownloadLocation } = require('../src/backend/src/shared/acquisition/download-location.ts');
const dbPath = resolve(process.env.DB_PATH || join(ROOT, 'data/spooty.sqlite'));
const downloadLocation = () => resolveDownloadLocation(
  process.env.DOWNLOADS_PATH || join(ROOT, 'downloads'), downloadSettingsPath(dbPath),
).path;
const stateDir = resolve(
  process.env.ACQUIRE_STATE_PATH || join(ROOT, "data/acquire"),
);
const paths = {
  root: ROOT,
  state: stateDir,
  playlists: resolve(
    process.env.STATIC_PLAYLISTS_PATH ||
      join(ROOT, "PLAYLISTS_2026-09-08/playlists"),
  ),
  downloads: downloadLocation(),
  dbPath,
  cookies: resolve(process.env.COOKIES_PATH || join(ROOT, "cookies.txt")),
  pace: join(stateDir, "pace.json"),
  paceEvents: join(stateDir, "pace-events.jsonl"),
  temp: join(stateDir, "temp"),
  control: join(stateDir, "control.json"),
  status: join(stateDir, "status.json"),
  journal: join(stateDir, "work.sqlite"),
  webPace: join(ROOT, "src/backend/config/yt-pace.json"),
};
const API = process.env.ACQUIRE_API_URL || "http://127.0.0.1:3000/api/youtube/pace";
const sleep = (ms) => new Promise((yes) => setTimeout(yes, ms));
const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};
const atomic = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(temp, path);
};
const output = (value) => console.log(JSON.stringify(value));

let options;
function number(name, fallback, min = 0, max = 1000000) {
  const value = Number(options[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`Invalid --${name}`);
  return value;
}
async function api(body) {
  const response = await fetch(API, {
    signal: AbortSignal.timeout(5000),
    ...(body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok) throw new Error("Backend pace API unavailable");
  return response.json();
}
function paceControl() {
  const result = {};
  for (const [arg, key, max] of [
    ["download-conc", "downloadConc", 12],
    ["search-conc", "searchConc", 6],
    ["window", "maxPerWindow", 240],
  ]) {
    if (options[arg] !== undefined)
      result[key] = number(arg, 1, arg === "window" ? 8 : 1, max);
  }
  return result;
}

async function run() {
  const { maxSearches, networkRetries } = candidateLimits(options);
  if (process.versions.node.split(".")[0] !== "20")
    throw new Error("Run with Node 20.19.4 (see ACQUIRE.md)");
  const limit = number("limit", 0),
    minutes = number("minutes", 0),
    batchSize = number("batch-size", 8, 1, 8),
    searchBuffer = number("search-buffer", 192, 1);
  const profile = paceControl();
  // Validate before taking a lease, pausing queues or writing any run state.
  assertClientCompatibility(join(ROOT, "node_modules/ytdlp-nodejs/bin/yt-dlp_macos"));
  if (options.authenticated) {
    let available = false;
    try { const info = statSync(paths.cookies); available = info.isFile() && info.size > 0; } catch {}
    if (!available) throw new Error("Authenticated recovery requires a nonempty cookie export; no queues or track states were changed");
  }
  const { Queue } = require("bullmq");
  const connection = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
  };
  const queues = ["track-download-processor", "track-search-processor"].map(
    (name) => new Queue(name, { connection }),
  );
  const redis = await queues[0].client;
  const owner = `${process.pid}-${randomUUID()}`,
    lock = "spooty:acquire:owner";
  if ((await redis.set(lock, owner, "EX", 60, "NX")) !== "OK") {
    await Promise.all(queues.map((q) => q.close()));
    throw new Error(
      "Another acquisition runner owns the queue. Use status or stop.",
    );
  }
  mkdirSync(stateDir, { recursive: true });
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const eventPath = join(stateDir, `events-${runId}.jsonl`);
  const previousHandoff = readJson(join(stateDir, "handoff.json"));
  const previousPace = readJson(paths.pace);
  const emit = (type, detail = {}) =>
    appendFileSync(
      eventPath,
      JSON.stringify({ t: Date.now(), type, ...detail }) + "\n",
      { mode: 0o600 },
    );
  let transport,
    journal,
    db,
    original = [],
    changedQueues = false,
    stopping = false,
    ownershipLost = false;
  let guardError = null,
    guardBusy = false,
    guard;
  let c,
    songs,
    start,
    saved = 0,
    searches = 0,
    reused = 0,
    retryCount = 0,
    networkRetryCount = 0,
    operationRetryCount = 0,
    candidateRejectedCount = 0,
    lastReport = 0,
    lastControl = 0;
  let reviewPending = [], reviewReserved = 0, reviewCompleted = 0, reviewErrors = 0;
  let reviewSelection = null;
  let reviewWork;
  const savedTimes = [],
    tasks = new Set();
  const active = { search: 0, download: 0 };
  const signal = () => {
    if (stopping) {
      if (transport) {
        transport.stopping = true;
        transport.killChildren();
      }
    }
    stopping = true;
    transport?.stopAdmissions();
  };
  process.on("SIGINT", signal);
  process.on("SIGTERM", signal);
  async function mirrorPace() {
    const state = readJson(paths.pace);
    if (!state) return;
    // Backend workers are drained. Hand admission history/cooldown back before
    // they resume so a CLI run cannot reset the ten-minute accounting window.
    await api({ ...state, autoStep: false });
  }
  const mirrorWhileOwned = bestEffortPaceMirror(mirrorPace, emit);
  async function checkpoint(song) {
    await journal.run(
      `INSERT INTO work(key,url,state,attempts,retry_at,error,network_attempts,search_limit) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET url=excluded.url,state=excluded.state,attempts=excluded.attempts,retry_at=excluded.retry_at,error=excluded.error,network_attempts=excluded.network_attempts,search_limit=excluded.search_limit`,
      [
        song.key,
        song.url,
        song.state,
        song.attempts || 0,
        song.retryAt || 0,
        song.error || null,
        song.networkAttempts || 0,
        song.searchLimit || 0,
      ],
    );
  }
  async function reconcile(song, status, error = null) {
    if (!song.rowIds.length) return;
    await db.run(
      `UPDATE track_entity SET status=?,error=?,youtubeUrl=COALESCE(?,youtubeUrl) WHERE id IN (${song.rowIds.map(() => "?").join(",")}) AND (status<>? OR error IS NOT ? OR youtubeUrl IS NOT COALESCE(?,youtubeUrl))`,
      [status, error, song.url, ...song.rowIds, status, error, song.url],
    );
  }
  async function report(final = false) {
    const now = Date.now(),
      elapsed = start ? (now - start) / 60000 : 0;
    const rate = elapsed > 0 ? saved / elapsed : 0;
    const disk = scanAudio(paths.downloads);
    const remaining =
      songs?.filter(
        (s) =>
          !(s.source && nonempty(s.source)) &&
          s.state !== "missing",
      ).length ?? null;
    const recent = (minutesBack) =>
      savedTimes.filter((t) => t > now - minutesBack * 60000).length /
      Math.min(minutesBack, elapsed || minutesBack);
    const recoveryWait = transport?.recoveryWaitMs(now) || 0;
    const reportedPace = transport?.pace.snapshot();
    const savedUnique = songs?.filter(song => song.source && nonempty(song.source)).length || 0;
    const notSaved = (songs?.length || 0) - savedUnique;
    const actionable = songs?.filter(song => ['ready', 'pending', 'searching', 'downloading'].includes(song.state) &&
      (!options['search-only'] || !song.url)).length || 0;
    const result = {
      runId,
      pid: process.pid,
      phase: final
        ? notSaved === 0
          ? "complete"
          : actionable === 0 ? "finished-with-exceptions" : "stopped"
        : stopping
          ? "draining"
          : recoveryWait
            ? "waiting-for-recovery"
            : start
              ? "running"
              : "handoff",
      at: new Date(now).toISOString(),
      elapsedMinutes: elapsed,
      verifiedNewMp3: saved,
      searched: searches,
      localReused: reused,
      retries: retryCount,
      networkRetries: networkRetryCount,
      operationRetries: operationRetryCount,
      candidateDisqualifications: candidateRejectedCount + (songs || []).reduce((n, song) => n + (song.searchDisqualified || 0), 0),
      noAcceptableCandidate: songs?.filter(song => song.state === 'no-candidate').length || 0,
      maxSearches,
      networkRetryLimit: networkRetries,
      mp3PerMinute: rate,
      baselineMp3PerMinute: 3,
      baselineMultiple: rate / 3,
      improvementPercent: (rate / 3 - 1) * 100,
      last10Mp3PerMinute: recent(10),
      last30Mp3PerMinute: recent(30),
      remainingUnique: remaining,
      actionableUnique: actionable,
      savedUnique,
      notSavedUnique: notSaved,
      totalUnique: songs?.length || 0,
      confirmedMissing: songs?.filter(song => song.state === 'missing').length || 0,
      eta: pacedEta(
        remaining,
        rate,
        {
          ...reportedPace,
          coolRemainingMs: Math.max(
            reportedPace?.coolRemainingMs || 0,
            recoveryWait,
          ),
        },
        now,
      ),
      diskGB: disk.gb,
      uniqueInodes: disk.uniqueInodes,
      activeBatches: { ...active },
      actualYtdlpProcesses: transport?.children.size || 0,
      sourceReview: { pending: reviewPending.length, completed: reviewCompleted, errors: reviewErrors, selection: reviewSelection },
      reviewWork: reviewWork?.snapshot() || null,
      durationGuard: 'spotify-v1',
      searchBuffer,
      pace: transport?.pace.snapshot() || null,
      retryExhausted: songs?.filter((s) => s.state === "error").length || 0,
      recoveryCookiesAvailable: transport?.recoveryCookiesAvailable() ?? null,
      recoveryWaitMs: recoveryWait,
      eventFile: eventPath,
    };
    Object.assign(result, acquisitionMetrics(stateDir, result));
    if (final) {
      result.eta = null;
      result.etaAtAdmissionCeiling = null;
      result.etaScope = actionable === 0 ? 'Run finished; any remaining exceptions are parked, with no scheduled acquisition' : 'Run stopped; remaining work has no active completion estimate';
    }
    if (final && remaining === 0 && result.completionBlockedByContentReview) {
      result.phase = "content-review-needed";
      result.throughputState = result.phase;
    }
    atomic(paths.status, result);
    output(result);
    lastReport = now;
    return result;
  }
  try {
    // Re-read under the exclusive lease: the UI cannot switch folders mid-run.
    paths.downloads = downloadLocation();
    if (
      previousHandoff &&
      previousHandoff.phase !== "returned" &&
      previousHandoff.pid
    ) {
      let alive = false;
      try {
        process.kill(previousHandoff.pid, 0);
        alive = true;
      } catch {}
      if (alive)
        throw new Error(
          "The previous CLI process still exists; refusing a second owner even though its Redis lease expired",
        );
    }
    guard = setInterval(async () => {
      if (guardBusy) return;
      guardBusy = true;
      try {
        const owned = await redis.eval(
          "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('expire',KEYS[1],60) else return 0 end",
          1,
          lock,
          owner,
        );
        if (!owned) {
          ownershipLost = true;
          throw new Error("Acquisition lease lost");
        }
        if (
          start &&
          !(await Promise.all(queues.map((q) => q.isPaused()))).every(Boolean)
        )
          throw new Error("Web queue was resumed externally");
      } catch (e) {
        guardError = e;
        stopping = true;
        if (transport) {
          transport.stopping = true;
          transport.killChildren();
        }
      } finally {
        guardBusy = false;
      }
    }, 5000);
    original = await Promise.all(
      queues.map(async (q) => ({
        name: q.name,
        paused: await q.isPaused(),
        counts: await q.getJobCounts("active", "waiting", "delayed", "paused"),
      })),
    );
    if (
      original.some(
        (q) => !q.paused && Object.values(q.counts).some((n) => n > 0),
      ) &&
      !options.takeover
    )
      throw new Error(
        "Live web queue found. --takeover requires authorized graceful handoff; no work was changed.",
      );
    await api(); // Establish the return path before changing admission.
    if (previousHandoff && previousHandoff.phase !== "returned") {
      original = original.map((q) => ({
        ...q,
        paused:
          previousHandoff.original?.find((p) => p.name === q.name)?.paused ??
          q.paused,
      }));
    }
    atomic(join(stateDir, "handoff.json"), {
      runId,
      pid: process.pid,
      original,
      phase: "draining",
      at: Date.now(),
    });
    changedQueues = true;
    await Promise.all(queues.map((q) => q.pause()));
    const drainDeadline = Date.now() + 20 * 60000;
    while (
      (await Promise.all(queues.map((q) => q.getActiveCount()))).some(Boolean)
    ) {
      if (guardError) throw guardError;
      if (stopping) return;
      if (Date.now() > drainDeadline)
        throw new Error(
          "Existing workers have not drained after 20 minutes; restoring admission without killing jobs",
        );
      if (Date.now() - lastReport > 30000) {
        output({
          phase: "draining-existing-workers",
          at: new Date().toISOString(),
          active: await Promise.all(queues.map((q) => q.getActiveCount())),
        });
        lastReport = Date.now();
      }
      await sleep(1000);
    }
    const live = await api();
    if (live.active)
      throw new Error("Backend yt-dlp work remains active after queue drain");
    const seed = readJson(paths.webPace);
    if (!seed)
      throw new Error("Cannot preserve the current YouTube admission history");
    if (
      previousHandoff &&
      previousHandoff.phase !== "returned" &&
      previousPace
    ) {
      seed.downloadStarts = mergeAdmissions(
        seed.downloadStarts,
        previousPace.downloadStarts,
      );
      seed.botTimes = mergeAdmissions(seed.botTimes, previousPace.botTimes);
      seed.coolUntil = Math.max(
        seed.coolUntil || 0,
        previousPace.coolUntil || 0,
      );
      if ((previousPace.lastBotAt || 0) > (seed.lastBotAt || 0)) {
        seed.lastBotAt = previousPace.lastBotAt;
        seed.searchConc = 1;
        seed.downloadConc = 1;
        seed.maxPerWindow = 8;
      }
    }
    atomic(paths.pace, {
      ...seed,
      ...profile,
      autoStep: false,
      reason: `CLI ${runId}; preserved prior window and cooldown`,
    });
    atomic(paths.control, {});
    const { Transport, verifyMp3, canLaunchYoutubeWork } = await import("./acquire/transport.mjs");
    const resolveDuration = createDurationResolver(process.env.SPOTIFY_TRACK_METADATA_PATH || join(ROOT, 'data/spotify-track-metadata'));
    const durationCandidates = new DurationCandidates(join(stateDir, 'duration-rejections.json'));
    transport = new Transport(paths, options, emit);
    c = await catalog(paths);
    songs = [...c.songs.values()];
    const { ReviewWork } = await import("./acquire/review-work.mjs");
    reviewWork = new ReviewWork(stateDir, c.songs, transport, emit, (error) => {
      guardError = error;
      stopping = true;
    });
    if (options["review-work"]) reviewWork.enqueue(readJson(join(stateDir, "review-work.json")));
    journal = database(paths.journal);
    db = database(paths.dbPath);
    await journal.run(
      "CREATE TABLE IF NOT EXISTS work(key TEXT PRIMARY KEY,url TEXT,state TEXT,attempts INTEGER DEFAULT 0,retry_at INTEGER DEFAULT 0,error TEXT)",
    );
    const workColumns = new Set((await journal.all('PRAGMA table_info(work)')).map(column => column.name));
    for (const name of ['network_attempts', 'search_limit'])
      if (!workColumns.has(name)) await journal.run(`ALTER TABLE work ADD COLUMN ${name} INTEGER DEFAULT 0`);
    const prior = new Map(
      (await journal.all("SELECT * FROM work")).map((r) => [r.key, r]),
    );
    for (const song of songs) {
      Object.assign(song, resumedSong(song, sourceJournal(song, prior), { maxSearches, retryErrors: options['retry-errors'] }));
      if (song.source) {
        const needed = song.destinations.some((p) => !nonempty(p));
        if (needed && !song.sourceVerified) {
          // Historical presence is not permission to copy unknown audio into
          // new occurrences. Hydrate this exact source, then use shared evidence.
          try { await resolveDuration(song); await c.refreshSong(song); }
          catch { song.source = null; }
          if (!song.source || !song.sourceVerified) {
            song.source = null;
            // Losing historical presence must not reopen a parked outcome.
            Object.assign(song, resumedSong(song, sourceJournal(song, prior), { maxSearches, retryErrors: options['retry-errors'] }));
            continue;
          }
        }
        const copies = materializeForTrack(song.source, song.destinations, song, {
          source: song.sourceFingerprint, local: song.localEvidence,
        });
        song.destinations = copies.destinations;
        const old = sourceJournal(song, prior);
        if (old && !['saved', 'done'].includes(old.state)) {
          // A physically present file wins over a stale failure in BOTH stores.
          // If that file later disappears, a false exhausted-error marker must
          // not prevent the normal backfill path.
          song.error = null;
          song.attempts = 0;
          song.networkAttempts = 0;
          song.retryAt = 0;
          await checkpoint(song);
        }
        await reconcile(song, 4);
        if (needed) reused++;
      }
    }
    start = Date.now();
    emit("start", {
      catalog: summary(c),
      profile: transport.pace.snapshot(),
      baseline: 3,
      batchSize,
      searchBuffer,
      maxSearches,
      networkRetryLimit: networkRetries,
    });
    atomic(join(stateDir, "handoff.json"), {
      runId,
      pid: process.pid,
      original,
      phase: "owned",
      at: Date.now(),
    });
    function queueSourceReview() {
      const review = readJson(join(stateDir, "quality-review.json"));
      if (!Array.isArray(review?.entries)) {
        reviewSelection = { checkedAt: new Date().toISOString(), error: 'Missing or invalid quality-review ledger' };
        emit("source_review_error", { error: "Missing or invalid quality-review ledger" });
        return;
      }
      try {
        const index = new SourceReviewIndex(review.entries);
        const { songs: pending, ...details } = index.inspectionPlan(songs);
        reviewPending = pending;
        reviewSelection = { ...details, checkedAt: new Date().toISOString(), error: null };
        emit("source_review_queued", { songs: reviewPending.length, ...details });
      } catch {
        reviewSelection = { checkedAt: new Date().toISOString(), error: 'Invalid or conflicting source review identities; no additional inspections queued' };
        emit("source_review_error", { error: "Invalid or conflicting source review identities; no additional inspections queued" });
      }
    }
    if (options["inspect-review"]) queueSourceReview();
    function launchSourceReview(batch) {
      active.download++;
      reviewReserved += batch.length;
      let admitted = false;
      let task;
      task = (async () => {
        let failures;
        try {
          failures = await transport.inspectSources(batch, async (song, evidence) => {
            const path = join(stateDir, "source-review.json");
            const prior = readJson(path) || { version: 1, entries: {} };
            prior.entries[song.key] = { runId, inspectedAt: new Date().toISOString(), evidence };
            atomic(path, prior);
            reviewCompleted++;
            emit("source_reviewed", { key: song.key, sourceEvidence: evidence });
          }, () => {
            admitted = true;
            reviewReserved -= batch.length;
          });
        } catch (error) {
          const { classify } = await import("./acquire/transport.mjs");
          failures = batch.map((song) => ({ song, error: classify(error.message) }));
        }
        for (const failure of failures) {
          reviewErrors++;
          emit("source_review_error", { key: failure.song.key, error: failure.error });
        }
      })().catch((error) => {
        guardError = error;
        stopping = true;
      }).finally(() => {
        if (!admitted) reviewReserved -= batch.length;
        active.download--;
        tasks.delete(task);
      });
      tasks.add(task);
    }
    async function failure(song, error) {
      // Files committed by a successful streamed member survive sibling errors.
      if (song.state === "saved" || song.state === "missing") return;
      if (error === "CLI admission cancelled") {
        song.state = song.url ? "ready" : "pending";
        await checkpoint(song);
        return; // A cancelled waiter is not another YouTube failure attempt.
      }
      song.error = error;
      if (error === DURATION_REJECTED) {
        const rejectedUrl = song.url;
        durationCandidates.advance(song);
        if (song.rowIds.length) await db.run(
          `UPDATE track_entity SET youtubeUrl=NULL WHERE id IN (${song.rowIds.map(() => '?').join(',')}) AND youtubeUrl=?`,
          [...song.rowIds, rejectedUrl],
        );
        emit('duration_rejected', { key: song.key, rejectedUrl, expectedMs: song.durationMs, nextUrl: song.url });
        candidateRejectedCount++;
        recordCandidateOutcome(song, { coolUntil: transport.pace.snapshot().coolUntil || 0 });
        await checkpoint(song);
        await reconcile(song, 6, song.state === 'no-candidate' ? DURATION_NO_CANDIDATE : 'Selecting the next duration-matched candidate');
        emit('candidate_disqualified', { key: song.key, nextState: song.state, maxSearches });
        return;
      }
      if (error === DURATION_NO_CANDIDATE) {
        recordCandidateOutcome(song, { exhausted: true });
        await checkpoint(song);
        await reconcile(song, 6, DURATION_NO_CANDIDATE);
        emit('candidate_search_exhausted', { key: song.key, maxSearches, resultsExamined: song.durationCandidates?.length || 0 });
        return;
      }
      const networkFailure = isNetworkFailure(error);
      if (networkFailure) song.networkAttempts = (song.networkAttempts || 0) + 1;
      else song.attempts++;
      const failedAttempts = networkFailure ? song.networkAttempts : song.attempts;
      song.cookiesNext =
        /format unavailable|403|requires cookies|Recovery cookies file unavailable/.test(
          error,
        );
      song.state =
        (networkFailure ? networkFailureState(song.networkAttempts, networkRetries) === 'error' : song.attempts >= 5) || error === "Recovery cookies file unavailable"
          ? "error"
          : song.url
            ? "ready"
            : "pending";
      song.retryAt = Math.max(
        Date.now() + Math.min(1800000, 60000 * 2 ** (failedAttempts - 1)),
        transport.pace.snapshot().coolUntil || 0,
      );
      if (song.state !== 'error') {
        retryCount++;
        if (networkFailure) networkRetryCount++; else operationRetryCount++;
      }
      await checkpoint(song);
      await reconcile(
        song,
        song.state === "error" ? 5 : 6,
        `CLI ${song.state === "error" ? "retry exhausted" : "retry scheduled"}: ${error}`,
      );
      emit(song.state === 'error' ? 'failure_exhausted' : 'retry', {
        key: song.key,
        attempt: song.attempts,
        failureKind: networkFailure ? 'network' : 'operation',
        networkAttempt: song.networkAttempts || 0,
        retryAt: song.retryAt,
        error,
      });
    }
    function launch(kind, batch) {
      active[kind]++;
      batch.forEach((s) => {
        s.state = kind === "search" ? "searching" : "downloading";
        s.admitted = false;
      });
      let task;
      task = (async () => {
        let failures;
        try {
          const metadataFailures = [];
          const ready = [];
          await Promise.all(batch.map(async song => {
            try {
              await resolveDuration(song);
              // Previously rejected cached URLs cannot bypass candidate search.
              if (kind === 'download' && !durationCandidates.choose(song, [{ url: song.url, durationSeconds: song.durationMs / 1000 }])) {
                metadataFailures.push({ song, error: DURATION_REJECTED });
              } else ready.push(song);
            } catch { metadataFailures.push({ song, error: 'Spotify source duration unavailable' }); }
          }));
          if (kind === "search")
            failures = ready.length ? await transport.search(ready, async (song, url) => {
              song.url = url;
              song.state = url ? "ready" : "missing";
              song.retryAt = 0;
              // Candidate disqualification never consumes a network/operation retry.
              song.networkAttempts = 0;
              song.error = null;
              await checkpoint(song);
              await reconcile(
                song,
                url ? 2 : 5,
                url ? null : "No YouTube result",
              );
              searches++;
              emit(url ? "search_ok" : "missing", { key: song.key });
            }, durationCandidates) : [];
          else
            failures = ready.length ? await transport.download(
              ready,
              async (song, source, sourceEvidence) => {
                const proof = mediaFingerprint(source);
                const duration = await verifyMp3(source);
                assertDuration(song.durationMs, duration);
                const publication = publishMp3ForTrack(
                  source,
                  song.destinations[0],
                  song,
                  (tags, path) => require("node-id3").write(tags, path),
                  proof,
                );
                const target = publication.path;
                const newlyPublished = publication.created;
                song.destinations[0] = target;
                const copies = materializeForTrack(target, song.destinations, song, { local: song.localEvidence });
                song.destinations = copies.destinations;
                song.source = target;
                song.state = "saved";
                song.error = null;
                song.attempts = 0;
                song.networkAttempts = 0;
                song.retryAt = 0;
                await checkpoint(song);
                await reconcile(song, 4);
                try { recordDurationReplacement(join(stateDir, 'quality-review.json'), song, duration); }
                catch { emit('duration_repair_ledger_deferred', { key: song.key }); }
                if (newlyPublished) {
                  saved++;
                  savedTimes.push(Date.now());
                  emit("mp3_verified", {
                    key: song.key,
                    duration,
                    spotifyDurationMs: song.durationMs,
                    durationSpotifyId: song.durationSpotifyId || null,
                    durationToleranceSeconds: assertDuration(song.durationMs, duration).toleranceSeconds,
                    durationGuard: 'spotify-v1',
                    file: target,
                    sourceEvidence,
                  });
                } else {
                  reused++;
                  emit("local_reuse", { key: song.key, file: target });
                }
              },
              (admitted) =>
                admitted.forEach((s) => {
                  s.admitted = true;
                }),
              true,
            ) : [];
          failures.push(...metadataFailures);
        } catch (e) {
          const { classify } = await import("./acquire/transport.mjs");
          failures = batch.map((song) => ({
            song,
            error: classify(e.message),
          }));
        }
        for (const item of failures) await failure(item.song, item.error);
      })()
        .catch((e) => {
          guardError = e;
          stopping = true;
        })
        .finally(() => {
          active[kind]--;
          tasks.delete(task);
        });
      tasks.add(task);
    }
    await report();
    let lastGuardMirror = 0;
    while (!stopping || tasks.size) {
      const now = Date.now();
      if (minutes && now - start >= minutes * 60000) stopping = true;
      if (
        options["search-only"]
          ? limit && searches >= limit
          : limit && saved >= limit
      )
        stopping = true;
      if (now - lastControl > 1000) {
        const requestedControl = readJson(paths.control);
        const control = controlMatchesRun(requestedControl, runId, process.pid) ? requestedControl : null;
        lastControl = now;
        if (control?.stop) stopping = true;
        if (control?.reviewWorkAt > (transport.reviewWorkAt || 0)) {
          try {
            reviewWork.enqueue(readJson(join(stateDir, "review-work.json")));
          } catch (error) {
            if (error.code) throw error; // Storage failures must not be ignored.
            emit("review_work_request_error", { error: "Invalid or conflicting explicit review request" });
          }
          transport.reviewWorkAt = control.reviewWorkAt;
        }
        if (control?.inspectReviewAt > (transport.reviewControlAt || 0)) {
          queueSourceReview();
          transport.reviewControlAt = control.inspectReviewAt;
        }
        if (control?.pace && control.updatedAt > (transport.controlAt || 0)) {
          transport.pace.applyState({
            ...control.pace,
            autoStep: false,
            reason: "Explicit CLI pace change",
          });
          transport.controlAt = control.updatedAt;
          emit("pace_change", { pace: transport.pace.snapshot() });
        }
      }
      if (stopping) transport.stopAdmissions();
      const pace = transport.pace.snapshot();
      if (
        !stopping &&
        !pace.coolRemainingMs &&
        !transport.recoveryWaitMs(now)
      ) {
        const free = statfsSync(paths.downloads);
        if (free.bavail * free.bsize < 2 * 1024 ** 3) {
          stopping = true;
          guardError = new Error(
            "Less than 2 GiB free; acquisition stopped before further admissions",
          );
          continue;
        }
        const inFlightDownloads = songs.filter(
          (s) => s.state === "downloading",
        ).length;
        const eligible = readyDownloadCandidates(songs, now);
        // Reserve only for batches still sleeping in the courtesy gap.
        // Admitted work is already included in downloadsInWindow; subtracting
        // it twice would unnecessarily idle capacity near the window limit.
        const reservedDownloads = songs.filter(
          (s) => s.state === "downloading" && !s.admitted,
        ).length;
        const slots = Math.max(
          0,
          pace.maxPerWindow - pace.downloadsInWindow - reservedDownloads - reviewReserved - reviewWork.reservedDownloads,
        );
        if (reviewWork.tryLaunch({ pace, slots, active, tasks, batchSize })) continue;
        if (reviewPending.length && canLaunchYoutubeWork(pace, active, "download") && slots) {
          launchSourceReview(reviewPending.splice(0, Math.min(batchSize, slots)));
          continue;
        }
        const budget =
          limit && !options["search-only"]
            ? Math.max(0, limit - saved - inFlightDownloads)
            : batchSize;
        if (
          !options["search-only"] &&
          canLaunchYoutubeWork(pace, active, "download") &&
          slots &&
          budget &&
          eligible.length
        )
          launch(
            "download",
            eligible.slice(0, Math.min(batchSize, slots, budget)),
          );
        const pending = songs.filter(
          (s) => s.state === "pending" && s.retryAt <= now,
        );
        const searchBudget =
          limit && options["search-only"]
            ? Math.max(
                0,
                limit -
                  searches -
                  songs.filter((s) => s.state === "searching").length,
              )
            : batchSize;
        if (
          canLaunchYoutubeWork(pace, active, "search") &&
          searchBudget &&
          pending.length &&
          (options["search-only"] || preparedSearchBufferSize(songs) < searchBuffer)
        )
          launch("search", pending.slice(0, Math.min(batchSize, searchBudget)));
        const actionable = songs.some(
          (s) =>
            ["ready", "pending", "downloading", "searching"].includes(
              s.state,
            ) &&
            (!options["search-only"] || !s.url),
        );
        if (!actionable && !reviewPending.length && !reviewWork.pending.length && !tasks.size) stopping = true;
      }
      if (now - lastReport >= 30000) await report();
      if (now - lastGuardMirror >= 10000) {
        await mirrorWhileOwned();
        lastGuardMirror = now;
      }
      if (stopping && !tasks.size) break;
      await sleep(250);
    }
    const final = await report(true);
    atomic(join(stateDir, `result-${runId}.json`), final);
    emit("end", {
      verifiedNewMp3: saved,
      elapsedMinutes: final.elapsedMinutes,
    });
    if (guardError) throw guardError;
  } finally {
    stopping = true;
    // Normal stop drains already-admitted batches. Failure stops only this
    // runner's children, then waits for their result handlers to settle.
    if (transport) {
      transport.stopping = true;
      transport.killChildren();
    }
    await Promise.allSettled([...tasks]);
    let safeToResume = !transport;
    if (transport) {
      try {
        await mirrorPace();
        safeToResume = true;
      } catch {
        output({
          error:
            "Pace handback failed; queues remain paused. Admission history is preserved in data/acquire/pace.json.",
        });
      }
    }
    if (changedQueues && safeToResume && !ownershipLost) {
      for (let i = 0; i < queues.length; i++)
        if (!original[i].paused) await queues[i].resume();
      atomic(join(stateDir, "handoff.json"), {
        runId,
        pid: process.pid,
        original,
        phase: "returned",
        at: Date.now(),
      });
    }
    if (guard) clearInterval(guard);
    if (journal) await journal.close();
    if (db) await db.close();
    await redis.eval(
      "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
      1,
      lock,
      owner,
    );
    await Promise.all(queues.map((q) => q.close()));
    process.off("SIGINT", signal);
    process.off("SIGTERM", signal);
  }
}

async function main() {
  const parsed = parseCommandLine(process.argv.slice(2));
  options = parsed.options;
  const { command } = parsed;
  if (options.version) {
    console.log(`spooty ${JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version}`);
    return;
  }
  if (options.help) {
    console.log(helpText(parsed.explicitCommand ? command : null));
    return;
  }
  if (command !== 'doctor' && process.versions.node !== '20.19.4') throw new Error('Use Node 20.19.4: nvm use (see scripts/acquire/README.md).');
  if (['pace', 'stop', 'inspect-review', 'review-work'].includes(command)) {
    const status = readJson(paths.status);
    // Establish a live target before capability checks or catalog scans. The
    // write boundary below verifies it again and binds the request to that run.
    controlForOwner(status, await verifyLiveOwner(status), {});
  }
  if (command === "doctor") {
    const { localDoctor } = await import('./acquire/doctor.mjs');
    const check = localDoctor(paths, options);
    output(check);
    if (!check.ready) process.exitCode = 2;
  } else if (command === "plan") {
    const c = await catalog(paths),
      s = summary(c);
    const resume = resumePlan(c.songs.values(), await readJournal(paths.journal), {
      maxSearches: number('max-searches', 10, 1, 50), retryErrors: options['retry-errors'],
    });
    output({
      ...s,
      resume,
      maxSearches: Number(options['max-searches']),
      retryErrors: options['retry-errors'],
      baselineMp3PerMinute: 3,
      etaAtBaseline: resume.actionable ? eta(resume.actionable, 3) : null,
      etaScope: resume.actionable ? 'Actionable songs only; assumes 3 new MP3s/min, excludes parked exceptions' : 'No actionable songs; remaining exceptions are parked, no completion ETA',
      source: "saved playlist JSON + SQLite URL cache + durable acquisition journal + physical MP3 files",
    });
  } else if (command === "benchmark") {
    const status = readJson(paths.status);
    if (!status) throw new Error("No acquisition run recorded");
    const now = Date.now();
    const phases = acquisitionBenchmark(stateDir, status.runId, now);
    output({
      runId: status.runId,
      baselineMp3PerMinute: 3,
      phases,
      remainingUnique: status.remainingUnique,
      diskGB: status.diskGB,
      ...acquisitionMetrics(stateDir, status),
    });
  } else if (command === "status") {
    const status = readJson(paths.status);
    if (!status) throw new Error("No acquisition run recorded");
    const ownership = await verifyLiveOwner(status);
    output({
      ...status,
      ...acquisitionMetrics(stateDir, status),
      ...ownership,
      ...(!ownership.liveOwnerVerified ? {
        throughputState: ownership.ownerCheck === 'unavailable' ? 'owner-unverified' : 'not-running',
        eta: null, etaAtAdmissionCeiling: null,
        etaScope: 'Historical run snapshot; no verified live CLI owner, so no active completion estimate',
      } : {}),
      snapshotAgeSeconds: (Date.now() - Date.parse(status.at)) / 1000,
      snapshotOnly: true,
      physicalRefreshCommand: 'spooty plan',
    });
  } else if (command === "stop") {
    await requestControl({
      // A stop is not a fresh pace instruction. Retaining an earlier manual
      // profile here could silently undo a later safety-floor trip.
      stop: true,
      updatedAt: Date.now(),
    });
    output({ requested: "stop after current batches finish" });
  } else if (command === "review-work") {
    if (!readJson(paths.status)?.reviewWork)
      throw new Error("The recorded runner predates explicit review work support; load it at the next graceful restart");
    const { reviewRequests } = await import("./acquire/review-work.mjs");
    reviewRequests(readJson(join(stateDir, "review-work.json")), (await catalog(paths)).songs);
    await requestControl({
      reviewWorkAt: Date.now(),
    });
    output({ requested: "Queue explicit review-work.json actions through the live owner" });
  } else if (command === "inspect-review") {
    const live = readJson(paths.status);
    if (!live?.sourceReview)
      throw new Error("The recorded runner predates source review support; load it at the next graceful restart");
    // Inspection is not a pace change; never refresh an older fast setting.
    await requestControl({
      inspectReviewAt: Date.now(),
    });
    output({ requested: "Inspect unresolved recording sources through the existing CLI owner" });
  } else if (command === "pace") {
    await requestControl({
      pace: paceControl(),
      updatedAt: Date.now(),
    });
    output({ requested: paceControl() });
  } else if (command === "run") await run();
  else throw new Error("Unknown command; use --help");
}
async function requestControl(request) {
  const status = readJson(paths.status);
  const ownership = await verifyLiveOwner(status);
  atomic(paths.control, controlForOwner(status, ownership, request, readJson(paths.control)));
}
main().catch((e) => {
  console.error(JSON.stringify({ error: e.message }));
  process.exitCode = e.exitCode || 1;
});
