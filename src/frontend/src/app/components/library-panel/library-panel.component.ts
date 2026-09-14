import {
  Component,
  ElementRef,
  HostListener,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LibraryService,
  AcquisitionOptions,
  YoutubePaceSnapshot,
} from '../../services/library.service';
import {
  LibraryDetail,
  LibraryListResponse,
  LibraryPlaylist,
  LibraryTrack,
} from '../../models/library-playlist';
import { PlaylistService } from '../../services/playlist.service';
import { TrackService } from '../../services/track.service';
import { Track, TrackStatusEnum } from '../../models/track';
import { Playlist } from '../../models/playlist';
import { combineLatest, map } from 'rxjs';

type LivePlaylistStats = {
  completed: number;
  failed: number;
  needsRetry: number;
  active: number;
  downloading: number;
  searching: number;
  queued: number;
  retrying: number;
  retryKeys?: Set<string>;
  failKeys?: Set<string>;
};

type LiveRipRow = Track & {
  percent: number;
  playlistName?: string;
};

type PlaylistView = {
  onDisk: number;
  failed: number;
  needsRetry: number;
  ripping: boolean;
  downloading: number;
  searching: number;
  queued: number;
  retrying: number;
  pending: number;
  copyable: number;
  active: number;
  percentOnDisk: number;
  percentAvailable: number;
  done: boolean;
  trackCount: number;
};

@Component({
  selector: 'app-library-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './library-panel.component.html',
  styleUrl: './library-panel.component.scss',
})
export class LibraryPanelComponent implements OnInit, OnDestroy {
  @ViewChild('plList') private plList?: ElementRef<HTMLElement>;
  @ViewChild('player') private player?: ElementRef<HTMLAudioElement>;
  @ViewChild('trackWrap') private trackWrap?: ElementRef<HTMLElement>;

  filter = '';
  hideComplete = false;
  listSort: 'activity' | 'played' | 'recents' | 'name' = 'activity';
  liveDownloading = 0;
  private lastResyncAt = new Map<string, number>();
  liveSearching = 0;
  liveQueued = 0;
  liveRetrying = 0;
  selected = new Set<string>();
  focused: LibraryPlaylist | null = null;
  detail: LibraryDetail | null = null;
  detailLoading = false;
  loading = false;
  enqueueing = false;
  resyncing = false;
  resyncAllRunning = false;
  resyncAllLabel = '';
  private resyncAllPoll: ReturnType<typeof setInterval> | null = null;
  syncingLibrary = false;
  librarySyncLabel = '';
  syncNotice = '';
  librarySyncDegraded = false;
  private librarySyncPoll: ReturnType<typeof setInterval> | null = null;
  private librarySyncQuiet = true;
  message = '';
  error = '';
  data: LibraryListResponse | null = null;
  queueOpen = false;
  audioUrl = '';
  playingId: string | null = null;
  playingN: number | null = null;
  playingLabel = '';
  paused = true;
  liveMap = new Map<string, Track & { percent: number }>();
  private liveByPlaylistKey = new Map<string, Track & { percent: number }>();
  liveStats = new Map<string, LivePlaylistStats>();
  private livePlaylists: Playlist[] = [];
  activeRips: LiveRipRow[] = [];
  statuses = TrackStatusEnum;
  diskTotal = 0;
  youtubePace: YoutubePaceSnapshot | null = null;
  selectingProvenProfile = false;
  maxSearches = 10;
  networkRetries = 5;

  get acquisitionOptionsValid(): boolean {
    return (
      Number.isInteger(this.maxSearches) &&
      this.maxSearches >= 1 &&
      this.maxSearches <= 50 &&
      Number.isInteger(this.networkRetries) &&
      this.networkRetries >= 0 &&
      this.networkRetries <= 20
    );
  }

  get ownerBlocksAcquisition(): boolean {
    return (
      !!this.youtubePace?.acquisition ||
      this.youtubePace?.acquisitionOwner?.state !== 'available'
    );
  }

  get acquisitionOwnerLabel(): string {
    const owner = this.youtubePace?.acquisitionOwner;
    if (owner?.state === 'available') return '';
    if (owner?.state === 'owned' || this.youtubePace?.acquisition) {
      if (owner?.phase === 'draining')
        return 'CLI owns YouTube — draining current work';
      if (owner?.phase === 'waiting-for-recovery')
        return 'CLI owns YouTube — waiting for recovery';
      if (!this.youtubePace?.acquisition)
        return 'CLI owns YouTube — live telemetry unavailable';
      return 'CLI owns YouTube';
    }
    return 'Checking YouTube ownership — web acquisition held';
  }

  get acquisitionGuardText(): string {
    if (this.ownerBlocksAcquisition) return this.acquisitionOwnerLabel;
    if (!this.liveQueueKnown) return 'Checking live queue…';
    if (this.hasQueuedWork)
      return 'Queue is live — bulk search/download waits.';
    if (!this.acquisitionOptionsValid)
      return 'Use 1–50 candidates and 0–20 additional network retries.';
    return '';
  }

  get canSelectProvenProfile(): boolean {
    const pace = this.youtubePace;
    return (
      !!pace &&
      !this.ownerBlocksAcquisition &&
      !this.selectingProvenProfile &&
      pace.webProfileMode === 'cli-proven' &&
      !pace.coolRemainingMs &&
      !(pace.downloadActive || pace.searchActive) &&
      !(
        pace.downloadConc <= 1 &&
        pace.searchConc <= 1 &&
        pace.maxPerWindow <= 8
      )
    );
  }

  selectProvenProfile(): void {
    if (!this.canSelectProvenProfile) return;
    this.selectingProvenProfile = true;
    this.libraryService.selectProvenProfile().subscribe({
      next: () => {
        this.selectingProvenProfile = false;
        this.message =
          'Retained profile selected; queues remain paused. No work was started.';
        this.pollYoutubePace();
      },
      error: (err) => {
        this.selectingProvenProfile = false;
        this.message =
          err?.error?.message ||
          'Profile not changed; verify ownership and paused queues.';
      },
    });
  }
  private coverageTimer: ReturnType<typeof setTimeout> | null = null;
  private scrollTimer: ReturnType<typeof setTimeout> | null = null;
  private focusedRowOffset = -1;
  private coverageInterval: ReturnType<typeof setInterval> | null = null;
  private readonly coverageWhileRunningMs = 60_000;
  private paceInterval: ReturnType<typeof setInterval> | null = null;
  private focusedResyncInterval: ReturnType<typeof setInterval> | null = null;
  private hadProcessing = false;
  private userSelectedPlaylist = false;
  private initialActivityFocusApplied = false;
  private liveSub: { unsubscribe(): void } | null = null;
  private readySub: { unsubscribe(): void } | null = null;
  private lastActiveReconcileAt = 0;
  private statsMemo = new Map<string, PlaylistView>();
  private liveApplyArgs: {
    tracks: Track[];
    progress: Record<number, number>;
    playlists: Playlist[];
  } | null = null;
  liveQueueKnown = false;
  queue$ = combineLatest([
    this.playlistService.all$,
    this.trackService.all$,
  ]).pipe(
    map(([playlists, tracks]) => {
      const activePlaylistIds = new Set(
        tracks
          .filter(
            (track) =>
              !this.isNoCandidate(track) &&
              [
                TrackStatusEnum.Searching,
                TrackStatusEnum.Queued,
                TrackStatusEnum.Downloading,
                TrackStatusEnum.RetryWaiting,
              ].includes(track.status),
          )
          .map(
            (track) =>
              track.playlistId ??
              (track as Track & { playlist?: { id?: number } }).playlist?.id,
          )
          .filter((id): id is number => id != null),
      );
      return playlists.filter(
        (playlist) => !playlist.isTrack && activePlaylistIds.has(playlist.id),
      );
    }),
  );

  constructor(
    private readonly libraryService: LibraryService,
    private readonly playlistService: PlaylistService,
    private readonly trackService: TrackService,
    private readonly ngZone: NgZone,
  ) {}

