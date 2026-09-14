#!/usr/bin/env node
// Read-only history search scoped to the fixed coverage gap's unknown songs.
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { database, songKey } from './catalog.mjs';

const require = createRequire(import.meta.url), Redis = require('ioredis');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const normalized = value => String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const getId = value => /^[A-Za-z0-9]{22}$/.test(value || '') ? value :
  String(value || '').match(/^(?:https:\/\/open\.spotify\.com\/track\/|spotify:track:)([A-Za-z0-9]{22})(?:[?#]|$)/)?.[1] || null;

export function exactHistoryMatch(track, unknownByKey) {
  if (!track || typeof track !== 'object') return null;
  const named = typeof track.artist === 'string' && typeof track.name === 'string';
  const key = named ? normalized(songKey(track.artist, track.name)) : typeof track.key === 'string' ? normalized(track.key) : null;
  if (!key || !unknownByKey.has(key)) return null;
  const ids = [...new Set([track.spotifyUrl, track.spotifyId, track.spotifyTrackId,
    track.durationSpotifyId, track.catalogTrackId, track.href, ...(Array.isArray(track.spotifyIds) ? track.spotifyIds : [])]
    .map(getId).filter(Boolean))];
  return { key, files: unknownByKey.get(key), spotifyIds: ids,
    artist: named ? track.artist : null, name: named ? track.name : null,
    durationMs: Number.isSafeInteger(track.durationMs) && track.durationMs > 0 ? track.durationMs :
      Number.isSafeInteger(track.spotifyDurationMs) && track.spotifyDurationMs > 0 ? track.spotifyDurationMs : null };
}

function candidates(value) {
  return [value, value?.track, value?.data, value?.detail, value?.detail?.track].filter(item => item && typeof item === 'object');
}

async function main() {
  if (process.version !== 'v20.19.4') throw new Error('Use Node20.19.4');
  const state = join(root, 'data/acquire'), gap = join(state, 'historical-duration-audit/coverage-gap');
  const supplement = JSON.parse(readFileSync(join(gap, 'supplemental.json'), 'utf8'));
  const unknownByKey = new Map(), files = supplement.unknownFiles;
  for (const file of files) for (const path of file.paths) {
    const key = normalized(basename(path).slice(0, -4));
    const list = unknownByKey.get(key) || []; if (!list.some(item => item.id === file.id)) list.push(file); unknownByKey.set(key, list);
  }
  const recovered = new Map(), observationsWithoutSpotifyId = [], stats = { unknownPhysicalFiles: files.length,
    unknownFilenameKeys: unknownByKey.size, publicationFiles: 0, publicationRecords: 0,
    scopedPublicationMatches: 0, scopedJournalRows: 0, musicJobPayloadsRead: 0, scopedMusicJobMatches: 0,
    orphanMusicJobPayloadsRead: 0, legacyDetailExactFilenameMatches: 0, legacyDetailSpotifyIdBearingMatches: 0, queueStates: {} };
  const exactLegacyNames = [...new Set(files.flatMap(file => file.paths.map(path => normalized(basename(path)))))];
  const record = (match, evidence) => {
    if (!match) return;
    if (!match.spotifyIds.length) {
      observationsWithoutSpotifyId.push({ key: match.key, fileIds: match.files.map(file => file.id), evidence }); return;
    }
    for (const file of match.files) {
      const result = recovered.get(file.id) || { fileId: file.id, fingerprint: file.fingerprint, paths: file.paths, bindings: [] };
      result.bindings.push({ key: match.key, artist: match.artist, name: match.name,
        spotifyIds: match.spotifyIds, durationMs: match.durationMs, evidence }); recovered.set(file.id, result);
    }
  };
  const eventPaths = readdirSync(state).filter(name => /^events-[\dTZ-]+\.jsonl$/.test(name)).map(name => join(state, name));
  eventPaths.push(join(root, 'src/backend/config/yt-events.jsonl'));
  for (const path of eventPaths) {
    let text; try { text = readFileSync(path, 'utf8'); } catch { continue; }
    stats.publicationFiles++;
    const lines = text.split('\n'); if (lines.at(-1) !== '') lines.pop();
    for (let n = 0; n < lines.length; n++) {
      let doc; try { doc = JSON.parse(lines[n]); } catch { continue; }
      stats.publicationRecords++;
      if (typeof doc.detail === 'string' && exactLegacyNames.some(name => normalized(doc.detail).includes(name))) {
        stats.legacyDetailExactFilenameMatches++;
        if (/(?:https:\/\/open\.spotify\.com\/track\/|spotify:track:)[A-Za-z0-9]{22}/.test(doc.detail)) stats.legacyDetailSpotifyIdBearingMatches++;
        // Free-form text is not automatically promoted to an identity binding.
      }
      for (const candidate of candidates(doc)) {
        const match = exactHistoryMatch(candidate, unknownByKey); if (!match) continue;
        stats.scopedPublicationMatches++;
        record(match, { kind: 'publication-history', artifact: path, line: n + 1,
          type: typeof doc.type === 'string' ? doc.type : null, at: Number.isFinite(doc.t) ? doc.t : null });
      }
    }
  }
  const work = database(join(state, 'work.sqlite'), true);
  try {
    // The work table has no Spotify-ID column. Query only the scoped keys.
    const keys = [...unknownByKey.keys()];
    for (let i = 0; i < keys.length; i += 100) {
      const batch = keys.slice(i, i + 100), rows = await work.all(`SELECT key, state FROM work WHERE key IN (${batch.map(() => '?').join(',')})`, batch);
      stats.scopedJournalRows += rows.length;
      for (const row of rows) record(exactHistoryMatch(row, unknownByKey), { kind: 'work-journal',
        artifact: join(state, 'work.sqlite'), table: 'work', state: row.state, limitation: 'Schema has no Spotify-ID field' });
    }
  } finally { await work.close(); }
  const redis = new Redis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: true });
  try {
    await redis.connect();
    for (const queue of ['track-download-processor', 'track-search-processor']) {
      const prefix = `bull:${queue}:`, jobs = new Map();
      stats.queueStates[queue] = {};
      for (const stateName of ['paused', 'wait', 'active', 'completed', 'failed', 'delayed', 'prioritized', 'waiting-children']) {
        const key = prefix + stateName, type = await redis.type(key);
        const ids = type === 'list' ? await redis.lrange(key, 0, -1) : type === 'zset' ? await redis.zrange(key, 0, -1) : [];
        stats.queueStates[queue][stateName] = ids.length;
        for (const id of ids) { const states = jobs.get(prefix + id) || []; states.push(stateName); jobs.set(prefix + id, states); }
      }
      // Read unindexed job hashes too, without touching queue state or unrelated Redis keys.
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', prefix + '*', 'COUNT', 1000); cursor = next;
        const remaining = keys.filter(key => !jobs.has(key) && key !== prefix + 'meta');
        if (!remaining.length) continue;
        const types = await redis.pipeline(remaining.map(key => ['type', key])).exec();
        for (let i = 0; i < remaining.length; i++) if (!types[i][0] && types[i][1] === 'hash') jobs.set(remaining[i], ['unindexed-hash']);
      } while (cursor !== '0');
      const entries = [...jobs];
      for (let i = 0; i < entries.length; i += 200) {
        const batch = entries.slice(i, i + 200);
        const result = await redis.pipeline(batch.map(([key]) => ['hmget', key, 'data', 'timestamp', 'finishedOn'])).exec();
        for (let j = 0; j < batch.length; j++) {
          const [error, values] = result[j]; if (error || !values?.[0]) continue;
          let data; try { data = JSON.parse(values[0]); } catch { continue; }
          stats.musicJobPayloadsRead++; if (batch[j][1].includes('unindexed-hash')) stats.orphanMusicJobPayloadsRead++;
          // Only allowlisted matching music metadata leaves this process.
          const match = exactHistoryMatch(data, unknownByKey); if (!match) continue;
          stats.scopedMusicJobMatches++;
          record(match, { kind: 'bull-music-job', queue, jobId: batch[j][0].slice(prefix.length), states: batch[j][1],
            timestamp: Number(values[1]) || null, finishedOn: Number(values[2]) || null });
        }
      }
    }
  } finally { redis.disconnect(); }
  const unresolved = files.filter(file => !recovered.has(file.id)).map(file => ({ fileId: file.id,
    fingerprint: file.fingerprint, paths: file.paths,
    reason: 'No exact Spotify ID retained in scoped publication/work-journal/music-job history examined' }));
  const report = { version: 1, checkedAt: new Date().toISOString(), fixedCutoffStartedAt: supplement.startedAt,
    scope: 'Read-only exact-identity recovery for the fixed cutoff unknown files; no queue, media, existing audit artifact or session changes.',
    stats, recoveredPhysicalFiles: recovered.size, unresolvedPhysicalFiles: unresolved.length,
    recovered: [...recovered.values()], unresolved, observationsWithoutSpotifyId,
    caveats: ['Names are matched only by the existing generated filename with Unicode whitespace normalization; no fuzzy identity inference.',
      'Retention is incomplete: absence here does not prove a Spotify ID never existed in older pruned jobs or deleted metadata.',
      'Recovered playlist identity is not proof that the audio recording is correct.'] };
  mkdirSync(gap, { recursive: true, mode: 0o700 }); chmodSync(gap, 0o700);
  const path = join(gap, 'recovered-identities.json'), temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(report) + '\n', { mode: 0o600, flag: 'wx' }); renameSync(temp, path);
  console.log(JSON.stringify({ checkedAt: report.checkedAt, stats, recoveredPhysicalFiles: recovered.size, unresolvedPhysicalFiles: unresolved.length }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => { console.error('Read-only music identity recovery did not finish; queues and files were not changed.'); process.exitCode = 1; });
