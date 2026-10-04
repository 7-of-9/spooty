import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectIdentityEvidence, inspectConflictingFiles, probeDuration } from './track-identity-audit.mjs';

const shortId = '1111111111111111111111', longId = '2222222222222222222222';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'spooty-identity-audit-'));
  const playlists = join(root, 'playlists'), metadata = join(root, 'metadata'), downloads = join(root, 'downloads');
  for (const path of [playlists, metadata, downloads]) mkdirSync(path);
  const track = (id = shortId, n = 1, name = 'Song') => ({ id, n, artist: 'Artist', name });
  const writePlaylist = (name, tracks) => writeFileSync(join(playlists, `${name}.json`), JSON.stringify({ id: name, name, tracks }));
  const cache = (id, durationMs, overrides = {}) => writeFileSync(join(metadata, `${id}.json`), JSON.stringify({ version: 1, spotifyId: id,
    artist: 'Artist', name: 'Song', durationMs, fetchedAt: '2026-09-15T00:00:00Z', ...overrides }));
  const audio = (playlist, bytes = 'audio fixture') => {
    mkdirSync(join(downloads, playlist), { recursive: true });
    const path = join(downloads, playlist, 'Artist - Song.mp3'); writeFileSync(path, bytes); return path;
  };
  return { root, playlists, metadata, downloads, track, writePlaylist, cache, audio,
    collect: () => collectIdentityEvidence(playlists, metadata), close: () => rmSync(root, { recursive: true, force: true }) };
}

test('different Spotify IDs alone are not labelled a duration conflict; unknown evidence stays unknown', () => {
  const f = fixture();
  try {
    f.writePlaylist('Saved', [f.track(), f.track(longId, 2)]);
    f.cache(shortId, 180000); f.cache(longId, 181000);
    let report = f.collect();
    assert.equal(report.counts.multipleSpotifyIds, 1);
    assert.equal(report.counts.disjointDurationGroups, 0);
    f.cache(longId, 300000, { name: 'Unrelated song' });
    report = f.collect();
    assert.equal(report.groups[0].sources[1].durationMs, null);
    assert.equal(report.counts.disjointDurationGroups, 0);
    assert.match(report.scope, /Unknown durations remain unknown/);
  } finally { f.close(); }
});

test('disjoint shared-policy duration windows expose filename collisions, including two occurrences in one playlist', () => {
  const f = fixture();
  try {
    f.writePlaylist('Saved', [f.track(), f.track(longId, 2), f.track(shortId, 3)]);
    f.writePlaylist('Daily Mix 1', [f.track()]);
    f.cache(shortId, 180000); f.cache(longId, 300000);
    const report = f.collect();
    assert.deepEqual(report.counts, { playlists: 1, occurrences: 3, filenameKeys: 1, spotifyTrackIds: 2, multipleSpotifyIds: 1,
      distinctArtistTitleSpellings: 0, multipleIdsWithAtLeastTwoVerifiedDurations: 1, disjointDurationGroups: 1 });
    assert.equal(report.groups[0].occurrences.length, 3);
    assert.equal(report.groups[0].sources[0].metadataFetchedAt, '2026-09-15T00:00:00Z');
  } finally { f.close(); }
});

test('probes hardlinked audio once and distinguishes wrong local audio from compatible/incompatible reuse', () => {
  const f = fixture();
  try {
    f.writePlaylist('Wrong local', [f.track()]);
    f.writePlaylist('Right local', [f.track(longId)]);
    f.writePlaylist('Short missing', [f.track()]);
    f.writePlaylist('Long missing', [f.track(longId)]);
    f.cache(shortId, 180000); f.cache(longId, 300000);
    const source = f.audio('Wrong local');
    mkdirSync(join(f.downloads, 'Right local'));
    linkSync(source, join(f.downloads, 'Right local', 'Artist - Song.mp3'));
    f.audio('.spooty-download-batch-unpublished');
    let probes = 0;
    const report = inspectConflictingFiles(f.collect(), f.downloads, () => { probes++; return 301; });
    assert.equal(probes, 1);
    assert.deepEqual(report.fileCounts, { occurrences: 4, localMatch: 1, localMismatch: 1, localUnknown: 0,
      compatibleElsewhere: 1, incompatibleElsewhere: 1, unknownElsewhere: 0, noFile: 0, uniqueInodesProbed: 1 });
    assert.equal(readFileSync(source, 'utf8'), 'audio fixture');
    assert.match(report.fileScope, /No files are deleted/);
  } finally { f.close(); }
});

test('retains multiple same-name files so a valid alternative is not hidden by the first index hit', () => {
  const f = fixture();
  try {
    f.writePlaylist('Need short', [f.track()]); f.writePlaylist('Need long', [f.track(longId)]);
    f.cache(shortId, 180000); f.cache(longId, 300000);
    const short = f.audio('Existing short'); const long = f.audio('Existing long');
    const report = inspectConflictingFiles(f.collect(), f.downloads, path => path === short ? 180 : 300);
    assert.equal(report.fileCounts.compatibleElsewhere, 2);
    const rows = report.groups[0].occurrences;
    assert.deepEqual(rows.find(o => o.spotifyId === shortId).fileEvidence.compatiblePaths, [short]);
    assert.deepEqual(rows.find(o => o.spotifyId === longId).fileEvidence.compatiblePaths, [long]);
  } finally { f.close(); }
});

test('unknown ffprobe output is never a match or a mismatch, and missing media remains missing', () => {
  const f = fixture();
  try {
    f.writePlaylist('Local', [f.track()]); f.writePlaylist('Absent', [f.track(longId)]);
    f.cache(shortId, 180000); f.cache(longId, 300000);
    assert.equal(inspectConflictingFiles(f.collect(), f.downloads, () => assert.fail('no file')).fileCounts.noFile, 2);
    f.audio('Local');
    const report = inspectConflictingFiles(f.collect(), f.downloads, () => null);
    assert.equal(report.fileCounts.localUnknown, 1);
    assert.equal(report.fileCounts.unknownElsewhere, 1);
    assert.equal(report.fileCounts.localMismatch, 0);
    assert.equal(probeDuration('not-a-file', '/usr/bin/false'), null);
  } finally { f.close(); }
});

test('records filename-normalization collisions without treating spelling alone as proof of bad audio', () => {
  const f = fixture();
  try {
    f.writePlaylist('Saved', [f.track(shortId, 1, 'A/B'), f.track(longId, 2, 'AB')]);
    const report = f.collect();
    assert.equal(report.counts.filenameKeys, 1);
    assert.equal(report.counts.distinctArtistTitleSpellings, 1);
    assert.equal(report.counts.disjointDurationGroups, 0);
  } finally { f.close(); }
});
