import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import {
  LibraryDetail,
  LibraryListResponse,
  SearchEvidence,
} from '../models/library-playlist';
import type { SpotifySyncStatus } from '../components/library-panel/spotify-sync-state';
import type { SpotifyConnection } from '../models/spotify-connection';

export interface AcquisitionSnapshot {
  at: string;
  phase?: 'running' | 'waiting-for-recovery' | 'draining';
  verifiedNewMp3: number;
  remainingUnique: number;
  diskGB: number;
  mp3PerMinute: number;
  baselineMultiple: number;
  currentProfileMp3PerMinute?: number | null;
  currentProfileBaselineMultiple?: number | null;
  elapsedMinutes: number;
  contentReviewPendingUnique: number | null;
  held: boolean;
  maxSearches?: number | null;
  networkRetryLimit?: number | null;
  networkRetries?: number | null;
  operationRetries?: number | null;
  candidateDisqualifications?: number | null;
  noAcceptableCandidate?: number | null;
  eta: {
    continuous: string | null;
    buffered25: string | null;
    rateUsedPerMinute?: number | null;
    provisional?: boolean;
  };
  pace: Pick<
    YoutubePaceSnapshot,
    | 'searchConc'
    | 'downloadConc'
    | 'searchActive'
    | 'downloadActive'
    | 'maxPerWindow'
    | 'downloadsInWindow'
    | 'windowMs'
    | 'coolRemainingMs'
  >;
}

export interface AcquisitionOptions {
  retryErrors?: boolean;
  retryMissing?: boolean;
  retryNoCandidate?: boolean;
  maxSearches?: number;
  networkRetries?: number;
}

export interface DownloadReceipt {
  queued: number;
  skipped: number;
  /** Subset of skipped entries materialized from existing local MP3s. */
  reused?: number;
}

export interface DownloadRequestStatus {
  requestId: string;
  state: 'preparing' | 'completed' | 'interrupted' | 'failed';
  startedAt: number;
  finishedAt: number | null;
  destination: string;
  receipt: DownloadReceipt | null;
}

export interface DownloadLocation {
  path: string;
  source: 'saved' | 'environment';
}

export interface YoutubePaceSnapshot {
  webAdmission?: {
    running: boolean;
    startedAt: number | null;
    done: number;
    total: number | null;
    phase: 'checking' | 'verifying' | 'copying' | 'queueing';
    playlist: string;
    artist: string;
    name: string;
  };
  configurationError?: string | null;
  webActivity?: {
    active: Array<{
      id: number;
      artist: string;
      name: string;
      playlistName?: string;
      phase: string;
      startedAt: number;
      percent?: number;
    }>;
    recent: Array<{ at: number; artist: string; name: string; result: string }>;
    totals: { downloaded: number; reused: number; checked: number };
    nextRetryAt: number | null;
    since: number;
  } | null;
  webQueues?: {
    search: { paused: boolean; active: number; queued?: number };
    download: { paused: boolean; active: number; queued?: number };
  } | null;
  searchConc: number;
  downloadConc: number;
  searchActive: number;
  downloadActive: number;
  maxPerWindow: number;
  downloadsInWindow: number;
  windowMs: number;
  coolRemainingMs: number;
  autoStep: boolean;
  reason: string | null;
  acquisition?: AcquisitionSnapshot | null;
  acquisitionOwner?: {
    state: 'owned' | 'available' | 'unknown';
    phase: 'running' | 'waiting-for-recovery' | 'draining' | 'unknown' | null;
    telemetryFresh: boolean;
  };
  webProfileMode?: 'cli-proven' | 'custom';
  knownGoodProfile?: {
    id: string;
    downloadConc: number;
    searchConc: number;
    maxPerWindow: number;
    windowMs: number;
    batchSize: number;
    searchBuffer: number;
    maxSearches?: number;
    networkRetries?: number;
    downloadClient: string;
    searchClient: string;
    measuredMp3PerMinute: number;
    baselineMp3PerMinute: number;
    measuredWindowMinutes: number;
    measuredAt: string;
    evidence: string;
    webBenchmark: string;
    historicalBenchmark?: {
      measuredMp3PerMinute: number;
      maxPerWindow: number;
      measuredWindowMinutes: number;
      durationGuard: boolean;
    };
  };
}

@Injectable({ providedIn: 'root' })
export class LibraryService {
  private readonly subject = new BehaviorSubject<LibraryListResponse | null>(
    null,
  );
  readonly data$ = this.subject.asObservable();

  constructor(private readonly http: HttpClient) {}

  searchEvidence(
    artist: string,
    name: string,
    spotifyUrl?: string,
  ): Observable<{ report: SearchEvidence | null }> {
    return this.http.get<{ report: SearchEvidence | null }>(
      '/api/track/search-evidence',
      { params: { artist, name, ...(spotifyUrl ? { spotifyUrl } : {}) } },
    );
  }

