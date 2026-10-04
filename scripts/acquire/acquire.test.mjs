import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  statSync,
  readdirSync,
  readFileSync,
  linkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  catalog,
  database,
  excluded,
  materialize,
  scanAudio,
  eta,
  folder,
  mergeAdmissions,
  fileBase,
} from "./catalog.mjs";
import { Transport, canLaunchYoutubeWork, classify, recoveryCookiesAvailable, verifyMp3, isolateCookieFile } from "./transport.mjs";
import {
  acquisitionEvents,
  acquisitionStatus,
  acquisitionMetrics,
  contentReviewMetrics,
  progressEta,
  pacedEta,
  benchmarkPhases,
} from "./report.mjs";
import { publishMp3, bestEffortPaceMirror } from "./publication.mjs";
import { candidateResultsFromLine, sourceEvidenceFromLine, sourceResultTemplate, withSourceEvidence } from "./source.mjs";
import { reviewedChapter, repairReviewedChapter, replaceReviewedRecording } from "./repair.mjs";
import { ReviewWork, reviewRequests } from "./review-work.mjs";
import { clientCompatibilityForDigest, inspectClientCompatibility, assertClientCompatibility, REVIEWED_YTDLP_SHA256, youtubePlayerClient } from "./client-policy.mjs";
import { controlForOwner } from './live-control.mjs';
import { parseCommandLine } from './cli-options.mjs';

test("client compatibility rejects the reviewed unsupported pairing and never treats unknown binaries or clients as verified", () => {
  const result = clientCompatibilityForDigest(REVIEWED_YTDLP_SHA256, "android_sdkless");
  assert.equal(result.version, "2026.08.19");
  assert.equal(result.compatibility, "unsupported");
  assert.equal(result.ready, false);
  assert.equal(clientCompatibilityForDigest(REVIEWED_YTDLP_SHA256, "visionos").ready, true);
  assert.equal(clientCompatibilityForDigest("0".repeat(64), "visionos").ready, false);
  assert.equal(clientCompatibilityForDigest("0".repeat(64)).compatibility, "unverified");
  assert.equal(clientCompatibilityForDigest(REVIEWED_YTDLP_SHA256, "unreviewed-client").ready, false);
});

test("recovery selects explicit supported clients and keeps anonymous work free of cookie-only clients", () => {
  assert.equal(youtubePlayerClient(false), "visionos");
  assert.equal(youtubePlayerClient(true), "web_creator");
  assert.equal(youtubePlayerClient(true, true), "mweb");
  assert.equal(youtubePlayerClient(false, true), "visionos");
  assert.equal(clientCompatibilityForDigest(REVIEWED_YTDLP_SHA256).ready, true);
  const transport = Object.create(Transport.prototype);
  transport.opts = { authenticated: true };
  assert.equal(transport.cookiesFirst(), true);
});

