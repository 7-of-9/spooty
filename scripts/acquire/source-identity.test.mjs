import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, linkSync, renameSync, readdirSync, rmSync, copyFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { catalog, database, sourceKey, sourceFileBase, sourceJournal, fileBase, materialize } from './catalog.mjs';
import { resumePlan } from './resume-state.mjs';
import { materializeForTrack, publishMp3ForTrack } from './publication.mjs';
const require = createRequire(import.meta.url);
const { spotifySourceId, trackSourceId } = require('../../src/backend/src/shared/acquisition/source-id.ts');
const { LocalMediaIndex, MediaDurationCache } = require('../../src/backend/src/shared/acquisition/local-media.ts');
const { createDurationResolver, cachedSourceDuration } = require('../../src/backend/src/shared/acquisition/spotify-duration.ts');
const A = '1234567890123456789012', B = '2234567890123456789012';
const song = (id = A, durationMs = 30000) => ({ id, spotifyIds: [id], artist: 'Artist', name: 'Track', durationMs });
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'spooty-source-identity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const downloads = join(root, 'downloads'), metadata = join(root, 'metadata'), cache = join(root, 'cache');
  for (const dir of [downloads, metadata, cache]) mkdirSync(dir);
  const file = (folder, name, seconds) => {
    mkdirSync(join(downloads, folder), { recursive: true });
    const path = join(downloads, folder, name);
    writeFileSync(path, String(seconds));
    return path;
  };
  const probe = async path => Number(readFileSync(path, 'utf8'));
  return { root, downloads, metadata, cache, file, probe,
    index: () => new LocalMediaIndex([downloads], metadata, new MediaDurationCache(cache, probe)) };
}

test('incremental file index follows additions, removals and dotted directory moves without rebuilding unrelated files', async t => {
  const f = fixture(t), unrelated = f.file('Keep', 'Unrelated - File.mp3', 30), index = f.index();
  const media = f.file('Album.v1', `${sourceFileBase(song())}.mp3`, 30);
  assert.ok(index.refreshPath(media).has(`spotify:${A}`));
  assert.equal((await index.resolve(song(), join(f.downloads, 'Album.v1'))).local, media);
  const moved = join(f.downloads, 'Album.v2'); renameSync(join(f.downloads, 'Album.v1'), moved);
  const removedKeys = index.refreshPath(join(f.downloads, 'Album.v1'));
  assert.ok(removedKeys.has(`spotify:${A}`)); assert.equal(index.files.has(`spotify:${A}`), false);
  index.refreshPath(moved);
  assert.equal((await index.resolve(song(), moved)).local, join(moved, basename(media)));
  assert.deepEqual(index.files.get('unrelated - file'), [unrelated]);
  assert.equal(index.refreshPath(join(f.downloads, 'not-present')).size, 0);
});

test('incremental hardlink updates invalidate every related alias, and symlink folders are not indexed', async t => {
  const f = fixture(t), original = f.file('Original', `${sourceFileBase(song())}.mp3`, 30);
  const copy = join(f.downloads, 'Copy'); mkdirSync(copy);
  linkSync(original, join(copy, `${sourceFileBase(song(B))}.mp3`));
  const index = f.index(); writeFileSync(original, '60');
  const changed = index.refreshPath(original);
  assert.ok(changed.has(`spotify:${A}`)); assert.ok(changed.has(`spotify:${B}`));
  assert.equal((await index.resolve(song(B), copy)).verification, 'mismatch');
  const outside = join(f.root, 'outside'); mkdirSync(outside);
  writeFileSync(join(outside, 'Hidden - File.mp3'), '30');
  const symlink = join(f.downloads, 'Linked'); symlinkSync(outside, symlink);
  index.refreshPath(symlink); assert.equal(index.files.has('hidden - file'), false);
  f.file('.acquire-private', 'Partial - Download.mp3', 30);
  index.refreshPath(f.downloads); assert.equal(index.files.has('partial - download'), false);
});

test('source IDs are canonical across URLs and URIs, not database row IDs or grouped first IDs', () => {
  for (const text of [A, `spotify:track:${A}`, `https://open.spotify.com/track/${A}?si=ignored`, `https://open.spotify.com/intl-th/track/${A}`]) assert.equal(spotifySourceId(text), A);
  for (const text of [22, `https://other.example/track/${A}`, 'too-short']) assert.equal(spotifySourceId(text), null);
  assert.equal(trackSourceId({ id: 10, spotifyIds: [A, B] }), null);
  assert.equal(trackSourceId({ id: 10, spotifyUrl: `spotify:track:${B}`, spotifyIds: [A, B] }), B);
  assert.equal(sourceKey(song()), `spotify:${A}`);
  assert.notEqual(sourceKey(song()), sourceKey(song(B)));
});

