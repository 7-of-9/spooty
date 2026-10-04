import { createHash } from 'node:crypto';
import { trackSourceId } from './source-id';
export { trackSourceId, spotifySourceId } from './source-id';

// Existing on-disk filenames and journal keys are a compatibility contract.
// Changing this normalization would orphan previously saved files/outcomes.
export const safe = (value: unknown): string => String(value || '').replace(/[/\\?%*:|"<>]/g, '-');

export function fileBase(artist: string, name: string): string {
  const full = safe(`${artist || 'unknown_artist'} - ${String(name || 'unknown_track').replace('/', '')}`);
  if (Buffer.byteLength(full, 'utf8') <= 251) return full;
  const suffix = '-' + createHash('sha256').update(full.toLowerCase()).digest('hex').slice(0, 12);
  let prefix = '';
  for (const char of full) {
    if (Buffer.byteLength(prefix + char, 'utf8') > 238) break;
    prefix += char;
  }
  return prefix + suffix;
}

export const songKey = (artist: string, name: string): string => fileBase(artist, name).toLowerCase();

export function sourceKey(track: any): string {
  const id = trackSourceId(track);
  return id ? `spotify:${id}` : songKey(track.artist, track.name);
}

/** New recordings cannot overwrite an older same-named edit. Old filenames
 * remain aliases, recognised after verification; no renaming or moving. */
export function sourceFileBase(track: any, version = 1): string {
  const id = trackSourceId(track);
  if (!id && version === 1) return fileBase(track.artist, track.name);
  const suffix = `${id ? ` [sp-${id}]` : ''}${version > 1 ? `-${version}` : ''}`;
  let prefix = '';
  for (const char of fileBase(track.artist, track.name)) {
    if (Buffer.byteLength(prefix + char + suffix, 'utf8') > 251) break;
    prefix += char;
  }
  return prefix + suffix;
}

/** Read-only migration: new source rows win, including a newer pending row.
 * Keep accepted legacy terminal outcomes parked without inheriting their URL
 * or claiming that a name-group result is source-specific evidence. Explicit
 * retries write a new source row; the legacy history is never deleted. */
export function sourceJournal(track: any, rows: Map<string, any>): any | null {
  const key = track.key || sourceKey(track);
  const exact = rows.get(key);
  if (exact) return exact;
  const legacyKey = songKey(track.artist, track.name);
  const legacy = rows.get(legacyKey);
  if (key === legacyKey || !legacy || !['missing', 'no-candidate', 'error', 'failed'].includes(legacy.state)) return null;
  return { ...legacy, key, url: null, legacyOutcome: true };
}
