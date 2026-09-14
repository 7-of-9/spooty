import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, lstatSync, existsSync, realpathSync,
  linkSync, unlinkSync, renameSync, symlinkSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deletionPlan, validateDeletionFile, applyDeletion } from './delete-duration-failures.mjs';

// Every deletion below targets fake bytes created inside its own mkdtemp tree.
// No real audio, transport, browser or queue is used by this suite.
function fixture(t) {
  // macOS /var aliases /private/var; use canonical paths like production does.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'spooty-delete-duration-test-')));
  const downloads = join(root, 'downloads'); mkdirSync(downloads);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, downloads, journalPath: join(root, 'deletion-events.jsonl') };
}

function localFile(f, name = 'Artist - Track', options = {}) {
  const path = join(f.downloads, `${name}.mp3`);
  writeFileSync(path, options.content || `FAKE TEST BYTES: ${name}`);
  const paths = [path];
  for (const dir of options.hardlinks || []) {
    mkdirSync(join(f.downloads, dir), { recursive: true });
    const alias = join(f.downloads, dir, `${name}.mp3`); linkSync(path, alias); paths.push(alias);
  }
  const stat = lstatSync(path);
  const state = options.state || 'probable-bad-duration';
  return { fileId: `${stat.dev}-${stat.ino}`, fingerprint: { dev: stat.dev, ino: stat.ino,
    size: stat.size, mtimeMs: stat.mtimeMs }, paths, state, actualDurationSeconds: options.actual ?? 200,
    checkedAt: new Date().toISOString(), occurrences: paths.map(path => ({ path, key: name.toLowerCase(),
      artist: 'Artist', name, spotifyId: '1234567890123456789012', state,
      expectedDurationMs: options.expected ?? 100000 })) };
}

function report(files, overrides = {}) {
  return { version: 1, snapshotId: 'test-snapshot', inventoryCutoff: '2026-09-13T07:00:20.321Z',
    mainAuditStage: 'pass-finished', allLocalFilesExamined: true, files, ...overrides };
}
const corroborating = async () => ({ codec: 'mp3', durationSeconds: 200 });
const apply = (plan, f, probe = corroborating) => applyDeletion(plan, { downloads: f.downloads, journalPath: f.journalPath, probe });
const retained = (...files) => files.forEach(file => file.paths.forEach(path => assert.equal(existsSync(path), true, path)));
const noJournal = f => assert.equal(existsSync(f.journalPath), false);

test('planning requires a finished audit with every local file examined', t => {
  const f = fixture(t), bad = localFile(f);
  assert.throws(() => deletionPlan(report([bad], { mainAuditStage: 'spotify-hydration-pass' }), f.downloads), /finished/i);
  assert.throws(() => deletionPlan(report([bad], { allLocalFilesExamined: false }), f.downloads), /finished/i);
  retained(bad);
});

test('planning keeps good, unknown and mixed-occurrence files while selecting only unanimous failures', t => {
  const f = fixture(t), bad = localFile(f, 'Bad'), good = localFile(f, 'Good', { state: 'length-match' }),
    unknown = localFile(f, 'Unknown', { state: 'missing-source-metadata' }), mixed = localFile(f, 'Mixed', { hardlinks: ['Other'] });
  mixed.occurrences[1].state = 'length-match'; mixed.occurrences[1].expectedDurationMs = 200000;
  const p = deletionPlan(report([bad, good, unknown, mixed]), f.downloads);
  assert.deepEqual(p.files.map(file => file.fileId), [bad.fileId]);
  assert.equal(p.excluded.some(file => file.fileId === mixed.fileId), true);
  retained(bad, good, unknown, mixed);
});

