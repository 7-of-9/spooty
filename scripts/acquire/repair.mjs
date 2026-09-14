import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import {
  linkSync, mkdirSync, mkdtempSync, readFileSync,
  renameSync, rmSync, statSync, unlinkSync, writeFileSync,
  copyFileSync, realpathSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { verifyMp3 } from "./transport.mjs";

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

export function reviewedChapter(entry, evidence, plan) {
  if (!entry || entry.status !== "needs-repair" || !plan?.recordingRationale)
    throw new Error("An unresolved repair and explicit recording rationale are required");
  if (plan.videoId !== evidence?.videoId || !/^[A-Za-z0-9_-]{11}$/.test(plan.videoId))
    throw new Error("Source video evidence does not match the repair plan");
  if (!Number.isInteger(plan.chapterIndex) || plan.chapterIndex < 0)
    throw new Error("A verified source chapter is required");
  const chapter = evidence.chapters?.[plan.chapterIndex];
  const expected = entry.catalogDurationSeconds;
  const duration = chapter?.endSeconds - chapter?.startSeconds;
  if (
    !chapter || !Number.isFinite(duration) || duration <= 0 ||
    !(expected > 0) || Math.abs(duration - expected) > Math.max(3, expected * 0.02) ||
    Math.abs(evidence.durationSeconds - entry.actualDurationSeconds) > 2 ||
    chapter.startSeconds < 0 || chapter.endSeconds > evidence.durationSeconds + 1
  ) throw new Error("Source chapter duration does not corroborate the requested movement");
  if (
    !Array.isArray(plan.requiredSourceWords) || !plan.requiredSourceWords.length ||
    !plan.requiredSourceWords.every((word) =>
      typeof word === "string" && word && evidence.title?.toLowerCase().includes(word.toLowerCase()),
    )
  ) throw new Error("Source title does not corroborate the required performers");
  return { start: chapter.startSeconds, end: chapter.endSeconds, duration, title: chapter.title };
}

function sameOriginal(path, entry) {
  const stat = statSync(path);
  return stat.isFile() && stat.dev === entry.originalDevice &&
    stat.ino === entry.originalInode && stat.size === entry.originalBytes;
}

// This is a local, explicit repair, not a download worker and not a blind
// duration cut. The full original is hard-linked into a preserved archive
// before any canonical path changes. Every changed path is recorded durably.
export async function repairReviewedChapter(args) {
  return repairVerifiedAudio({ ...args, chapter: reviewedChapter(args.entry, args.evidence, args.plan) });
}

export async function replaceReviewedRecording(args) {
  const { entry, evidence, plan, source, stagingRoot } = args;
  if (entry?.status !== "needs-repair" || !plan?.recordingRationale ||
    !/^[A-Za-z0-9_-]{11}$/.test(plan.videoId || "") || plan.videoId !== evidence?.videoId)
    throw new Error("Reviewed replacement requires matching source identity and recording rationale");
  const searchable = [evidence.title, evidence.artist, evidence.album, evidence.description].filter(Boolean).join(" ").toLowerCase();
  if (!plan.requiredSourceWords?.length || !plan.requiredSourceWords.every((word) =>
    typeof word === "string" && word && searchable.includes(word.toLowerCase())))
    throw new Error("Replacement evidence does not corroborate the requested recording");
  if (!realpathSync(source).startsWith(realpathSync(stagingRoot) + sep))
    throw new Error("Replacement must be an explicitly staged acquisition candidate");
  const sourceHash = hash(source);
  const duration = await verifyMp3(source);
  if (!(evidence.durationSeconds > 0) || Math.abs(duration - evidence.durationSeconds) > 2 ||
    (entry.catalogDurationSeconds > 0 && Math.abs(duration - entry.catalogDurationSeconds) > Math.max(3, entry.catalogDurationSeconds * 0.02)))
    throw new Error("Replacement duration does not corroborate the reviewed recording");
  return repairVerifiedAudio({ ...args,
    chapter: { start: 0, end: duration, duration, title: "Complete reviewed replacement recording" },
    prepare: async (_original, result) => {
      copyFileSync(source, result);
      if (hash(source) !== sourceHash || hash(result) !== sourceHash)
        throw new Error("Staged replacement changed during preparation");
    },
  });
}

function spotifyGid(id) {
  if (!/^[A-Za-z0-9]{22}$/.test(id || "")) throw new Error("Explicit Spotify catalog identity is required");
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let value = 0n;
  for (const character of id) value = value * 62n + BigInt(alphabet.indexOf(character));
  const gid = value.toString(16).padStart(32, "0");
  if (gid.length !== 32) throw new Error("Invalid Spotify catalog identity");
  return gid;
}

// These are catalog-derived boundaries, never fabricated YouTube chapters.
// Use only a publisher's complete copy of the exact album, with independent
// millisecond track timings and full-runtime agreement within one second.
export function reviewedCatalogSegment(entry, evidence, plan, catalog) {
  if (entry?.status !== "needs-repair" || !plan?.recordingRationale ||
    !/^[A-Za-z0-9_-]{11}$/.test(plan.videoId || "") || plan.videoId !== evidence?.videoId)
    throw new Error("Reviewed catalog segment requires explicit matching source identity");
  if (entry.catalogAlbumId !== catalog?.albumId || spotifyGid(catalog.albumId) !== catalog.albumGid ||
    !Array.isArray(catalog.tracks) || catalog.tracks.length < 2)
    throw new Error("Exact album catalog is required");
  const linkedAlbum = String(evidence.description || "").split(/\s+/).some((part) => {
    try {
      const url = new URL(part);
      return url.protocol === "https:" && url.hostname === "open.spotify.com" &&
        url.pathname === `/album/${catalog.albumId}`;
    } catch { return false; }
  });
  if (!linkedAlbum || !plan.publisherChannel || evidence.channel !== plan.publisherChannel ||
    !Array.isArray(plan.requiredSourceWords) || !plan.requiredSourceWords.length ||
    !plan.requiredSourceWords.every((word) => typeof word === "string" && word &&
      String(evidence.title || "").toLowerCase().includes(word.toLowerCase())))
    throw new Error("Publisher source does not link the exact requested album");
  const gids = new Set();
  let total = 0;
  let selected = null;
  const targetGid = spotifyGid(entry.catalogTrackId);
  for (const [index, track] of catalog.tracks.entries()) {
    if (track.number !== index + 1 || !/^[a-f0-9]{32}$/.test(track.gid || "") ||
      gids.has(track.gid) || !track.name || !Number.isInteger(track.durationMs) || track.durationMs <= 0)
      throw new Error("Complete ordered millisecond catalog timings are required");
    gids.add(track.gid);
    if (track.gid === targetGid) selected = { track, start: total / 1000 };
    total += track.durationMs;
  }
  if (total !== catalog.totalMs || !(evidence.durationSeconds > 0) ||
    Math.abs(total / 1000 - evidence.durationSeconds) > 1)
    throw new Error("Full source duration does not corroborate the catalog timeline");
  if (!selected || selected.track.name !== entry.catalogTrackName ||
    !(entry.catalogDurationSeconds > 0) ||
    Math.abs(selected.track.durationMs / 1000 - entry.catalogDurationSeconds) > 0.01)
    throw new Error("Requested track identity or duration does not match the catalog");
  const duration = selected.track.durationMs / 1000;
  return {
    start: selected.start, end: selected.start + duration, duration,
    title: selected.track.name, boundaryKind: "catalog-cumulative-milliseconds",
    catalogAlbumId: catalog.albumId, catalogTrackGid: targetGid,
    catalogTotalSeconds: total / 1000,
    alignmentBasis: "Publisher links exact album; complete runtimes agree within one second. Album begins at source time zero; boundaries are derived, not native video chapters.",
  };
}

export async function replaceReviewedCatalogSegment(args) {
  const { source, stagingRoot, catalog, entry, evidence, plan } = args;
  const chapter = reviewedCatalogSegment(entry, evidence, plan, catalog);
  if (!realpathSync(source).startsWith(realpathSync(stagingRoot) + sep))
    throw new Error("Catalog segment requires an explicitly staged complete source");
  const sourceSha256 = hash(source);
  const sourceDurationSeconds = await verifyMp3(source);
  if (Math.abs(sourceDurationSeconds - catalog.totalMs / 1000) > 1 ||
    Math.abs(sourceDurationSeconds - evidence.durationSeconds) > 1)
    throw new Error("Staged source duration does not match the complete catalog album");
  return repairVerifiedAudio({ ...args, chapter,
    sourceProof: { source, sourceSha256, sourceDurationSeconds, catalog },
    prepare: async (_original, result) => {
      if (hash(source) !== sourceSha256) throw new Error("Staged source changed before preparation");
      await exec("/opt/homebrew/bin/ffmpeg", [
        "-nostdin", "-v", "error", "-i", source,
        "-ss", String(chapter.start), "-t", String(chapter.duration),
        "-map", "0:a:0", "-vn", "-map_metadata", "-1",
        "-c:a", "libmp3lame", "-q:a", "0", result,
      ], { timeout: 300000, maxBuffer: 65536 });
      if (hash(source) !== sourceSha256) throw new Error("Staged source changed during preparation");
    },
  });
}

async function repairVerifiedAudio({ entry, evidence, plan, song, downloads, archiveRoot, chapter, prepare, sourceProof }) {
  const root = resolve(downloads);
  const targets = [...new Set(entry.destinations)];
  if (!targets.length || !targets.includes(entry.file) || song.key !== entry.key)
    throw new Error("Repair target identity is incomplete");
  for (const path of targets) {
    if (!resolve(path).startsWith(root + sep) || !song.destinations.includes(path) || !sameOriginal(path, entry))
      throw new Error("A repair target no longer matches the preserved original");
  }
  const originalDuration = await verifyMp3(entry.file);
  if (Math.abs(originalDuration - entry.actualDurationSeconds) > 0.1)
    throw new Error("Original audio has changed since review");
  const keyHash = createHash("sha256").update(entry.key).digest("hex").slice(0, 24);
  const archive = join(resolve(archiveRoot), `${keyHash}-${entry.originalInode}`);
  mkdirSync(archive, { recursive: true, mode: 0o700 });
  const original = join(archive, "original.mp3");
  try { linkSync(entry.file, original); }
  catch (error) {
    if (error.code !== "EEXIST" || !sameOriginal(original, entry)) throw error;
  }
  const originalSha256 = hash(original);
  const work = mkdtempSync(join(archive, "prepare-"));
  const result = join(work, "movement.mp3");
  const recordPath = join(archive, "repair.json");
  const record = {
    key: entry.key, videoId: evidence.videoId, sourceTitle: evidence.title,
    recordingRationale: plan.recordingRationale, reference: entry.reference,
    chapter, original, originalSha256, targets, replaced: [], phase: "preparing",
    startedAt: new Date().toISOString(),
    ...(sourceProof ? { sourceProof } : {}),
  };
  const checkpoint = () => {
    const temp = join(archive, `.record-${randomUUID()}`);
    writeFileSync(temp, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
    renameSync(temp, recordPath);
  };
  checkpoint();
  try {
    if (prepare) await prepare(original, result);
    else await exec("/opt/homebrew/bin/ffmpeg", [
      "-nostdin", "-v", "error", "-i", original,
      "-ss", String(chapter.start), "-t", String(chapter.duration),
      "-map", "0:a:0", "-vn", "-map_metadata", "-1",
      "-c:a", "libmp3lame", "-q:a", "0", result,
    ], { timeout: 300000, maxBuffer: 65536 });
    if (!require("node-id3").write({ title: song.name, artist: song.artist }, result))
      throw new Error("Repair MP3 tagging failed");
    record.outputDurationSeconds = await verifyMp3(result);
    if (Math.abs(record.outputDurationSeconds - chapter.duration) > 0.15)
      throw new Error("Repaired MP3 duration differs from the verified chapter");
    if (hash(original) !== originalSha256 || !targets.every((path) => sameOriginal(path, entry)))
      throw new Error("Original changed during preparation; no canonical files replaced");
    record.outputSha256 = hash(result);
    record.phase = "replacing";
    checkpoint();
    for (const target of targets) {
      if (!sameOriginal(target, entry))
        throw new Error("Target changed before atomic replacement; original remains archived");
      const adjacent = join(dirname(target), `.acquire-repair-${randomUUID()}`);
      try {
        linkSync(result, adjacent);
        renameSync(adjacent, target);
      } finally {
        try { unlinkSync(adjacent); } catch {}
      }
      record.replaced.push(target);
      checkpoint();
    }
    for (const target of targets)
      if (hash(target) !== record.outputSha256)
        throw new Error("Post-repair file verification failed; original remains archived");
    record.phase = "verified";
    record.completedAt = new Date().toISOString();
    checkpoint();
    return { ...record, recordPath };
  } catch (error) {
    record.phase = "needs-review";
    record.error = "Repair did not complete; inspect recorded replacements and preserved original";
    checkpoint();
    throw error;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
