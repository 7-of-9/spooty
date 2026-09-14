import { createRequire } from "node:module";
import {
  readdirSync,
  readFileSync,
  statSync,
  existsSync,
} from "node:fs";
import { resolve, join, basename, sep } from "node:path";
import { positiveDurationMs } from './spotify-duration.mjs';
export { materialize } from './publication.mjs';

const require = createRequire(import.meta.url);
const sqlite3 = require("sqlite3");
// The shared-module wrappers above initialize the TypeScript loader.
export const { safe, fileBase, songKey } = require('../../src/backend/src/shared/acquisition/identity.ts');

export function database(path, readonly = false) {
  let opened;
  const ready = new Promise((yes, no) => { opened = error => error ? no(error) : yes(); });
  const db = new sqlite3.Database(
    path,
    readonly
      ? sqlite3.OPEN_READONLY
      : sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
    opened,
  );
  db.configure("busyTimeout", 10000);
  return {
    all: (sql, params = []) => ready.then(() =>
      new Promise((yes, no) =>
        db.all(sql, params, (e, rows) => (e ? no(e) : yes(rows))),
      )),
    run: (sql, params = []) => ready.then(() =>
      new Promise((yes, no) =>
        db.run(sql, params, function (e) {
          e ? no(e) : yes(this.changes);
        }),
      )),
    close: async () => {
      try { await ready; } catch { return; }
      return new Promise((yes, no) => db.close((e) => (e ? no(e) : yes())));
    },
  };
}

export const excluded = (name) =>
  /^(daily mix(?:es)?(?:\s.*)?|dj|discover weekly|release radar|on repeat|repeat rewind|(?:your )?daily drive)$/i.test(
    String(name || "").trim(),
  );
export function nonempty(path) {
  try {
    const s = statSync(path);
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}
export function folder(root, name) {
  const cleaned = safe(name).trim();
  const part =
    !cleaned || [".", ".."].includes(cleaned) ? "unknown_playlist" : cleaned;
  const path = resolve(root, part);
  if (!path.startsWith(resolve(root) + sep))
    throw new Error("Invalid playlist destination");
  return path;
}

export function scanAudio(root) {
  const byKey = new Map(),
    inodes = new Set();
  let bytes = 0,
    paths = 0;
  const dirs = [{ dir: root, published: true }];
  while (dirs.length) {
    const { dir, published } = dirs.pop();
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      // Count all inode bytes, but unpublished output is never success evidence.
      if (entry.isDirectory())
        dirs.push({
          dir: path,
          published:
            published && !entry.name.startsWith(".spooty-download-batch-"),
        });
      else if (entry.isFile() && /\.mp3$/i.test(entry.name)) {
        let s;
        try {
          s = statSync(path);
        } catch {
          continue;
        }
        if (!s.size) continue;
        paths++;
        // Leading dots are legitimate artist/playlist names, for example
        // .Clouds and ...baby one more time Radio. Exclude only real staging.
        if (published)
          byKey.set(basename(entry.name).slice(0, -4).toLowerCase(), path);
        const key = `${s.dev}:${s.ino}`;
        if (!inodes.has(key)) {
          inodes.add(key);
          bytes += s.size;
        }
      }
    }
  }
  return { byKey, bytes, gb: bytes / 1e9, paths, uniqueInodes: inodes.size };
}

