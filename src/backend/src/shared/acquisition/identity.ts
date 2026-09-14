import { createHash } from 'node:crypto';

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
