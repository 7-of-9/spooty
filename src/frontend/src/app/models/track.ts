export interface Track {
  id: number;
  artist: string;
  name: string;
  spotifyUrl: string;
  youtubeUrl: string;
  status: TrackStatusEnum;
  playlistId?: number;
  error?: string;
  coverUrl?: string;
  acquisitionState?: 'no-candidate' | 'missing' | 'retry' | 'failed' | null;
  retryAt?: number | null;
  searchLimit?: number | null;
  networkAttempts?: number | null;
  operationAttempts?: number | null;
}

export enum TrackStatusEnum {
  New,
  Searching,
  Queued,
  Downloading,
  Completed,
  Error,
  RetryWaiting,
}
