import { readFileSync, existsSync } from 'node:fs';
import { atomicJson } from './historical-duration-audit.mjs';
import { durationMatch } from './duration-policy.mjs';

// This is review bookkeeping, not another work queue. Missing files are
// discovered by the ordinary CLI catalog scan on restart.
export function markDeletedDurationFiles(path, manifest, result) {
  if (result.manifestId !== manifest.id || result.filesDeleted !== manifest.files.length)
    throw new Error('Deletion result does not match the complete manifest');
  if (manifest.files.some(file => file.paths.some(existsSync))) throw new Error('A deleted target is still present');
  const ledger = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(ledger.entries)) throw new Error('Invalid review ledger');
  const byKey = new Map();
  for (const file of manifest.files) for (const key of file.keys) {
    const files = byKey.get(key) || []; files.push(file); byKey.set(key, files);
  }
  for (const [key, files] of byKey) {
    let entry = ledger.entries.findLast(item => item.key === key);
    if (!entry) {
      entry = { key, source: 'historical-duration-audit', status: 'needs-repair', observedAt: result.at };
      ledger.entries.push(entry);
    }
    const previous = entry.durationDeletion;
    const evidenceFiles = new Map((previous?.files || []).map(file => [file.fileId, file]));
    for (const file of files) evidenceFiles.set(file.fileId, { fileId: file.fileId, paths: file.paths, verdict: file.verdict });
    entry.durationDeletion = { manifestId: manifest.id,
      manifestIds: [...new Set([...(previous?.manifestIds || []), ...(previous?.manifestId ? [previous.manifestId] : []), manifest.id])],
      deletedAt: result.at, recoveryCopyCreated: false,
      expectedDurationsMs: [...new Set([...(previous?.expectedDurationsMs || []), ...files.flatMap(file => file.expectedDurationsMs)])],
      files: [...evidenceFiles.values()] };
    if (files.some(file => file.fingerprint.dev === entry.originalDevice && file.fingerprint.ino === entry.originalInode))
      entry.originalFilePreserved = false;
    if (entry.source === 'historical-duration-audit') {
      entry.status = 'needs-repair';
      if (entry.reason) entry.historicalReason ||= entry.reason;
      entry.reason = 'Confirmed failed files permanently deleted; awaiting a duration-checked replacement through normal CLI ingestion.';
    }
  }
  atomicJson(path, ledger);
  return { markedKeys: byKey.size };
}

export function normalizeDurationRepairStatuses(path) {
  const ledger = JSON.parse(readFileSync(path, 'utf8'));
  let changed = 0;
  for (const entry of ledger.entries) if (entry.status === 'needs-redownload' && entry.durationDeletion) {
    entry.status = 'needs-repair'; changed++;
  }
  if (changed) atomicJson(path, ledger);
  return changed;
}

export function recordDurationReplacement(path, song, actualDurationSeconds) {
  const ledger = JSON.parse(readFileSync(path, 'utf8'));
  const entry = ledger.entries.findLast(item => item.key === song.key);
  if (!entry?.durationDeletion) return false;
  entry.durationReplacement = { at: new Date().toISOString(), file: song.source, actualDurationSeconds,
    expectedDurationMs: song.durationMs, guard: 'spotify-v1', recordingIdentityProven: false };
  const expected = entry.durationDeletion.expectedDurationsMs;
  const deletedIds = new Set(entry.durationDeletion.files.map(file => file.fileId));
  const noUnreplacedEvidence = (entry.durationAudit?.files || []).every(file => deletedIds.has(file.fileId));
  const allMatch = noUnreplacedEvidence && expected.length > 0 && expected.every(ms => durationMatch(ms, actualDurationSeconds).ok);
  if (entry.source === 'historical-duration-audit' && allMatch) {
    entry.status = 'resolved';
    entry.resolvedAt = entry.durationReplacement.at;
    entry.resolution = 'Deleted duration failures replaced with a locally verified duration-matched MP3; recording identity was not certified.';
  } else if (entry.source === 'historical-duration-audit') {
    entry.status = 'needs-review';
    entry.reason = 'A duration-checked replacement was published, but other edition or file evidence still needs review.';
  }
  atomicJson(path, ledger);
  return true;
}
