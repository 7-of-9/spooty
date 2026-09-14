// One explicitly verified external-hardlink exception. Delete only the two
// active bad aliases; never modify the pre-existing outside archive.
import { readFileSync, lstatSync, realpathSync, unlinkSync } from 'node:fs';
import { atomicJson, fingerprint, sameFingerprint, probeMp3 } from './historical-duration-audit.mjs';
import { durationMatch } from './duration-policy.mjs';

const root = '/Users/dom/src/spooty';
const paths = [
  `${root}/downloads/LTJ Bukem's EARTH Series/K Scope - The Setup.mp3`,
  `${root}/downloads/LTJ Bukem Presents Earth 1-7/K Scope - The Setup.mp3`,
];
const archive = `${root}/data/acquire/preserved-originals/572ee9294eb5c9b87c325703-169323039/original.mp3`;
const expected = { dev: 16777233, ino: 169323039, size: 11866100, mtimeMs: 1789258033015.7666 };
const status = JSON.parse(readFileSync(`${root}/data/acquire/status.json`, 'utf8'));
let alive = false; try { process.kill(status.pid, 0); alive = true; } catch {}
if (alive || status.actualYtdlpProcesses !== 0) throw new Error('Drain acquisition before the exact active-link cleanup');
function validate() {
  for (const path of [...paths, archive]) {
    const stat = lstatSync(path);
    if (!stat.isFile() || realpathSync(path) !== path || stat.nlink !== 3 || !sameFingerprint(fingerprint(stat), expected))
      throw new Error('K Scope link evidence changed');
  }
}
validate();
const report = JSON.parse(readFileSync(`${root}/data/acquire/historical-duration-audit/full-report.json`, 'utf8'));
const evidence = paths.map(path => report.files.flatMap(file => file.occurrences || []).filter(row => row.path === path));
if (evidence.some(rows => !rows.length || rows.some(row => row.expectedDurationMs !== 250500 || row.state !== 'probable-bad-duration')))
  throw new Error('Exact Spotify evidence does not corroborate both paths');
const audio = await probeMp3(paths[0]);
if (audio.codec !== 'mp3' || durationMatch(250500, audio.durationSeconds).reason !== 'mismatch')
  throw new Error('Fresh probe does not confirm the duration failure');
validate();
const base = `${root}/data/acquire/duration-deletion/kscope-external-link-cleanup-20260913`;
atomicJson(`${base}.intent.json`, { at: new Date().toISOString(), paths, externalArchivePreserved: archive, expected, actualDurationSeconds: audio.durationSeconds, expectedDurationMs: 250500 });
for (const [index, path] of paths.entries()) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 3 - index || !sameFingerprint(fingerprint(stat), expected))
    throw new Error('K Scope target changed immediately before unlink');
  unlinkSync(path);
}
const preserved = lstatSync(archive);
if (!sameFingerprint(fingerprint(preserved), expected) || preserved.nlink !== 1) throw new Error('Outside archive verification failed');
const result = { at: new Date().toISOString(), pathsDeleted: paths, activePhysicalInodesRemoved: 1,
  bytesRemovedFromDownloads: expected.size, filesystemBytesReclaimed: 0, externalArchivePreserved: archive,
  archivesCreated: 0, recoveryCopyCreated: false };
atomicJson(`${base}.result.json`, result);
console.log(JSON.stringify(result));
