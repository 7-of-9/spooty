#!/usr/bin/env node
import { createRequire } from "node:module";
import {
  constants,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, extname, resolve, sep } from "node:path";

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
const audioExts = new Set([
  ".mp3",
  ".m4a",
  ".flac",
  ".opus",
  ".ogg",
  ".wav",
  ".aac",
]);

function stripIllegal(text) {
  return String(text || "").replace(/[/\\?%*:|"<>]/g, "-");
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

function trackBase(artist, name) {
  return stripIllegal(
    `${artist || "unknown_artist"} - ${String(name || "unknown_track").replace("/", "")}`,
  );
}

function nonEmpty(path) {
  try {
    return statSync(path).isFile() && statSync(path).size > 0;
  } catch {
    return false;
  }
}

function audioIndex() {
  const index = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (!full.startsWith(root + sep)) continue;
      if (entry.isDirectory()) walk(full);
      else if (
        audioExts.has(extname(entry.name).toLowerCase()) &&
        nonEmpty(full)
      ) {
        const key = basename(entry.name, extname(entry.name)).toLowerCase();
        if (key && !index.has(key)) index.set(key, full);
      }
    }
  };
  if (existsSync(root)) walk(root);
  return index;
}

function openDatabase() {
  return new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE);
}

function all(db, sql) {
  return new Promise((resolveRows, reject) => {
    db.all(sql, (error, rows) => (error ? reject(error) : resolveRows(rows)));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolveRun, reject) => {
    db.run(sql, params, function (error) {
      if (error) reject(error);
      else resolveRun(this.changes || 0);
    });
  });
}

function close(db) {
  return new Promise((resolveClose, reject) => {
    db.close((error) => (error ? reject(error) : resolveClose()));
  });
}

async function assertQueuesPaused() {
  const connection = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
  };
  const download = new Queue("track-download-processor", { connection });
  const search = new Queue("track-search-processor", { connection });
  try {
    const [downloadPaused, searchPaused, downloadCounts, searchCounts] =
      await Promise.all([
        download.isPaused(),
        search.isPaused(),
        download.getJobCounts("active"),
        search.getJobCounts("active"),
      ]);
    if (
      !downloadPaused ||
      !searchPaused ||
      downloadCounts.active !== 0 ||
      searchCounts.active !== 0
    ) {
      throw new Error(
        `Refusing apply unless both queues are paused with download active=0 and search active=0`,
      );
    }
  } finally {
    await download.close();
    await search.close();
  }
}

if (apply) await assertQueuesPaused();

const index = audioIndex();
const db = openDatabase();
try {
  const allRows = await all(
    db,
    `SELECT t.id, t.artist, t.name, t.spotifyUrl, t.status,
            p.name AS playlistName
       FROM track_entity t
       JOIN playlist_entity p ON p.id = t.playlistId
      ORDER BY t.id`,
  );
  const rows = allRows.filter((row) => [0, 1, 2, 3].includes(row.status));
  const spotifySources = new Map();
  for (const row of allRows) {
    if (!row.spotifyUrl || spotifySources.has(row.spotifyUrl)) continue;
    const candidate = resolve(
      playlistFolder(row.playlistName),
      `${trackBase(row.artist, row.name)}.${format}`,
    );
    if (nonEmpty(candidate)) spotifySources.set(row.spotifyUrl, candidate);
  }
  const candidates = [];
  for (const row of rows) {
    const base = trackBase(row.artist, row.name);
    const destination = resolve(
      playlistFolder(row.playlistName),
      `${base}.${format}`,
    );
    const source = nonEmpty(destination)
      ? destination
      : index.get(base.toLowerCase()) ||
        (row.spotifyUrl ? spotifySources.get(row.spotifyUrl) : undefined);
    if (source && nonEmpty(source)) {
      candidates.push({ ...row, source, destination });
    }
  }

  let linked = 0;
  let reconciled = 0;
  if (apply) {
    await run(db, "BEGIN IMMEDIATE");
    try {
      for (const row of candidates) {
        if (!nonEmpty(row.destination)) {
          mkdirSync(resolve(row.destination, ".."), { recursive: true });
          try {
            linkSync(row.source, row.destination);
          } catch (error) {
            if (error?.code === "EEXIST" && nonEmpty(row.destination)) {
              // Another safe local pass won the race.
            } else if (["EXDEV", "EACCES", "EPERM"].includes(error?.code)) {
              copyFileSync(
                row.source,
                row.destination,
                constants.COPYFILE_EXCL,
              );
            } else {
              throw error;
            }
          }
          linked++;
        } else {
          reconciled++;
        }
        await run(
          db,
          "UPDATE track_entity SET status = 4, error = NULL WHERE id = ? AND status IN (0, 1, 2, 3)",
          [row.id],
        );
      }
      await run(db, "COMMIT");
    } catch (error) {
      await run(db, "ROLLBACK").catch(() => undefined);
      throw error;
    }
  }

  console.log(
    JSON.stringify({
      apply,
      openRows: rows.length,
      candidates: candidates.length,
      uniqueKeys: new Set(
        candidates.map((row) => trackBase(row.artist, row.name).toLowerCase()),
      ).size,
      uniqueSpotifyIds: new Set(
        candidates.map((row) => row.spotifyUrl).filter(Boolean),
      ).size,
      linked,
      reconciled,
    }),
  );
} finally {
  await close(db);
}
