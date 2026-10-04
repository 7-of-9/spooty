#!/usr/bin/env node
// Read-only, offline verification of a completed CLI benchmark window.
// This process never imports the transport or launches YouTube work.
import { readFileSync, realpathSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify, parseArgs } from "node:util";
import { resolve, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { acquisitionBenchmark } from "./report.mjs";
import { SourceReviewIndex } from './review-identity.mjs';

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function openReviewsForOutputs(outputs, entries) {
  const index = new SourceReviewIndex(entries);
  return [...new Set(outputs.flatMap(output => index.forTrack(output)
    .filter(entry => entry.status !== 'resolved').map(entry => entry.key)))];
}

export function selectOutputs(events, from, to, now = Date.now()) {
  const start = Date.parse(from), end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end > now)
    throw new Error("Audit requires a completed, positive-duration interval");
  const outputs = events.filter((e) => e.type === "mp3_verified" && e.t >= start && e.t < end);
  const keys = new Set();
  for (const output of outputs) {
    if (typeof output.key !== "string" || !output.key || typeof output.file !== "string")
      throw new Error("Malformed publication event");
    if (keys.has(output.key)) throw new Error("Duplicate song publication in audit interval");
    keys.add(output.key);
  }
  return outputs;
}

async function probeMp3(path) {
  const { stdout } = await execute("/opt/homebrew/bin/ffprobe", [
    "-v", "error", "-select_streams", "a:0", "-show_entries",
    "stream=codec_name:format=duration", "-of", "json", path,
  ], { timeout: 10000, maxBuffer: 65536 });
  const info = JSON.parse(stdout);
  return { codec: info.streams?.[0]?.codec_name, duration: Number(info.format?.duration) };
}

export async function verifyOutputs(outputs, downloads, probe = probeMp3) {
  const base = realpathSync(downloads) + sep;
  const inodes = new Set(), files = [], failures = [];
  let bytes = 0, cursor = 0;
  async function worker() {
    while (cursor < outputs.length) {
      const output = outputs[cursor++];
      try {
        const path = realpathSync(output.file);
        if (!path.startsWith(base) || path.slice(base.length).split(sep).some((p) => p.startsWith(".spooty-download-batch-")))
          throw new Error("Publication is outside the published download tree");
        const before = statSync(path);
        if (!before.isFile() || before.size <= 0) throw new Error("Publication is empty or not a regular file");
        const audio = await probe(path);
        const after = statSync(path);
        if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
          throw new Error("Publication changed during the audit; retry the audit");
        if (audio.codec !== "mp3" || !Number.isFinite(audio.duration) || audio.duration <= 0)
          throw new Error("Publication is not a positive-duration MP3");
        const inode = `${after.dev}:${after.ino}`;
        if (inodes.has(inode)) throw new Error("Multiple song events refer to the same physical MP3 inode");
        inodes.add(inode);
        bytes += after.size;
        files.push({ key: output.key, file: path, device: after.dev, inode: after.ino,
          bytes: after.size, durationSeconds: audio.duration });
      } catch (error) {
        // Never emit subprocess stderr; the audit reports only local validation errors.
        failures.push({ key: output.key, error: error.code ? `File/probe failure (${error.code})` : error.message });
      }
    }
  }
  await Promise.all([worker(), worker()]);
  return { independentlyVerifiedUniqueKeys: files.length, independentlyVerifiedUniqueInodes: inodes.size,
    independentlyVerifiedBytes: bytes, failures, files: files.sort((a, b) => a.key.localeCompare(b.key)) };
}

async function main() {
  const { values } = parseArgs({ options: {
    "run-id": { type: "string" }, from: { type: "string" }, to: { type: "string" },
    details: { type: "boolean", default: false },
  } });
  const state = join(root, "data/acquire");
  const status = JSON.parse(readFileSync(join(state, "status.json"), "utf8"));
  const runId = values["run-id"] || status.runId;
  const now = Date.now();
  // Validates run ID and exclusion records before constructing event-file paths.
  const phases = acquisitionBenchmark(state, runId, now);
  const phase = phases.at(-1);
  const from = values.from || phase?.lastFull10?.startedAt;
  const to = values.to || phase?.lastFull10?.endedAt;
  if (!from || !to) throw new Error("No complete ten-minute window yet; provide a completed --from/--to interval");
  if (!!values.from !== !!values.to) throw new Error("Supply both --from and --to");
  const lines = readFileSync(join(state, `events-${runId}.jsonl`), "utf8").split("\n");
  // A live writer may have an incomplete final line. Completed lines are strict JSON.
  if (lines.at(-1) !== "") lines.pop();
  const events = lines.filter(Boolean).map((line) => JSON.parse(line));
  const outputs = selectOutputs(events, from, to, now);
  const start = Date.parse(from), end = Date.parse(to);
  const matched = phases.find((p) => Date.parse(p.startedAt) <= start && (!p.endedAt || Date.parse(p.endedAt) >= end));
  if (!matched) throw new Error("Audit interval crosses experimental profiles");
  const exclusions = matched.benchmarkExclusions.filter((e) => Date.parse(e.startedAt) < end && Date.parse(e.endedAt) > start);
  const review = JSON.parse(readFileSync(join(state, "quality-review.json"), "utf8"));
  if (!Array.isArray(review.entries)) throw new Error("Invalid recording-review ledger");
  const verified = await verifyOutputs(outputs, join(root, "downloads"));
  if (!values.details) delete verified.files;
  const minutes = (end - start) / 60000;
  const result = { version: 1, runId, from, to, profile: matched.profile,
    verifiedNewMp3: outputs.length, mp3PerMinute: outputs.length / minutes,
    baselineMp3PerMinute: 3, baselineMultiple: outputs.length / minutes / 3,
    excludedFromSoleOwnerBenchmark: exclusions.length > 0, benchmarkExclusions: exclusions,
    rateLimitTrips: events.filter((e) => e.type === "block" && e.t >= start && e.t < end).length,
    retries: events.filter((e) => e.type === "retry" && e.t >= start && e.t < end).length,
    auditedAt: new Date().toISOString(), ...verified,
    knownOpenRecordingReviewsInWindow: openReviewsForOutputs(outputs, review.entries),
    scope: "Independent current filesystem MP3 codec and positive duration; not recording identity. Counts only original publication events, not review staging or repairs. No YouTube work or file mutation by this audit.",
  };
  console.log(JSON.stringify(result));
  if (verified.failures.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
