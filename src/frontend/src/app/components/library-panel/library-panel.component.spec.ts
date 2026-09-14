import {
  ComponentFixture,
  TestBed,
  discardPeriodicTasks,
  fakeAsync,
  tick,
} from '@angular/core/testing';
import { BehaviorSubject, NEVER, of, throwError } from 'rxjs';
import { HttpClient } from '@angular/common/http';

import {
  LibraryDetail,
  LibraryListResponse,
  LibraryPlaylist,
} from '../../models/library-playlist';
import { Playlist } from '../../models/playlist';
import { Track, TrackStatusEnum } from '../../models/track';
import {
  LibraryService,
  YoutubePaceSnapshot,
} from '../../services/library.service';
import {
  PlaylistService,
  PlaylistStatusEnum,
  PlaylistUi,
} from '../../services/playlist.service';
import { TrackService } from '../../services/track.service';
import { LibraryPanelComponent } from './library-panel.component';

type QueuePlaylist = Playlist & PlaylistUi;

describe('LibraryPanelComponent', () => {
  let fixture: ComponentFixture<LibraryPanelComponent>;
  let component: LibraryPanelComponent;
  it('separates the retained guarded CLI evidence from a live trial and disables profile activation', () => {
    render({
      playlists: [],
      totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 },
    });
    component.youtubePace = {
      downloadConc: 4,
      searchConc: 1,
      downloadActive: 0,
      searchActive: 0,
      maxPerWindow: 240,
      downloadsInWindow: 240,
      windowMs: 600000,
      coolRemainingMs: 0,
      autoStep: false,
      reason: null,
      webProfileMode: 'cli-proven',
      knownGoodProfile: {
        id: 'fixture',
        downloadConc: 4,
        searchConc: 1,
        maxPerWindow: 240,
        batchSize: 8,
        searchBuffer: 192,
        maxSearches: 10,
        networkRetries: 5,
        windowMs: 600000,
        downloadClient: 'mweb',
        searchClient: 'web_creator',
        measuredMp3PerMinute: 9.437068403019246,
        baselineMp3PerMinute: 3,
        measuredWindowMinutes: 941.07615,
        measuredAt: '2026-09-13T23:48:37.095Z',
        evidence:
          'Completed duration-guarded CLI run; whole-run throughput including cached URLs and exception recovery, not full recording-identity proof',
        webBenchmark: 'not yet run',
      },
      acquisition: {
        at: '2026-09-13T01:04:00Z',
        verifiedNewMp3: 400,
        remainingUnique: 12000,
        diskGB: 57,
        mp3PerMinute: 10,
        baselineMultiple: 10 / 3,
        elapsedMinutes: 40,
        currentProfileMp3PerMinute: 18,
        currentProfileBaselineMultiple: 6,
        contentReviewPendingUnique: 0,
        held: false,
        maxSearches: 10,
        networkRetryLimit: 5,
        networkRetries: 2,
        operationRetries: 3,
        candidateDisqualifications: 90,
        noAcceptableCandidate: 4,
        eta: {
          continuous: '2026-09-13T13:00:00Z',
          buffered25: '2026-09-13T16:00:00Z',
          provisional: true,
        },
        pace: {
          downloadConc: 4,
          searchConc: 1,
          downloadActive: 4,
          searchActive: 0,
          maxPerWindow: 240,
          downloadsInWindow: 240,
          windowMs: 600000,
          coolRemainingMs: 0,
        },
      },
    };
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('.ingest-profile');
    expect(panel.textContent).toContain('240 admissions / 10 min');
    expect(panel.textContent).toContain('9.44 MP3/min');
    expect(panel.textContent).toContain('3.15× baseline');
    expect(panel.textContent).toContain('941.1 minutes');
    expect(panel.textContent).toContain('14 Sep, 06:48 Bangkok');
    expect(panel.textContent).not.toContain(
      'predates the current guarded workflow',
    );
    expect(panel.textContent).toMatch(/4 download\s*\+ 1 search processes/);
    expect(panel.textContent).toContain(
      'Web execution has not yet been benchmarked',
    );
    const cliBanner = fixture.nativeElement.querySelector(
      '.acquisition-banner',
    );
    expect(cliBanner.textContent).toContain('Current trial 18.00 MP3/min');
    expect(cliBanner.textContent).toContain('6.00× baseline');
    expect(cliBanner.textContent).toContain('(provisional)');
    expect(cliBanner.textContent).toMatch(/Whole run\s+10.00 MP3\/min/);
    expect(cliBanner.textContent).toContain('13 Sep, 20:00 Bangkok');
    expect(cliBanner.textContent).toContain('13 Sep, 23:00 Bangkok');
    expect(cliBanner.textContent).toContain('240 download admissions / 10 min');
    expect(cliBanner.textContent).toContain('10 ranked candidates');
    expect(cliBanner.textContent).toContain('2 network retries');
    expect(cliBanner.textContent).toContain('3 operation retries');
    expect(cliBanner.textContent).toContain('4 no acceptable candidate');
    expect(cliBanner.textContent).toMatch(
      /Actual CLI:\s*4 download\s*\+ 1 search processes/,
    );
    expect(panel.querySelector('button').disabled).toBeTrue();
    expect(component.canSelectProvenProfile).toBeFalse();
  });
  let libraryService: jasmine.SpyObj<LibraryService>;
  let playlistService: jasmine.SpyObj<PlaylistService> & {
    all$: BehaviorSubject<QueuePlaylist[]>;
  };
  let trackService: {
    all$: BehaviorSubject<Track[]>;
    progress$: BehaviorSubject<Record<number, number>>;
    activeReady$: BehaviorSubject<boolean>;
    rememberError: jasmine.Spy;
    hydrateErrors: jasmine.Spy;
    ingestLibraryErrors: jasmine.Spy;
    fetchActive: jasmine.Spy;
  };

  const playlist = (
    id: string,
    name: string,
    values: Partial<LibraryPlaylist> = {},
  ): LibraryPlaylist => ({
    uri: `spotify:playlist:${id}`,
    id,
    name,
    rank: 1,
    skipped: false,
    trackCount: 10,
    onDisk: 0,
    available: 0,
    percentOnDisk: 0,
    percentAvailable: 0,
    file: `${name}.json`,
    spotifyUrl: `https://open.spotify.com/playlist/${id}`,
    failed: 0,
    ...values,
  });

  const detail = (item: LibraryPlaylist): LibraryDetail => ({
    playlist: item,
    tracks:
      item.id === 'processing'
        ? [
            {
              n: 1,
              artist: 'Artist',
              name: 'Retrying track',
              onDisk: false,
              available: false,
              error: 'Temporary YouTube failure: socket timed out',
              missing: false,
            },
          ]
        : item.id === 'searching'
          ? [
              {
                n: 1,
                artist: 'Search Artist',
                name: 'Search track',
                onDisk: false,
                available: false,
              },
            ]
          : item.id === 'mixed'
            ? [
                {
                  n: 1,
                  artist: 'Saved',
                  name: 'On disk one',
                  onDisk: true,
                  available: true,
                  filename: 'Saved - On disk one.mp3',
                },
                {
                  n: 2,
                  artist: 'Saved',
                  name: 'On disk two',
                  onDisk: true,
                  available: true,
                  filename: 'Saved - On disk two.mp3',
                },
                {
                  n: 3,
                  artist: 'Search Artist',
                  name: 'Search track',
                  onDisk: false,
                  available: false,
                },
              ]
            : item.id === 'mozart-a'
              ? [
                  {
                    n: 66,
                    artist:
                      'Wolfgang Amadeus Mozart, Andrew Smith, Joshua Pierce',
                    name: 'Sonata for Violin and Piano in E-Flat Major, K. 380: III. Rondeau',
                    onDisk: false,
                    available: false,
                  },
                ]
              : item.id === 'mozart-b'
                ? [
                    {
                      n: 1,
                      artist:
                        'Wolfgang Amadeus Mozart, Andrew Smith, Joshua Pierce',
                      name: 'Sonata for Violin and Piano in E-Flat Major, K. 380: III. Rondeau',
                      onDisk: true,
                      available: true,
                      filename:
                        'Wolfgang Amadeus Mozart, Andrew Smith, Joshua Pierce - Sonata.mp3',
                    },
                  ]
                : item.id === 'queued'
                  ? [
                      {
                        n: 1,
                        artist: 'Artist',
                        name: 'Queued track',
                        onDisk: false,
                        available: false,
                      },
                    ]
                  : item.id === 'evidence'
                    ? [
                        {
                          n: 1,
                          artist: 'Saved',
                          name: 'On disk song',
                          onDisk: true,
                          available: true,
                          filename: 'Saved - On disk song.mp3',
                        },
                        {
                          n: 2,
                          artist: 'Pending',
                          name: 'Not yet',
                          onDisk: false,
                          available: false,
                          filename: 'Pending - Not yet.mp3',
                        },
                        {
                          n: 3,
                          artist: 'Copy',
                          name: 'Elsewhere',
                          onDisk: false,
                          available: true,
                          filename: 'Copy - Elsewhere.mp3',
                        },
                      ]
                    : [],
  });

  beforeEach(async () => {
    libraryService = jasmine.createSpyObj<LibraryService>('LibraryService', [
      'fetch',
      'download',
      'detail',
      'resync',
      'resyncAll',
      'resyncAllStatus',
      'downloadRemaining',
      'syncLibrary',
      'syncLibraryStatus',
      'youtubePace',
    ]);

    const playlistSpies = jasmine.createSpyObj<PlaylistService>(
      'PlaylistService',
      [
        'fetch',
        'getTrackCount',
        'getCompletedTrackCount',
        'getStatus$',
        'toggleCollapsed',
        'delete',
        'retryFailed',
        'setActive',
      ],
    );
    playlistService = Object.assign(playlistSpies, {
      all$: new BehaviorSubject<QueuePlaylist[]>([]),
    });
    playlistService.getTrackCount.and.returnValue(of(1));
    playlistService.getCompletedTrackCount.and.returnValue(of(0));
    playlistService.getStatus$.and.returnValue(
      of(PlaylistStatusEnum.InProgress),
    );

    trackService = {
      all$: new BehaviorSubject<Track[]>([]),
      progress$: new BehaviorSubject<Record<number, number>>({}),
      activeReady$: new BehaviorSubject(true),
      rememberError: jasmine.createSpy('rememberError'),
      hydrateErrors: jasmine.createSpy('hydrateErrors'),
      ingestLibraryErrors: jasmine.createSpy('ingestLibraryErrors'),
      fetchActive: jasmine.createSpy('fetchActive'),
    };

    libraryService.syncLibrary.and.returnValue(
      throwError(() => new Error('Spotify unavailable')),
    );
    libraryService.syncLibraryStatus.and.returnValue(
      of({
        running: false,
        done: 0,
        total: 0,
        discovered: 0,
        changed: 0,
        errors: [],
        current: '',
        startedAt: null,
        finishedAt: null,
      }),
    );
    libraryService.youtubePace.and.returnValue(
      of({
        searchConc: 1,
        downloadConc: 1,
        searchActive: 0,
        downloadActive: 0,
        maxPerWindow: 8,
        downloadsInWindow: 0,
        windowMs: 600000,
        coolRemainingMs: 0,
        autoStep: false,
        reason: null,
        acquisitionOwner: {
          state: 'available',
          phase: null,
          telemetryFresh: false,
        },
      }),
    );
    libraryService.detail.and.callFake((id) => {
      const item = component.data?.playlists.find((p) => p.id === id);
      return of(detail(item!));
    });

    await TestBed.configureTestingModule({
      imports: [LibraryPanelComponent],
      providers: [
        { provide: LibraryService, useValue: libraryService },
        { provide: PlaylistService, useValue: playlistService },
        { provide: TrackService, useValue: trackService },
      ],
    }).compileComponents();
  });

  afterEach(() => component?.ngOnDestroy());

  function render(data: LibraryListResponse): void {
    libraryService.fetch.and.returnValue(of(data));
    fixture = TestBed.createComponent(LibraryPanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('retains ownership and holds all acquisition actions with stale CLI telemetry', () => {
    const p = playlist('held', 'Held work', { failed: 1 });
    render({
      playlists: [p],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });
    component.focus(p, false);
    component.youtubePace = {
      ...component.youtubePace!,
      acquisition: null,
      acquisitionOwner: {
        state: 'owned',
        phase: 'unknown',
        telemetryFresh: false,
      },
    };
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('.acquisition-owner-banner')
        .textContent,
    ).toContain('CLI owns YouTube — live telemetry unavailable');
    expect(component.bulkActionsBlocked).toBeTrue();
    expect(component.canSelectProvenProfile).toBeFalse();
    const retry = fixture.nativeElement.querySelector(
      '.retry-outcomes',
    ) as HTMLButtonElement;
    expect(retry.disabled).toBeTrue();
    component.downloadFocused();
    component.retryFocusedOutcomes();
    component.downloadRemaining();
    expect(libraryService.download).not.toHaveBeenCalled();
    expect(libraryService.downloadRemaining).not.toHaveBeenCalled();
    expect(component.paceLine()).not.toContain('YouTube 1+1');
  });

  it('distinguishes recovery, draining, and unknown ownership without starting work', () => {
    render({
      playlists: [],
      totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 },
    });
    for (const phase of ['waiting-for-recovery', 'draining'] as const) {
      component.youtubePace = {
        ...component.youtubePace!,
        acquisitionOwner: { state: 'owned', phase, telemetryFresh: true },
      };
      expect(component.ownerBlocksAcquisition).toBeTrue();
      expect(component.acquisitionOwnerLabel).toContain(
        phase === 'draining' ? 'draining current work' : 'waiting for recovery',
      );
    }
    component.youtubePace = {
      ...component.youtubePace!,
      acquisitionOwner: {
        state: 'unknown',
        phase: null,
        telemetryFresh: false,
      },
    };
    expect(component.bulkActionsBlocked).toBeTrue();
    expect(component.acquisitionGuardText).toContain('ownership');
  });

  it('shows exhausted candidates as needs-action without inventing a scheduled retry', () => {
    const p = playlist('exhausted', 'Exhausted search', { trackCount: 1 });
    playlistService.all$.next([
      {
        id: 991,
        name: p.name,
        spotifyUrl: p.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 881,
        name: 'Version',
        artist: 'Artist',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.RetryWaiting,
        playlistId: 991,
        error:
          'No acceptable duration-matched YouTube candidate in the configured search results',
        searchLimit: 10,
        networkAttempts: 0,
        operationAttempts: 0,
      },
    ]);
    libraryService.detail.and.returnValue(
      of({
        playlist: p,
        tracks: [
          {
            n: 0,
            name: 'Version',
            artist: 'Artist',
            onDisk: false,
            available: false,
          },
        ],
      }),
    );
    render({
      playlists: [p],
      totals: { playlists: 1, tracks: 1, onDisk: 0, available: 0 },
    });
    component.focus(p, false);
    fixture.detectChanges();
    const t = component.detail!.tracks[0];
    expect(component.trackStatusLabel(t)).toBe('No acceptable candidate');
    expect(component.liveRetrying).toBe(0);
    expect(component.hasQueuedWork).toBeFalse();
    expect(component.statsOf(p).needsRetry).toBe(1);
    expect(component.statsOf(p).done).toBeFalse();
    expect(
      fixture.nativeElement.querySelector('.tracks').textContent,
    ).not.toContain('Retry scheduled');
    expect(component.candidateEvidence(t)).toContain(
      'Candidate depth 10 · 0 network failures · 0 operation failures',
    );
    expect(
      fixture.nativeElement.querySelector('.retry-outcomes').textContent,
    ).toContain('1 exhausted searches');
  });

  it('requires a retry deadline for typed retry state and respects physical success', () => {
    render({
      playlists: [],
      totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 },
    });
    const track = {
      name: 'A',
      artist: 'B',
      onDisk: false,
      available: false,
      acquisitionState: 'retry' as const,
      retryAt: null as number | null,
    };
    expect(component.statusKind(track)).toBe('retry');
    track.retryAt = Date.now() + 60000;
    expect(component.statusKind(track)).toBe('scheduled');
    track.retryAt = Date.now() - 1000;
    expect(component.statusKind(track)).toBe('queue');
    expect(
      component.statusKind({
        ...track,
        acquisitionState: 'no-candidate',
        onDisk: true,
      }),
    ).toBe('disk');
  });

  it('keeps CLI journal evidence visible over a legacy idle websocket row', () => {
    render({
      playlists: [],
      totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 },
    });
    spyOn(component, 'liveOf').and.returnValue({
      id: 1,
      name: 'Version',
      artist: 'Artist',
      spotifyUrl: '',
      youtubeUrl: '',
      status: TrackStatusEnum.Error,
      percent: 0,
      searchLimit: 0,
    });
    expect(
      component.candidateEvidence({
        name: 'Version',
        artist: 'Artist',
        onDisk: false,
        available: false,
        acquisitionState: 'no-candidate',
        searchLimit: 10,
        networkAttempts: 0,
        operationAttempts: 0,
      }),
    ).toContain(
      'Candidate depth 10 · 0 network failures · 0 operation failures',
    );
  });

  it('keeps saved-library download usable while Spotify discovery runs in the background', () => {
    const p = playlist('saved-metadata', 'Saved metadata', { trackCount: 1 });
    libraryService.download.and.returnValue(of({ queued: 0, skipped: 1 }));
    render({
      playlists: [p],
      totals: { playlists: 1, tracks: 1, onDisk: 0, available: 0 },
    });
    component.syncingLibrary = true;
    component.selected = new Set([p.uri]);
    fixture.detectChanges();
    expect(component.bulkActionsBlocked).toBeFalse();
    component.downloadSelected();
    expect(libraryService.download).toHaveBeenCalledWith([p.uri], {
      maxSearches: 10,
      networkRetries: 5,
    });
    expect(component.message).toContain('Queued 0 · 1 unchanged');
  });

  it('sends explicit retry flags only from the retry action and keeps depth separate', () => {
    const p = playlist('retry', 'Retry work', { trackCount: 1, failed: 1 });
    libraryService.download.and.returnValue(of({ queued: 1, skipped: 0 }));
    render({
      playlists: [p],
      totals: { playlists: 1, tracks: 1, onDisk: 0, available: 0 },
    });
    component.focus(p, false);
    component.maxSearches = 20;
    component.networkRetries = 2;
    component.downloadFocused();
    expect(libraryService.download).toHaveBeenCalledWith([p.uri], {
      maxSearches: 20,
      networkRetries: 2,
    });
    component.retryFocusedOutcomes();
    expect(libraryService.download).toHaveBeenCalledWith([p.uri], {
      maxSearches: 20,
      networkRetries: 2,
      retryMissing: true,
      retryNoCandidate: true,
    });
  });

  it('retries operational failures explicitly without reopening Missing or exhausted searches', () => {
    const p = playlist('failures', 'Failed work', { trackCount: 3, failed: 1 });
    libraryService.detail.and.returnValue(
      of({
        playlist: p,
        tracks: [
          {
            n: 0,
            name: 'Failed',
            artist: 'Artist',
            onDisk: false,
            available: false,
            acquisitionState: 'failed',
            error: 'Network retries exhausted',
            missing: false,
          },
          {
            n: 1,
            name: 'Exhausted',
            artist: 'Artist',
            onDisk: false,
            available: false,
            acquisitionState: 'no-candidate',
            missing: false,
          },
          {
            n: 2,
            name: 'Missing',
            artist: 'Artist',
            onDisk: false,
            available: false,
            acquisitionState: 'missing',
            missing: true,
          },
        ],
      }),
    );
    libraryService.download.and.returnValue(of({ queued: 1, skipped: 2 }));
    render({
      playlists: [p],
      totals: { playlists: 1, tracks: 3, onDisk: 0, available: 0 },
    });
    component.focus(p, false);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector(
      '.retry-errors',
    ) as HTMLButtonElement;
    expect(button.textContent).toContain('Retry 1 failed');
    expect(
      fixture.nativeElement.querySelector('.retry-outcomes').textContent,
    ).toContain('1 exhausted searches');
    button.click();
    expect(libraryService.download).toHaveBeenCalledWith([p.uri], {
      maxSearches: 10,
      networkRetries: 5,
      retryErrors: true,
    });
    const options = libraryService.download.calls.mostRecent().args[1]!;
    expect(options.retryMissing).toBeUndefined();
    expect(options.retryNoCandidate).toBeUndefined();
    component.youtubePace = {
      ...component.youtubePace!,
      acquisitionOwner: {
        state: 'owned',
        phase: 'draining',
        telemetryFresh: false,
      },
    };
    fixture.detectChanges();
    expect(
      (
        fixture.nativeElement.querySelector(
          '.retry-errors',
        ) as HTMLButtonElement
      ).disabled,
    ).toBeTrue();
    component.retryFocusedErrors();
    expect(libraryService.download).toHaveBeenCalledTimes(1);
  });

  it('blocks malformed candidate and network retry settings before any request', () => {
    render({
      playlists: [],
      totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 },
    });
    for (const [depth, retries] of [
      [0, 5],
      [51, 5],
      [1.5, 5],
      [10, -1],
      [10, 21],
      [10, NaN],
    ]) {
      component.maxSearches = depth;
      component.networkRetries = retries;
      component.downloadUris(['spotify:playlist:test']);
      component.downloadRemaining();
      expect(component.acquisitionOptionsValid).toBeFalse();
    }
    expect(libraryService.download).not.toHaveBeenCalled();
    expect(libraryService.downloadRemaining).not.toHaveBeenCalled();
  });

  it('fails closed after an ownership refresh fails instead of retaining permission to enqueue', () => {
    render({
      playlists: [],
      totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 },
    });
    expect(component.ownerBlocksAcquisition).toBeFalse();
    libraryService.youtubePace.and.returnValue(
      throwError(() => new Error('unavailable')),
    );
    (component as any).pollYoutubePace();
    expect(component.youtubePace?.acquisitionOwner?.state).toBe('unknown');
    expect(component.ownerBlocksAcquisition).toBeTrue();
    component.downloadUris(['spotify:playlist:test']);
    expect(libraryService.download).not.toHaveBeenCalled();
  });

  it('preserves explicit retry intent in the actual HTTP request body', () => {
    const http = jasmine.createSpyObj<HttpClient>('HttpClient', ['post']);
    const service = new LibraryService(http);
    service.download(['spotify:playlist:a']);
    expect(http.post).toHaveBeenCalledWith('/api/library/download', {
      uris: ['spotify:playlist:a'],
    });
    service.download(['spotify:playlist:a'], {
      retryMissing: true,
      retryNoCandidate: true,
      maxSearches: 30,
      networkRetries: 0,
    });
    expect(http.post).toHaveBeenCalledWith('/api/library/download', {
      uris: ['spotify:playlist:a'],
      retryMissing: true,
      retryNoCandidate: true,
      maxSearches: 30,
      networkRetries: 0,
    });
    service.downloadRemaining({ maxSearches: 20, networkRetries: 5 });
    expect(http.post).toHaveBeenCalledWith('/api/library/download-remaining', {
      maxSearches: 20,
      networkRetries: 5,
    });
    service.download(['spotify:playlist:a'], { retryErrors: true });
    expect(http.post).toHaveBeenCalledWith('/api/library/download', {
      uris: ['spotify:playlist:a'],
      retryErrors: true,
    });
  });

  it('sorts processing, partial, untouched, then completed by default', () => {
    const processing = playlist('processing', 'Processing', {
      onDisk: 9,
      available: 9,
      percentOnDisk: 90,
      percentAvailable: 90,
      failed: 1,
    });
    const partial = playlist('partial', 'Partial', {
      onDisk: 4,
      available: 4,
      percentOnDisk: 40,
      percentAvailable: 40,
    });
    const untouched = playlist('untouched', 'Untouched');
    const completed = playlist('completed', 'Completed', {
      onDisk: 10,
      available: 10,
      percentOnDisk: 100,
      percentAvailable: 100,
    });

    playlistService.all$.next([
      {
        id: 101,
        name: processing.name,
        spotifyUrl: processing.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 501,
        artist: 'Artist',
        name: 'Retrying track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Downloading,
        playlistId: 101,
      },
    ]);

    render({
      playlists: [completed, untouched, processing, partial],
      totals: { playlists: 4, tracks: 40, onDisk: 23, available: 23 },
    });

    expect(component.visiblePlaylists.map((p) => p.name)).toEqual([
      'Processing',
      'Untouched',
      'Partial',
      'Completed',
    ]);
  });

  it('sorts partial before untouched when no live search or download queue is present', () => {
    const partial = playlist('partial', 'Partial', {
      onDisk: 4,
      available: 4,
      percentOnDisk: 40,
      percentAvailable: 40,
    });
    const untouched = playlist('untouched', 'Untouched');
    const completed = playlist('completed', 'Completed', {
      onDisk: 10,
      available: 10,
      percentOnDisk: 100,
      percentAvailable: 100,
    });

    render({
      playlists: [completed, untouched, partial],
      totals: { playlists: 3, tracks: 30, onDisk: 14, available: 14 },
    });

    expect(component.visiblePlaylists.map((p) => p.name)).toEqual([
      'Partial',
      'Untouched',
      'Completed',
    ]);
    expect(
      fixture.nativeElement.querySelector('.state-pill.is-needs')?.textContent,
    ).toContain('needed');
  });

  it('shows live retry work instead of the historical finished state', () => {
    const processing = playlist('processing', 'Processing', {
      onDisk: 9,
      available: 9,
      percentOnDisk: 90,
      percentAvailable: 90,
      failed: 1,
    });

    playlistService.all$.next([
      {
        id: 101,
        name: processing.name,
        spotifyUrl: processing.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 501,
        artist: 'Artist',
        name: 'Retrying track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Downloading,
        playlistId: 101,
      },
    ]);

    render({
      playlists: [processing],
      totals: { playlists: 1, tracks: 10, onDisk: 9, available: 9 },
    });

    const row = fixture.nativeElement.querySelector('.pl-row') as HTMLElement;
    expect(row.classList).toContain('is-ripping');
    expect(row.classList).not.toContain('is-done');
    expect(row.querySelector('.state-pill.is-rip')?.textContent).toContain(
      'Downloading',
    );
    expect(row.querySelector('.state-pill.is-done')).toBeNull();

    const detail = fixture.nativeElement.querySelector(
      '.detail-head',
    ) as HTMLElement;
    expect(detail.querySelector('.done-badge.is-wip')?.textContent).toContain(
      'Downloading',
    );
    expect(detail.querySelector('.done-banner')).toBeNull();
    expect(detail.textContent).not.toContain('Retry 1 missing');
  });

  it('moves the initial detail focus to the first live playlist', () => {
    const staticFirst = playlist('static-first', 'Static first', {
      onDisk: 1,
      available: 1,
      percentOnDisk: 10,
      percentAvailable: 10,
    });
    const processing = playlist('processing', 'Processing', {
      onDisk: 9,
      available: 9,
      percentOnDisk: 90,
      percentAvailable: 90,
    });

    render({
      playlists: [staticFirst, processing],
      totals: { playlists: 2, tracks: 20, onDisk: 10, available: 10 },
    });
    expect(component.focused?.id).toBe('static-first');

    playlistService.all$.next([
      {
        id: 101,
        name: processing.name,
        spotifyUrl: processing.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 501,
        artist: 'Artist',
        name: 'Retrying track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 101,
      },
    ]);
    fixture.detectChanges();

    expect(component.focused?.id).toBe('processing');
    expect(component.visiblePlaylists[0].id).toBe('processing');
  });

  it('labels an operational failure as retryable rather than missing', () => {
    const processing = playlist('processing', 'Processing');

    render({
      playlists: [processing],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    const track = component.detail!.tracks[0];
    expect(component.statusKind(track)).toBe('retry');
    expect(component.trackStatusLabel(track)).toBe('Needs retry');
    expect(
      fixture.nativeElement.querySelector('.pill.retry')?.textContent,
    ).toContain('Needs retry');
    expect(fixture.nativeElement.querySelector('.pill.miss')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.track-err')?.textContent,
    ).toContain('Temporary YouTube failure');
    expect(
      fixture.nativeElement.querySelector('.track-err')?.textContent,
    ).not.toContain('Not found on YouTube');
    expect(component.statsOf(processing).needsRetry).toBe(1);
    expect(component.statsOf(processing).pending).toBe(9);
    expect(
      (
        fixture.nativeElement.querySelector('.pl-row .pl-sub')?.textContent ||
        ''
      ).replace(/\s+/g, ' '),
    ).toContain('1 needs retry');
    expect(
      (
        fixture.nativeElement.querySelector('.pl-row .pl-sub')?.textContent ||
        ''
      ).replace(/\s+/g, ' '),
    ).not.toContain('1 pending');
  });

  it('presents a delayed search retry as scheduled live work', () => {
    const processing = playlist('processing', 'Processing');
    playlistService.all$.next([
      {
        id: 101,
        name: processing.name,
        spotifyUrl: processing.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 501,
        artist: 'Artist',
        name: 'Retrying track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.RetryWaiting,
        playlistId: 101,
        error: 'Temporary YouTube failure; search retry 1/3 in 15m',
      },
    ]);

    render({
      playlists: [processing],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    const stats = component.statsOf(processing);
    expect(stats.active).toBe(1);
    expect(stats.retrying).toBe(1);
    expect(stats.ripping).toBe(true);
    expect(component.hasQueuedWork).toBe(true);
    expect(component.activityLabel(processing)).toBe('Retry scheduled');
    expect(component.globalActivitySummary()).toBe('9 pending · 1 retry');

    const track = component.detail!.tracks[0];
    expect(component.statusKind(track)).toBe('scheduled');
    expect(component.trackStatusLabel(track)).toBe('Retry scheduled');
    expect(
      fixture.nativeElement.querySelector('.pill.retry')?.textContent,
    ).toContain('Retry scheduled');
    expect(
      fixture.nativeElement.querySelector('.sidebar-activity')?.textContent,
    ).toContain('1 retry');
    expect(fixture.nativeElement.querySelector('tr.is-wip')).toBeNull();
  });

  it('guards selected bulk work while a queue is live and reports skipped work truthfully', () => {
    const processing = playlist('processing', 'Processing');
    playlistService.all$.next([
      {
        id: 101,
        name: processing.name,
        spotifyUrl: processing.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 501,
        artist: 'Artist',
        name: 'Retrying track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 101,
      },
    ]);
    libraryService.download.and.returnValue(of({ queued: 1, skipped: 2 }));

    render({
      playlists: [processing],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });
    component.selected = new Set([processing.uri]);
    fixture.detectChanges();

    const selectedDownload = [
      ...fixture.nativeElement.querySelectorAll('.sidebar-actions .btn'),
    ].find((button: HTMLButtonElement) =>
      button.textContent?.trim().startsWith('Download'),
    ) as HTMLButtonElement;
    const bulkDownload = fixture.nativeElement.querySelector(
      '.sidebar-actions .btn-primary',
    ) as HTMLButtonElement;
    expect(selectedDownload.disabled).toBe(true);
    expect(bulkDownload.disabled).toBe(true);
    expect(
      fixture.nativeElement.querySelector('.queue-guard')?.textContent,
    ).toContain('Queue is live');
    expect(fixture.nativeElement.querySelector('#queue-guard')).not.toBeNull();
    expect(selectedDownload.getAttribute('aria-describedby')).toBe(
      'queue-guard',
    );
    expect(bulkDownload.getAttribute('aria-describedby')).toBe('queue-guard');

    trackService.all$.next([]);
    fixture.detectChanges();
    expect(selectedDownload.disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('.queue-guard')).toBeNull();
    expect(selectedDownload.getAttribute('aria-describedby')).toBeNull();
    expect(bulkDownload.getAttribute('aria-describedby')).toBeNull();
    const actionLabels = [
      ...fixture.nativeElement.querySelectorAll('.sidebar-actions button'),
    ].map((button: HTMLButtonElement) => button.textContent?.trim());
    expect(actionLabels[0]).toBe('Search & download needed');
    expect(actionLabels.indexOf('Search & download needed')).toBeLessThan(
      actionLabels.findIndex((label) => label?.startsWith('Download')),
    );
    component.downloadUris([processing.uri]);

    expect(component.message).toBe(
      'Queued 1 · 2 unchanged (already saved, queued, or parked)',
    );
    expect(component.message).not.toContain('skipped 2 already on disk');
  });

  it('does not enable bulk search/download until the live queue has been fetched', () => {
    trackService.activeReady$.next(false);
    const open = playlist('open', 'Open work');
    render({
      playlists: [open],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    const bulk = fixture.nativeElement.querySelector(
      '.sidebar-actions .btn-primary',
    ) as HTMLButtonElement;
    expect(component.hasQueuedWork).toBe(false);
    expect(component.liveQueueKnown).toBe(false);
    expect(component.bulkActionsBlocked).toBe(true);
    expect(bulk.disabled).toBe(true);
    expect(
      fixture.nativeElement.querySelector('.queue-guard')?.textContent,
    ).toContain('Checking live queue');
    expect(bulk.getAttribute('aria-describedby')).toBe('queue-guard');

    trackService.activeReady$.next(true);
    fixture.detectChanges();
    expect(component.liveQueueKnown).toBe(true);
    expect(component.bulkActionsBlocked).toBe(false);
    expect(bulk.disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('.queue-guard')).toBeNull();
  });

  it('shows a truthful loading phase before Spotify returns the playlist total', () => {
    libraryService.syncLibrary.and.returnValue(of({ started: true }));
    libraryService.syncLibraryStatus.and.returnValue(
      of({
        running: true,
        done: 0,
        total: 0,
        discovered: 0,
        changed: 0,
        errors: [],
        current: '',
        startedAt: '2026-09-11T00:00:00.000Z',
        finishedAt: null,
      }),
    );

    render({
      playlists: [playlist('saved', 'Saved playlist')],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    expect(component.librarySyncLabel).toBe('Loading Spotify playlists…');
  });

  it('orders live searching ahead of queued and retry-only playlists', () => {
    const retryOnly = playlist('retry-only', 'Retry only', {
      rank: 1,
      onDisk: 47,
      available: 47,
      percentOnDisk: 94,
      percentAvailable: 94,
    });
    const queuedLots = playlist('queued-lots', 'Queued lots', {
      rank: 2,
      trackCount: 131,
      onDisk: 0,
      available: 0,
    });
    const searching = playlist('searching', 'Searching now', {
      rank: 3,
      onDisk: 1,
      available: 1,
      percentOnDisk: 2,
      percentAvailable: 2,
    });
    const partial = playlist('partial', 'Partial', {
      rank: 4,
      onDisk: 4,
      available: 4,
      percentOnDisk: 40,
      percentAvailable: 40,
    });

    playlistService.all$.next([
      {
        id: 1,
        name: retryOnly.name,
        spotifyUrl: retryOnly.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
      {
        id: 2,
        name: queuedLots.name,
        spotifyUrl: queuedLots.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
      {
        id: 3,
        name: searching.name,
        spotifyUrl: searching.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 11,
        artist: 'Artist',
        name: 'Retry track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.RetryWaiting,
        playlistId: 1,
      },
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
      {
        id: 13,
        artist: 'Artist',
        name: 'Search track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
    ]);

    render({
      playlists: [retryOnly, queuedLots, searching, partial],
      totals: { playlists: 4, tracks: 201, onDisk: 52, available: 52 },
    });

    expect(component.visiblePlaylists.map((p) => p.name)).toEqual([
      'Searching now',
      'Queued lots',
      'Retry only',
      'Partial',
    ]);
    expect(component.focused?.name).toBe('Searching now');
  });

  it('labels retry-scheduled playlist work instead of calling it downloading', () => {
    const processing = playlist('processing', 'Processing', {
      trackCount: 50,
      onDisk: 47,
      available: 47,
      percentOnDisk: 94,
      percentAvailable: 94,
    });
    playlistService.all$.next([
      {
        id: 101,
        name: processing.name,
        spotifyUrl: processing.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 501,
        artist: 'Artist',
        name: 'Retrying track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.RetryWaiting,
        playlistId: 101,
        error: 'Temporary YouTube failure; search retry 1/3 in 15m',
      },
    ]);

    render({
      playlists: [processing],
      totals: { playlists: 1, tracks: 10, onDisk: 9, available: 9 },
    });

    const action = [
      ...fixture.nativeElement.querySelectorAll('.detail-actions button'),
    ].find((button: HTMLButtonElement) => button.disabled) as HTMLButtonElement;
    expect(action.textContent).toContain('1 retry');
    expect(action.textContent).toContain('2 pending');
    expect(action.textContent).toContain('47/50');
    expect(action.textContent).not.toContain('Downloading');
    expect(component.activityLabel(processing)).toBe('Retry scheduled');
  });

  it('does not scan coverage every few seconds while work is only queued', () => {
    const processing = playlist('processing', 'Processing');
    const queuePlaylist = {
      id: 101,
      name: processing.name,
      spotifyUrl: processing.spotifyUrl,
      active: false,
      isTrack: false,
      createdAt: 1,
      collapsed: false,
    };
    playlistService.all$.next([queuePlaylist]);
    trackService.all$.next([
      {
        id: 501,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 101,
      },
    ]);

    render({
      playlists: [processing],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });
    expect(
      (
        component as unknown as {
          coverageInterval: ReturnType<typeof setInterval> | null;
        }
      ).coverageInterval,
    ).toBeNull();

    trackService.all$.next([
      {
        id: 501,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 101,
      },
    ]);
    fixture.detectChanges();
    expect(
      (
        component as unknown as {
          coverageInterval: ReturnType<typeof setInterval> | null;
        }
      ).coverageInterval,
    ).not.toBeNull();

    trackService.all$.next([
      {
        id: 501,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 101,
      },
    ]);
    fixture.detectChanges();
    expect(
      (
        component as unknown as {
          coverageInterval: ReturnType<typeof setInterval> | null;
        }
      ).coverageInterval,
    ).toBeNull();
  });

  it('refreshes coverage when a running download leaves the live set', fakeAsync(() => {
    const processing = playlist('processing', 'Processing');
    playlistService.all$.next([
      {
        id: 101,
        name: processing.name,
        spotifyUrl: processing.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 501,
        artist: 'Artist',
        name: 'Downloading track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Downloading,
        playlistId: 101,
      },
    ]);

    render({
      playlists: [processing],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });
    const fetches = libraryService.fetch.calls.count();

    trackService.all$.next([]);
    fixture.detectChanges();
    tick(500);
    expect(libraryService.fetch.calls.count()).toBeGreaterThan(fetches);
    discardPeriodicTasks();
  }));

  it('lists only running search/download processes in the in-progress banner', () => {
    const searching = playlist('searching', 'Searching now');
    const retryOnly = playlist('retry-only', 'Retry only');
    playlistService.all$.next([
      {
        id: 3,
        name: searching.name,
        spotifyUrl: searching.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
      {
        id: 1,
        name: retryOnly.name,
        spotifyUrl: retryOnly.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 11,
        artist: 'Retry Artist',
        name: 'Retry track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.RetryWaiting,
        playlistId: 1,
        error: 'Temporary YouTube failure; search retry 1/3 in 15m',
      },
      {
        id: 12,
        artist: 'Queued Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 3,
      },
      {
        id: 13,
        artist: 'Search Artist',
        name: 'Search track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
    ]);

    render({
      playlists: [retryOnly, searching],
      totals: { playlists: 2, tracks: 20, onDisk: 0, available: 0 },
    });

    const banner = fixture.nativeElement.querySelector(
      '.rip-banner',
    ) as HTMLElement;
    expect(banner).not.toBeNull();
    const title = fixture.nativeElement.querySelector(
      '.detail-title',
    ) as HTMLElement;
    expect(
      banner.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(banner.textContent).toContain('Search track');
    expect(banner.textContent).not.toContain('Retry track');
    expect(banner.textContent).not.toContain('Queued track');
    expect(banner.textContent).toContain('1 searching');
    expect(banner.querySelector('.rip-meta')?.textContent?.trim()).toBe(
      'Finding on YouTube',
    );
    expect(banner.textContent).not.toMatch(/\bfinding\b/);
    expect(banner.textContent).not.toContain('waiting');
    expect(banner.textContent).not.toContain('retry');
    expect(component.activeRips.map((track) => track.name)).toEqual([
      'Search track',
    ]);
    expect(component.globalActivitySummary()).toBe(
      '1 search · 18 waiting · 1 retry',
    );
    expect(component.runningActivitySummary()).toBe('1 searching');
    const wip = fixture.nativeElement.querySelector('tr.is-wip') as HTMLElement;
    expect(wip?.textContent).toContain('Search track');
    expect(wip?.textContent).not.toContain('Retry track');

    const searchingRow = [
      ...fixture.nativeElement.querySelectorAll('.pl-row'),
    ].find((row: HTMLElement) => row.textContent?.includes('Searching now')) as
      | HTMLElement
      | undefined;
    const retryRow = [
      ...fixture.nativeElement.querySelectorAll('.pl-row'),
    ].find((row: HTMLElement) => row.textContent?.includes('Retry only')) as
      | HTMLElement
      | undefined;
    expect(searchingRow?.querySelector('.state-pill.is-rip')).not.toBeNull();
    expect(searchingRow?.querySelector('.wip-spin')).not.toBeNull();
    expect(retryRow?.querySelector('.state-pill.is-wait')).not.toBeNull();
    expect(retryRow?.querySelector('.wip-spin')).toBeNull();
    expect(banner.textContent).toContain('Searching now');
    expect(banner.querySelector('button.rip-row')).not.toBeNull();
  });

  it('caps extra Searching rows to the live pace so stale searches are not in-progress processes', () => {
    const searching = playlist('searching', 'Searching now');
    playlistService.all$.next([
      {
        id: 3,
        name: searching.name,
        spotifyUrl: searching.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 11,
        artist: 'Cam Cole',
        name: 'Desire',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
      {
        id: 12,
        artist: 'Queensryche',
        name: 'Silent Lucidity',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
      {
        id: 13,
        artist: 'Billy Idol',
        name: 'Rebel Yell',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
    ]);

    render({
      playlists: [searching],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    expect(component.liveSearching).toBe(1);
    expect(component.liveQueued).toBe(2);
    expect(component.runningActivitySummary()).toBe('1 searching');
    expect(component.globalActivitySummary()).toContain('1 search');
    expect(component.globalActivitySummary()).not.toContain('3 search');
    expect(component.activityLabel(searching)).toBe('Searching');
    const banner = fixture.nativeElement.querySelector(
      '.rip-banner',
    ) as HTMLElement;
    expect(banner.textContent).toContain('1 searching');
    expect(banner.textContent).toContain('Rebel Yell');
    expect(banner.textContent).not.toContain('Desire');
    expect(banner.textContent).not.toContain('Silent Lucidity');
    expect(component.activeRips.map((track) => track.name)).toEqual([
      'Rebel Yell',
    ]);
    expect(trackService.fetchActive).toHaveBeenCalled();
  });

  it('does not treat leftover Searching rows as in-progress during a safety-floor cooldown', () => {
    const searching = playlist('searching', 'Searching now');
    libraryService.youtubePace.and.returnValue(
      of({
        searchConc: 1,
        downloadConc: 1,
        searchActive: 0,
        downloadActive: 0,
        maxPerWindow: 8,
        downloadsInWindow: 1,
        windowMs: 600000,
        coolRemainingMs: 18 * 60 * 1000,
        autoStep: false,
        reason: 'FLOOR COOLDOWN downloadConc ERROR: bot-check',
        acquisitionOwner: {
          state: 'available',
          phase: null,
          telemetryFresh: false,
        },
      }),
    );
    playlistService.all$.next([
      {
        id: 3,
        name: searching.name,
        spotifyUrl: searching.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 13,
        artist: 'Artist',
        name: 'Search track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
    ]);

    render({
      playlists: [searching],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    expect(component.liveSearching).toBe(0);
    expect(component.runningActivitySummary()).toBe('');
    expect(component.activityLabel(searching)).not.toBe('Searching');
    expect(component.activityLabel(searching)).toContain('waiting');
    expect(fixture.nativeElement.querySelector('.rip-banner')).toBeNull();
    expect(fixture.nativeElement.querySelector('.sidebar-running')).toBeNull();
  });

  it('refetches active tracks when YouTube pace is running work the live store lacks', () => {
    const queued = playlist('queued', 'Waiting leftovers');
    libraryService.youtubePace.and.returnValue(
      of({
        searchConc: 1,
        downloadConc: 3,
        searchActive: 1,
        downloadActive: 2,
        maxPerWindow: 48,
        downloadsInWindow: 16,
        windowMs: 600000,
        coolRemainingMs: 0,
        autoStep: false,
        reason: 'manual recover lastGood 3+1/48',
        acquisitionOwner: {
          state: 'available',
          phase: null,
          telemetryFresh: false,
        },
      }),
    );
    playlistService.all$.next([
      {
        id: 4,
        name: queued.name,
        spotifyUrl: queued.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 21,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 4,
      },
    ]);

    render({
      playlists: [queued],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    expect(component.liveDownloading).toBe(0);
    expect(component.liveSearching).toBe(0);
    expect(component.runningActivitySummary()).toBe('');
    expect(fixture.nativeElement.querySelector('.rip-banner')).toBeNull();
    expect(trackService.fetchActive).toHaveBeenCalled();
  });

  it('names waiting leftover on the focused ripping action, not only Searching', () => {
    const searching = playlist('searching', 'Searching now');
    playlistService.all$.next([
      {
        id: 3,
        name: searching.name,
        spotifyUrl: searching.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 13,
        artist: 'Artist',
        name: 'Search track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
    ]);

    render({
      playlists: [searching],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    const action = (
      fixture.nativeElement.querySelector('.detail-actions .btn-lg')
        ?.textContent || ''
    ).replace(/\s+/g, ' ');
    expect(action).toContain('1 search');
    expect(action).toContain('9 waiting');
    expect(action).toContain('0/10');
    expect(action).not.toContain('Searching · 0/10');
    expect(component.activityLabel(searching)).toBe('Searching');
    const option = fixture.nativeElement.querySelector(
      '.pl-row',
    ) as HTMLElement;
    expect(option.getAttribute('aria-label')).toContain('Searching now');
    expect(option.getAttribute('aria-label')).toContain('waiting');
  });

  it('opens the running playlist from the in-progress banner', () => {
    const searching = playlist('searching', 'Searching now');
    const queued = playlist('queued', 'Queued lots');
    playlistService.all$.next([
      {
        id: 3,
        name: searching.name,
        spotifyUrl: searching.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
      {
        id: 2,
        name: queued.name,
        spotifyUrl: queued.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 13,
        artist: 'Search Artist',
        name: 'Search track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
      {
        id: 12,
        artist: 'Queued Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [queued, searching],
      totals: { playlists: 2, tracks: 20, onDisk: 0, available: 0 },
    });

    component.focus(queued, false);
    fixture.detectChanges();
    expect(component.focused?.name).toBe('Queued lots');

    const row = fixture.nativeElement.querySelector(
      'button.rip-row',
    ) as HTMLButtonElement;
    expect(row).not.toBeNull();
    expect(row.getAttribute('aria-label')).toContain('Searching now');
    expect(row.textContent).toContain('Search track');
    expect(row.textContent).toContain('Searching now');
    row.click();
    fixture.detectChanges();
    expect(component.focused?.name).toBe('Searching now');
    expect(libraryService.resync).not.toHaveBeenCalled();
  });

  it('does not treat queued-only work as an in-progress process', () => {
    const queued = playlist('queued', 'Queued lots');
    playlistService.all$.next([
      {
        id: 2,
        name: queued.name,
        spotifyUrl: queued.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [queued],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    expect(fixture.nativeElement.querySelector('.rip-banner')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.sidebar-activity .wip-spin'),
    ).toBeNull();
    expect(fixture.nativeElement.querySelector('.pl-row .wip-spin')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.state-pill.is-wait')?.textContent,
    ).toMatch(/waiting/i);
    expect(
      fixture.nativeElement.querySelector('.state-pill.is-wait')?.textContent,
    ).not.toContain('Queued');
    expect(
      fixture.nativeElement.querySelector('.state-pill.is-rip'),
    ).toBeNull();
    expect(component.hasQueuedWork).toBe(true);
    expect(component.runningNow(queued)).toBe(false);
  });

  it('does not apply live-queue drawer styles to Waiting track pills', () => {
    const queued = playlist('queued', 'Queued lots');
    playlistService.all$.next([
      {
        id: 2,
        name: queued.name,
        spotifyUrl: queued.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [queued],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });
    fixture.detectChanges();

    const pill = fixture.nativeElement.querySelector(
      '.pill.waiting',
    ) as HTMLElement;
    expect(pill).not.toBeNull();
    expect(pill.textContent).toContain('Waiting');
    expect(pill.classList.contains('queue')).toBe(false);
    expect(getComputedStyle(pill).flexDirection).not.toBe('column');
    expect(getComputedStyle(pill).borderTopWidth).toBe('0px');

    const drawer = fixture.nativeElement.querySelector(
      '.live-queue',
    ) as HTMLElement;
    expect(drawer).not.toBeNull();
    expect(drawer.classList.contains('queue')).toBe(false);
    expect(fixture.nativeElement.querySelectorAll('.pill.queue').length).toBe(
      0,
    );
  });

  it('compacts ripping playlist remaining-work counts and keeps the full text in the title', () => {
    const ripping = playlist('searching', 'Searching now', {
      trackCount: 79,
      onDisk: 16,
      available: 16,
      percentOnDisk: 20,
      percentAvailable: 20,
    });
    playlistService.all$.next([
      {
        id: 3,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 13,
        artist: 'Search Artist',
        name: 'Search track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
      {
        id: 14,
        artist: 'Queued Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 3,
      },
      {
        id: 15,
        artist: 'Queued Artist',
        name: 'Another queued',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 3,
      },
    ]);

    render({
      playlists: [ripping],
      totals: { playlists: 1, tracks: 79, onDisk: 16, available: 16 },
    });

    const sub = fixture.nativeElement.querySelector(
      '.pl-row .pl-sub',
    ) as HTMLElement;
    const subText = (sub.textContent || '').replace(/\s+/g, ' ');
    expect(subText).toContain('16/79');
    expect(subText).toContain('1 search');
    expect(subText).toContain('62 waiting');
    expect(subText).not.toContain('searching');
    expect(subText).not.toContain('pending');
    expect(subText.indexOf('1 search')).toBeLessThan(
      subText.indexOf('62 waiting'),
    );
    expect(sub.getAttribute('title')).toContain(
      '16/79 · 1 searching · 62 waiting',
    );
  });

  it('includes confirmed misses on ripping remaining-work lines so counts reconcile', () => {
    const ripping = playlist('searching', 'Luk Isaan', {
      trackCount: 307,
      onDisk: 2,
      available: 2,
      failed: 7,
      percentOnDisk: 1,
      percentAvailable: 1,
    });
    playlistService.all$.next([
      {
        id: 3,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next(
      Array.from({ length: 294 }, (_, index) => ({
        id: 1000 + index,
        artist: 'Queued Artist',
        name: `Queued ${index}`,
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 3,
      })),
    );

    render({
      playlists: [ripping],
      totals: { playlists: 1, tracks: 307, onDisk: 2, available: 2 },
    });

    const stats = component.statsOf(ripping);
    expect(stats.onDisk + stats.failed + stats.pending + stats.queued).toBe(
      307,
    );
    const sub = fixture.nativeElement.querySelector(
      '.pl-row .pl-sub',
    ) as HTMLElement;
    const subText = (sub.textContent || '').replace(/\s+/g, ' ');
    expect(subText).toContain('2/307');
    expect(subText).toContain('7 missing');
    expect(subText).toContain('298 waiting');
    expect(subText).not.toContain('pending');
    expect(subText.indexOf('7 missing')).toBeLessThan(
      subText.indexOf('298 waiting'),
    );
    expect(sub.getAttribute('title')).toContain(
      '2/307 · 7 missing · 298 waiting',
    );
    const row = fixture.nativeElement.querySelector('.pl-row') as HTMLElement;
    expect(row.querySelector('.state-pill.is-done')).toBeNull();
    expect(row.querySelector('.state-pill.is-wait')?.textContent).toContain(
      '298 waiting',
    );
  });

  it('labels a finished playlist with misses as Finished, not Done', () => {
    const finished = playlist('ravel', 'This Is Ravel', {
      trackCount: 69,
      onDisk: 65,
      available: 65,
      failed: 4,
      percentOnDisk: 94,
      percentAvailable: 94,
    });
    const complete = playlist('complete', 'All saved', {
      trackCount: 10,
      onDisk: 10,
      available: 10,
      percentOnDisk: 100,
      percentAvailable: 100,
    });

    render({
      playlists: [finished, complete],
      totals: { playlists: 2, tracks: 79, onDisk: 75, available: 75 },
    });

    const rows = [
      ...fixture.nativeElement.querySelectorAll('.pl-row'),
    ] as HTMLElement[];
    const ravel = rows.find((row) =>
      row.textContent?.includes('This Is Ravel'),
    ) as HTMLElement;
    const saved = rows.find((row) =>
      row.textContent?.includes('All saved'),
    ) as HTMLElement;

    expect(component.statsOf(finished).done).toBe(true);
    expect(ravel.classList).toContain('is-partial');
    expect(ravel.classList).not.toContain('is-done');
    expect(
      ravel.querySelector('.state-pill.is-partial')?.textContent,
    ).toContain('Finished');
    expect(ravel.querySelector('.state-pill.is-done')).toBeNull();
    expect(
      (ravel.querySelector('.pl-sub')?.textContent || '').replace(/\s+/g, ' '),
    ).toContain('65/69 · 4 missing');
    expect(ravel.querySelector('.pl-sub')?.textContent).not.toContain('saved');

    expect(saved.classList).toContain('is-done');
    expect(saved.querySelector('.state-pill.is-done')?.textContent).toContain(
      'Done',
    );
    expect(saved.querySelector('.state-pill.is-partial')).toBeNull();
    expect(saved.querySelector('.pl-sub')?.textContent).toContain(
      '10/10 saved',
    );

    component.hideComplete = true;
    fixture.detectChanges();
    expect(component.visiblePlaylists.map((p) => p.name)).toEqual([
      'This Is Ravel',
    ]);
  });

  it('shows missing on incomplete playlists that are not ripping', () => {
    const partial = playlist('massage', 'Massage', {
      trackCount: 293,
      onDisk: 1,
      available: 1,
      failed: 2,
      percentOnDisk: 0,
      percentAvailable: 0,
    });

    render({
      playlists: [partial],
      totals: { playlists: 1, tracks: 293, onDisk: 1, available: 1 },
    });

    const row = fixture.nativeElement.querySelector('.pl-row') as HTMLElement;
    expect(
      (row.querySelector('.pl-sub')?.textContent || '').replace(/\s+/g, ' '),
    ).toContain('1/293 on disk · 2 missing');
    expect(row.querySelector('.state-pill.is-needs')?.textContent).toContain(
      '290 needed',
    );
  });

  it('shows copyable remainder instead of treating those tracks as YouTube work', () => {
    const partial = playlist('surrender', 'State Of Surrender Radio', {
      trackCount: 50,
      onDisk: 23,
      available: 30,
      failed: 0,
      percentOnDisk: 46,
      percentAvailable: 60,
    });

    render({
      playlists: [partial],
      totals: { playlists: 1, tracks: 50, onDisk: 23, available: 30 },
    });

    const stats = component.statsOf(partial);
    expect(stats.copyable).toBe(7);
    expect(stats.pending).toBe(20);
    expect(stats.onDisk + stats.copyable + stats.pending).toBe(50);

    const row = fixture.nativeElement.querySelector('.pl-row') as HTMLElement;
    const subText = (row.querySelector('.pl-sub')?.textContent || '').replace(
      /\s+/g,
      ' ',
    );
    expect(subText).toContain('23/50 on disk');
    expect(subText).toContain('7 copyable');
    expect(row.querySelector('.state-pill.is-needs')?.textContent).toContain(
      '20 needed',
    );
    expect(row.querySelector('.pl-sub')?.getAttribute('title')).toContain(
      '23/50 on disk · 7 copyable',
    );
    expect(
      (
        fixture.nativeElement.querySelector('.detail-sub')?.textContent || ''
      ).replace(/\s+/g, ' '),
    ).toContain('23/50 on disk · 7 copyable');
  });

  it('keeps copyable out of ripping remainder when those songs are already waiting', () => {
    const ripping = playlist('surrender', 'State Of Surrender Radio', {
      trackCount: 50,
      onDisk: 23,
      available: 30,
      percentOnDisk: 46,
      percentAvailable: 60,
    });
    playlistService.all$.next([
      {
        id: 8,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next(
      Array.from({ length: 27 }, (_, index) => ({
        id: 3000 + index,
        artist: 'Queued Artist',
        name: `Queued ${index}`,
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 8,
      })),
    );

    render({
      playlists: [ripping],
      totals: { playlists: 1, tracks: 50, onDisk: 23, available: 30 },
    });

    const stats = component.statsOf(ripping);
    expect(stats.queued).toBe(27);
    expect(stats.copyable).toBe(0);
    expect(stats.pending).toBe(0);
    const subText = (
      fixture.nativeElement.querySelector('.pl-row .pl-sub')?.textContent || ''
    ).replace(/\s+/g, ' ');
    expect(subText).toContain('23/50');
    expect(subText).toContain('27 waiting');
    expect(subText).not.toContain('copyable');
  });

  it('lists idle copyable tracks on a ripping playlist before pending work', () => {
    const ripping = playlist('surrender', 'State Of Surrender Radio', {
      trackCount: 50,
      onDisk: 23,
      available: 30,
      percentOnDisk: 46,
      percentAvailable: 60,
    });
    playlistService.all$.next([
      {
        id: 8,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 88,
        artist: 'Search Artist',
        name: 'Search track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 8,
      },
    ]);

    render({
      playlists: [ripping],
      totals: { playlists: 1, tracks: 50, onDisk: 23, available: 30 },
    });

    const stats = component.statsOf(ripping);
    expect(stats.copyable).toBe(7);
    expect(stats.pending).toBe(19);
    expect(stats.searching).toBe(1);
    expect(
      stats.onDisk + stats.copyable + stats.pending + stats.searching,
    ).toBe(50);
    const sub = fixture.nativeElement.querySelector(
      '.pl-row .pl-sub',
    ) as HTMLElement;
    const subText = (sub.textContent || '').replace(/\s+/g, ' ');
    expect(subText).toContain('23/50');
    expect(subText).toContain('7 copyable');
    expect(subText).toContain('19 waiting');
    expect(subText).toContain('1 search');
    expect(subText).not.toContain('pending');
    expect(subText.indexOf('7 copyable')).toBeLessThan(
      subText.indexOf('1 search'),
    );
    expect(sub.getAttribute('title')).toContain(
      '23/50 · 7 copyable · 1 searching · 19 waiting',
    );
  });

  it('does not paint the previous playlist tracks onto a newly focused playlist', () => {
    const ripping = playlist('searching', 'Luk Isaan', {
      trackCount: 307,
      onDisk: 2,
      available: 2,
      failed: 7,
      percentOnDisk: 1,
      percentAvailable: 1,
    });
    const finished = playlist('ravel', 'This Is Ravel', {
      trackCount: 69,
      onDisk: 65,
      available: 65,
      failed: 4,
      percentOnDisk: 94,
      percentAvailable: 94,
    });
    playlistService.all$.next([
      {
        id: 3,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next(
      Array.from({ length: 40 }, (_, index) => ({
        id: 2000 + index,
        artist: 'Queued Artist',
        name: `Queued ${index}`,
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 3,
      })),
    );

    render({
      playlists: [ripping, finished],
      totals: { playlists: 2, tracks: 376, onDisk: 67, available: 67 },
    });
    component.focus(ripping, false);
    fixture.detectChanges();
    expect(component.detail?.playlist.id).toBe(ripping.id);
    expect(component.statsOf(ripping).queued).toBe(40);

    libraryService.detail.and.callFake((id) =>
      id === finished.id ? NEVER : of(detail(ripping)),
    );
    component.focus(finished, false);
    fixture.detectChanges();

    expect(component.focused?.id).toBe(finished.id);
    expect(component.detail).toBeNull();
    expect(component.statsOf(finished).queued).toBe(0);
    expect(component.statsOf(finished).ripping).toBe(false);
    const ravel = [...fixture.nativeElement.querySelectorAll('.pl-row')].find(
      (row: HTMLElement) => row.textContent?.includes('This Is Ravel'),
    ) as HTMLElement;
    expect(
      ravel.querySelector('.state-pill.is-partial')?.textContent,
    ).toContain('Finished');
    expect(ravel.textContent).not.toContain('Downloading');
    expect(ravel.textContent).not.toContain('waiting');
    expect(
      fixture.nativeElement.querySelector('.detail-title')?.textContent,
    ).toContain('Finished');
    expect(fixture.nativeElement.querySelector('table.tracks')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.track-wrap')?.textContent,
    ).toContain('Loading tracks');
  });

  it('scrolls the track table to running work after the rows render', fakeAsync(() => {
    const mixed = playlist('mixed', 'Mixed coverage', {
      trackCount: 3,
      onDisk: 2,
      available: 2,
      percentOnDisk: 67,
      percentAvailable: 67,
    });
    playlistService.all$.next([
      {
        id: 9,
        name: mixed.name,
        spotifyUrl: mixed.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 90,
        artist: 'Search Artist',
        name: 'Search track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 9,
      },
    ]);

    render({
      playlists: [mixed],
      totals: { playlists: 1, tracks: 3, onDisk: 2, available: 2 },
    });
    tick(50);
    fixture.detectChanges();

    const wrap = fixture.nativeElement.querySelector(
      '.track-wrap',
    ) as HTMLElement;
    const wip = wrap.querySelector('tr.is-wip') as HTMLElement | null;
    expect(wip?.textContent).toContain('Search track');
    expect(wip?.textContent).toContain('Finding on YouTube');
    expect(wrap.querySelector('tr.is-playable')?.textContent).toContain(
      'On disk one',
    );
    discardPeriodicTasks();
  }));

  it('shows a running download on an on-disk track instead of hiding it as saved', () => {
    const mixed = playlist('mixed', 'Mixed coverage', {
      trackCount: 3,
      onDisk: 2,
      available: 2,
      percentOnDisk: 67,
      percentAvailable: 67,
    });
    playlistService.all$.next([
      {
        id: 9,
        name: mixed.name,
        spotifyUrl: mixed.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 91,
        artist: 'Saved',
        name: 'On disk one',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Downloading,
        playlistId: 9,
      },
    ]);

    render({
      playlists: [mixed],
      totals: { playlists: 1, tracks: 3, onDisk: 2, available: 2 },
    });

    const wip = fixture.nativeElement.querySelector(
      'tr.is-wip',
    ) as HTMLElement | null;
    expect(wip?.textContent).toContain('On disk one');
    expect(wip?.textContent).toContain('Downloading');
    expect(wip?.classList.contains('is-playable')).toBe(true);
    expect(wip?.querySelector('.play-btn')).not.toBeNull();
    expect(wip?.querySelector('.track-file.is-ready')?.textContent).toContain(
      'Saved - On disk one.mp3',
    );
    expect(component.statusKind(component.detail!.tracks[0])).toBe('rip');
  });

  it('keeps the focused playlist occurrence downloading when another copy is only waiting', () => {
    const ripping = playlist('mozart-a', 'Mozart A');
    const other = playlist('mozart-b', 'Mozart B');
    playlistService.all$.next([
      {
        id: 21,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
      {
        id: 22,
        name: other.name,
        spotifyUrl: other.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 210,
        artist: 'Wolfgang Amadeus Mozart, Andrew Smith, Joshua Pierce',
        name: 'Sonata for Violin and Piano in E-Flat Major, K. 380: III. Rondeau',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Downloading,
        playlistId: 21,
      },
      {
        id: 220,
        artist: 'Wolfgang Amadeus Mozart, Andrew Smith, Joshua Pierce',
        name: 'Sonata for Violin and Piano in E-Flat Major, K. 380: III. Rondeau',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 22,
      },
    ]);

    render({
      playlists: [ripping, other],
      totals: { playlists: 2, tracks: 2, onDisk: 0, available: 0 },
    });
    component.focus(ripping, false);
    fixture.detectChanges();

    const wip = fixture.nativeElement.querySelector(
      'tr.is-wip',
    ) as HTMLElement | null;
    expect(wip?.textContent).toContain('K. 380: III. Rondeau');
    expect(wip?.textContent).toContain('Downloading');
    expect(component.statusKind(component.detail!.tracks[0])).toBe('rip');
  });

  it('does not paint another playlist running job onto a focused occurrence with no live row', () => {
    const saved = playlist('mozart-b', 'Mozart B', {
      trackCount: 1,
      onDisk: 1,
      available: 1,
      percentOnDisk: 100,
      percentAvailable: 100,
    });
    const ripping = playlist('mozart-a', 'Mozart A');
    playlistService.all$.next([
      {
        id: 21,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
      {
        id: 22,
        name: saved.name,
        spotifyUrl: saved.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 210,
        artist: 'Wolfgang Amadeus Mozart, Andrew Smith, Joshua Pierce',
        name: 'Sonata for Violin and Piano in E-Flat Major, K. 380: III. Rondeau',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Downloading,
        playlistId: 21,
      },
    ]);

    render({
      playlists: [saved, ripping],
      totals: { playlists: 2, tracks: 2, onDisk: 1, available: 1 },
    });
    component.focus(saved, false);
    fixture.detectChanges();

    expect(component.statusKind(component.detail!.tracks[0])).toBe('disk');
    expect(fixture.nativeElement.querySelector('tr.is-wip')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.pill.on')?.textContent,
    ).toContain('on disk');
    expect(fixture.nativeElement.querySelector('.pill.dl')).toBeNull();
  });

  it('does not steal the playlist list from running work to chase a waiting focused row', fakeAsync(() => {
    const waiting = playlist('queued', 'Waiting lots', {
      trackCount: 80,
      onDisk: 0,
      available: 0,
    });
    const searching = playlist('searching', 'Searching now', {
      trackCount: 10,
      onDisk: 0,
      available: 0,
    });
    playlistService.all$.next([
      {
        id: 2,
        name: waiting.name,
        spotifyUrl: waiting.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [waiting, searching],
      totals: { playlists: 2, tracks: 90, onDisk: 0, available: 0 },
    });
    component.focus(waiting, false);
    fixture.detectChanges();
    tick();

    const box = {
      left: 0,
      right: 200,
      width: 200,
      x: 0,
      y: 0,
      toJSON() {},
    };
    spyOn(HTMLElement.prototype, 'getBoundingClientRect').and.callFake(
      function (this: HTMLElement) {
        if (this.classList.contains('is-focused')) {
          return { top: 400, bottom: 440, height: 40, ...box } as DOMRect;
        }
        if (this.classList.contains('sidebar-list')) {
          return { top: 0, bottom: 80, height: 80, ...box } as DOMRect;
        }
        return { top: 0, bottom: 40, height: 40, ...box } as DOMRect;
      },
    );
    const scroll = spyOn(HTMLElement.prototype, 'scrollIntoView');

    playlistService.all$.next([
      {
        id: 2,
        name: waiting.name,
        spotifyUrl: waiting.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
      {
        id: 3,
        name: searching.name,
        spotifyUrl: searching.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
      {
        id: 13,
        artist: 'Search Artist',
        name: 'Search track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
    ]);
    fixture.detectChanges();
    tick();

    expect(component.visiblePlaylists[0].id).toBe('searching');
    expect(component.focused?.id).toBe('queued');
    expect(component.runningPlaylists.map((p) => p.name)).toEqual([
      'Searching now',
    ]);
    expect(
      fixture.nativeElement.querySelector('.sidebar-now')?.textContent,
    ).toContain('Searching · Searching now');
    expect(scroll).not.toHaveBeenCalled();
    discardPeriodicTasks();
  }));

  it('keeps a running focused playlist in view when live work reorders the list', fakeAsync(() => {
    const searching = playlist('searching', 'Searching now', {
      trackCount: 10,
      onDisk: 0,
      available: 0,
    });
    const downloading = playlist('ripping', 'Ripping now', {
      trackCount: 12,
      onDisk: 0,
      available: 0,
    });
    playlistService.all$.next([
      {
        id: 3,
        name: searching.name,
        spotifyUrl: searching.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 13,
        artist: 'Search Artist',
        name: 'Search track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
    ]);

    render({
      playlists: [searching, downloading],
      totals: { playlists: 2, tracks: 22, onDisk: 0, available: 0 },
    });
    component.focus(searching, false);
    fixture.detectChanges();
    tick();

    const box = {
      left: 0,
      right: 200,
      width: 200,
      x: 0,
      y: 0,
      toJSON() {},
    };
    spyOn(HTMLElement.prototype, 'getBoundingClientRect').and.callFake(
      function (this: HTMLElement) {
        if (this.classList.contains('is-focused')) {
          return { top: 400, bottom: 440, height: 40, ...box } as DOMRect;
        }
        if (this.classList.contains('sidebar-list')) {
          return { top: 0, bottom: 80, height: 80, ...box } as DOMRect;
        }
        return { top: 0, bottom: 40, height: 40, ...box } as DOMRect;
      },
    );
    const scroll = spyOn(HTMLElement.prototype, 'scrollIntoView');

    playlistService.all$.next([
      {
        id: 3,
        name: searching.name,
        spotifyUrl: searching.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
      {
        id: 4,
        name: downloading.name,
        spotifyUrl: downloading.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 13,
        artist: 'Search Artist',
        name: 'Search track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
      {
        id: 14,
        artist: 'Rip Artist',
        name: 'Rip track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Downloading,
        playlistId: 4,
      },
    ]);
    fixture.detectChanges();
    tick();

    expect(component.visiblePlaylists[0].id).toBe('ripping');
    expect(component.focused?.id).toBe('searching');
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    expect(
      [...fixture.nativeElement.querySelectorAll('.sidebar-now')].map(
        (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ').trim(),
      ),
    ).toEqual(['Downloading · Ripping now', 'Searching · Searching now']);
    const running = fixture.nativeElement.querySelector(
      '.sidebar-running',
    ) as HTMLElement;
    expect(running).not.toBeNull();
    expect(getComputedStyle(running).display).toBe('flex');
    expect(getComputedStyle(running).flexWrap).toBe('nowrap');
    discardPeriodicTasks();
  }));

  it('opens a running playlist from the sidebar live block without a Spotify resync', () => {
    const searching = playlist('searching', 'Searching now');
    const waiting = playlist('queued', 'Waiting lots', {
      trackCount: 80,
      onDisk: 0,
    });
    libraryService.resync.and.returnValue(
      of({ id: searching.id, name: searching.name, before: 10, after: 10 }),
    );
    playlistService.all$.next([
      {
        id: 3,
        name: searching.name,
        spotifyUrl: searching.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 13,
        artist: 'Search Artist',
        name: 'Search track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
    ]);

    render({
      playlists: [waiting, searching],
      totals: { playlists: 2, tracks: 90, onDisk: 0, available: 0 },
    });
    component.focus(waiting, false);
    fixture.detectChanges();
    expect(component.focused?.id).toBe('queued');

    const now = fixture.nativeElement.querySelector(
      '.sidebar-now',
    ) as HTMLButtonElement;
    expect(now.textContent).toContain('Searching · Searching now');
    now.click();
    fixture.detectChanges();
    expect(component.focused?.id).toBe('searching');
    expect(libraryService.resync).not.toHaveBeenCalled();
  });

  it('shows CLI throughput, disk and ETA separately from paused web-worker activity', () => {
    const pace = {
      searchConc: 1,
      downloadConc: 2,
      searchActive: 0,
      downloadActive: 2,
      maxPerWindow: 96,
      downloadsInWindow: 88,
      windowMs: 600000,
      coolRemainingMs: 0,
    };
    libraryService.youtubePace.and.returnValue(
      of({
        ...pace,
        searchActive: 0,
        downloadActive: 0,
        autoStep: false,
        reason: null,
        acquisition: {
          at: new Date().toISOString(),
          verifiedNewMp3: 110,
          remainingUnique: 13361,
          diskGB: 53.824,
          mp3PerMinute: 8,
          baselineMultiple: 8 / 3,
          elapsedMinutes: 13.75,
          held: false,
          contentReviewPendingUnique: 7,
          eta: {
            continuous: '2026-09-14T01:00:00Z',
            buffered25: '2026-09-14T08:00:00Z',
          },
          pace,
        },
      }),
    );
    render({
      playlists: [playlist('saved', 'Saved library')],
      totals: { playlists: 1, tracks: 90, onDisk: 0, available: 0 },
    });
    const banner = fixture.nativeElement.querySelector(
      '.acquisition-banner',
    ) as HTMLElement;
    expect(banner.textContent).toContain('8.00 MP3/min');
    expect(banner.textContent).toContain('2.67× the 3/min baseline');
    expect(banner.textContent).toContain('13,361 unique tracks left');
    expect(banner.textContent).toContain('53.82 GB');
    expect(banner.textContent).toContain('With 25% buffer:');
    expect(banner.textContent).toContain('Web queues preserved and paused');
    expect(component.paceLine()).toContain('CLI 2+1');
    expect(component.showYoutubePace).toBeTrue();
    expect(component.bulkActionsBlocked).toBeTrue();
    component.downloadRemaining();
    expect(libraryService.downloadRemaining).not.toHaveBeenCalled();
  });

  it('exposes the YouTube safety floor and window without leaking the raw reason', () => {
    const queued = playlist('queued', 'Queued lots');
    const floor: YoutubePaceSnapshot = {
      searchConc: 1,
      downloadConc: 1,
      searchActive: 1,
      downloadActive: 0,
      maxPerWindow: 8,
      downloadsInWindow: 8,
      windowMs: 600000,
      coolRemainingMs: 0,
      autoStep: false,
      reason:
        'FLOOR COOLDOWN downloadConc ERROR: Sign in to confirm you are not a bot',
    };
    libraryService.youtubePace.and.returnValue(of(floor));
    playlistService.all$.next([
      {
        id: 2,
        name: queued.name,
        spotifyUrl: queued.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [queued],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    const pace = fixture.nativeElement.querySelector(
      '.sidebar-pace',
    ) as HTMLElement;
    expect(pace?.textContent).toContain('YouTube 1+1 · 8/8 this 10m');
    expect(pace?.querySelector('.sidebar-pace-note')?.textContent).toContain(
      'Safety floor — downloads held',
    );
    expect(pace?.textContent).not.toContain('next window');
    expect(pace?.getAttribute('title')).toContain('YouTube 1+1 · 8/8 this 10m');
    expect(
      [
        ...fixture.nativeElement.querySelectorAll('.sidebar-search-row button'),
      ].map((button: HTMLButtonElement) => button.textContent?.trim()),
    ).toEqual(['Refresh', 'Sync library']);
    expect(
      fixture.nativeElement.querySelector('.sidebar-filters')?.textContent,
    ).not.toContain('Sync library');
    expect(fixture.nativeElement.textContent).not.toContain('FLOOR COOLDOWN');
    expect(component.isSafetyFloor()).toBe(true);
    expect(component.showYoutubePace).toBe(true);
  });

  it('names an active cooldown instead of calling it a running process', () => {
    const queued = playlist('queued', 'Queued lots');
    libraryService.youtubePace.and.returnValue(
      of({
        searchConc: 1,
        downloadConc: 1,
        searchActive: 0,
        downloadActive: 0,
        maxPerWindow: 8,
        downloadsInWindow: 3,
        windowMs: 600000,
        coolRemainingMs: 12 * 60 * 1000,
        autoStep: false,
        reason: 'FLOOR COOLDOWN',
        acquisitionOwner: {
          state: 'available',
          phase: null,
          telemetryFresh: false,
        },
      }),
    );
    playlistService.all$.next([
      {
        id: 2,
        name: queued.name,
        spotifyUrl: queued.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [queued],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    expect(
      fixture.nativeElement.querySelector('.sidebar-pace-note')?.textContent,
    ).toContain('Safety floor — cooldown 12m');
    expect(
      fixture.nativeElement.querySelector('.sidebar-activity .wip-spin'),
    ).toBeNull();
  });

  it('does not say downloads are held while a floor download is running', () => {
    const ripping = playlist('ripping', 'Ripping now');
    libraryService.youtubePace.and.returnValue(
      of({
        searchConc: 1,
        downloadConc: 1,
        searchActive: 0,
        downloadActive: 1,
        maxPerWindow: 8,
        downloadsInWindow: 8,
        windowMs: 600000,
        coolRemainingMs: 0,
        autoStep: false,
        reason: 'FLOOR COOLDOWN',
      }),
    );
    playlistService.all$.next([
      {
        id: 4,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 40,
        artist: 'Artist',
        name: 'Downloading track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Downloading,
        playlistId: 4,
      },
    ]);

    render({
      playlists: [ripping],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    expect(
      fixture.nativeElement.querySelector('.sidebar-pace-note')?.textContent,
    ).toContain('Safety floor — window full');
    expect(fixture.nativeElement.textContent).not.toContain('downloads held');
    expect(fixture.nativeElement.textContent).not.toContain('FLOOR COOLDOWN');
  });

  it('shows a read-only live queue without delete or retry controls', () => {
    const queued = playlist('queued', 'Queued lots');
    playlistService.all$.next([
      {
        id: 2,
        name: queued.name,
        spotifyUrl: queued.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [queued],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });
    component.queueOpen = true;
    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector(
      '.queue-pl',
    ) as HTMLButtonElement;
    expect(row).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('.queue-toggle')?.textContent,
    ).toContain('Live queue');
    expect(
      fixture.nativeElement.querySelector('.queue-toggle')?.textContent,
    ).toContain('1 playlist in queue');
    expect(
      fixture.nativeElement.querySelector('.queue-toggle')?.textContent,
    ).not.toContain('Download queue');
    expect(row.textContent).toContain('Queued lots');
    expect(row.textContent).toContain('10 waiting');
    expect(fixture.nativeElement.querySelector('app-playlist-box')).toBeNull();
    expect(fixture.nativeElement.querySelector('.fa-xmark')).toBeNull();
    expect(fixture.nativeElement.querySelector('.fa-repeat')).toBeNull();
    expect(playlistService.delete).not.toHaveBeenCalled();
    expect(playlistService.retryFailed).not.toHaveBeenCalled();

    expect(
      fixture.nativeElement
        .querySelector('.live-queue')
        ?.classList.contains('is-open'),
    ).toBe(true);
    expect(fixture.nativeElement.querySelector('.track-wrap')).not.toBeNull();

    row.click();
    fixture.detectChanges();
    expect(component.focused?.name).toBe('Queued lots');
    expect(component.queueOpen).toBe(false);
    expect(
      fixture.nativeElement
        .querySelector('.live-queue')
        ?.classList.contains('is-open'),
    ).toBe(false);
  });

  it('closes the live-queue overlay when a playlist is chosen from the list', () => {
    const queued = playlist('queued', 'Queued lots');
    render({
      playlists: [queued],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });
    component.queueOpen = true;
    fixture.detectChanges();
    expect(component.queueOpen).toBe(true);

    const row = fixture.nativeElement.querySelector('.pl-row') as HTMLElement;
    row.click();
    fixture.detectChanges();
    expect(component.queueOpen).toBe(false);
  });

  it('shows needs retry from live Error jobs even when the dump leftover would look queued', () => {
    const ripping = playlist('queued', 'Queued lots', {
      trackCount: 10,
      onDisk: 0,
      available: 0,
    });
    playlistService.all$.next([
      {
        id: 2,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
      {
        id: 13,
        artist: 'Artist',
        name: 'Failed track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Error,
        error: 'Temporary YouTube failure: socket timed out',
        playlistId: 2,
      },
    ]);

    render({
      playlists: [ripping],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    const stats = component.statsOf(ripping);
    expect(stats.needsRetry).toBe(1);
    expect(stats.queued).toBe(1);
    const subText = (
      fixture.nativeElement.querySelector('.pl-row .pl-sub')?.textContent || ''
    ).replace(/\s+/g, ' ');
    expect(subText).toContain('1 needs retry');
    expect(subText).not.toContain('pending');
  });

  it('does not let Hide finished conceal live queue work', () => {
    const liveDone = playlist('live-done', 'Live done', {
      onDisk: 10,
      available: 10,
      percentOnDisk: 100,
      percentAvailable: 100,
    });
    const completed = playlist('completed', 'Completed', {
      onDisk: 10,
      available: 10,
      percentOnDisk: 100,
      percentAvailable: 100,
    });
    playlistService.all$.next([
      {
        id: 7,
        name: liveDone.name,
        spotifyUrl: liveDone.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 70,
        artist: 'Artist',
        name: 'Retrying track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 7,
      },
    ]);

    render({
      playlists: [liveDone, completed],
      totals: { playlists: 2, tracks: 20, onDisk: 20, available: 20 },
    });
    expect(component.statsOf(liveDone).done).toBe(true);
    expect(component.statsOf(liveDone).ripping).toBe(true);

    component.hideComplete = true;
    fixture.detectChanges();

    expect(component.visiblePlaylists.map((p) => p.name)).toEqual([
      'Live done',
    ]);
    expect(
      fixture.nativeElement.querySelector('.pl-row')?.textContent,
    ).toContain('Live done');
    expect(component.attentionPlaylists).toBe(1);
    expect(
      fixture.nativeElement.querySelector('.sidebar-attention')?.textContent,
    ).toContain('1 playlists');
    component.selectIncomplete();
    expect(component.selected.has(liveDone.uri)).toBe(true);
    expect(component.selected.has(completed.uri)).toBe(false);
  });

  it('does not auto-resync a playlist while live Spotify sync is degraded', () => {
    const first = playlist('saved', 'Saved playlist');
    const second = playlist('other', 'Other playlist');
    libraryService.resync.and.returnValue(
      of({ id: second.id, name: second.name, before: 10, after: 10 }),
    );

    render({
      playlists: [first, second],
      totals: { playlists: 2, tracks: 20, onDisk: 0, available: 0 },
    });

    expect(component.syncNotice).toContain('showing saved library');
    expect(component.librarySyncDegraded).toBe(true);

    component.focus(second);
    expect(libraryService.resync).not.toHaveBeenCalled();
    expect(component.focused?.name).toBe('Other playlist');
  });

  it('still allows an explicit playlist resync after a degraded library sync', () => {
    const saved = playlist('saved', 'Saved playlist');
    libraryService.resync.and.returnValue(
      of({ id: saved.id, name: saved.name, before: 10, after: 10 }),
    );

    render({
      playlists: [saved],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });
    expect(component.librarySyncDegraded).toBe(true);

    component.resyncFocused();
    expect(libraryService.resync).toHaveBeenCalled();
  });

  it('labels library-wide counts as playlist occurrences, not unique songs', () => {
    const partial = playlist('partial', 'Partial', {
      trackCount: 10,
      onDisk: 4,
      available: 4,
      percentOnDisk: 40,
      percentAvailable: 40,
    });

    render({
      playlists: [partial],
      totals: { playlists: 1, tracks: 10, onDisk: 4, available: 4 },
    });

    const meta = fixture.nativeElement.querySelector(
      '.sidebar-meta',
    ) as HTMLElement;
    const attention = fixture.nativeElement.querySelector(
      '.sidebar-attention',
    ) as HTMLElement;
    const metaText = (meta.textContent || '').replace(/\s+/g, ' ');
    expect(metaText).toContain('4/10 occurrences on disk');
    expect(metaText).not.toContain('4 saved');
    expect(metaText).not.toContain('10 tracks');
    expect(metaText).not.toMatch(/\b4 on disk\b/);
    expect(attention.textContent).toContain('6 occurrences need action');
    expect(attention.textContent).not.toContain('tracks need action');
    const detailSub = fixture.nativeElement.querySelector(
      '.detail-sub',
    ) as HTMLElement;
    expect(detailSub.textContent).toContain('4/10 on disk');
    expect(detailSub.textContent).not.toContain('saved');
  });

  it('packs stats, live activity, and the queue guard into a compact sidebar head', () => {
    const queued = playlist('queued', 'Queued lots', {
      onDisk: 4,
      available: 4,
      percentOnDisk: 40,
      percentAvailable: 40,
    });
    libraryService.syncLibraryStatus.and.returnValue(
      of({
        running: false,
        done: 0,
        total: 0,
        discovered: 0,
        changed: 0,
        errors: ['Spotify library request failed: 429'],
        current: '',
        startedAt: '2026-09-11T13:19:21.637Z',
        finishedAt: new Date().toISOString(),
      }),
    );
    libraryService.youtubePace.and.returnValue(
      of({
        searchConc: 1,
        downloadConc: 1,
        searchActive: 1,
        downloadActive: 0,
        maxPerWindow: 8,
        downloadsInWindow: 8,
        windowMs: 600000,
        coolRemainingMs: 0,
        autoStep: false,
        reason: 'FLOOR COOLDOWN',
        acquisitionOwner: {
          state: 'available',
          phase: null,
          telemetryFresh: false,
        },
      }),
    );
    playlistService.all$.next([
      {
        id: 2,
        name: queued.name,
        spotifyUrl: queued.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [queued],
      totals: { playlists: 1, tracks: 10, onDisk: 4, available: 4 },
    });

    const head = fixture.nativeElement.querySelector(
      '.sidebar-head',
    ) as HTMLElement;
    const stats = head.querySelector('.sidebar-stats') as HTMLElement;
    const live = head.querySelector('.sidebar-live') as HTMLElement;
    const actions = head.querySelector('.sidebar-actions') as HTMLElement;
    const notice = head.querySelector('.sync-notice') as HTMLElement;
    const actionKids = Array.from(actions.children) as HTMLElement[];

    expect(stats.querySelector('.sidebar-meta')?.textContent).toContain(
      '4/10 occurrences on disk',
    );
    expect(stats.querySelector('.sidebar-attention')?.textContent).toContain(
      '6 occurrences remaining',
    );
    expect(
      stats.querySelector('.sidebar-attention')?.textContent,
    ).not.toContain('need action');
    expect(live.querySelector('.sidebar-activity')?.textContent).toContain(
      '6 waiting',
    );
    expect(live.querySelector('.sidebar-activity')?.textContent).not.toContain(
      'pending',
    );
    expect(live.querySelector('.sidebar-pace')?.textContent).toContain(
      'YouTube 1+1 · 8/8 this 10m',
    );
    expect(actionKids[0].classList.contains('btn-primary')).toBe(true);
    expect(actionKids[1].id).toBe('queue-guard');
    expect(actionKids[1].textContent).toContain('Queue is live');
    expect(notice.getAttribute('title')).toContain('showing saved library');
    expect(getComputedStyle(notice).textOverflow).toBe('ellipsis');
    expect(getComputedStyle(notice).whiteSpace).toBe('nowrap');
  });

  it('keeps playlist listbox selection on the checkboxes, with keyboard support', () => {
    const first = playlist('alpha', 'Alpha list', { rank: 1 });
    const second = playlist('beta', 'Beta list', { rank: 2 });
    const third = playlist('gamma', 'Gamma list', { rank: 3 });

    render({
      playlists: [first, second, third],
      totals: { playlists: 3, tracks: 30, onDisk: 0, available: 0 },
    });

    const list = fixture.nativeElement.querySelector(
      '.sidebar-list',
    ) as HTMLElement;
    expect(list.getAttribute('role')).toBe('listbox');
    expect(list.getAttribute('aria-multiselectable')).toBe('true');
    expect(list.getAttribute('aria-activedescendant')).toBe('pl-alpha');

    let options = [
      ...fixture.nativeElement.querySelectorAll('.pl-row'),
    ] as HTMLElement[];
    expect(options[0].id).toBe('pl-alpha');
    expect(options[0].classList).toContain('is-focused');
    expect(options[0].getAttribute('aria-selected')).toBe('false');
    expect(
      options.every(
        (row) =>
          row
            .querySelector('input[type="checkbox"]')
            ?.getAttribute('tabindex') === '-1',
      ),
    ).toBe(true);
    expect(
      options.every(
        (row) =>
          row
            .querySelector('input[type="checkbox"]')
            ?.getAttribute('aria-hidden') === 'true',
      ),
    ).toBe(true);
    expect(options[0].getAttribute('aria-label')).toContain('Alpha list');
    expect(options[0].getAttribute('aria-label')).toContain('0/10');
    expect(options[0].querySelector('.sr-only')?.textContent).toContain(
      'Alpha list',
    );
    expect(options[0].querySelector('.sr-only')?.textContent).toContain('0/10');

    component.onListKey(
      new KeyboardEvent('keydown', { key: ' ', cancelable: true }),
    );
    fixture.detectChanges();
    options = [
      ...fixture.nativeElement.querySelectorAll('.pl-row'),
    ] as HTMLElement[];
    expect(component.selected.has(first.uri)).toBe(true);
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(options[0].classList).toContain('is-checked');

    component.onListKey(
      new KeyboardEvent('keydown', { key: 'End', cancelable: true }),
    );
    fixture.detectChanges();
    expect(component.focused?.id).toBe('gamma');
    expect(list.getAttribute('aria-activedescendant')).toBe('pl-gamma');
    options = [
      ...fixture.nativeElement.querySelectorAll('.pl-row'),
    ] as HTMLElement[];
    expect(options[2].classList).toContain('is-focused');
    expect(options[2].getAttribute('aria-selected')).toBe('false');

    component.onListKey(
      new KeyboardEvent('keydown', { key: 'Home', cancelable: true }),
    );
    fixture.detectChanges();
    expect(component.focused?.id).toBe('alpha');
    expect(component.selected.has(first.uri)).toBe(true);
  });

  it('shows MP3 filenames only for files that exist on disk', () => {
    const evidence = playlist('evidence', 'Evidence', {
      trackCount: 3,
      onDisk: 1,
      available: 2,
      percentOnDisk: 33,
      percentAvailable: 67,
    });

    render({
      playlists: [evidence],
      totals: { playlists: 1, tracks: 3, onDisk: 1, available: 2 },
    });

    const rows = [
      ...fixture.nativeElement.querySelectorAll('table.tracks tbody tr'),
    ] as HTMLElement[];
    expect(rows.length).toBe(3);

    const disk = rows.find((row) =>
      row.textContent?.includes('On disk song'),
    ) as HTMLElement;
    const pending = rows.find((row) =>
      row.textContent?.includes('Not yet'),
    ) as HTMLElement;
    const copyable = rows.find((row) =>
      row.textContent?.includes('Elsewhere'),
    ) as HTMLElement;

    expect(disk.querySelector('.track-file')?.textContent).toContain(
      'Saved - On disk song.mp3',
    );
    expect(disk.querySelector('.col-file')?.textContent).toContain(
      'Saved - On disk song.mp3',
    );
    expect(disk.querySelector('.col-file')?.textContent).not.toContain('Play');
    expect(disk.querySelector('.col-play .play-btn')).not.toBeNull();
    expect(disk.querySelector('.play-btn')).not.toBeNull();
    expect(disk.getAttribute('tabindex')).toBe('0');
    expect(pending.getAttribute('tabindex')).toBeNull();
    expect(pending.querySelector('.track-file')).toBeNull();
    expect(pending.textContent).not.toContain('Pending - Not yet.mp3');
    expect(pending.querySelector('.play-btn')).toBeNull();
    expect(copyable.querySelector('.track-file')).toBeNull();
    expect(copyable.textContent).not.toContain('Copy - Elsewhere.mp3');
    expect(copyable.querySelector('.pill.copy')?.textContent).toContain(
      'copyable',
    );
  });

  it('shows Play again when the browser blocks the first local playback', async () => {
    const evidence = playlist('evidence', 'Evidence', {
      trackCount: 3,
      onDisk: 1,
      available: 2,
      percentOnDisk: 33,
      percentAvailable: 67,
    });
    render({
      playlists: [evidence],
      totals: { playlists: 1, tracks: 3, onDisk: 1, available: 2 },
    });
    const audio = {
      paused: true,
      load: jasmine.createSpy('load'),
      play: jasmine
        .createSpy('play')
        .and.returnValue(Promise.reject(new Error('NotAllowedError'))),
      pause: jasmine.createSpy('pause'),
    };
    component['player'] = {
      nativeElement: audio,
    } as unknown as LibraryPanelComponent['player'];
    const track = component.detail?.tracks.find((row) => row.onDisk);
    expect(track).toBeTruthy();
    component.playTrack(track!);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
    expect(component.paused).toBe(true);
    expect(component.playbackPaused()).toBe(true);
    expect(
      fixture.nativeElement.querySelector('.play-btn')?.textContent,
    ).toContain('Play');
  });

  it('shows Play when the audio element is paused after a play request', () => {
    const evidence = playlist('evidence', 'Evidence', {
      trackCount: 3,
      onDisk: 1,
      available: 2,
      percentOnDisk: 33,
      percentAvailable: 67,
    });
    render({
      playlists: [evidence],
      totals: { playlists: 1, tracks: 3, onDisk: 1, available: 2 },
    });
    const audio = {
      paused: true,
      load: jasmine.createSpy('load'),
      play: jasmine.createSpy('play').and.returnValue(Promise.resolve()),
      pause: jasmine.createSpy('pause'),
    };
    component['player'] = {
      nativeElement: audio,
    } as unknown as LibraryPanelComponent['player'];
    const track = component.detail?.tracks.find((row) => row.onDisk);
    expect(track).toBeTruthy();
    component.playTrack(track!);
    fixture.detectChanges();
    expect(component.playbackPaused()).toBe(true);
    expect(
      fixture.nativeElement.querySelector('.play-btn')?.textContent?.trim(),
    ).toBe('Play');
    expect(
      fixture.nativeElement
        .querySelector('.play-btn')
        ?.getAttribute('aria-label'),
    ).toContain('Play');
  });

  it('hides the player bar when playback ends or is closed', () => {
    const evidence = playlist('evidence', 'Evidence', {
      trackCount: 3,
      onDisk: 1,
      available: 2,
      percentOnDisk: 33,
      percentAvailable: 67,
    });
    render({
      playlists: [evidence],
      totals: { playlists: 1, tracks: 3, onDisk: 1, available: 2 },
    });
    const track = component.detail?.tracks.find((row) => row.onDisk);
    expect(track).toBeTruthy();
    component.playTrack(track!);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.player-bar')).not.toBeNull();
    expect(
      fixture.nativeElement
        .querySelector('.player-close')
        ?.getAttribute('aria-label'),
    ).toBe('Close player');

    (
      fixture.nativeElement.querySelector('.player-close') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.player-bar')).toBeNull();
    expect(component.audioUrl).toBe('');

    component.playTrack(track!);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.player-bar')).not.toBeNull();
    component.onAudioEnded();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.player-bar')).toBeNull();
    expect(component.playingN).toBeNull();
  });

  it('does not start a quiet library sync when the last Spotify attempt recently failed', () => {
    libraryService.syncLibraryStatus.and.returnValue(
      of({
        running: false,
        done: 0,
        total: 0,
        discovered: 0,
        changed: 0,
        errors: ['Spotify library request failed: 429'],
        current: '',
        startedAt: '2026-09-11T13:19:21.637Z',
        finishedAt: new Date().toISOString(),
      }),
    );

    render({
      playlists: [playlist('saved', 'Saved playlist')],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    expect(libraryService.syncLibrary).not.toHaveBeenCalled();
    expect(component.librarySyncDegraded).toBe(true);
    expect(component.syncNotice).toContain('429');
    expect(component.syncNotice).toContain('showing saved library');
    expect(component.syncNotice).toContain('use Sync library to retry');
  });

  it('still starts an explicit library sync after a recent quiet failure', () => {
    libraryService.syncLibraryStatus.and.returnValue(
      of({
        running: false,
        done: 0,
        total: 0,
        discovered: 0,
        changed: 0,
        errors: ['Spotify library request failed: 429'],
        current: '',
        startedAt: '2026-09-11T13:19:21.637Z',
        finishedAt: new Date().toISOString(),
      }),
    );
    libraryService.syncLibrary.and.returnValue(of({ started: true }));

    render({
      playlists: [playlist('saved', 'Saved playlist')],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });
    expect(libraryService.syncLibrary).not.toHaveBeenCalled();

    component.syncLibrary();
    expect(libraryService.syncLibrary).toHaveBeenCalled();
  });

  it('keeps skipping quiet library sync after a Spotify 429 until explicit retry', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    libraryService.syncLibraryStatus.and.returnValue(
      of({
        running: false,
        done: 0,
        total: 0,
        discovered: 0,
        changed: 0,
        errors: ['Spotify library request failed: 429'],
        current: '',
        startedAt: '2026-09-11T13:19:21.637Z',
        finishedAt: twoHoursAgo,
      }),
    );

    render({
      playlists: [playlist('saved', 'Saved playlist')],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    expect(libraryService.syncLibrary).not.toHaveBeenCalled();
    expect(component.librarySyncDegraded).toBe(true);
    expect(component.syncNotice).toContain('429');
    expect(component.syncNotice).toContain('use Sync library to retry');
  });

  it('retries a non-429 quiet sync failure after 15 minutes', () => {
    const twentyMinutesAgo = new Date(
      Date.now() - 20 * 60 * 1000,
    ).toISOString();
    libraryService.syncLibraryStatus.and.returnValue(
      of({
        running: false,
        done: 0,
        total: 0,
        discovered: 0,
        changed: 0,
        errors: ['Spotify unavailable'],
        current: '',
        startedAt: '2026-09-11T13:19:21.637Z',
        finishedAt: twentyMinutesAgo,
      }),
    );

    render({
      playlists: [playlist('saved', 'Saved playlist')],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    expect(libraryService.syncLibrary).toHaveBeenCalled();
  });

  it('labels in-progress banner downloads with Downloading, not a bare percent', () => {
    const ripping = playlist('mixed', 'Mixed coverage', {
      trackCount: 3,
      onDisk: 2,
      available: 2,
      percentOnDisk: 67,
      percentAvailable: 67,
    });
    playlistService.all$.next([
      {
        id: 9,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 91,
        artist: 'Saved',
        name: 'On disk one',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Downloading,
        playlistId: 9,
      },
    ]);
    trackService.progress$.next({ 91: 42 });

    render({
      playlists: [ripping],
      totals: { playlists: 1, tracks: 3, onDisk: 2, available: 2 },
    });

    const meta = fixture.nativeElement.querySelector(
      '.rip-meta',
    ) as HTMLElement | null;
    expect(meta?.textContent?.trim()).toBe('Downloading 42%');
    expect(meta?.getAttribute('title')).toBe('Downloading 42%');
    expect(meta?.textContent).not.toMatch(/^\s*(\d+%|downloading)\s*$/i);
  });

  it('names the focused playlist in Resync copy instead of calling every dump Recents', () => {
    const luk = playlist('luk-isaan', 'Luk Isaan', {
      rank: 199,
      trackCount: 307,
      onDisk: 145,
      available: 145,
      percentOnDisk: 47,
      percentAvailable: 47,
      failed: 7,
    });

    render({
      playlists: [luk],
      totals: { playlists: 1, tracks: 307, onDisk: 145, available: 145 },
    });

    const resync = [...fixture.nativeElement.querySelectorAll('button')].find(
      (button: HTMLButtonElement) =>
        (button.textContent || '').includes('Resync from Spotify'),
    ) as HTMLButtonElement | undefined;
    expect(resync?.getAttribute('title')).toBe(
      'Replace the local dump of Luk Isaan with the live Spotify track list',
    );
    expect(resync?.getAttribute('title')).not.toContain('Recents dump');
    expect(
      fixture.nativeElement.querySelector('.detail-sub')?.textContent,
    ).toContain('Recents rank 199');
    expect(
      fixture.nativeElement.querySelector('.detail-sub')?.textContent,
    ).not.toContain('Recents #');
  });

  it('names operational failures as needs retry on ripping remainder lines, not pending', () => {
    const ripping = playlist('processing', 'Luk Isaan', {
      rank: 199,
      trackCount: 10,
      onDisk: 0,
      available: 0,
      failed: 0,
      percentOnDisk: 0,
      percentAvailable: 0,
    });
    playlistService.all$.next([
      {
        id: 101,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next(
      Array.from({ length: 9 }, (_, index) => ({
        id: 2000 + index,
        artist: 'Queued Artist',
        name: `Queued ${index}`,
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 101,
      })),
    );

    render({
      playlists: [ripping],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    const stats = component.statsOf(ripping);
    expect(stats.needsRetry).toBe(1);
    expect(stats.pending).toBe(0);
    expect(stats.queued).toBe(9);
    expect(
      stats.onDisk +
        stats.failed +
        stats.needsRetry +
        stats.pending +
        stats.queued,
    ).toBe(10);
    const subText = (
      fixture.nativeElement.querySelector('.pl-row .pl-sub')?.textContent || ''
    ).replace(/\s+/g, ' ');
    expect(subText).toContain('1 needs retry');
    expect(subText).toContain('9 waiting');
    expect(subText).not.toContain('pending');
    expect(
      fixture.nativeElement.querySelector('.detail-sub')?.textContent,
    ).toContain('1 needs retry');
    expect(
      fixture.nativeElement.querySelector('.pill.retry')?.textContent,
    ).toContain('Needs retry');
  });

  it('includes dump leftover pending in the sidebar live activity line', () => {
    const ripping = playlist('queued', 'Queued lots', {
      trackCount: 50,
      onDisk: 0,
      available: 0,
      percentOnDisk: 0,
      percentAvailable: 0,
    });
    playlistService.all$.next([
      {
        id: 2,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next(
      Array.from({ length: 10 }, (_, index) => ({
        id: 12 + index,
        artist: 'Artist',
        name: `Queued ${index}`,
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      })),
    );

    render({
      playlists: [ripping],
      totals: { playlists: 1, tracks: 50, onDisk: 0, available: 0 },
    });

    expect(component.dumpPendingTotal).toBe(40);
    expect(component.globalActivitySummary()).toBe('50 waiting');
    expect(
      fixture.nativeElement.querySelector('.sidebar-activity')?.textContent,
    ).toContain('50 waiting');
    expect(
      fixture.nativeElement.querySelector('.sidebar-activity')?.textContent,
    ).not.toContain('pending');
    expect(
      fixture.nativeElement
        .querySelector('.sidebar-activity')
        ?.getAttribute('title'),
    ).toContain('50 waiting');
  });

  it('labels leftover dump tracks as Waiting while a search/download pipeline is live', () => {
    const ripping = playlist('evidence', 'Evidence', {
      trackCount: 3,
      onDisk: 1,
      available: 1,
      percentOnDisk: 33,
      percentAvailable: 33,
    });
    playlistService.all$.next([
      {
        id: 2,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [ripping],
      totals: { playlists: 1, tracks: 3, onDisk: 1, available: 1 },
    });

    const leftover = component.detail!.tracks.find(
      (track) => track.name === 'Not yet',
    );
    expect(leftover).toBeTruthy();
    expect(component.statusKind(leftover!)).toBe('queue');
    expect(component.trackStatusLabel(leftover!)).toBe('Waiting');
    const pendingPill = [
      ...fixture.nativeElement.querySelectorAll('.tracks .pill'),
    ].find((el: HTMLElement) => (el.textContent || '').includes('Pending'));
    expect(pendingPill).toBeUndefined();
    const subText = (
      fixture.nativeElement.querySelector('.pl-row .pl-sub')?.textContent || ''
    ).replace(/\s+/g, ' ');
    expect(subText).toContain('2 waiting');
    expect(subText).not.toContain('pending');
  });

  it('records dump operational failures into the live store after a playlist is opened', () => {
    const processing = playlist('processing', 'Processing');
    playlistService.all$.next([
      {
        id: 101,
        name: processing.name,
        spotifyUrl: processing.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);

    render({
      playlists: [processing],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    expect(trackService.rememberError).toHaveBeenCalledWith(
      jasmine.objectContaining({
        playlistId: 101,
        artist: 'Artist',
        name: 'Retrying track',
        error: 'Temporary YouTube failure: socket timed out',
      }),
    );
  });

  it('dismisses a paused leftover player when switching playlists', () => {
    const first = playlist('evidence', 'Evidence', {
      trackCount: 3,
      onDisk: 1,
      available: 1,
      percentOnDisk: 33,
      percentAvailable: 33,
    });
    const second = playlist('queued', 'Queued lots');

    render({
      playlists: [first, second],
      totals: { playlists: 2, tracks: 13, onDisk: 1, available: 1 },
    });
    component.audioUrl = '/api/library/audio/evidence/1';
    component.paused = true;
    component.playingLabel = 'Evidence track';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.player-bar')).not.toBeNull();

    component.focus(second, false);
    fixture.detectChanges();
    expect(component.audioUrl).toBe('');
    expect(fixture.nativeElement.querySelector('.player-bar')).toBeNull();
  });

  it('hydrates SQLite Error rows for live playlists so needs-retry is visible without opening the dump', () => {
    const ripping = playlist('queued', 'This D.J. Radio', {
      trackCount: 50,
      onDisk: 28,
      available: 28,
      percentOnDisk: 56,
      percentAvailable: 56,
    });
    playlistService.all$.next([
      {
        id: 45,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 45,
      },
      {
        id: 2,
        artist: 'Failed',
        name: 'Needs retry song',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Error,
        error: 'yt-dlp exited 1',
        playlistId: 45,
      },
    ]);

    render({
      playlists: [ripping],
      totals: { playlists: 1, tracks: 50, onDisk: 28, available: 28 },
    });

    expect(trackService.hydrateErrors).toHaveBeenCalledWith(45);
    const stats = component.statsOf(ripping);
    expect(stats.needsRetry).toBe(1);
    const subText = (
      fixture.nativeElement.querySelector('.pl-row .pl-sub')?.textContent || ''
    ).replace(/\s+/g, ' ');
    expect(subText).toContain('needs retry');
  });

  it('counts duplicate live Error rows for the same song as one needs-retry', () => {
    const ripping = playlist('queued', 'Luk Isaan', {
      trackCount: 10,
      onDisk: 6,
      available: 6,
      failed: 1,
      percentOnDisk: 60,
      percentAvailable: 60,
    });
    playlistService.all$.next([
      {
        id: 2,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: -11,
        artist: 'Artist',
        name: 'Failed track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Error,
        error: 'Temporary YouTube failure: socket timed out',
        playlistId: 2,
      },
      {
        id: 13,
        artist: 'Artist',
        name: 'Failed track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Error,
        error: 'Temporary YouTube failure: socket timed out',
        playlistId: 2,
      },
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [ripping],
      totals: { playlists: 1, tracks: 10, onDisk: 6, available: 6 },
    });

    const stats = component.statsOf(ripping);
    expect(stats.needsRetry).toBe(1);
    expect(
      stats.onDisk +
        stats.failed +
        stats.needsRetry +
        stats.queued +
        stats.pending,
    ).toBe(10);
    const subText = (
      fixture.nativeElement.querySelector('.pl-row .pl-sub')?.textContent || ''
    ).replace(/\s+/g, ' ');
    expect(subText).toContain('1 needs retry');
    expect(subText).not.toContain('2 needs retry');
  });

  it('hydrates Error rows for stalled mostly-done playlists and names them needs retry, not leftover needed', () => {
    const dj = playlist('dj-radio', 'This D.J. Radio', {
      trackCount: 50,
      onDisk: 28,
      available: 28,
      percentOnDisk: 56,
      percentAvailable: 56,
    });
    playlistService.all$.next([
      {
        id: 45,
        name: dj.name,
        spotifyUrl: dj.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next(
      Array.from({ length: 15 }, (_, index) => ({
        id: 200 + index,
        artist: 'Failed',
        name: `Needs retry ${index}`,
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Error,
        error: 'yt-dlp exited 1',
        playlistId: 45,
      })),
    );

    render({
      playlists: [dj],
      totals: { playlists: 1, tracks: 50, onDisk: 28, available: 28 },
    });

    expect(trackService.hydrateErrors).toHaveBeenCalledWith(45);
    const stats = component.statsOf(dj);
    expect(stats.ripping).toBe(false);
    expect(stats.needsRetry).toBe(15);
    expect(component.remainingLabel(dj)).toBe('7 needed');
    const subText = (
      fixture.nativeElement.querySelector('.pl-row .pl-sub')?.textContent || ''
    ).replace(/\s+/g, ' ');
    expect(subText).toContain('15 needs retry');
    expect(
      fixture.nativeElement.querySelector('.state-pill.is-needs')?.textContent,
    ).toContain('7 needed');
  });

  it('does not show 0 needed when the leftover is only needs-retry', () => {
    const radio = playlist('relax-radio', 'Relax Radio', {
      trackCount: 50,
      onDisk: 49,
      available: 49,
      percentOnDisk: 98,
      percentAvailable: 98,
    });
    playlistService.all$.next([
      {
        id: 77,
        name: radio.name,
        spotifyUrl: radio.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 901,
        artist: 'Failed',
        name: 'Needs retry song',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Error,
        error: 'yt-dlp exited 1',
        playlistId: 77,
      },
    ]);

    render({
      playlists: [radio],
      totals: { playlists: 1, tracks: 50, onDisk: 49, available: 49 },
    });

    const stats = component.statsOf(radio);
    expect(stats.ripping).toBe(false);
    expect(stats.needsRetry).toBe(1);
    expect(stats.pending).toBe(0);
    expect(component.remainingLabel(radio)).toBe('Needs retry');
    const pill = fixture.nativeElement.querySelector(
      '.state-pill.is-needs',
    ) as HTMLElement | null;
    expect(pill?.textContent).toContain('Needs retry');
    expect(pill?.textContent).not.toContain('0 needed');
    const subText = (
      fixture.nativeElement.querySelector('.pl-row .pl-sub')?.textContent || ''
    ).replace(/\s+/g, ' ');
    expect(subText).toContain('1 needs retry');
    expect(
      (
        fixture.nativeElement.querySelector('.detail-sub')?.textContent || ''
      ).replace(/\s+/g, ' '),
    ).toContain('1 needs retry');
    const action = fixture.nativeElement.querySelector(
      '.detail-actions .btn-primary',
    ) as HTMLElement | null;
    expect(action?.textContent).toContain('Retry 1 failed');
    expect(action?.textContent).not.toContain('Download this playlist');
  });

  it('names copyable leftover instead of 0 needed when nothing remains for YouTube', () => {
    const partial = playlist('copy-only', 'Copy only radio', {
      trackCount: 10,
      onDisk: 7,
      available: 10,
      percentOnDisk: 70,
      percentAvailable: 100,
    });

    render({
      playlists: [partial],
      totals: { playlists: 1, tracks: 10, onDisk: 7, available: 10 },
    });

    const stats = component.statsOf(partial);
    expect(stats.copyable).toBe(3);
    expect(stats.pending).toBe(0);
    expect(component.remainingLabel(partial)).toBe('3 copyable');
    const pill = fixture.nativeElement.querySelector(
      '.state-pill.is-needs',
    ) as HTMLElement | null;
    expect(pill?.textContent).toContain('3 copyable');
    expect(pill?.textContent).not.toContain('0 needed');
    const action = fixture.nativeElement.querySelector(
      '.detail-actions .btn-primary',
    ) as HTMLElement | null;
    expect(action?.textContent).toContain('Copy 3 already ripped');
    expect(action?.textContent).not.toContain('Download this playlist');
  });

  it('keeps Download this playlist when YouTube work remains', () => {
    const partial = playlist('massage', 'Massage', {
      trackCount: 293,
      onDisk: 1,
      available: 1,
      failed: 2,
      percentOnDisk: 0,
      percentAvailable: 0,
    });

    render({
      playlists: [partial],
      totals: { playlists: 1, tracks: 293, onDisk: 1, available: 1 },
    });

    expect(component.focusedActionLabel(partial)).toBe(
      'Download this playlist',
    );
    expect(
      fixture.nativeElement.querySelector('.detail-actions .btn-primary')
        ?.textContent,
    ).toContain('Download this playlist');
  });

  it('labels dump leftover as waiting while the library queue is live, even without local live rows', () => {
    const leftover = playlist('evidence', 'Ambient leftover', {
      trackCount: 3,
      onDisk: 1,
      available: 1,
      percentOnDisk: 33,
      percentAvailable: 33,
    });
    const queued = playlist('queued', 'Queued lots');
    playlistService.all$.next([
      {
        id: 2,
        name: queued.name,
        spotifyUrl: queued.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [leftover, queued],
      totals: { playlists: 2, tracks: 13, onDisk: 1, available: 1 },
    });

    const leftoverStats = component.statsOf(leftover);
    expect(leftoverStats.ripping).toBe(true);
    expect(leftoverStats.queued).toBe(0);
    expect(leftoverStats.pending).toBe(2);
    expect(component.activityLabel(leftover)).toBe('2 waiting');
    expect(component.remainingLabel(leftover)).toBe('2 waiting');
    expect(component.visiblePlaylists.map((item) => item.name)).toEqual([
      'Queued lots',
      'Ambient leftover',
    ]);

    const leftoverRow = [
      ...fixture.nativeElement.querySelectorAll('.pl-row'),
    ].find((row: HTMLElement) =>
      (row.querySelector('.pl-name')?.textContent || '').includes(
        'Ambient leftover',
      ),
    ) as HTMLElement;
    expect(leftoverRow.classList).toContain('is-ripping');
    expect(
      leftoverRow.querySelector('.state-pill.is-wait')?.textContent,
    ).toContain('2 waiting');
    expect(leftoverRow.querySelector('.state-pill.is-needs')).toBeNull();
    expect(leftoverRow.textContent).not.toContain('needed');

    component.focus(leftover, false);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('.detail-actions .btn-primary'),
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.detail-actions .btn-lg')
        ?.textContent,
    ).toContain('2 waiting');
    const leftoverTrack = component.detail!.tracks.find(
      (track) => track.name === 'Not yet',
    );
    expect(leftoverTrack).toBeTruthy();
    expect(component.statusKind(leftoverTrack!)).toBe('queue');
    expect(component.trackStatusLabel(leftoverTrack!)).toBe('Waiting');
  });

  it('still hydrates stalled errors on leftover playlists while the library queue is live', () => {
    const dj = playlist('dj-radio', 'This D.J. Radio', {
      trackCount: 50,
      onDisk: 28,
      available: 28,
      percentOnDisk: 56,
      percentAvailable: 56,
    });
    const queued = playlist('queued', 'Queued lots');
    playlistService.all$.next([
      {
        id: 45,
        name: dj.name,
        spotifyUrl: dj.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
      {
        id: 2,
        name: queued.name,
        spotifyUrl: queued.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [dj, queued],
      totals: { playlists: 2, tracks: 60, onDisk: 28, available: 28 },
    });

    expect(trackService.hydrateErrors).toHaveBeenCalledWith(45);
    expect(component.statsOf(dj).ripping).toBe(true);
    expect(component.statsOf(dj).queued).toBe(0);
    expect(component.activityLabel(dj)).toBe('22 waiting');
  });

  it('names implied-waiting leftover playlists on the live-queue toggle instead of undercounting', () => {
    const leftover = playlist('ambient', 'Ambient leftover', {
      trackCount: 20,
      onDisk: 5,
      available: 5,
      percentOnDisk: 25,
      percentAvailable: 25,
    });
    const queued = playlist('queued', 'Queued lots');
    playlistService.all$.next([
      {
        id: 2,
        name: queued.name,
        spotifyUrl: queued.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [leftover, queued],
      totals: { playlists: 2, tracks: 30, onDisk: 5, available: 5 },
    });
    component.queueOpen = true;
    fixture.detectChanges();

    const toggle = (
      fixture.nativeElement.querySelector('.queue-toggle')?.textContent || ''
    ).replace(/\s+/g, ' ');
    expect(toggle).toContain('1 live · 1 waiting');
    expect(toggle).not.toContain('1 playlist in queue');
    expect(component.impliedWaitingPlaylistCount).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('.queue-pl').length).toBe(1);
    expect(
      fixture.nativeElement.querySelector('.queue-body .legend')?.textContent,
    ).toContain('Other waiting leftovers stay in the playlist list');
  });

  it('does not let extra live Error rows push a focused playlist remainder past its track count', () => {
    const dj = playlist('dj-overflow', 'This D.J. Radio', {
      trackCount: 10,
      onDisk: 6,
      available: 6,
      percentOnDisk: 60,
      percentAvailable: 60,
    });
    libraryService.detail.and.callFake(() =>
      of({
        playlist: dj,
        tracks: [
          ...Array.from({ length: 6 }, (_, index) => ({
            n: index + 1,
            artist: 'Saved',
            name: `Disk ${index}`,
            onDisk: true,
            available: true,
            filename: `Saved - Disk ${index}.mp3`,
          })),
          ...Array.from({ length: 2 }, (_, index) => ({
            n: 7 + index,
            artist: 'Failed',
            name: `Retry ${index}`,
            onDisk: false,
            available: false,
            error: 'yt-dlp exited 1',
            missing: false,
          })),
          ...Array.from({ length: 2 }, (_, index) => ({
            n: 9 + index,
            artist: 'Left',
            name: `Left ${index}`,
            onDisk: false,
            available: false,
          })),
        ],
      }),
    );
    playlistService.all$.next([
      {
        id: 45,
        name: dj.name,
        spotifyUrl: dj.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Left',
        name: 'Left 0',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 45,
      },
      ...Array.from({ length: 2 }, (_, index) => ({
        id: 20 + index,
        artist: 'Saved',
        name: `Disk ${index}`,
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Error,
        error: 'yt-dlp exited 1',
        playlistId: 45,
      })),
      ...Array.from({ length: 2 }, (_, index) => ({
        id: 30 + index,
        artist: 'Failed',
        name: `Retry ${index}`,
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Error,
        error: 'yt-dlp exited 1',
        playlistId: 45,
      })),
    ]);

    render({
      playlists: [dj],
      totals: { playlists: 1, tracks: 10, onDisk: 6, available: 6 },
    });

    const stats = component.statsOf(dj);
    expect(stats.needsRetry).toBe(2);
    expect(stats.queued + stats.pending).toBe(2);
    expect(
      stats.onDisk +
        stats.failed +
        stats.needsRetry +
        stats.queued +
        stats.pending,
    ).toBe(10);
    const subText = (
      fixture.nativeElement.querySelector('.pl-row .pl-sub')?.textContent || ''
    ).replace(/\s+/g, ' ');
    expect(subText).toContain('2 needs retry');
    expect(subText).toContain('2 waiting');
    expect(subText).not.toContain('4 needs retry');
    expect(
      fixture.nativeElement.querySelectorAll('.tracks .pill.retry').length,
    ).toBe(2);
    expect(
      fixture.nativeElement.querySelectorAll('.tracks .pill.waiting').length,
    ).toBe(2);
  });

  it('names implied-waiting leftover playlists on the live-queue toggle instead of undercounting', () => {
    const leftover = playlist('ambient', 'Ambient leftover', {
      trackCount: 20,
      onDisk: 5,
      available: 5,
      percentOnDisk: 25,
      percentAvailable: 25,
    });
    const queued = playlist('queued', 'Queued lots');
    playlistService.all$.next([
      {
        id: 2,
        name: queued.name,
        spotifyUrl: queued.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [leftover, queued],
      totals: { playlists: 2, tracks: 30, onDisk: 5, available: 5 },
    });
    component.queueOpen = true;
    fixture.detectChanges();

    const toggle = (
      fixture.nativeElement.querySelector('.queue-toggle')?.textContent || ''
    ).replace(/\s+/g, ' ');
    expect(toggle).toContain('1 live · 1 waiting');
    expect(toggle).not.toContain('1 playlist in queue');
    expect(component.impliedWaitingPlaylistCount).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('.queue-pl').length).toBe(1);
    expect(
      fixture.nativeElement.querySelector('.queue-body .legend')?.textContent,
    ).toContain('Other waiting leftovers stay in the playlist list');
  });
});
