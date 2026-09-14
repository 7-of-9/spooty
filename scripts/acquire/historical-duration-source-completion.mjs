#!/usr/bin/env node
// Complete exact-ID metadata gaps against an immutable pre-deletion report.
// No media, report, queue, or review-ledger writes. Public metadata only.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { atomicJson } from './historical-duration-audit.mjs';
import { createDurationResolver, validSourceMetadata } from './spotify-duration.mjs';
import { getTrackDurationMetadata } from '../spotify-session.mjs';
import { compareOccurrence, aggregateFileState } from './full-duration-report.mjs';

const root = resolve(import.meta.dirname, '../..');
const auditPath = join(root, 'data/acquire/historical-duration-audit');
const sourcePath = join(auditPath, 'full-report.json');
const outputPath = join(auditPath, 'post-cutoff-source-completion.json');
const cachePath = join(root, 'data/spotify-track-metadata');
const report = JSON.parse(readFileSync(sourcePath, 'utf8'));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reportDigest = digest(report);
const read = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const rows = report.files.flatMap(file => file.occurrences.filter(row => row.state === 'missing-source-metadata')
  .map(row => ({ ...row, fileId: file.fileId, fingerprint: file.fingerprint,
    measuredAt: file.checkedAt, actualDurationSeconds: file.actualDurationSeconds })));
const identities = [...new Map(rows.map(row => [JSON.stringify([row.spotifyId, row.artist, row.name]), row])).values()];
const previous = read(outputPath);
if (previous && previous.predeleteReportDigest !== reportDigest) throw new Error('Source report changed; preserve previous evidence');
const results = previous?.identities || [];
// Explicitly authorized audit-only resolution of these seven documented credit
// variations. Do not widen validSourceMetadata or the acquisition validator.
const creditVariationIds = new Set(['6WcBumw7FtlGg68CehEe78', '4WyfQ9OavlPgFqiaV1sy8V',
  '67b02tR31CEv8f0DQ1M1C0', '1UH8vjLZ7PfX5UuuIZPeel', '4B1gk3oNYo0ho5CP5xhXqC',
  '3MzZ1t5607phuLXQvCMebe', '3PLQj7TnKFV7IpKuxiNeTS']);
for (const result of results) {
  if (result.state !== 'source-identity-mismatch' || !creditVariationIds.has(result.spotifyId)) continue;
  const meta = result.metadata;
  if (meta?.version !== 1 || meta.spotifyId !== result.spotifyId || meta.name !== result.name ||
      !Number.isSafeInteger(meta.durationMs) || meta.durationMs <= 0) continue;
  result.priorState = result.state;
  result.state = 'audit-credit-variation-resolved';
  result.resolution = { scope: 'historical-audit-only', resolvedAt: new Date().toISOString(),
    rule: 'Exact saved playlist Spotify ID and identical title are authoritative for source duration; documented artist-credit expansion/truncation does not change the source ID.',
    spotifyIdExactMatch: true, titleExactMatch: true, savedArtist: result.artist,
    currentArtist: meta.artist, ingestValidatorChanged: false };
}
const completed = new Map(results.map(result => [JSON.stringify([result.spotifyId, result.artist, result.name]), result]));
const isResolved = result => ['resolved', 'audit-credit-variation-resolved'].includes(result?.state);
let publicMetadata = null;
const resolver = createDurationResolver(cachePath, async id => {
  publicMetadata = await getTrackDurationMetadata(id);
  return publicMetadata;
});
const startedAt = previous?.startedAt || new Date().toISOString();
function persist(complete) {
  const comparisons = rows.map(row => {
    const result = completed.get(JSON.stringify([row.spotifyId, row.artist, row.name]));
    const metadata = isResolved(result) ? result.metadata : null;
    const context = result?.state === 'audit-credit-variation-resolved'
      ? { ...row, durationMs: metadata.durationMs, auditSourceResolution: result.resolution }
      : row;
    return { ...compareOccurrence(context, row.actualDurationSeconds, metadata),
      metadataState: result?.state || 'unattempted', source: row.source,
      comparisonSource: 'post-cutoff exact Spotify ID; preserved pre-delete measured duration' };
  });
  const files = [...new Set(rows.map(row => row.fileId))].map(fileId => {
    const original = report.files.find(file => file.fileId === fileId);
    const checked = original.occurrences.map(row => comparisons.find(next => next.fileId === fileId &&
      next.path === row.path && next.spotifyId === row.spotifyId && next.artist === row.artist && next.name === row.name) || row);
    return { fileId, fingerprint: original.fingerprint, paths: original.paths,
      actualDurationSeconds: original.actualDurationSeconds, measuredAt: original.checkedAt,
      state: aggregateFileState({ state: 'probed' }, checked), occurrences: checked };
  });
  const counts = {}; for (const file of files) counts[file.state] = (counts[file.state] || 0) + 1;
  const output = { version: 1, startedAt, updatedAt: new Date().toISOString(), complete,
    predeleteSnapshotId: report.snapshotId, predeleteReportDigest: reportDigest,
    inventoryCutoff: report.inventoryCutoff, caveat: 'Does not assert current file existence or overwrite pre-delete audit evidence. Length match is not recording-identity proof.',
    summary: { identities: identities.length, attemptedIdentities: completed.size,
      resolvedIdentities: results.filter(isResolved).length,
      auditOnlyCreditVariationResolutions: results.filter(row => row.state === 'audit-credit-variation-resolved').length,
      physicalFiles: files.length, occurrences: rows.length, counts }, identities: results, files };
  atomicJson(outputPath, output);
  return output.summary;
}
console.log(JSON.stringify({ pid: process.pid, startedAt, outputPath, ...persist(false) }));
for (const row of identities) {
  const key = JSON.stringify([row.spotifyId, row.artist, row.name]);
  if (isResolved(completed.get(key))) continue;
  publicMetadata = null;
  const song = { artist: row.artist, name: row.name, spotifyIds: [row.spotifyId] };
  let state = 'unavailable', metadata = null;
  try {
    await resolver(song);
    metadata = read(join(cachePath, `${row.spotifyId}.json`));
    if (validSourceMetadata(metadata, row.spotifyId, song)) state = 'resolved';
  } catch {
    if (publicMetadata) {
      state = 'source-identity-mismatch';
      metadata = { version: publicMetadata.version, spotifyId: publicMetadata.spotifyId,
        artist: publicMetadata.artist, name: publicMetadata.name, durationMs: publicMetadata.durationMs,
        album: publicMetadata.album, fetchedAt: publicMetadata.fetchedAt };
    }
  }
  const result = { spotifyId: row.spotifyId, artist: row.artist, name: row.name,
    state, metadata, checkedAt: new Date().toISOString() };
  const index = results.findIndex(item => JSON.stringify([item.spotifyId, item.artist, item.name]) === key);
  if (index < 0) results.push(result); else results[index] = result;
  completed.set(key, result);
  console.log(JSON.stringify({ spotifyId: row.spotifyId, state, ...persist(false) }));
}
if (digest(JSON.parse(readFileSync(sourcePath, 'utf8'))) !== reportDigest) throw new Error('Pre-delete report changed during completion');
console.log(JSON.stringify({ outputPath, ...persist(true) }));
