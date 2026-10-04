import {
  AfterViewChecked,
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
  DownloadLocation,
  DownloadReceipt,
} from '../../services/library.service';
import {
  LibraryDetail,
  LibraryListResponse,
  LibraryPlaylist,
  LibraryTrack,
  validCoverageProgress,
} from '../../models/library-playlist';
import { PlaylistService } from '../../services/playlist.service';
import { TrackService } from '../../services/track.service';
import { Track, TrackStatusEnum } from '../../models/track';
import { Playlist } from '../../models/playlist';
import { combineLatest, map, Observable, Subscription, take, throwIfEmpty, timeout } from 'rxjs';
import { operatorActivity, OperatorActivity } from './operator-activity';
import { keptLocallyCheckedAt, playlistEmptyMessage, playlistFreshness, recentCompletedSync, SpotifySyncStatus, spotifySyncProblem, spotifySyncProgress, spotifySyncResult, syncObservationKey, syncResultMatchesRequest } from './spotify-sync-state';
import { chromeConnectionGuidance, SpotifyConnection } from '../../models/spotify-connection';
import { spotifySourceId } from '../../../../../backend/src/shared/acquisition/source-id';
import { DOWNLOAD_REQUEST_STORAGE, validDownloadReceipt, validDownloadRequestId, validDownloadRequestStatus } from '../../models/download-request';

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
  checking: number;
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

type DownloadLimits = Pick<YoutubePaceSnapshot, 'downloadConc' | 'searchConc' | 'maxPerWindow' | 'windowMs'>;

