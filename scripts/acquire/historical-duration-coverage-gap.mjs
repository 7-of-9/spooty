#!/usr/bin/env node
// Offline evidence for every MP3 outside the first historical audit's catalog.
// No Spotify/YouTube requests, transport import, media edits or ledger writes.
import { readdirSync, readFileSync, lstatSync, realpathSync, mkdirSync, writeFileSync,
  renameSync, chmodSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join, dirname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalog, database, songKey, fileBase, folder, excluded } from './catalog.mjs';
import { positiveDurationMs, validSourceMetadata } from './spotify-duration.mjs';
import { durationMatch } from './duration-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const execute = promisify(execFile);
const normalize = value => String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const identityKey = (artist, name) => `${normalize(artist)}\0${normalize(name)}`;
const spotifyId = value => /^[A-Za-z0-9]{22}$/.test(value || '') ? value :
  String(value || '').match(/^(?:https:\/\/open\.spotify\.com\/track\/|spotify:track:)([A-Za-z0-9]{22})(?:[?#]|$)/)?.[1] || null;
export const fingerprint = stat => ({ dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs });
export const sameFingerprint = (a, b) => a && b && ['dev', 'ino', 'size', 'mtimeMs'].every(key => a[key] === b[key]);

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); chmodSync(dirname(path), 0o700);
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' }); renameSync(temp, path);
}

export function inventoryMp3(downloads, currentKeys = new Set()) {
  const base = realpathSync(downloads), dirs = [base], groups = new Map(), nonRegular = [], scanFailures = [];
  while (dirs.length) {
    const dir = dirs.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { dirs.push(path); continue; }
      if (!/\.mp3$/i.test(entry.name)) continue;
      let stat;
      try { stat = lstatSync(path); } catch { scanFailures.push({ path, reason: 'Disappeared during inventory' }); continue; }
      const key = basename(entry.name).slice(0, -4).toLowerCase();
      const staging = path.slice(base.length + 1).split(sep).some(part => part.startsWith('.spooty-download-batch-'));
      if (!stat.isFile()) { nonRegular.push({ path, key, staging, reason: 'Not a regular file; symbolic link not followed' }); continue; }
      const id = `${stat.dev}-${stat.ino}`, group = groups.get(id) || { id, fingerprint: fingerprint(stat), birthtimeMs: stat.birthtimeMs, paths: [] };
      group.paths.push({ path, key, staging, currentCatalog: currentKeys.has(key) }); groups.set(id, group);
    }
  }
  return { inventoriedAt: new Date().toISOString(), downloads: base, files: [...groups.values()], nonRegular, scanFailures };
}

export function buildBindingIndex(rows) {
  const identities = new Map(), byFilename = new Map(), byPath = new Map();
  for (const row of rows) {
    if (!row.artist || !row.name) continue;
    const id = identityKey(row.artist, row.name);
    const entity = identities.get(id) || { id, artist: row.artist, name: row.name, key: songKey(row.artist, row.name), spotifyIds: [], durations: [], evidence: [] };
    const sourceId = spotifyId(row.spotifyId);
    if (sourceId && !entity.spotifyIds.includes(sourceId)) entity.spotifyIds.push(sourceId);
    if (positiveDurationMs(row.durationMs)) entity.durations.push({ spotifyId: sourceId, durationMs: row.durationMs, source: row.source });
    entity.evidence.push({ source: row.source, path: row.path || null, excludedFromActiveCatalog: !!row.excludedFromActiveCatalog });
    identities.set(id, entity);
    const normalizedFilename = normalize(entity.key);
    if (!byFilename.has(normalizedFilename)) byFilename.set(normalizedFilename, new Set()); byFilename.get(normalizedFilename).add(id);
    if (row.path) { if (!byPath.has(row.path)) byPath.set(row.path, new Set()); byPath.get(row.path).add(id); }
  }
  return { identities, byFilename, byPath };
}

