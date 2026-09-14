import { DURATION_REJECTED, DURATION_NO_CANDIDATE } from './duration-policy';

export function candidateLimits(options: any = {}) {
  const maxSearches = Number(options['max-searches'] ?? 10);
  const networkRetries = Number(options['network-retries'] ?? 5);
  if (!Number.isInteger(maxSearches) || maxSearches < 1 || maxSearches > 50)
    throw new Error('Invalid --max-searches; use 1–50 candidate results');
  if (
    !Number.isInteger(networkRetries) ||
    networkRetries < 0 ||
    networkRetries > 20
  )
    throw new Error(
      'Invalid --network-retries; use 0–20 additional network attempts',
    );
  return { maxSearches, networkRetries };
}

export const isCandidateOutcome = (error) =>
  error === DURATION_REJECTED ||
  error === DURATION_NO_CANDIDATE ||
  /^No duration-matched YouTube candidate/.test(error || '');
export const isNetworkFailure = (error) =>
  /network|timed out|timeout|rate limit|bot check|Media URL rejected \(403\)/i.test(
    error || '',
  );

export function candidateStateAfterRejection(song) {
  if (song.url) return 'ready';
  // A cached URL can be rejected before any search has run. Search once then.
  return Array.isArray(song.durationCandidates) ? 'no-candidate' : 'pending';
}

export function recordCandidateOutcome(
  song,
  { exhausted = false, coolUntil = 0 } = {},
) {
  if (exhausted) song.url = null;
  song.state = exhausted ? 'no-candidate' : candidateStateAfterRejection(song);
  song.retryAt = song.state === 'no-candidate' ? 0 : coolUntil;
  song.error = song.state === 'no-candidate' ? DURATION_NO_CANDIDATE : null;
  // No changes to either failure-attempt counter: this is result selection.
  return song.state;
}

export function selectionStateOnResume(old, maxSearches) {
  if (old?.state !== 'no-candidate' && !isCandidateOutcome(old?.error))
    return null;
  return maxSearches > (old.search_limit || 5) ? 'pending' : 'no-candidate';
}

export function networkFailureState(failures, retryLimit) {
  // Five retries means the initial request plus at most five repetitions.
  return failures > retryLimit ? 'error' : 'retry';
}

export function isSearchedCandidate(song) {
  return (
    Array.isArray(song.durationCandidates) &&
    song.durationCandidates.some((candidate) => candidate.url === song.url)
  );
}

export function preparedSearchBufferSize(songs) {
  // Old cached URLs have not passed the new search duration check. They must
  // not fill the ready buffer and starve searches for rejected cached sources.
  return songs.filter(
    (song) => song.state === 'ready' && isSearchedCandidate(song),
  ).length;
}

export function readyDownloadCandidates(songs, now) {
  return songs
    .filter((song) => song.state === 'ready' && song.retryAt <= now)
    .sort(
      (a, b) => Number(isSearchedCandidate(b)) - Number(isSearchedCandidate(a)),
    );
}
