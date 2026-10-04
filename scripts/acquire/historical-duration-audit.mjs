#!/usr/bin/env node
// Read-only media audit. No transport, YouTube, queue or recording mutations.
import { readdirSync, readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync,
  lstatSync, realpathSync, existsSync, unlinkSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { resolve, dirname, join, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalog, summary } from './catalog.mjs';
import { createDurationResolver, positiveDurationMs } from './spotify-duration.mjs';
import { getTrackDurationMetadata } from '../spotify-session.mjs';
import { durationMatch } from './duration-policy.mjs';
import { SourceReviewIndex } from './review-identity.mjs';

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const hash = value => createHash('sha256').update(value).digest('hex');
const iso = () => new Date().toISOString();
const delay = ms => new Promise(yes => setTimeout(yes, ms));
// The Spotify session gate independently enforces its configured concurrency,
// inter-request gap and Retry-After. Do not add an unconfigurable one-second
// floor above the workspace's 250 ms metadata request spacing.
export function auditGapMs(value) {
  const gap = Number(value);
  if (!Number.isFinite(gap) || gap < 250) throw new Error('Audit metadata gap must be at least 250 ms');
  return gap;
}
export const fingerprint = stat => ({ dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs });
export const sameFingerprint = (left, right) => !!left && !!right &&
  ['dev', 'ino', 'size', 'mtimeMs'].every(key => left[key] === right[key]);

export function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' });
  renameSync(temp, path);
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Audit checkpoint is unreadable'); }
}

function publicationEvents(statePath) {
  const result = [];
  for (const name of readdirSync(statePath).filter(name => /^events-[\dTZ-]+\.jsonl$/.test(name))) {
    const lines = readFileSync(join(statePath, name), 'utf8').split('\n');
    // A running CLI can have an incomplete last line, never consume that line.
    if (lines.at(-1) !== '') lines.pop();
    for (const line of lines.filter(Boolean)) {
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.type !== 'mp3_verified' || typeof event.key !== 'string' || typeof event.file !== 'string') continue;
      result.push({ key: event.key, file: event.file, t: event.t,
        guard: event.durationGuard === 'spotify-v1', runId: name.slice(7, -6) });
    }
  }
  return result;
}