export async function catalog({ playlists, downloads, dbPath }) {
  const songs = new Map();
  let playlistCount = 0,
    occurrences = 0,
    skipped = 0;
  for (const file of readdirSync(playlists)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const p = JSON.parse(readFileSync(join(playlists, file), "utf8"));
    if (p.skipped || p.raw?.skipped || excluded(p.name)) {
      skipped++;
      continue;
    }
    if (!Array.isArray(p.tracks)) continue;
    playlistCount++;
    for (const t of p.tracks) {
      if (!t.artist || !t.name) continue;
      occurrences++;
      const key = songKey(t.artist, t.name);
      const song = songs.get(key) || {
        key,
        artist: t.artist,
        name: t.name,
        spotifyIds: [],
        destinations: [],
        rowIds: [],
        url: null,
        missing: false,
        coverUrl: t.coverUrl || p.coverUrl || null,
      };
      const spotifyId = /^[A-Za-z0-9]{22}$/.test(t.id || '') ? t.id :
        String(t.href || '').match(/^https:\/\/open\.spotify\.com\/track\/([A-Za-z0-9]{22})(?:[?#]|$)/)?.[1];
      if (spotifyId && !song.spotifyIds.includes(spotifyId)) song.spotifyIds.push(spotifyId);
      const durationMs = t.durationMs ?? t.duration_ms;
      if (positiveDurationMs(durationMs)) {
        // Filename-key deduplication must not silently conflate different edits.
        if (song.durationMs && Math.abs(song.durationMs - durationMs) > 5000) song.durationConflict = true;
        if (!song.durationMs) {
          song.durationMs = durationMs;
          song.durationSpotifyId = spotifyId || null;
        }
      }
      const path = join(
        folder(downloads, p.name),
        fileBase(t.artist, t.name) + ".mp3",
      );
      if (!song.destinations.includes(path)) song.destinations.push(path);
      songs.set(key, song);
    }
  }
  // Snapshot membership is authoritative. SQLite only contributes existing URLs,
  // confirmed misses and the IDs whose durable outcomes should be reconciled.
  const db = database(dbPath, true);
  try {
    for (const row of await db.all(
      "SELECT id, artist, name, youtubeUrl, error FROM track_entity",
    )) {
      const s = songs.get(songKey(row.artist, row.name));
      if (!s) continue;
      s.rowIds.push(row.id);
      if (row.youtubeUrl) s.url ||= row.youtubeUrl;
      s.missing ||= /^no youtube result$/i.test(row.error || "");
    }
  } finally {
    await db.close();
  }
  const disk = scanAudio(downloads);
  for (const s of songs.values()) {
    s.source = disk.byKey.get(s.key) || s.destinations.find(nonempty) || null;
    if (s.url || s.source) s.missing = false;
  }
  return { songs, disk, playlistCount, occurrences, skipped };
}

export function eta(remaining, rate, now = Date.now()) {
  if (!(rate > 0)) return { hours: null, continuous: null, buffered25: null };
  const hours = remaining / rate / 60;
  return {
    hours,
    continuous: new Date(now + hours * 3600000).toISOString(),
    buffered25: new Date(now + hours * 4500000).toISOString(),
  };
}

// Preserve repeated timestamps: eight URLs admitted in a batch deliberately
// have eight identical entries. A plain Set would erase seven admissions.
export function mergeAdmissions(
  a = [],
  b = [],
  now = Date.now(),
  windowMs = 600000,
) {
  const counts = (list) => {
    const result = new Map();
    for (const t of list)
      if (Number.isFinite(t) && now - t < windowMs)
        result.set(t, (result.get(t) || 0) + 1);
    return result;
  };
  const left = counts(a),
    right = counts(b);
  return [...new Set([...left.keys(), ...right.keys()])]
    .sort((x, y) => x - y)
    .flatMap((t) =>
      Array(Math.max(left.get(t) || 0, right.get(t) || 0)).fill(t),
    );
}

export function summary(c) {
  const all = [...c.songs.values()];
  return {
    playlists: c.playlistCount,
    excludedPlaylists: c.skipped,
    occurrences: c.occurrences,
    uniqueSongs: all.length,
    saved: all.filter((s) => s.source).length,
    confirmedMissing: all.filter((s) => s.missing).length,
    remaining: all.filter((s) => !s.source && !s.missing).length,
    readyUrls: all.filter((s) => !s.source && s.url).length,
    needsSearch: all.filter((s) => !s.source && !s.url && !s.missing).length,
    diskGB: c.disk.gb,
    uniqueInodes: c.disk.uniqueInodes,
  };
}
