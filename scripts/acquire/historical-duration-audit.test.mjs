import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, linkSync, statSync,
  renameSync, symlinkSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database } from './catalog.mjs';
import { snapshotFiles, inspectFile, comparison, summarizeAudit, resolveAuditSource,
  metadataPriority, runAudit, atomicJson, auditGapMs } from './historical-duration-audit.mjs';

const ID = '1234567890123456789012', ID2 = '2234567890123456789012';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'spooty-historical-audit-'));
  const downloads = join(root, 'downloads'); mkdirSync(downloads);
  const song = { key: 'artist - track', artist: 'Artist', name: 'Track', spotifyIds: [ID],
    destinations: [join(downloads, 'Artist - Track.mp3')], knownReviewStatus: null };
  const plan = { songs: new Map([[song.key, song]]), disk: { gb: 0, uniqueInodes: 0 }, playlistCount: 1, occurrences: 1, skipped: 0 };
  return { root, downloads, song, plan, clean: () => rmSync(root, { recursive: true, force: true }) };
}
const fakeProbe = async () => ({ codec: 'mp3', durationSeconds: 200 });

test('source-keyed audit preserves legacy review evidence only for its explicitly named Spotify version', () => {
  const f = fixture();
  try {
    writeFileSync(f.song.destinations[0], 'audio');
    const first = { ...f.song, key: `spotify:${ID}`, legacyKey: f.song.key };
    const second = { ...first, key: `spotify:${ID2}`, spotifyIds: [ID2] };
    f.plan.songs = new Map([[first.key, first], [second.key, second]]);
    const snapshot = snapshotFiles(f.plan, f.downloads, [], [{ key: f.song.key, catalogTrackId: ID, status: 'needs-review' }]);
    assert.equal(snapshot.songs.find(song => song.key === first.key).knownReviewStatus, 'needs-review');
    assert.equal(snapshot.songs.find(song => song.key === second.key).knownReviewStatus, null);
  } finally { f.clean(); }
});

test('audit pacing permits configured 250 ms spacing but cannot disable its minimum', () => {
  assert.equal(auditGapMs('250'), 250);
  assert.equal(auditGapMs(1000), 1000);
  for (const invalid of [0, 249, -1, NaN, Infinity, 'not a number'])
    assert.throws(() => auditGapMs(invalid), /at least 250/);
});

test('snapshot groups hardlinks but retains every distinct copy and excludes real staging only', () => {
  const f = fixture();
  try {
    writeFileSync(f.song.destinations[0], 'audio');
    for (const name of ['Second', '.Legitimate', '.spooty-download-batch-1']) mkdirSync(join(f.downloads, name));
    linkSync(f.song.destinations[0], join(f.downloads, 'Second', 'Artist - Track.mp3'));
    writeFileSync(join(f.downloads, '.Legitimate', 'Artist - Track.mp3'), 'another recording');
    writeFileSync(join(f.downloads, '.spooty-download-batch-1', 'Artist - Track.mp3'), 'unpublished');
    writeFileSync(join(f.downloads, 'unmatched.mp3'), 'not catalog');
    const snapshot = snapshotFiles(f.plan, f.downloads);
    assert.equal(snapshot.coverage.catalogSongsOnDisk, 1);
    assert.equal(snapshot.coverage.physicalInodes, 2);
    assert.equal(snapshot.coverage.catalogMp3Paths, 3);
    assert.equal(snapshot.coverage.unmatchedMp3Paths, 1);
    assert.equal(snapshot.files.find(file => file.paths.length === 2).songKeys.length, 1);
  } finally { f.clean(); }
});

test('snapshot includes zero-byte files and refuses symlink success evidence', () => {
  const f = fixture();
  try {
    writeFileSync(f.song.destinations[0], ''); mkdirSync(join(f.downloads, 'Alias'));
    symlinkSync(f.song.destinations[0], join(f.downloads, 'Alias', 'Artist - Track.mp3'));
    const snapshot = snapshotFiles(f.plan, f.downloads);
    assert.equal(snapshot.files[0].fingerprint.size, 0);
    assert.equal(snapshot.snapshotFailures.length, 1);
    assert.equal(snapshot.snapshotFailures[0].state, 'unreadable');
  } finally { f.clean(); }
});

test('inspection rejects a changed snapshot and a mutation during ffprobe', async () => {
  const f = fixture();
  try {
    writeFileSync(f.song.destinations[0], 'old audio');
    const first = snapshotFiles(f.plan, f.downloads).files[0];
    const during = await inspectFile(first, f.downloads, async path => {
      writeFileSync(path, 'changed recording and size'); return fakeProbe();
    });
    assert.equal(during.state, 'changed-file');
    let probed = false;
    assert.equal((await inspectFile(first, f.downloads, async () => { probed = true; return fakeProbe(); })).state, 'changed-file');
    assert.equal(probed, false);
  } finally { f.clean(); }
});