export function occurrenceBindings(rows) {
  const byPath = new Map();
  for (const row of rows) {
    const id = spotifyId(row.spotifyId);
    if (!row.path || !id || !row.artist || !row.name) continue;
    const occurrence = { spotifyId: id, artist: row.artist, name: row.name,
      durationMs: positiveDurationMs(row.durationMs) ? row.durationMs : null,
      source: row.source, excludedFromActiveCatalog: !!row.excludedFromActiveCatalog };
    const items = byPath.get(row.path) || [];
    if (!items.some(item => item.spotifyId === id && item.source === row.source)) items.push(occurrence);
    byPath.set(row.path, items);
  }
  return [...byPath].map(([path, occurrences]) => ({ path, occurrences }));
}

export function exactBinding(file, tags, index) {
  const paths = file.paths.filter(item => !item.staging);
  const pathIds = new Set(paths.flatMap(item => [...(index.byPath.get(item.path) || [])]));
  const filenameIds = new Set(paths.flatMap(item => [...(index.byFilename.get(normalize(item.key)) || [])]));
  const tagId = tags?.artist && tags?.title ? identityKey(tags.artist, tags.title) : null;
  const tagKnown = tagId && index.identities.has(tagId) ? tagId : null;
  const identities = pathIds.size ? pathIds : filenameIds;
  if (identities.size > 1) return { state: 'unknown-identity', reason: 'Filename or playlist path maps to multiple exact artist/title identities', candidateCount: identities.size };
  if (identities.size === 1) {
    const id = [...identities][0];
    if (tagKnown && tagKnown !== id) return { state: 'unknown-identity', reason: 'Exact saved filename identity conflicts with exact MP3 tag identity', candidateCount: 2 };
    return { state: 'bound', method: pathIds.size ? 'exact-saved-playlist-path' : 'exact-generated-filename', identity: index.identities.get(id) };
  }
  if (tagKnown) return { state: 'bound', method: 'exact-artist-and-title-tags-to-saved-metadata', identity: index.identities.get(tagKnown) };
  return { state: 'unknown-identity', reason: 'No exact saved playlist or SQLite identity binding; not inferred from fuzzy names' };
}

function eventsFrom(statePath) {
  const output = [];
  for (const name of readdirSync(statePath).filter(name => /^events-[\dTZ-]+\.jsonl$/.test(name))) {
    const lines = readFileSync(join(statePath, name), 'utf8').split('\n');
    if (lines.at(-1) !== '') lines.pop();
    for (const line of lines.filter(Boolean)) {
      let event; try { event = JSON.parse(line); } catch { continue; }
      if (event.type === 'mp3_verified') output.push({ key: event.key, file: event.file, t: event.t,
        durationGuard: event.durationGuard, spotifyDurationMs: event.spotifyDurationMs,
        durationSpotifyId: event.durationSpotifyId, durationSeconds: event.duration, runId: name.slice(7, -6) });
    }
  }
  return output;
}

export function coverageClassification(file, snapshot, events) {
  const original = snapshot.files.find(item => item.id === file.id);
  if (original && sameFingerprint(original.fingerprint, file.fingerprint)) return { state: 'snapshot-covered-unchanged',
    extraPaths: file.paths.filter(item => !original.paths.includes(item.path)).map(item => item.path) };
  const snapshotAt = Date.parse(snapshot.startedAt);
  const correlated = events.filter(event => event.durationGuard === 'spotify-v1' && event.t >= snapshotAt &&
    file.paths.some(item => event.file === item.path && event.key === item.key) &&
    file.fingerprint.mtimeMs >= snapshotAt && file.fingerprint.mtimeMs <= event.t + 1000);
  if (correlated.length) return { state: 'new-guarded-publication-correlated', events: correlated,
    binding: 'Exact publication key/path plus new-file mtime; event does not contain a file hash' };
  if (original) return { state: 'snapshot-file-changed', originalFingerprint: original.fingerprint };
  if (file.fingerprint.mtimeMs <= snapshotAt) return { state: 'historical-file-outside-original-snapshot' };
  return { state: 'new-or-changed-file-without-guarded-publication-proof' };
}

