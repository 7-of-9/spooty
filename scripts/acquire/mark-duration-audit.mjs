#!/usr/bin/env node
// Incremental, evidence-bound review annotations. This never changes media,
// queue admission, workflow status, YouTube URLs or the acquisition process.
import { readFileSync, writeFileSync, renameSync, mkdirSync, statSync, realpathSync } from 'node:fs';
import { resolve, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { durationMatch } from './duration-policy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const digest = text => createHash('sha256').update(text).digest('hex');
function atomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  renameSync(temporary, path);
}

export function verifiedAuditFinding(finding, downloads) {
  if (finding?.state !== 'probable-bad-duration' || typeof finding.key !== 'string' || !finding.key ||
      typeof finding.fileId !== 'string' || !Array.isArray(finding.paths)) return null;
  const match = durationMatch(finding.expectedDurationMs, finding.actualDurationSeconds);
  if (match.reason !== 'mismatch' || !Number.isFinite(Date.parse(finding.checkedAt))) return null;
  const fp = finding.fingerprint;
  if (!fp || !['dev', 'ino', 'size', 'mtimeMs'].every(key => Number.isFinite(fp[key])) || fp.size <= 0) return null;
  const root = realpathSync(downloads), paths = [];
  for (const candidate of finding.paths) {
    if (typeof candidate !== 'string' || !/\.mp3$/i.test(candidate)) continue;
    try {
      const path = realpathSync(candidate);
      if (!path.startsWith(root + sep)) continue;
      const current = statSync(path);
      if (!current.isFile() || current.dev !== fp.dev || current.ino !== fp.ino ||
          current.size !== fp.size || current.mtimeMs !== fp.mtimeMs) continue;
      if (!paths.includes(path)) paths.push(path);
    } catch { /* A changing or absent file is not current mismatch evidence. */ }
  }
  if (!paths.length) return null;
  return {
    fileId: finding.fileId, checkedAt: finding.checkedAt, fingerprint: fp, paths,
    expectedDurationMs: finding.expectedDurationMs,
    spotifyId: /^[A-Za-z0-9]{22}$/.test(finding.spotifyId || '') ? finding.spotifyId : null,
    actualDurationSeconds: finding.actualDurationSeconds,
    differenceSeconds: finding.actualDurationSeconds - finding.expectedDurationMs / 1000,
    toleranceSeconds: match.toleranceSeconds,
  };
}