export function snapshotFiles(plan, downloads, events = [], reviews = []) {
  const base = realpathSync(downloads), byInode = new Map(), failures = [];
  // Acquisition eligibility is not an audit inventory. Include wrong/unknown
  // legacy files and bind every same-name source independently after migration.
  const aliases = new Map(), aliasesBySource = new Map();
  for (const song of plan.songs.values()) {
    const names = [song.legacyKey || song.key, ...(song.destinations || []).map(path => basename(path).slice(0, -4).toLowerCase())];
    aliasesBySource.set(song.key, [...new Set(names)]);
    for (const name of names) aliases.set(name, [...new Set([...(aliases.get(name) || []), song.key])]);
  }
  let scannedMp3Paths = 0, unmatchedMp3Paths = 0;
  const byPublication = new Map();
  for (const event of [...events].sort((a, b) => a.t - b.t)) byPublication.set(`${event.key}\0${event.file}`, event);
  const reviewIndex = new SourceReviewIndex(reviews);
  const dirs = [base];
  while (dirs.length) {
    const dir = dirs.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.spooty-download-batch-')) dirs.push(path);
        continue;
      }
      if (!/\.mp3$/i.test(entry.name)) continue;
      scannedMp3Paths++;
      const alias = basename(entry.name).slice(0, -4).toLowerCase();
      const versionId = basename(entry.name).match(/ \[sp-([A-Za-z0-9]{22})\](?:-\d+)?\.mp3$/i)?.[1];
      const keys = versionId && plan.songs.has(`spotify:${versionId}`) ? [`spotify:${versionId}`] : aliases.get(alias);
      if (!keys?.length) { unmatchedMp3Paths++; continue; }
      const key = keys[0];
      let stat;
      try { stat = lstatSync(path); }
      catch { failures.push({ key, path, state: 'changed-file', reason: 'File disappeared during snapshot' }); continue; }
      if (!stat.isFile()) {
        failures.push({ key, path, state: 'unreadable', reason: 'Not a regular file; symbolic links are not followed' });
        continue;
      }
      const id = `${stat.dev}-${stat.ino}`, file = byInode.get(id) || {
        id, fingerprint: fingerprint(stat), paths: [], songKeys: [], provenance: {},
      };
      file.paths.push(path);
      for (const sourceKey of keys) if (!file.songKeys.includes(sourceKey)) file.songKeys.push(sourceKey);
      const event = byPublication.get(`${key}\0${path}`);
      if (event) file.provenance[key] = {
        kind: event.guard ? 'guarded-publication-event' : 'pre-guard-publication-event',
        at: new Date(event.t).toISOString(), runId: event.runId,
        binding: 'catalog-key-and-path-only; current file is independently checked',
      };
      byInode.set(id, file);
    }
  }
  const files = [...byInode.values()].sort((a, b) => a.id.localeCompare(b.id));
  const songKeys = new Set([...files.flatMap(file => file.songKeys), ...failures.map(item => item.key)]);
  const songs = [...plan.songs.values()].filter(song => songKeys.has(song.key)).map(song => ({
    key: song.key, artist: song.artist, name: song.name, spotifyIds: song.spotifyIds,
    fileAliases: aliasesBySource.get(song.key) || [],
    durationMs: song.durationMs, durationSpotifyId: song.durationSpotifyId,
    durationConflict: song.durationConflict || false, destinations: song.destinations,
    knownReviewStatus: reviewIndex.statusFor(song),
  }));
  return { version: 1, snapshotId: `${iso().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`,
    startedAt: iso(), downloads: base, catalog: summary(plan), songs, files, snapshotFailures: failures,
    coverage: { catalogSongsOnDisk: songs.length, physicalInodes: files.length,
      catalogMp3Paths: files.reduce((sum, file) => sum + file.paths.length, 0),
      physicalBytes: files.reduce((sum, file) => sum + file.fingerprint.size, 0),
      scannedMp3Paths, unmatchedMp3Paths, snapshotFailures: failures.length },
    policy: { id: 'spotify-v1', percent: 5, minimumSeconds: 5, maximumSeconds: 20 },
    caveats: ['Length match is not proof of recording identity.',
      'Snapshot excludes files published after enumeration; rerun with a new output directory for a newer snapshot.',
      'All distinct physical instances of each catalog filename are included; hardlinks are probed once.',
      'All Spotify IDs for a filename key are examined; unknown or conflicting editions remain ambiguous, not probable-bad.',
      'Unmatched MP3 filenames and non-regular files are disclosed, not silently certified.'],
  };
}

export function checkPaths(file, downloads) {
  const base = realpathSync(downloads) + sep;
  const stablePaths = [], changedPaths = [];
  for (const path of file.paths) {
    try {
      const stat = lstatSync(path);
      if (!path.startsWith(base) || !stat.isFile() || !realpathSync(path).startsWith(base) ||
          !sameFingerprint(file.fingerprint, fingerprint(stat))) changedPaths.push(path);
      else stablePaths.push(path);
    } catch { changedPaths.push(path); }
  }
  return { stablePaths, changedPaths };
}

export async function probeMp3(path) {
  const { stdout } = await execute('/opt/homebrew/bin/ffprobe', [
    '-v', 'error', '-select_streams', 'a:0', '-show_entries',
    'stream=codec_name:format=duration', '-of', 'json', path,
  ], { timeout: 15000, maxBuffer: 65536 });
  const doc = JSON.parse(stdout);
  return { codec: doc.streams?.[0]?.codec_name || null, durationSeconds: Number(doc.format?.duration) };
}

