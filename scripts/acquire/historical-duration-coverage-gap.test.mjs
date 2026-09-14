import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, linkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inventoryMp3, buildBindingIndex, exactBinding, coverageClassification, probeGapFile, cachedComparison, occurrenceBindings } from './historical-duration-coverage-gap.mjs';
const ID = '1234567890123456789012', ID2 = '2234567890123456789012';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'spooty-coverage-gap-')), downloads = join(root, 'downloads');
  mkdirSync(downloads); return { root, downloads, clean: () => rmSync(root, { recursive: true, force: true }) };
}
const file = { paths: [{ path: '/downloads/List/Artist - Track.mp3', key: 'artist - track', staging: false }] };
const rows = [{ artist: 'Artist', name: 'Track', spotifyId: ID, source: 'saved-playlist:one.json', durationMs: 200000 }];

test('inventory preserves every original path and groups hardlinks, including unmatched and staging', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.downloads, 'Artist - Track.mp3'), 'audio'); mkdirSync(join(f.downloads, 'List'));
    linkSync(join(f.downloads, 'Artist - Track.mp3'), join(f.downloads, 'List', 'Artist - Track.mp3'));
    writeFileSync(join(f.downloads, 'unknown.mp3'), 'unknown'); mkdirSync(join(f.downloads, '.spooty-download-batch-1'));
    writeFileSync(join(f.downloads, '.spooty-download-batch-1', 'new.mp3'), 'unfinished');
    const inv = inventoryMp3(f.downloads, new Set(['artist - track']));
    assert.equal(inv.files.length, 3); assert.equal(inv.files.flatMap(file => file.paths).length, 4);
    assert.equal(inv.files.flatMap(file => file.paths).filter(path => path.staging).length, 1);
    assert.equal(inv.files.flatMap(file => file.paths).filter(path => path.currentCatalog).length, 2);
  } finally { f.clean(); }
});

test('binding uses exact names or exact full tags and does not infer fuzzy identities', () => {
  const index = buildBindingIndex(rows);
  assert.equal(exactBinding(file, {}, index).state, 'bound');
  const unknown = { paths: [{ path: '/downloads/mystery.mp3', key: 'mystery', staging: false }] };
  assert.equal(exactBinding(unknown, { artist: 'Artist', title: 'Track' }, index).state, 'bound');
  assert.equal(exactBinding(unknown, { artist: 'Artist', title: 'Track live' }, index).state, 'unknown-identity');
});

test('sanitized filename collisions and contradictory exact tags fail closed', () => {
  const collision = buildBindingIndex([{ artist: 'Artist', name: 'A/B', source: 'a' }, { artist: 'Artist', name: 'AB', source: 'b' }]);
  assert.equal(exactBinding({ paths: [{ path: '/d/Artist - AB.mp3', key: 'artist - ab', staging: false }] }, {}, collision).state, 'unknown-identity');
  const index = buildBindingIndex([...rows, { artist: 'Other', name: 'Song', source: 'other' }]);
  assert.equal(exactBinding(file, { artist: 'Other', title: 'Song' }, index).state, 'unknown-identity');
});

test('Unicode-equivalent whitespace is exact normalization, not a fuzzy track-name guess', () => {
  const index = buildBindingIndex([{ artist: 'Artist, Second', name: 'Track', source: 'saved' }]);
  const exact = exactBinding({ paths: [{ path: '/d/Artist, Second - Track.mp3', key: 'artist,\u00a0second - track', staging: false }] }, {}, index);
  assert.equal(exact.state, 'bound');
  assert.equal(exact.identity.artist, 'Artist, Second');
});

test('exact playlist occurrence IDs remain distinct even when the artist/title share one inode', () => {
  const paths = occurrenceBindings([{ ...rows[0], path: '/d/First/Artist - Track.mp3' },
    { ...rows[0], path: '/d/Second/Artist - Track.mp3', spotifyId: ID2, durationMs: 600000, excludedFromActiveCatalog: true },
    { ...rows[0], path: '/d/Second/Artist - Track.mp3', spotifyId: ID2, durationMs: 600000, excludedFromActiveCatalog: true }]);
  assert.equal(paths.length, 2);
  assert.deepEqual(paths.map(path => path.occurrences[0].spotifyId), [ID, ID2]);
  assert.equal(paths[1].occurrences.length, 1); assert.equal(paths[1].occurrences[0].excludedFromActiveCatalog, true);
});

test('same snapshot inode is covered but new guarded event is correlated only after snapshot time', () => {
  const snapshot = { startedAt: '2026-09-13T06:00:00.000Z', files: [{ id: '1-2', fingerprint: { dev: 1, ino: 2, size: 5, mtimeMs: 100 } }] };
  assert.equal(coverageClassification({ id: '1-2', fingerprint: snapshot.files[0].fingerprint, paths: [] }, snapshot, []).state, 'snapshot-covered-unchanged');
  const t = Date.parse(snapshot.startedAt) + 10000, current = { id: '1-3', fingerprint: { dev: 1, ino: 3, size: 8, mtimeMs: t - 10 }, paths: file.paths };
  const event = { key: file.paths[0].key, file: file.paths[0].path, t, durationGuard: 'spotify-v1' };
  assert.equal(coverageClassification(current, snapshot, [event]).state, 'new-guarded-publication-correlated');
  assert.equal(coverageClassification({ ...current, fingerprint: { ...current.fingerprint, mtimeMs: 100 } }, snapshot, [event]).state, 'historical-file-outside-original-snapshot');
});

test('gap probes reject mutation and sanitize failures without touching recordings', async () => {
  const f = fixture();
  try {
    const path = join(f.downloads, 'Artist - Track.mp3'); writeFileSync(path, 'audio');
    const inv = inventoryMp3(f.downloads); const result = await probeGapFile(inv.files[0], f.downloads, async () => ({ codec: 'mp3', durationSeconds: 200, tags: { artist: 'Artist', title: 'Track' } }));
    assert.equal(result.state, 'probed');
    const changed = await probeGapFile(inv.files[0], f.downloads, async () => { writeFileSync(path, 'changed audio'); return { codec: 'mp3', durationSeconds: 200 }; });
    assert.equal(changed.state, 'changed-file');
    const current = inventoryMp3(f.downloads).files[0];
    const failure = await probeGapFile(current, f.downloads, async () => { throw new Error('private subprocess text'); });
    assert.equal(failure.state, 'unreadable'); assert.equal(JSON.stringify(failure).includes('private'), false);
  } finally { f.clean(); }
});

test('cached duration comparison uses tolerance and leaves unknown or conflicting editions explicit', () => {
  const f = fixture();
  try {
    const binding = exactBinding(file, {}, buildBindingIndex(rows));
    assert.equal(cachedComparison(binding, { state: 'probed', durationSeconds: 210 }, f.root).state, 'length-match');
    assert.equal(cachedComparison(binding, { state: 'probed', durationSeconds: 211 }, f.root).state, 'probable-bad-duration');
    const multiple = exactBinding(file, {}, buildBindingIndex([...rows, { ...rows[0], spotifyId: ID2, durationMs: undefined }]));
    assert.equal(cachedComparison(multiple, { state: 'probed', durationSeconds: 200 }, f.root).state, 'missing-source-metadata');
    const conflicting = exactBinding(file, {}, buildBindingIndex([...rows, { ...rows[0], spotifyId: ID2, durationMs: 600000 }]));
    assert.equal(cachedComparison(conflicting, { state: 'probed', durationSeconds: 600 }, f.root).state, 'ambiguous-source-editions');
  } finally { f.clean(); }
});
