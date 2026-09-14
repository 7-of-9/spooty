import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, lstatSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareOccurrence, aggregateFileState, preserveUnboundEditionAmbiguity, buildFullReport } from './full-duration-report.mjs';
import { fingerprint } from './historical-duration-audit.mjs';

const id = '1234567890123456789012';
const context = { spotifyId: id, artist: 'Artist', name: 'Track', path: '/downloads/List/Artist - Track.mp3' };
test('full report only trusts the correct Spotify identity and preserves fuzzy tolerance', () => {
  const metadata = { version: 1, spotifyId: id, artist: 'Artist', name: 'Track', durationMs: 200000 };
  assert.equal(compareOccurrence(context, 210, metadata).state, 'length-match');
  assert.equal(compareOccurrence(context, 210.1, metadata).state, 'probable-bad-duration');
  assert.equal(compareOccurrence(context, 200, { ...metadata, name: 'Other' }).state, 'missing-source-metadata');
  assert.equal(compareOccurrence(context, 200, null).state, 'missing-source-metadata');
});
test('one matching playlist cannot certify a shared file for a wrong-length edition', () => {
  const rows = [compareOccurrence({ ...context, durationMs: 200000 }, 200, null),
    compareOccurrence({ ...context, durationMs: 400000, path: '/downloads/Other/Artist - Track.mp3' }, 200, null)];
  assert.equal(rows[0].state, 'length-match');
  assert.equal(rows[1].state, 'probable-bad-duration');
  assert.equal(aggregateFileState({ state: 'probed' }, rows), 'probable-bad-duration');
});
test('unmeasured, changed, unreadable and unknown evidence cannot pass', () => {
  assert.equal(aggregateFileState(null, []), 'unassessed');
  assert.equal(aggregateFileState({ state: 'changed-file' }, [{ state: 'length-match' }]), 'changed-file');
  assert.equal(aggregateFileState({ state: 'unreadable' }, []), 'unreadable');
  assert.equal(aggregateFileState({ state: 'probed' }, []), 'unknown-identity');
  assert.equal(aggregateFileState({ state: 'probed' }, [{ state: 'length-match' }, { state: 'missing-source-metadata' }]), 'missing-source-metadata');
});
test('filename-only edition ambiguity cannot incorrectly mark a potentially matching recording bad', () => {
  const mixed = preserveUnboundEditionAmbiguity([{ state: 'length-match' }, { state: 'probable-bad-duration' }]);
  assert.ok(mixed.every(row => row.state === 'ambiguous-source-editions'));
  const missing = preserveUnboundEditionAmbiguity([{ state: 'missing-source-metadata' }, { state: 'probable-bad-duration' }]);
  assert.ok(missing.every(row => row.state === 'ambiguous-source-editions'));
  assert.equal(aggregateFileState({ state: 'probed' }, mixed), 'ambiguous-source-editions');
  assert.ok(preserveUnboundEditionAmbiguity([{ state: 'probable-bad-duration' }, { state: 'probable-bad-duration' }]).every(row => row.state === 'probable-bad-duration'));
});
test('full inventory reconciles original, supplemental and unknown files without silently dropping coverage', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'spooty-full-duration-')));
  try {
    const downloads = join(base, 'downloads'), auditPath = join(base, 'audit'), cachePath = join(base, 'cache');
    for (const path of [downloads, auditPath, cachePath, join(auditPath, 'files'), join(auditPath, 'coverage-gap')]) mkdirSync(path, { recursive: true });
    const save = (name, value) => writeFileSync(join(auditPath, name), JSON.stringify(value));
    const files = ['Artist - Track.mp3', 'Artist - Extra.mp3', 'Unknown.mp3'].map((name, i) => {
      const path = join(downloads, name); writeFileSync(path, 'test bytes');
      return { id: String(i), fingerprint: fingerprint(lstatSync(path)), paths: [{ path, staging: false }] };
    });
    const startedAt = '2026-09-13T07:00:00.000Z';
    const probe = { state: 'probed', durationSeconds: 200, checkedAt: startedAt };
    save('snapshot.json', { snapshotId: 'test', files: [files[0]], songs: [] });
    save('progress.json', { stage: 'pass-finished' });
    save('files/0.json', { fingerprint: files[0].fingerprint, probe });
    save('coverage-gap/inventory.json', { snapshotId: 'test', startedAt, files, nonRegular: [], scanFailures: [] });
    save('coverage-gap/supplemental.json', { startedAt, songs: [], files: [{ ...files[1], probe }], unknownFiles: [{ ...files[2], probe }] });
    save('coverage-gap/playlist-occurrence-bindings.json', { startedAt, paths: [
      { path: files[0].paths[0].path, occurrences: [{ ...context, durationMs: 200000 }] },
      { path: files[1].paths[0].path, occurrences: [{ ...context, name: 'Extra', durationMs: 400000 }] },
    ] });
    const result = buildFullReport({ auditPath, downloads, cachePath });
    assert.equal(result.summary.physicalFiles, 3);
    assert.equal(result.summary.paths, 3);
    assert.deepEqual(result.summary.counts, { 'length-match': 1, 'probable-bad-duration': 1, 'unknown-identity': 1 });
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].paths[0], files[1].paths[0].path);
    assert.equal(result.allLocalFilesExamined, true);
    assert.equal(result.complete, false);
    writeFileSync(files[0].paths[0].path, 'different bytes');
    const changed = buildFullReport({ auditPath, downloads, cachePath });
    assert.equal(changed.summary.counts['changed-file'], 1);
    assert.equal(changed.allLocalFilesExamined, false);
    save('coverage-gap/playlist-occurrence-bindings.json', { startedAt: 'wrong cutoff', paths: [] });
    assert.throws(() => buildFullReport({ auditPath, downloads, cachePath }), /exact inventory cutoff/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