export async function inspectFile(file, downloads, probe = probeMp3) {
  const before = checkPaths(file, downloads);
  if (before.changedPaths.length) return { state: 'changed-file', checkedAt: iso(), ...before };
  if (file.fingerprint.size <= 0) return { state: 'unreadable', checkedAt: iso(), reason: 'Empty file' };
  let audio;
  try { audio = await probe(before.stablePaths[0]); }
  catch {
    const after = checkPaths(file, downloads);
    return after.changedPaths.length ? { state: 'changed-file', checkedAt: iso(), ...after } :
      { state: 'unreadable', checkedAt: iso(), reason: 'Local ffprobe failed' };
  }
  const after = checkPaths(file, downloads);
  if (after.changedPaths.length) return { state: 'changed-file', checkedAt: iso(), ...after };
  if (audio.codec !== 'mp3' || !Number.isFinite(audio.durationSeconds) || audio.durationSeconds <= 0)
    return { state: 'unreadable', checkedAt: iso(), reason: 'Not a positive-duration MP3' };
  return { state: 'probed', codec: audio.codec, durationSeconds: audio.durationSeconds, checkedAt: iso() };
}

export function comparison(file, song, probe, source) {
  const variants = source?.variants?.filter(variant => positiveDurationMs(variant.durationMs)) || [];
  const selected = positiveDurationMs(source?.durationMs) ?
    variants.find(variant => durationMatch(variant.durationMs, probe?.durationSeconds).ok) ||
      [...variants].sort((a, b) => Math.abs(a.durationMs / 1000 - (probe?.durationSeconds || 0)) -
        Math.abs(b.durationMs / 1000 - (probe?.durationSeconds || 0)))[0] || source : source;
  const result = { key: song.key, fileId: file.id, fingerprint: file.fingerprint,
    paths: file.paths.filter(path => basename(path).slice(0, -4).toLowerCase() === song.key || song.fileAliases?.includes(basename(path).slice(0, -4).toLowerCase()) ||
      (song.key?.startsWith('spotify:') && basename(path).includes(` [sp-${song.key.slice(8)}]`))),
    expectedDurationMs: selected?.durationMs || null, spotifyId: selected?.spotifyId || null,
    actualDurationSeconds: probe?.durationSeconds || null, differenceSeconds: null, toleranceSeconds: null,
    checkedAt: probe?.checkedAt || null, sourceCheckedAt: source?.checkedAt || null,
    provenance: file.provenance[song.key] || { kind: 'no-publication-event' },
    knownReviewStatus: song.knownReviewStatus,
    alternateSpotifyIds: (song.spotifyIds || []).filter(id => id !== selected?.spotifyId),
    sourceVariants: variants };
  if (!probe) return { ...result, state: 'unassessed' };
  if (probe.state !== 'probed') return { ...result, state: probe.state, reason: probe.reason || 'Snapshot file identity changed' };
  if (!positiveDurationMs(source?.durationMs)) return { ...result, state: 'missing-source-metadata',
    reason: source?.reason || 'Spotify source duration not yet available' };
  const match = durationMatch(selected.durationMs, probe.durationSeconds);
  return { ...result, state: match.ok ? 'length-match' : 'probable-bad-duration',
    differenceSeconds: probe.durationSeconds - selected.durationMs / 1000, toleranceSeconds: match.toleranceSeconds };
}

