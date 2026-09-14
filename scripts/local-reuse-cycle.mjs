#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { Queue } = require("bullmq");

const apply = process.argv.includes("--apply");
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const minCandidates = Math.max(
  1,
  Number(process.env.LOCAL_REUSE_MIN_CANDIDATES || 50),
);
const drainTimeoutMs = Math.max(
  30_000,
  Number(process.env.LOCAL_REUSE_DRAIN_TIMEOUT_MS || 180_000),
);
const pollMs = 2_000;
const connection = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT || 6379),
};

function runJson(script, args = []) {
  const output = execFileSync(
    process.execPath,
    [join(scriptsDir, script), ...args],
    {
      cwd: join(scriptsDir, ".."),
      env: process.env,
      encoding: "utf8",
    },
  ).trim();
  const line = output.split("\n").filter(Boolean).at(-1);
  if (!line) throw new Error(`${script} produced no JSON output`);
  return JSON.parse(line);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const download = new Queue("track-download-processor", { connection });
const search = new Queue("track-search-processor", { connection });

async function queueState() {
  const [downloadPaused, searchPaused, downloadCounts, searchCounts] =
    await Promise.all([
      download.isPaused(),
      search.isPaused(),
      download.getJobCounts("waiting", "active", "paused", "delayed"),
      search.getJobCounts("waiting", "active", "paused", "delayed"),
    ]);
  return {
    download: { paused: downloadPaused, counts: downloadCounts },
    search: { paused: searchPaused, counts: searchCounts },
  };
}

const preview = runJson("reuse-local-audio.mjs");
if (!apply || preview.candidates < minCandidates) {
  console.log(
    JSON.stringify({
      apply,
      skipped: apply ? "below candidate threshold" : "dry run",
      minCandidates,
      preview,
      queues: await queueState(),
    }),
  );
  await Promise.all([download.close(), search.close()]);
  process.exit(0);
}

const initial = await queueState();
if (initial.download.paused || initial.search.paused) {
  await Promise.all([download.close(), search.close()]);
  throw new Error(
    "Refusing to override an existing paused-queue recovery or maintenance state",
  );
}

let pausedByThisCycle = false;
let receivedSignal = null;
const startedAt = Date.now();
const onSignal = (signal) => {
  receivedSignal ||= signal;
};
const onSigint = () => onSignal("SIGINT");
const onSigterm = () => onSignal("SIGTERM");
const throwIfStopping = () => {
  if (receivedSignal) {
    throw new Error(`Maintenance interrupted by ${receivedSignal}`);
  }
};
process.on("SIGINT", onSigint);
process.on("SIGTERM", onSigterm);
try {
  await Promise.all([download.pause(), search.pause()]);
  pausedByThisCycle = true;
  throwIfStopping();

  const deadline = Date.now() + drainTimeoutMs;
  for (;;) {
    const state = await queueState();
    if (
      state.download.counts.active === 0 &&
      state.search.counts.active === 0
    ) {
      break;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Queues did not drain within ${Math.round(drainTimeoutMs / 1000)}s`,
      );
    }
    throwIfStopping();
    await sleep(pollMs);
  }

  throwIfStopping();
  const reuse = runJson("reuse-local-audio.mjs", ["--apply"]);
  throwIfStopping();
  const prune = runJson("prune-satisfied-queue-jobs.mjs", ["--apply"]);
  throwIfStopping();
  await Promise.all([download.resume(), search.resume()]);
  pausedByThisCycle = false;
  await sleep(1_000);
  console.log(
    JSON.stringify({
      apply: true,
      elapsedMs: Date.now() - startedAt,
      preview,
      reuse,
      prune,
      queues: await queueState(),
    }),
  );
} finally {
  if (pausedByThisCycle) {
    await Promise.allSettled([download.resume(), search.resume()]);
  }
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);
  await Promise.allSettled([download.close(), search.close()]);
}
