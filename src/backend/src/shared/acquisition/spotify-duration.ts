import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  chmodSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spotifyArtistCreditsMatch } from '../spotify-artist-credits';

export const positiveDurationMs = (value) =>
  Number.isSafeInteger(value) && value > 0;
const normalize = (value) =>
  typeof value === 'string'
    ? value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
    : '';
export function validSourceMetadata(value, spotifyId, song) {
  return (
    value?.version === 1 &&
    value.spotifyId === spotifyId &&
    /^[A-Za-z0-9]{22}$/.test(spotifyId) &&
    positiveDurationMs(value.durationMs) &&
    !!normalize(song.name) &&
    !!normalize(song.artist) &&
    normalize(value.name) === normalize(song.name) &&
    spotifyArtistCreditsMatch(song.artist, value.artist)
  );
}

export function cachedSourceDuration(cachePath: string, id: string | null, song: any): number | null {
  if (positiveDurationMs(song.durationMs)) return song.durationMs;
  if (!id) return null;
  try {
    const row = JSON.parse(readFileSync(join(cachePath, `${id}.json`), 'utf8'));
    return validSourceMetadata(row, id, song) ? row.durationMs : null;
  } catch { return null; }
}

export function createDurationResolver(cachePath, fetchMetadata) {
  const pending = new Map<any, any>();
  return async function resolveDuration(song) {
    if (song.durationConflict)
      throw new Error('Spotify source durations conflict');
    const knownDuration = positiveDurationMs(song.durationMs);
    const ids = [...new Set<string>(song.spotifyIds || [])].filter((id) =>
      /^[A-Za-z0-9]{22}$/.test(id),
    );
    if (ids.length > 1) throw new Error('Spotify source identity is ambiguous');
    if (!ids.length && knownDuration) return song.durationMs;
    if (!ids.length) throw new Error('Spotify source duration unavailable');
    for (const id of ids) {
      const path = join(cachePath, `${id}.json`);
      let metadata;
      try {
        metadata = JSON.parse(readFileSync(path, 'utf8'));
      } catch {}
      // Album context is useful, but never fetch Spotify solely to enrich an
      // already known duration. Only trust exact-ID/identity/duration cache hits.
      if (knownDuration) {
        if (
          validSourceMetadata(metadata, id, song) &&
          metadata.durationMs === song.durationMs
        ) {
          song.album =
            typeof metadata.album === 'string'
              ? metadata.album.slice(0, 500)
              : undefined;
          return song.durationMs;
        }
        continue;
      }
      if (!validSourceMetadata(metadata, id, song)) {
        if (!pending.has(id))
          pending.set(
            id,
            fetchMetadata(id).finally(() => pending.delete(id)),
          );
        try {
          metadata = await pending.get(id);
        } catch {
          continue;
        }
        if (!validSourceMetadata(metadata, id, song)) continue;
        mkdirSync(cachePath, { recursive: true, mode: 0o700 });
        chmodSync(cachePath, 0o700);
        // Store only allowlisted public metadata, not a Spotify API document.
        const safe = {
          version: 1,
          spotifyId: id,
          name: metadata.name,
          artist: metadata.artist,
          durationMs: metadata.durationMs,
          album: metadata.album,
          fetchedAt: metadata.fetchedAt,
        };
        const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
        try {
          writeFileSync(temp, JSON.stringify(safe) + '\n', {
            mode: 0o600,
            flag: 'wx',
          });
          renameSync(temp, path);
        } finally {
          rmSync(temp, { force: true });
        }
      }
      song.durationMs = metadata.durationMs;
      song.album =
        typeof metadata.album === 'string'
          ? metadata.album.slice(0, 500)
          : undefined;
      song.durationSpotifyId = id;
      return song.durationMs;
    }
    if (knownDuration) return song.durationMs;
    throw new Error('Spotify source duration unavailable');
  };
}
