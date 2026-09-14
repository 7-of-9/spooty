import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DurationCandidates, durationMatch, assertDuration, youtubeDurationFilterArgs, DURATION_REJECTED, DURATION_NO_CANDIDATE } from './duration-policy.mjs';
import { createDurationResolver, validSourceMetadata } from './spotify-duration.mjs';
import { Transport, verifyMp3, classify } from './transport.mjs';

const one = 'dQw4w9WgXcQ', two = 'aqz-KE-bpKQ';
const url = id => `https://www.youtube.com/watch?v=${id}`;
const temp = () => mkdtempSync(join(tmpdir(), 'spooty-duration-test-'));
function fakeTransport(root) {
  const transport = Object.create(Transport.prototype);
  transport.paths = { cookies: '/does-not-exist', temp: root };
  transport.opts = { 'max-searches': 5 };
  transport.runtime = '/runtime';
  transport.cookiesFirst = () => false;
  transport.pace = { run: async (_kind, fn) => fn() };
  transport.process = () => { throw new Error('No production YouTube allowed in tests'); };
  return transport;
}

test('fuzzy boundaries reject long medleys, short clips, unknowns and nonfinite data', () => {
  for (const [ms, tolerance] of [[60000, 5], [180000, 9], [360000, 18], [900000, 20]]) {
    assert.equal(durationMatch(ms, ms / 1000 + tolerance).ok, true);
    assert.equal(durationMatch(ms, ms / 1000 - tolerance).ok, true);
    assert.equal(durationMatch(ms, ms / 1000 + tolerance + 0.01).ok, false);
  }
  assert.equal(durationMatch(78800, 240.512).ok, false);
  assert.equal(durationMatch(378117, 34.086).ok, false);
  for (const invalid of [undefined, null, 0, -1, NaN, Infinity, '180']) {
    assert.equal(durationMatch(invalid, 180).ok, false);
    assert.equal(durationMatch(180000, invalid).ok, false);
  }
});

test('exact Spotify ID and title tolerate documented ten-artist truncation, not changed identity or arbitrary prefixes', () => {
  const id = '5mdA4XPkSB6P00bxa1MF4a';
  const artist = Array.from({ length: 10 }, (_, i) => `Artist${i}`).join(', ');
  const song = { artist, name: 'Song' };
  const metadata = { version: 1, spotifyId: id, name: 'Song', artist: artist + ', Additional Artist', durationMs: 180000 };
  assert.equal(validSourceMetadata(metadata, id, song), true);
  assert.equal(validSourceMetadata({ ...metadata, spotifyId: '4mdA4XPkSB6P00bxa1MF4a' }, id, song), false);
  assert.equal(validSourceMetadata({ ...metadata, name: 'Another Song' }, id, song), false);
  assert.equal(validSourceMetadata({ ...metadata, artist: artist + 'Different' }, id, song), false);
  assert.equal(validSourceMetadata({ ...metadata, artist: artist.replace('Artist0', 'Other') }, id, song), false);
  assert.equal(validSourceMetadata({ ...metadata, artist: 'Artist, Other' }, id, { ...song, artist: 'Artist' }), false);
});