  downloadLocation(): Observable<DownloadLocation> {
    return this.http.get<DownloadLocation>('/api/settings/download-location');
  }

  saveDownloadLocation(path: string): Observable<DownloadLocation> {
    return this.http.post<DownloadLocation>('/api/settings/download-location', {
      path,
    });
  }

  selectProvenProfile(): Observable<YoutubePaceSnapshot> {
    return this.http.post<YoutubePaceSnapshot>(
      '/api/youtube/profile/cli-proven',
      {},
    );
  }

  resumeWebQueues(): Observable<YoutubePaceSnapshot> {
    return this.http.post<YoutubePaceSnapshot>('/api/youtube/queues/resume', {
      scope: 'all-web-queues',
    });
  }

  fetch(scanId?: string, refresh = false): Observable<LibraryListResponse> {
    return this.http
      .get<LibraryListResponse>(`/api/library/view${scanId ? '?scan=' + encodeURIComponent(scanId) : refresh ? '?refresh=1' : ''}`)
      .pipe(tap((data) => this.subject.next(data)));
  }

  download(
    uris: string[],
    options: AcquisitionOptions = {},
    requestId?: string,
  ): Observable<DownloadReceipt> {
    if (requestId) return this.http.post<DownloadReceipt>('/api/library/download', { uris, ...options }, {
      headers: { 'X-Spooty-Request-Id': requestId },
    });
    return this.http.post<DownloadReceipt>(
      '/api/library/download',
      { uris, ...options },
    );
  }

  detail(id: string, scanId?: string): Observable<LibraryDetail> {
    return this.http.get<LibraryDetail>(
      scanId ? `/api/library/view/detail/${encodeURIComponent(id)}?scan=${encodeURIComponent(scanId)}`
        : `/api/library/detail/${encodeURIComponent(id)}`,
    );
  }

  resync(id: string): Observable<{
    id: string;
    name: string;
    before: number;
    after: number;
  }> {
    return this.http.post<{
      id: string;
      name: string;
      before: number;
      after: number;
    }>(`/api/library/resync/${encodeURIComponent(id)}`, {});
  }

  resyncAll(): Observable<{ started: boolean; already?: boolean; operationId?: string }> {
    return this.http.post<{ started: boolean; already?: boolean; operationId?: string }>(
      '/api/library/resync-all',
      {},
    );
  }

  syncPlaylist(id: string): Observable<{ started: boolean; already?: boolean; operationId?: string }> {
    return this.http.post<{ started: boolean; already?: boolean; operationId?: string }>(
      `/api/library/sync/playlist/${encodeURIComponent(id)}`, {},
    );
  }

  resyncAllStatus(): Observable<{
    running: boolean;
    done: number;
    total: number;
    updated: number;
    errors: string[];
    current: string;
    startedAt: string | null;
    finishedAt: string | null;
  }> {
    return this.http.get<{
      running: boolean;
      done: number;
      total: number;
      updated: number;
      errors: string[];
      current: string;
      startedAt: string | null;
      finishedAt: string | null;
    }>('/api/library/resync-all');
  }

  downloadRemaining(
    options: AcquisitionOptions = {},
    requestId?: string,
  ): Observable<DownloadReceipt> {
    if (requestId) return this.http.post<DownloadReceipt>('/api/library/download-remaining', options, {
      headers: { 'X-Spooty-Request-Id': requestId },
    });
    return this.http.post<DownloadReceipt>(
      '/api/library/download-remaining',
      options,
    );
  }

  downloadRequestStatus(requestId: string): Observable<DownloadRequestStatus> {
    return this.http.get<DownloadRequestStatus>(`/api/library/download-requests/${encodeURIComponent(requestId)}`);
  }

  syncLibrary(): Observable<{ started: boolean; already?: boolean; operationId?: string }> {
    return this.http.post<{ started: boolean; already?: boolean; operationId?: string }>(
      '/api/library/sync',
      {},
    );
  }

  spotifyConnection(): Observable<SpotifyConnection> {
    return this.http.get<SpotifyConnection>('/api/library/spotify-connection');
  }

  connectSpotifyChrome(): Observable<SpotifyConnection> {
    return this.http.post<SpotifyConnection>('/api/library/spotify-connection', {
      confirm: 'allow-one-chrome-connection',
    });
  }

  youtubePace(): Observable<YoutubePaceSnapshot> {
    return this.http.get<YoutubePaceSnapshot>('/api/youtube/pace');
  }

  syncLibraryStatus(): Observable<SpotifySyncStatus> {
    return this.http.get<SpotifySyncStatus>('/api/library/sync');
  }
}
