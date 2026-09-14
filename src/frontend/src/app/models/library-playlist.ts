export interface LibraryPlaylist {
  uri: string;
  id: string;
  name: string;
  rank: number;
  skipped: boolean;
  skipReason?: string;
  trackCount: number;
  onDisk: number;
  available: number;
  percentOnDisk: number;
  percentAvailable: number;
  file: string;
  spotifyUrl: string;
  failed?: number;
  done?: boolean;
  lastPlayedAt?: string | null;
  syncedAt?: string | null;
}

export interface LibraryListResponse {
  playlists: LibraryPlaylist[];
  totals: {
    playlists: number;
    tracks: number;
    onDisk: number;
    available: number;
  };
}

export interface LibraryTrack {
  n?: number;
  name: string;
  artist: string;
  onDisk: boolean;
  available: boolean;
  filename?: string;
  error?: string;
  missing?: boolean;
  acquisitionState?: 'no-candidate' | 'missing' | 'retry' | 'failed' | null;
  retryAt?: number | null;
  searchLimit?: number | null;
  networkAttempts?: number | null;
  operationAttempts?: number | null;
}

export interface LibraryDetail {
  playlist: LibraryPlaylist;
  tracks: LibraryTrack[];
}