export async function resolveAuditSource(song, resolver, sourceLabel) {
  const ids = [...new Set(song.spotifyIds || [])].filter(id => /^[A-Za-z0-9]{22}$/.test(id));
  const variants = [], unavailableIds = [];
  if (!ids.length) {
    if (!song.durationConflict && positiveDurationMs(song.durationMs)) variants.push({ durationMs: song.durationMs, spotifyId: null });
  } else for (const id of ids) {
    const candidate = { ...song, spotifyIds: [id], durationConflict: false,
      durationMs: !song.durationConflict && (ids.length === 1 || song.durationSpotifyId === id) ? song.durationMs : undefined };
    try { variants.push({ durationMs: await resolver(candidate), spotifyId: id }); }
    catch { unavailableIds.push(id); }
  }
  const durations = variants.map(variant => variant.durationMs);
  const ambiguous = durations.length > 1 && Math.max(...durations) - Math.min(...durations) > 5000;
  const ready = variants.length && !unavailableIds.length && !ambiguous;
  return { version: 1, key: song.key, durationMs: ready ? variants[0].durationMs : null,
    spotifyId: ready ? variants[0].spotifyId : null, variants, unavailableIds, ambiguous,
    source: sourceLabel, checkedAt: iso(), reason: ready ? null : ambiguous ?
      'Conflicting Spotify edition durations for the same filename key; occurrence binding required' :
      'Spotify duration unavailable for one or more catalog identities' };
}

export function summarizeAudit(snapshot, records, sources, options = {}) {
  const counts = { 'length-match': 0, 'probable-bad-duration': 0, unreadable: 0,
    'missing-source-metadata': 0, 'changed-file': 0, unassessed: 0 };
  const songs = new Map(snapshot.songs.map(song => [song.key, { song, rows: [] }]));
  const findings = [];
  let probedInodes = 0, processedInodes = 0;
  for (const file of snapshot.files) {
    const record = records.get(file.id);
    if (record?.probe) processedInodes++;
    if (record?.probe?.state === 'probed') probedInodes++;
    for (const key of file.songKeys) {
      const value = songs.get(key);
      const row = comparison(file, value.song, record?.probe, sources.get(key));
      value.rows.push(row); counts[row.state]++;
      if (row.state !== 'length-match') findings.push(row);
    }
  }
  for (const failure of snapshot.snapshotFailures) {
    const row = { key: failure.key, state: failure.state, fileId: null, fingerprint: null,
      paths: [failure.path], expectedDurationMs: null, spotifyId: null, actualDurationSeconds: null,
      checkedAt: snapshot.startedAt, reason: failure.reason, provenance: { kind: 'no-publication-event' } };
    songs.get(failure.key)?.rows.push(row); counts[row.state]++; findings.push(row);
  }
  const unique = { catalogSongsOnDisk: songs.size, allInstancesLengthMatch: 0, durationCompared: 0,
    probableBadDuration: 0, unreadable: 0, missingSourceMetadata: 0, changedFile: 0, unassessed: 0 };
  const cohort = {};
  for (const value of songs.values()) {
    const states = new Set(value.rows.map(row => row.state));
    if (value.rows.length && [...states].every(state => state === 'length-match')) unique.allInstancesLengthMatch++;
    if (states.has('length-match') || states.has('probable-bad-duration')) unique.durationCompared++;
    for (const [field, state] of Object.entries({ probableBadDuration: 'probable-bad-duration', unreadable: 'unreadable',
      missingSourceMetadata: 'missing-source-metadata', changedFile: 'changed-file', unassessed: 'unassessed' }))
      if (states.has(state)) unique[field]++;
    for (const kind of new Set(value.rows.map(row => row.provenance.kind))) {
      const group = cohort[kind] ||= { uniqueSongs: 0, probableBadDuration: 0 };
      group.uniqueSongs++; if (states.has('probable-bad-duration')) group.probableBadDuration++;
    }
  }
  const elapsedMinutes = Math.max((Date.now() - (options.hydrationStartedAt || Date.now())) / 60000, 0.001);
  const lookupsPerMinute = (options.successfulHydrations || 0) / elapsedMinutes;
  const probeMinutes = Math.max((Date.now() - (options.probeStartedAt || Date.now())) / 60000, 0.001);
  const probesPerMinute = (options.probedThisSession || 0) / probeMinutes;
  const probeRemainingSeconds = probesPerMinute > 0 ? (snapshot.files.length - processedInodes) / probesPerMinute * 60 : null;
  const unknownSources = snapshot.songs.filter(song => !positiveDurationMs(sources.get(song.key)?.durationMs)).length;
  const remainingSeconds = lookupsPerMinute > 0 ? unknownSources / lookupsPerMinute * 60 : null;
  const complete = processedInodes === snapshot.files.length && !unknownSources &&
    !unique.changedFile && !unique.unassessed && !unique.unreadable;
  return { version: 1, snapshotId: snapshot.snapshotId, updatedAt: iso(), snapshotStartedAt: snapshot.startedAt,
    stage: options.stage || 'initializing', complete, pid: process.pid,
    coverage: snapshot.coverage, uniqueSongs: unique, comparisons: counts, provenanceCohorts: cohort,
    physical: { totalInodes: snapshot.files.length, processedInodes, probedInodes,
      bytes: snapshot.coverage.physicalBytes, gb: snapshot.coverage.physicalBytes / 1e9 },
    localProbe: { probesThisSession: options.probedThisSession || 0, probesPerMinute,
      continuousEta: probeRemainingSeconds === null ? null : new Date(Date.now() + probeRemainingSeconds * 1000).toISOString(),
      buffered25Eta: probeRemainingSeconds === null ? null : new Date(Date.now() + probeRemainingSeconds * 1250).toISOString() },
    sourceMetadata: { known: snapshot.songs.length - unknownSources, unknown: unknownSources,
      minimumRequestGapMs: options.gapMs ?? null,
      successfulHydrationsThisSession: options.successfulHydrations || 0,
      attemptedHydrationsThisSession: options.attemptedHydrations || 0,
      successfulHydrationsPerMinute: lookupsPerMinute },
    eta: { scope: 'Remaining snapshot Spotify-duration hydration; repair ETA is not included',
      continuous: remainingSeconds === null ? null : new Date(Date.now() + remainingSeconds * 1000).toISOString(),
      buffered25: remainingSeconds === null ? null : new Date(Date.now() + remainingSeconds * 1250).toISOString() },
    findings, caveats: snapshot.caveats };
}

