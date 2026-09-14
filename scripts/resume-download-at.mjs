#!/usr/bin/env node
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Queue } = require("bullmq");

const target = Date.parse(process.argv[2] || "");
if (!Number.isFinite(target)) {
  console.error("Usage: node scripts/resume-download-at.mjs <ISO timestamp>");
  process.exit(2);
}

const API = process.env.YT_PACE_API || "http://127.0.0.1:3000/api/youtube/pace";
const connection = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT || 6379),
};
const delay = Math.max(0, target - Date.now());
console.log(
  JSON.stringify({
    event: "scheduled",
    target: new Date(target).toISOString(),
    delay,
  }),
);

await new Promise((resolve) => setTimeout(resolve, delay));

const paceResponse = await fetch(API);
if (!paceResponse.ok) {
  throw new Error(
    `Pace API unavailable (${paceResponse.status}); leaving queues paused`,
  );
}
const pace = await paceResponse.json();
const downloadQueue = new Queue("track-download-processor", { connection });
const searchQueue = new Queue("track-search-processor", { connection });

try {
  const downloadPaused = await downloadQueue.isPaused();
  const searchPaused = await searchQueue.isPaused();
  const counts = await downloadQueue.getJobCounts(
    "waiting",
    "active",
    "paused",
    "delayed",
  );
  const guard = {
    downloadConc: pace.downloadConc,
    maxPerWindow: pace.maxPerWindow,
    autoStep: pace.autoStep,
    downloadPaused,
    searchPaused,
    active: counts.active,
  };
  if (
    pace.downloadConc !== 1 ||
    pace.maxPerWindow !== 8 ||
    pace.autoStep !== false ||
    !downloadPaused ||
    !searchPaused ||
    counts.active !== 0
  ) {
    console.error(JSON.stringify({ event: "guard-refused", guard }));
    process.exitCode = 3;
  } else {
    await downloadQueue.resume();
    console.log(
      JSON.stringify({
        event: "download-resumed",
        at: new Date().toISOString(),
        guard,
        counts: await downloadQueue.getJobCounts(
          "waiting",
          "active",
          "paused",
          "delayed",
        ),
      }),
    );
  }
} finally {
  await downloadQueue.close();
  await searchQueue.close();
}
