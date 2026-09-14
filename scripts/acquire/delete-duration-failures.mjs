#!/usr/bin/env node
// Explicitly authorized permanent deletion of fingerprint-bound audit failures.
// No media moves, archives, recursive removal, YouTube requests or queue edits.
import { readFileSync, lstatSync, realpathSync, readdirSync, unlinkSync, appendFileSync } from 'node:fs';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { atomicJson, fingerprint, sameFingerprint, probeMp3 } from './historical-duration-audit.mjs';
import { durationMatch } from './duration-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function deletionPlan(report, downloads) {
  if (report.mainAuditStage !== 'pass-finished' || !report.allLocalFilesExamined)
    throw new Error('A finished full local audit pass is required');
  const eligible = [], excluded = [];
  for (const file of report.files) {
    if (!['probable-bad-duration', 'unreadable'].includes(file.state)) continue;
    let reason = null;
    const rows = file.occurrences || [];
    if (!file.fingerprint || !file.paths?.length) reason = 'Missing immutable file evidence';
    if (!reason) {
      try { validateDeletionFile(file, downloads); }
      catch (error) { reason = error.message; }
    }
    if (!reason && file.state === 'probable-bad-duration') {
      if (!rows.length || rows.some(row => row.state !== 'probable-bad-duration') ||
          file.paths.some(path => !rows.some(row => row.path === path))) reason = 'A linked path passes or lacks an unambiguous failed comparison';
      else if (rows.some(row => durationMatch(row.expectedDurationMs, file.actualDurationSeconds).reason !== 'mismatch'))
        reason = 'Independent tolerance validation did not confirm failure';
    }
    if (reason) { excluded.push({ fileId: file.fileId, paths: file.paths, reason }); continue; }
    eligible.push({ fileId: file.fileId, fingerprint: file.fingerprint, paths: [...new Set(file.paths)],
      verdict: file.state, actualDurationSeconds: file.actualDurationSeconds,
      expectedDurationsMs: [...new Set(rows.map(row => row.expectedDurationMs).filter(value => value > 0))],
      keys: [...new Set(rows.map(row => row.key).filter(Boolean))], checkedAt: file.checkedAt });
  }
  return { version: 1, id: `duration-delete-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`,
    createdAt: new Date().toISOString(), downloads: realpathSync(downloads), auditSnapshotId: report.snapshotId,
    auditCutoff: report.inventoryCutoff, auditReportDigest: digest(report), mode: 'permanent-delete-no-archive',
    files: eligible, excluded, summary: { physicalFiles: eligible.length, paths: eligible.reduce((n, file) => n + file.paths.length, 0),
      uniqueKeys: new Set(eligible.flatMap(file => file.keys)).size,
      uniqueInodeBytes: eligible.reduce((n, file) => n + file.fingerprint.size, 0), excludedPhysicalFiles: excluded.length } };
}

export function validateDeletionFile(file, downloads, actualPaths) {
  const base = realpathSync(downloads) + sep;
  if (!file.paths.length || file.paths.some(path => typeof path !== 'string' || !path.startsWith(base) || !/\.mp3$/i.test(path)))
    throw new Error('Deletion target is not an explicit in-scope MP3');
  if (actualPaths && (actualPaths.length !== file.paths.length || actualPaths.some(path => !file.paths.includes(path))))
    throw new Error('Additional or missing hardlinks require a fresh audit');
  for (const path of file.paths) {
    const stat = lstatSync(path);
    if (stat.nlink !== file.paths.length) throw new Error('Additional or missing hardlinks require a fresh audit; outside-scope links are preserved');
    if (!stat.isFile() || !realpathSync(path).startsWith(base) || !sameFingerprint(fingerprint(stat), file.fingerprint))
      throw new Error('Deletion target changed since audit');
  }
}

function inodePaths(downloads) {
  const dirs = [realpathSync(downloads)], result = new Map();
  while (dirs.length) {
    const dir = dirs.pop();
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isDirectory()) { dirs.push(path); continue; }
      if (!item.isFile() || !/\.mp3$/i.test(item.name)) continue;
      const stat = lstatSync(path), id = `${stat.dev}-${stat.ino}`;
      const paths = result.get(id) || []; paths.push(path); result.set(id, paths);
    }
  }
  return result;
}