  ngOnInit(): void {
    if (this.trackService.activeReady$) {
      this.readySub = this.trackService.activeReady$.subscribe((ready) => {
        this.liveQueueKnown = ready;
      });
    } else {
      this.liveQueueKnown = true;
    }
    this.refresh();
    this.restoreOrStartLibrarySync();
    this.startPacePolling();
    this.focusedResyncInterval = setInterval(
      () => {
        if (this.focused) this.maybeResync(this.focused);
      },
      15 * 60 * 1000,
    );
    this.liveSub = combineLatest([
      this.trackService.all$,
      this.trackService.progress$,
      this.playlistService.all$,
    ]).subscribe(([tracks, progress, playlists]) => {
      this.ngZone.run(() => this.applyLiveStores(tracks, progress, playlists));
    });
  }

  private applyLiveStores(
    tracks: Track[],
    progress: Record<number, number>,
    playlists: Playlist[],
  ): void {
    this.liveApplyArgs = { tracks, progress, playlists };
    const searchCap = this.runningProcessCap(
      this.youtubePace?.searchActive,
      this.youtubePace?.searchConc,
    );
    const downloadCap = this.runningProcessCap(
      this.youtubePace?.downloadActive,
      this.youtubePace?.downloadConc,
    );
    const keepSearch = this.keepNewestRunning(
      tracks,
      TrackStatusEnum.Searching,
      searchCap,
    );
    const keepDownload = this.keepNewestRunning(
      tracks,
      TrackStatusEnum.Downloading,
      downloadCap,
    );
    const rawSearching = tracks.filter(
      (track) => track.status === TrackStatusEnum.Searching,
    ).length;
    const rawDownloading = tracks.filter(
      (track) => track.status === TrackStatusEnum.Downloading,
    ).length;
    const next = new Map<string, Track & { percent: number }>();
    const byPlaylistKey = new Map<string, Track & { percent: number }>();
    const active: Array<Track & { percent: number }> = [];
    const byPlaylist = new Map<number, LivePlaylistStats>();
    let liveDownloading = 0;
    let liveSearching = 0;
    let liveQueued = 0;
    let liveRetrying = 0;
    for (const track of tracks) {
      const nestedId = (track as Track & { playlist?: { id?: number } })
        .playlist?.id;
      const playlistId = track.playlistId ?? nestedId;
      const key = this.trackKey(track.artist, track.name);
      let status = track.status;
      if (
        this.isNoCandidate(track) &&
        status === TrackStatusEnum.RetryWaiting
      ) {
        status = TrackStatusEnum.Error;
      }
      if (
        status === TrackStatusEnum.RetryWaiting &&
        track.acquisitionState === 'retry' &&
        !(typeof track.retryAt === 'number' && track.retryAt > Date.now())
      ) {
        status =
          typeof track.retryAt === 'number'
            ? TrackStatusEnum.Queued
            : TrackStatusEnum.Error;
      }
      if (status === TrackStatusEnum.Searching && !keepSearch.has(track.id)) {
        status = TrackStatusEnum.Queued;
      } else if (
        status === TrackStatusEnum.Downloading &&
        !keepDownload.has(track.id)
      ) {
        status = TrackStatusEnum.Queued;
      }
      const row = { ...track, status, percent: progress[track.id] ?? 0 };
      const prev = next.get(key);
      if (
        !prev ||
        this.liveStatusRank(row.status) < this.liveStatusRank(prev.status)
      ) {
        next.set(key, row);
      }
      if (playlistId != null) byPlaylistKey.set(`${playlistId}|||${key}`, row);
      const live =
        status === TrackStatusEnum.Searching ||
        status === TrackStatusEnum.Queued ||
        status === TrackStatusEnum.Downloading ||
        status === TrackStatusEnum.RetryWaiting;
      if (live) active.push(row);
      if (status === TrackStatusEnum.Downloading) liveDownloading++;
      if (status === TrackStatusEnum.Searching) liveSearching++;
      if (status === TrackStatusEnum.Queued) liveQueued++;
      if (status === TrackStatusEnum.RetryWaiting) liveRetrying++;
      if (playlistId == null) continue;
      let stats = byPlaylist.get(playlistId);
      if (!stats) {
        stats = {
          completed: 0,
          failed: 0,
          needsRetry: 0,
          active: 0,
          downloading: 0,
          searching: 0,
          queued: 0,
          retrying: 0,
        };
        byPlaylist.set(playlistId, stats);
      }
      if (status === TrackStatusEnum.Completed) stats.completed++;
      else if (status === TrackStatusEnum.Error) {
        if (
          track.acquisitionState === 'missing' ||
          this.isPermanentMissing(track.error)
        ) {
          stats.failKeys ??= new Set();
          if (stats.failKeys.has(key)) continue;
          stats.failKeys.add(key);
          stats.failed++;
        } else {
          stats.retryKeys ??= new Set();
          if (stats.retryKeys.has(key)) continue;
          stats.retryKeys.add(key);
          stats.needsRetry++;
        }
      } else if (status === TrackStatusEnum.Downloading) {
        stats.active++;
        stats.downloading++;
      } else if (status === TrackStatusEnum.Searching) {
        stats.active++;
        stats.searching++;
      } else if (status === TrackStatusEnum.Queued) {
        stats.active++;
        stats.queued++;
      } else if (status === TrackStatusEnum.RetryWaiting) {
        stats.active++;
        stats.retrying++;
      }
    }
    const liveStats = new Map<string, LivePlaylistStats>();
    for (const playlist of playlists) {
      const stats = byPlaylist.get(playlist.id);
      if (!stats) continue;
      if (playlist.spotifyUrl) liveStats.set(playlist.spotifyUrl, stats);
      if (playlist.name) liveStats.set(playlist.name.toLowerCase(), stats);
    }
    const prevLive = this.liveMap;
    this.liveMap = next;
    this.liveByPlaylistKey = byPlaylistKey;
    this.liveStats = liveStats;
    this.livePlaylists = playlists;
    for (const playlist of playlists) {
      if (!playlist.isTrack && byPlaylist.has(playlist.id)) {
        this.trackService.hydrateErrors(playlist.id);
      }
    }
    this.liveDownloading = liveDownloading;
    this.liveSearching = liveSearching;
    this.liveQueued = liveQueued;
    this.liveRetrying = liveRetrying;
    this.clearStatsMemo();
    this.hydrateStalledErrors();
    if (this.focused && this.detail) {
      this.rememberDumpFailures(this.focused, this.detail);
    }
    if (
      (Number.isFinite(searchCap) && rawSearching > searchCap) ||
      (Number.isFinite(downloadCap) && rawDownloading > downloadCap) ||
      (this.youtubePace?.searchActive || 0) > liveSearching ||
      (this.youtubePace?.downloadActive || 0) > liveDownloading
    ) {
      this.scheduleActiveReconcile();
    }
    this.focusInitialActivity();
    const processesRunning = liveDownloading > 0 || liveSearching > 0;
    this.activeRips = active
      .filter(
        (t) =>
          t.status === TrackStatusEnum.Downloading ||
          t.status === TrackStatusEnum.Searching,
      )
      .sort((a, b) => {
        const rank = (status: TrackStatusEnum) =>
          status === TrackStatusEnum.Downloading ? 0 : 1;
        return rank(a.status) - rank(b.status);
      })
      .slice(0, 4)
      .map((track) => ({
        ...track,
        playlistName: this.libraryForLiveTrack(track)?.name,
      }));
    this.syncDetailFromLive();
    if (this.focusedHasNewRunningWork(prevLive, next)) {
      this.scheduleScrollActionable();
    }
    this.recomputeDiskTotal();
    const finishedWork = this.liveWorkFinished(prevLive, next);
    if (processesRunning && !this.coverageInterval) {
      this.coverageInterval = setInterval(
        () => this.refresh(true),
        this.coverageWhileRunningMs,
      );
    }
    if (!processesRunning && this.coverageInterval) {
      clearInterval(this.coverageInterval);
      this.coverageInterval = null;
    }
    if (finishedWork) this.scheduleCoverageRefresh(400);
    else if (this.hadProcessing && !processesRunning) {
      this.scheduleCoverageRefresh(800);
    }
    this.hadProcessing = processesRunning;
    if (this.hasQueuedWork) this.startPacePolling();
    this.keepFocusedRowVisible();
  }

