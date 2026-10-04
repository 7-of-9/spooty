import type { LibraryPlaylist } from '../../models/library-playlist';

export interface SpotifySyncStatus {
  running: boolean;
  done: number;
  total: number;
  discovered: number;
  changed: number;
  errors: string[];
  current: string;
  startedAt: string | null;
  finishedAt: string | null;
  operationId?: string | null;
  scope?: 'library' | 'playlist' | 'saved-playlists';
  playlistId?: string | null;
  playlistName?: string | null;
  result?: { id: string; name: string; before: number; after: number; removedFiles?: number } | null;
  failureKind?: 'connection' | 'rate-limit' | 'incomplete' | 'interrupted' | 'other' | null;
}

/** Absence is meaningful only in a dated, complete library observation. */
export function keptLocallyCheckedAt(playlist: Pick<LibraryPlaylist, 'libraryPresence'>): string | null {
  const presence = playlist.libraryPresence;
  return presence?.state === 'not-returned' && typeof presence.checkedAt === 'string' &&
    Number.isFinite(Date.parse(presence.checkedAt)) ? presence.checkedAt : null;
}

/** A historical dump timestamp is not evidence of a complete Spotify check. */
export function playlistFreshness(playlist: { membershipVerified?: boolean; syncedAt?: string | null }) {
  const at = playlist.syncedAt && Number.isFinite(Date.parse(playlist.syncedAt)) ? playlist.syncedAt : null;
  return {
    label: playlist.membershipVerified === true ? 'Checked with Spotify' : 'Saved locally',
    at,
    help: playlist.membershipVerified === true
      ? 'The saved track list was verified against a complete Spotify response. Sync this playlist to check for newer changes. Tracks removed on Spotify are removed from this playlist folder.'
      : 'This saved track list is not yet verified against a complete Spotify response. Use Sync this playlist to check it. Tracks removed on Spotify are removed from this playlist folder.',
  };
}

export function spotifySyncProblem(raw: string): string {
  if (/Spotify library discovery incomplete/i.test(raw))
    return 'Spotify did not return a complete playlist library. Your saved playlists and MP3s were kept. Use Sync Spotify library to check again.';
  if (/No new snapshot baseline was saved/i.test(raw))
    return 'The loaded track list could not be fully verified. A future sync will check it again. Existing MP3s are unchanged.';
  if (/sync request was not confirmed/i.test(raw))
    return 'This sync request was not confirmed. Your saved library is available. Use the sync button to start a new check.';
  if (/\b429\b|too many requests|rate.?limit/i.test(raw))
    return 'Spotify is limiting requests. Your saved library is still available. Try Sync Spotify library later.';
  if (/CDP|Chrome (?:bridge|connection)|browser connection|session.*unavailable|not connected/i.test(raw))
    return 'The Chrome connection for Spotify is unavailable. Your saved library is still available; no new Chrome permission request was opened.';
  if (/incomplete response|incomplete playlist|saved membership kept|membership.*not.*verified|Refusing to shrink/i.test(raw))
    return 'Spotify did not provide a consistent, complete track list. The previous list and MP3s were kept. Sync again to check for changes.';
  if (/interrupt|restart/i.test(raw))
    return 'Spotify sync was interrupted. Your saved library is still available. Sync again to continue.';
  return 'Spotify could not finish syncing. Your saved library is still available. See Activity details for the cause.';
}

export function playlistSyncResult(result: { name: string; before: number; after: number; removedFiles?: number }): { title: string; detail: string } {
  const count = result.after === result.before
    ? `${result.after} tracks checked`
    : `${result.before} → ${result.after} tracks`;
  const copies = result.removedFiles ?? 0;
  const files = copies > 0
    ? `Removed ${copies} local ${copies === 1 ? 'copy' : 'copies'} from this playlist folder.`
    : result.after < result.before
      ? 'This playlist folder now follows Spotify.'
      : 'MP3s unchanged.';
  return {
    title: 'Playlist updated from Spotify',
    detail: `${result.name} · ${count}. ${files}`,
  };
}

export function playlistEmptyMessage(playlist: { membershipVerified?: boolean; excludedItems?: number }): string {
  if (!playlist.membershipVerified) return 'No track list saved yet. Use Sync this playlist to load it from Spotify.';
  if (playlist.excludedItems) return 'This playlist contains only podcasts or local-only entries, which Spooty cannot download.';
  return 'This Spotify playlist is empty. Local copies of its former tracks were removed from this playlist folder.';
}

/** Reopening the dashboard is observation, not an instruction to repeat a
 * recently completed metadata operation and immediately hide its result. */
export function recentCompletedSync(status: SpotifySyncStatus, now = Date.now()): boolean {
  const finished = Date.parse(status.finishedAt || '');
  return !status.running && !!status.startedAt && Number.isFinite(finished) &&
    now >= finished && now - finished < 15 * 60 * 1000;
}

/** A lost acknowledgement must not turn an older completed operation into a
 * receipt for the user's new request. An observed running operation can be
 * followed regardless of which tab started it; the server has one sync lane. */
export function syncResultMatchesRequest(status: SpotifySyncStatus, request: {
  operationId: string | null; startedAt: number; responseLost: boolean;
}): boolean {
  if (status.running) return true;
  if (request.operationId) return status.operationId === request.operationId;
  if (!request.responseLost) return true; // Compatibility with an older server acknowledgement.
  const started = Date.parse(status.startedAt || '');
  return Number.isFinite(started) && started >= request.startedAt;
}

export function syncObservationKey(status: SpotifySyncStatus): string {
  return `${status.operationId || status.startedAt || ''}:${status.running}:${status.finishedAt || ''}`;
}

export function spotifySyncResult(status: SpotifySyncStatus): { title: string; detail: string } {
  if (status.errors.length) {
    return {
      title: 'Spotify sync incomplete',
      detail: spotifySyncProblem(status.errors.at(-1) || ''),
    };
  }
  if (!status.finishedAt) {
    return { title: 'Spotify sync interrupted', detail: spotifySyncProblem('interrupted') };
  }
  if (status.scope === 'playlist') {
    return status.result
      ? playlistSyncResult(status.result)
      : { title: 'Playlist sync interrupted', detail: spotifySyncProblem('interrupted') };
  }
  if (status.scope === 'saved-playlists') return {
    title: status.total ? 'Saved playlists synced' : 'No saved playlists to sync',
    detail: `${status.done}/${status.total} playlists checked · ${status.changed} changed. MP3s unchanged.`,
  };
  const changes = [
    `${status.done} playlists checked`,
    ...(status.discovered ? [`${status.discovered} new`] : []),
    ...(status.changed ? [`${status.changed} track lists refreshed`] : []),
  ];
  return {
    title: status.total ? 'Spotify library synced' : 'No Spotify playlists found',
    detail: status.total ? `${changes.join(' · ')}. MP3s unchanged.` : 'Your saved playlists and MP3s were kept.',
  };
}

export function spotifySyncProgress(status: SpotifySyncStatus): string {
  if (status.scope === 'playlist') return `Updating ${status.current || status.playlistName || 'playlist'} from Spotify…`;
  if (status.scope === 'saved-playlists') return `Checking saved playlists ${status.done}/${status.total}${status.current ? ' · ' + status.current : ''}`;
  return status.total > 0
    ? `Checking playlists ${status.done}/${status.total}${status.current ? ' · ' + status.current : ''}`
    : 'Getting your playlist library from Spotify…';
}