export function metadataPriority(snapshot, records, sources) {
  const durations = new Map();
  for (const file of snapshot.files) {
    const duration = records.get(file.id)?.probe?.durationSeconds;
    for (const key of file.songKeys) if (duration > 0) {
      // Queue unusually short/long recordings first, but do not call them bad.
      const score = duration < 60 ? 1e6 + 60 - duration : duration;
      durations.set(key, Math.max(durations.get(key) || 0, score));
    }
  }
  return snapshot.songs.filter(song => !positiveDurationMs(sources.get(song.key)?.durationMs))
    .sort((a, b) => (durations.get(b.key) || 0) - (durations.get(a.key) || 0) || a.key.localeCompare(b.key));
}

export async function runAudit({ output, playlists, downloads, dbPath, cachePath, statePath,
  hydrate = true, gapMs = 1000, probe = probeMp3, fetchMetadata = getTrackDurationMetadata,
  stopRequested = () => false, onProgress = () => {}, maxHydrations = Infinity }) {
  gapMs = auditGapMs(gapMs);
  mkdirSync(output, { recursive: true, mode: 0o700 }); chmodSync(output, 0o700);
  let snapshot = readJson(join(output, 'snapshot.json'));
  if (!snapshot) {
    const plan = await catalog({ playlists, downloads, dbPath });
    const reviews = readJson(join(statePath, 'quality-review.json'))?.entries || [];
    snapshot = snapshotFiles(plan, downloads, publicationEvents(statePath), reviews);
    atomicJson(join(output, 'snapshot.json'), snapshot);
  }
  if (snapshot.version !== 1 || snapshot.downloads !== realpathSync(downloads)) throw new Error('Audit snapshot does not match download root');
  const records = new Map(), sources = new Map(), songMap = new Map(snapshot.songs.map(song => [song.key, song]));
  const filesBySong = new Map(snapshot.songs.map(song => [song.key, []]));
  const filePath = file => join(output, 'files', `${file.id}.json`);
  const sourcePath = song => join(output, 'sources', `${hash(song.key)}.json`);
  const options = { stage: 'cached-source-pass', sessionStartedAt: Date.now(),
    attemptedHydrations: 0, successfulHydrations: 0, gapMs };
  const persistFile = file => {
    const record = records.get(file.id) || { version: 1, snapshotId: snapshot.snapshotId, fileId: file.id,
      fingerprint: file.fingerprint, paths: file.paths, probe: null };
    record.comparisons = file.songKeys.map(key => comparison(file, songMap.get(key), record.probe, sources.get(key)));
    records.set(file.id, record); atomicJson(filePath(file), record);
  };
  let lastReport = 0;
  const report = force => {
    if (!force && Date.now() - lastReport < 15000) return;
    lastReport = Date.now();
    const result = summarizeAudit(snapshot, records, sources, options);
    const { findings, ...progress } = result;
    atomicJson(join(output, 'findings.json'), { version: 1, snapshotId: snapshot.snapshotId,
      updatedAt: result.updatedAt, stage: result.stage, complete: result.complete, findings });
    atomicJson(join(output, 'progress.json'), progress); onProgress(progress);
  };
  for (const file of snapshot.files) {
    for (const key of file.songKeys) filesBySong.get(key).push(file);
    const saved = readJson(filePath(file));
    if (saved?.snapshotId === snapshot.snapshotId && sameFingerprint(saved.fingerprint, file.fingerprint) && saved.probe) {
      const current = checkPaths(file, downloads);
      records.set(file.id, current.changedPaths.length ? { ...saved, probe: {
        state: 'changed-file', checkedAt: iso(), ...current } } : saved);
    }
  }
  const cachedResolver = createDurationResolver(cachePath, async () => { throw new Error('Cache-only pass'); });
  for (const song of snapshot.songs) {
    const saved = readJson(sourcePath(song));
    if (saved?.key === song.key && saved.snapshotId === snapshot.snapshotId && positiveDurationMs(saved.durationMs)) {
      sources.set(song.key, saved); continue;
    }
    const source = { ...await resolveAuditSource(song, cachedResolver, 'saved-playlist-or-metadata-cache'), snapshotId: snapshot.snapshotId };
    sources.set(song.key, source);
    if (positiveDurationMs(source.durationMs)) atomicJson(sourcePath(song), source);
  }
  options.stage = 'local-probe-pass'; options.probeStartedAt = Date.now(); options.probedThisSession = 0; report(true);
  const probeFiles = [...snapshot.files].sort((a, b) =>
    Number(b.songKeys.some(key => positiveDurationMs(sources.get(key)?.durationMs))) -
    Number(a.songKeys.some(key => positiveDurationMs(sources.get(key)?.durationMs))));
  let cursor = 0;
  async function probeWorker() {
    while (cursor < probeFiles.length && !stopRequested()) {
      const file = probeFiles[cursor++];
      if (!records.get(file.id)?.probe || records.get(file.id).probe.state === 'unreadable') {
        const inspected = await inspectFile(file, downloads, probe);
        records.set(file.id, { version: 1, snapshotId: snapshot.snapshotId, fileId: file.id,
          fingerprint: file.fingerprint, paths: file.paths, probe: inspected });
        options.probedThisSession++;
      }
      persistFile(file); report(false);
    }
  }
  await Promise.all([probeWorker(), probeWorker()]);
  options.stage = stopRequested() ? 'paused' : hydrate ? 'spotify-hydration-pass' : 'cache-pass-finished'; report(true);
  options.hydrationStartedAt = Date.now();
  let nextFetchAt = 0;
  const resolver = createDurationResolver(cachePath, async id => {
    await delay(Math.max(0, nextFetchAt - Date.now()));
    nextFetchAt = Date.now() + gapMs;
    if (stopRequested()) throw new Error('Audit paused');
    return fetchMetadata(id);
  });
  let consecutiveFailures = 0;
  if (hydrate && !stopRequested()) for (const song of metadataPriority(snapshot, records, sources)) {
    if (stopRequested() || options.attemptedHydrations >= maxHydrations) break;
    options.attemptedHydrations++;
    const source = { ...await resolveAuditSource(song, resolver, 'authenticated-session-or-new-shared-cache'), snapshotId: snapshot.snapshotId };
    if (positiveDurationMs(source.durationMs)) {
      options.successfulHydrations++; consecutiveFailures = 0;
    } else {
      consecutiveFailures++;
    }
    sources.set(song.key, source); atomicJson(sourcePath(song), source);
    for (const file of filesBySong.get(song.key)) {
      // A repair/new publication must not inherit an old comparison marker.
      const current = checkPaths(file, downloads);
      if (current.changedPaths.length) records.get(file.id).probe = { state: 'changed-file', checkedAt: iso(), ...current };
      persistFile(file);
    }
    report(false);
    if (consecutiveFailures >= 5) {
      options.stage = 'spotify-backoff'; report(true);
      for (let i = 0; i < 60 && !stopRequested(); i++) await delay(1000);
      consecutiveFailures = 0; options.stage = 'spotify-hydration-pass';
    }
  }
  options.stage = stopRequested() ? 'paused' : hydrate ? 'pass-finished' : 'cache-pass-finished';
  report(true);
  return summarizeAudit(snapshot, records, sources, options);
}