export function markDurationAudit({ findingsPath, ledgerPath, downloads, beforeCommit = () => {} }) {
  const audit = readJson(findingsPath);
  if (audit.version !== 1 || typeof audit.snapshotId !== 'string' || !Array.isArray(audit.findings))
    throw new Error('Invalid duration audit findings');
  let initial;
  try { initial = readFileSync(ledgerPath, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; initial = null; }
  const ledger = initial === null ? { version: 1, entries: [] } : JSON.parse(initial);
  if (!Array.isArray(ledger.entries)) throw new Error('Invalid recording review ledger');
  const stats = { snapshotId: audit.snapshotId, auditComplete: !!audit.complete, at: new Date().toISOString(),
    probableFindingCount: 0, currentEvidenceCount: 0, staleOrInvalidCount: 0, markedUnique: 0, changed: false };
  const byKey = new Map();
  for (const finding of audit.findings) {
    if (finding.state !== 'probable-bad-duration') continue;
    stats.probableFindingCount++;
    const evidence = verifiedAuditFinding(finding, downloads);
    if (!evidence) { stats.staleOrInvalidCount++; continue; }
    stats.currentEvidenceCount++;
    const items = byKey.get(finding.key) || [];
    items.push(evidence);
    byKey.set(finding.key, items);
  }
  for (const [key, files] of byKey) {
    const index = ledger.entries.findLastIndex(entry => entry.key === key);
    const prior = index < 0 ? null : ledger.entries[index];
    const annotation = { snapshotId: audit.snapshotId, verdict: 'probable-bad-duration', files };
    if (prior?.status === 'resolved' && Number.isFinite(Date.parse(prior.resolvedAt)) &&
        files.every(file => Date.parse(file.checkedAt) <= Date.parse(prior.resolvedAt))) continue;
    if (prior?.status !== 'resolved' && JSON.stringify(prior?.durationAudit) === JSON.stringify(annotation)) continue;
    // A resolved historical review is retained in full if fresh, stable evidence
    // requires reopening it. A duration match never auto-resolves an identity review.
    const first = files[0];
    const reason = `Probable wrong-length recording: Spotify ${(first.expectedDurationMs / 1000).toFixed(3)}s; MP3 ${first.actualDurationSeconds.toFixed(3)}s; tolerance ±${first.toleranceSeconds.toFixed(3)}s. Length mismatch is a review flag, not proof of recording identity. Original file left untouched.`;
    const generated = {
      key, status: 'needs-review', observedAt: first.checkedAt, reason,
      source: 'historical-duration-audit', runId: null,
      catalogTrackId: first.spotifyId,
      catalogDurationSeconds: first.expectedDurationMs / 1000,
      actualDurationSeconds: first.actualDurationSeconds,
      file: first.paths[0], destinations: [...new Set(files.flatMap(file => file.paths))],
      originalDevice: first.fingerprint.dev, originalInode: first.fingerprint.ino,
      originalBytes: first.fingerprint.size, originalFilePreserved: true,
      ...(first.spotifyId ? { reference: `https://open.spotify.com/track/${first.spotifyId}` } : {}),
      durationAudit: annotation,
    };
    if (!prior) ledger.entries.push(generated);
    else if (prior.status === 'resolved') ledger.entries[index] = { ...generated, previousReview: prior };
    else ledger.entries[index] = { ...prior, durationAudit: annotation };
    stats.markedUnique++;
  }
  if (stats.markedUnique) {
    beforeCommit();
    let latest;
    try { latest = readFileSync(ledgerPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; latest = null; }
    if (latest !== initial) throw new Error('Review ledger changed concurrently; retry safely');
    atomic(ledgerPath, ledger);
    stats.changed = true;
  }
  return stats;
}

async function main() {
  const { values } = parseArgs({ options: {
    watch: { type: 'boolean', default: false },
    findings: { type: 'string', default: join(ROOT, 'data/acquire/historical-duration-audit/findings.json') },
    ledger: { type: 'string', default: join(ROOT, 'data/acquire/quality-review.json') },
    downloads: { type: 'string', default: join(ROOT, 'downloads') },
    status: { type: 'string', default: join(ROOT, 'data/acquire/historical-duration-marking.json') },
  } });
  let lastDigest = null, stop = false;
  process.once('SIGTERM', () => { stop = true; });
  process.once('SIGINT', () => { stop = true; });
  do {
    try {
      const currentDigest = digest(readFileSync(values.findings, 'utf8'));
      if (currentDigest !== lastDigest) {
        const result = markDurationAudit({ findingsPath: values.findings, ledgerPath: values.ledger, downloads: values.downloads });
        atomic(values.status, { ...result, pid: process.pid, phase: result.auditComplete ? 'complete' : 'watching' });
        console.log(JSON.stringify(result));
        lastDigest = currentDigest;
        if (result.auditComplete) break;
      }
    } catch (error) {
      if (!values.watch) throw error;
      // Never publish raw metadata, file contents, session data or stack traces.
      console.log(JSON.stringify({ at: new Date().toISOString(), phase: 'waiting', reason:
        error.code === 'ENOENT' ? 'Awaiting audit findings' : 'Audit marker deferred; evidence or ledger changed' }));
    }
    if (!values.watch || stop) break;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 15000));
  } while (!stop);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error(JSON.stringify({ error: 'Duration audit marking failed; media and queues untouched' })); process.exitCode = 1; });
}
