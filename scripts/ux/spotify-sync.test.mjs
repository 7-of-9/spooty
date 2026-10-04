import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('ts-node').register({
  transpileOnly: true, skipProject: true,
  compilerOptions: { module: 'commonjs', target: 'es2022' },
});
const { keptLocallyCheckedAt, playlistEmptyMessage, playlistFreshness, playlistSyncResult, recentCompletedSync, spotifySyncProblem, spotifySyncProgress, spotifySyncResult, syncResultMatchesRequest, syncObservationKey } = require('../../src/frontend/src/app/components/library-panel/spotify-sync-state.ts');
const { chromeConnectionGuidance } = require('../../src/frontend/src/app/models/spotify-connection.ts');

const finished = {
  running: false, done: 8, total: 8, discovered: 0, changed: 0,
  errors: [], current: '', startedAt: '2026-09-15T04:00:00Z',
  finishedAt: '2026-09-15T04:01:00Z',
};

test('kept-local explanation requires a complete dated absence observation', () => {
  const checkedAt = '2026-09-15T04:00:00Z';
  assert.equal(keptLocallyCheckedAt({}), null);
  for (const state of ['present', 'unknown', undefined]) {
    assert.equal(keptLocallyCheckedAt({ libraryPresence: { state, checkedAt } }), null);
  }
  for (const date of [undefined, null, '', 'bad-date', 0]) {
    assert.equal(keptLocallyCheckedAt({ libraryPresence: { state: 'not-returned', checkedAt: date } }), null);
  }
  assert.equal(keptLocallyCheckedAt({ libraryPresence: { state: 'not-returned', checkedAt } }), checkedAt);
});

test('an empty library receipt explains why saved playlists remain', () => {
  const result = spotifySyncResult({ ...finished, total: 0, done: 0 });
  assert.equal(result.title, 'No Spotify playlists found');
  assert.equal(result.detail, 'Your saved playlists and MP3s were kept.');
});

test('freshness separates a complete Spotify check from an old dump timestamp', () => {
  const syncedAt = '2026-09-10T06:37:19Z';
  assert.equal(playlistFreshness({ syncedAt }).label, 'Saved locally');
  assert.match(playlistFreshness({ syncedAt }).help, /not yet verified/);
  assert.equal(playlistFreshness({ syncedAt, membershipVerified: true }).label, 'Checked with Spotify');
  assert.equal(playlistFreshness({ syncedAt, membershipVerified: true }).at, syncedAt);
});
test('freshness never sends missing or invalid timestamps to the date renderer', () => {
  for (const syncedAt of [undefined, null, '', 'not-a-date']) {
    assert.equal(playlistFreshness({ syncedAt }).at, null);
    assert.equal(playlistFreshness({ syncedAt, membershipVerified: true }).at, null);
  }
});

test('an acknowledged operation cannot take credit for a different completed sync', () => {
  const request = { operationId: 'current', startedAt: Date.parse(finished.startedAt), responseLost: false };
  assert.equal(syncResultMatchesRequest({ ...finished, operationId: 'current' }, request), true);
  assert.equal(syncResultMatchesRequest({ ...finished, operationId: 'previous' }, request), false);
});
test('a lost POST response plus an older completion is unconfirmed, not success', () => {
  const request = { operationId: null, startedAt: Date.parse(finished.finishedAt) + 1000, responseLost: true };
  assert.equal(syncResultMatchesRequest(finished, request), false);
  assert.equal(syncResultMatchesRequest({ ...finished, startedAt: null }, request), false);
  assert.equal(syncResultMatchesRequest({ ...finished, startedAt: new Date(request.startedAt).toISOString() }, request), true);
});
test('an observed running operation is followed even when another tab submitted it', () => {
  assert.equal(syncResultMatchesRequest({ ...finished, running: true, operationId: 'other' }, {
    operationId: 'requested', startedAt: Date.now(), responseLost: true,
  }), true);
});
test('observation keys detect completion and new operations, not every progress tick', () => {
  const running = { ...finished, running: true, operationId: 'one', finishedAt: null };
  assert.equal(syncObservationKey(running), syncObservationKey({ ...running, done: 4, current: 'Other track' }));
  assert.notEqual(syncObservationKey(running), syncObservationKey({ ...running, running: false, finishedAt: finished.finishedAt }));
  assert.notEqual(syncObservationKey(running), syncObservationKey({ ...running, operationId: 'two' }));
});

test('a shorter playlist receipt reflects confirmed removals within this playlist folder', () => {
  const shortened = playlistSyncResult({ name: 'My playlist', before: 20, after: 17, removedFiles: 3 }).detail;
  assert.match(shortened, /20 → 17 tracks/);
  assert.match(shortened, /Removed 3 local copies from this playlist folder/);
  const empty = playlistSyncResult({ name: 'My playlist', before: 20, after: 0 }).detail;
  assert.match(empty, /20 → 0 tracks/);
  assert.match(empty, /This playlist folder now follows Spotify/);
  assert.doesNotMatch(empty, /MP3s unchanged|MP3s and queued work were kept|Removed \d/);
});
test('a same-count sync acknowledges the check without claiming downloads', () => {
  assert.match(playlistSyncResult({ name: 'My playlist', before: 20, after: 20 }).detail, /20 tracks checked. MP3s unchanged/);
});
test('verified empty, unsupported-only, and not-yet-loaded playlists are distinct', () => {
  assert.match(playlistEmptyMessage({}), /No track list saved yet/);
  assert.match(playlistEmptyMessage({ membershipVerified: true, excludedItems: 0 }), /Spotify playlist is empty/);
  assert.match(playlistEmptyMessage({ membershipVerified: true, excludedItems: 2 }), /podcasts or local-only/);
});
test('inconsistent membership explains preservation and a scoped recovery action', () => {
  assert.match(spotifySyncProblem('Spotify playlist changed while confirming removals. Saved membership kept'), /previous list and MP3s were kept/);
});
test('incomplete discovery describes the playlist library, not an individual track list', () => {
  const detail = spotifySyncProblem('Spotify library discovery incomplete: page gap. Saved library kept.');
  assert.match(detail, /complete playlist library/);
  assert.match(detail, /saved playlists and MP3s were kept/);
  assert.match(detail, /Sync Spotify library/);
  assert.doesNotMatch(detail, /complete track list/);
});
test('an unverified fallback does not falsely claim the previous track list was preserved', () => {
  const message = spotifySyncProblem('Spotify playlist membership was not fully verified. No new snapshot baseline was saved.');
  assert.match(message, /loaded track list could not be fully verified/);
  assert.match(message, /Existing MP3s are unchanged/);
  assert.doesNotMatch(message, /previous list.*kept/);
});

