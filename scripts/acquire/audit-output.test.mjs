import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, linkSync, symlinkSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectOutputs, verifyOutputs } from "./audit-output.mjs";

test("audit counts only original publications in a completed half-open interval", () => {
  const start = Date.parse("2026-09-13T01:00:00Z"), end = start + 600000;
  const events = [
    { type: "mp3_verified", t: start - 1, key: "before", file: "x" },
    { type: "mp3_verified", t: start, key: "included", file: "x" },
    { type: "review_work_done", t: start + 1, key: "repair", file: "x" },
    { type: "mp3_verified", t: end, key: "after", file: "x" },
  ];
  assert.deepEqual(selectOutputs(events, new Date(start).toISOString(), new Date(end).toISOString(), end).map((e) => e.key), ["included"]);
  assert.throws(() => selectOutputs([], new Date(start).toISOString(), new Date(end).toISOString(), end - 1), /completed/);
  assert.throws(() => selectOutputs([events[1], events[1]], new Date(start).toISOString(), new Date(end).toISOString(), end), /Duplicate/);
});

test("audit independently verifies physical files without network or duplicate-inode inflation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spooty-output-audit-"));
  try {
    const downloads = join(dir, "downloads"); mkdirSync(downloads);
    const a = join(downloads, "a.mp3"), b = join(downloads, "b.mp3");
    writeFileSync(a, "audio fixture"); linkSync(a, b);
    const result = await verifyOutputs([{ key: "a", file: a }, { key: "b", file: b }], downloads, async () => ({ codec: "mp3", duration: 12 }));
    assert.equal(result.independentlyVerifiedUniqueInodes, 1);
    assert.equal(result.independentlyVerifiedBytes, 13);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0].error, /same physical/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("audit rejects staging, out-of-root links, invalid audio and changing files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spooty-output-audit-"));
  try {
    const downloads = join(dir, "downloads"); mkdirSync(downloads);
    const staging = join(downloads, ".spooty-download-batch-test"); mkdirSync(staging);
    const staged = join(staging, "s.mp3"); writeFileSync(staged, "staged");
    const outside = join(dir, "outside.mp3"); writeFileSync(outside, "outside");
    const linked = join(downloads, "link.mp3"); symlinkSync(outside, linked);
    const bad = join(downloads, "bad.mp3"); writeFileSync(bad, "bad");
    const changed = join(downloads, "changed.mp3"); writeFileSync(changed, "old");
    const result = await verifyOutputs([staged, linked, bad, changed].map((file) => ({ key: file, file })), downloads, async (file) => {
      if (file === realpathSync(changed)) writeFileSync(changed, "changed after stat");
      return { codec: file === realpathSync(bad) ? "aac" : "mp3", duration: 1 };
    });
    assert.equal(result.independentlyVerifiedUniqueKeys, 0);
    assert.equal(result.failures.length, 4);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