@Component({
  selector: 'app-library-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './library-panel.component.html',
  styleUrls: [
    './library-panel.component.scss',
    './library-panel-work-state.scss',
    './operator-activity.scss',
  ],
})
export class LibraryPanelComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('plList') private plList?: ElementRef<HTMLElement>;
  @ViewChild('libraryToggle') private libraryToggle?: ElementRef<HTMLButtonElement>;
  @ViewChild('playlistFilter') private playlistFilter?: ElementRef<HTMLInputElement>;
  @ViewChild('playlistNavigation') private playlistNavigation?: ElementRef<HTMLElement>;
  @ViewChild('detailTitle') private detailTitle?: ElementRef<HTMLElement>;
  @ViewChild('player') private player?: ElementRef<HTMLAudioElement>;
  @ViewChild('trackWrap') private trackWrap?: ElementRef<HTMLElement>;

  filter = '';
  mobileLibraryOpen = false;
  private navigationFocus: 'filter' | 'toggle' | 'list' | 'detail' | null = null;
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
  detailLoadError = '';
  loading = false;
  libraryLoadError = '';
  enqueueing = false;
  resumeConfirm = false;
  resumingQueues = false;
  resumeError = '';
  resyncing = false;
  resyncAllRunning = false;
  resyncAllLabel = '';
  syncScope: SpotifySyncStatus['scope'] = 'library';
  syncPlaylistId: string | null = null;
  syncingLibrary = false;
  librarySyncLabel = '';
  syncNotice = '';
  librarySyncDegraded = false;
  librarySyncConnectionLost = false;
  librarySyncFinishedAt: string | null = null;
  spotifyConnection: SpotifyConnection | null = null;
  chromeConnectConfirm = false;
  chromeConnectionRequestPending = false;
  chromeConnectionError = '';
  private chromeCheckPending = false;
  private chromeStatusRead?: Subscription;
  private chromeConnectRequest?: Subscription;
  private chromeLastCheckedAt = 0;
  private chromeApprovalObserved = false;
  private librarySyncPollInFlight = false;
  private librarySyncPoll: ReturnType<typeof setInterval> | null = null;
  private librarySyncQuiet = true;
  private syncObservationInterval: ReturnType<typeof setInterval> | null = null;
  private syncRestorePending = false;
  private lastSyncObservationKey = '';
  private syncRequest: { operationId: string | null; startedAt: number; responseLost: boolean } | null = null;
  private syncActionError = '';
  private syncRequestGeneration = 0;
  private destroyed = false;
  activityDetailsOpen = false;
  activityEvents: Array<{ at: number; text: string }> = [];
  resyncTarget = '';
  activityReceipt: { at: number; title: string; detail: string } | null = null;
  private lastMessage = '';
  get message(): string {
    return this.lastMessage;
  }
  set message(value: string) {
    if (value && value !== this.lastMessage) this.recordActivity(value);
    this.lastMessage = value;
  }
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
  profileActionError = '';
  private profileRequest?: Subscription;
  private profileUnconfirmedTarget: DownloadLimits | null = null;
  private profileRequestStartedAt = 0;
  private profileStateVersion = 0;
  maxSearches = 10;
  networkRetries = 5;
  downloadLocation: DownloadLocation | null = null;
  downloadPathDraft = '';
  savingDownloadLocation = false;
  locationError = '';
  locationMessage = '';
  private coverageGeneration = 0;
  private locationGeneration = 0;
  private detailGeneration = 0;
  private coverageRead?: Subscription;
  private fileCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private coverageChangesSub?: Subscription;
  coverageObservationLost = false;

  get coverageIncomplete(): boolean {
    return !!this.data?.coverage && this.data.coverage.state !== 'complete';
  }

  get fileCheckNeedsAttention(): boolean {
    return this.coverageObservationLost || this.data?.coverage?.state === 'failed';
  }

  get fileUpdatesUnavailable(): boolean {
    return this.data?.coverage?.updates === 'manual';
  }

  checkingFiles(p: LibraryPlaylist): number {
    return Math.max(0, this.detailFor(p)?.playlist.coveragePending ?? p.coveragePending ?? 0);
  }
  private detailRead?: Subscription;
  private enqueueRequest?: Subscription;
  private resumeRequest?: Subscription;
  private resumeOutcomeUnknown = false;
  private paceRead?: Subscription;
  private paceReadPending = false;
  private queueActionError = '';
  private pendingDownloadRequest: { id: string; uris?: string[] } | null = null;
  private downloadReceiptRead?: Subscription;
  private downloadReceiptReadPending = false;
  private downloadReceiptNextCheckAt = 0;
  private downloadReceiptReadFailures = 0;
  private downloadRequestObserved: 'preparing' | 'unknown' | null = null;
  downloadReceiptStorageWarning = '';

  get preparingDownloadRequest(): boolean {
    return this.enqueueing || (!!this.pendingDownloadRequest && this.downloadRequestObserved === 'preparing');
  }
  get downloadRequestNeedsCheck(): boolean {
    return !!this.pendingDownloadRequest && !this.enqueueing && this.downloadRequestObserved === 'unknown';
  }
  get checkingDownloadReceipt(): boolean { return this.downloadReceiptReadPending; }

  get spotifyActivity(): string {
    if (this.librarySyncConnectionLost) return '';
    if (this.librarySyncLabel) return this.librarySyncLabel;
    if (this.resyncing)
      return this.resyncTarget || 'Refreshing playlist tracks…';
    if (this.resyncAllRunning)
      return this.resyncAllLabel || 'Refreshing all playlists…';
    return this.syncingLibrary && !this.librarySyncConnectionLost
      ? this.librarySyncLabel || 'Refreshing your playlist library…'
      : '';
  }

  get spotifySyncBusy(): boolean {
    return this.syncingLibrary || this.resyncing || this.resyncAllRunning || this.chromeConnectionWaiting;
  }

  get chromeConnectionWaiting(): boolean {
    return this.chromeConnectionRequestPending || this.chromeApprovalObserved || this.spotifyConnection?.state === 'connecting';
  }

  get chromeWaitingGuidance(): string {
    return this.spotifyConnection?.state === 'unavailable'
      ? 'Cannot check the existing Chrome connection request. Rechecking status only; no new permission request will be sent.'
      : chromeConnectionGuidance('connecting');
  }

  get chromeConnectionNeeded(): boolean {
    return this.librarySyncDegraded && /CDP|Chrome|browser connection/i.test(this.syncNotice);
  }

  get chromeConnectionGuidance(): string {
    return chromeConnectionGuidance(this.spotifyConnection?.state || 'unavailable');
  }

  get canOfferChromeConnection(): boolean {
    return this.chromeConnectionNeeded && this.spotifyConnection?.state === 'disconnected' && !this.chromeConnectionWaiting;
  }

  get spotifySyncIssue(): string {
    if (this.librarySyncConnectionLost)
      return 'Cannot check Spotify sync: connection to Spooty lost. Rechecking automatically; the server may still be working.';
    if (this.chromeConnectionNeeded) return this.chromeConnectionGuidance;
    return this.librarySyncDegraded && this.syncNotice
      ? spotifySyncProblem(this.syncNotice)
      : '';
  }

  get spotifySyncHelp(): string {
    if (this.librarySyncConnectionLost) return this.spotifySyncIssue;
    if (this.chromeConnectionWaiting) return this.chromeWaitingGuidance;
    if (this.spotifySyncBusy) return 'A Spotify sync is already in progress. Follow it in Current activity.';
    return 'Update playlist names and track lists from Spotify. Checks for new and changed playlists every 15 minutes while connected. MP3 downloads are separate; existing files are never changed.';
  }

  get activity(): OperatorActivity {
    let result = operatorActivity({
      pace: this.youtubePace,
      tracks: this.activeRips,
      syncing: this.spotifyActivity,
      enqueueing: this.preparingDownloadRequest,
      resuming: this.resumingQueues,
      loading: this.loading,
      known: this.liveQueueKnown,
    });
    const coverage = this.data?.coverage;
    if (coverage && coverage.state !== 'complete' && !result.busy) {
      result = this.fileCheckNeedsAttention
        ? { title: 'Saved-file check needs attention',
          detail: this.coverageObservationLost ? 'Cannot check progress. The server may still be checking files; no downloads have started.'
            : 'Some files could not be checked. Unchecked tracks are not marked missing. Check saved files again.',
          tone: 'warning', busy: false, percent: null, progressText: '' }
        : { title: coverage.scope === 'changes' ? 'Updating saved files' : 'Checking saved files', detail: coverage.current || 'You can browse playlists while local audio is checked. No downloads are being started.',
          tone: 'working', busy: true, percent: coverage.total ? coverage.checked * 100 / coverage.total : null,
          progressText: `${this.fmt(coverage.checked)}/${this.fmt(coverage.total)} ${coverage.scope === 'changes' ? 'affected ' : ''}playlist tracks checked` };
    }
    if (this.detailLoading && result.tone === 'idle') {
      result = { ...result, title: 'Loading saved tracks',
        detail: this.focused?.name || 'Reading this playlist from Spooty.',
        tone: 'working', busy: true };
    }
    if (this.fileUpdatesUnavailable && !this.coverageIncomplete && result.tone === 'idle') {
      result = { title: 'Automatic file updates unavailable',
        detail: 'Saved counts may change if files are added or moved. Check saved files again to refresh them.',
        tone: 'warning', busy: false, percent: null, progressText: '' };
    }
    if (this.selectingProvenProfile && !result.busy)
      result = { ...result, title: 'Updating download limits',
        detail: 'Restoring tested limits. This does not resume queues or start downloads.',
        tone: 'working', busy: true, percent: null, progressText: '' };
    // A failed user action is visible, never buried behind the details toggle.
    if (this.error && !result.busy)
      return {
        ...result,
        title: this.error === this.libraryLoadError ? 'Saved library unavailable'
          : this.error === this.detailLoadError ? 'Playlist tracks unavailable'
          : this.error === this.queueActionError ? 'Download submission needs attention' : 'Action needs attention',
        detail: this.error,
        tone: 'warning',
      };
    if (this.chromeConnectionWaiting && !result.busy)
      return { ...result, title: 'Waiting for Chrome approval', detail: this.chromeWaitingGuidance, tone: 'waiting', busy: false };
    if (this.profileActionError && !result.busy)
      return { ...result, title: 'Download settings need attention', detail: this.profileActionError, tone: 'warning' };
    if (result.tone === 'idle' && this.recentReceipt)
      return {
        ...result,
        title: this.recentReceipt.title,
        detail: this.recentReceipt.detail,
      };
    if (result.tone === 'idle' && this.spotifySyncIssue)
      return { ...result, title: 'Spotify sync needs attention', detail: this.spotifySyncIssue, tone: 'warning' };
    return result;
  }

  get recentReceipt(): { at: number; title: string; detail: string } | null {
    return this.activityReceipt && Date.now() - this.activityReceipt.at < 15000
      ? this.activityReceipt
      : null;
  }

  activityPhase(phase: string): string {
    return (
      (
        {
          preparing: 'Checking saved files',
          metadata: 'Reading Spotify details',
          verifying: 'Checking audio length',
          copying: 'Adding existing MP3',
          searching: 'Searching YouTube',
          downloading: 'Downloading audio',
          'waiting-search': 'Waiting for search slot',
          'waiting-download': 'Waiting for download slot',
          'waiting-shared': 'Waiting for the same track',
        } as Record<string, string>
      )[phase] || phase
    );
  }

  activityResult(result: string): string {
    return (
      (
        {
          downloaded: 'MP3 downloaded',
          reused: 'Existing MP3 added',
          checked: 'Queue entry checked',
          ready: 'Ready to download',
          retry: 'Another attempt scheduled',
          'candidate-rejected':
            'Video did not match; checking other candidates',
          'no-candidate': 'No matching video',
          missing: 'No videos found',
          failed: 'No MP3 saved; see track details',
        } as Record<string, string>
      )[result] || result
    );
  }

  focusActivityJob(id: number): void {
    const track = this.liveApplyArgs?.tracks.find((t) => t.id === id);
    if (track) this.focusLiveTrack(track);
  }

  private recordActivity(text: string): void {
    this.activityEvents = [
      { at: Date.now(), text },
      ...this.activityEvents,
    ].slice(0, 12);
  }

  get recentActivity(): Array<{ at: number; text: string }> {
    return [
      ...this.activityEvents,
      ...(this.youtubePace?.webActivity?.recent || []).map((event) => ({
        at: event.at,
        text: `${this.activityResult(event.result)} · ${event.artist} — ${event.name}`,
      })),
    ]
      .sort((a, b) => b.at - a.at)
      .slice(0, 20);
  }

  focusedProgressRemainder(p: LibraryPlaylist): string {
    if (this.checkingFiles(p)) return `${this.fmt(this.checkingFiles(p))} still to check`;
    const s = this.statsOf(p);
    const parts: string[] = [];
    if (s.searching + s.downloading)
      parts.push(`${s.searching + s.downloading} processing`);
    if (s.queued + s.retrying) parts.push(`${s.queued + s.retrying} queued`);
    if (s.pending) parts.push(`${s.pending} not queued`);
    if (s.needsRetry + s.failed)
      parts.push(`${s.needsRetry + s.failed} need review`);
    if (s.copyable) parts.push(`${s.copyable} available in another folder`);
    return parts.join(' · ') || (s.done ? 'Complete' : '');
  }

  get locationChangeBlocked(): boolean {
    return (
      this.savingDownloadLocation ||
      this.profileChangeBusy ||
      this.preparingDownloadRequest ||
      this.youtubePace?.webAdmission?.running ||
      !this.downloadLocation ||
      !this.liveQueueKnown ||
      !this.youtubePace ||
      this.ownerBlocksAcquisition ||
      this.liveDownloading > 0 ||
      this.liveSearching > 0 ||
      this.youtubePace.downloadActive > 0 ||
      this.youtubePace.searchActive > 0
    );
  }

  loadDownloadLocation(): void {
    this.libraryService.downloadLocation().subscribe({
      next: (location) => {
        this.downloadLocation = location;
        this.downloadPathDraft = location.path;
        this.locationError = '';
      },
      error: () => {
        this.locationError =
          'Cannot load the download folder setting. Refresh to try again.';
      },
    });
  }

  saveDownloadLocation(): void {
    if (this.locationChangeBlocked || !this.downloadPathDraft.trim()) return;
    this.savingDownloadLocation = true;
    this.locationError = '';
    this.locationMessage = '';
    this.libraryService
      .saveDownloadLocation(this.downloadPathDraft.trim())
      .subscribe({
        next: (location) => {
          this.downloadLocation = location;
          this.downloadPathDraft = location.path;
          this.savingDownloadLocation = false;
          this.locationGeneration++;
          this.stopPlayback();
          this.detail = null;
          this.clearStatsMemo();
          this.locationMessage =
            'Folder saved. Scanning and playback now use this location. No files moved or deleted.';
          this.refresh();
        },
        error: (err) => {
          this.savingDownloadLocation = false;
          this.locationError =
            err?.error?.message ||
            'Folder was not changed. Check the path and try again.';
        },
      });
  }

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
    if (this.coverageIncomplete) return this.fileCheckNeedsAttention ? 'Check saved files again before adding new downloads.' : 'Checking saved files before counting what needs downloading. You can browse playlists.';
    if (this.profileChangeBusy) return 'Checking the download-settings change. Follow Current activity.';
    if (this.youtubePace?.webAdmission?.running) return 'A playlist request is preparing tracks. Follow Current activity.';
    if (this.preparingDownloadRequest) return 'A download submission is being prepared. Follow Current activity.';
    if (this.savingDownloadLocation)
      return 'Saving download folder; acquisition is briefly held';
    if (this.ownerBlocksAcquisition) return this.acquisitionOwnerLabel;
    if (!this.liveQueueKnown) return 'Checking live queue…';
    if (this.webQueuePauseMessage) return this.webQueuePauseMessage;
    if (this.hasQueuedWork)
      return 'Work already queued — bulk search/download waits. Playlist retries remain available.';
    if (!this.acquisitionOptionsValid)
      return 'Use 1–50 candidates and 0–20 additional network retries.';
    return '';
  }

  get playlistActionBlockedReason(): string {
    if (this.focused && this.checkingFiles(this.focused)) return this.fileCheckNeedsAttention ? 'Some tracks are not checked yet. Check saved files again.' : 'Checking this playlist’s saved files. Downloads become available when its check finishes.';
    if (this.profileChangeBusy) return 'Checking the download-settings change. Follow Current activity.';
    if (this.youtubePace?.webAdmission?.running) return 'A playlist request is preparing tracks. Follow Current activity.';
    if (this.savingDownloadLocation) return 'Saving download folder…';
    if (this.ownerBlocksAcquisition) return this.acquisitionOwnerLabel;
    if (!this.liveQueueKnown) return 'Checking saved queue jobs…';
    if (!this.acquisitionOptionsValid)
      return 'Use 1–50 candidates and 0–20 network retries.';
    if (this.preparingDownloadRequest) return 'Adding tracks to the queue…';
    return '';
  }

  get resumeBlocked(): boolean {
    return (
      this.ownerBlocksAcquisition ||
      this.savingDownloadLocation ||
      this.resumingQueues ||
      this.profileChangeBusy ||
      this.preparingDownloadRequest ||
      this.youtubePace?.webAdmission?.running ||
      !this.youtubePace?.webQueues
    );
  }

  get queuedJobCount(): number {
    const q = this.youtubePace?.webQueues;
    return (q?.search.queued || 0) + (q?.download.queued || 0);
  }

  resumeWebQueues(): void {
    if (this.destroyed || !this.resumeConfirm || this.resumeBlocked) return;
    this.resumingQueues = true;
    this.resumeError = '';
    this.resumeOutcomeUnknown = false;
    this.resumeRequest = this.libraryService.resumeWebQueues().pipe(timeout(20000), take(1)).subscribe({
      next: (snapshot) => {
        if (this.destroyed) return;
        if (snapshot?.webQueues?.search.paused !== false || snapshot?.webQueues?.download.paused !== false) {
          this.resumeRequestUnconfirmed(new Error('Invalid resume acknowledgement'));
          return;
        }
        this.youtubePace = snapshot;
        this.resumingQueues = false;
        this.resumeConfirm = false;
        this.message =
          'Web queues resumed. Saved files and parked search outcomes are still skipped.';
        this.activityReceipt = { at: Date.now(), title: 'Web downloads resumed', detail: this.message };
        this.trackService.fetchActive();
      },
      error: (error) => {
        if (this.destroyed) return;
        this.resumeRequestUnconfirmed(error);
      },
    });
  }

  private resumeRequestUnconfirmed(error: any): void {
    this.resumingQueues = false;
    this.resumeOutcomeUnknown = ![400, 401, 403, 404, 409, 422, 429].includes(error?.status);
    this.resumeError = this.requestOutcomeMessage(error, 'resume web downloads');
    this.recordActivity(this.resumeError);
    this.pollYoutubePace();
  }

  get webQueuesPaused(): boolean {
    const queues = this.youtubePace?.webQueues;
    return !!(queues?.search.paused && queues.download.paused);
  }

  get webQueuePauseMessage(): string {
    const queues = this.youtubePace?.webQueues;
    if (!queues) return '';
    if (this.webQueuesPaused)
      return 'Web queues are paused. Queued tracks will not start until the queues are resumed.';
    if (queues.search.paused)
      return 'Search queue is paused; new searches will wait.';
    if (queues.download.paused)
      return 'Download queue is paused; new downloads will wait.';
    return '';
  }

  get workQueueTitle(): string {
    if (this.webQueuesPaused) return 'Work queue — paused';
    if (this.webQueuePauseMessage) return 'Work queue — partially paused';
    return 'Work queue';
  }

  get canSelectProvenProfile(): boolean {
    return !this.destroyed && !this.profileBlockedReason && !this.testedLimitsSelected;
  }

  private get testedLimits(): DownloadLimits | null {
    const profile = this.youtubePace?.knownGoodProfile;
    if (!profile || ![profile.downloadConc, profile.searchConc, profile.maxPerWindow, profile.windowMs]
      .every(value => Number.isInteger(value) && value > 0)) return null;
    return { downloadConc: profile.downloadConc, searchConc: profile.searchConc,
      maxPerWindow: profile.maxPerWindow, windowMs: profile.windowMs };
  }

  private limitsMatch(snapshot: YoutubePaceSnapshot | null, target: DownloadLimits): boolean {
    return !!snapshot && snapshot.autoStep === false &&
      snapshot.downloadConc === target.downloadConc && snapshot.searchConc === target.searchConc &&
      snapshot.maxPerWindow === target.maxPerWindow && snapshot.windowMs === target.windowMs;
  }

  get testedLimitsSelected(): boolean {
    const target = this.testedLimits;
    return !!target && !!this.youtubePace?.webQueues && this.youtubePace?.acquisitionOwner?.state === 'available' &&
      this.limitsMatch(this.youtubePace, target);
  }

  get profileChangeBusy(): boolean {
    return this.selectingProvenProfile || !!this.profileUnconfirmedTarget;
  }

  get profileBlockedReason(): string {
    const pace = this.youtubePace;
    if (this.selectingProvenProfile) return 'Updating download limits…';
    if (this.profileUnconfirmedTarget) return 'Checking the server after an unconfirmed change. No repeat request will be sent.';
    if (!pace || !this.testedLimits) return 'Tested download limits are not available from the server.';
    if (pace.webProfileMode !== 'cli-proven') return 'The server uses custom settings. This control does not switch server modes.';
    if (this.ownerBlocksAcquisition) return this.acquisitionOwnerLabel;
    if (this.preparingDownloadRequest || pace.webAdmission?.running) return 'Wait for playlist preparation to finish.';
    if (this.savingDownloadLocation) return 'Wait for the download folder to finish saving.';
    if (this.resumingQueues) return 'Wait for the queue resume request to finish.';
    if (!pace.webQueues) return 'Queue status is unavailable. No settings change can be made yet.';
    if (!this.webQueuesPaused) return 'Both web queues must be paused before changing these limits. This control will not pause them.';
    if (pace.webQueues.search.active || pace.webQueues.download.active || pace.searchActive || pace.downloadActive || pace.webActivity?.active.length)
      return 'Wait for active web work to finish. Queued tracks can stay in the paused queues.';
    if (pace.coolRemainingMs > 0) return 'YouTube recovery cooldown is active. This control cannot bypass it.';
    if (pace.downloadConc <= 1 && pace.searchConc <= 1 && pace.maxPerWindow <= 8)
      return 'The YouTube safety limit is active. Verified recovery is required before increasing it.';
    if (pace.windowMs !== this.testedLimits.windowMs) return 'The server uses a different download-start interval. This control cannot change that interval.';
    return '';
  }

  selectProvenProfile(): void {
    if (!this.canSelectProvenProfile) return;
    const target = this.testedLimits!;
    this.selectingProvenProfile = true;
    this.profileActionError = '';
    this.profileRequestStartedAt = Date.now();
    this.profileStateVersion++;
    this.profileRequest = this.libraryService.selectProvenProfile()
      .pipe(timeout(20000), take(1), throwIfEmpty(() => new Error('Missing settings acknowledgement'))).subscribe({
      next: (snapshot) => {
        if (this.destroyed) return;
        if (!this.limitsMatch(snapshot, target)) {
          this.profileChangeUnconfirmed(new Error('Invalid settings acknowledgement'), target);
          return;
        }
        this.selectingProvenProfile = false;
        this.profileStateVersion++;
        // The mutation returns pace only, not queue/ownership telemetry.
        // Do not replace a full snapshot or claim another caller kept queues paused.
        if (this.youtubePace) this.youtubePace = { ...this.youtubePace, ...target, autoStep: false };
        this.profileReceipt('Download limits saved',
          'Tested download limits restored. This action did not resume queues, start downloads or change search options.');
        this.pollYoutubePace();
      },
      error: (err) => { if (!this.destroyed) this.profileChangeUnconfirmed(err, target); },
    });
  }

  private profileChangeUnconfirmed(error: any, target: DownloadLimits): void {
    this.selectingProvenProfile = false;
    this.profileStateVersion++;
    if ([400, 401, 403, 404, 409, 422, 429].includes(error?.status)) {
      this.profileActionError = 'Settings were not changed: ' +
        (typeof error?.error?.message === 'string' ? error.error.message : 'the server rejected the request.');
    } else {
      this.profileUnconfirmedTarget = target;
      this.profileActionError = 'The settings-change reply was not received or could not be verified. Checking current server settings; no repeat request will be sent.';
    }
    this.recordActivity(this.profileActionError);
    this.pollYoutubePace();
  }

  private profileReceipt(title: string, detail: string): void {
    this.message = detail;
    // A delayed observation must not replace acknowledgement of a newer action.
    if (!this.recentReceipt || this.recentReceipt.at <= this.profileRequestStartedAt)
      this.activityReceipt = { at: Date.now(), title, detail };
  }
  private coverageTimer: ReturnType<typeof setTimeout> | null = null;
  private scrollTimer: ReturnType<typeof setTimeout> | null = null;
  private focusedRowOffset = -1;
  private coverageInterval: ReturnType<typeof setInterval> | null = null;
  private readonly coverageWhileRunningMs = 60_000;
  private paceInterval: ReturnType<typeof setInterval> | null = null;
  private libraryDiscoveryInterval: ReturnType<typeof setInterval> | null = null;
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
    this.coverageChangesSub = this.trackService.coverageChanges$?.subscribe(() => {
      this.ngZone.run(() => this.scheduleCoverageRefresh(150));
    });
    this.restoreDownloadRequest();
    if (this.trackService.activeReady$) {
      this.readySub = this.trackService.activeReady$.subscribe((ready) => {
        this.liveQueueKnown = ready;
      });
    } else {
      this.liveQueueKnown = true;
    }
    this.refresh();
    this.loadDownloadLocation();
    this.checkSpotifyConnection();
    this.restoreOrStartLibrarySync();
    this.syncObservationInterval = setInterval(() => this.observeExternalSpotifySync(), 15000);
    this.startPacePolling();
    this.libraryDiscoveryInterval = setInterval(
      () => this.restoreOrStartLibrarySync(true),
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
      const key = this.trackKey(track.artist, track.name, track.spotifyUrl);
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
    this.destroyed = true;
    this.cancelChromeStatusRead();
    this.chromeConnectRequest?.unsubscribe();
    this.coverageRead?.unsubscribe();
    this.coverageChangesSub?.unsubscribe();
    if (this.fileCheckTimer) clearTimeout(this.fileCheckTimer);
    this.detailRead?.unsubscribe();
    this.enqueueRequest?.unsubscribe();
    this.downloadReceiptRead?.unsubscribe();
    this.resumeRequest?.unsubscribe();
    this.profileRequest?.unsubscribe();
    this.paceRead?.unsubscribe();
    this.liveSub?.unsubscribe();
    this.readySub?.unsubscribe();
    if (this.coverageTimer) clearTimeout(this.coverageTimer);
    if (this.scrollTimer) clearTimeout(this.scrollTimer);
    if (this.coverageInterval) clearInterval(this.coverageInterval);
    this.stopPacePolling();
    if (this.libraryDiscoveryInterval) clearInterval(this.libraryDiscoveryInterval);
    if (this.librarySyncPoll) clearInterval(this.librarySyncPoll);
    if (this.syncObservationInterval) clearInterval(this.syncObservationInterval);
  }

  get visiblePlaylists(): LibraryPlaylist[] {
    const playlists = this.data?.playlists || [];
    return this.sortPlaylists(playlists.filter(p => this.matchesPlaylistFilters(p)));
  }

  private matchesPlaylistFilters(p: LibraryPlaylist): boolean {
    const q = this.filter.trim().toLowerCase();
    if (this.hideComplete && this.isDone(p) && !p.failed && !this.statsOf(p).ripping) return false;
    return !q || p.name.toLowerCase().includes(q);
  }

  get focusedOptionId(): string | null {
    return this.focused && this.matchesPlaylistFilters(this.focused) &&
      this.data?.playlists.some(p => p.id === this.focused?.id) ? `pl-${this.focused.id}` : null;
  }

  clearPlaylistFilters(): void {
    this.filter = '';
    this.hideComplete = false;
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
    const processing = Math.min(
      queueLength,
      [...new Set(this.liveStats.values())].filter(
        (stats) => stats.downloading > 0 || stats.searching > 0,
      ).length,
    );
    const waiting =
      Math.max(0, queueLength - processing) + this.impliedWaitingPlaylistCount;
    return `Playlists: ${this.fmt(processing)} processing · ${this.fmt(waiting)} waiting`;
  }

  get impliedWaitingPlaylistCount(): number {
    // Only actual admissions count as queued; another playlist's work is not
    // evidence that an unsubmitted track is waiting.
    return 0;
  }

  get bulkActionsBlocked(): boolean {
    return (
      this.coverageIncomplete ||
      this.savingDownloadLocation ||
      this.profileChangeBusy ||
      this.ownerBlocksAcquisition ||
      !this.acquisitionOptionsValid ||
      this.preparingDownloadRequest ||
      this.hasQueuedWork ||
      this.youtubePace?.webAdmission?.running ||
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
    this.paceInterval = setInterval(() => this.pollYoutubePace(), 2000);
  }

  private stopPacePolling(): void {
    if (!this.paceInterval) return;
    clearInterval(this.paceInterval);
    this.paceInterval = null;
  }

  private pollYoutubePace(): void {
    if (this.destroyed || this.paceReadPending) return;
    this.observeDownloadRequest();
    if (this.chromeConnectionWaiting || (this.chromeConnectionNeeded && Date.now() - this.chromeLastCheckedAt > 30000)) {
      this.checkSpotifyConnection();
    }
    this.paceReadPending = true;
    const profileObservation = this.profileUnconfirmedTarget;
    const profileVersion = this.profileStateVersion;
    this.paceRead = this.libraryService.youtubePace().pipe(timeout(10000), take(1)).subscribe({
      next: (snap) => {
        this.paceReadPending = false;
        if (this.destroyed) return;
        if (profileVersion !== this.profileStateVersion) {
          this.pollYoutubePace();
          return;
        }
        this.youtubePace = snap;
        // Only a GET started after the missing reply can reconcile that action.
        if (profileObservation && this.profileUnconfirmedTarget === profileObservation &&
          [snap?.downloadConc, snap?.searchConc, snap?.maxPerWindow, snap?.windowMs]
            .every(value => typeof value === 'number' && Number.isInteger(value) && value > 0) && typeof snap?.autoStep === 'boolean') {
          this.profileUnconfirmedTarget = null;
          if (this.limitsMatch(snap, profileObservation)) {
            this.profileActionError = '';
            this.profileReceipt('Current download limits confirmed',
              'The server now reports the tested limits. The earlier reply was unconfirmed; no repeat change was sent.');
          } else {
            this.profileActionError = `The server reports ${snap.downloadConc} downloads + ${snap.searchConc} searches, ${snap.maxPerWindow} download starts per ${snap.windowMs / 60000} min. These do not match the requested tested limits. No repeat change was sent.`;
            this.recordActivity(this.profileActionError);
          }
        }
        if (this.resumeOutcomeUnknown && snap?.webQueues?.search.paused === false && snap?.webQueues?.download.paused === false) {
          this.resumeOutcomeUnknown = false;
          this.resumeConfirm = false;
          this.resumeError = '';
          this.message = 'Both web queues are now unpaused. No repeat resume request was sent.';
          this.activityReceipt = { at: Date.now(), title: 'Web queue state confirmed', detail: this.message };
          this.trackService.fetchActive();
        }
        if (this.liveApplyArgs) {
          this.applyLiveStores(
            this.liveApplyArgs.tracks,
            this.liveApplyArgs.progress,
            this.liveApplyArgs.playlists,
          );
        }
        // Keep the activity strip live even during metadata preparation and
        // delayed work, neither of which necessarily emits a track socket event.
      },
      error: () => {
        this.paceReadPending = false;
        if (this.destroyed) return;
        if (profileVersion !== this.profileStateVersion) {
          this.pollYoutubePace();
          return;
        }
        if (this.youtubePace)
          this.youtubePace = {
            ...this.youtubePace,
            acquisition: null,
            webAdmission: undefined,
            webQueues: null,
            acquisitionOwner: {
              state: 'unknown',
              phase: null,
              telemetryFresh: false,
            },
          };
      },
    });
  }

  checkSpotifyConnection(): void {
    if (this.destroyed || this.chromeCheckPending) return;
    this.chromeCheckPending = true;
    this.chromeLastCheckedAt = Date.now();
    this.chromeStatusRead = this.libraryService.spotifyConnection().pipe(timeout(5000), take(1)).subscribe({
      next: (state) => {
        if (this.destroyed) return;
        const wasWaiting = this.chromeApprovalObserved || this.spotifyConnection?.state === 'connecting';
        this.spotifyConnection = state;
        this.chromeCheckPending = false;
        if (state.state === 'connected' || state.state === 'connecting') this.chromeConnectConfirm = false;
        if (state.state === 'connecting') this.chromeApprovalObserved = true;
        else if (state.state !== 'unavailable') this.chromeApprovalObserved = false;
        if (wasWaiting && state.state === 'connected') this.chromeConnectionReady();
        if (wasWaiting && state.state === 'disconnected' && !this.chromeConnectionRequestPending) {
          this.chromeConnectionError = 'Chrome did not connect. No automatic retry will be made.';
        }
      },
      error: () => {
        if (this.destroyed) return;
        this.chromeCheckPending = false;
        this.spotifyConnection = { state: 'unavailable', connectedAt: null };
      },
    });
  }

  private cancelChromeStatusRead(): void {
    // Discard an older HTTP observation, never disconnect/reconnect the bridge.
    this.chromeStatusRead?.unsubscribe();
    this.chromeStatusRead = undefined;
    this.chromeCheckPending = false;
  }

  offerChromeConnection(): void {
    if (this.destroyed || !this.canOfferChromeConnection || this.spotifySyncBusy) return;
    this.chromeConnectConfirm = true;
    this.chromeConnectionError = '';
  }

  requestChromeConnection(): void {
    // Only this explicit confirmation handler may POST a connection request.
    if (this.destroyed || !this.chromeConnectConfirm || this.chromeConnectionWaiting) return;
    if (!this.canOfferChromeConnection || this.spotifySyncBusy) {
      this.chromeConnectConfirm = false;
      return;
    }
    this.cancelChromeStatusRead();
    this.chromeConnectConfirm = false;
    this.chromeConnectionRequestPending = true;
    this.chromeApprovalObserved = true;
    this.chromeConnectionError = '';
    this.error = '';
    this.activityReceipt = null;
    this.chromeConnectRequest = this.libraryService.connectSpotifyChrome().pipe(timeout(130000), take(1)).subscribe({
      next: (state) => {
        if (this.destroyed) return;
        this.cancelChromeStatusRead();
        this.chromeConnectionRequestPending = false;
        this.spotifyConnection = state;
        if (state.state === 'connected' || state.state === 'disconnected') this.chromeApprovalObserved = false;
        if (state.state === 'connected') this.chromeConnectionReady();
        else if (state.state !== 'connecting') this.chromeConnectionError = 'Connection could not be confirmed. Check connection before trying again.';
      },
      error: (err) => {
        if (this.destroyed) return;
        this.cancelChromeStatusRead();
        this.chromeConnectionRequestPending = false;
        this.chromeConnectionError = err?.error?.message || 'Chrome connection was not completed. No automatic retry will be made.';
        this.recordActivity(this.chromeConnectionError);
        this.checkSpotifyConnection();
      },
    });
  }

  private chromeConnectionReady(): void {
    this.chromeConnectionError = '';
    if (this.activityReceipt?.title === 'Chrome connected' && Date.now() - this.activityReceipt.at < 15000) return;
    this.activityReceipt = { at: Date.now(), title: 'Chrome connected', detail: chromeConnectionGuidance('connected') };
    this.recordActivity(this.activityReceipt.detail);
    // Connecting is not a Spotify sync. Never enqueue downloads or silently
    // re-run a saved sync outcome from this completion callback.
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

  trackKey(artist: string, name: string, spotifyUrl?: string): string {
    const id = spotifySourceId(spotifyUrl);
    if (id) return `spotify:${id}`;
    return `${(artist || '').toLowerCase()}|||${(name || '').toLowerCase()}`;
  }

  private detailFor(playlist: LibraryPlaylist): LibraryDetail | null {
    const detail = this.detail;
    if (!detail) return null;
    if (this.data?.coverage?.id && detail.coverage?.id !== this.data.coverage.id) return null;
    if (
      detail.playlist.id === playlist.id ||
      detail.playlist.uri === playlist.uri
    ) {
      return detail;
    }
    return null;
  }

  liveOf(track: LibraryTrack): (Track & { percent: number }) | undefined {
    const key = this.trackKey(track.artist, track.name, track.spotifyUrl);
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
    if (track.mediaVerification === 'checking') return 'checking';
    if (track.mediaVerification !== 'mismatch' && track.onDisk)
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
    return 'miss';
  }

  private isLibraryPipelineLive(): boolean {
    return (
      this.liveDownloading > 0 ||
      this.liveSearching > 0 ||
      (!this.webQueuesPaused && this.liveQueued > 0)
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
    if (this.isPlayable(track)) return '';
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
    if (Number.isInteger(row.networkAttempts) && row.networkAttempts! > 0)
      parts.push(`${row.networkAttempts} network failures`);
    if (Number.isInteger(row.operationAttempts) && row.operationAttempts! > 0)
      parts.push(`${row.operationAttempts} operation failures`);
    if (this.isNoCandidate(row))
      parts.push(
        'Search finished without a match. Use Search again to try these tracks again.',
      );
    return parts.join(' · ');
  }

  loadSearchEvidence(event: Event, track: LibraryTrack): void {
    if (
      !(event.target as HTMLDetailsElement).open ||
      track.searchEvidenceLoading ||
      track.searchEvidenceLoaded
    )
      return;
    track.searchEvidenceLoading = true;
    track.searchEvidenceError = '';
    this.libraryService.searchEvidence(track.artist, track.name, track.spotifyUrl).subscribe({
      next: ({ report }) => {
        track.searchEvidence = report;
        track.searchEvidenceLoaded = true;
        track.searchEvidenceLoading = false;
      },
      error: () => {
        track.searchEvidenceLoading = false;
        track.searchEvidenceError =
          'Could not load search evidence. Close and reopen to try again.';
      },
    });
  }

  searchReason(reason: string): string {
    return (
      (
        {
          match: 'passes checks',
          mismatch: 'wrong length',
          'missing-candidate': 'duration unavailable',
          'missing-title': 'title unavailable',
          'title-mismatch': 'wrong title',
          'artist-mismatch': 'artist not matched',
          'edition-mismatch': 'different edition',
          'previously-rejected': 'previously rejected',
        } as Record<string, string>
      )[reason] || reason
    );
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

  get focusedMissingCount(): number {
    if (!this.focused) return 0;
    const detail = this.detailFor(this.focused);
    // A historical miss may already be queued/running after an explicit retry.
    return detail
      ? detail.tracks.filter((track) => this.statusKind(track) === 'error')
          .length
      : this.statsOf(this.focused).failed;
  }

  isPlayable(track: LibraryTrack): boolean {
    if (track.mediaVerification === 'mismatch' || track.mediaVerification === 'checking') return false;
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
    const checking = this.checkingFiles(playlist);
    const active = downloading + searching + queued + retrying;
    const onDisk = focusedDetail?.playlist.onDisk ?? playlist.onDisk;
    const failed = playlist.failed || 0;
    const trackCount = playlist.trackCount;
    const percentOnDisk = trackCount
      ? Math.round((onDisk / trackCount) * 100)
      : 0;
    const percentAvailable = Math.max(playlist.percentAvailable, percentOnDisk);
    const done = !checking && trackCount > 0 && onDisk + failed >= trackCount;
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
        retrying -
        checking,
    );
    const copyable = Math.min(
      leftover,
      Math.max(0, (playlist.available || 0) - onDisk),
    );
    const pending = leftover - copyable;
    const ripping = active > 0;
    return {
      checking,
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
    const waiting = s.queued;
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
    const live = this.workSummary(
      s.downloading,
      s.searching,
      s.queued,
      s.retrying,
      compact,
    );
    const parts: string[] = [];
    if (s.needsRetry) {
      parts.push(`${this.fmt(s.needsRetry)} needs retry`);
    }
    if (s.pending) {
      parts.push(`${this.fmt(s.pending)} pending`);
    }
    if (live) parts.push(live);
    return parts.join(' · ');
  }

  playlistSubTitle(playlist: LibraryPlaylist): string {
    return this.coverageLine(playlist);
  }

  playlistOptionLabel(playlist: LibraryPlaylist): string {
    const remainder = [
      this.ownerSummary(playlist),
      this.coverageLine(playlist, true),
    ]
      .filter(Boolean)
      .join(' · ');
    return remainder ? `${playlist.name} · ${remainder}` : playlist.name;
  }

  ownerSummary(playlist: LibraryPlaylist): string {
    return [
      playlist.owner
        ? `Owner: ${playlist.owner.displayName || playlist.owner.id}`
        : '',
      playlist.personalizedFor ? `Made for ${playlist.personalizedFor}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  coverageLine(playlist: LibraryPlaylist, compact = false): string {
    const s = this.statsOf(playlist);
    if (s.checking) return `${s.onDisk} confirmed saved · ${s.checking} still to check`;
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
    const live = this.workSummary(
      this.liveDownloading,
      this.liveSearching,
      this.liveQueued,
      this.liveRetrying,
      true,
    );
    if (!pending) return live;
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
    if (stats.checking) return this.fileCheckNeedsAttention ? 'Not checked' : 'Checking files';
    const needed = this.youtubeNeeded(stats);
    if (needed) {
      if (!stats.pending && stats.queued) return this.activityLabel(playlist);
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
    const needed = stats.pending;
    if (!needed && stats.copyable) {
      return stats.copyable === 1
        ? 'Add 1 existing MP3 to this folder'
        : `Add ${this.fmt(stats.copyable)} existing MP3s to this folder`;
    }
    return `Queue ${this.fmt(needed)} for search & download`;
  }

  focusedActionHelp(playlist: LibraryPlaylist): string {
    const s = this.statsOf(playlist);
    const parts = [];
    if (s.pending) parts.push(`${this.fmt(s.pending)} not yet queued.`);
    if (s.copyable)
      parts.push(
        `${this.fmt(s.copyable)} existing MP3s can be added locally; no YouTube download.`,
      );
    if (s.queued)
      parts.push(
        `${this.fmt(s.queued)} already queued${this.webQueuesPaused ? ' — paused' : ''}; no need to add them again.`,
      );
    if (s.retrying) parts.push(`${this.fmt(s.retrying)} scheduled for later.`);
    return parts.join(' ');
  }

  private youtubeNeeded(stats: PlaylistView): number {
    return Math.max(
      0,
      stats.trackCount -
        stats.onDisk -
        stats.failed -
        stats.copyable -
        stats.needsRetry -
        stats.checking,
    );
  }

  private hydrateStalledErrors(): void {
    if (!this.data) return;
    for (const dump of this.data.playlists) {
      if (dump.skipped || this.checkingFiles(dump)) continue;
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
    if (kind === 'checking') return this.fileCheckNeedsAttention ? 'Not checked' : 'Checking local file';
    if (kind === 'rip') {
      const pct = this.statusPercent(track);
      return pct > 0 ? `Downloading ${pct}%` : 'Downloading';
    }
    if (kind === 'search') return 'Finding on YouTube';
    if (kind === 'queue')
      return this.webQueuesPaused ? 'Queued — paused' : 'Waiting';
    if (kind === 'scheduled') return 'Retry scheduled';
    if (kind === 'disk') return 'on disk';
    if (kind === 'error') return 'Missing';
    if (kind === 'retry') return 'Needs retry';
    if (kind === 'no-candidate') return 'No acceptable candidate';
    if (kind === 'copy') return 'copyable';
    if (track.mediaVerification === 'mismatch') return 'Needs matching version';
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
    if (this.destroyed) return;
    if (this.coverageTimer) clearTimeout(this.coverageTimer);
    this.coverageTimer = setTimeout(() => {
      if (this.destroyed) return;
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

  refresh(quiet = false, scanId?: string): void {
    if (this.destroyed) return;
    if (this.fileCheckTimer) clearTimeout(this.fileCheckTimer);
    const generation = ++this.coverageGeneration;
    this.coverageRead?.unsubscribe();
    if (!quiet) this.loading = true;
    if (!quiet && this.error === this.libraryLoadError) this.error = '';
    if (!quiet) {
      this.pollYoutubePace();
      // CLI writes durable state without websocket events. A manual refresh
      // must not leave old failed/retry rows overlaying a successful search.
      this.trackService.fetchActive();
    }
    // A recovered submission may synchronously start a newer coverage refresh.
    // Do not replace that read or restore its already-finished loading spinner.
    if (this.destroyed || generation !== this.coverageGeneration) return;
    this.coverageRead = (scanId ? this.libraryService.fetch(scanId) : quiet ? this.libraryService.fetch() : this.libraryService.fetch(undefined, true)).pipe(timeout(30000), take(1)).subscribe({
      next: (data) => {
        if (this.destroyed || generation !== this.coverageGeneration) return;
        if (!data || !Array.isArray(data.playlists) || !data.totals ||
            (data.coverage !== undefined && !validCoverageProgress(data.coverage)) ||
            (scanId && data.coverage?.id !== scanId)) {
          this.loading = false;
          if (scanId) {
            this.coverageObservationLost = true;
            this.observeFileCheck(scanId, 5000);
          } else {
            this.libraryLoadError = 'Could not read the saved-file check. Retry loading the saved library; no download has started.';
            this.error = this.libraryLoadError;
          }
          return;
        }
        if (this.error === this.libraryLoadError) this.error = '';
        this.libraryLoadError = '';
        // A newer quiet refresh can supersede a visible load. Whichever
        // response wins must finish its loading state, or the spinner sticks.
        this.loading = false;
        this.coverageObservationLost = false;
        if (data.coverage?.id && this.detail?.coverage?.id !== data.coverage.id) this.detail = null;
        this.data = data;
        this.clearStatsMemo();
        this.recomputeDiskTotal();
        this.hydrateStalledErrors();
        if (this.focused) {
          const next = data.playlists.find((p) => p.uri === this.focused?.uri);
          this.focused = next || this.focused;
          if (next) this.loadDetail(next, quiet);
          this.keepFocusedRowVisible();
        } else {
          const first = this.visiblePlaylists[0];
          if (first) this.focus(first, false, false);
        }
        if (data.coverage?.state === 'checking') this.observeFileCheck(data.coverage.id);
      },
      error: (err) => {
        if (this.destroyed || generation !== this.coverageGeneration) return;
        this.loading = false;
        if (scanId) {
          if (err?.status === 409) { this.refresh(true); return; }
          this.coverageObservationLost = true;
          this.observeFileCheck(scanId, 5000);
          return;
        }
        this.libraryLoadError = this.data
          ? 'Could not refresh saved playlists. Showing the last loaded library. Retry to check current saved files.'
          : 'Could not load saved playlists from Spooty. Retry loading the saved library; this does not sync Spotify or download files.';
        this.error = this.libraryLoadError;
        this.recordActivity(`Saved library read failed: ${err?.error?.message || err?.message || 'request failed'}`);
      },
    });
  }

  private observeFileCheck(id: string, delay = 2000): void {
    if (this.fileCheckTimer) clearTimeout(this.fileCheckTimer);
    this.fileCheckTimer = setTimeout(() => {
      this.fileCheckTimer = null;
      if (!this.destroyed && this.data?.coverage?.id === id) this.refresh(true, id);
    }, delay);
  }

  toggleMobileLibrary(): void {
    if (this.destroyed) return;
    if (this.mobileLibraryOpen) this.closeMobileLibrary();
    else {
      this.mobileLibraryOpen = true;
      this.navigationFocus = 'filter';
    }
  }

  closeMobileLibrary(event?: Event): void {
    if (this.destroyed || !this.mobileLibraryOpen) return;
    event?.preventDefault();
    event?.stopPropagation();
    this.mobileLibraryOpen = false;
    this.navigationFocus = 'toggle';
  }

  ngAfterViewChecked(): void {
    // Focus only after Angular has applied the disclosure/heading changes.
    // The latest user action wins; no timer survives teardown or a quick reopen.
    const destination = this.navigationFocus;
    this.navigationFocus = null;
    if (this.destroyed || !destination) return;
    const element = destination === 'filter'
      ? this.mobileLibraryOpen && this.playlistFilter?.nativeElement
      : destination === 'toggle'
        ? !this.mobileLibraryOpen && this.libraryToggle?.nativeElement
        : destination === 'list'
          ? this.plList?.nativeElement
          : !this.mobileLibraryOpen && this.detailTitle?.nativeElement;
    if (element) element.focus({ preventScroll: destination !== 'detail' });
  }

  focus(playlist: LibraryPlaylist, resync = true, userInitiated = true, navigation: 'open' | 'preview' = 'open'): void {
    if (this.destroyed) return;
    if (userInitiated && navigation === 'open' && this.mobileLibraryOpen) {
      this.mobileLibraryOpen = false;
      this.navigationFocus = 'detail';
    }
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
      if (this.destroyed) return;
      const list = this.plList?.nativeElement;
      if (!list) return;
      const focusedRow = list.querySelector(
        '.pl-row.is-focused',
      ) as HTMLElement | null;
      const runningRows = Array.from(
        list.querySelectorAll('.pl-row.is-running'),
      ) as HTMLElement[];
      const listRect = list.getBoundingClientRect();
      // On narrow screens the whole chooser scrolls, not just the list.
      const navigationRect = this.playlistNavigation?.nativeElement.getBoundingClientRect() || listRect;
      const inView = (row: HTMLElement) => {
        const rect = row.getBoundingClientRect();
        return (
          rect.top >= Math.max(listRect.top, navigationRect.top) - 2 &&
          rect.bottom <= Math.min(listRect.bottom, navigationRect.bottom) + 2
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
      const key = this.trackKey(track.artist, track.name, track.spotifyUrl);
      if (running(next.get(key)) && !running(prev.get(key))) return true;
    }
    return false;
  }

  loadDetail(playlist: LibraryPlaylist, quiet = false): void {
    if (this.destroyed) return;
    const location = this.locationGeneration;
    const generation = ++this.detailGeneration;
    this.detailRead?.unsubscribe();
    if (this.error === this.detailLoadError) this.error = '';
    this.detailLoadError = '';
    if (!quiet) {
      this.detailLoading = true;
      if (!this.detailFor(playlist)) {
        this.detail = null;
        this.clearStatsMemo();
      }
      const wrap = this.trackWrap?.nativeElement;
      if (wrap) wrap.scrollTop = 0;
    }
    const scanId = this.data?.coverage?.id;
    this.detailRead = (scanId ? this.libraryService.detail(playlist.id, scanId) : this.libraryService.detail(playlist.id)).pipe(timeout(30000), take(1)).subscribe({
      next: (detail) => {
        if (
          this.destroyed || generation !== this.detailGeneration ||
          this.focused?.id !== playlist.id ||
          location !== this.locationGeneration
        )
          return;
        if (scanId && (!validCoverageProgress(detail?.coverage) || detail.coverage.id !== scanId)) {
          this.detailLoading = false;
          this.detailLoadError = 'Could not read this playlist’s saved-file check. Retry loading its tracks; no download has started.';
          this.error = this.detailLoadError;
          return;
        }
        this.detail = detail;
        this.clearStatsMemo();
        this.detailLoading = false;
        this.rememberDumpFailures(playlist, detail);
        this.syncDetailFromLive();
        this.scheduleScrollActionable();
      },
      error: (err) => {
        if (
          this.destroyed || generation !== this.detailGeneration ||
          this.focused?.id !== playlist.id ||
          location !== this.locationGeneration
        )
          return;
        this.detailLoading = false;
        this.detailLoadError = this.detailFor(playlist)
          ? `Could not refresh tracks for “${playlist.name}”. Showing the last loaded track list. Retry to check current saved files.`
          : `Could not load tracks for “${playlist.name}” from Spooty. Retry loading this saved playlist; no Spotify sync or download will start.`;
        this.error = this.detailLoadError;
        this.recordActivity(`Saved track-list read failed: ${err?.error?.message || err?.message || 'request failed'}`);
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
          spotifyUrl: track.spotifyUrl,
        });
      }
    }
  }

  onFilterKey(event: KeyboardEvent): void {
    if (this.destroyed || event.isComposing || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey ||
      !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const items = this.visiblePlaylists;
    if (!items.length) return;
    event.preventDefault();
    this.focus(items[event.key === 'ArrowDown' ? 0 : items.length - 1], false, true, 'preview');
    this.navigationFocus = 'list';
  }

  onListKey(event: KeyboardEvent): void {
    if (this.destroyed || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const items = this.visiblePlaylists;
    if (!items.length) return;
    let nextIdx = items.findIndex((p) => p.uri === this.focused?.uri);
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      if (nextIdx >= 0) this.toggleCheck(items[nextIdx]);
      return;
    }
    if (event.key === 'Enter') {
      if (nextIdx < 0) return;
      event.preventDefault();
      this.mobileLibraryOpen = false;
      this.navigationFocus = 'detail';
      return;
    }
    if (event.key === 'ArrowDown') {
      nextIdx = Math.min(items.length - 1, nextIdx + 1);
    } else if (event.key === 'ArrowUp') {
      nextIdx = nextIdx < 0 ? items.length - 1 : Math.max(0, nextIdx - 1);
    } else if (event.key === 'Home') {
      nextIdx = 0;
    } else if (event.key === 'End') {
      nextIdx = items.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    this.focus(items[nextIdx], false, true, 'preview');
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
      this.destroyed ||
      !uris.length ||
      !!this.playlistActionBlockedReason
    )
      return;
    this.submitDownloadRequest(id => this.libraryService.download(uris, {
        maxSearches: this.maxSearches,
        networkRetries: this.networkRetries,
        ...retryOptions,
      }, id), uris);
  }

  downloadSelected(): void {
    if (this.bulkActionsBlocked) return;
    this.downloadUris([...this.selected]);
  }

  downloadRemaining(): void {
    if (this.destroyed || this.bulkActionsBlocked) return;
    this.submitDownloadRequest(id => this.libraryService.downloadRemaining({
      maxSearches: this.maxSearches,
      networkRetries: this.networkRetries,
    }, id));
  }

  private submitDownloadRequest(makeRequest: (id: string) => Observable<DownloadReceipt>, submittedUris?: string[]): void {
    let id: string;
    try { id = window.crypto.randomUUID(); }
    catch { this.error = 'Could not create a download request ID. Nothing was submitted.'; return; }
    this.downloadReceiptRead?.unsubscribe();
    this.downloadReceiptReadPending = false;
    this.downloadReceiptNextCheckAt = 0;
    this.downloadReceiptReadFailures = 0;
    this.pendingDownloadRequest = { id, uris: submittedUris ? [...submittedUris] : undefined };
    this.downloadRequestObserved = null;
    this.downloadReceiptStorageWarning = '';
    try { window.sessionStorage.setItem(DOWNLOAD_REQUEST_STORAGE, id); }
    catch { this.downloadReceiptStorageWarning = 'This browser cannot remember this submission after a reload. Keep this tab open while it is preparing.'; }
    this.enqueueing = true;
    this.message = '';
    this.activityReceipt = null;
    if (this.error === this.queueActionError) this.error = '';
    this.queueActionError = '';
    // The server can still finish after the HTTP reply is lost. Never replay
    // this POST automatically or describe an absent reply as a failed download.
    this.enqueueRequest = makeRequest(id).pipe(timeout(120000), take(1)).subscribe({
        next: (res) => {
          if (this.destroyed || this.pendingDownloadRequest?.id !== id) return;
          if (!validDownloadReceipt(res)) {
            this.downloadRequestUnconfirmed(new Error('Invalid queue acknowledgement'));
            return;
          }
          this.acceptDownloadReceipt(res, id);
        },
        error: (err) => { if (!this.destroyed && this.pendingDownloadRequest?.id === id) this.downloadRequestUnconfirmed(err); },
      });
  }

  private restoreDownloadRequest(): void {
    try {
      const id = window.sessionStorage.getItem(DOWNLOAD_REQUEST_STORAGE);
      if (validDownloadRequestId(id)) {
        this.pendingDownloadRequest = { id };
        this.downloadRequestObserved = 'unknown';
      }
    } catch { /* Storage may be unavailable; never submit anything to recover it. */ }
  }

  private clearDownloadRequest(id: string): void {
    if (this.pendingDownloadRequest?.id !== id) return;
    this.pendingDownloadRequest = null;
    this.downloadRequestObserved = null;
    this.downloadReceiptStorageWarning = '';
    this.downloadReceiptRead?.unsubscribe();
    this.downloadReceiptReadPending = false;
    try {
      if (window.sessionStorage.getItem(DOWNLOAD_REQUEST_STORAGE) === id) window.sessionStorage.removeItem(DOWNLOAD_REQUEST_STORAGE);
    } catch { /* Local receipt already handled. */ }
  }

  private acceptDownloadReceipt(res: DownloadReceipt, id: string, recovered = false, destination?: string): void {
    if (this.destroyed || this.pendingDownloadRequest?.id !== id) return;
    const submittedUris = this.pendingDownloadRequest.uris;
    this.clearDownloadRequest(id);
    this.enqueueRequest?.unsubscribe();
    this.enqueueing = false;
    if (this.error === this.queueActionError) this.error = '';
    this.queueActionError = '';
    this.message = `${recovered ? 'Recovered your earlier submission. ' : ''}${this.enqueueResultMessage(res)}`;
    if (destination && this.downloadLocation?.path && destination !== this.downloadLocation.path) this.message += ` Applied to ${destination}.`;
    this.activityReceipt = { at: Date.now(),
      title: res.queued ? `${this.fmt(res.queued)} ${res.queued === 1 ? 'track' : 'tracks'} added to the queue`
        : res.reused ? 'Existing MP3s added' : 'No new downloads queued', detail: this.message };
    this.queueOpen = false;
    if (submittedUris) this.selected = new Set([...this.selected].filter(uri => !submittedUris.includes(uri)));
    this.recordActivity(this.message);
    this.playlistService.fetch();
    this.refresh();
  }

  checkDownloadSubmission(): void {
    this.downloadReceiptNextCheckAt = 0;
    this.observeDownloadRequest();
  }

  private observeDownloadRequest(): void {
    if (this.destroyed || !this.pendingDownloadRequest || this.downloadReceiptReadPending || Date.now() < this.downloadReceiptNextCheckAt) return;
    const id = this.pendingDownloadRequest.id;
    this.downloadReceiptReadPending = true;
    this.downloadReceiptRead = this.libraryService.downloadRequestStatus(id).pipe(timeout(10000), take(1)).subscribe({
      next: status => {
        if (this.destroyed || this.pendingDownloadRequest?.id !== id) return;
        this.downloadReceiptReadPending = false;
        if (!validDownloadRequestStatus(status, id)) { this.downloadReceiptUnavailable(); return; }
        this.downloadReceiptReadFailures = 0;
        this.downloadReceiptNextCheckAt = 0;
        if (status.state === 'completed') {
          this.acceptDownloadReceipt(status.receipt!, id, true, status.destination);
        } else if (status.state === 'preparing') {
          this.downloadRequestObserved = 'preparing';
          if (this.error === this.queueActionError) this.error = '';
          this.queueActionError = '';
        } else {
          this.clearDownloadRequest(id);
          this.enqueueRequest?.unsubscribe();
          this.enqueueing = false;
          this.queueActionError = status.state === 'interrupted'
            ? 'Server restarted during submission. Some tracks may already be queued. Existing files and queued work are kept.'
            : 'Submission stopped while preparing tracks. Some tracks may already be queued. Existing files and queued work are kept.';
          this.error = this.queueActionError;
          this.recordActivity(this.queueActionError);
          this.playlistService.fetch();
          this.refresh();
        }
      },
      error: () => {
        if (this.destroyed || this.pendingDownloadRequest?.id !== id) return;
        this.downloadReceiptReadPending = false;
        this.downloadReceiptUnavailable();
      },
    });
  }

  private downloadReceiptUnavailable(): void {
    this.downloadRequestObserved = 'unknown';
    this.downloadReceiptReadFailures++;
    this.downloadReceiptNextCheckAt = Date.now() + Math.min(30000, 2000 * 2 ** Math.min(this.downloadReceiptReadFailures, 4));
    if (!this.enqueueing && !this.error) {
      this.queueActionError = 'Could not confirm your earlier download submission. Checking its saved result; no automatic repeat request will be sent.';
      this.error = this.queueActionError;
    }
  }

  private requestOutcomeMessage(error: any, action: string): string {
    // A server response can confirm rejection, not that the whole batch had no
    // side effects. Earlier entries may already have been admitted.
    if ([400, 401, 403, 404, 409, 422, 429].includes(error?.status)) {
      return `Request to ${action} was rejected. ${error?.error?.message || 'Check the current state before trying again.'} Checking the queue; any already accepted work is kept.`;
    }
    return `Could not confirm the request to ${action}. The server may still be working; checking current queue state. No automatic repeat request will be sent.`;
  }

  private downloadRequestUnconfirmed(error: any): void {
    this.enqueueing = false;
    this.downloadRequestObserved = 'unknown';
    this.queueActionError = this.requestOutcomeMessage(error, 'add tracks');
    this.error = this.queueActionError;
    this.recordActivity(this.queueActionError);
    this.playlistService.fetch();
    this.refresh();
    this.observeDownloadRequest();
  }

  private enqueueResultMessage(res: DownloadReceipt): string {
    const reused = res.reused || 0;
    const result = `${reused ? `Added ${reused} existing MP3s (no download) · ` : ''}Queued ${res.queued} · ${res.skipped - reused} unchanged (already saved, queued, or parked)`;
    return this.webQueuePauseMessage
      ? `${result}. ${this.webQueuePauseMessage}`
      : result;
  }

  resyncAll(): void {
    if (this.destroyed || this.spotifySyncBusy) return;
    if (!this.spotifySyncConnectionReady(false)) return;
    this.submitSpotifySync(this.libraryService.resyncAll(), false, 'saved-playlists');
  }

  private restoreOrStartLibrarySync(periodic = false): void {
    if (this.destroyed || this.spotifySyncBusy || this.syncRestorePending) return;
    // Background maintenance must not prompt to connect, overlap an observation,
    // or repeatedly submit doomed metadata work while Chrome is disconnected.
    if (periodic && (this.librarySyncPollInFlight ||
        (this.spotifyConnection && this.spotifyConnection.state !== 'connected'))) return;
    this.syncRestorePending = true;
    const generation = this.syncRequestGeneration;
    this.libraryService.syncLibraryStatus().pipe(timeout(10000)).subscribe({
      next: (status) => {
        this.syncRestorePending = false;
        if (this.destroyed || generation !== this.syncRequestGeneration) return;
        this.lastSyncObservationKey = syncObservationKey(status);
        this.librarySyncFinishedAt = status.finishedAt;
        if (status.running) {
          this.applySyncScope(status);
          this.librarySyncLabel = spotifySyncProgress(status);
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
        // A recent single-playlist refresh does not check for newly followed
        // playlists. Only a recent whole-library sync satisfies the timer.
        if (recentCompletedSync(status) && (!periodic || !status.scope || status.scope === 'library')) {
          this.applySyncScope(status);
          const result = spotifySyncResult(status);
          if (!this.recentReceipt) {
            this.activityReceipt = { at: Date.now(), ...result };
            this.message = result.detail;
          }
          return;
        }
        this.syncLibrary(true);
      },
      error: () => {
        this.syncRestorePending = false;
        if (this.destroyed || generation !== this.syncRequestGeneration) return;
        // An observation failure is not authority to submit another sync.
        this.librarySyncDegraded = true;
        this.syncNotice = 'Unable to check Spotify sync status. Saved library loaded.';
      },
    });
  }

  /** Observe sync started in another tab, or while this tab lost its connection.
   * This timer only reads status. It never starts sync or connects Chrome. */
  private observeExternalSpotifySync(): void {
    if (this.destroyed || this.spotifySyncBusy || this.syncRestorePending || this.librarySyncPoll || this.librarySyncPollInFlight) return;
    this.librarySyncPollInFlight = true;
    const generation = this.syncRequestGeneration;
    this.libraryService.syncLibraryStatus().pipe(timeout(10000)).subscribe({
      next: status => {
        this.librarySyncPollInFlight = false;
        if (this.destroyed || this.spotifySyncBusy || generation !== this.syncRequestGeneration) return;
        const changed = syncObservationKey(status) !== this.lastSyncObservationKey;
        this.lastSyncObservationKey = syncObservationKey(status);
        if (status.running) {
          this.librarySyncQuiet = true;
          this.clearSyncActionError();
          this.applySyncScope(status);
          this.librarySyncLabel = spotifySyncProgress(status);
          this.pollLibrarySync();
        } else if (changed && status.finishedAt) {
          this.librarySyncQuiet = true;
          this.finishSpotifySync(status);
        }
      },
      error: () => { this.librarySyncPollInFlight = false; },
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
    if (this.destroyed || this.spotifySyncBusy) return;
    if (!this.spotifySyncConnectionReady(quiet)) return;
    this.submitSpotifySync(this.libraryService.syncLibrary(), quiet, 'library');
  }

  private spotifySyncConnectionReady(quiet: boolean): boolean {
    if (!this.spotifyConnection || this.spotifyConnection.state === 'connected') return true;
    this.librarySyncDegraded = true;
    this.syncNotice = `Chrome bridge ${this.spotifyConnection.state}. Saved library available.`;
    // Show the existing explicit confirmation on the first click. Merely
    // opening it does not call /connect; quiet maintenance never opens it.
    if (!quiet && this.canOfferChromeConnection) this.offerChromeConnection();
    return false;
  }

  private applySyncScope(status: Pick<SpotifySyncStatus, 'running' | 'scope' | 'playlistId' | 'playlistName'>): void {
    this.syncScope = status.scope || 'library';
    this.syncPlaylistId = status.playlistId || null;
    this.syncingLibrary = status.running;
    this.resyncing = status.running && this.syncScope === 'playlist';
    this.resyncAllRunning = status.running && this.syncScope === 'saved-playlists';
    this.resyncTarget = status.playlistName || '';
  }

  private submitSpotifySync(request: Observable<{ started: boolean; already?: boolean; operationId?: string }>, quiet: boolean, scope: SpotifySyncStatus['scope'], playlist?: LibraryPlaylist): void {
    this.syncRequestGeneration++;
    this.syncRequest = { operationId: null, startedAt: Date.now(), responseLost: false };
    this.applySyncScope({ running: true, scope, playlistId: playlist?.id, playlistName: playlist?.name });
    this.librarySyncConnectionLost = false;
    this.librarySyncLabel = scope === 'playlist' ? `Updating ${playlist?.name || 'playlist'} from Spotify…` : scope === 'saved-playlists' ? 'Checking saved playlists…' : 'Getting your playlist library from Spotify…';
    if (!quiet) this.activityReceipt = null;
    this.librarySyncQuiet = quiet;
    this.syncNotice = '';
    if (!quiet) {
      this.message = '';
      this.error = '';
      this.syncActionError = '';
    }
    request.pipe(timeout(10000)).subscribe({
      next: acknowledgement => {
        if (this.destroyed) return;
        if (this.syncRequest) this.syncRequest.operationId = acknowledgement.operationId || null;
        this.pollLibrarySync();
      },
      error: (err) => {
        if (this.destroyed) return;
        this.applySyncScope({ running: false, scope });
        this.librarySyncLabel = '';
        this.librarySyncDegraded = true;
        const text =
          err?.error?.message || err?.message || 'Spotify library sync failed';
        this.syncNotice = this.quietSyncNotice(text, [text]);
        if (/CDP|Chrome (?:bridge|connection)/i.test(text)) this.checkSpotifyConnection();
        // A dropped POST response may have started the job. Observe it before
        // offering another submission; never manufacture success or failure.
        if (err?.status === 0 || err?.name === 'TimeoutError') {
          if (this.syncRequest) this.syncRequest.responseLost = true;
          this.applySyncScope({ running: true, scope, playlistId: playlist?.id, playlistName: playlist?.name });
          this.librarySyncConnectionLost = true;
          this.pollLibrarySync();
        } else {
          this.syncRequest = null;
          if (!quiet) this.error = this.syncActionError = spotifySyncProblem(text);
        }
      },
    });
  }

  private pollLibrarySync(): void {
    if (this.destroyed) return;
    if (this.librarySyncPoll) clearInterval(this.librarySyncPoll);
    const poll = () => {
      if (this.librarySyncPollInFlight) return;
      this.librarySyncPollInFlight = true;
      this.libraryService.syncLibraryStatus().pipe(timeout(10000)).subscribe({
        next: (status) => {
          this.librarySyncPollInFlight = false;
          if (this.destroyed) return;
          this.librarySyncConnectionLost = false;
          this.lastSyncObservationKey = syncObservationKey(status);
          this.applySyncScope(status);
          this.librarySyncLabel = status.running
            ? spotifySyncProgress(status)
            : '';
          if (status.running) {
            // Positive observation supersedes a lost submission response. Follow
            // the real operation and use its identity for the completion receipt.
            if (this.syncRequest) {
              this.syncRequest.operationId = status.operationId || null;
              this.syncRequest.responseLost = false;
            }
            return;
          }
          if (this.librarySyncPoll) clearInterval(this.librarySyncPoll);
          this.librarySyncPoll = null;
          if (this.syncRequest && !syncResultMatchesRequest(status, this.syncRequest)) {
            this.syncRequest = null;
            this.librarySyncDegraded = true;
            if (!this.librarySyncQuiet) this.activityReceipt = null;
            this.syncNotice = 'The server is reachable, but this sync request was not confirmed. The saved library is available. Sync again to start a new check.';
            if (!this.librarySyncQuiet) this.error = this.syncActionError = this.syncNotice;
            if (!this.librarySyncQuiet || !this.recentReceipt) this.message = this.syncNotice;
            return;
          }
          this.syncRequest = null;
          this.finishSpotifySync(status);
        },
        error: () => {
          this.librarySyncPollInFlight = false;
          if (this.destroyed) return;
          this.librarySyncConnectionLost = true;
          this.librarySyncLabel = '';
        },
      });
    };
    this.librarySyncPoll = setInterval(poll, 2000);
    poll();
  }

  private finishSpotifySync(status: SpotifySyncStatus): void {
    this.librarySyncConnectionLost = false;
    this.applySyncScope(status);
    this.librarySyncLabel = '';
    this.librarySyncFinishedAt = status.finishedAt;
    const result = spotifySyncResult(status);
    if (status.errors.length || !status.finishedAt) {
      this.librarySyncDegraded = true;
      if (!this.librarySyncQuiet) this.activityReceipt = null;
      const text = status.errors.at(-1) || 'Spotify sync interrupted by server restart';
      this.syncNotice = this.quietSyncNotice(text, status.errors);
      if (status.failureKind === 'connection' || /CDP|Chrome (?:bridge|connection)/i.test(text)) this.checkSpotifyConnection();
      if (!this.librarySyncQuiet) this.error = this.syncActionError = result.detail;
      if (!this.librarySyncQuiet || !this.recentReceipt) this.message = result.detail;
    } else {
      this.clearSyncActionError();
      this.librarySyncDegraded = false;
      this.syncNotice = '';
      if ((!this.librarySyncQuiet || !this.recentReceipt) &&
          (status.discovered + status.changed > 0 || !this.librarySyncQuiet || status.scope === 'playlist' || status.scope === 'saved-playlists')) {
        this.message = result.detail;
        this.activityReceipt = { at: Date.now(), ...result };
      }
    }
    // Names/owners/order can change even when no track list changed.
    this.refresh(true);
    this.playlistService.fetch();
  }

  private clearSyncActionError(): void {
    if (this.error === this.syncActionError) this.error = '';
    this.syncActionError = '';
  }


  downloadFocused(): void {
    if (this.focused && !this.focused.skipped) {
      this.downloadUris([this.focused.uri]);
    }
  }

  retryFocusedOutcomes(): void {
    if (this.focused && !this.focused.skipped) {
      this.downloadUris([this.focused.uri], {
        retryMissing: true,
        retryNoCandidate: true,
      });
    }
  }

  retryFocusedErrors(): void {
    if (this.focused && !this.focused.skipped && this.focusedErrorCount > 0) {
      this.downloadUris([this.focused.uri], { retryErrors: true });
    }
  }

  resyncFocused(quiet = false): void {
    if (this.destroyed || !this.focused || this.spotifySyncBusy) return;
    if (!this.spotifySyncConnectionReady(quiet)) return;
    this.submitSpotifySync(this.libraryService.syncPlaylist(this.focused.id), quiet, 'playlist', this.focused);
  }

  playlistEmptyMessage = playlistEmptyMessage;
  playlistFreshness = playlistFreshness;
  keptLocallyCheckedAt = keptLocallyCheckedAt;
}