test('no-change completion acknowledges Spotify check and separates MP3s', () => {
  assert.deepEqual(spotifySyncResult(finished), {
    title: 'Spotify library synced', detail: '8 playlists checked. MP3s unchanged.',
  });
});

test('restored focused operation keeps its target and result, not library-wide claims', () => {
  const status = { ...finished, scope: 'playlist', playlistName: 'My playlist', result: { id: 'one', name: 'My playlist', before: 20, after: 17 } };
  assert.equal(spotifySyncProgress({ ...status, running: true }), 'Updating My playlist from Spotify…');
  assert.match(spotifySyncResult(status).detail, /20 → 17 tracks/);
  assert.equal(spotifySyncResult(status).title, 'Playlist updated from Spotify');
});
test('bulk metadata sync acknowledges changed counts without falsely saying they all grew', () => {
  const result = spotifySyncResult({ ...finished, scope: 'saved-playlists', changed: 2 });
  assert.equal(result.title, 'Saved playlists synced');
  assert.equal(result.detail, '8/8 playlists checked · 2 changed. MP3s unchanged.');
});
test('a focused operation with no completed result is not reported as success', () => {
  assert.equal(spotifySyncResult({ ...finished, scope: 'playlist', result: null }).title, 'Playlist sync interrupted');
});
test('recent completion is restored without immediately rerunning sync on page load', () => {
  const now = Date.parse(finished.finishedAt) + 1000;
  for (const scope of ['playlist', 'library', 'saved-playlists']) assert.equal(recentCompletedSync({ ...finished, scope }, now), true);
  assert.equal(recentCompletedSync(finished, now + 15 * 60000), false);
  assert.equal(recentCompletedSync({ ...finished, running: true }, now), false);
  assert.equal(recentCompletedSync({ ...finished, finishedAt: null }, now), false);
});
test('new playlists and refreshed track lists have distinct units', () => {
  assert.equal(spotifySyncResult({ ...finished, discovered: 2, changed: 3 }).detail,
    '8 playlists checked · 2 new · 3 track lists refreshed. MP3s unchanged.');
});
test('empty Spotify library is not falsely called fully synced audio', () => {
  assert.equal(spotifySyncResult({ ...finished, done: 0, total: 0 }).title, 'No Spotify playlists found');
});
test('partial results remain incomplete, never a success receipt', () => {
  const result = spotifySyncResult({ ...finished, discovered: 2, errors: ['Playlist failed: 429'] });
  assert.equal(result.title, 'Spotify sync incomplete');
  assert.match(result.detail, /Spotify is limiting requests/);
  assert.match(result.detail, /saved library is still available/);
});
test('server restart is terminal interrupted state, not an endless spinner', () => {
  const result = spotifySyncResult({ ...finished, finishedAt: null });
  assert.equal(result.title, 'Spotify sync interrupted');
  assert.match(result.detail, /Sync again to continue/);
});
test('playlist discovery is not reported as a percentage or download', () => {
  assert.equal(spotifySyncProgress({ ...finished, total: 0 }), 'Getting your playlist library from Spotify…');
});
test('known total reports exact playlist and current name', () => {
  assert.equal(spotifySyncProgress({ ...finished, done: 3, current: 'My playlist' }),
    'Checking playlists 3/8 · My playlist');
});
for (const problem of ['CDP proxy disconnected', 'Chrome bridge disconnected', 'Spotify session unavailable']) {
  test(`unavailable session explains saved fallback without requesting Chrome permission: ${problem}`, () => {
    assert.match(spotifySyncProblem(problem), /no new Chrome permission request was opened/);
  });
}
test('unknown technical failure stays in details, not in a large raw error banner', () => {
  assert.equal(spotifySyncProblem('ECONNREFUSED private internal details'),
    'Spotify could not finish syncing. Your saved library is still available. See Activity details for the cause.');
});

test('Chrome connected is not labelled a completed Spotify sync', () => {
  assert.match(chromeConnectionGuidance('connected'), /Use Sync Spotify library/);
  assert.doesNotMatch(chromeConnectionGuidance('connected'), /successfully synced|playlists updated/i);
});
test('awaiting permission explains one request without false download progress', () => {
  assert.match(chromeConnectionGuidance('connecting'), /One connection request/);
  assert.match(chromeConnectionGuidance('connecting'), /No additional requests/);
});
test('unavailable bridge and disconnected Chrome have distinct recovery steps', () => {
  assert.match(chromeConnectionGuidance('unavailable'), /Start the existing bridge/);
  assert.match(chromeConnectionGuidance('disconnected'), /Connect once when you are ready/);
});