test('inspection returns sanitized unreadable state and never subprocess stderr', async () => {
  const f = fixture();
  try {
    writeFileSync(f.song.destinations[0], 'bad');
    const file = snapshotFiles(f.plan, f.downloads).files[0];
    const result = await inspectFile(file, f.downloads, async () => { throw new Error('secret stderr'); });
    assert.equal(result.state, 'unreadable');
    assert.equal(JSON.stringify(result).includes('secret'), false);
  } finally { f.clean(); }
});

test('shared fuzzy thresholds flag wrong lengths without calling matching recordings proven', () => {
  const f = fixture();
  try {
    writeFileSync(f.song.destinations[0], 'audio'); const file = snapshotFiles(f.plan, f.downloads).files[0];
    for (const [expected, actual, state] of [[200000, 210, 'length-match'], [200000, 210.01, 'probable-bad-duration'],
      [30000, 35, 'length-match'], [1000000, 1020.01, 'probable-bad-duration'], [null, 240, 'missing-source-metadata']]) {
      const result = comparison(file, f.song, { state: 'probed', durationSeconds: actual }, { durationMs: expected, spotifyId: ID });
      assert.equal(result.state, state);
    }
    assert.equal(comparison(file, f.song, null, { durationMs: 200000 }).state, 'unassessed');
    assert.equal(comparison(file, f.song, { state: 'unreadable' }, { durationMs: 200000 }).state, 'unreadable');
  } finally { f.clean(); }
});

test('multiple Spotify editions are unknown until all known; conflicting editions never become probable bad', async () => {
  const f = fixture();
  try {
    const song = { ...f.song, spotifyIds: [ID, ID2] };
    const partial = await resolveAuditSource(song, async candidate => {
      if (candidate.spotifyIds[0] === ID2) throw new Error('not cached'); return 200000;
    }, 'test');
    assert.equal(partial.durationMs, null); assert.deepEqual(partial.unavailableIds, [ID2]);
    const conflict = await resolveAuditSource(song, async candidate => candidate.spotifyIds[0] === ID ? 200000 : 600000, 'test');
    assert.equal(conflict.durationMs, null); assert.equal(conflict.ambiguous, true);
    writeFileSync(f.song.destinations[0], 'audio'); const file = snapshotFiles(f.plan, f.downloads).files[0];
    assert.equal(comparison(file, song, { state: 'probed', durationSeconds: 600 }, conflict).state, 'missing-source-metadata');
    const close = await resolveAuditSource(song, async candidate => candidate.spotifyIds[0] === ID ? 200000 : 204000, 'test');
    const match = comparison(file, song, { state: 'probed', durationSeconds: 213 }, close);
    assert.equal(match.state, 'length-match'); assert.equal(match.spotifyId, ID2);
  } finally { f.clean(); }
});

test('aggregate separates unique catalog songs, physical copies, unknowns and known resolved review history', () => {
  const f = fixture();
  try {
    writeFileSync(f.song.destinations[0], 'audio'); mkdirSync(join(f.downloads, 'Other'));
    writeFileSync(join(f.downloads, 'Other', 'Artist - Track.mp3'), 'wrong audio');
    const snapshot = snapshotFiles(f.plan, f.downloads, [], [{ key: f.song.key, status: 'resolved' }]);
    const records = new Map(snapshot.files.map((file, index) => [file.id, { probe: { state: 'probed', durationSeconds: index ? 600 : 200 } }]));
    const result = summarizeAudit(snapshot, records, new Map([[f.song.key, { durationMs: 200000, spotifyId: ID }]]));
    assert.equal(result.uniqueSongs.catalogSongsOnDisk, 1); assert.equal(result.physical.totalInodes, 2);
    assert.equal(result.uniqueSongs.probableBadDuration, 1); assert.equal(result.uniqueSongs.allInstancesLengthMatch, 0);
    assert.equal(result.findings.length, 1); assert.equal(result.findings[0].knownReviewStatus, 'resolved');
    assert.equal(result.complete, true); // Complete comparison is not a repaired library.
  } finally { f.clean(); }
});

test('metadata order prioritizes extreme local duration but does not itself assign bad status', () => {
  const songs = [10, 200, 4000].map(n => ({ key: String(n) }));
  const snapshot = { songs, files: songs.map(song => ({ id: song.key, songKeys: [song.key] })) };
  const records = new Map(songs.map(song => [song.key, { probe: { durationSeconds: Number(song.key) } }]));
  assert.deepEqual(metadataPriority(snapshot, records, new Map()).map(song => song.key), ['10', '4000', '200']);
});