  ngOnDestroy(): void {
    this.liveSub?.unsubscribe();
    this.readySub?.unsubscribe();
    if (this.coverageTimer) clearTimeout(this.coverageTimer);
    if (this.scrollTimer) clearTimeout(this.scrollTimer);
    if (this.coverageInterval) clearInterval(this.coverageInterval);
    this.stopPacePolling();
    if (this.focusedResyncInterval) clearInterval(this.focusedResyncInterval);
    if (this.resyncAllPoll) clearInterval(this.resyncAllPoll);
    if (this.librarySyncPoll) clearInterval(this.librarySyncPoll);
  }

  get visiblePlaylists(): LibraryPlaylist[] {
    const playlists = this.data?.playlists || [];
    const q = this.filter.trim().toLowerCase();
    const filtered = playlists.filter((p) => {
      if (
        this.hideComplete &&
        this.isDone(p) &&
        !p.failed &&
        !this.statsOf(p).ripping
      ) {
        return false;
      }
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
    return this.sortPlaylists(filtered);
  }

  get attentionPlaylists(): number {
    return (this.data?.playlists || []).filter((playlist) =>
      this.needsAttention(playlist),
    ).length;
  }

  get attentionTracks(): number {
    return (this.data?.playlists || []).reduce((total, playlist) => {
      if (playlist.skipped) return total;
      const stats = this.statsOf(playlist);
      return (
        total + Math.max(0, stats.trackCount - stats.onDisk - stats.failed)
      );
    }, 0);
  }

  attentionTracksLabel(): string {
    const unit = this.attentionTracks === 1 ? 'occurrence' : 'occurrences';
    if (this.hasQueuedWork) {
      return `${unit} remaining`;
    }
    return this.attentionTracks === 1
      ? 'occurrence needs action'
      : 'occurrences need action';
  }

  get hasQueuedWork(): boolean {
    return (
      this.liveDownloading +
        this.liveSearching +
        this.liveQueued +
        this.liveRetrying >
      0
    );
  }

  liveQueueMeta(queueLength: number): string {
    const waiting = this.impliedWaitingPlaylistCount;
    if (!waiting) {
      return queueLength === 1
        ? '1 playlist in queue'
        : `${this.fmt(queueLength)} playlists in queue`;
    }
    return `${this.fmt(queueLength)} live · ${this.fmt(waiting)} waiting`;
  }

  get impliedWaitingPlaylistCount(): number {
    if (!this.isLibraryPipelineLive() || !this.data) return 0;
    let n = 0;
    for (const playlist of this.data.playlists) {
      if (playlist.skipped) continue;
      const stats = this.statsOf(playlist);
      if (
        stats.pending > 0 &&
        stats.downloading + stats.searching + stats.queued + stats.retrying ===
          0
      ) {
        n++;
      }
    }
    return n;
  }

  get bulkActionsBlocked(): boolean {
    return (
      this.ownerBlocksAcquisition ||
      !this.acquisitionOptionsValid ||
      this.enqueueing ||
      this.hasQueuedWork ||
      !this.liveQueueKnown
    );
  }

  get showYoutubePace(): boolean {
    return (
      !!this.youtubePace?.acquisition ||
      this.hasQueuedWork ||
      (this.youtubePace?.coolRemainingMs || 0) > 0
    );
  }

  paceLine(): string {
    if (
      this.youtubePace?.acquisitionOwner?.state === 'owned' &&
      !this.youtubePace.acquisition
    ) {
      return this.acquisitionOwnerLabel;
    }
    const pace = this.youtubePace?.acquisition?.pace || this.youtubePace;
    if (!pace) return '';
    const minutes = Math.max(1, Math.round((pace.windowMs || 600000) / 60000));
    return `${this.youtubePace?.acquisition ? 'CLI' : 'YouTube'} ${pace.downloadConc}+${pace.searchConc} · ${pace.downloadsInWindow}/${pace.maxPerWindow} this ${minutes}m`;
  }

  isSafetyFloor(): boolean {
    const pace = this.youtubePace?.acquisition?.pace || this.youtubePace;
    if (!pace) return false;
    return (
      pace.downloadConc <= 1 && pace.searchConc <= 1 && pace.maxPerWindow <= 8
    );
  }

  paceNote(): string {
    if (
      this.youtubePace?.acquisitionOwner?.state === 'owned' &&
      !this.youtubePace.acquisition
    )
      return '';
    const pace = this.youtubePace?.acquisition?.pace || this.youtubePace;
    if (!pace) return '';
    const cooldown = this.cooldownLabel(pace.coolRemainingMs);
    const windowFull = pace.downloadsInWindow >= pace.maxPerWindow;
    const downloadRunning =
      (pace.downloadActive || 0) > 0 || this.liveDownloading > 0;
    if (this.isSafetyFloor()) {
      if (cooldown) return `Safety floor — cooldown ${cooldown}`;
      if (windowFull && !downloadRunning) {
        return 'Safety floor — downloads held';
      }
      if (windowFull) return 'Safety floor — window full';
      return 'Safety floor';
    }
    if (windowFull && !downloadRunning) return 'Window full — downloads held';
    if (windowFull) return 'Window full';
    return '';
  }

  private cooldownLabel(ms: number): string {
    if (!ms || ms <= 0) return '';
    const minutes = Math.max(1, Math.round(ms / 60000));
    return `${minutes}m`;
  }

  private startPacePolling(): void {
    if (this.paceInterval) return;
    this.pollYoutubePace();
    this.paceInterval = setInterval(() => this.pollYoutubePace(), 10000);
  }

  private stopPacePolling(): void {
    if (!this.paceInterval) return;
    clearInterval(this.paceInterval);
    this.paceInterval = null;
  }

  private pollYoutubePace(): void {
    this.libraryService.youtubePace().subscribe({
      next: (snap) => {
        this.youtubePace = snap;
        if (this.liveApplyArgs) {
          this.applyLiveStores(
            this.liveApplyArgs.tracks,
            this.liveApplyArgs.progress,
            this.liveApplyArgs.playlists,
          );
        }
        if (
          !this.hasQueuedWork &&
          !this.ownerBlocksAcquisition &&
          !(snap.coolRemainingMs > 0)
        ) {
          this.stopPacePolling();
        }
      },
      error: () => {
        if (this.youtubePace)
          this.youtubePace = {
            ...this.youtubePace,
            acquisition: null,
            acquisitionOwner: {
              state: 'unknown',
              phase: null,
              telemetryFresh: false,
            },
          };
      },
    });
  }

  @HostListener('document:visibilitychange')
  refreshPaceWhenVisible(): void {
    // Background Chrome tabs may suspend their timers for minutes. Refresh
    // immediately on return instead of presenting an old cooldown as live.
    if (document.visibilityState === 'visible') this.pollYoutubePace();
  }

  private runningProcessCap(
    active: number | undefined,
    conc: number | undefined,
  ): number {
    if (!this.youtubePace) return Number.POSITIVE_INFINITY;
    if ((this.youtubePace.coolRemainingMs || 0) > 0) {
      return Math.max(0, active || 0);
    }
    return Math.max(active || 0, conc || 0);
  }

  private keepNewestRunning(
    tracks: Track[],
    status: TrackStatusEnum,
    cap: number,
  ): Set<number> {
    const ids = tracks
      .filter((track) => track.status === status)
      .sort((a, b) => b.id - a.id)
      .map((track) => track.id);
    if (!Number.isFinite(cap)) return new Set(ids);
    return new Set(ids.slice(0, cap));
  }

  private scheduleActiveReconcile(): void {
    const now = Date.now();
    if (now - this.lastActiveReconcileAt < 4000) return;
    this.lastActiveReconcileAt = now;
    this.trackService.fetchActive?.();
  }

  private activityBucket(playlist: LibraryPlaylist): number {
    const s = this.statsOf(playlist);
    if (s.ripping) return 0;
    if (s.done) return 3;
    if (s.onDisk > 0 || s.failed > 0 || s.percentAvailable > 0) return 1;
    return 2;
  }

  private rippingRank(playlist: LibraryPlaylist): number {
    const s = this.statsOf(playlist);
    if (s.downloading > 0) return 0;
    if (s.searching > 0) return 1;
    if (s.queued > 0) return 2;
    if (s.retrying > 0) return 3;
    return 4;
  }

  private remainingCount(playlist: LibraryPlaylist): number {
    const s = this.statsOf(playlist);
    return Math.max(0, s.trackCount - s.onDisk - s.failed);
  }

  private sortPlaylists(playlists: LibraryPlaylist[]): LibraryPlaylist[] {
    const played = (p: LibraryPlaylist) => p.lastPlayedAt || '';
    return [...playlists].sort((a, b) => {
      if (this.listSort === 'name') return a.name.localeCompare(b.name);
      if (this.listSort === 'recents') return (a.rank || 0) - (b.rank || 0);
      if (this.listSort === 'played') {
        return (
          played(b).localeCompare(played(a)) || (a.rank || 0) - (b.rank || 0)
        );
      }
      const bucket = this.activityBucket(a) - this.activityBucket(b);
      if (bucket) return bucket;
      if (this.activityBucket(a) === 0) {
        const process = this.rippingRank(a) - this.rippingRank(b);
        if (process) return process;
        return (
          this.remainingCount(b) - this.remainingCount(a) ||
          (a.rank || 0) - (b.rank || 0)
        );
      }
      if (this.activityBucket(a) === 1 || this.activityBucket(a) === 2) {
        return (
          this.remainingCount(b) - this.remainingCount(a) ||
          (a.rank || 0) - (b.rank || 0)
        );
      }
      return (
        played(b).localeCompare(played(a)) || (a.rank || 0) - (b.rank || 0)
      );
    });
  }

  trackByUri(_index: number, playlist: LibraryPlaylist): string {
    return playlist.uri;
  }

  fmt(n: number): string {
    return n.toLocaleString('en-US');
  }

  toggleQueue(): void {
    this.queueOpen = !this.queueOpen;
  }

  libraryForQueue(playlist: Playlist): LibraryPlaylist | undefined {
    return (this.data?.playlists || []).find(
      (item) =>
        (!!playlist.spotifyUrl && item.spotifyUrl === playlist.spotifyUrl) ||
        (!!playlist.name && item.name === playlist.name),
    );
  }

  queueActivity(playlist: Playlist): string {
    const item = this.libraryForQueue(playlist);
    return item ? this.activitySummary(item) : '';
  }

  focusQueuePlaylist(playlist: Playlist): void {
    const item = this.libraryForQueue(playlist);
    this.queueOpen = false;
    if (item) this.focus(item, false);
  }

  private playlistForLiveTrack(track: Track): Playlist | undefined {
    const nestedId = (track as Track & { playlist?: { id?: number } }).playlist
      ?.id;
    const playlistId = track.playlistId ?? nestedId;
    if (playlistId == null) return undefined;
    return this.livePlaylists.find((playlist) => playlist.id === playlistId);
  }

  libraryForLiveTrack(track: Track): LibraryPlaylist | undefined {
    const db = this.playlistForLiveTrack(track);
    return db ? this.libraryForQueue(db) : undefined;
  }

  focusLiveTrack(track: Track): void {
    const item = this.libraryForLiveTrack(track);
    if (item) this.focus(item, false);
  }

  trackKey(artist: string, name: string): string {
    return `${(artist || '').toLowerCase()}|||${(name || '').toLowerCase()}`;
  }

  private detailFor(playlist: LibraryPlaylist): LibraryDetail | null {
    const detail = this.detail;
    if (!detail) return null;
    if (
      detail.playlist.id === playlist.id ||
      detail.playlist.uri === playlist.uri
    ) {
      return detail;
    }
    return null;
  }

  liveOf(track: LibraryTrack): (Track & { percent: number }) | undefined {
    const key = this.trackKey(track.artist, track.name);
    const db = this.dbPlaylistForFocused();
    if (db) return this.liveByPlaylistKey.get(`${db.id}|||${key}`);
    return this.liveMap.get(key);
  }

  private dbPlaylistForFocused(): Playlist | undefined {
    if (!this.focused) return undefined;
    const url = this.focused.spotifyUrl;
    const name = (this.focused.name || '').toLowerCase();
    return this.livePlaylists.find(
      (playlist) =>
        (!!url && playlist.spotifyUrl === url) ||
        (!!playlist.name && playlist.name.toLowerCase() === name),
    );
  }

  private liveStatusRank(status: TrackStatusEnum): number {
    switch (status) {
      case TrackStatusEnum.Downloading:
        return 0;
      case TrackStatusEnum.Searching:
        return 1;
      case TrackStatusEnum.Queued:
        return 2;
      case TrackStatusEnum.RetryWaiting:
        return 3;
      case TrackStatusEnum.Error:
        return 4;
      case TrackStatusEnum.Completed:
        return 5;
      default:
        return 9;
    }
  }

  statusKind(track: LibraryTrack): string {
    const live = this.liveOf(track);
    if (live?.status === TrackStatusEnum.Searching) return 'search';
    if (live?.status === TrackStatusEnum.Downloading) return 'rip';
    if (track.onDisk || live?.status === TrackStatusEnum.Completed)
      return 'disk';
    if (this.isNoCandidate(live || track)) return 'no-candidate';
    if (live?.status === TrackStatusEnum.Queued) return 'queue';
    if (live?.status === TrackStatusEnum.RetryWaiting) {
      if (live.acquisitionState === 'retry') {
        return typeof live.retryAt === 'number'
          ? live.retryAt > Date.now()
            ? 'scheduled'
            : 'queue'
          : 'retry';
      }
      return 'scheduled';
    }
    if (live?.status === TrackStatusEnum.Error) {
      return live.acquisitionState === 'missing' ||
        this.isPermanentMissing(live.error)
        ? 'error'
        : 'retry';
    }
    if (track.acquisitionState === 'missing') return 'error';
    if (track.acquisitionState === 'retry')
      return typeof track.retryAt === 'number'
        ? track.retryAt > Date.now()
          ? 'scheduled'
          : 'queue'
        : 'retry';
    if (track.acquisitionState === 'failed') return 'retry';
    if (track.error) return track.missing === false ? 'retry' : 'error';
    if (track.available) return 'copy';
    if (this.focusedHasLivePipeline()) return 'queue';
    return 'miss';
  }

  private focusedHasLivePipeline(): boolean {
    if (!this.focused) return false;
    const live =
      this.liveStats.get(this.focused.spotifyUrl) ||
      this.liveStats.get((this.focused.name || '').toLowerCase());
    if (live && (live.downloading || live.searching || live.queued)) {
      return true;
    }
    if (!this.isLibraryPipelineLive()) return false;
    return (
      this.focused.trackCount -
        this.focused.onDisk -
        (this.focused.failed || 0) >
      0
    );
  }

  private isLibraryPipelineLive(): boolean {
    return (
      this.liveDownloading > 0 || this.liveSearching > 0 || this.liveQueued > 0
    );
  }

  private playlistPipelineLive(stats: PlaylistView): boolean {
    return (
      stats.downloading > 0 ||
      stats.searching > 0 ||
      stats.queued > 0 ||
      (this.isLibraryPipelineLive() && stats.pending > 0)
    );
  }

  statusPercent(track: LibraryTrack): number {
    return this.liveOf(track)?.percent || 0;
  }

  statusError(track: LibraryTrack): string {
    return this.errorText(track);
  }

  errorText(track: LibraryTrack): string {
    return this.liveOf(track)?.error || track.error || '';
  }

  candidateEvidence(track: LibraryTrack): string {
    const live = this.liveOf(track);
    // Legacy websocket rows can predate the CLI journal and have no durable
    // acquisition fields. Do not hide the journal's search depth/counters.
    const legacyIdle =
      !live?.acquisitionState &&
      live?.status !== TrackStatusEnum.Searching &&
      live?.status !== TrackStatusEnum.Downloading &&
      live?.status !== TrackStatusEnum.Queued;
    const row = track.acquisitionState && legacyIdle ? track : live || track;
    const parts: string[] = [];
    if (Number.isInteger(row.searchLimit) && row.searchLimit! > 0)
      parts.push(`Candidate depth ${row.searchLimit}`);
    if (Number.isInteger(row.networkAttempts) && row.networkAttempts! >= 0)
      parts.push(`${row.networkAttempts} network failures`);
    if (Number.isInteger(row.operationAttempts) && row.operationAttempts! >= 0)
      parts.push(`${row.operationAttempts} operation failures`);
    if (this.isNoCandidate(row))
      parts.push(
        'No retry scheduled; increase candidate depth or explicitly retry',
      );
    return parts.join(' · ');
  }

  private isNoCandidate(
    track: Pick<Track, 'acquisitionState' | 'error'> | LibraryTrack,
  ): boolean {
    return (
      track.acquisitionState === 'no-candidate' ||
      track.error ===
        'No acceptable duration-matched YouTube candidate in the configured search results'
    );
  }

  get focusedNoCandidateCount(): number {
    return (
      this.detail?.tracks.filter(
        (track) => this.statusKind(track) === 'no-candidate',
      ).length || 0
    );
  }

  get focusedErrorCount(): number {
    return this.focused
      ? Math.max(
          0,
          this.statsOf(this.focused).needsRetry - this.focusedNoCandidateCount,
        )
      : 0;
  }

  isPlayable(track: LibraryTrack): boolean {
    return track.onDisk || this.statusKind(track) === 'disk';
  }

  isPlaying(track: LibraryTrack): boolean {
    return (
      !!this.audioUrl &&
      this.playingId === this.focused?.id &&
      this.playingN === track.n
    );
  }

  statsOf(playlist: LibraryPlaylist): PlaylistView {
    const key = playlist.uri || String(playlist.id);
    const cached = this.statsMemo.get(key);
    if (cached) return cached;
    const view = this.computeStats(playlist);
    this.statsMemo.set(key, view);
    return view;
  }

  private clearStatsMemo(): void {
    this.statsMemo.clear();
  }

  private computeStats(playlist: LibraryPlaylist): PlaylistView {
    const live =
      this.liveStats.get(playlist.spotifyUrl) ||
      this.liveStats.get((playlist.name || '').toLowerCase());
    let downloading = live?.downloading ?? 0;
    let searching = live?.searching ?? 0;
    let queued = live?.queued ?? 0;
    let retrying = live?.retrying ?? 0;
    let needsRetry = live?.needsRetry ?? 0;
    const focusedDetail = this.detailFor(playlist);
    if (this.focused?.uri === playlist.uri && focusedDetail) {
      let fromDetailDownloading = 0;
      let fromDetailSearching = 0;
      let fromDetailQueued = 0;
      let fromDetailRetrying = 0;
      let fromDetailNeedsRetry = 0;
      for (const track of focusedDetail.tracks) {
        const kind = this.statusKind(track);
        if (kind === 'rip') fromDetailDownloading++;
        else if (kind === 'search') fromDetailSearching++;
        else if (kind === 'queue') fromDetailQueued++;
        else if (kind === 'scheduled') fromDetailRetrying++;
        else if (kind === 'retry' || kind === 'no-candidate')
          fromDetailNeedsRetry++;
      }
      downloading = Math.max(downloading, fromDetailDownloading);
      searching = Math.max(searching, fromDetailSearching);
      queued = Math.max(queued, fromDetailQueued);
      retrying = Math.max(retrying, fromDetailRetrying);
      needsRetry = fromDetailNeedsRetry
        ? fromDetailNeedsRetry
        : Math.max(needsRetry, fromDetailNeedsRetry);
    }
    const active = downloading + searching + queued + retrying;
    const onDisk = Math.max(playlist.onDisk, live?.completed ?? 0);
    const failed = playlist.failed || 0;
    const trackCount = playlist.trackCount;
    const percentOnDisk = trackCount
      ? Math.round((onDisk / trackCount) * 100)
      : 0;
    const percentAvailable = Math.max(playlist.percentAvailable, percentOnDisk);
    const done = trackCount > 0 && onDisk + failed >= trackCount;
    const accounted =
      onDisk + failed + downloading + searching + queued + retrying;
    if (accounted + needsRetry > trackCount) {
      needsRetry = Math.max(0, trackCount - accounted);
    }
    const leftover = Math.max(
      0,
      trackCount -
        onDisk -
        failed -
        needsRetry -
        downloading -
        searching -
        queued -
        retrying,
    );
    const copyable = Math.min(
      leftover,
      Math.max(0, (playlist.available || 0) - onDisk),
    );
    const pending = leftover - copyable;
    const ripping = active > 0 || (this.isLibraryPipelineLive() && pending > 0);
    return {
      onDisk,
      failed,
      needsRetry,
      ripping,
      downloading,
      searching,
      queued,
      retrying,
      pending,
      copyable,
      active,
      percentOnDisk,
      percentAvailable,
      done,
      trackCount,
    };
  }

  runningNow(playlist: LibraryPlaylist): boolean {
    const stats = this.statsOf(playlist);
    return stats.downloading > 0 || stats.searching > 0;
  }

  get runningPlaylists(): LibraryPlaylist[] {
    return this.visiblePlaylists.filter((playlist) =>
      this.runningNow(playlist),
    );
  }

  activityLabel(playlist: LibraryPlaylist): string {
    const s = this.statsOf(playlist);
    const pipeline = this.playlistPipelineLive(s);
    const waiting = pipeline ? s.queued + s.pending : s.queued;
    if (s.downloading)
      return s.downloading === 1
        ? 'Downloading'
        : `Downloading ${s.downloading}`;
    if (s.searching)
      return s.searching === 1 ? 'Searching' : `Searching ${s.searching}`;
    if (waiting)
      return waiting === 1 ? 'Waiting' : `${this.fmt(waiting)} waiting`;
    if (s.retrying)
      return s.retrying === 1
        ? 'Retry scheduled'
        : `${s.retrying} retries scheduled`;
    return 'Working';
  }

  activitySummary(playlist: LibraryPlaylist, compact = false): string {
    const s = this.statsOf(playlist);
    const pipeline = this.playlistPipelineLive(s);
    const live = this.workSummary(
      s.downloading,
      s.searching,
      pipeline ? s.queued + s.pending : s.queued,
      s.retrying,
      compact,
    );
    const parts: string[] = [];
    if (s.needsRetry) {
      parts.push(`${this.fmt(s.needsRetry)} needs retry`);
    }
    if (!pipeline && s.pending) {
      parts.push(`${this.fmt(s.pending)} pending`);
    }
    if (live) parts.push(live);
    return parts.join(' · ');
  }

  playlistSubTitle(playlist: LibraryPlaylist): string {
    return this.coverageLine(playlist);
  }

  playlistOptionLabel(playlist: LibraryPlaylist): string {
    const remainder = this.coverageLine(playlist, true);
    return remainder ? `${playlist.name} · ${remainder}` : playlist.name;
  }

  coverageLine(playlist: LibraryPlaylist, compact = false): string {
    const s = this.statsOf(playlist);
    const counts = `${s.onDisk}/${s.trackCount}`;
    const missing = s.failed ? `${this.fmt(s.failed)} missing` : '';
    const copyable = s.copyable ? `${this.fmt(s.copyable)} copyable` : '';
    const retry = s.needsRetry ? `${this.fmt(s.needsRetry)} needs retry` : '';
    if (s.done && !s.ripping) {
      return missing ? `${counts} · ${missing}` : `${counts} saved`;
    }
    if (s.ripping) {
      return [
        counts,
        missing,
        copyable,
        this.activitySummary(playlist, compact),
      ]
        .filter(Boolean)
        .join(' · ');
    }
    return [counts + ' on disk', missing, copyable, retry]
      .filter(Boolean)
      .join(' · ');
  }

  get dumpPendingTotal(): number {
    if (!this.data) return 0;
    let pending = 0;
    for (const playlist of this.data.playlists) {
      if (playlist.skipped) continue;
      pending += this.statsOf(playlist).pending;
    }
    return pending;
  }

  globalActivitySummary(): string {
    const pending = this.dumpPendingTotal;
    const pipeline =
      this.liveDownloading > 0 || this.liveSearching > 0 || this.liveQueued > 0;
    const live = this.workSummary(
      this.liveDownloading,
      this.liveSearching,
      pipeline ? this.liveQueued + pending : this.liveQueued,
      this.liveRetrying,
      true,
    );
    if (pipeline || !pending) return live;
    const pendingPart = `${this.fmt(pending)} pending`;
    return live ? `${pendingPart} · ${live}` : pendingPart;
  }

  runningActivitySummary(): string {
    return this.workSummary(this.liveDownloading, this.liveSearching, 0, 0);
  }

  private workSummary(
    downloading: number,
    searching: number,
    queued: number,
    retrying: number,
    compact = false,
  ): string {
    const parts: string[] = [];
    if (downloading) {
      parts.push(
        compact
          ? `${this.fmt(downloading)} down`
          : `${downloading} downloading`,
      );
    }
    if (searching) {
      parts.push(
        compact ? `${this.fmt(searching)} search` : `${searching} searching`,
      );
    }
    if (queued) parts.push(`${this.fmt(queued)} waiting`);
    if (retrying) {
      parts.push(
        compact
          ? `${this.fmt(retrying)} retry`
          : retrying === 1
            ? '1 retry scheduled'
            : `${retrying} retries scheduled`,
      );
    }
    return parts.join(' · ');
  }

  remainingLabel(playlist: LibraryPlaylist): string {
    const stats = this.statsOf(playlist);
    const needed = this.youtubeNeeded(stats);
    if (needed) {
      if (this.isLibraryPipelineLive()) {
        return needed === 1 ? 'Waiting' : `${this.fmt(needed)} waiting`;
      }
      return `${this.fmt(needed)} needed`;
    }
    if (stats.needsRetry) {
      return stats.needsRetry === 1
        ? 'Needs retry'
        : `${this.fmt(stats.needsRetry)} needs retry`;
    }
    if (stats.copyable) {
      return stats.copyable === 1
        ? '1 copyable'
        : `${this.fmt(stats.copyable)} copyable`;
    }
    return '0 needed';
  }

  focusedActionLabel(playlist: LibraryPlaylist): string {
    const stats = this.statsOf(playlist);
    const needed = this.youtubeNeeded(stats);
    if (!needed && stats.copyable) {
      return stats.copyable === 1
        ? 'Copy 1 already ripped'
        : `Copy ${this.fmt(stats.copyable)} already ripped`;
    }
    return 'Download this playlist';
  }

  private youtubeNeeded(stats: PlaylistView): number {
    return Math.max(
      0,
      stats.trackCount -
        stats.onDisk -
        stats.failed -
        stats.copyable -
        stats.needsRetry,
    );
  }

  private hydrateStalledErrors(): void {
    if (!this.data) return;
    for (const dump of this.data.playlists) {
      if (dump.skipped) continue;
      const stats = this.statsOf(dump);
      if (stats.trackCount <= 0) continue;
      if (
        stats.downloading + stats.searching + stats.queued + stats.retrying >
        0
      ) {
        continue;
      }
      const leftover = stats.trackCount - stats.onDisk - stats.failed;
      if (leftover <= 0 || leftover > 25) continue;
      if (stats.onDisk / stats.trackCount < 0.5) continue;
      const db = this.livePlaylists.find(
        (item) =>
          (!!dump.spotifyUrl && item.spotifyUrl === dump.spotifyUrl) ||
          (!!item.name &&
            item.name.toLowerCase() === (dump.name || '').toLowerCase()),
      );
      if (db && !db.isTrack) this.trackService.hydrateErrors(db.id);
    }
  }

  trackStatusLabel(track: LibraryTrack): string {
    const kind = this.statusKind(track);
    if (kind === 'rip') {
      const pct = this.statusPercent(track);
      return pct > 0 ? `Downloading ${pct}%` : 'Downloading';
    }
    if (kind === 'search') return 'Finding on YouTube';
    if (kind === 'queue') return 'Waiting';
    if (kind === 'scheduled') return 'Retry scheduled';
    if (kind === 'disk') return 'on disk';
    if (kind === 'error') return 'Missing';
    if (kind === 'retry') return 'Needs retry';
    if (kind === 'no-candidate') return 'No acceptable candidate';
    if (kind === 'copy') return 'copyable';
    return 'Pending';
  }

  isDone(playlist: LibraryPlaylist): boolean {
    return this.statsOf(playlist).done;
  }

  needsAttention(playlist: LibraryPlaylist): boolean {
    if (playlist.skipped) return false;
    return !this.isDone(playlist) || this.statsOf(playlist).ripping;
  }

  private isPermanentMissing(error: string | null | undefined): boolean {
    return /^no youtube result\s*$/i.test((error || '').trim());
  }

  onTrackKey(track: LibraryTrack, event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.playTrack(track, event);
  }

  playbackPaused(): boolean {
    const el = this.player?.nativeElement;
    if (this.audioUrl && el) return el.paused;
    return this.paused;
  }

  playTrack(track: LibraryTrack, event?: Event): void {
    event?.stopPropagation();
    if (!this.focused || track.n == null || !this.isPlayable(track)) return;
    const url = `/api/library/audio/${encodeURIComponent(this.focused.id)}/${track.n}`;
    if (this.playingN === track.n && this.audioUrl === url) {
      const el = this.player?.nativeElement;
      if (!el) return;
      if (el.paused) {
        void el.play().then(
          () => {
            this.paused = el.paused;
          },
          () => {
            this.paused = true;
          },
        );
      } else {
        el.pause();
        this.paused = true;
      }
      return;
    }
    this.playingId = this.focused.id;
    this.playingN = track.n;
    this.paused = true;
    this.audioUrl = url;
    this.playingLabel = `${track.artist} — ${track.name}`;
    queueMicrotask(() => {
      const el = this.player?.nativeElement;
      if (!el) return;
      el.load();
      void el.play().then(
        () => {
          this.paused = el.paused;
        },
        () => {
          this.paused = true;
        },
      );
    });
  }

  onAudioPlay(): void {
    this.paused = false;
  }

  onAudioPause(): void {
    this.paused = true;
  }

  onAudioEnded(): void {
    this.stopPlayback();
  }

  stopPlayback(): void {
    this.player?.nativeElement.pause();
    this.audioUrl = '';
    this.playingId = null;
    this.playingN = null;
    this.playingLabel = '';
    this.paused = true;
  }

  ripLabel(track: Track): string {
    if (this.isNoCandidate(track)) return 'No acceptable candidate';
    if (track.status === TrackStatusEnum.Searching) return 'Finding on YouTube';
    if (track.status === TrackStatusEnum.Queued) return 'Waiting';
    if (track.status === TrackStatusEnum.RetryWaiting) return 'Retry scheduled';
    if (track.status === TrackStatusEnum.Downloading) {
      const pct = Math.round(
        (track as Track & { percent?: number }).percent || 0,
      );
      return pct > 0 ? `Downloading ${pct}%` : 'Downloading';
    }
    return '';
  }

  private liveWorkFinished(
    prev: Map<string, Track & { percent: number }>,
    next: Map<string, Track & { percent: number }>,
  ): boolean {
    if (!prev.size) return false;
    for (const [key, track] of prev) {
      const now = next.get(key);
      if (!now) {
        if (
          track.status === TrackStatusEnum.Downloading ||
          track.status === TrackStatusEnum.Searching
        ) {
          return true;
        }
        continue;
      }
      if (
        now.status !== track.status &&
        (now.status === TrackStatusEnum.Completed ||
          now.status === TrackStatusEnum.Error)
      ) {
        return true;
      }
    }
    return false;
  }

  private scheduleCoverageRefresh(delay = 2500): void {
    if (this.coverageTimer) clearTimeout(this.coverageTimer);
    this.coverageTimer = setTimeout(() => {
      this.refresh(true);
      this.playlistService.fetch();
    }, delay);
  }

  private syncDetailFromLive(): void {
    if (!this.detail) return;
    let changed = false;
    const tracks = this.detail.tracks.map((track) => {
      const live = this.liveOf(track);
      if (!live) return track;
      if (live.status === TrackStatusEnum.Completed && !track.onDisk) {
        changed = true;
        return { ...track, onDisk: true, available: true, error: undefined };
      }
      if (live.status === TrackStatusEnum.Error && !track.onDisk) {
        const error = live.error || "Can't rip this track";
        if (track.error !== error) {
          changed = true;
          return { ...track, error };
        }
      }
      return track;
    });
    if (changed) {
      this.detail = { ...this.detail, tracks };
      this.clearStatsMemo();
    }
  }

  private recomputeDiskTotal(): void {
    if (!this.data) {
      this.diskTotal = 0;
      return;
    }
    let onDisk = 0;
    for (const playlist of this.data.playlists) {
      if (playlist.skipped) continue;
      onDisk += this.statsOf(playlist).onDisk;
    }
    this.diskTotal = onDisk;
  }

  refresh(quiet = false): void {
    if (!quiet) this.pollYoutubePace();
    if (!quiet) this.loading = true;
    if (!quiet) this.error = '';
    this.libraryService.fetch().subscribe({
      next: (data) => {
        this.data = data;
        this.clearStatsMemo();
        this.recomputeDiskTotal();
        this.hydrateStalledErrors();
        if (!quiet) this.loading = false;
        if (this.focused) {
          const next = data.playlists.find((p) => p.uri === this.focused?.uri);
          this.focused = next || this.focused;
          if (next) this.loadDetail(next, quiet);
          this.keepFocusedRowVisible();
        } else {
          const first = this.visiblePlaylists[0];
          if (first) this.focus(first, false, false);
        }
      },
      error: (err) => {
        if (!quiet) this.loading = false;
        this.error =
          err?.error?.message || err?.message || 'Failed to load library';
      },
    });
  }

  focus(playlist: LibraryPlaylist, resync = true, userInitiated = true): void {
    if (userInitiated) this.userSelectedPlaylist = true;
    this.queueOpen = false;
    if (this.audioUrl && this.playbackPaused()) this.stopPlayback();
    this.focused = playlist;
    this.clearStatsMemo();
    this.loadDetail(playlist);
    if (resync) this.maybeResync(playlist);
    this.keepFocusedRowVisible(true);
  }

  private keepFocusedRowVisible(force = false): void {
    queueMicrotask(() => {
      const list = this.plList?.nativeElement;
      if (!list) return;
      const focusedRow = list.querySelector(
        '.pl-row.is-focused',
      ) as HTMLElement | null;
      const runningRows = Array.from(
        list.querySelectorAll('.pl-row.is-running'),
      ) as HTMLElement[];
      const listRect = list.getBoundingClientRect();
      const inView = (row: HTMLElement) => {
        const rect = row.getBoundingClientRect();
        return (
          rect.top >= listRect.top - 2 && rect.bottom <= listRect.bottom + 2
        );
      };
      const scrollIfNeeded = (row: HTMLElement) => {
        const offset = row.offsetTop;
        const moved = force || offset !== this.focusedRowOffset;
        this.focusedRowOffset = offset;
        if (!moved && !force) return;
        if (!inView(row)) row.scrollIntoView({ block: 'nearest' });
      };
      if (force && focusedRow) {
        scrollIfNeeded(focusedRow);
        return;
      }
      if (this.focused && this.runningNow(this.focused) && focusedRow) {
        scrollIfNeeded(focusedRow);
        return;
      }
      if (
        !this.userSelectedPlaylist &&
        runningRows.length &&
        !runningRows.some(inView)
      ) {
        runningRows[0].scrollIntoView({ block: 'nearest' });
      }
    });
  }

  private focusInitialActivity(): void {
    if (this.userSelectedPlaylist || this.initialActivityFocusApplied) return;
    const active = this.visiblePlaylists.find(
      (playlist) => this.statsOf(playlist).ripping,
    );
    if (!active) return;
    this.initialActivityFocusApplied = true;
    if (this.focused?.uri !== active.uri) this.focus(active, false, false);
  }

  private maybeResync(playlist: LibraryPlaylist): void {
    if (
      this.syncingLibrary ||
      this.resyncing ||
      this.librarySyncDegraded ||
      playlist.skipped
    )
      return;
    const last = this.lastResyncAt.get(playlist.id) || 0;
    if (Date.now() - last < 10 * 60 * 1000) return;
    this.lastResyncAt.set(playlist.id, Date.now());
    this.resyncFocused(true);
  }

  private scheduleScrollActionable(): void {
    if (this.scrollTimer) clearTimeout(this.scrollTimer);
    this.scrollTimer = setTimeout(() => {
      this.scrollTimer = null;
      this.scrollActionableIntoView();
    }, 50);
  }

  private scrollActionableIntoView(): void {
    if (!this.focused || this.statsOf(this.focused).done) return;
    const wrap = this.trackWrap?.nativeElement;
    if (!wrap) return;
    const row =
      (wrap.querySelector('tr.is-wip') as HTMLElement | null) ||
      (wrap
        .querySelector(
          '.pill.search, .pill.dl, .pill.waiting, .pill.retry, .pill.pending, .pill.miss',
        )
        ?.closest('tr') as HTMLElement | null);
    if (!row) {
      wrap.scrollTop = 0;
      return;
    }
    const rowRect = row.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    wrap.scrollTop += rowRect.top - wrapRect.top - wrap.clientHeight / 4;
  }

  private focusedHasNewRunningWork(
    prev: Map<string, Track & { percent: number }>,
    next: Map<string, Track & { percent: number }>,
  ): boolean {
    if (!this.detail || !this.focused) return false;
    const running = (track?: Track) =>
      track?.status === TrackStatusEnum.Downloading ||
      track?.status === TrackStatusEnum.Searching;
    for (const track of this.detail.tracks) {
      const key = this.trackKey(track.artist, track.name);
      if (running(next.get(key)) && !running(prev.get(key))) return true;
    }
    return false;
  }

  loadDetail(playlist: LibraryPlaylist, quiet = false): void {
    if (!quiet) {
      this.detailLoading = true;
      if (!this.detailFor(playlist)) {
        this.detail = null;
        this.clearStatsMemo();
      }
      const wrap = this.trackWrap?.nativeElement;
      if (wrap) wrap.scrollTop = 0;
    }
    this.libraryService.detail(playlist.id).subscribe({
      next: (detail) => {
        if (this.focused?.id !== playlist.id) return;
        this.detail = detail;
        this.clearStatsMemo();
        this.detailLoading = false;
        this.rememberDumpFailures(playlist, detail);
        this.syncDetailFromLive();
        this.scheduleScrollActionable();
      },
      error: () => {
        if (this.focused?.id !== playlist.id) return;
        this.detailLoading = false;
        if (!quiet) {
          this.detail = null;
          this.clearStatsMemo();
        }
      },
    });
  }

  private rememberDumpFailures(
    playlist: LibraryPlaylist,
    detail: LibraryDetail,
  ): void {
    const db =
      this.livePlaylists.find(
        (item) =>
          (!!playlist.spotifyUrl && item.spotifyUrl === playlist.spotifyUrl) ||
          (!!item.name &&
            item.name.toLowerCase() === (playlist.name || '').toLowerCase()),
      ) || this.dbPlaylistForFocused();
    if (!db) return;
    for (const track of detail.tracks) {
      if (track.error && track.missing === false) {
        this.trackService.rememberError({
          playlistId: db.id,
          artist: track.artist,
          name: track.name,
          error: track.error,
        });
      }
    }
  }

  onListKey(event: KeyboardEvent): void {
    const items = this.visiblePlaylists;
    if (!items.length) return;
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      if (this.focused) this.toggleCheck(this.focused);
      return;
    }
    let nextIdx = items.findIndex((p) => p.uri === this.focused?.uri);
    if (event.key === 'ArrowDown') {
      nextIdx = Math.min(items.length - 1, Math.max(0, nextIdx) + 1);
    } else if (event.key === 'ArrowUp') {
      nextIdx = Math.max(0, (nextIdx < 0 ? 1 : nextIdx) - 1);
    } else if (event.key === 'Home') {
      nextIdx = 0;
    } else if (event.key === 'End') {
      nextIdx = items.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    this.focus(items[nextIdx], false);
  }

  toggleCheck(playlist: LibraryPlaylist, event?: Event): void {
    event?.stopPropagation();
    if (playlist.skipped) return;
    const next = new Set(this.selected);
    if (next.has(playlist.uri)) next.delete(playlist.uri);
    else next.add(playlist.uri);
    this.selected = next;
  }

  isSelected(uri: string): boolean {
    return this.selected.has(uri);
  }

  isFocused(uri: string): boolean {
    return this.focused?.uri === uri;
  }

  selectIncomplete(): void {
    this.selected = new Set(
      this.visiblePlaylists
        .filter((p) => this.needsAttention(p))
        .map((p) => p.uri),
    );
  }

  selectNone(): void {
    this.selected = new Set();
  }

  downloadUris(uris: string[], retryOptions: AcquisitionOptions = {}): void {
    if (
      !uris.length ||
      this.ownerBlocksAcquisition ||
      this.enqueueing ||
      !this.liveQueueKnown ||
      !this.acquisitionOptionsValid
    )
      return;
    this.enqueueing = true;
    this.message = '';
    this.libraryService
      .download(uris, {
        maxSearches: this.maxSearches,
        networkRetries: this.networkRetries,
        ...retryOptions,
      })
      .subscribe({
        next: (res) => {
          this.enqueueing = false;
          this.message = this.enqueueResultMessage(res);
          this.queueOpen = false;
          this.selected = new Set();
          this.playlistService.fetch();
          this.refresh();
        },
        error: (err) => {
          this.enqueueing = false;
          this.message =
            err?.error?.message || err?.message || 'Download failed';
        },
      });
  }

  downloadSelected(): void {
    if (this.bulkActionsBlocked) return;
    this.downloadUris([...this.selected]);
  }

  downloadRemaining(): void {
    if (this.bulkActionsBlocked) return;
    this.enqueueing = true;
    this.message = '';
    this.libraryService
      .downloadRemaining({
        maxSearches: this.maxSearches,
        networkRetries: this.networkRetries,
      })
      .subscribe({
        next: (res) => {
          this.enqueueing = false;
          this.message = this.enqueueResultMessage(res);
          this.playlistService.fetch();
          this.refresh();
        },
        error: (err) => {
          this.enqueueing = false;
          this.message =
            err?.error?.message || err?.message || 'Download remaining failed';
        },
      });
  }

  private enqueueResultMessage(res: {
    queued: number;
    skipped: number;
  }): string {
    return `Queued ${res.queued} · ${res.skipped} unchanged (already saved, queued, or parked)`;
  }

  resyncAll(): void {
    if (this.resyncAllRunning) return;
    this.resyncAllRunning = true;
    this.message = '';
    this.error = '';
    this.libraryService.resyncAll().subscribe({
      next: () => this.pollResyncAll(),
      error: (err) => {
        this.resyncAllRunning = false;
        this.error = err?.error?.message || err?.message || 'Resync all failed';
      },
    });
  }

  private restoreOrStartLibrarySync(): void {
    this.libraryService.syncLibraryStatus().subscribe({
      next: (status) => {
        if (status.running) {
          this.syncingLibrary = true;
          this.librarySyncQuiet = true;
          this.pollLibrarySync();
          return;
        }
        if (this.shouldSkipQuietSync(status)) {
          this.librarySyncDegraded = true;
          const text = status.errors.at(-1) || 'Spotify library sync failed';
          this.syncNotice = this.quietSyncNotice(text, status.errors);
          return;
        }
        this.syncLibrary(true);
      },
      error: () => this.syncLibrary(true),
    });
  }

  private shouldSkipQuietSync(status: {
    errors: string[];
    finishedAt: string | null;
  }): boolean {
    if (!status.errors.length || !status.finishedAt) return false;
    if (this.isRateLimitedSync(status.errors)) return true;
    const finished = Date.parse(status.finishedAt);
    if (!Number.isFinite(finished)) return false;
    return Date.now() - finished < 15 * 60 * 1000;
  }

  private isRateLimitedSync(errors: string[]): boolean {
    return /\b429\b|too many requests|rate.?limit/i.test(errors.join(' '));
  }

  private quietSyncNotice(text: string, errors: string[]): string {
    if (this.isRateLimitedSync(errors)) {
      return `${text} · showing saved library · use Sync library to retry`;
    }
    return `${text} · showing saved library`;
  }

  syncLibrary(quiet = false): void {
    if (this.syncingLibrary) return;
    this.syncingLibrary = true;
    this.librarySyncQuiet = quiet;
    this.syncNotice = '';
    if (!quiet) {
      this.message = '';
      this.error = '';
    }
    this.libraryService.syncLibrary().subscribe({
      next: () => this.pollLibrarySync(),
      error: (err) => {
        this.syncingLibrary = false;
        this.librarySyncDegraded = true;
        const text =
          err?.error?.message || err?.message || 'Spotify library sync failed';
        if (quiet) this.syncNotice = this.quietSyncNotice(text, [text]);
        else this.error = text;
      },
    });
  }

  private pollLibrarySync(): void {
    if (this.librarySyncPoll) clearInterval(this.librarySyncPoll);
    const poll = () => {
      this.libraryService.syncLibraryStatus().subscribe({
        next: (status) => {
          this.librarySyncLabel = status.running
            ? status.total > 0
              ? `Syncing ${status.done}/${status.total}${status.current ? ' · ' + status.current : ''}`
              : 'Loading Spotify playlists…'
            : '';
          if (status.running || !status.finishedAt) return;
          if (this.librarySyncPoll) clearInterval(this.librarySyncPoll);
          this.librarySyncPoll = null;
          this.syncingLibrary = false;
          const changed = status.discovered + status.changed;
          if (status.errors.length) {
            this.librarySyncDegraded = true;
            const text = status.errors.at(-1) || 'Spotify library sync failed';
            if (this.librarySyncQuiet) {
              this.syncNotice = this.quietSyncNotice(text, status.errors);
            } else {
              this.error = text;
            }
          } else {
            this.librarySyncDegraded = false;
            if (changed > 0 || !this.librarySyncQuiet) {
              this.message = `${status.discovered} new playlists · ${status.changed} playlists updated`;
            }
          }
          if (changed > 0) {
            this.refresh(true);
            this.playlistService.fetch();
          }
        },
      });
    };
    this.librarySyncPoll = setInterval(poll, 2000);
    poll();
  }

  private pollResyncAll(): void {
    if (this.resyncAllPoll) clearInterval(this.resyncAllPoll);
    this.resyncAllPoll = setInterval(() => {
      this.libraryService.resyncAllStatus().subscribe({
        next: (st) => {
          this.resyncAllLabel = st.running
            ? `Resyncing ${st.done}/${st.total}${st.current ? ' · ' + st.current : ''}`
            : '';
          if (!st.running && st.finishedAt) {
            if (this.resyncAllPoll) clearInterval(this.resyncAllPoll);
            this.resyncAllPoll = null;
            this.resyncAllRunning = false;
            this.resyncAllLabel = '';
            this.message = `Resynced ${st.done}/${st.total} · ${st.updated} grew · ${st.errors.length} errors`;
            this.refresh();
          }
        },
      });
    }, 2000);
  }

  downloadFocused(): void {
    if (this.focused && !this.focused.skipped) {
      this.downloadUris([this.focused.uri]);
    }
  }

  retryFocusedOutcomes(): void {
    if (
      this.focused &&
      !this.focused.skipped &&
      !this.statsOf(this.focused).ripping
    ) {
      this.downloadUris([this.focused.uri], {
        retryMissing: true,
        retryNoCandidate: true,
      });
    }
  }

  retryFocusedErrors(): void {
    if (
      this.focused &&
      !this.focused.skipped &&
      this.focusedErrorCount > 0 &&
      !this.statsOf(this.focused).ripping
    ) {
      this.downloadUris([this.focused.uri], { retryErrors: true });
    }
  }

  resyncFocused(quiet = false): void {
    if (!this.focused || this.resyncing) return;
    const playlist = this.focused;
    this.resyncing = true;
    if (!quiet) {
      this.message = '';
      this.error = '';
    }
    this.libraryService.resync(playlist.id).subscribe({
      next: (res) => {
        this.resyncing = false;
        this.refresh(true);
        if (res.after !== res.before) {
          this.message = `${res.name}: ${res.before} → ${res.after} tracks`;
        } else if (!quiet) {
          this.message = `${res.name}: still ${res.after} tracks`;
        }
      },
      error: (err) => {
        this.resyncing = false;
        if (!quiet) {
          this.error =
            err?.error?.message || err?.message || 'Resync from Spotify failed';
        }
      },
    });
  }
}
