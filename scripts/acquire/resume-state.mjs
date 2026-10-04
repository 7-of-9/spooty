import { existsSync } from 'node:fs';
import { database, sourceJournal } from './catalog.mjs';
import { selectionStateOnResume } from './candidate-policy.mjs';
import { DURATION_NO_CANDIDATE } from './duration-policy.mjs';

// The plan and actual run use this same decision. No I/O or mutations of input.
export function resumedSong(song, old, { maxSearches = 10, retryErrors = false } = {}) {
  const result = { ...song, url: song.url || old?.url || null,
    attempts: old?.attempts || 0, networkAttempts: old?.network_attempts || 0,
    searchLimit: old?.search_limit || 0, retryAt: old?.retry_at || 0,
    error: old?.error || null,
    cookiesNext: /format unavailable|403|requires cookies|Recovery cookies file unavailable/.test(old?.error || '') };
  const selection = selectionStateOnResume(old, maxSearches);
  result.state = result.source ? 'saved' : result.missing || old?.state === 'missing' ? 'missing'
    : selection || (old?.state === 'error' && !retryErrors ? 'error' : result.url ? 'ready' : 'pending');
  if (retryErrors && old?.state === 'error') {
    result.attempts = 0;
    result.networkAttempts = 0;
    result.retryAt = 0;
    result.error = null;
  }
  if (!result.source && selection) {
    result.url = null;
    result.attempts = 0;
    result.retryAt = 0;
    result.error = selection === 'no-candidate' ? DURATION_NO_CANDIDATE : null;
  }
  return result;
}

export async function readJournal(path) {
  if (!existsSync(path)) return new Map();
  const db = database(path, true);
  try {
    const table = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='work'");
    if (!table.length) return new Map();
    return new Map((await db.all('SELECT * FROM work')).map(row => [row.key, row]));
  } finally { await db.close(); }
}

export function resumePlan(songs, prior, options) {
  const counts = { saved: 0, missing: 0, noCandidate: 0, exhaustedErrors: 0, ready: 0, pending: 0 };
  for (const song of songs) {
    const state = resumedSong(song, sourceJournal(song, prior), options).state;
    counts[{ 'no-candidate': 'noCandidate', error: 'exhaustedErrors' }[state] || state]++;
  }
  return { ...counts, actionable: counts.ready + counts.pending,
    fastSkipped: counts.saved + counts.missing + counts.noCandidate + counts.exhaustedErrors,
    notSaved: counts.missing + counts.noCandidate + counts.exhaustedErrors + counts.ready + counts.pending };
}