test('version destinations preserve old aliases, separate collisions, and stay within UTF-8 filename limits', () => {
  const a = { ...song(), artist: '長'.repeat(200) }, b = { ...a, id: B, spotifyIds: [B] };
  assert.notEqual(sourceFileBase(a), sourceFileBase(b));
  assert.equal(fileBase('Artist', 'Track'), 'Artist - Track');
  for (const version of [1, 2, 999]) {
    assert.ok(Buffer.byteLength(sourceFileBase(a, version) + '.mp3') <= 255);
    assert.ok(sourceFileBase(a, version).includes(`[sp-${A}]`));
  }
});

test('legacy terminal outcomes stay parked but never transfer a URL; exact source decisions win', () => {
  for (const state of ['missing', 'no-candidate', 'error']) {
    const old = { key: 'artist - track', state, search_limit: 10, url: 'old-edition', attempts: 5 };
    const rows = new Map([[old.key, old]]);
    assert.deepEqual(sourceJournal(song(), rows), { ...old, key: `spotify:${A}`, url: null, legacyOutcome: true });
    assert.equal(sourceJournal(song(B), rows).state, state);
    assert.equal(old.url, 'old-edition');
    rows.set(`spotify:${A}`, { key: `spotify:${A}`, state: 'pending', url: null });
    assert.equal(sourceJournal(song(), rows).state, 'pending');
    assert.equal(sourceJournal(song(B), rows).state, state);
  }
  for (const state of ['saved', 'done', 'ready', 'retry']) assert.equal(sourceJournal(song(), new Map([['artist - track', { state, url: 'wrong source' }]])), null);
  const tracks = [song(), song(B)].map(s => ({ ...s, key: sourceKey(s) }));
  const counts = resumePlan(tracks, new Map([['artist - track', { state: 'no-candidate', search_limit: 10 }]]), { maxSearches: 10 });
  assert.equal(counts.actionable, 0);
  assert.equal(counts.noCandidate, 2);
});

test('duration hydration refuses ambiguous grouped sources and only accepts exact cached metadata', async t => {
  const f = fixture(t);
  let calls = 0;
  await assert.rejects(createDurationResolver(f.metadata, async () => { calls++; })({ ...song(), spotifyIds: [A, B] }), /ambiguous/);
  assert.equal(calls, 0);
  const raw = { ...song(), durationMs: undefined };
  const path = join(f.metadata, `${A}.json`);
  writeFileSync(path, JSON.stringify({ version: 1, spotifyId: B, name: 'Track', artist: 'Artist', durationMs: 30000 }));
  assert.equal(cachedSourceDuration(f.metadata, A, raw), null);
  writeFileSync(path, JSON.stringify({ version: 1, spotifyId: A, name: 'Track', artist: 'Artist', durationMs: 30000 }));
  assert.equal(cachedSourceDuration(f.metadata, A, raw), 30000);
});

test('wrong local edition is preserved; another local candidate is considered and can be copied safely', async t => {
  const f = fixture(t);
  const wrong = f.file('Playlist', 'Artist - Track.mp3', 60);
  const good = f.file('Elsewhere', 'Artist - Track.mp3', 30);
  const before = statSync(wrong);
  const media = await f.index().resolve(song(), join(f.downloads, 'Playlist'));
  assert.equal(media.local, null);
  assert.equal(media.source, good);
  assert.equal(media.verification, 'duration-match');
  assert.equal(basename(media.destination), sourceFileBase(song()) + '.mp3');
  materialize(media.source, [media.destination]);
  const reread = await f.index().resolve(song(), join(f.downloads, 'Playlist'));
  assert.equal(reread.local, media.destination);
  assert.equal(statSync(wrong).ino, before.ino);
  assert.equal(readFileSync(wrong, 'utf8'), '60');
  assert.equal((await f.index().resolve(song(B, 60000), join(f.downloads, 'Playlist'))).local, wrong);
});