export async function applyDeletion(plan, { downloads, journalPath, probe = probeMp3 }) {
  if (plan.mode !== 'permanent-delete-no-archive' || realpathSync(downloads) !== plan.downloads) throw new Error('Deletion scope mismatch');
  const ids = plan.files.map(file => file.fileId), paths = plan.files.flatMap(file => file.paths);
  if (new Set(ids).size !== ids.length || new Set(paths).size !== paths.length) throw new Error('Duplicate deletion target');
  const current = inodePaths(downloads);
  // Validate the complete exact set before deleting its first path.
  for (const file of plan.files) validateDeletionFile(file, downloads, current.get(file.fileId) || []);
  for (const file of plan.files) {
    let audio = null;
    try { audio = await probe(file.paths[0]); }
    catch (error) {
      const decodeFailure = error.code === 1 && !error.killed && !error.signal &&
        /Invalid data found when processing input|Failed to find two consecutive MPEG audio frames|Invalid frame size|Could not seek to/i.test(error.stderr || '');
      if (!decodeFailure) throw new Error('Fresh local probe failed without confirming corrupt audio', { cause: error });
    }
    const readable = audio?.codec === 'mp3' && audio.durationSeconds > 0;
    if (file.verdict === 'unreadable' ? readable : !readable || !file.expectedDurationsMs.length ||
        file.expectedDurationsMs.some(expected => durationMatch(expected, audio.durationSeconds).reason !== 'mismatch'))
      throw new Error('Fresh local probe did not corroborate the planned deletion');
    validateDeletionFile(file, downloads);
  }
  // Probing yields to other processes. Revalidate the entire set, including
  // newly added hardlinks, once more before the first irreversible unlink.
  const afterProbes = inodePaths(downloads);
  for (const file of plan.files) validateDeletionFile(file, downloads, afterProbes.get(file.fileId) || []);
  let pathsDeleted = 0, filesDeleted = 0, uniqueInodeBytesRemoved = 0;
  for (const file of plan.files) {
    validateDeletionFile(file, downloads);
    appendFileSync(journalPath, JSON.stringify({ at: new Date().toISOString(), phase: 'validated-intent', ...file }) + '\n', { mode: 0o600 });
    for (const path of file.paths) {
      // Check again immediately before each unlink; unlink never follows a symlink.
      if (!lstatSync(path).isFile() || !sameFingerprint(fingerprint(lstatSync(path)), file.fingerprint)) throw new Error('File changed during deletion');
      unlinkSync(path); pathsDeleted++;
      appendFileSync(journalPath, JSON.stringify({ at: new Date().toISOString(), phase: 'deleted', fileId: file.fileId, path }) + '\n', { mode: 0o600 });
    }
    filesDeleted++; uniqueInodeBytesRemoved += file.fingerprint.size;
  }
  return { manifestId: plan.id, at: new Date().toISOString(), pathsDeleted, filesDeleted, uniqueInodeBytesRemoved,
    archivesCreated: 0, recoveryCopyCreated: false };
}

async function main() {
  const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false }, manifest: { type: 'string' }, 'expected-count': { type: 'string' } } });
  const base = join(root, 'data/acquire/duration-deletion'), downloads = join(root, 'downloads');
  if (!values.apply) {
    const plan = deletionPlan(read(join(root, 'data/acquire/historical-duration-audit/full-report.json')), downloads);
    const path = join(base, `${plan.id}.json`); atomicJson(path, plan);
    console.log(JSON.stringify({ manifest: path, ...plan.summary })); return;
  }
  const path = resolve(values.manifest || '');
  if (!path.startsWith(base + sep) || !path.endsWith('.json')) throw new Error('An exact generated deletion manifest is required');
  const plan = read(path);
  if (Number(values['expected-count']) !== plan.files.length || !plan.files.length) throw new Error('Exact nonzero expected file count is required');
  const cli = read(join(root, 'data/acquire/status.json'));
  let alive = false; try { process.kill(cli.pid, 0); alive = true; } catch {}
  if (alive) throw new Error('Gracefully drain the CLI before applying deletions');
  const result = await applyDeletion(plan, { downloads, journalPath: join(base, `${plan.id}.events.jsonl`) });
  atomicJson(join(base, `${plan.id}.result.json`), result); console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; });
