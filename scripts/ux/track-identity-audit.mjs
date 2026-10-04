#!/usr/bin/env node
// Read-only catalog/file evidence. No Spotify, Chrome, queue or database writes.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { songKey, fileBase, folder, excluded } from '../acquire/catalog.mjs';
import { validSourceMetadata } from '../acquire/spotify-duration.mjs';
import { durationMatch } from '../acquire/duration-policy.mjs';

export function collectIdentityEvidence(playlistsPath, metadataPath) {
  const groups = new Map();
  const metadata = new Map();
  const sourceIds = new Set();
  let playlists = 0, occurrences = 0;
  for (const file of readdirSync(playlistsPath).filter(f => f.endsWith('.json')).sort()) {
    const playlist = JSON.parse(readFileSync(join(playlistsPath, file), 'utf8'));
    if (playlist.skipped || playlist.raw?.skipped || excluded(playlist.name)) continue;
    playlists++;
    for (const track of playlist.tracks || []) {
      if (!track.artist || !track.name) continue;
      occurrences++;
      const key = songKey(track.artist, track.name);
      const group = groups.get(key) || { key, names: new Set(), sources: new Map(), occurrences: [] };
      group.names.add(`${track.artist} — ${track.name}`);
      const id = /^[A-Za-z0-9]{22}$/.test(track.id || '') ? track.id :
        String(track.href || '').match(/^(?:https:\/\/open\.spotify\.com\/(?:intl-[^/]+\/)?track\/|spotify:track:)([A-Za-z0-9]{22})(?:[?#].*)?$/)?.[1] || null;
      if (id) sourceIds.add(id);
      if (id && !metadata.has(id)) {
        let value = null;
        try { value = JSON.parse(readFileSync(join(metadataPath, `${id}.json`), 'utf8')); } catch {}
        metadata.set(id, value);
      }
      const cached = id && metadata.get(id);
      const durationMs = id && validSourceMetadata(cached, id, track) ? cached.durationMs : null;
      if (id && (!group.sources.has(id) || durationMs)) group.sources.set(id, { spotifyId: id, durationMs,
        metadataFetchedAt: durationMs ? cached.fetchedAt || null : null });
      group.occurrences.push({ playlistId: playlist.id, playlist: playlist.name, n: track.n,
        artist: track.artist, name: track.name, spotifyId: id, durationMs,
        metadataFetchedAt: durationMs ? cached.fetchedAt || null : null });
      groups.set(key, group);
    }
  }
  const candidates = [...groups.values()].filter(g => g.sources.size > 1 || g.names.size > 1).map(group => {
    const sources = [...group.sources.values()];
    const durations = sources.filter(s => s.durationMs).map(s => s.durationMs);
    const lower = Math.max(...durations.map(ms => ms / 1000 - durationMatch(ms, undefined).toleranceSeconds));
    const upper = Math.min(...durations.map(ms => ms / 1000 + durationMatch(ms, undefined).toleranceSeconds));
    return { key: group.key, names: [...group.names], sources, occurrences: group.occurrences,
      disjointDurationWindows: durations.length > 1 && lower > upper };
  });
  return { version: 1, capturedAt: new Date().toISOString(),
    scope: 'Saved playlist membership and exact-ID/name/artist-validated local metadata only. Different Spotify IDs alone do not prove different recordings. Unknown durations remain unknown.',
    counts: { playlists, occurrences, filenameKeys: groups.size, spotifyTrackIds: sourceIds.size,
      multipleSpotifyIds: candidates.filter(g => g.sources.length > 1).length,
      distinctArtistTitleSpellings: candidates.filter(g => g.names.length > 1).length,
      multipleIdsWithAtLeastTwoVerifiedDurations: candidates.filter(g => g.sources.filter(s => s.durationMs).length > 1).length,
      disjointDurationGroups: candidates.filter(g => g.disjointDurationWindows).length }, groups: candidates };
}

export function probeDuration(path, executable) {
  const result = spawnSync(executable, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path],
    { encoding: 'utf8', timeout: 10000, maxBuffer: 65536 });
  if (result.error || result.status !== 0) return null;
  try {
    const value = Number(JSON.parse(result.stdout).format?.duration);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch { return null; }
}

export function inspectConflictingFiles(report, downloadsPath, probe) {
  const conflicts = report.groups.filter(g => g.disjointDurationWindows);
  const keys = new Set(conflicts.map(g => g.key));
  const files = new Map(), probes = new Map();
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.spooty-download-batch-')) walk(path);
      else if (entry.isFile() && /\.mp3$/i.test(entry.name)) {
        const key = basename(entry.name).slice(0, -4).toLowerCase();
        if (!keys.has(key)) continue;
        const stat = statSync(path);
        if (!stat.size) continue;
        const inode = `${stat.dev}:${stat.ino}`;
        if (!probes.has(inode)) probes.set(inode, probe(path));
        const rows = files.get(key) || [];
        rows.push({ path, inode, bytes: stat.size, seconds: probes.get(inode) });
        files.set(key, rows);
      }
    }
  };
  walk(downloadsPath);
  const counts = { occurrences: 0, localMatch: 0, localMismatch: 0, localUnknown: 0,
    compatibleElsewhere: 0, incompatibleElsewhere: 0, unknownElsewhere: 0, noFile: 0, uniqueInodesProbed: probes.size };
  for (const group of conflicts) {
    group.files = files.get(group.key) || [];
    for (const row of group.occurrences) {
      const destination = join(folder(downloadsPath, row.playlist), fileBase(row.artist, row.name) + '.mp3');
      const local = group.files.find(file => file.path === destination);
      const compatible = group.files.filter(file => durationMatch(row.durationMs, file.seconds).ok);
      const unknown = !row.durationMs || group.files.some(file => !file.seconds);
      const verdict = local ? (!row.durationMs || !local.seconds ? 'localUnknown'
        : durationMatch(row.durationMs, local.seconds).ok ? 'localMatch' : 'localMismatch')
        : !group.files.length ? 'noFile' : compatible.length ? 'compatibleElsewhere'
          : unknown ? 'unknownElsewhere' : 'incompatibleElsewhere';
      row.fileEvidence = { verdict, destination, actualSeconds: local?.seconds ?? null,
        compatiblePaths: compatible.map(file => file.path) };
      counts.occurrences++;
      counts[verdict]++;
    }
  }
  return { ...report, fileScope: 'MP3s under the selected download root, excluding unpublished staging and symlink traversal. Only disjoint-duration groups are probed. No files are deleted, moved, tagged or queued.',
    downloadsPath, fileCounts: counts };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2), values = {};
    if (args.length === 1 && args[0] === '--help') {
      console.log('Read-only saved-catalog identity audit. No Spotify/Chrome requests or media/queue changes.\nUsage: node scripts/ux/track-identity-audit.mjs --playlists PATH --metadata PATH --downloads PATH [--ffprobe PATH]\nOutputs JSON to stdout. Run with Node20; ffprobe defaults to /opt/homebrew/bin/ffprobe.');
      process.exit(0);
    }
    for (let i = 0; i < args.length; i += 2) {
      if (!['--playlists', '--metadata', '--downloads', '--ffprobe'].includes(args[i]) || values[args[i]] || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Invalid audit arguments');
      values[args[i]] = resolve(args[i + 1]);
    }
    if (!values['--playlists'] || !values['--metadata'] || !values['--downloads']) throw new Error('Required: --playlists PATH --metadata PATH --downloads PATH [--ffprobe PATH]');
    const report = collectIdentityEvidence(values['--playlists'], values['--metadata']);
    console.log(JSON.stringify(inspectConflictingFiles(report, values['--downloads'],
      path => probeDuration(path, values['--ffprobe'] || '/opt/homebrew/bin/ffprobe')), null, 2));
  } catch {
    console.error('Read-only identity audit failed. Check its input paths and arguments; no media or queue changes were requested.');
    process.exitCode = 1;
  }
}