test('one mixed or unknown edition at the same exact path prevents deletion', t => {
  const f = fixture(t), mixed = localFile(f, 'Same Path Mixed'), unknown = localFile(f, 'Same Path Unknown');
  mixed.occurrences.push({ ...mixed.occurrences[0], spotifyId: '2234567890123456789012', expectedDurationMs: 200000, state: 'length-match' });
  unknown.occurrences.push({ ...unknown.occurrences[0], spotifyId: '3234567890123456789012', expectedDurationMs: null, state: 'missing-source-metadata' });
  assert.equal(deletionPlan(report([mixed, unknown]), f.downloads).files.length, 0);
});

test('an inventoried hardlink without a source comparison prevents deletion', t => {
  const f = fixture(t), file = localFile(f, 'Unbound Link', { hardlinks: ['Other'] });
  file.occurrences.pop();
  assert.equal(deletionPlan(report([file]), f.downloads).files.length, 0);
});

test('different known editions are eligible only when every edition unanimously fails', t => {
  const f = fixture(t), file = localFile(f, 'All Editions Bad', { actual: 500 });
  file.occurrences.push({ ...file.occurrences[0], spotifyId: '2234567890123456789012', expectedDurationMs: 300000 });
  const p = deletionPlan(report([file]), f.downloads);
  assert.equal(p.files.length, 1);
  assert.deepEqual(p.files[0].expectedDurationsMs, [100000, 300000]);
});

test('planning independently rejects false mismatches, missing duration and missing fingerprints', t => {
  const f = fixture(t), boundary = localFile(f, 'Boundary', { actual: 105 }),
    missing = localFile(f, 'Missing Source'), evidence = localFile(f, 'Missing Evidence');
  missing.occurrences[0].expectedDurationMs = null; delete evidence.fingerprint;
  assert.equal(deletionPlan(report([boundary, missing, evidence]), f.downloads).files.length, 0);
});

test('exact hardlink deletion removes each declared alias once, never a good duplicate copy or archive', async t => {
  const f = fixture(t), bad = localFile(f, 'Bad Recording', { hardlinks: ['First', 'Second'] }),
    good = localFile(f, 'Good Recording', { state: 'length-match' });
  const p = deletionPlan(report([bad, good]), f.downloads); let probes = 0;
  const result = await apply(p, f, async () => { probes++; return corroborating(); });
  assert.equal(probes, 1); assert.equal(result.filesDeleted, 1); assert.equal(result.pathsDeleted, 3);
  assert.equal(result.uniqueInodeBytesRemoved, bad.fingerprint.size);
  assert.equal(result.archivesCreated, 0); assert.equal(result.recoveryCopyCreated, false);
  for (const path of bad.paths) assert.equal(existsSync(path), false);
  retained(good);
  const events = readFileSync(f.journalPath, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.filter(event => event.phase === 'validated-intent').length, 1);
  assert.deepEqual(events.filter(event => event.phase === 'deleted').map(event => event.path), bad.paths);
  assert.equal(lstatSync(f.journalPath).mode & 0o777, 0o600);
  assert.equal(readdirSync(f.root).some(name => /archive|preserve|backup/i.test(name)), false);
});

test('a passing separate physical copy with the same song key and filename is never deleted', async t => {
  const f = fixture(t), bad = localFile(f, 'Artist - Same Song');
  const other = join(f.downloads, 'Passing Playlist'); mkdirSync(other);
  const good = localFile({ ...f, downloads: other }, 'Artist - Same Song', { state: 'length-match', actual: 100 });
  assert.equal(bad.occurrences[0].key, good.occurrences[0].key);
  assert.notEqual(bad.fileId, good.fileId);
  const goodBytes = readFileSync(good.paths[0]), p = deletionPlan(report([bad, good]), f.downloads);
  assert.deepEqual(p.files.map(file => file.fileId), [bad.fileId]);
  await apply(p, f);
  assert.equal(existsSync(bad.paths[0]), false); retained(good);
  assert.deepEqual(readFileSync(good.paths[0]), goodBytes);
  assert.equal(lstatSync(good.paths[0]).ino, good.fingerprint.ino);
});

