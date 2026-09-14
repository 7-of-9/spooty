import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AppComponent } from './app.component';
import { LibraryService } from './services/library.service';
import { PlaylistService } from './services/playlist.service';
import { TrackService } from './services/track.service';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        {
          provide: LibraryService,
          useValue: {
            fetch: () =>
              of({
                playlists: [],
                totals: {
                  playlists: 0,
                  tracks: 0,
                  onDisk: 0,
                  available: 0,
                },
              }),
            syncLibrary: () =>
              throwError(() => new Error('Spotify unavailable')),
            syncLibraryStatus: () =>
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
            youtubePace: () =>
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
              }),
          },
        },
        {
          provide: PlaylistService,
          useValue: {
            all$: of([]),
            fetch: jasmine.createSpy('fetch'),
          },
        },
        {
          provide: TrackService,
          useValue: {
            all$: of([]),
            progress$: of({}),
            activeReady$: of(true),
          },
        },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should expose the package version', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('should render the Spooty brand', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.topbar-brand')?.textContent).toContain(
      'Spooty',
    );
    expect(compiled.querySelector('.topbar-sub')?.textContent).toContain(
      'Local Spotify library',
    );
  });
});