export async function probeGapFile(file, downloads, probe) {
  const base = realpathSync(downloads) + sep;
  const unchanged = () => file.paths.every(item => {
    try { const stat = lstatSync(item.path); return stat.isFile() && realpathSync(item.path).startsWith(base) && sameFingerprint(fingerprint(stat), file.fingerprint); }
    catch { return false; }
  });
  if (!unchanged()) return { state: 'changed-file', checkedAt: new Date().toISOString() };
  let result;
  try {
    if (probe) result = await probe(file.paths[0].path);
    else {
      const { stdout } = await execute('/opt/homebrew/bin/ffprobe', ['-v', 'error', '-select_streams', 'a:0',
        '-show_entries', 'stream=codec_name:format=duration:format_tags=title,artist,album', '-of', 'json', file.paths[0].path],
      { timeout: 15000, maxBuffer: 65536 });
      const doc = JSON.parse(stdout), tags = doc.format?.tags || {};
      result = { codec: doc.streams?.[0]?.codec_name || null, durationSeconds: Number(doc.format?.duration),
        tags: Object.fromEntries(['title', 'artist', 'album'].filter(key => typeof tags[key] === 'string').map(key => [key, tags[key]])) };
    }
  } catch { result = { state: 'unreadable', reason: 'Local ffprobe failed' }; }
  if (!unchanged()) return { state: 'changed-file', checkedAt: new Date().toISOString() };
  return result.codec === 'mp3' && Number.isFinite(result.durationSeconds) && result.durationSeconds > 0 ?
    { ...result, state: 'probed', checkedAt: new Date().toISOString() } :
    { state: 'unreadable', checkedAt: new Date().toISOString(), reason: 'Not a readable positive-duration MP3' };
}

async function bindingRows(playlists, downloads, dbPath) {
  const rows = [];
  for (const filename of readdirSync(playlists).filter(name => name.endsWith('.json'))) {
    const playlist = JSON.parse(readFileSync(join(playlists, filename), 'utf8'));
    for (const track of playlist.tracks || []) rows.push({ artist: track.artist, name: track.name,
      spotifyId: track.id || track.href, durationMs: track.durationMs ?? track.duration_ms,
      path: join(folder(downloads, playlist.name), fileBase(track.artist, track.name) + '.mp3'),
      source: `saved-playlist:${filename}`, excludedFromActiveCatalog: !!(playlist.skipped || playlist.raw?.skipped || excluded(playlist.name)) });
  }
  // A previous local scrape can retain exact IDs after radio membership changes.
  // It is public track metadata, not an authentication/session file.
  try {
    const previous = JSON.parse(readFileSync(join(root, '.playlist_tracks.json'), 'utf8'));
    for (const track of previous.tracks || []) rows.push({ artist: track.artist, name: track.title || track.name,
      spotifyId: track.href || track.id, durationMs: track.durationMs ?? track.duration_ms, source: 'legacy-local-playlist-tracks' });
  } catch { /* Absence or unreadable legacy metadata is not an identity proof. */ }
  const db = database(dbPath, true);
  try { for (const row of await db.all('SELECT id, artist, name, spotifyUrl, durationMs FROM track_entity'))
    rows.push({ artist: row.artist, name: row.name, spotifyId: row.spotifyUrl, durationMs: row.durationMs, source: `sqlite-track:${row.id}` }); }
  finally { await db.close(); }
  return rows;
}

export function cachedComparison(binding, probe, cachePath) {
  if (binding.state !== 'bound') return { state: 'unknown-identity' };
  const identity = binding.identity, durations = [...identity.durations];
  for (const id of identity.spotifyIds) {
    let metadata;
    try { metadata = JSON.parse(readFileSync(join(cachePath, `${id}.json`), 'utf8')); } catch { continue; }
    if (validSourceMetadata(metadata, id, identity)) durations.push({ spotifyId: id, durationMs: metadata.durationMs, source: 'public-metadata-cache' });
  }
  const variants = [...new Map(durations.map(item => [`${item.spotifyId}:${item.durationMs}`, item])).values()];
  const missingSpotifyIds = identity.spotifyIds.filter(id => !variants.some(variant => variant.spotifyId === id));
  if (probe.state !== 'probed') return { state: probe.state, variants, missingSpotifyIds };
  if (!variants.length || missingSpotifyIds.length) return { state: 'missing-source-metadata', variants, missingSpotifyIds };
  if (Math.max(...variants.map(item => item.durationMs)) - Math.min(...variants.map(item => item.durationMs)) > 5000)
    return { state: 'ambiguous-source-editions', variants, missingSpotifyIds };
  const selected = variants.find(item => durationMatch(item.durationMs, probe.durationSeconds).ok) ||
    [...variants].sort((a, b) => Math.abs(a.durationMs / 1000 - probe.durationSeconds) - Math.abs(b.durationMs / 1000 - probe.durationSeconds))[0];
  const match = durationMatch(selected.durationMs, probe.durationSeconds);
  return { state: match.ok ? 'length-match' : 'probable-bad-duration', expectedDurationMs: selected.durationMs,
    spotifyId: selected.spotifyId, actualDurationSeconds: probe.durationSeconds,
    toleranceSeconds: match.toleranceSeconds, variants, missingSpotifyIds };
}

