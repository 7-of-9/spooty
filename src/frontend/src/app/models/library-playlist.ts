export interface PlaylistOwner {
  id: string | null;
  displayName: string | null;
  spotifyUrl: string | null;
  source: 'spotify-api' | 'saved-subtitle';
}

export interface LibraryPlaylist {
  coveragePending?: number;
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
  owner?: PlaylistOwner | null;
  personalizedFor?: string | null;
  membershipVerified?: boolean;
  excludedItems?: number;
  libraryPresence?: { state: 'present' | 'not-returned'; checkedAt: string };
}

export interface LibraryListResponse {
  coverage?: CoverageProgress;
  playlists: LibraryPlaylist[];
  totals: {
    playlists: number;
    tracks: number;
    onDisk: number;
    available: number;
  };
}

export interface CoverageProgress {
  id: string;
  state: 'checking' | 'complete' | 'failed';
  checked: number;
  total: number;
  errors: number;
  destination: string;
  current: string;
  scope?: 'library' | 'changes';
  updates?: 'live' | 'manual';
}

export function validCoverageProgress(value: unknown): value is CoverageProgress {
  if (!value || typeof value !== 'object') return false;
  const row = value as CoverageProgress;
  return typeof row.id === 'string' && row.id.length > 0 &&
    ['checking', 'complete', 'failed'].includes(row.state) &&
    [row.checked, row.total, row.errors].every(n => Number.isInteger(n) && n >= 0) &&
    row.checked <= row.total && row.errors <= row.checked &&
    typeof row.destination === 'string' && !!row.destination && typeof row.current === 'string' &&
    (row.scope === undefined || ['library', 'changes'].includes(row.scope)) &&
    (row.updates === undefined || ['live', 'manual'].includes(row.updates)) &&
    (row.state !== 'complete' || (row.checked === row.total && row.errors === 0));
}

export interface LibraryTrack {
  sourceKey?: string;
  spotifyUrl?: string;
  durationMs?: number | null;
  mediaVerification?: 'duration-match' | 'unverified' | 'mismatch' | 'missing' | 'checking';
  searchEvidence?: SearchEvidence | null;
  searchEvidenceLoaded?: boolean;
  searchEvidenceLoading?: boolean;
  searchEvidenceError?: string;
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

export interface SearchEvidence {
  policy: string;
  finishedAt: string;
  expectedSeconds: number;
  toleranceSeconds: number;
  outcome: string;
  selectedUrl?: string | null;
  error?: string | null;
  uniqueCandidates: number;
  queries: Array<{
    query: string;
    candidates: Array<{
      videoId: string;
      title: string;
      url: string;
      durationSeconds: number | null;
      inspectedDurationSeconds?: number | null;
      reason: string;
      duplicate: boolean;
    }>;
  }>;
}

export interface LibraryDetail {
  coverage?: CoverageProgress;
  playlist: LibraryPlaylist;
  tracks: LibraryTrack[];
}
