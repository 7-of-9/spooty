import { TestBed } from '@angular/core/testing';
import { NgZone } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Socket } from 'ngx-socket-io';
import { firstValueFrom } from 'rxjs';

import { TrackService } from './track.service';
import { TrackStatusEnum } from '../models/track';

describe('TrackService', () => {
  let service: TrackService;
  let handlers: Record<string, (payload: unknown) => void>;

  beforeEach(() => {
    handlers = {};
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: Socket,
          useValue: {
            on: (event: string, cb: (payload: unknown) => void) => {
              handlers[event] = cb;
            },
          },
        },
      ],
    });
    service = TestBed.inject(TrackService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('forwards file-change and reconnect notices inside Angular without making an HTTP mutation', () => {
    const http = TestBed.inject(HttpTestingController);
    const run = spyOn(TestBed.inject(NgZone), 'run').and.callThrough();
    let notices = 0; const inAngular: boolean[] = [];
    const subscription = service.coverageChanges$.subscribe(() => { notices++; inAngular.push(NgZone.isInAngularZone()); });
    handlers['libraryCoverageChanged']({ id: 'new-scan', invalidated: false });
    handlers['connect']({});
    expect(notices).toBe(2); expect(inAngular).toEqual([true, true]); expect(run).toHaveBeenCalled(); http.expectNone(() => true);
    subscription.unsubscribe();
  });

  it('does not mark the live queue ready until fetchActive completes', () => {
    let ready = true;
    service.activeReady$.subscribe((value) => (ready = value));
    expect(ready).toBe(false);
  });

  it('applies websocket track updates inside Angular zone', () => {
    const zone = TestBed.inject(NgZone);
    const run = spyOn(zone, 'run').and.callThrough();
    handlers['trackUpdate']({
      id: 1,
      artist: 'Artist',
      name: 'Track',
      spotifyUrl: '',
      youtubeUrl: '',
      status: TrackStatusEnum.Searching,
    });
    expect(run).toHaveBeenCalled();
  });

  it('keeps operational Error rows when the active queue is refreshed', async () => {
    const http = TestBed.inject(HttpTestingController);
    handlers['trackUpdate']({
      id: 5,
      artist: 'Artist',
      name: 'Failed track',
      spotifyUrl: '',
      youtubeUrl: '',
      status: TrackStatusEnum.Error,
      error: 'Temporary YouTube failure: socket timed out',
      playlistId: 9,
    });

    service.fetchActive();
    http.expectOne('/api/track/active').flush([
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

    const tracks = await firstValueFrom(service.all$);
    expect(tracks.map((track) => track.id).sort((a, b) => a - b)).toEqual([
      5, 12,
    ]);
    expect(
      tracks.find((track) => track.id === 5)?.status,
    ).toBe(TrackStatusEnum.Error);
    http.verify();
  });

  it('remembers dump operational failures without duplicating an existing Error row', async () => {
    service.rememberError({
      playlistId: 9,
      artist: 'Artist',
      name: 'Failed track',
      error: 'Temporary YouTube failure: socket timed out',
    });
    service.rememberError({
      playlistId: 9,
      artist: 'Artist',
      name: 'Failed track',
      error: 'Temporary YouTube failure: socket timed out',
    });
    const tracks = await firstValueFrom(service.all$);
    const errors = tracks.filter(
      (track) => track.status === TrackStatusEnum.Error,
    );
    expect(errors.length).toBe(1);
    expect(errors[0].playlistId).toBe(9);
    expect(errors[0].name).toBe('Failed track');
  });

  it('hydrates only Error rows from a playlist track list and does not refetch', async () => {
    const http = TestBed.inject(HttpTestingController);
    service.hydrateErrors(45);
    service.hydrateErrors(45);
    const req = http.expectOne('/api/track/playlist/45');
    req.flush([
      {
        id: 1,
        artist: 'Queued',
        name: 'Waiting song',
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
      {
        id: 3,
        artist: 'Saved',
        name: 'On disk song',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Completed,
        playlistId: 45,
      },
    ]);
    const tracks = await firstValueFrom(service.all$);
    expect(tracks.map((track) => track.id)).toEqual([2]);
    expect(tracks[0].status).toBe(TrackStatusEnum.Error);
    expect(tracks[0].error).toBe('yt-dlp exited 1');
    http.verify();
  });

  it('drops synthetic dump Error rows when the same SQLite Error is hydrated', async () => {
    const http = TestBed.inject(HttpTestingController);
    service.rememberError({
      playlistId: 45,
      artist: 'Failed',
      name: 'Needs retry song',
      error: 'yt-dlp exited 1',
    });
    service.hydrateErrors(45);
    http.expectOne('/api/track/playlist/45').flush([
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
    const tracks = await firstValueFrom(service.all$);
    const errors = tracks.filter(
      (track) => track.status === TrackStatusEnum.Error,
    );
    expect(errors.length).toBe(1);
    expect(errors[0].id).toBe(2);
    http.verify();
  });
});
