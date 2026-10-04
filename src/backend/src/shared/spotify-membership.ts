import { createHash } from 'crypto';

/** Evidence about a fully collected API response, not a Spotify snapshot ID. */
export interface SpotifyMembership {
  version: 1;
  source: 'spotify-session';
  playlistId: string;
  itemCount: number;
  trackCount: number;
  excludedItemCount: number;
  orderedTrackIdsHash: string;
}

export function orderedTrackIdsHash(ids: string[]): string {
  return createHash('sha256').update(JSON.stringify(ids)).digest('hex');
}

export function completeSpotifyMembership(
  playlistId: string,
  itemCount: number,
  trackIds: string[],
): SpotifyMembership {
  return {
    version: 1, source: 'spotify-session', playlistId, itemCount,
    trackCount: trackIds.length,
    excludedItemCount: itemCount - trackIds.length,
    orderedTrackIdsHash: orderedTrackIdsHash(trackIds),
  };
}

export function hasCompleteSpotifyMembership(
  evidence: SpotifyMembership | undefined,
  playlistId: string,
  tracks: Array<{ id?: string; name?: string; artist?: string }>,
): boolean {
  return !!evidence && evidence.version === 1 && evidence.source === 'spotify-session' &&
    evidence.playlistId === playlistId && Number.isSafeInteger(evidence.itemCount) &&
    Number.isSafeInteger(evidence.excludedItemCount) && evidence.excludedItemCount >= 0 &&
    evidence.trackCount === tracks.length &&
    evidence.itemCount === evidence.trackCount + evidence.excludedItemCount &&
    tracks.every(track => /^[A-Za-z0-9]{22}$/.test(track.id || '') && !!track.name && !!track.artist) &&
    evidence.orderedTrackIdsHash === orderedTrackIdsHash(tracks.map(track => track.id!));
}
