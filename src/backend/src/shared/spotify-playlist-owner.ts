export interface PlaylistOwner {
  id: string | null;
  displayName: string | null;
  spotifyUrl: string | null;
  source: 'spotify-api' | 'saved-subtitle';
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Retain public attribution only, never the rest of a Spotify user object. */
export function normalizePlaylistOwner(value: unknown): PlaylistOwner | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, any>;
  const id = text(raw.id);
  const displayName = text(raw.displayName) || text(raw.display_name);
  if (!id && !displayName) return null;
  const source =
    raw.source === 'saved-subtitle' ? 'saved-subtitle' : 'spotify-api';
  let spotifyUrl: string | null = null;
  const suppliedUrl = text(raw.spotifyUrl) || text(raw.external_urls?.spotify);
  if (suppliedUrl && source === 'spotify-api') {
    try {
      const url = new URL(suppliedUrl);
      if (
        url.origin === 'https://open.spotify.com' &&
        !url.username &&
        !url.password &&
        /^\/user\/[^/]+\/?$/.test(url.pathname)
      ) {
        spotifyUrl = `${url.origin}${url.pathname}`;
      }
    } catch {
      /* An invalid profile URL must not prevent library loading. */
    }
  }
  if (!spotifyUrl && id && source === 'spotify-api') {
    spotifyUrl = `https://open.spotify.com/user/${encodeURIComponent(id)}`;
  }
  return { id, displayName, spotifyUrl, source };
}

/** Old dumps contain library subtitles, not structured owner records. */
export function playlistAttribution(raw: {
  owner?: unknown;
  subtitle?: unknown;
}): {
  owner: PlaylistOwner | null;
  personalizedFor: string | null;
} {
  const label = text(raw.subtitle)
    ?.match(/^Playlist\s*[•·]\s*(.+)$/i)?.[1]
    ?.trim();
  const personalizedFor =
    label?.match(/^Made for\s+(.+)$/i)?.[1]?.trim() || null;
  const owner =
    normalizePlaylistOwner(raw.owner) ||
    (label && !personalizedFor
      ? {
          id: null,
          displayName: label,
          spotifyUrl: null,
          source: 'saved-subtitle' as const,
        }
      : null);
  return { owner, personalizedFor };
}