test('a fresh probe that now matches the source stops all deletion', async t => {
  const f = fixture(t), file = localFile(f), p = deletionPlan(report([file]), f.downloads);
  await assert.rejects(() => apply(p, f, async () => ({ codec: 'mp3', durationSeconds: 100 })), /probe|corroborate/i);
  retained(file); noJournal(f);
});

test('duration failure requires an available positive-duration MP3 fresh probe', async t => {
  const f = fixture(t), file = localFile(f), p = deletionPlan(report([file]), f.downloads);
  await assert.rejects(() => apply(p, f, async () => null)); retained(file); noJournal(f);
});

test('size or timestamp changes after the audit are rejected before any probe or unlink', async t => {
  const f = fixture(t), file = localFile(f), p = deletionPlan(report([file]), f.downloads); let probes = 0;
  writeFileSync(file.paths[0], 'CHANGED TEST RECORDING WITH DIFFERENT LENGTH');
  await assert.rejects(() => apply(p, f, async () => { probes++; return corroborating(); }));
  assert.equal(probes, 0); retained(file); noJournal(f);
});

test('replacement inode with identical bytes is preserved as stale audit evidence', async t => {
  const f = fixture(t), file = localFile(f), p = deletionPlan(report([file]), f.downloads);
  const replacement = join(f.root, 'new-fake.mp3'); writeFileSync(replacement, readFileSync(file.paths[0])); renameSync(replacement, file.paths[0]);
  await assert.rejects(() => apply(p, f)); retained(file); noJournal(f);
});

test('direct symlink replacement is never followed or deleted', async t => {
  const f = fixture(t), file = localFile(f), p = deletionPlan(report([file]), f.downloads);
  const protectedPath = join(f.root, 'protected-fake.mp3'); renameSync(file.paths[0], protectedPath); symlinkSync(protectedPath, file.paths[0]);
  await assert.rejects(() => apply(p, f));
  assert.equal(lstatSync(file.paths[0]).isSymbolicLink(), true); assert.equal(existsSync(protectedPath), true); noJournal(f);
});

test('all-set preflight rejects a changed later target before deleting an earlier one', async t => {
  const f = fixture(t), first = localFile(f, 'First'), second = localFile(f, 'Second'), p = deletionPlan(report([first, second]), f.downloads);
  writeFileSync(second.paths[0], 'CHANGED SECOND RECORDING');
  await assert.rejects(() => apply(p, f)); retained(first, second); noJournal(f);
});

test('all-set preflight repeats after asynchronous probes before the first unlink', async t => {
  const f = fixture(t), first = localFile(f, 'First'), second = localFile(f, 'Second'), third = localFile(f, 'Third');
  const p = deletionPlan(report([first, second, third]), f.downloads);
  await assert.rejects(() => apply(p, f, async path => {
    if (path === third.paths[0]) writeFileSync(second.paths[0], 'CHANGED AFTER ITS PROBE');
    return corroborating();
  }));
  retained(first, second, third); noJournal(f);
});

test('a missing declared hardlink rejects the entire physical file before deletion', async t => {
  const f = fixture(t), file = localFile(f, 'Missing Link', { hardlinks: ['Other'] }), p = deletionPlan(report([file]), f.downloads);
  unlinkSync(file.paths[1]);
  await assert.rejects(() => apply(p, f)); assert.equal(existsSync(file.paths[0]), true); noJournal(f);
});

test('an extra hardlink inside downloads requires a fresh inventory', async t => {
  const f = fixture(t), file = localFile(f), p = deletionPlan(report([file]), f.downloads);
  const extra = join(f.downloads, 'Undeclared.mp3'); linkSync(file.paths[0], extra);
  await assert.rejects(() => apply(p, f)); retained(file); assert.equal(existsSync(extra), true); noJournal(f);
});