test("a reviewed staged recording replaces the wrong source while preserving originals and rejecting unscoped candidates", async () => {
  const root = mkdtempSync(join(tmpdir(), "spooty-replacement-test-"));
  try {
    const downloads = join(root, "downloads"), stagingRoot = join(root, "staged");
    mkdirSync(downloads); mkdirSync(stagingRoot);
    const original = join(downloads, "Artist - Piece.mp3"), source = join(stagingRoot, "candidate.mp3");
    for (const [file, seconds] of [[original, 2], [source, 1]]) execFileSync("/opt/homebrew/bin/ffmpeg",
      ["-nostdin", "-v", "error", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, "-q:a", "0", file]);
    const stat = statSync(original), originalBytes = readFileSync(original);
    const entry = { key: "artist - piece", status: "needs-repair", file: original, destinations: [original],
      originalDevice: stat.dev, originalInode: stat.ino, originalBytes: stat.size,
      actualDurationSeconds: await verifyMp3(original), catalogDurationSeconds: 1 };
    const evidence = { videoId: "dQw4w9WgXcQ", title: "Artist Piece", durationSeconds: 1 };
    const args = { entry, evidence, source, stagingRoot, downloads, archiveRoot: join(root, "archive"),
      song: { key: entry.key, name: "Piece", artist: "Artist", destinations: [original] },
      plan: { videoId: evidence.videoId, requiredSourceWords: ["Artist", "Piece"], recordingRationale: "Verified test recording" } };
    await assert.rejects(replaceReviewedRecording({ ...args, source: original }), /explicitly staged/);
    const result = await replaceReviewedRecording(args);
    assert.equal(result.phase, "verified");
    assert.deepEqual(readFileSync(result.original), originalBytes);
    assert.ok(Math.abs(await verifyMp3(original) - 1) < 0.15);
    assert.notEqual(statSync(original).ino, stat.ino);
    await assert.rejects(replaceReviewedRecording(args), /no longer matches/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("each yt-dlp invocation gets an isolated writable cookie jar without modifying the master", () => {
  const root = mkdtempSync(join(tmpdir(), "spooty-cookie-isolation-"));
  try {
    const master = join(root, "master.txt");
    writeFileSync(master, "local-test-fixture");
    const one = isolateCookieFile(["--cookies", master], root);
    const two = isolateCookieFile(["--cookies", master], root);
    assert.notEqual(one.args[1], two.args[1]);
    assert.equal(statSync(one.args[1]).mode & 0o777, 0o600);
    writeFileSync(one.args[1], "");
    assert.equal(readFileSync(master, "utf8"), "local-test-fixture");
    assert.equal(readFileSync(two.args[1], "utf8"), "local-test-fixture");
    one.cleanup(); two.cleanup();
    assert.deepEqual(readdirSync(root), ["master.txt"]);
    const transport = Object.create(Transport.prototype);
    transport.opts = { authenticated: true };
    transport.recoveryCookiesAvailable = () => false;
    assert.equal(transport.recoveryWaitMs(), 60000);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("local client inspection hashes only the binary and refuses unverified input", () => {
  const root = mkdtempSync(join(tmpdir(), "spooty-client-check-"));
  try {
    const binary = join(root, "fixture-binary");
    writeFileSync(binary, "not an executable");
    const result = inspectClientCompatibility(binary);
    assert.equal(result.compatibility, "unverified");
    assert.equal(result.ready, false);
    assert.throws(() => assertClientCompatibility(binary), /pairing has not been verified/);
    assert.equal(readFileSync(binary, "utf8"), "not an executable");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("graceful stop cancels only unadmitted waits and does not kill active process groups", () => {
  const transport = Object.create(Transport.prototype);
  let cancelled = 0;
  transport.sleepers = new Set([{ cancel: () => cancelled++ }]);
  transport.killChildren = () => { throw new Error("must not kill active work"); };
  transport.stopAdmissions();
  assert.equal(transport.stopping, true);
  assert.equal(cancelled, 1);
  assert.equal(classify("YouTube admission cancelled"), "CLI admission cancelled");
  assert.equal(classify("CLI stopping"), "CLI admission cancelled");
});

test("the emergency floor permits one total YouTube batch, while normal profiles retain independent pools", () => {
  const floor = { maxPerWindow: 8, downloadConc: 1, searchConc: 1 };
  assert.equal(canLaunchYoutubeWork(floor, { download: 0, search: 0 }, "download"), true);
  assert.equal(canLaunchYoutubeWork(floor, { download: 1, search: 0 }, "search"), false);
  assert.equal(canLaunchYoutubeWork(floor, { download: 0, search: 1 }, "download"), false);
  assert.equal(canLaunchYoutubeWork({ ...floor, maxPerWindow: 64, downloadConc: 2 },
    { download: 1, search: 0 }, "search"), true);
});

test("candidate search projection retains only public evidence and never accepts an unscoped result", () => {
  const result = candidateResultsFromLine(JSON.stringify({ original_url: "ytsearch5:Artist Piece",
    entries: [{ id: "dQw4w9WgXcQ", title: "Piece", duration: 100,
      description: "Public performer details", cookies: "private-cookie", url: "private-media" }] }));
  assert.equal(result.query, "Artist Piece");
  assert.equal(result.candidates[0].description, "Public performer details");
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(candidateResultsFromLine('{"entries":[]}'), null);
  assert.equal(candidateResultsFromLine('not-json'), null);
});

test("a late publication after a trip cannot be presented as successful recovery", () => {
  const start = Date.parse("2026-09-12T00:00:00Z");
  const pace = { downloadConc: 1, searchConc: 1, maxPerWindow: 8, coolUntil: start + 60000 };
  const phases = benchmarkPhases([
    { type: "block", t: start, pace },
    { type: "mp3_verified", t: start + 50, duration: 100 },
  ], start + 120000);
  assert.equal(phases[0].verifiedNewMp3, 1);
  assert.equal(phases[0].preRecoveryCarryoverMp3, 1);
  assert.equal(phases[0].recoveryQualifiedMp3PerMinute, 0);
});

test("review requests reject arbitrary endpoints, unknown catalog keys, unsafe IDs and oversized work", () => {
  const songs = new Map([["known", { name: "Piece", artist: "Artist" }]]);
  const good = { requests: [{ id: "find-piece", action: "search", key: "known", query: "Artist Piece" }] };
  assert.equal(reviewRequests(good, songs)[0].query, "Artist Piece");
  for (const request of [
    { id: "../escape", action: "search", key: "known" },
    { id: "bad-key", action: "search", key: "unknown" },
    { id: "bad-url", action: "inspect", key: "known", videoId: "https://private.example" },
    { id: "bad-action", action: "delete", key: "known" },
  ]) assert.throws(() => reviewRequests({ requests: [request] }, songs));
  assert.throws(() => reviewRequests({ requests: [good.requests[0], good.requests[0]] }, songs));
  assert.throws(() => reviewRequests({ requests: Array(33).fill(good.requests[0]) }, songs));
});

test("explicit review work stages candidates without mutating the library, deduplicates requests and drains owned tasks", async () => {
  const root = mkdtempSync(join(tmpdir(), "spooty-review-work-test-"));
  try {
    const source = join(root, "fixture.mp3");
    execFileSync("/opt/homebrew/bin/ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi",
      "-i", "sine=frequency=440:duration=1", "-q:a", "0", source]);
    const song = { key: "known", name: "Piece", artist: "Artist", url: "unchanged", state: "saved" };
    const songs = new Map([[song.key, song]]);
    const evidence = { videoId: "dQw4w9WgXcQ", title: "Piece", durationSeconds: 1 };
    const transport = {
      searchCandidates: async (subjects, cb) => { for (const s of subjects) await cb(s, [evidence]); return []; },
      inspectSources: async (subjects, cb, admitted) => { admitted(); for (const s of subjects) await cb(s, evidence); return []; },
      download: async (subjects, cb, admitted) => { admitted(); for (const s of subjects) await cb(s, source, evidence); return []; },
    };
    const failures = [];
    const work = new ReviewWork(root, songs, transport, () => {}, (e) => failures.push(e));
    const request = { requests: [
      { id: "search-1", key: "known", action: "search" },
      { id: "inspect-1", key: "known", action: "inspect", videoId: evidence.videoId },
      { id: "download-1", key: "known", action: "download", videoId: evidence.videoId },
    ] };
    work.enqueue(request);
    work.enqueue(request);
    assert.equal(work.pending.length, 3);
    const active = { download: 0, search: 0 }, tasks = new Set();
    const opts = { pace: { maxPerWindow: 64, downloadConc: 2, searchConc: 1 }, slots: 8, active, tasks, batchSize: 8 };
    assert.equal(work.tryLaunch(opts), true);
    assert.equal(work.tryLaunch(opts), true);
    assert.equal(work.tryLaunch(opts), true);
    assert.equal(work.tryLaunch(opts), false);
    await Promise.all([...tasks]);
    assert.equal(tasks.size, 0);
    assert.equal(failures.length, 0);
    assert.deepEqual(active, { download: 0, search: 0 });
    assert.equal(work.completed, 3);
    assert.equal(song.url, "unchanged");
    assert.equal(song.state, "saved");
    const staged = work.results.entries["download-1"];
    assert.deepEqual(readFileSync(staged.file), readFileSync(source));
    assert.equal(statSync(staged.file).mode & 0o777, 0o600);
    assert.equal(staged.key, "known");
    work.enqueue(request);
    assert.equal(work.pending.length, 0);
    assert.throws(() => work.enqueue({ requests: [{ ...request.requests[0], query: "Different work" }] }), /reused/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("multi-candidate search uses the existing search gate and maps documents to requests without counting MP3s", async () => {
  const transport = Object.create(Transport.prototype);
  transport.paths = { cookies: "/unused" };
  transport.cookiesFirst = () => false;
  transport.pace = { run: async (kind, fn, successes) => {
    assert.equal(kind, "search"); await fn(); assert.equal(successes(), 0);
  } };
  transport.process = async (args, kind, _timeout, onLine) => {
    assert.equal(kind, "search");
    assert.ok(args.includes("ytsearch10:Performer Movement"));
    assert.equal(args.includes("--cookies"), false);
    onLine(JSON.stringify({ original_url: "ytsearch10:Performer Movement",
      entries: [{ id: "dQw4w9WgXcQ", title: "Movement", duration: 400 }] }));
    return { code: 0 };
  };
  const found = [];
  const failures = await transport.searchCandidates([{ key: "request", reviewQuery: "Performer Movement" }],
    (song, candidates) => found.push([song.key, candidates[0].durationSeconds]));
  assert.deepEqual(found, [["request", 400]]);
  assert.deepEqual(failures, []);
});

test("a local movement repair preserves the original, atomically replaces every playlist link and refuses changed targets", async () => {
  const root = mkdtempSync(join(tmpdir(), "spooty-acquire-repair-test-"));
  try {
    const downloads = join(root, "downloads");
    mkdirSync(downloads);
    const first = join(downloads, "first.mp3"), second = join(downloads, "second.mp3");
    execFileSync("/opt/homebrew/bin/ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi",
      "-i", "sine=frequency=440:duration=3", "-q:a", "0", first]);
    linkSync(first, second);
    const original = readFileSync(first), stat = statSync(first);
    const duration = await verifyMp3(first);
    const entry = { key: "fixture", status: "needs-repair", actualDurationSeconds: duration,
      catalogDurationSeconds: 1.5, file: first, destinations: [first, second],
      originalDevice: stat.dev, originalInode: stat.ino, originalBytes: stat.size };
    const evidence = { videoId: "dQw4w9WgXcQ", title: "Fixture Performer",
      durationSeconds: duration, chapters: [{ title: "I. Fixture", startSeconds: 0, endSeconds: 1.5 }] };
    const args = { entry, evidence, plan: { videoId: evidence.videoId, chapterIndex: 0,
      requiredSourceWords: ["Fixture Performer"], recordingRationale: "Synthetic test fixture only" },
      song: { key: entry.key, name: "Fixture movement", artist: "Fixture Performer", destinations: entry.destinations },
      downloads, archiveRoot: join(root, "preserved") };
    const result = await repairReviewedChapter(args);
    assert.equal(result.phase, "verified");
    assert.deepEqual(readFileSync(result.original), original);
    assert.notEqual(statSync(first).ino, stat.ino);
    assert.equal(statSync(first).ino, statSync(second).ino);
    assert.ok(Math.abs(await verifyMp3(first) - 1.5) < 0.15);
    assert.equal(JSON.parse(readFileSync(result.recordPath, "utf8")).replaced.length, 2);
    const require = createRequire(import.meta.url);
    assert.equal(require("node-id3").read(first).title, "Fixture movement");
    const repaired = readFileSync(first);
    await assert.rejects(repairReviewedChapter(args), /no longer matches/);
    assert.deepEqual(readFileSync(first), repaired);
    assert.deepEqual(readFileSync(result.original), original);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("movement repair requires matching source, performers and a chapter close to the independent catalog duration", () => {
  const entry = { status: "needs-repair", actualDurationSeconds: 2000.04, catalogDurationSeconds: 440 };
  const evidence = { videoId: "dQw4w9WgXcQ", title: "Composer: Symphony (Performer Orchestra)",
    durationSeconds: 2000, chapters: [{ title: "I. Allegro", startSeconds: 0, endSeconds: 441 }] };
  const plan = { videoId: evidence.videoId, chapterIndex: 0,
    requiredSourceWords: ["Performer", "Orchestra"], recordingRationale: "Fixture cross-check" };
  assert.equal(reviewedChapter(entry, evidence, plan).duration, 441);
  assert.throws(() => reviewedChapter(entry, evidence, { ...plan, videoId: "aqz-KE-bpKQ" }));
  assert.throws(() => reviewedChapter(entry, evidence, { ...plan, chapterIndex: -1 }));
  assert.throws(() => reviewedChapter(entry, evidence, { ...plan, requiredSourceWords: ["Different Conductor"] }));
  assert.throws(() => reviewedChapter(entry, { ...evidence, chapters: [{ startSeconds: 0, endSeconds: 2000 }] }, plan));
  assert.throws(() => reviewedChapter({ ...entry, status: "resolved" }, evidence, plan));
  assert.throws(() => reviewedChapter(entry, evidence, { ...plan, recordingRationale: "" }));
});

test("source evidence retains bounded public recording and chapter fields, never private info-document fields", () => {
  const evidence = sourceEvidenceFromLine("SPOOTY_RESULT:" + JSON.stringify({
    id: "dQw4w9WgXcQ", filepath: "/private/local/path", title: "Recording\nTitle",
    duration: 100, artist: "Performer", channel: "Label",
    url: "private-media-value", cookies: "private-cookie-value",
    http_headers: { Authorization: "private-authorization-value" },
    chapters: [
      { title: "I. Allegro", start_time: 0, end_time: 40, url: "private-chapter-value" },
      { title: "II. Adagio", start_time: 40, end_time: 100 },
      { title: "Invalid", start_time: 90, end_time: 80 },
      { title: "Outside", start_time: 100, end_time: 200 },
      { title: "Coerced", start_time: null, end_time: 20 },
    ],
  }));
  assert.equal(evidence.title, "Recording Title");
  assert.equal(evidence.videoId, "dQw4w9WgXcQ");
  assert.equal(evidence.durationSeconds, 100);
  assert.equal(evidence.chapters.length, 2);
  assert.equal(JSON.stringify(evidence).includes("private"), false);
  assert.equal(sourceEvidenceFromLine("SPOOTY_RESULT:not-json"), null);
  assert.equal(sourceEvidenceFromLine('SPOOTY_RESULT:{"id":"invalid"}'), null);
  assert.equal(sourceEvidenceFromLine("irrelevant"), null);
  assert.deepEqual(withSourceEvidence(["--print", "after_move:SPOOTY_RESULT:old", "--", "video"]),
    ["--print", sourceResultTemplate, "--", "video"]);
});

test("long Unicode filenames fit the filesystem without changing ordinary names or colliding after truncation", () => {
  assert.equal(fileBase("Artist", "A/B?"), "Artist - AB-");
  const first = fileBase("ศิลปิน", "เพลง".repeat(40) + "a");
  const second = fileBase("ศิลปิน", "เพลง".repeat(40) + "b");
  assert.ok(Buffer.byteLength(first + ".mp3", "utf8") <= 255);
  assert.notEqual(first, second);
  assert.equal(first.includes("�"), false);
  assert.match(first, /-[a-f0-9]{12}$/);
});

test("CLI and web playback generate exactly the same filenames, including long Unicode titles", () => {
  const require = createRequire(import.meta.url);
  const {
    UtilsService,
  } = require("../../src/backend/src/shared/utils.service.ts");
  const web = new UtilsService({ get: () => "/unused" });
  for (const [artist, title] of [
    ["A/B", "C:D"],
    ["", ""],
    ["Sigur Rós", "Fjögur Píanó"],
    ["ศิลปิน", "เพลง".repeat(40)],
    ["a".repeat(250), "b"],
  ]) {
    assert.equal(web.trackFileBase(artist, title), fileBase(artist, title));
  }
});

test("atomic publication supports long valid filenames and preserves existing files on success or tag failure", () => {
  const root = mkdtempSync(join(tmpdir(), "spooty-acquire-publication-"));
  try {
    const source = join(root, "source.mp3");
    const target = join(root, "a".repeat(251) + ".mp3");
    writeFileSync(source, "mp3-fixture");
    assert.equal(
      publishMp3(source, target, {}, () => true),
      true,
    );
    assert.equal(readFileSync(target, "utf8"), "mp3-fixture");
    writeFileSync(source, "replacement");
    assert.throws(
      () => publishMp3(source, target, {}, () => {
        throw new Error("must not retag existing");
      }),
      /occupied/,
    );
    assert.equal(readFileSync(target, "utf8"), "mp3-fixture");
    assert.throws(
      () => publishMp3(source, join(root, "failure.mp3"), {}, () => false),
      /tags could not/,
    );
    assert.equal(
      readdirSync(root).some((p) => p.startsWith(".acquire-")),
      false,
    );
    assert.equal(readdirSync(root).includes("failure.mp3"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("transient backend mirror failure does not interrupt acquisition, while direct final handback still fails closed", async () => {
  let failing = true;
  const sync = async () => {
    if (failing) throw new Error("private upstream detail");
  };
  const events = [];
  const mirror = bestEffortPaceMirror(sync, (...event) => events.push(event));
  assert.equal(await mirror(), false);
  assert.equal(await mirror(), false);
  assert.equal(events.length, 1);
  assert.equal(
    JSON.stringify(events).includes("private upstream detail"),
    false,
  );
  await assert.rejects(sync); // Final handback deliberately bypasses best effort.
  failing = false;
  assert.equal(await mirror(), true);
  assert.equal(events[1][0], "pace_mirror_restored");
});

test("empty or missing recovery cookies do not consume download admissions or launch a process", async () => {
  const root = mkdtempSync(join(tmpdir(), "spooty-acquire-cookie-check-"));
  try {
    const path = join(root, "empty.txt");
    writeFileSync(path, "");
    assert.equal(recoveryCookiesAvailable(path), false);
    assert.equal(recoveryCookiesAvailable(join(root, "missing.txt")), false);
    const transport = Object.create(Transport.prototype);
    transport.paths = { cookies: path, temp: root };
    transport.cookiesFirst = () => false;
    transport.pace = {
      run: () => {
        throw new Error("must not admit");
      },
    };
    const song = {
      key: "restricted",
      url: "https://youtu.be/dQw4w9WgXcQ",
      cookiesNext: true,
    };
    assert.deepEqual(await transport.download([song], () => {}), [
      { song, error: "Recovery cookies file unavailable" },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a track-specific authenticated retry stays separate from first-attempt anonymous work", async () => {
  const root = mkdtempSync(join(tmpdir(), "spooty-acquire-route-test-"));
  try {
    const cookieFixture = join(root, "test-only-cookie-fixture");
    writeFileSync(
      cookieFixture,
      "test fixture - never used for a network call",
    );
    const transport = Object.create(Transport.prototype);
    transport.paths = { cookies: cookieFixture, temp: root };
    transport.runtime = "/test-runtime";
    transport.cookiesFirst = () => false;
    const routes = [],
      admissions = [];
    transport.pace = { run: async (_kind, fn) => fn() };
    transport.process = async (args) => {
      routes.push({
        cookies: args.includes("--cookies"),
        urls: args.slice(args.indexOf("--") + 1),
      });
      return { code: 1, error: "Test-only unresolved result" };
    };
    const songs = [
      { key: "fresh", url: "https://youtu.be/dQw4w9WgXcQ" },
      { key: "retry", url: "https://youtu.be/aqz-KE-bpKQ", cookiesNext: true },
    ];
    await transport.download(
      songs,
      () => {},
      (batch) => admissions.push(batch.map((s) => s.key)),
    );
    assert.deepEqual(routes, [
      { cookies: false, urls: [songs[0].url] },
      { cookies: true, urls: [songs[1].url] },
    ]);
    assert.deepEqual(admissions, [["fresh"], ["retry"]]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing global bot-recovery material waits out recovery policy instead of failing every untouched song", () => {
  const transport = Object.create(Transport.prototype);
  transport.recoveryCookiesAvailable = () => false;
  transport.pace = { snapshot: () => ({ lastBotAt: 1000 }) };
  assert.equal(transport.recoveryWaitMs(2000), 3599000);
  assert.equal(transport.recoveryWaitMs(3601000), 0);
  transport.recoveryCookiesAvailable = () => true;
  assert.equal(transport.recoveryWaitMs(2000), 0);
});

test("catalog excludes dynamic mixes, keeps radio, deduplicates across playlists, and gives files priority over stale errors", async () => {
  const root = mkdtempSync(join(tmpdir(), "spooty-acquire-test-"));
  try {
    const playlists = join(root, "playlists"),
      downloads = join(root, "downloads"),
      dbPath = join(root, "test.sqlite");
    mkdirSync(playlists);
    mkdirSync(downloads);
    const track = { artist: "Artist", name: "Song", id: "spotify-id", durationMs: 1000 };
    for (const [i, name] of [
      "Daily Mix 4",
      "Daily Mixes",
      "DJ",
      "Discover Weekly",
      "Release Radar",
      "On Repeat",
      "Repeat Rewind",
      "Your Daily Drive",
      "Keep",
      "Artist Radio",
    ].entries()) {
      writeFileSync(
        join(playlists, `${i}.json`),
        JSON.stringify({ name, tracks: [track] }),
      );
    }
    writeFileSync(
      join(playlists, "skip.json"),
      JSON.stringify({
        name: "Skip",
        skipped: true,
        tracks: [{ artist: "Other", name: "Ignore" }],
      }),
    );
    const db = database(dbPath);
    await db.run(
      "CREATE TABLE track_entity(id INTEGER,artist TEXT,name TEXT,youtubeUrl TEXT,error TEXT)",
    );
    await db.run("INSERT INTO track_entity VALUES (1,?,?,?,?)", [
      "Artist",
      "Song",
      "https://youtu.be/dQw4w9WgXcQ",
      "No YouTube result",
    ]);
    await db.close();
    const source = join(downloads, "Artist - Song.mp3");
    execFileSync('/opt/homebrew/bin/ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '1', source]);
    const c = await catalog({ playlists, downloads, dbPath });
    assert.equal(c.playlistCount, 2);
    assert.equal(c.occurrences, 2);
    assert.equal(c.songs.size, 1);
    const song = [...c.songs.values()][0];
    assert.equal(song.missing, false);
    assert.equal(song.source, source);
    assert.equal(song.destinations.length, 2);
    assert.equal(materialize(source, song.destinations), 2);
    assert.equal(statSync(source).ino, statSync(song.destinations[0]).ino);
    const disk = scanAudio(downloads);
    assert.equal(disk.paths, 3);
    assert.equal(disk.uniqueInodes, 1);
    assert.equal(disk.bytes, statSync(source).size);
    assert.equal(materialize(source, song.destinations), 0); // Idempotent resume.
    const hidden = join(downloads, ".spooty-download-batch-fixture");
    mkdirSync(hidden);
    writeFileSync(join(hidden, "Other - Song.mp3"), "partial");
    const next = scanAudio(downloads);
    assert.equal(next.byKey.has("other - song"), false);
    assert.equal(next.bytes, disk.bytes + 7);
    writeFileSync(join(downloads, ".Clouds - Autumn Sun.mp3"), "dot-artist");
    const dotPlaylist = join(downloads, "...baby one more time Radio");
    mkdirSync(dotPlaylist);
    writeFileSync(join(dotPlaylist, "Other - Published.mp3"), "dot-playlist");
    const withDots = scanAudio(downloads);
    assert.equal(withDots.byKey.has(".clouds - autumn sun"), true);
    assert.equal(withDots.byKey.has("other - published"), true);
    assert.ok(folder(downloads, "..").startsWith(downloads));
    assert.equal(excluded("DJ Shadow Radio"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ETA uses measured wall clock rate and adds a 25 percent buffer", () => {
  const result = eta(180, 3, Date.UTC(2026, 8, 12));
  assert.equal(result.hours, 1);
  assert.equal(result.continuous, "2026-09-12T01:00:00.000Z");
  assert.equal(result.buffered25, "2026-09-12T01:15:00.000Z");
  assert.equal(eta(180, 0).continuous, null);
});

test("ETA never projects an initial burst above the actual admission ceiling and includes cooldown", () => {
  const start = Date.UTC(2026, 8, 12);
  const forecast = pacedEta(
    64,
    20,
    { maxPerWindow: 64, windowMs: 600000, coolRemainingMs: 60000 },
    start,
  );
  assert.equal(forecast.rateUsedPerMinute, 6.4);
  assert.equal(forecast.cappedStartupBurst, true);
  assert.equal(forecast.continuous, "2026-09-12T00:11:00.000Z");
  assert.equal(forecast.buffered25, "2026-09-12T00:13:30.000Z");
  assert.equal(
    pacedEta(64, 3, { maxPerWindow: 64, windowMs: 600000 }, start)
      .rateUsedPerMinute,
    3,
  );
});

test("benchmark phases separate manual pace changes and never label a partial ten-minute window complete", () => {
  const profile = { downloadConc: 3, searchConc: 1, maxPerWindow: 64 };
  const events = [
    { t: 0, type: "start", profile },
    { t: 1, type: "mp3_verified", duration: 120 },
    { t: 5000, type: "pace_change", pace: profile },
    { t: 600000, type: "pace_change", pace: { ...profile, maxPerWindow: 80 } },
    { t: 600001, type: "mp3_verified", duration: 3600 },
    {
      t: 620000,
      type: "block",
      pace: { downloadConc: 1, searchConc: 1, maxPerWindow: 8 },
    },
  ];
  const result = benchmarkPhases(events, 630000);
  assert.equal(result[0].firstFull10.verifiedNewMp3, 1);
  assert.equal(result[1].firstFull10, null);
  assert.equal(result[1].verifiedNewMp3, 1);
  assert.equal(result[1].longAudioOutputs, 1);
  assert.equal(result[1].rateLimitTrips, 1);
  assert.equal(result[1].profile.maxPerWindow, 80);
  assert.equal(result[2].profile.maxPerWindow, 8);
  assert.equal(result[2].rateLimitTrips, 0);
});

test("ordinary progress reports count CLI publication once and distinguish a live owner from a stale snapshot", () => {
  const root = mkdtempSync(join(tmpdir(), "spooty-acquire-report-"));
  try {
    writeFileSync(
      join(root, "pace-events.jsonl"),
      '{"t":1,"type":"download_start"}\n{"t":3,"type":"download_ok"}\n',
    );
    writeFileSync(
      join(root, "events-test.jsonl"),
      '{"t":2,"type":"mp3_verified"}\n{"t":4,"type":"search_ok"}\n{"incomplete":',
    );
    assert.deepEqual(
      acquisitionEvents(root).map((e) => e.type),
      ["download_start", "download_ok", "search_ok"],
    );
    writeFileSync(
      join(root, "status.json"),
      JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
    );
    assert.equal(
      acquisitionStatus(root, `${process.pid}-owner`).liveOwnerVerified,
      true,
    );
    assert.equal(acquisitionStatus(root, null).liveOwnerVerified, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a failed fast profile cannot supply the held recovery profile's measured rate or ETA", () => {
  const root = mkdtempSync(join(tmpdir(), "spooty-acquire-recovery-report-"));
  try {
    const runId = "2026-09-12T00-00-00-000Z";
    const start = Date.UTC(2026, 8, 12);
    const floor = { downloadConc: 1, searchConc: 1, maxPerWindow: 8, windowMs: 600000 };
    const events = [
      { t: start, type: "start", profile: { ...floor, maxPerWindow: 96 } },
      { t: start + 1000, type: "mp3_verified" },
      { t: start + 60000, type: "block", pace: floor },
      // The snapshot must not include results or control changes after its time.
      { t: start + 180000, type: "mp3_verified" },
      { t: start + 190000, type: "pace_change", pace: { ...floor, maxPerWindow: 64 } },
    ];
    writeFileSync(join(root, `events-${runId}.jsonl`), events.map((e) => JSON.stringify(e)).join("\n"));
    const status = {
      runId,
      at: new Date(start + 120000).toISOString(),
      phase: "waiting-for-recovery",
      mp3PerMinute: 9,
      remainingUnique: 8,
      recoveryWaitMs: 60000,
      pace: floor,
    };
    const metrics = acquisitionMetrics(root, status);
    assert.equal(metrics.wholeRunMp3PerMinute, 9);
    assert.equal(metrics.currentProfileMp3PerMinute, 0);
    assert.equal(metrics.currentProfileBaselineMultiple, 0);
    assert.equal(metrics.throughputState, "held");
    assert.equal(metrics.eta.continuous, null);
    assert.equal(metrics.etaAtAdmissionCeiling.conditional, true);
    assert.equal(metrics.etaAtAdmissionCeiling.rateUsedPerMinute, 0.8);
    assert.equal(metrics.etaAtAdmissionCeiling.continuous, "2026-09-12T00:13:00.000Z");
    assert.equal(metrics.earliestRecoveryAt, "2026-09-12T00:03:00.000Z");
    writeFileSync(join(root, "status.json"), JSON.stringify({ ...status, pid: process.pid }));
    assert.equal(acquisitionStatus(root, `${process.pid}-owner`).eta.continuous, null);
    const resumed = acquisitionMetrics(root, {
      ...status,
      at: new Date(start + 185000).toISOString(),
      phase: "running",
      recoveryWaitMs: 0,
    });
    assert.equal(resumed.throughputState, "running");
    assert.equal(resumed.currentProfileMp3PerMinute, 60000 / 125000);
    assert.equal(resumed.earliestRecoveryAt, null);
    assert.notEqual(resumed.eta.continuous, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("known content mismatches remain separate from MP3 validity and block overall completion", () => {
  const root = mkdtempSync(join(tmpdir(), "spooty-acquire-content-review-"));
  const path = join(root, "quality-review.json");
  try {
    assert.equal(contentReviewMetrics(root, "run-a").completionBlockedByContentReview, false);
    writeFileSync(path, JSON.stringify({ entries: [
      { key: "movement", runId: "run-a", status: "needs-review" },
      { key: "movement", runId: "run-a", status: "needs-repair" },
      { key: "older", runId: "run-b", status: "needs-repair" },
      { key: "fixed", runId: "run-a", status: "resolved" },
    ] }));
    assert.deepEqual(contentReviewMetrics(root, "run-a"), {
      contentReviewPendingUnique: 2,
      contentReviewInCurrentRun: 1,
      contentReviewReadError: false,
      completionBlockedByContentReview: true,
    });
    const metrics = acquisitionMetrics(root, {
      at: "2026-09-12T12:00:00.000Z", phase: "complete", remainingUnique: 0,
      mp3PerMinute: 8, pace: { maxPerWindow: 80, windowMs: 600000 },
    });
    assert.equal(metrics.currentProfileMp3PerMinute, 8);
    assert.equal(metrics.completionBlockedByContentReview, true);
    assert.match(metrics.verificationScope, /not recording identity/);
    assert.match(metrics.etaScope, /unresolved content repair not estimated/);
    writeFileSync(path, "{");
    assert.equal(contentReviewMetrics(root, "run-a").contentReviewReadError, true);
    assert.equal(contentReviewMetrics(root, "run-a").contentReviewPendingUnique, null);
    writeFileSync(path, JSON.stringify({ entries: [{ key: "movement", status: "resolved" }] }));
    assert.equal(contentReviewMetrics(root, "run-a").completionBlockedByContentReview, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ordinary historical ETA fields cannot project through a live CLI recovery hold at the old fast rate", () => {
  const start = Date.UTC(2026, 8, 12);
  const acquisition = {
    liveOwnerVerified: true,
    currentProfileMp3PerMinute: 0,
    recoveryWaitMs: 60000,
    pace: { maxPerWindow: 8, windowMs: 600000 },
  };
  assert.equal(progressEta(9, 8, acquisition, start), null);
  assert.equal(
    progressEta(9, 8, { ...acquisition, liveOwnerVerified: false }, start).rateUsedPerMinute,
    9,
  );
  const resumed = progressEta(9, 8, { ...acquisition, currentProfileMp3PerMinute: 1 }, start);
  assert.equal(resumed.rateUsedPerMinute, 0.8);
  assert.equal(resumed.at, "2026-09-12T00:11:00.000Z");
  assert.equal(resumed.buffer25At, "2026-09-12T00:13:30.000Z");
});

test("stop cannot reapply an earlier fast pace over a subsequently tripped safety floor", () => {
  const control = controlForOwner({ pid: 123, runId: 'current' },
    { ownerCheck: 'verified', liveOwnerVerified: true }, { stop: true, updatedAt: Date.now() },
    { targetRunId: 'current', pace: { maxPerWindow: 96, downloadConc: 3 }, updatedAt: 1 });
  assert.equal(control.stop, true);
  assert.equal(control.pace, undefined);
  assert.ok(control.updatedAt > 1);
});

test("the next bounded allowance trial changes only its lever and rejects values beyond the trial ceiling", () => {
  const owner = { ownerCheck: 'verified', liveOwnerVerified: true }, status = { pid: 123, runId: 'current' };
  for (const limit of [192, 216, 240]) {
    const parsed = parseCommandLine(['pace', '--window', String(limit)]);
    const control = controlForOwner(status, owner, { pace: { maxPerWindow: Number(parsed.options.window) } },
      { targetRunId: 'current', pace: { downloadConc: 4, searchConc: 1 } });
    assert.deepEqual(control.pace, { maxPerWindow: limit });
  }
  assert.throws(() => parseCommandLine(['pace', '--window', '241']), /Invalid --window/);
  const parsed = parseCommandLine(['pace', '--download-conc', '5']);
  assert.equal(parsed.options.window, undefined);
  assert.deepEqual(controlForOwner(status, owner, { pace: { downloadConc: Number(parsed.options['download-conc']) } }).pace, { downloadConc: 5 });
});

test("inspection control refuses an old worker and never reapplies pace or cancels a requested stop", () => {
  const root = mkdtempSync(join(tmpdir(), "spooty-acquire-inspect-control-"));
  const cli = new URL("../acquire.mjs", import.meta.url).pathname;
  const env = { ...process.env, ACQUIRE_STATE_PATH: root };
  try {
    const before = { pace: { maxPerWindow: 104 }, stop: true, updatedAt: 1 };
    writeFileSync(join(root, "control.json"), JSON.stringify(before));
    assert.throws(() => execFileSync(process.execPath, [cli, "inspect-review"], { env, stdio: "pipe" }));
    assert.deepEqual(JSON.parse(readFileSync(join(root, "control.json"), "utf8")), before);
    writeFileSync(join(root, "status.json"), JSON.stringify({ sourceReview: {} }));
    // A compatible but stale snapshot is no longer sufficient authority.
    assert.throws(() => execFileSync(process.execPath, [cli, "inspect-review"], { env, stdio: 'pipe' }));
    assert.deepEqual(JSON.parse(readFileSync(join(root, "control.json"), "utf8")), before);
    const after = controlForOwner({ runId: 'current', pid: 123 }, { ownerCheck: 'verified', liveOwnerVerified: true },
      { inspectReviewAt: Date.now() }, { ...before, targetRunId: 'current' });
    assert.equal(after.stop, true);
    assert.equal(after.pace, undefined);
    assert.equal(after.updatedAt, undefined);
    assert.ok(after.inspectReviewAt > 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("source inspection is charged to the download gate, deduplicates videos and cannot count as an MP3 success", async () => {
  const transport = Object.create(Transport.prototype);
  transport.paths = { cookies: "/does-not-exist" };
  transport.runtime = "/runtime";
  transport.cookiesFirst = () => false;
  let admitted = false;
  transport.pace = { run: async (kind, fn, successes, units) => {
    assert.equal(kind, "download");
    assert.equal(units, 2);
    await fn();
    assert.equal(successes(), 0);
  } };
  transport.process = async (args, kind, _timeout, onLine) => {
    assert.equal(admitted, true);
    assert.equal(kind, "download");
    assert.equal(args.includes("--skip-download"), true);
    assert.equal(args.includes("--cookies"), false);
    assert.equal(args.includes("--dump-json"), false);
    assert.equal(args.filter((a) => a === "https://youtu.be/dQw4w9WgXcQ").length, 1);
    onLine('SPOOTY_SOURCE:{"id":"dQw4w9WgXcQ","title":"Full work","duration":100,"chapters":[{"title":"I.","start_time":0,"end_time":40}]}');
    return { code: 1, error: "Selected YouTube video unavailable" };
  };
  const songs = [
    { key: "a", url: "https://youtu.be/dQw4w9WgXcQ" },
    { key: "b", url: "https://youtu.be/dQw4w9WgXcQ" },
    { key: "c", url: "https://youtu.be/aqz-KE-bpKQ" },
  ];
  const found = [];
  const failures = await transport.inspectSources(songs, (song, evidence) => {
    found.push(song.key);
    assert.equal(evidence.chapters[0].endSeconds, 40);
  }, () => { admitted = true; });
  assert.deepEqual(found, ["a", "b"]);
  assert.deepEqual(failures.map((f) => f.song.key), ["c"]);
});

test("crash recovery merges both admission histories without losing batch credits or double-counting mirrors", () => {
  assert.deepEqual(
    mergeAdmissions([100, 200, 200], [200, 200, 200, 300], 400, 250),
    [200, 200, 200, 300],
  );
  assert.deepEqual(
    mergeAdmissions([200, 200], [200, 200], 400, 600000),
    [200, 200],
  );
});

test("error classification excludes local routing and does not expose raw upstream credentials", () => {
  assert.equal(
    classify("Unable to download API page: No route to host (Errno 65)"),
    "Local network unavailable",
  );
  assert.equal(
    classify("ERROR HTTP Error 429: token=private-placeholder"),
    "YouTube rate limit or bot check",
  );
  assert.equal(
    classify("[download] 48% at 429.51KiB/s"),
    "YouTube attempt did not produce a verified result",
  );
  assert.equal(
    classify("Sign in to confirm your age. Use --cookies with a private value"),
    "YouTube age verification requires cookies",
  );
  assert.equal(
    classify("Output failed MP3 codec/duration verification"),
    "Output failed MP3 codec/duration verification",
  );
});

test("batched search maps out-of-order documents by query; malformed or omitted results remain retryable", async () => {
  const transport = Object.create(Transport.prototype);
  transport.paths = { cookies: "/does-not-exist" };
  transport.cookiesFirst = () => false;
  transport.pace = { run: async (_kind, fn) => fn() };
  transport.process = async (_args, _kind, _timeout, onLine) => {
    onLine(JSON.stringify({ original_url: "ytsearch1:B Second", entries: [] }));
    onLine("incomplete JSON");
    onLine(
      JSON.stringify({
        original_url: "ytsearch1:A First",
        entries: [{ url: "https://youtu.be/dQw4w9WgXcQ" }],
      }),
    );
    return { error: "timeout", code: 1 };
  };
  const songs = [
    { key: "a", artist: "A", name: "First" },
    { key: "b", artist: "B", name: "Second" },
    { key: "c", artist: "C", name: "Third" },
  ];
  const found = [];
  const failed = await transport.search(songs, async (song, url) =>
    found.push([song.key, url]),
  );
  assert.deepEqual(found, [
    ["b", null],
    ["a", "https://youtu.be/dQw4w9WgXcQ"],
  ]);
  assert.deepEqual(
    failed.map((f) => f.song.key),
    ["c"],
  );
});

test("multi-URL download streams successful members before batch exit and retries only unresolved songs", async () => {
  const root = mkdtempSync(join(tmpdir(), "spooty-acquire-transport-"));
  try {
    const transport = Object.create(Transport.prototype);
    transport.paths = { cookies: "/does-not-exist", temp: root };
    transport.runtime = "/runtime";
    transport.cookiesFirst = () => false;
    let units,
      admitted = false,
      delivered = false;
    transport.pace = {
      run: async (_kind, fn, _success, starts) => {
        units = starts;
        return fn();
      },
    };
    transport.process = async (args, _kind, _timeout, onLine) => {
      assert.equal(admitted, true);
      assert.equal(args[args.indexOf("-f") + 1], "ba/bestaudio/18/best");
      assert.equal(args.includes("--cookies"), false);
      assert.equal(args.includes(sourceResultTemplate), true);
      const path = args[args.indexOf("-o") + 1]
        .replace("%(id)s", "dQw4w9WgXcQ")
        .replace("%(ext)s", "mp3");
      writeFileSync(path, "simulated transport output");
      onLine(
        "SPOOTY_RESULT:" +
          JSON.stringify({ id: "dQw4w9WgXcQ", filepath: path, title: "Published source", duration: 42 }),
      );
      await new Promise((yes) => setImmediate(yes));
      assert.equal(delivered, true);
      return { code: 1, error: "Selected YouTube video unavailable" };
    };
    const songs = [
      { key: "a", url: "https://youtu.be/dQw4w9WgXcQ" },
      { key: "b", url: "https://youtu.be/aqz-KE-bpKQ" },
    ];
    const failed = await transport.download(
      songs,
      async (_song, _source, evidence) => {
        assert.equal(evidence.title, "Published source");
        assert.equal(evidence.durationSeconds, 42);
        delivered = true;
      },
      (members) => {
        assert.equal(members, songs);
        admitted = true;
      },
    );
    assert.equal(units, 2);
    assert.deepEqual(
      failed.map((f) => f.song.key),
      ["b"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the first split bot-check output trips the pace floor and stops all owned children before exit", async () => {
  const transport = Object.create(Transport.prototype);
  const child = new EventEmitter();
  child.pid = 123;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const calls = [];
  transport.spawn = () => child;
  transport.bin = "unused";
  transport.children = new Map();
  transport.pace = {
    snapshot: () => ({ coolRemainingMs: 0 }),
    tripRateLimit: (...args) => calls.push(["trip", ...args]),
  };
  transport.emit = (type) => calls.push([type]);
  transport.killChildren = () => calls.push(["kill-all-owned"]);
  const result = transport.process([], "download", 10000);
  await Promise.resolve(); // Shared web pre-spawn ownership hook is asynchronous.
  child.stderr.emit("data", "ERROR: Sign in to con");
  assert.deepEqual(calls, [["process_start"]]);
  child.stderr.emit("data", "firm you are not a bot");
  assert.equal(calls[1][0], "trip");
  assert.ok(calls.some((c) => c[0] === "kill-all-owned"));
  child.stderr.emit("data", "HTTP Error 429");
  assert.equal(calls.filter((c) => c[0] === "trip").length, 1);
  child.emit("close", 137);
  assert.equal((await result).error, "YouTube rate limit or bot check");
  assert.equal(transport.children.size, 0);
});

test("successful 429-second metadata and quoted bot-check text cannot trip the safety floor", async () => {
  const transport = Object.create(Transport.prototype);
  const child = new EventEmitter();
  child.pid = 123;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const calls = [], lines = [];
  transport.spawn = () => child;
  transport.bin = "unused";
  transport.children = new Map();
  transport.pace = { snapshot: () => ({ coolRemainingMs: 0 }),
    tripRateLimit: () => calls.push("trip") };
  transport.emit = (type) => calls.push(type);
  transport.killChildren = () => calls.push("kill");
  const pending = transport.process([], "download", 10000, (line) => lines.push(line));
  await Promise.resolve();
  child.stdout.emit("data", 'SPOOTY_RESULT:{"id":"ZFmwtX3Ts2M","title":"Come Together","duration":429}\n');
  child.stdout.emit("data", 'SPOOTY_SOURCE:{"description":"Sign in to confirm you are ');
  child.stdout.emit("data", 'not a bot; HTTP Error 429","duration":84}\n');
  child.stderr.emit("data", '[download] 48% of 2.95MiB at 429.51KiB/s\n');
  assert.equal(lines.length, 2);
  assert.ok(!calls.includes("trip") && !calls.includes("kill"));
  child.emit("close", 0);
  const result = await pending;
  assert.equal(result.code, 0);
  assert.equal(result.error, null, "successful structured output must not carry a generic operational error");
});
