import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewedCatalogSegment, replaceReviewedCatalogSegment } from "./repair.mjs";

const entry = { key: "artist - second - mixed", status: "needs-repair",
  catalogAlbumId: "0000000000000000000001", catalogTrackId: "0000000000000000000003",
  catalogTrackName: "Second - Mixed", catalogDurationSeconds: 2 };
const catalog = { albumId: entry.catalogAlbumId, albumGid: "00000000000000000000000000000001", totalMs: 4000,
  tracks: [
    { number: 1, gid: "00000000000000000000000000000002", name: "First", durationMs: 1000 },
    { number: 2, gid: "00000000000000000000000000000003", name: entry.catalogTrackName, durationMs: 2000 },
    { number: 3, gid: "00000000000000000000000000000004", name: "Third", durationMs: 1000 },
  ] };
const evidence = { videoId: "abcdefghijk", durationSeconds: 4, title: "Publisher Summer Mix", channel: "Publisher",
  description: `Exact album https://open.spotify.com/album/${entry.catalogAlbumId}?si=public` };
const plan = { videoId: evidence.videoId, recordingRationale: "Verified fixture publisher and exact album",
  publisherChannel: "Publisher", requiredSourceWords: ["Summer", "Mix"] };

test("catalog segment uses precise ordered timings and explicitly labels derived boundaries", () => {
  const result = reviewedCatalogSegment(entry, evidence, plan, catalog);
  assert.equal(result.start, 1); assert.equal(result.end, 3); assert.equal(result.duration, 2);
  assert.equal(result.boundaryKind, "catalog-cumulative-milliseconds");
});

test("catalog repair rejects different albums, publishers, runtimes, tracks and incomplete timing", () => {
  for (const [e, v, p, c] of [
    [{ ...entry, status: "needs-review" }, evidence, plan, catalog],
    [entry, { ...evidence, description: "An unrelated mix" }, plan, catalog],
    [entry, { ...evidence, channel: "Other" }, plan, catalog],
    [entry, { ...evidence, durationSeconds: 6 }, plan, catalog],
    [{ ...entry, catalogTrackId: "0000000000000000000005" }, evidence, plan, catalog],
    [{ ...entry, catalogTrackName: "Wrong" }, evidence, plan, catalog],
    [entry, evidence, plan, { ...catalog, totalMs: 5000 }],
    [entry, evidence, plan, { ...catalog, tracks: catalog.tracks.slice(1) }],
    [entry, evidence, plan, { ...catalog, tracks: [...catalog.tracks].reverse() }],
    [entry, evidence, plan, { ...catalog, tracks: catalog.tracks.map(t => ({ ...t, durationMs: t.durationMs + 0.1 })) }],
  ]) assert.throws(() => reviewedCatalogSegment(e, v, p, c));
});

test("staged exact-album segment preserves the wrong original and records independent source proof", async () => {
  const root = mkdtempSync(join(tmpdir(), "spooty-catalog-segment-"));
  try {
    const downloads = join(root, "downloads"), stagingRoot = join(root, "staging");
    mkdirSync(downloads); mkdirSync(stagingRoot);
    const original = join(downloads, "wrong.mp3"), source = join(stagingRoot, "mix.mp3");
    for (const [path, seconds] of [[original, 6], [source, 4]])
      execFileSync("/opt/homebrew/bin/ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i",
        `sine=frequency=440:duration=${seconds}`, "-c:a", "libmp3lame", "-q:a", "0", path]);
    const probe = JSON.parse(execFileSync("/opt/homebrew/bin/ffprobe", ["-v", "error", "-show_format", "-of", "json", original], { encoding: "utf8" }));
    const originalHash = createHash("sha256").update(readFileSync(original)).digest("hex");
    const s = statSync(original);
    const detailed = { ...entry, file: original, destinations: [original], actualDurationSeconds: Number(probe.format.duration),
      originalDevice: s.dev, originalInode: s.ino, originalBytes: s.size };
    const result = await replaceReviewedCatalogSegment({ entry: detailed, evidence, plan, catalog, source, stagingRoot,
      downloads, archiveRoot: join(root, "archive"), song: { key: entry.key, name: entry.catalogTrackName, artist: "Artist", destinations: [original] } });
    assert.equal(result.phase, "verified");
    assert.equal(createHash("sha256").update(readFileSync(result.original)).digest("hex"), originalHash);
    assert.equal(result.sourceProof.catalog.totalMs, 4000);
    assert.equal(result.chapter.start, 1);
    assert.ok(Math.abs(result.outputDurationSeconds - 2) < 0.15);
    assert.notEqual(statSync(original).ino, s.ino);
    assert.equal(JSON.parse(readFileSync(result.recordPath)).sourceProof.source, source);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