test('an extra outside-downloads hardlink is held and never silently orphaned', async t => {
  const f = fixture(t), file = localFile(f), p = deletionPlan(report([file]), f.downloads);
  const outside = join(f.root, 'preexisting-archive.mp3'); linkSync(file.paths[0], outside);
  await assert.rejects(() => apply(p, f)); retained(file); assert.equal(existsSync(outside), true); noJournal(f);
});

test('an extra non-MP3 hardlink is detected by link count, not hidden by the MP3 inventory filter', async t => {
  const f = fixture(t), file = localFile(f), p = deletionPlan(report([file]), f.downloads);
  const outsideExtension = join(f.downloads, 'Undeclared.bin'); linkSync(file.paths[0], outsideExtension);
  await assert.rejects(() => apply(p, f)); retained(file); assert.equal(existsSync(outsideExtension), true); noJournal(f);
});

test('already-known external hardlinks are excluded from the generated plan', t => {
  const f = fixture(t), file = localFile(f);
  linkSync(file.paths[0], join(f.root, 'preexisting-archive.mp3'));
  const p = deletionPlan(report([file]), f.downloads);
  assert.equal(p.files.length, 0); assert.equal(p.excluded.length, 1); retained(file);
});

test('scope validation refuses outside-root targets even with a valid-looking fingerprint', t => {
  const f = fixture(t), file = localFile(f); const outside = join(f.root, 'outside.mp3');
  writeFileSync(outside, 'PROTECTED TEST FILE');
  assert.throws(() => validateDeletionFile({ ...file, paths: [outside] }, f.downloads));
  assert.equal(existsSync(outside), true);
});

test('unreadable target that is freshly playable is preserved', async t => {
  const f = fixture(t), file = localFile(f, 'Unreadable', { state: 'unreadable', actual: null }), p = deletionPlan(report([file]), f.downloads);
  await assert.rejects(() => apply(p, f, corroborating)); retained(file); noJournal(f);
});

test('genuine repeated decoder rejection corroborates the separately confirmed unreadable target', async t => {
  const f = fixture(t), file = localFile(f, 'Unreadable', { state: 'unreadable', actual: null, hardlinks: ['Other'] }), p = deletionPlan(report([file]), f.downloads);
  const result = await apply(p, f, async () => { throw Object.assign(new Error('ffprobe decode failure'), {
    code: 1, killed: false, stderr: 'Failed to find two consecutive MPEG audio frames.\nInvalid data found when processing input' }); });
  assert.equal(result.filesDeleted, 1); assert.equal(result.pathsDeleted, 2);
});

for (const [label, error] of [
  ['missing executable', { code: 'ENOENT' }], ['permission error', { code: 'EACCES' }],
  ['timeout', { code: 'ETIMEDOUT', killed: true }], ['killed subprocess', { code: 1, killed: true, signal: 'SIGTERM' }],
  ['generic subprocess error', { code: 1, killed: false, stderr: 'Resource temporarily unavailable' }],
]) test(`unreadable target is preserved on ${label}, not falsely corroborated`, async t => {
  const f = fixture(t), file = localFile(f, 'Unreadable', { state: 'unreadable', actual: null }), p = deletionPlan(report([file]), f.downloads);
  await assert.rejects(() => apply(p, f, async () => { throw Object.assign(new Error(label), error); }));
  retained(file); noJournal(f);
});

test('duplicate physical entries in a manifest fail before the first unlink', async t => {
  const f = fixture(t), file = localFile(f), original = deletionPlan(report([file]), f.downloads);
  const p = { ...original, files: [original.files[0], original.files[0]] };
  await assert.rejects(() => apply(p, f)); retained(file); noJournal(f);
});

test('failure to create the intent journal never deletes a file', async t => {
  const f = fixture(t), file = localFile(f), p = deletionPlan(report([file]), f.downloads);
  await assert.rejects(() => applyDeletion(p, { downloads: f.downloads, journalPath: join(f.root, 'absent', 'events.jsonl'), probe: corroborating }));
  retained(file);
});