test('atomic artifacts are private and leave no temporary files', () => {
  const f = fixture();
  try {
    const path = join(f.root, 'audit', 'value.json'); atomicJson(path, { version: 1 });
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(join(f.root, 'audit')).mode & 0o777, 0o700);
    assert.deepEqual(readdirSync(join(f.root, 'audit')), ['value.json']);
  } finally { f.clean(); }
});

test('full cached pass is resumable, caps local probes at two, and never fetches remote metadata', async () => {
  const f = fixture();
  try {
    const playlists = join(f.root, 'playlists'), statePath = join(f.root, 'state'), cachePath = join(f.root, 'cache'), output = join(f.root, 'audit');
    for (const path of [playlists, statePath, cachePath]) mkdirSync(path);
    const tracks = Array.from({ length: 5 }, (_, index) => ({ id: String(index + 1).padStart(22, '0'), name: `Track ${index}`, artist: 'Artist', durationMs: 200000 }));
    writeFileSync(join(playlists, 'p.json'), JSON.stringify({ name: 'List', tracks })); mkdirSync(join(f.downloads, 'List'));
    for (const track of tracks) writeFileSync(join(f.downloads, 'List', `Artist - ${track.name}.mp3`), 'audio');
    const dbPath = join(f.root, 'db.sqlite'), db = database(dbPath);
    await db.run('CREATE TABLE track_entity (id INTEGER, artist TEXT, name TEXT, youtubeUrl TEXT, error TEXT)'); await db.close();
    let active = 0, maximum = 0, calls = 0;
    const probe = async () => { active++; calls++; maximum = Math.max(maximum, active);
      await new Promise(yes => setTimeout(yes, 5)); active--; return fakeProbe(); };
    const args = { output, playlists, downloads: f.downloads, dbPath, cachePath, statePath, hydrate: false, probe,
      fetchMetadata: async () => { throw new Error('Remote fetch forbidden'); } };
    const first = await runAudit(args);
    assert.equal(first.uniqueSongs.allInstancesLengthMatch, 5); assert.equal(first.complete, true);
    assert.equal(maximum, 2); assert.equal(calls, 5);
    const second = await runAudit(args);
    assert.equal(second.complete, true); assert.equal(calls, 5);
    const originalSnapshot = JSON.parse(readFileSync(join(output, 'snapshot.json'), 'utf8'));
    assert.equal(second.snapshotId, originalSnapshot.snapshotId);
    const changedFile = originalSnapshot.files[0].paths[0], replacement = join(f.root, 'replacement.mp3');
    writeFileSync(replacement, 'replacement'); renameSync(replacement, changedFile);
    const third = await runAudit(args);
    assert.equal(third.uniqueSongs.changedFile, 1); assert.equal(third.complete, false);
  } finally { f.clean(); }
});

test('metadata hydration remains sequential at 250 ms and audits every song, not a sample', async () => {
  const f = fixture();
  try {
    const playlists = join(f.root, 'playlists'), statePath = join(f.root, 'state');
    const cachePath = join(f.root, 'cache'), output = join(f.root, 'audit');
    for (const path of [playlists, statePath, cachePath]) mkdirSync(path);
    const tracks = Array.from({ length: 4 }, (_, index) => ({
      id: String(index + 1).padStart(22, '0'), name: `Track ${index}`, artist: 'Artist',
    }));
    writeFileSync(join(playlists, 'p.json'), JSON.stringify({ name: 'List', tracks }));
    mkdirSync(join(f.downloads, 'List'));
    for (const track of tracks) writeFileSync(join(f.downloads, 'List', `Artist - ${track.name}.mp3`), 'audio');
    const dbPath = join(f.root, 'db.sqlite'), db = database(dbPath);
    await db.run('CREATE TABLE track_entity (id INTEGER, artist TEXT, name TEXT, youtubeUrl TEXT, error TEXT)');
    await db.close();
    let active = 0, maximum = 0;
    const starts = [];
    const result = await runAudit({ output, playlists, downloads: f.downloads, dbPath, cachePath, statePath,
      gapMs: 250, probe: fakeProbe, fetchMetadata: async id => {
        starts.push(Date.now()); active++; maximum = Math.max(maximum, active);
        await new Promise(yes => setTimeout(yes, 10));
        active--;
        const track = tracks.find(row => row.id === id);
        return { version: 1, spotifyId: id, name: track.name, artist: track.artist, durationMs: 200000 };
      } });
    assert.equal(result.uniqueSongs.durationCompared, tracks.length);
    assert.equal(result.complete, true);
    assert.equal(result.sourceMetadata.minimumRequestGapMs, 250);
    assert.equal(maximum, 1);
    assert.equal(starts.length, tracks.length);
    for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 245);
  } finally { f.clean(); }
});
