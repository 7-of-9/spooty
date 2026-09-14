import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { eta } from "./catalog.mjs";

export function pacedEta(remaining, measuredRate, pace, now = Date.now()) {
  const ceiling =
    pace?.maxPerWindow > 0 && pace?.windowMs > 0
      ? pace.maxPerWindow / (pace.windowMs / 60000)
      : null;
  const rateUsed = ceiling ? Math.min(measuredRate, ceiling) : measuredRate;
  const cooldown = Math.max(0, pace?.coolRemainingMs || 0);
  const estimate = eta(remaining, rateUsed, now + cooldown);
  return {
    ...estimate,
    hours: estimate.hours === null ? null : estimate.hours + cooldown / 3600000,
    rateUsedPerMinute: rateUsed,
    admissionCeilingPerMinute: ceiling,
    cappedStartupBurst: ceiling !== null && measuredRate > ceiling,
  };
}

export function benchmarkPhases(events, now = Date.now(), exclusions = []) {
  const ordered = events.filter((event) => event.t <= now).sort((a, b) => a.t - b.t);
  const boundaries = [];
  for (const event of ordered.filter((e) =>
    ["start", "pace_change", "block"].includes(e.type),
  )) {
    const previous = boundaries.at(-1);
    const before = previous?.profile || previous?.pace;
    const after = event.profile || event.pace;
    // stop updates control.updatedAt too; an unchanged persisted pace is not
    // a new experimental setting and must not create a zero-length phase.
    if (
      event.type === "pace_change" &&
      before &&
      ["downloadConc", "searchConc", "maxPerWindow"].every(
        (key) => before[key] === after[key],
      )
    )
      continue;
    boundaries.push(event);
  }
  const ended = ordered.find((e) => e.type === "end")?.t;
  return boundaries.map((event, i) => {
    const end = boundaries[i + 1]?.t ?? ended ?? now;
    const elapsed = Math.max(0, end - event.t) / 60000;
    const saved = ordered.filter(
      (e) => e.type === "mp3_verified" && e.t >= event.t && e.t < end,
    );
    const rate = elapsed ? saved.length / elapsed : 0;
    const pace = event.profile || event.pace;
    const recoverySaved = event.type === "block"
      ? saved.filter((output) => output.t >= (pace.coolUntil || event.t))
      : saved;
    const first10 = saved.filter((e) => e.t < event.t + 600000).length;
    const last10 = saved.filter((e) => e.t >= end - 600000).length;
    const last30 = saved.filter((e) => e.t >= end - 1800000).length;
    const overlapping = (from, until) => exclusions.filter((note) =>
      Date.parse(note.startedAt) < until && Date.parse(note.endedAt) > from);
    return {
      startedAt: new Date(event.t).toISOString(),
      endedAt: boundaries[i + 1] || ended ? new Date(end).toISOString() : null,
      profile: {
        downloadConc: pace.downloadConc,
        searchConc: pace.searchConc,
        maxPerWindow: pace.maxPerWindow,
      },
      elapsedMinutes: elapsed,
      verifiedNewMp3: saved.length,
      mp3PerMinute: rate,
      // Publication already underway can finish just after a trip. It is a
      // real saved file, but cannot prove the new recovery profile succeeded.
      preRecoveryCarryoverMp3: saved.length - recoverySaved.length,
      recoveryQualifiedMp3PerMinute: elapsed ? recoverySaved.length / elapsed : 0,
      baselineMultiple: rate / 3,
      benchmarkExclusions: overlapping(event.t, end),
      firstFull10:
        elapsed >= 10
          ? { verifiedNewMp3: first10, mp3PerMinute: first10 / 10,
              excludedFromSoleOwnerBenchmark: overlapping(event.t, event.t + 600000).length > 0 }
          : null,
      lastFull10:
        elapsed >= 10
          ? { startedAt: new Date(end - 600000).toISOString(),
              endedAt: new Date(end).toISOString(),
              verifiedNewMp3: last10, mp3PerMinute: last10 / 10,
              excludedFromSoleOwnerBenchmark: overlapping(end - 600000, end).length > 0 }
          : null,
      lastFull30:
        elapsed >= 30
          ? { verifiedNewMp3: last30, mp3PerMinute: last30 / 30,
              excludedFromSoleOwnerBenchmark: overlapping(end - 1800000, end).length > 0 }
          : null,
      longAudioOutputs: saved.filter((e) => e.duration > 1800).length,
      rateLimitTrips: ordered.filter(
        (e) => e.type === "block" && e.t > event.t && e.t <= end,
      ).length,
    };
  });
}

export function acquisitionBenchmark(directory, runId, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(runId))
    throw new Error("Invalid benchmark run ID");
  const notesPath = join(directory, "benchmark-notes.json");
  const notes = existsSync(notesPath) ? JSON.parse(readFileSync(notesPath, "utf8")) : { exclusions: [] };
  if (!Array.isArray(notes.exclusions) || notes.exclusions.some((note) =>
    typeof note.runId !== "string" || typeof note.reason !== "string" ||
    !Number.isFinite(Date.parse(note.startedAt)) || !Number.isFinite(Date.parse(note.endedAt)) ||
    Date.parse(note.endedAt) <= Date.parse(note.startedAt)))
    throw new Error("Invalid benchmark exclusion ledger");
  return benchmarkPhases(lines(join(directory, `events-${runId}.jsonl`)), now,
    notes.exclusions.filter((note) => note.runId === runId));
}

