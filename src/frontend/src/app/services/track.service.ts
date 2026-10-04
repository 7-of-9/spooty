import { Injectable, NgZone } from '@angular/core';
import { createStore } from '@ngneat/elf';
import {
  deleteEntities,
  getAllEntities,
  getEntity,
  selectAllEntities,
  selectManyByPredicate,
  setEntities,
  upsertEntities,
  withEntities,
} from '@ngneat/elf-entities';
import { Socket } from 'ngx-socket-io';
import { BehaviorSubject, map, Observable, Subject, tap } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { Track, TrackStatusEnum } from '../models/track';
import { spotifySourceId } from '../../../../backend/src/shared/acquisition/source-id';

const STORE_NAME = 'track';
const ENDPOINT = '/api/track';
enum WsTrackOperation {
  New = 'trackNew',
  Update = 'trackUpdate',
  Delete = 'trackDelete',
}

@Injectable({
  providedIn: 'root',
})
export class TrackService {
  private store = createStore({ name: STORE_NAME }, withEntities<Track>());
  private readonly progressSubject = new BehaviorSubject<
    Record<number, number>
  >({});
  readonly progress$ = this.progressSubject.asObservable();
  readonly all$ = this.store.pipe(selectAllEntities());
  private readonly activeReadySubject = new BehaviorSubject(false);
  readonly activeReady$ = this.activeReadySubject.asObservable();
  private readonly coverageChanges = new Subject<void>();
  readonly coverageChanges$ = this.coverageChanges.asObservable();

  getAllByPlaylist(id: number, status?: TrackStatusEnum): Observable<Track[]> {
    return this.store.pipe(
      selectManyByPredicate((track) => track?.playlistId === id),
      map((data) =>
        data.filter((item) => status === undefined || item.status === status),
      ),
    );
  }

  getCompletedByPlaylist(id: number): Observable<Track[]> {
    return this.getAllByPlaylist(id, TrackStatusEnum.Completed);
  }

  getErrorByPlaylist(id: number): Observable<Track[]> {
    return this.getAllByPlaylist(id, TrackStatusEnum.Error);
  }

  constructor(
    private readonly http: HttpClient,
    private readonly socket: Socket,
    private readonly zone: NgZone,
  ) {
    this.initWsConnection();
  }

  fetch(playlistId: number): void {
    this.http
      .get<Track[]>(`${ENDPOINT}/playlist/${playlistId}`)
      .pipe(
        tap((data: Track[]) =>
          this.store.update(
            upsertEntities(data.map((track) => ({ ...track, playlistId }))),
          ),
        ),
      )
      .subscribe();
  }

  fetchActive(): void {
    this.http
      .get<Track[]>(`${ENDPOINT}/active`)
      .pipe(
        tap((data) => {
          const incoming = data.map((track) => ({
            ...track,
            playlistId:
              track.playlistId ??
              (track as Track & { playlist?: { id?: number } }).playlist?.id,
          }));
          const incomingIds = new Set(incoming.map((track) => track.id));
          const keepErrors = this.store
            .query(getAllEntities())
            .filter(
              (track) =>
                track.status === TrackStatusEnum.Error &&
                !incomingIds.has(track.id),
            );
          this.store.update(setEntities([...incoming, ...keepErrors]));
        }),
      )
      .subscribe({
        next: () => this.activeReadySubject.next(true),
        error: () => this.activeReadySubject.next(true),
      });
  }

  delete(id: number): void {
    this.http.delete(`${ENDPOINT}/${id}`).subscribe();
  }

  retry(id: number): void {
    this.http.get(`${ENDPOINT}/retry/${id}`).subscribe();
  }

  hydrateErrors(playlistId: number): void {
    if (!playlistId || this.errorHydrated.has(playlistId)) return;
    this.errorHydrated.add(playlistId);
    this.errorQueue.push(playlistId);
    this.pumpErrorHydration();
  }

  private errorHydrated = new Set<number>();
  private errorQueue: number[] = [];
  private errorInflight = 0;

