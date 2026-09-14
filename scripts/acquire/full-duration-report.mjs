#!/usr/bin/env node
// Offline reconciliation of the complete fixed-cutoff inventory. No media,
// queue, transport or review-ledger mutations.
import { readFileSync, realpathSync, lstatSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { atomicJson, fingerprint, sameFingerprint } from './historical-duration-audit.mjs';
import { positiveDurationMs, validSourceMetadata } from './spotify-duration.mjs';
import { durationMatch } from './duration-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const hash = value => createHash('sha256').update(value).digest('hex');

export function compareOccurrence(context, actualSeconds, metadata) {
  const id = context.spotifyId || null;
  const expected = positiveDurationMs(context.durationMs) ? context.durationMs :
    validSourceMetadata(metadata, id, context) ? metadata.durationMs : null;
  if (!expected) return { ...context, state: 'missing-source-metadata', expectedDurationMs: null };
  const match = durationMatch(expected, actualSeconds);
  return { ...context, state: match.ok ? 'length-match' : 'probable-bad-duration',
    expectedDurationMs: expected, actualDurationSeconds: actualSeconds,
    differenceSeconds: actualSeconds - expected / 1000, toleranceSeconds: match.toleranceSeconds };
}

export function aggregateFileState(probe, occurrences) {
  if (!probe || probe.state === 'unassessed') return 'unassessed';
  if (probe.state !== 'probed') return probe.state;
  if (!occurrences.length) return 'unknown-identity';
  if (occurrences.some(row => row.state === 'probable-bad-duration')) return 'probable-bad-duration';
  if (occurrences.some(row => row.state === 'unknown-identity')) return 'unknown-identity';
  if (occurrences.some(row => row.state === 'ambiguous-source-editions')) return 'ambiguous-source-editions';
  if (occurrences.some(row => row.state !== 'length-match')) return 'missing-source-metadata';
  return 'length-match';
}

export function preserveUnboundEditionAmbiguity(rows) {
  // Filename-only binding does not establish which edition was intended. Only
  // unanimously matching or unanimously mismatching known editions are decisive.
  const states = new Set(rows.map(row => row.state));
  if (states.size === 1 && (states.has('length-match') || states.has('probable-bad-duration'))) return rows;
  return rows.map(row => ({ ...row, candidateState: row.state, state: 'ambiguous-source-editions' }));
}

export function buildFullReport({ auditPath, cachePath, downloads }) {
  const snapshot = read(join(auditPath, 'snapshot.json'));
  const progress = read(join(auditPath, 'progress.json'));
  const inventory = read(join(auditPath, 'coverage-gap/inventory.json'));
  const supplement = read(join(auditPath, 'coverage-gap/supplemental.json'));
  const bindings = read(join(auditPath, 'coverage-gap/playlist-occurrence-bindings.json'));
  if (!snapshot || !progress || !inventory || !supplement || !bindings ||
      inventory.snapshotId !== snapshot.snapshotId || supplement.startedAt !== inventory.startedAt ||
      bindings.startedAt !== inventory.startedAt) throw new Error('Full audit inputs must share an exact inventory cutoff');
  const originals = new Map(snapshot.files.map(file => [file.id, file]));
  const extraFiles = new Map(supplement.files.map(file => [file.id, file]));
  const unknownFiles = new Map(supplement.unknownFiles.map(file => [file.id, file]));
  const songs = new Map([...snapshot.songs, ...supplement.songs].map(song => [song.key, song]));
  const byPath = new Map(bindings.paths.map(item => [item.path, item.occurrences]));
  const sources = new Map(), metadata = new Map();
  const getMetadata = id => {
    if (!/^[A-Za-z0-9]{22}$/.test(id || '')) return null;
    if (!metadata.has(id)) metadata.set(id, read(join(cachePath, `${id}.json`)));
    return metadata.get(id);
  };
  const files = [], findings = [], base = realpathSync(downloads) + '/';
  for (const file of inventory.files) {
    const paths = file.paths.filter(item => !item.staging).map(item => item.path);
    if (!paths.length) { files.push({ fileId: file.id, state: 'staging-artifact', paths: file.paths.map(x => x.path) }); continue; }
    const original = originals.get(file.id), extra = extraFiles.get(file.id), unknown = unknownFiles.get(file.id);
    const record = original ? read(join(auditPath, 'files', `${file.id}.json`)) : null;
    let probe = record && sameFingerprint(record.fingerprint, file.fingerprint) ? record.probe : extra?.probe || unknown?.probe;
    const stable = paths.every(path => {
      try { return path.startsWith(base) && realpathSync(path).startsWith(base) && lstatSync(path).isFile() && sameFingerprint(fingerprint(lstatSync(path)), file.fingerprint); }
      catch { return false; }
    });
    if (!stable) probe = { state: 'changed-file', checkedAt: new Date().toISOString() };
    const occurrences = [];
    for (const path of paths) {
      const key = extra?.pathSongKeys?.[path] || basename(path).slice(0, -4).toLowerCase();
      const song = songs.get(key);
      let contexts = byPath.get(path) || [];
      const exactPlaylistOccurrence = contexts.length > 0;
      if (!contexts.length && song) {
        if (!sources.has(key)) sources.set(key, read(join(auditPath, 'sources', `${hash(key)}.json`)));
        const source = sources.get(key);
        contexts = (song.spotifyIds || []).map(spotifyId => ({ spotifyId, artist: song.artist, name: song.name,
          durationMs: source?.variants?.find(v => v.spotifyId === spotifyId)?.durationMs ||
            song.sourceVariants?.find(v => v.spotifyId === spotifyId)?.durationMs || null,
          source: 'exact-filename-identity; source editions preserved' }));
        if (!contexts.length && positiveDurationMs(song.durationMs)) contexts = [{ artist: song.artist, name: song.name,
          spotifyId: null, durationMs: song.durationMs, source: 'saved-playlist-duration' }];
      }
      const unique = [...new Map(contexts.map(context => [JSON.stringify([context.spotifyId, context.artist, context.name, context.durationMs]), context])).values()];
      if (!unique.length) occurrences.push({ path, key, state: 'unknown-identity' });
      let checked = unique.map(context => compareOccurrence({ ...context, path, key }, probe?.durationSeconds, getMetadata(context.spotifyId)));
      if (!exactPlaylistOccurrence && checked.length > 1) checked = preserveUnboundEditionAmbiguity(checked);
      for (const row of checked) {
        if (probe?.state !== 'probed') row.state = probe?.state || 'unassessed';
        occurrences.push(row);
        if (row.state === 'probable-bad-duration') findings.push({ ...row, fileId: file.id, paths: [path],
          fingerprint: file.fingerprint, checkedAt: probe.checkedAt });
      }
    }
    files.push({ fileId: file.id, fingerprint: file.fingerprint, paths, checkedAt: probe?.checkedAt || null,
      actualDurationSeconds: probe?.durationSeconds || null, state: aggregateFileState(probe, occurrences), occurrences });
  }
  const counts = {};
  for (const file of files) counts[file.state] = (counts[file.state] || 0) + 1;
  const unresolved = ['unassessed', 'unknown-identity', 'missing-source-metadata', 'ambiguous-source-editions', 'changed-file'];
  return { version: 1, snapshotId: `full-${snapshot.snapshotId}-${inventory.startedAt}`, updatedAt: new Date().toISOString(),
    inventoryCutoff: inventory.startedAt, mainAuditStage: progress.stage,
    complete: !files.some(file => unresolved.includes(file.state)) && !inventory.nonRegular.length && !inventory.scanFailures.length,
    allLocalFilesExamined: !files.some(file => ['unassessed', 'changed-file'].includes(file.state)),
    summary: { physicalFiles: files.length, paths: files.reduce((sum, file) => sum + file.paths.length, 0),
      physicalBytes: inventory.files.reduce((sum, file) => sum + file.fingerprint.size, 0), counts,
      probableBadUniqueKeys: new Set(findings.map(row => row.key)).size,
      nonRegularPaths: inventory.nonRegular.length, scanFailures: inventory.scanFailures.length },
    caveats: ['Full fixed-cutoff inventory, not a random sample; later CLI publications are outside this cutoff.',
      'A shared physical file is checked against every exact saved playlist occurrence, not just one matching edition.',
      'Unknown source identities and unavailable durations are not silently counted as passing.',
      'Length match does not establish recording identity. No media or queues were changed.'], files, findings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const auditPath = join(root, 'data/acquire/historical-duration-audit');
  const result = buildFullReport({ auditPath, downloads: join(root, 'downloads'), cachePath: join(root, 'data/spotify-track-metadata') });
  atomicJson(join(auditPath, 'full-report.json'), result);
  console.log(JSON.stringify({ ...result, files: undefined, findings: undefined }));
}
