import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateLimits, recordCandidateOutcome, selectionStateOnResume, isNetworkFailure, networkFailureState, preparedSearchBufferSize, readyDownloadCandidates } from './candidate-policy.mjs';
import { DURATION_REJECTED, DURATION_NO_CANDIDATE } from './duration-policy.mjs';

test('candidate depth defaults to ten and is independent of five additional network retries', () => {
  assert.deepEqual(candidateLimits(), { maxSearches: 10, networkRetries: 5 });
  assert.deepEqual(candidateLimits({ 'max-searches': '5', 'network-retries': '0' }), { maxSearches: 5, networkRetries: 0 });
  for (const value of ['0', '51', '1.5', 'NaN']) assert.throws(() => candidateLimits({ 'max-searches': value }), /max-searches/);
  for (const value of ['-1', '21', '1.5', 'NaN']) assert.throws(() => candidateLimits({ 'network-retries': value }), /network-retries/);
});

test('candidate rejection advances immediately without changing network or operation failure counts', () => {
  const song = { url: 'next-candidate', attempts: 3, networkAttempts: 2, retryAt: 999999 };
  assert.equal(recordCandidateOutcome(song), 'ready');
  assert.equal(song.retryAt, 0);
  assert.equal(song.error, null);
  assert.equal(song.attempts, 3);
  assert.equal(song.networkAttempts, 2);
  song.url = null;
  assert.equal(recordCandidateOutcome(song, { coolUntil: 100 }), 'pending');
  assert.equal(song.retryAt, 100); // A global network cooldown still applies.
  song.durationCandidates = [];
  assert.equal(recordCandidateOutcome(song), 'no-candidate');
  assert.equal(song.error, DURATION_NO_CANDIDATE);
  assert.equal(song.attempts, 3);
  assert.equal(song.networkAttempts, 2);
});

test('exhausting candidate results is parked, not Missing and not another network retry', () => {
  const song = { url: 'stale', attempts: 0, networkAttempts: 0 };
  assert.equal(recordCandidateOutcome(song, { exhausted: true }), 'no-candidate');
  assert.equal(song.url, null);
  assert.equal(song.retryAt, 0);
  assert.equal(song.networkAttempts, 0);
  assert.equal(song.attempts, 0);
  for (const error of [DURATION_REJECTED, DURATION_NO_CANDIDATE]) assert.equal(isNetworkFailure(error), false);
});

test('only increasing candidate depth reopens exhausted selection, including old five-result journal rows', () => {
  for (const old of [{ state: 'no-candidate', search_limit: 5 }, { state: 'error', error: 'No duration-matched YouTube candidate; retry needed' }]) {
    assert.equal(selectionStateOnResume(old, 10), 'pending');
    assert.equal(selectionStateOnResume(old, 5), 'no-candidate');
  }
  assert.equal(selectionStateOnResume({ state: 'no-candidate', search_limit: 10 }, 10), 'no-candidate');
  assert.equal(selectionStateOnResume({ state: 'error', error: 'Local network unavailable' }, 10), null);
});

test('five network retries permits initial request plus five, with zero disabling repetition', () => {
  for (let failures = 1; failures <= 5; failures++) assert.equal(networkFailureState(failures, 5), 'retry');
  assert.equal(networkFailureState(6, 5), 'error');
  assert.equal(networkFailureState(1, 0), 'error');
  for (const error of ['Local network unavailable', 'YouTube rate limit or bot check', 'YouTube operation timed out', 'Media URL rejected (403)']) assert.equal(isNetworkFailure(error), true);
  assert.equal(isNetworkFailure('MP3 tags could not be written'), false);
});

test('thousands of unvalidated cached URLs cannot starve duration-matched search or overtake prepared results', () => {
  const cached = Array.from({ length: 2200 }, (_, i) => ({ key: `cached${i}`, url: `old${i}`, state: 'ready', retryAt: 0 }));
  const prepared = { key: 'prepared', state: 'ready', retryAt: 0, url: 'matched', durationCandidates: [{ url: 'matched' }] };
  const waiting = { ...prepared, key: 'backoff', retryAt: 1000 };
  assert.equal(preparedSearchBufferSize(cached), 0);
  assert.equal(preparedSearchBufferSize([...cached, prepared]), 1);
  const ready = readyDownloadCandidates([...cached, prepared, waiting], 100);
  assert.equal(ready[0].key, 'prepared');
  assert.equal(ready[1].key, 'cached0');
  assert.equal(ready.length, 2201);
  assert.equal(preparedSearchBufferSize([{ ...prepared, state: 'downloading' }]), 0);
});