  private pumpErrorHydration(): void {
    while (this.errorInflight < 2 && this.errorQueue.length) {
      const playlistId = this.errorQueue.shift()!;
      this.errorInflight++;
      this.http.get<Track[]>(`${ENDPOINT}/playlist/${playlistId}`).subscribe({
        next: (data) => {
          const errors = data
            .filter((track) => track.status === TrackStatusEnum.Error)
            .map((track) => ({
              ...track,
              playlistId:
                track.playlistId ??
                (track as Track & { playlist?: { id?: number } }).playlist
                  ?.id ??
                playlistId,
            }));
          if (!errors.length) return;
          const incomingKeys = new Set(
            errors.map(
              (track) =>
                `${track.playlistId}\0${this.sourceIdentity(track)}`,
            ),
          );
          const staleSynthetic = this.store
            .query(getAllEntities())
            .filter(
              (track) =>
                track.id < 0 &&
                track.status === TrackStatusEnum.Error &&
                incomingKeys.has(
                  `${track.playlistId}\0${this.sourceIdentity(track)}`,
                ),
            )
            .map((track) => track.id);
          if (staleSynthetic.length) {
            this.store.update(deleteEntities(staleSynthetic));
          }
          this.store.update(upsertEntities(errors));
        },
        error: () => {
          this.errorInflight--;
          this.pumpErrorHydration();
        },
        complete: () => {
          this.errorInflight--;
          this.pumpErrorHydration();
        },
      });
    }
  }

  rememberError(input: {
    playlistId: number;
    artist: string;
    name: string;
    error: string;
    spotifyUrl?: string;
  }): void {
    const key = this.sourceIdentity(input);
    const existing = this.store.query(getAllEntities()).find(
      (track) =>
        track.playlistId === input.playlistId &&
        track.status === TrackStatusEnum.Error &&
        this.sourceIdentity(track) === key,
    );
    if (existing) {
      if (existing.error !== input.error) {
        this.store.update(
          upsertEntities([{ ...existing, error: input.error }]),
        );
      }
      return;
    }
    this.store.update(
      upsertEntities([
        {
          id: this.syntheticErrorId(
            input.playlistId,
            input.artist,
            input.name,
            input.spotifyUrl,
          ),
          artist: input.artist,
          name: input.name,
          spotifyUrl: input.spotifyUrl || '',
          youtubeUrl: '',
          status: TrackStatusEnum.Error,
          error: input.error,
          playlistId: input.playlistId,
        },
      ]),
    );
  }

  private syntheticErrorId(
    playlistId: number,
    artist: string,
    name: string,
    spotifyUrl?: string,
  ): number {
    const key = `${playlistId}|||${this.sourceIdentity({ artist, name, spotifyUrl })}`;
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = (hash * 31 + key.charCodeAt(i)) | 0;
    }
    return hash === 0 ? -1 : -Math.abs(hash);
  }

  private sourceIdentity(track: { artist: string; name: string; spotifyUrl?: string }): string {
    const id = spotifySourceId(track.spotifyUrl);
    return id ? `spotify:${id}` : `${track.artist}\0${track.name}`.toLowerCase();
  }

  private initWsConnection(): void {
    this.socket.on('libraryCoverageChanged', () => this.zone.run(() => this.coverageChanges.next()));
    this.socket.on('connect', () => this.zone.run(() => this.coverageChanges.next()));
    this.socket.on(WsTrackOperation.Update, (track: Track) => {
      this.zone.run(() => {
        const current = this.store.query(getEntity(track.id));
        const playlistId =
          track.playlistId ??
          (track as Track & { playlist?: { id?: number } }).playlist?.id ??
          current?.playlistId;
        this.store.update(
          upsertEntities([{ ...current, ...track, playlistId }]),
        );
        if (
          track.status === TrackStatusEnum.Completed ||
          track.status === TrackStatusEnum.Error
        ) {
          const next = { ...this.progressSubject.value };
          delete next[track.id];
          this.progressSubject.next(next);
        }
      });
    });
    this.socket.on(WsTrackOperation.Delete, ({ id }: { id: number }) =>
      this.zone.run(() => this.store.update(deleteEntities(id))),
    );
    this.socket.on(
      WsTrackOperation.New,
      ({ track, playlistId }: { track: Track; playlistId: number }) =>
        this.zone.run(() =>
          this.store.update(upsertEntities([{ ...track, playlistId }])),
        ),
    );
    this.socket.on('trackProgress', (data: { id: number; percent: number }) => {
      if (!data?.id && data?.id !== 0) return;
      this.zone.run(() => {
        this.progressSubject.next({
          ...this.progressSubject.value,
          [data.id]: data.percent,
        });
      });
    });
  }
}
