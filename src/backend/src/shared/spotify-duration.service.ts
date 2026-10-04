import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'path';
import { SpotifySessionService } from './spotify-session.service';
import {
  createDurationResolver,
  positiveDurationMs,
} from './acquisition/spotify-duration';
import { DURATION_SOURCE_MISSING } from './acquisition/duration-policy';
import { spotifySourceId } from './acquisition/source-id';

export type SpotifyDurationMetadata = {
  version: 1;
  spotifyId: string;
  name: string;
  artist: string;
  durationMs: number;
  album?: string;
  fetchedAt: string;
};
export function spotifyTrackId(
  value: string | undefined | null,
): string | null {
  return spotifySourceId(value);
}
export function normalizedSpotifyIdentity(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}
export const validDurationMs = positiveDurationMs;

@Injectable()
export class SpotifyDurationService {
  private readonly resolveDuration: ReturnType<typeof createDurationResolver>;
  constructor(
    private readonly session: SpotifySessionService,
    config: ConfigService,
  ) {
    const cachePath =
      config.get<string>('SPOTIFY_TRACK_METADATA_PATH') ||
      process.env.SPOTIFY_TRACK_METADATA_PATH ||
      resolve(__dirname, '../../../../data/spotify-track-metadata');
    this.resolveDuration = createDurationResolver(cachePath, async (id) => {
      const row = await this.session.getTrackDurationMetadata(id);
      return {
        version: 1,
        spotifyId: id,
        name: row.name,
        artist: row.artist,
        durationMs: row.durationMs,
        album: row.album,
        fetchedAt: new Date().toISOString(),
      };
    });
  }
  async ensure(track: {
    spotifyUrl?: string;
    spotifyIds?: string[];
    name: string;
    artist: string;
    durationMs?: number | null;
    searchAlbum?: string;
  }): Promise<number> {
    const id = spotifyTrackId(track.spotifyUrl);
    const ids = id ? [id] : [...new Set(track.spotifyIds || [])];
    if (!ids.length) throw new Error(DURATION_SOURCE_MISSING);
    try {
      const song: any = { ...track, spotifyIds: ids };
      const duration = await this.resolveDuration(song);
      track.searchAlbum = song.album;
      return duration;
    } catch {
      throw new Error(DURATION_SOURCE_MISSING);
    } // never persist session diagnostics
  }
}