test('a mismatching source-specific destination uses a new stable version slot without overwriting', async t => {
  const f = fixture(t);
  const wrong = f.file('Playlist', sourceFileBase(song()) + '.mp3', 90);
  const result = await f.index().resolve(song(), join(f.downloads, 'Playlist'));
  assert.equal(result.verification, 'mismatch');
  assert.equal(result.source, null);
  assert.equal(basename(result.destination), sourceFileBase(song(), 2) + '.mp3');
  writeFileSync(result.destination, '30');
  assert.equal((await f.index().resolve(song(), join(f.downloads, 'Playlist'))).local, result.destination);
  assert.equal(readFileSync(wrong, 'utf8'), '90');
});

test('CLI shared publication recovers a late occupied name and a fresh index finds the actual tagged file', async t => {
  const f = fixture(t);
  const source = f.file('Staged', 'input.mp3', 30);
  const folder = join(f.downloads, 'Playlist');
  mkdirSync(folder);
  const media = await f.index().resolve(song(), folder);
  const occupied = media.destination;
  const published = publishMp3ForTrack(source, occupied, song(), () => {
    writeFileSync(occupied, '90');
    return true;
  });
  assert.equal(published.created, true);
  assert.equal(basename(published.path), sourceFileBase(song(), 2) + '.mp3');
  const other = join(f.downloads, 'Other', sourceFileBase(song()) + '.mp3');
  const copies = materializeForTrack(published.path, [published.path, other], song());
  assert.equal(copies.added, 1);
  assert.equal((await f.index().resolve(song(), folder)).local, published.path);
  assert.equal(readFileSync(occupied, 'utf8'), '90');
  assert.equal(readFileSync(other, 'utf8'), '30');
});

test('verified independent local encodings are not recopied and own hardlinks do not invalidate handoff evidence', async t => {
  const f = fixture(t);
  const first = f.file('One', 'Artist - Track.mp3', 30);
  const second = f.file('Two', 'Artist - Track.mp3', '30.0');
  const a = await f.index().resolve(song(), join(f.downloads, 'One'));
  const b = await f.index().resolve(song(), join(f.downloads, 'Two'));
  const other = join(f.downloads, 'Other', sourceFileBase(song()) + '.mp3');
  const evidence = { source: a.sourceFingerprint, local: { [first]: a.localFingerprint, [second]: b.localFingerprint } };
  assert.equal(materializeForTrack(first, [other, first, second], song(), evidence).added, 1);
  assert.equal(materializeForTrack(first, [other, first, second], song(), evidence).added, 0);
  assert.equal(readFileSync(second, 'utf8'), '30.0');
});

test('unknown source evidence is not labelled bad or used as a copy source elsewhere', async t => {
  const f = fixture(t);
  const file = f.file('Playlist', 'Artist - Track.mp3', 30);
  const unknown = { ...song(), durationMs: undefined };
  const here = await f.index().resolve(unknown, join(f.downloads, 'Playlist'));
  const away = await f.index().resolve(unknown, join(f.downloads, 'Other'));
  assert.equal(here.verification, 'unverified');
  assert.equal(here.local, file);
  assert.equal(away.verification, 'unverified');
  assert.equal(away.source, null);
});

test('staging output is excluded, and an unreadable candidate cannot establish a match', async t => {
  const f = fixture(t);
  f.file('.spooty-download-batch-old', 'Artist - Track.mp3', 30);
  assert.equal((await f.index().resolve(song(), join(f.downloads, 'Playlist'))).verification, 'missing');
  f.file('Elsewhere', 'Artist - Track.mp3', 'invalid');
  assert.equal((await f.index().resolve(song(), join(f.downloads, 'Playlist'))).verification, 'unverified');
});

test('cache deduplicates hardlinks, survives recreation/root move, and invalidates replacement files', async t => {
  const f = fixture(t);
  const one = f.file('One', 'Artist - Track.mp3', 30);
  const two = join(f.downloads, 'One', 'alias.mp3');
  linkSync(one, two);
  let calls = 0;
  const probe = async file => { calls++; return f.probe(file); };
  const cache = new MediaDurationCache(f.cache, probe);
  assert.deepEqual(await Promise.all([cache.duration(one), cache.duration(two)]), [30, 30]);
  assert.equal(calls, 1);
  const moved = join(f.root, 'moved');
  renameSync(f.downloads, moved);
  assert.equal(await new MediaDurationCache(f.cache, probe).duration(join(moved, 'One', 'alias.mp3')), 30);
  assert.equal(calls, 1);
  const replaced = join(moved, 'One', 'Artist - Track.mp3');
  writeFileSync(join(moved, 'One', 'replacement.mp3'), '600');
  renameSync(join(moved, 'One', 'replacement.mp3'), replaced);
  assert.equal(await cache.duration(replaced), 600);
  assert.equal(calls, 2);
  for (const file of readdirSync(f.cache)) assert.equal(statSync(join(f.cache, file)).mode & 0o777, 0o600);
});