async function main() {
  const { values } = parseArgs({ options: { output: { type: 'string' },
    'cache-only': { type: 'boolean', default: false }, 'gap-ms': { type: 'string', default: '1000' },
    'max-hydrations': { type: 'string' } } });
  if (process.version !== 'v20.19.4') throw new Error('Use Node 20.19.4 for this workspace');
  const output = resolve(values.output || join(root, 'data/acquire/historical-duration-audit'));
  const allowed = join(root, 'data/acquire/historical-duration-audit');
  if (output !== allowed && !output.startsWith(allowed + sep)) throw new Error('Audit output must stay in its dedicated artifact directory');
  const gapMs = auditGapMs(values['gap-ms']);
  const maxHydrations = values['max-hydrations'] === undefined ? Infinity : Number(values['max-hydrations']);
  if (!(maxHydrations >= 0)) throw new Error('Invalid metadata attempt limit');
  mkdirSync(output, { recursive: true, mode: 0o700 });
  const lockPath = join(output, 'audit-lock.json');
  const prior = readJson(lockPath);
  if (prior?.pid) {
    let running = false;
    try { process.kill(prior.pid, 0); running = true; } catch {}
    if (running) throw new Error('This audit snapshot already has a live worker');
    unlinkSync(lockPath);
  }
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: iso() }), { mode: 0o600, flag: 'wx' });
  let stopping = false;
  process.on('SIGINT', () => { stopping = true; }); process.on('SIGTERM', () => { stopping = true; });
  try {
    await runAudit({ output, playlists: process.env.STATIC_PLAYLISTS_PATH || join(root, 'PLAYLISTS_2026-09-08/playlists'),
      downloads: process.env.DOWNLOADS_PATH || join(root, 'downloads'), dbPath: process.env.DB_PATH || join(root, 'data/spooty.sqlite'),
      cachePath: process.env.SPOTIFY_TRACK_METADATA_PATH || join(root, 'data/spotify-track-metadata'),
      statePath: join(root, 'data/acquire'), hydrate: !values['cache-only'], gapMs, maxHydrations,
      stopRequested: () => stopping, onProgress: progress => console.log(JSON.stringify(progress)) });
  } finally {
    if (readJson(lockPath)?.pid === process.pid) unlinkSync(lockPath);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => { console.error('Historical audit stopped; inspect its private progress artifacts. No media was changed.'); process.exitCode = 1; });