test('gated source hydration caches only matching allowlisted metadata and coalesces concurrent requests', async () => {
  const root = temp();
  try {
    const id = '5mdA4XPkSB6P00bxa1MF4a';
    const song = () => ({ spotifyIds: [id], name: 'The Bottomless Pit', artist: 'Joe Hisaishi' });
    let fetched = 0;
    const resolver = createDurationResolver(root, async spotifyId => {
      fetched++; await new Promise(resolve => setImmediate(resolve));
      return { version: 1, spotifyId, name: song().name, artist: song().artist, durationMs: 78800,
        fetchedAt: '2026-09-13T00:00:00Z', token: 'must-not-be-persisted' };
    });
    assert.deepEqual(await Promise.all([resolver(song()), resolver(song())]), [78800, 78800]);
    assert.equal(fetched, 1);
    const path = join(root, id + '.json');
    assert.equal(readFileSync(path, 'utf8').includes('must-not-be-persisted'), false);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const cached = createDurationResolver(root, async () => { throw new Error('must not fetch'); });
    assert.equal(await cached(song()), 78800);
    await assert.rejects(cached({ ...song(), name: 'Different recording' }), /unavailable/);
    await assert.rejects(cached({ name: 'No ID', artist: 'A' }), /unavailable/);
    await assert.rejects(cached({ ...song(), durationMs: 78800, durationConflict: true }), /conflict/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('normal guarded search examines five candidates and skips obviously wrong first result', async () => {
  const root = temp();
  try {
    const transport = fakeTransport(root);
    const policy = new DurationCandidates(join(root, 'rejections.json'));
    transport.process = async (args, _kind, _timeout, onLine) => {
      assert.ok(args.includes('ytsearch5:A Song'));
      onLine(JSON.stringify({ original_url: 'ytsearch5:A Song', entries: [
        { id: one, title: 'full album', duration: 3600 }, { id: two, title: 'Song', duration: 184 }] }));
      return { code: 0 };
    };
    const song = { key: 'a - song', artist: 'A', name: 'Song', durationMs: 180000 };
    let selected;
    assert.deepEqual(await transport.search([song], (_s, value) => { selected = value; }, policy), []);
    assert.equal(selected, url(two));
    song.url = selected;
    policy.advance(song);
    assert.equal(song.url, null);
    const recovered = new DurationCandidates(join(root, 'rejections.json'));
    assert.equal(recovered.choose(song, [{ url: selected, durationSeconds: 184 }]), null);
    assert.equal(recovered.choose(song, [{ url: `https://youtu.be/${two}`, durationSeconds: 184 }]), null);
    const failures = await transport.search([song], () => { throw new Error('must not publish'); }, recovered);
    assert.equal(failures[0].error, DURATION_NO_CANDIDATE);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('unknown or malformed candidates produce no acceptable candidate; only a genuinely empty search may be Missing', async () => {
  const root = temp();
  try {
    const transport = fakeTransport(root);
    const policy = new DurationCandidates(join(root, 'rejections.json'));
    const song = { key: 'a', artist: 'A', name: 'Song', durationMs: 180000 };
    for (const entries of [[{ id: one }], [{ id: 'invalid', duration: 180 }], [{ id: one, duration: 3600 }]]) {
      transport.process = async (_args, _kind, _timeout, onLine) => {
        onLine(JSON.stringify({ original_url: 'ytsearch5:A Song', entries }));
        return { code: 0 };
      };
      const failures = await transport.search([song], () => { assert.fail('not a Missing or ready result'); }, policy);
      assert.equal(failures[0].error, DURATION_NO_CANDIDATE);
    }
    transport.process = async (_args, _kind, _timeout, onLine) => {
      onLine(JSON.stringify({ original_url: 'ytsearch5:A Song', entries: [] })); return { code: 0 };
    };
    let result = 'not called';
    assert.deepEqual(await transport.search([song], (_song, found) => { result = found; }, policy), []);
    assert.equal(result, null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('default ten-result search reaches the tenth candidate without five-result truncation', async () => {
  const root = temp();
  try {
    const transport = fakeTransport(root);
    transport.opts = {}; // Production default, not the explicit five-result fixture.
    const policy = new DurationCandidates(join(root, 'rejections.json'));
    let calls = 0;
    transport.process = async (args, _kind, _timeout, onLine) => {
      calls++;
      assert.ok(args.includes('ytsearch10:A Song'));
      onLine(JSON.stringify({ original_url: 'ytsearch10:A Song', entries: Array.from({ length: 10 }, (_, i) => ({
        id: `candidate${String(i).padStart(2, '0')}`, title: `Result ${i + 1}`, duration: i === 9 ? 184 : 3600,
      })) }));
      return { code: 0 };
    };
    const song = { key: 'a - song', artist: 'A', name: 'Song', durationMs: 180000 };
    let selected;
    assert.deepEqual(await transport.search([song], (_s, value) => { selected = value; }, policy), []);
    assert.equal(selected, url('candidate09'));
    assert.equal(song.searchLimit, 10);
    assert.equal(song.searchDisqualified, 9);
    assert.equal(calls, 1); // Ten results, not ten repeated requests.
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('cached URLs carry ID-bound pre-media filters; filtered output is a candidate rejection', async () => {
  const root = temp();
  try {
    const transport = fakeTransport(root);
    transport.process = async args => {
      const filter = args[args.indexOf('--match-filter') + 1];
      assert.ok(filter.includes(`id = '${one}'`));
      assert.ok(filter.includes('duration >= 171.000000'));
      assert.ok(filter.includes('duration <= 189.000000'));
      assert.ok(!filter.includes('?'));
      return { code: 0 };
    };
    const song = { key: 'cached', url: url(one), durationMs: 180000 };
    const failures = await transport.download([song], () => { throw new Error('must not publish'); }, () => {}, true);
    assert.equal(failures[0].error, DURATION_REJECTED);
    await assert.rejects(transport.download([{ ...song, durationMs: undefined }], () => {}, () => {}, true), /Spotify source duration/);
    assert.throws(() => youtubeDurationFilterArgs([{ videoId: "bad'ID", expectedMs: 180000 }]));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('final-file duration mismatch cannot reach publication even if extraction metadata claimed a match', async () => {
  const root = temp();
  try {
    const transport = fakeTransport(root);
    let published = false;
    transport.process = async (args, _kind, _timeout, onLine) => {
      const path = args[args.indexOf('-o') + 1].replace('%(id)s', one).replace('%(ext)s', 'mp3');
      execFileSync('/opt/homebrew/bin/ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-q:a', '0', path]);
      onLine('SPOOTY_RESULT:' + JSON.stringify({ id: one, filepath: path, duration: 180 }));
      return { code: 0 };
    };
    const song = { key: 'mismatch', url: url(one), durationMs: 180000 };
    const failures = await transport.download([song], async (s, file) => {
      assertDuration(s.durationMs, await verifyMp3(file));
      published = true;
    }, () => {}, true);
    assert.equal(published, false);
    assert.equal(failures[0].error, DURATION_REJECTED);
    assert.equal(classify(DURATION_REJECTED), DURATION_REJECTED);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('mixed nonzero batch keeps a source failure separate from a scoped duration rejection', async () => {
  const root = temp();
  try {
    const transport = fakeTransport(root);
    transport.process = async (args, _kind, _timeout, onLine) => {
      assert.ok(args.some(arg => arg.startsWith('pre_process:SPOOTY_CANDIDATE:')));
      assert.ok(args.includes('--no-simulate'));
      onLine('SPOOTY_CANDIDATE:' + JSON.stringify({ id: one, duration: 3600 }));
      return { code: 1, error: 'Selected YouTube video unavailable' };
    };
    const songs = [one, two].map(id => ({ key: id, url: url(id), durationMs: 180000 }));
    const failures = await transport.download(songs, () => assert.fail('must not publish'), () => {}, true);
    assert.equal(failures.find(f => f.song.key === one).error, DURATION_REJECTED);
    assert.equal(failures.find(f => f.song.key === two).error, 'Selected YouTube video unavailable');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
