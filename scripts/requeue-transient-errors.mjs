#!/usr/bin/env node
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sqlite3 = require("sqlite3");
const { Queue } = require("bullmq");

const APPLY = process.argv.includes("--apply");
const DB_PATH =
  process.env.DB_PATH || "/Users/dom/src/spooty/data/spooty.sqlite";
const connection = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT || 6379),
};

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE);
const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) =>
      error ? reject(error) : resolve(rows),
    );
  });
const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve(this.changes);
    });
  });

const transientWhere = `(
  t.error LIKE '%not a bot%'
  OR t.error LIKE '%Sign in to confirm%'
  OR t.error LIKE '%429%'
  OR t.error LIKE '%timed out%'
  OR t.error LIKE '%YouTube search failed (%'
  OR t.error LIKE '%No route to host%'
  OR t.error LIKE '%network is unreachable%'
  OR t.error LIKE '%fetch failed%'
  OR t.error LIKE '%bytes read%'
)`;

const candidates = await all(`
  SELECT
    t.*,
    p.id AS p_id,
    p.name AS p_name,
    p.spotifyUrl AS p_spotifyUrl,
    p.error AS p_error,
    p.active AS p_active,
    p.isTrack AS p_isTrack,
    p.createdAt AS p_createdAt,
    p.coverUrl AS p_coverUrl
  FROM track_entity t
  LEFT JOIN playlist_entity p ON p.id = t.playlistId
  WHERE t.status = 5 AND ${transientWhere}
  ORDER BY t.id
`);

const downloadQueue = new Queue("track-download-processor", { connection });
const searchQueue = new Queue("track-search-processor", { connection });
const existingJobs = await Promise.all([
  downloadQueue.getJobs(["waiting", "active", "paused", "delayed"], 0, -1),
  searchQueue.getJobs(["waiting", "active", "paused", "delayed"], 0, -1),
]);
const existingTrackIds = new Set(
  existingJobs
    .flat()
    .map((job) => Number(job.data?.id))
    .filter(Number.isFinite),
);

const eligible = candidates.filter(
  (row) => !existingTrackIds.has(Number(row.id)),
);
const summary = {
  mode: APPLY ? "apply" : "dry-run",
  transientErrors: candidates.length,
  alreadyQueued: candidates.length - eligible.length,
  eligible: eligible.length,
  download: eligible.filter((row) => row.youtubeUrl).length,
  search: eligible.filter((row) => !row.youtubeUrl).length,
};
console.log(JSON.stringify(summary));

if (APPLY) {
  let queued = 0;
  for (const row of eligible) {
    const playlist = row.p_id
      ? {
          id: row.p_id,
          name: row.p_name,
          spotifyUrl: row.p_spotifyUrl,
          error: row.p_error,
          active: row.p_active,
          isTrack: row.p_isTrack,
          createdAt: row.p_createdAt,
          coverUrl: row.p_coverUrl,
        }
      : null;
    const track = {
      id: row.id,
      artist: row.artist,
      name: row.name,
      spotifyUrl: row.spotifyUrl,
      youtubeUrl: row.youtubeUrl,
      status: row.youtubeUrl ? 2 : 0,
      error: null,
      coverUrl: row.coverUrl,
      createdAt: row.createdAt,
      playlistId: row.playlistId,
      playlist,
    };
    const queue = row.youtubeUrl ? downloadQueue : searchQueue;
    const kind = row.youtubeUrl ? "download" : "search";
    await queue.add("", track, {
      jobId: `id-${row.id}-${kind}-transient-requeue-${Date.now()}`,
    });
    await run("UPDATE track_entity SET status = ?, error = NULL WHERE id = ?", [
      track.status,
      row.id,
    ]);
    queued += 1;
  }
  console.log(JSON.stringify({ applied: queued }));
}

await downloadQueue.close();
await searchQueue.close();
await new Promise((resolve) => db.close(resolve));
