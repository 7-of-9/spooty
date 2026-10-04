import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markDeletedDurationFiles, recordDurationReplacement } from './duration-repair-ledger.mjs';

test('a source-keyed replacement records legacy explicit-ID evidence without rewriting its key', () => {
  const root = mkdtempSync(join(tmpdir(), 'spooty-review-source-'));
  try {
    const id = 'aaaaaaaaaaaaaaaaaaaaaa', other = 'bbbbbbbbbbbbbbbbbbbbbb', path = join(root, 'ledger.json');
    const entry = { key: 'artist - song', status: 'needs-repair', source: 'historical-duration-audit', catalogTrackId: id,
      durationAudit: { files: [{ fileId: 'deleted', spotifyId: id }] },
      durationDeletion: { expectedDurationsMs: [180000], files: [{ fileId: 'deleted' }] } };
    writeFileSync(path, JSON.stringify({ entries: [entry] }));
    const before = readFileSync(path, 'utf8');
    assert.equal(recordDurationReplacement(path, { key: `spotify:${other}`, id: other, artist: 'Artist', name: 'Song', source: 'other.mp3', durationMs: 180000 }, 180), false);
    assert.equal(readFileSync(path, 'utf8'), before);
    assert.equal(recordDurationReplacement(path, { key: `spotify:${id}`, id, source: 'new.mp3', durationMs: 180000 }, 180), true);
    const updated = JSON.parse(readFileSync(path)).entries[0];
    assert.equal(updated.key, entry.key); assert.equal(updated.status, 'resolved');
    assert.equal(updated.durationReplacement.sourceKey, `spotify:${id}`);
    assert.equal(updated.durationReplacement.recordingIdentityProven, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('replacing one source cannot clear a multi-source review or a name-only unbound review', () => {
  const root = mkdtempSync(join(tmpdir(), 'spooty-review-group-'));
  try {
    const a = 'aaaaaaaaaaaaaaaaaaaaaa', b = 'bbbbbbbbbbbbbbbbbbbbbb', path = join(root, 'ledger.json');
    const entries = [{ key: 'old group', status: 'needs-repair', source: 'historical-duration-audit', catalogTrackId: a,
      durationAudit: { files: [{ fileId: 'deleted', spotifyId: b }] },
      durationDeletion: { expectedDurationsMs: [180000], files: [{ fileId: 'deleted' }] } },
    { key: 'artist - song', status: 'needs-review', source: 'manual-review',
      durationDeletion: { expectedDurationsMs: [180000], files: [{ fileId: 'deleted' }] } }];
    writeFileSync(path, JSON.stringify({ entries }));
    assert.equal(recordDurationReplacement(path, { key: `spotify:${a}`, id: a, source: 'new.mp3', durationMs: 180000 }, 180), true);
    const updated = JSON.parse(readFileSync(path)).entries;
    assert.equal(updated[0].status, 'needs-review');
    assert.equal(updated[0].durationReplacements[`spotify:${a}`].file, 'new.mp3');
    assert.deepEqual(updated[1], entries[1]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('invalid replacement duration cannot write review-resolution evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'spooty-review-guard-'));
  try {
    const path = join(root, 'ledger.json');
    const original = JSON.stringify({ entries: [{ key: 'legacy', status: 'needs-repair', source: 'historical-duration-audit',
      durationDeletion: { expectedDurationsMs: [180000], files: [] } }] });
    writeFileSync(path, original);
    assert.throws(() => recordDurationReplacement(path, { key: 'legacy', source: 'bad.mp3', durationMs: 180000 }, 800), /duration guard/);
    assert.equal(readFileSync(path, 'utf8'), original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('deletion annotations retain identity evidence and only a matching replacement resolves a duration-only review', () => {
  const root = mkdtempSync(join(tmpdir(), 'spooty-repair-ledger-'));
  try {
    const path = join(root, 'ledger.json');
    const manifest = { id: 'tested', files: [{ fileId: '1-2', paths: [join(root, 'deleted.mp3')],
      keys: ['duration', 'identity'], fingerprint: { dev: 1, ino: 2 }, expectedDurationsMs: [180000], verdict: 'probable-bad-duration' }] };
    const result = { manifestId: 'tested', filesDeleted: 1, at: '2026-09-13T00:00:00Z' };
    writeFileSync(path, JSON.stringify({ entries: [
      { key: 'duration', source: 'historical-duration-audit', originalDevice: 1, originalInode: 2, originalFilePreserved: true,
        durationAudit: { files: [{ fileId: '1-2' }] } },
      { key: 'identity', source: 'manual-review', status: 'needs-review', reason: 'Wrong performer' },
    ] }));
    assert.deepEqual(markDeletedDurationFiles(path, manifest, result), { markedKeys: 2 });
    let entries = JSON.parse(readFileSync(path)).entries;
    assert.equal(entries[0].status, 'needs-repair');
    assert.equal(entries[0].originalFilePreserved, false);
    assert.equal(entries[1].reason, 'Wrong performer');
    for (const key of ['duration', 'identity']) recordDurationReplacement(path, { key, source: 'new.mp3', durationMs: 180000 }, 184);
    entries = JSON.parse(readFileSync(path)).entries;
    assert.equal(entries[0].status, 'resolved');
    assert.equal(entries[1].status, 'needs-review');
    assert.equal(entries[1].reason, 'Wrong performer');
    assert.equal(entries[0].durationReplacement.recordingIdentityProven, false);
    const followup = { id: 'followup', files: [{ ...manifest.files[0], fileId: '1-3', paths: [join(root, 'also-deleted.mp3')], keys: ['duration'] }] };
    markDeletedDurationFiles(path, followup, { ...result, manifestId: 'followup' });
    entries = JSON.parse(readFileSync(path)).entries;
    assert.deepEqual(entries[0].durationDeletion.files.map(file => file.fileId), ['1-2', '1-3']);
    assert.deepEqual(entries[0].durationDeletion.manifestIds, ['tested', 'followup']);
    writeFileSync(manifest.files[0].paths[0], 'new file');
    assert.throws(() => markDeletedDurationFiles(path, manifest, result), /still present/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('another failed edition or unreplaced physical evidence remains needs-review', () => {
  const root = mkdtempSync(join(tmpdir(), 'spooty-repair-ledger-'));
  try {
    const path = join(root, 'ledger.json');
    for (const extra of [{ expectedDurationsMs: [180000, 360000] }, { expectedDurationsMs: [180000], otherEvidence: true }]) {
      writeFileSync(path, JSON.stringify({ entries: [{ key: 'a', status: 'needs-repair', source: 'historical-duration-audit',
        durationAudit: { files: [{ fileId: extra.otherEvidence ? 'held' : 'deleted' }] },
        durationDeletion: { expectedDurationsMs: extra.expectedDurationsMs, files: [{ fileId: 'deleted' }] } }] }));
      recordDurationReplacement(path, { key: 'a', source: 'new.mp3', durationMs: 180000 }, 184);
      assert.equal(JSON.parse(readFileSync(path)).entries[0].status, 'needs-review');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
