/** Public Spotify identity only. Safe to share with the browser bundle. */
export function spotifySourceId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.match(/^(?:(?:https:\/\/open\.spotify\.com\/(?:intl-[^/]+\/)?track\/)|spotify:track:)?([A-Za-z0-9]{22})(?:[?#].*)?$/)?.[1] || null;
}

export function trackSourceId(track: {
  id?: unknown; spotifyUrl?: string; href?: string; spotifyIds?: string[];
}): string | null {
  // Database numeric IDs are not Spotify IDs. A source-specific URL wins over
  // legacy grouped IDs, which must never silently choose their first edition.
  const direct = spotifySourceId(track.spotifyUrl) || spotifySourceId(track.href) || spotifySourceId(track.id);
  if (direct) return direct;
  const ids = [...new Set((track.spotifyIds || []).map(spotifySourceId).filter(Boolean))];
  return ids.length === 1 ? ids[0] : null;
}
