import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync, linkSync, renameSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markDurationAudit, verifiedAuditFinding } from './mark-duration-audit.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'spooty-audit-marks-test-'));
  const downloads = join(root, 'downloads'); mkdirSync(downloads);
  const file = join(downloads, 'Artist - Song.mp3'); writeFileSync(file, 'existing media must remain untouched');
  const s = statSync(file);
  const finding = { key: 'artist - song', state: 'probable-bad-duration', fileId: `${s.dev}-${s.ino}`,
    expectedDurationMs: 180000, spotifyId: '1111111111111111111111', actualDurationSeconds: 3600,
    fingerprint: { dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs }, paths: [file], checkedAt: '2026-09-13T06:00:00Z' };
  const findingsPath = join(root, 'findings.json'), ledgerPath = join(root, 'quality-review.json');
  const report = findings => writeFileSync(findingsPath, JSON.stringify({ version: 1, snapshotId: 'test-snapshot', complete: false, findings }));
  report([finding]);
  return { root, downloads, file, finding, findingsPath, ledgerPath, report, clean: () => rmSync(root, { recursive: true, force: true }) };
}

test('duration mismatch is marked once, preserves media/hardlinks, and does not classify unknowns as bad', () => {
  const f = fixture();
  try {
    const original = readFileSync(f.file), alias = join(f.downloads, 'Another.mp3'); linkSync(f.file, alias);
    f.finding.paths.push(alias);
    f.report([f.finding, { ...f.finding, key: 'unknown', state: 'missing-source-metadata' }, { ...f.finding, key: 'unreadable', state: 'unreadable' }]);
    const first = markDurationAudit(f);
    assert.equal(first.markedUnique, 1);
    const ledger = JSON.parse(readFileSync(f.ledgerPath));
    assert.equal(ledger.entries.length, 1);
    assert.equal(ledger.entries[0].status, 'needs-review');
    assert.equal(ledger.entries[0].durationAudit.files[0].toleranceSeconds, 9);
    assert.equal(ledger.entries[0].destinations.length, 2);
    assert.equal(statSync(f.ledgerPath).mode & 0o777, 0o600);
    const bytes = readFileSync(f.ledgerPath);
    assert.equal(markDurationAudit(f).markedUnique, 0);
    assert.deepEqual(readFileSync(f.ledgerPath), bytes);
    assert.deepEqual(readFileSync(f.file), original);
    assert.equal(statSync(f.file).ino, statSync(alias).ino);
  } finally { f.clean(); }
});

test('stale fingerprints, plausible lengths and paths outside downloads cannot create a probable-bad flag', () => {
  const f = fixture();
  try {
    assert.equal(verifiedAuditFinding({ ...f.finding, actualDurationSeconds: 185 }, f.downloads), null);
    assert.equal(verifiedAuditFinding({ ...f.finding, expectedDurationMs: null }, f.downloads), null);
    const outside = join(f.root, 'outside.mp3'); renameSync(f.file, outside); symlinkSync(outside, f.file);
    assert.equal(verifiedAuditFinding(f.finding, f.downloads), null);
    rmSync(f.file); writeFileSync(f.file, 'new publication at the same path');
    const result = markDurationAudit(f);
    assert.equal(result.markedUnique, 0);
    assert.equal(result.staleOrInvalidCount, 1);
  } finally { f.clean(); }
});

test('existing unresolved reviews keep their original identity evidence', () => {
  const f = fixture();
  try {
    const previous = { key: f.finding.key, status: 'needs-repair', reason: 'Wrong performer independently verified', sourceVideoId: 'dQw4w9WgXcQ' };
    writeFileSync(f.ledgerPath, JSON.stringify({ entries: [previous] }));
    markDurationAudit(f);
    const result = JSON.parse(readFileSync(f.ledgerPath)).entries[0];
    for (const [key, value] of Object.entries(previous)) assert.equal(result[key], value);
    assert.equal(result.durationAudit.verdict, 'probable-bad-duration');
  } finally { f.clean(); }
});

test('fresh evidence can reopen a historical resolution without erasing it, but an explicit later resolution is respected', () => {
  const f = fixture();
  try {
    const previous = { key: f.finding.key, status: 'resolved', resolvedAt: '2026-09-12T00:00:00Z', resolution: 'Original repair evidence', repairRecord: '/preserved/repair.json' };
    writeFileSync(f.ledgerPath, JSON.stringify({ entries: [previous] }));
    markDurationAudit(f);
    const result = JSON.parse(readFileSync(f.ledgerPath)).entries[0];
    assert.equal(result.status, 'needs-review');
    assert.deepEqual(result.previousReview, previous);
    writeFileSync(f.ledgerPath, JSON.stringify({ entries: [{ ...result, status: 'resolved', resolvedAt: '2026-09-13T07:00:00Z' }] }));
    assert.equal(markDurationAudit(f).markedUnique, 0);
    assert.equal(JSON.parse(readFileSync(f.ledgerPath)).entries[0].status, 'resolved');
  } finally { f.clean(); }
});

test('concurrent review edits are preserved and a corrupt ledger cannot be overwritten', () => {
  const f = fixture();
  try {
    const newText = JSON.stringify({ entries: [{ key: 'another', status: 'needs-review' }] });
    assert.throws(() => markDurationAudit({ ...f, beforeCommit: () => writeFileSync(f.ledgerPath, newText) }), /concurrently/);
    assert.equal(readFileSync(f.ledgerPath, 'utf8'), newText);
    writeFileSync(f.ledgerPath, 'not json');
    assert.throws(() => markDurationAudit(f));
    assert.equal(readFileSync(f.ledgerPath, 'utf8'), 'not json');
  } finally { f.clean(); }
});
