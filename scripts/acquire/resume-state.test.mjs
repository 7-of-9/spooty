import test from 'node:test';
import assert from 'node:assert/strict';
import { resumedSong, resumePlan } from './resume-state.mjs';

test('plan and run share the exact saved/missing/exhausted/resume decision', () => {
  const songs = [
    { key: 'saved', source: '/existing.mp3' }, { key: 'missing', missing: true },
    { key: 'selection' }, { key: 'failure' }, { key: 'new' }, { key: 'cached', url: 'url' },
  ];
  const prior = new Map([
    ['saved', { state: 'error' }], ['selection', { state: 'no-candidate', search_limit: 10, url: 'bad' }],
    ['failure', { state: 'error', error: 'Spotify source duration unavailable', attempts: 5, network_attempts: 2 }],
  ]);
  assert.deepEqual(resumePlan(songs, prior, {}), {
    saved: 1, missing: 1, noCandidate: 1, exhaustedErrors: 1, ready: 1, pending: 1,
    actionable: 2, fastSkipped: 4, notSaved: 5,
  });
  const retried = resumePlan(songs, prior, { retryErrors: true });
  assert.equal(retried.actionable, 3);
  assert.equal(retried.noCandidate, 1);
  const deeper = resumePlan(songs, prior, { maxSearches: 20 });
  assert.equal(deeper.actionable, 3);
  assert.equal(deeper.noCandidate, 0);
  assert.equal(deeper.exhaustedErrors, 1);
  assert.equal(songs[2].url, undefined); // Read-only projection.
});

test('resuming keeps errors visible and resets only explicitly reopened failure budgets', () => {
  const old = { state: 'error', error: 'Local network unavailable', attempts: 4, network_attempts: 6, retry_at: 100 };
  const held = resumedSong({ key: 'x' }, old);
  assert.equal(held.error, old.error);
  assert.equal(held.networkAttempts, 6);
  const resumed = resumedSong({ key: 'x' }, old, { retryErrors: true });
  assert.equal(resumed.state, 'pending');
  assert.equal(resumed.attempts, 0);
  assert.equal(resumed.networkAttempts, 0);
  assert.equal(resumed.error, null);
  assert.equal(resumed.retryAt, 0);
});
