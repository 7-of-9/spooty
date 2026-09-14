#!/usr/bin/env node
import { createRequire } from "node:module";
import { statSync } from "node:fs";
import { resolve, sep } from "node:path";

const require = createRequire(import.meta.url);
const sqlite3 = require("sqlite3");
const { Queue } = require("bullmq");

const apply = process.argv.includes("--apply");
const root = resolve(
  process.env.DOWNLOADS_PATH || "/Users/dom/src/spooty/downloads",
);
const dbPath = resolve(
  process.env.DB_PATH || "/Users/dom/src/spooty/data/spooty.sqlite",
);
const format = process.env.FORMAT || "mp3";
const connection = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT || 6379),
};

function stripIllegal(text) {
  return String(text || "").replace(/[/\\?%*:|"<>]/g, "-");
}

function trackBase(artist, name) {
  return stripIllegal(
    `${artist || "unknown_artist"} - ${String(name || "unknown_track").replace("/", "")}`,
  );
}

function playlistFolder(name) {
  const cleaned = stripIllegal(name).trim();
  const segment =
    !cleaned || cleaned === "." || cleaned === ".."
      ? "unknown_playlist"
      : cleaned;
  const folder = resolve(root, segment);
  if (!folder.startsWith(root + sep)) {
    throw new Error(`Playlist path escapes downloads root: ${name}`);
  }
  return folder;
}

function nonEmpty(path) {
  try {
    const stat = statSync(path);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function completedIdsWithFiles() {
  const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
  return new Promise((resolveRows, reject) => {
    db.all(
      `SELECT t.id, t.artist, t.name, p.name AS playlistName, p.isTrack
         FROM track_entity t
         JOIN playlist_entity p ON p.id = t.playlistId
        WHERE t.status = 4`,
      (error, rows) => {
        db.close();
        if (error) return reject(error);
        const ids = new Set();
        for (const row of rows) {
          const filename = `${trackBase(row.artist, row.name)}.${format}`;
          const path = row.isTrack
            ? resolve(root, filename)
            : resolve(playlistFolder(row.playlistName), filename);
          if (nonEmpty(path)) ids.add(Number(row.id));
        }
        resolveRows(ids);
      },
    );
  });
}

const satisfied = await completedIdsWithFiles();
const queues = [
  new Queue("track-download-processor", { connection }),
  new Queue("track-search-processor", { connection }),
];

try {
  const result = {};
  for (const queue of queues) {
    const counts = await queue.getJobCounts("active", "paused", "delayed");
    if (apply && (!(await queue.isPaused()) || counts.active !== 0)) {
      throw new Error(
        `Refusing apply unless ${queue.name} is paused with active=0`,
      );
    }
    const jobs = await queue.getJobs(["paused", "wait", "delayed"], 0, -1);
    const removable = jobs.filter((job) => satisfied.has(Number(job.data?.id)));
    if (apply) {
      for (const job of removable) await job.remove();
    }
    result[queue.name] = {
      scanned: jobs.length,
      removable: removable.length,
      countsAfter: apply
        ? await queue.getJobCounts("active", "paused", "delayed")
        : undefined,
    };
  }
  console.log(
    JSON.stringify({ apply, satisfied: satisfied.size, queues: result }),
  );
} finally {
  await Promise.all(queues.map((queue) => queue.close()));
}
