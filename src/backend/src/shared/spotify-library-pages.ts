import { normalizePlaylistOwner, PlaylistOwner } from './spotify-playlist-owner';

export type SpotifyLibraryPlaylist = {
  id: string;
  uri: string;
  name: string;
  snapshotId?: string;
  trackCount?: number;
  coverUrl?: string | null;
  owner?: PlaylistOwner | null;
};

function record(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function incomplete(reason: string): never {
  // Recognised as an incomplete library discovery, not an empty successful sync.
  throw new Error(`Spotify library discovery incomplete: ${reason}. Saved library kept.`);
}

/** Collect before publishing anything. Spotify's paging contract supplies
 * items, total, offset, limit and an explicit null terminal next pointer.
 * No profile requests and no browser connection are made by this collector. */
export async function collectSpotifyLibrary(
  fetchPage: (url: string) => Promise<unknown>,
): Promise<SpotifyLibraryPlaylist[]> {
  const playlists: SpotifyLibraryPlaylist[] = [];
  const ids = new Set<string>();
  let total: number | undefined;
  let next: string | null = 'https://api.spotify.com/v1/me/playlists?limit=50&offset=0';

  for (let page = 0; next && page < 100; page++) {
    let url: URL;
    try { url = new URL(next); } catch { incomplete('invalid page URL'); }
    if (url.origin !== 'https://api.spotify.com' || url.pathname !== '/v1/me/playlists' ||
        url.username || url.password || url.hash) incomplete('unexpected page URL');
    const offsetText = url.searchParams.get('offset') ?? '0';
    const limitText = url.searchParams.get('limit') ?? '20';
    if (url.searchParams.getAll('offset').length > 1 || url.searchParams.getAll('limit').length > 1 ||
        !/^\d+$/.test(offsetText) || !/^\d+$/.test(limitText)) incomplete('invalid pagination');
    const offset = Number(offsetText);
    const limit = Number(limitText);
    if (offset !== playlists.length || limit < 1 || limit > 50) incomplete('page gap or repeated page');

    const body = await fetchPage(url.toString());
    if (!record(body) || !Array.isArray(body.items) || !count(body.total) ||
        body.offset !== offset || body.limit !== limit || body.items.length > limit ||
        !(body.next === null || (typeof body.next === 'string' && body.next.length > 0))) {
      incomplete('missing or invalid page data');
    }
    if (total !== undefined && total !== body.total) incomplete('library changed during pagination');
    total = body.total;

    for (const item of body.items) {
      if (!record(item) || typeof item.id !== 'string' || !/^[A-Za-z0-9]{22}$/.test(item.id) ||
          typeof item.name !== 'string' || (item.uri != null && item.uri !== `spotify:playlist:${item.id}`)) {
        incomplete('unrecognised playlist row');
      }
      if (ids.has(item.id)) incomplete('playlist repeated during pagination');
      ids.add(item.id);
      const trackCount = item.items?.total ?? item.tracks?.total;
      playlists.push({
        id: item.id,
        uri: `spotify:playlist:${item.id}`,
        name: item.name.trim() ? item.name : 'Untitled playlist',
        snapshotId: typeof item.snapshot_id === 'string' && item.snapshot_id ? item.snapshot_id : undefined,
        trackCount: count(trackCount) ? trackCount : undefined,
        coverUrl: Array.isArray(item.images) && typeof item.images[0]?.url === 'string' ? item.images[0].url : null,
        owner: normalizePlaylistOwner(item.owner),
      });
    }
    if (playlists.length > total || (body.next === null && playlists.length !== total) ||
        (body.next !== null && (!body.items.length || playlists.length >= total))) {
      incomplete('page count does not match the reported library total');
    }
    next = body.next;
  }
  if (next) incomplete('pagination exceeded 100 pages');
  return playlists;
}