async function main() {
  if (process.version !== 'v20.19.4') throw new Error('Use Node20.19.4');
  const statePath = join(root, 'data/acquire'), auditPath = join(statePath, 'historical-duration-audit');
  const output = join(auditPath, 'coverage-gap');
  const downloads = join(root, 'downloads'), playlists = join(root, 'PLAYLISTS_2026-09-08/playlists'), dbPath = join(root, 'data/spooty.sqlite');
  const snapshot = JSON.parse(readFileSync(join(auditPath, 'snapshot.json'), 'utf8'));
  const plan = await catalog({ playlists, downloads, dbPath });
  const startedAt = new Date().toISOString(), inventory = inventoryMp3(downloads, new Set(plan.songs.keys()));
  const persistArtifact = (name, value) => {
    // Preserve previous coverage inventories when refreshing the moving download set.
    try {
      const previous = JSON.parse(readFileSync(join(output, name), 'utf8'));
      if (typeof previous.startedAt === 'string') atomicJson(join(output, 'runs', previous.startedAt.replace(/[:.]/g, '-'), name), previous);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    atomicJson(join(output, 'runs', startedAt.replace(/[:.]/g, '-'), name), value);
    atomicJson(join(output, name), value);
  };
  const events = eventsFrom(statePath), rows = await bindingRows(playlists, downloads, dbPath), index = buildBindingIndex(rows);
  const snapshotPaths = new Map(snapshot.files.flatMap(file => file.paths.map(path => [path, file])));
  const originalPathStates = [...snapshotPaths].map(([path, file]) => {
    try { return { path, state: sameFingerprint(file.fingerprint, fingerprint(lstatSync(path))) ? 'unchanged' : 'changed' }; }
    catch { return { path, state: 'missing' }; }
  });
  const files = inventory.files.map(file => ({ ...file, coverage: coverageClassification(file, snapshot, events) }));
  persistArtifact('inventory.json', { version: 1, startedAt, snapshotId: snapshot.snapshotId,
    snapshotStartedAt: snapshot.startedAt, ...inventory, files, originalPathStates,
    originalUnmatchedCount: snapshot.coverage.unmatchedMp3Paths,
    originalUnmatchedPathListWasNotPersisted: true });
  const gaps = files.filter(file => file.coverage.state !== 'snapshot-covered-unchanged' ||
    file.paths.some(item => !item.currentCatalog || item.staging));
  const results = []; let cursor = 0;
  async function worker() {
    while (cursor < gaps.length) {
      const file = gaps[cursor++], probe = await probeGapFile(file, downloads);
      const binding = exactBinding(file, probe.tags, index);
      const staging = file.paths.every(item => item.staging);
      const category = staging ? 'staging-artifact' : probe.state === 'unreadable' ? 'unreadable' : binding.state;
      results.push({ ...file, category, probe, binding,
        gapReason: staging ? 'staging-artifact' : file.paths.some(item => !item.currentCatalog) ? 'unmatched-current-catalog' : file.coverage.state,
        durationCheck: cachedComparison(binding, probe, join(root, 'data/spotify-track-metadata')) });
    }
  }
  await Promise.all([worker(), worker()]);
  const counts = field => results.reduce((all, file) => { const key = field(file); all[key] = (all[key] || 0) + 1; return all; }, {});
  const coverageCounts = files.reduce((all, file) => { all[file.coverage.state] = (all[file.coverage.state] || 0) + 1; return all; }, {});
  const result = { version: 1, startedAt, finishedAt: new Date().toISOString(), snapshotId: snapshot.snapshotId,
    scope: 'Offline full current MP3 inventory and local inspection of every physical file absent/changed from the original snapshot, plus all unmatched/staging files; no remote lookups or file mutations.',
    summary: { currentPhysicalInodes: files.length, currentMp3Paths: files.reduce((sum, file) => sum + file.paths.length, 0),
      currentBytes: files.reduce((sum, file) => sum + file.fingerprint.size, 0),
      currentCatalogSongsOnDisk: new Set(files.flatMap(file => file.paths.filter(item => item.currentCatalog).map(item => item.key))).size,
      unmatchedPaths: files.flatMap(file => file.paths).filter(item => !item.currentCatalog && !item.staging).length,
      inspectedGapPhysicalInodes: results.length, categories: counts(file => file.category), durationChecks: counts(file => file.durationCheck.state),
      coverageCounts, originalSnapshotPathStates: originalPathStates.reduce((all, item) => { all[item.state] = (all[item.state] || 0) + 1; return all; }, {}),
      nonRegularPaths: inventory.nonRegular.length, scanFailures: inventory.scanFailures.length },
    files: results, nonRegular: inventory.nonRegular, scanFailures: inventory.scanFailures,
    caveats: ['Exact filename/tag bindings identify intended catalog metadata, not the audio recording itself.',
      'The first snapshot retained only the197 unmatched-path count, not its list; this inventory preserves all current paths and checks historical timestamps.',
      'New guarded publication correlation uses exact event key/path and mtime, not an unavailable publication hash.',
      'Unknown identities and missing/ambiguous Spotify durations remain explicit; they are not called good or bad.'] };
  const bound = results.filter(file => file.binding.state === 'bound');
  const boundSongs = new Map();
  for (const file of bound) {
    const identity = file.binding.identity;
    const song = boundSongs.get(identity.key) || { key: identity.key, artist: identity.artist, name: identity.name,
      spotifyIds: identity.spotifyIds, destinations: [], rowIds: [], knownReviewStatus: null,
      sourceVariants: file.durationCheck.variants || [], bindingEvidence: identity.evidence };
    song.destinations = [...new Set([...song.destinations, ...file.paths.map(item => item.path)])];
    boundSongs.set(song.key, song);
  }
  persistArtifact('supplemental.json', { version: 1, startedAt, snapshotId: snapshot.snapshotId,
    scope: 'Exact saved-identity bindings for the physical coverage gap; not an instruction to acquire excluded playlist content.',
    songs: [...boundSongs.values()], files: bound.map(file => ({ id: file.id, fingerprint: file.fingerprint,
      paths: file.paths.map(item => item.path), songKeys: [file.binding.identity.key],
      pathSongKeys: Object.fromEntries(file.paths.map(item => [item.path, file.binding.identity.key])),
      provenance: { [file.binding.identity.key]: { kind: file.coverage.state, bindingMethod: file.binding.method } },
      probe: file.probe, durationCheck: file.durationCheck })),
    unknownFiles: results.filter(file => file.binding.state !== 'bound').map(file => ({ id: file.id,
      fingerprint: file.fingerprint, paths: file.paths.map(item => item.path), probe: file.probe, reason: file.binding.reason })),
    caveat: 'Use exact path occurrence IDs for per-playlist comparisons. pathSongKeys explicitly maps normalized-name aliases; do not infer paths by filename equality.' });
  persistArtifact('playlist-occurrence-bindings.json', { version: 1, startedAt,
    sourceScope: 'All saved playlist dumps, including skipped and dynamic playlists, for audit identity only',
    policy: 'An inode can match one playlist occurrence and fail another; exact path ID variants must be compared independently.',
    paths: occurrenceBindings(rows) });
  persistArtifact('report.json', result); console.log(JSON.stringify({ ...result, files: undefined }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => { console.error('Offline coverage-gap audit failed; no media changed.'); process.exitCode = 1; });
