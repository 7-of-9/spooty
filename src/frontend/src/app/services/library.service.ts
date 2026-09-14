import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { LibraryDetail, LibraryListResponse } from '../models/library-playlist';

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

export interface YoutubePaceSnapshot {
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

  selectProvenProfile(): Observable<YoutubePaceSnapshot> {
    return this.http.post<YoutubePaceSnapshot>(
      '/api/youtube/profile/cli-proven',
      {},
    );
  }

  fetch(): Observable<LibraryListResponse> {
    return this.http
      .get<LibraryListResponse>('/api/library')
      .pipe(tap((data) => this.subject.next(data)));
  }

  download(
    uris: string[],
    options: AcquisitionOptions = {},
  ): Observable<{ queued: number; skipped: number }> {
    return this.http.post<{ queued: number; skipped: number }>(
      '/api/library/download',
      { uris, ...options },
    );
  }

  detail(id: string): Observable<LibraryDetail> {
    return this.http.get<LibraryDetail>(
      `/api/library/detail/${encodeURIComponent(id)}`,
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

  resyncAll(): Observable<{ started: boolean; already?: boolean }> {
    return this.http.post<{ started: boolean; already?: boolean }>(
      '/api/library/resync-all',
      {},
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
  ): Observable<{ queued: number; skipped: number }> {
    return this.http.post<{ queued: number; skipped: number }>(
      '/api/library/download-remaining',
      options,
    );
  }

  syncLibrary(): Observable<{ started: boolean; already?: boolean }> {
    return this.http.post<{ started: boolean; already?: boolean }>(
      '/api/library/sync',
      {},
    );
  }

  youtubePace(): Observable<YoutubePaceSnapshot> {
    return this.http.get<YoutubePaceSnapshot>('/api/youtube/pace');
  }

  syncLibraryStatus(): Observable<{
    running: boolean;
    done: number;
    total: number;
    discovered: number;
    changed: number;
    errors: string[];
    current: string;
    startedAt: string | null;
    finishedAt: string | null;
  }> {
    return this.http.get<{
      running: boolean;
      done: number;
      total: number;
      discovered: number;
      changed: number;
      errors: string[];
      current: string;
      startedAt: string | null;
      finishedAt: string | null;
    }>('/api/library/sync');
  }
}