export function contentReviewMetrics(directory, runId) {
  const path = join(directory, "quality-review.json");
  let entries = [];
  try {
    if (existsSync(path)) {
      const review = JSON.parse(readFileSync(path, "utf8"));
      if (!Array.isArray(review.entries)) throw new Error("Invalid review ledger");
      const byKey = new Map();
      for (const entry of review.entries) {
        if (
          !entry || typeof entry.key !== "string" || !entry.key ||
          !["needs-review", "needs-repair", "resolved"].includes(entry.status)
        ) throw new Error("Invalid review entry");
        byKey.set(entry.key, entry);
      }
      entries = [...byKey.values()].filter((entry) => entry.status !== "resolved");
    }
    return {
      contentReviewPendingUnique: entries.length,
      contentReviewInCurrentRun: entries.filter((entry) => entry.runId === runId).length,
      contentReviewReadError: false,
      completionBlockedByContentReview: entries.length > 0,
    };
  } catch {
    // A damaged review ledger must not silently turn known mismatches into
    // accepted content. This reader does not touch the live queue or MP3s.
    return {
      contentReviewPendingUnique: null,
      contentReviewInCurrentRun: null,
      contentReviewReadError: true,
      completionBlockedByContentReview: true,
    };
  }
}

// Do not carry a fast, failed profile's rate into the recovery profile. Keep
// the whole-run average for audit, but forecast from the current profile only.
// The admission-cap estimate is explicitly conditional, not measured output.
export function acquisitionMetrics(directory, status) {
  const now = Date.parse(status.at);
  const current = status.runId
    ? acquisitionBenchmark(directory, status.runId, now).at(-1)
    : null;
  const rate = current?.recoveryQualifiedMp3PerMinute ?? current?.mp3PerMinute ?? status.mp3PerMinute;
  const wait = Math.max(
    status.pace?.coolRemainingMs || 0,
    status.recoveryWaitMs || 0,
  );
  const pace = { ...status.pace, coolRemainingMs: wait };
  const ceiling =
    pace.maxPerWindow > 0 && pace.windowMs > 0
      ? pace.maxPerWindow / (pace.windowMs / 60000)
      : null;
  const content = contentReviewMetrics(directory, status.runId);
  return {
    ...content,
    verificationScope: status.durationGuard === 'spotify-v1'
      ? "New acquisitions: MP3 codec, Spotify-matched duration and publication; duration does not prove recording identity; existing files not retroactively checked"
      : "MP3 codec, positive duration and publication; not recording identity",
    etaScope: content.completionBlockedByContentReview
      ? "bulk acquisition; unresolved content repair not estimated"
      : "bulk acquisition",
    wholeRunMp3PerMinute: status.mp3PerMinute,
    currentProfileMp3PerMinute: rate,
    currentProfileBaselineMultiple: rate / 3,
    currentProfileStartedAt: current?.startedAt ?? null,
    throughputState: wait > 0 ? "held" : status.phase,
    earliestRecoveryAt: wait > 0 ? new Date(now + wait).toISOString() : null,
    etaBasis: "current profile average, capped at its admission allowance",
    eta: status.actionableUnique === 0 ? null : pacedEta(status.actionableUnique ?? status.remainingUnique, rate, pace, now),
    etaAtAdmissionCeiling: ceiling && status.actionableUnique !== 0
      ? {
          ...pacedEta(status.actionableUnique ?? status.remainingUnique, ceiling, pace, now),
          conditional: true,
          assumption: "Recovery succeeds and every allowed admission yields a new MP3",
        }
      : null,
  };
}

export function progressEta(rate, remaining, acquisition, now = Date.now()) {
  const owned = acquisition?.liveOwnerVerified;
  const measured = owned
    ? Math.min(rate, acquisition.currentProfileMp3PerMinute)
    : rate;
  const pace = owned
    ? {
        ...acquisition.pace,
        coolRemainingMs: Math.max(
          acquisition.pace?.coolRemainingMs || 0,
          acquisition.recoveryWaitMs || 0,
        ),
      }
    : null;
  const forecast = pacedEta(remaining, measured, pace, now);
  if (!forecast.continuous) return null;
  return {
    hours: forecast.hours,
    at: forecast.continuous,
    buffer25At: forecast.buffered25,
    rateUsedPerMinute: forecast.rateUsedPerMinute,
  };
}

function lines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

// The ordinary reporter must keep seeing real progress after ownership moves
// from Nest to the CLI. Count verified publication, never both publication and
// the batch gate's later completion event.
export function acquisitionEvents(directory) {
  if (!existsSync(directory)) return [];
  const events = lines(join(directory, "pace-events.jsonl")).filter((e) =>
    ["download_start", "bot"].includes(e.type),
  );
  for (const file of readdirSync(directory).filter((f) =>
    /^events-.*\.jsonl$/.test(f),
  )) {
    for (const event of lines(join(directory, file))) {
      if (event.type === "mp3_verified")
        events.push({ t: event.t, type: "download_ok", source: "cli" });
      if (event.type === "search_ok")
        events.push({ t: event.t, type: "search_ok", source: "cli" });
    }
  }
  return events;
}

export function acquisitionStatus(directory, redisOwner) {
  let status;
  try {
    status = JSON.parse(readFileSync(join(directory, "status.json"), "utf8"));
  } catch {
    return null;
  }
  let exists = false;
  try {
    process.kill(status.pid, 0);
    exists = true;
  } catch {}
  return {
    ...status,
    ...(typeof status.remainingUnique === "number" &&
    typeof status.mp3PerMinute === "number"
      ? {
          ...acquisitionMetrics(directory, status),
        }
      : {}),
    liveOwnerVerified:
      exists && redisOwner?.startsWith(`${status.pid}-`) === true,
    snapshotAgeSeconds: (Date.now() - Date.parse(status.at)) / 1000,
  };
}