test('changed-during-probe files do not gain cached proof; local probe concurrency stays at four', async t => {
  const f = fixture(t);
  const file = f.file('One', 'Artist - Track.mp3', 30);
  const changed = new MediaDurationCache(f.cache, async path => { writeFileSync(path, '600'); return 30; });
  assert.equal(await changed.duration(file), null);
  assert.equal(readdirSync(f.cache).length, 0);
  let active = 0, maximum = 0;
  const cache = new MediaDurationCache(f.cache, async path => {
    maximum = Math.max(maximum, ++active);
    await new Promise(yes => setTimeout(yes, 3));
    active--;
    return f.probe(path);
  });
  await Promise.all(Array.from({ length: 20 }, (_, n) => cache.duration(f.file('Many', `${n}.mp3`, 30))));
  assert.equal(maximum, 4);
});

test('real CLI catalog separates same-named Spotify versions and repeated occurrences using real ffprobe', async t => {
  const f = fixture(t), playlists = join(f.root, 'playlists'), dbPath = join(f.root, 'db.sqlite');
  mkdirSync(playlists);
  const tracks = [song(A, 1000), song(B, 15000), song(A, 1000)].map((row, n) => ({ ...row, n: n + 1 }));
  writeFileSync(join(playlists, 'playlist.json'), JSON.stringify({ id: 'playlist', name: 'Playlist', tracks }));
  const audio = (folder, seconds) => {
    mkdirSync(join(f.downloads, folder), { recursive: true });
    const file = join(f.downloads, folder, 'Artist - Track.mp3');
    execFileSync('/opt/homebrew/bin/ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(seconds), file]);
    return file;
  };
  const first = audio('Playlist', 1), second = audio('Elsewhere', 15);
  const db = database(dbPath);
  await db.run('CREATE TABLE track_entity(id INTEGER, artist TEXT, name TEXT, spotifyUrl TEXT, youtubeUrl TEXT, error TEXT)');
  for (const [n, id] of [A, B].entries()) await db.run('INSERT INTO track_entity VALUES(?,?,?,?,?,?)', [n + 1, 'Artist', 'Track', `spotify:track:${id}`, `source-${n}`, null]);
  await db.close();
  const before = [first, second].map(path => [statSync(path).ino, statSync(path).size]);
  const plan = await catalog({ playlists, downloads: f.downloads, dbPath, metadataPath: f.metadata, mediaCachePath: f.cache });
  assert.equal(plan.songs.size, 2);
  assert.equal(plan.occurrences, 3);
  const a = plan.songs.get(`spotify:${A}`), b = plan.songs.get(`spotify:${B}`);
  assert.deepEqual(a.rowIds, [1]); assert.deepEqual(b.rowIds, [2]);
  assert.equal(a.occurrences.length, 2); assert.equal(b.occurrences.length, 1);
  assert.equal(a.source, first); assert.equal(b.source, second);
  assert.deepEqual(a.destinations, [first]); assert.notEqual(a.destinations[0], b.destinations[0]);
  assert.equal(b.url, 'source-1'); assert.equal(b.sourceVerified, true);
  assert.deepEqual([first, second].map(path => [statSync(path).ino, statSync(path).size]), before);
  // A wrong, real MP3 arrives after planning. The same helper the CLI calls
  // must recover locally, then survive a new catalog/cache instance.
  const occupied = b.destinations[0];
  copyFileSync(first, occupied);
  const copied = materializeForTrack(b.source, b.destinations, b, {
    source: b.sourceFingerprint, local: b.localEvidence,
  });
  assert.equal(copied.added, 1);
  assert.notEqual(copied.destinations[0], occupied);
  const fresh = await catalog({ playlists, downloads: f.downloads, dbPath, metadataPath: f.metadata, mediaCachePath: f.cache });
  const restored = fresh.songs.get(`spotify:${B}`);
  assert.equal(restored.source, copied.destinations[0]);
  assert.equal(restored.sourceVerified, true);
  assert.deepEqual(restored.destinations, copied.destinations);
  assert.equal(readFileSync(occupied).equals(readFileSync(first)), true);
});
