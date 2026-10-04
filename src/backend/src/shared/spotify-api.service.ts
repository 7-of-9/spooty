import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { SpotifySessionService } from './spotify-session.service';
import { SpotifyMembership } from './spotify-membership';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fetch = require('isomorphic-unfetch');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getDetails } = require('spotify-url-info')(fetch);

export type SpotifyTrackList = any[] & { truncated?: boolean; membership?: SpotifyMembership };

function loadUserAccessToken(): string | null {
  if (process.env.SPOTIFY_ACCESS_TOKEN) {
    return process.env.SPOTIFY_ACCESS_TOKEN;
  }
  const candidates = [
    resolve(process.cwd(), '.spotify_token'),
    resolve(__dirname, '../../../../.spotify_token'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const token = readFileSync(p, 'utf8').trim();
      if (token) return token;
    }
  }
  return null;
}

@Injectable()
export class SpotifyApiService {
  private readonly logger = new Logger(SpotifyApiService.name);
  private embedToken: string | null = null;
  private embedTokenExpiry: number = 0;

  constructor(private readonly session: SpotifySessionService) {}

  getLibraryPlaylists() {
    return this.session.getLibraryPlaylists();
  }

  private getPlaylistId(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      const playlistIndex = pathParts.findIndex((part) => part === 'playlist');
      if (playlistIndex >= 0 && pathParts.length > playlistIndex + 1) {
        return pathParts[playlistIndex + 1].split('?')[0];
      }
      throw new Error('Invalid Spotify playlist URL');
    } catch (error) {
      this.logger.error(`Failed to extract playlist ID: ${error.message}`);
      throw error;
    }
  }

  isTrackUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.pathname.includes('/track/');
    } catch {
      return false;
    }
  }

  private getTrackId(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      const trackIndex = pathParts.findIndex((part) => part === 'track');
      if (trackIndex >= 0 && pathParts.length > trackIndex + 1) {
        return pathParts[trackIndex + 1].split('?')[0];
      }
      throw new Error('Invalid Spotify track URL');
    } catch (error) {
      this.logger.error(`Failed to extract track ID: ${error.message}`);
      throw error;
    }
  }

  async getTrackMetadata(
    spotifyUrl: string,
  ): Promise<{ name: string; artist: string; image: string }> {
    try {
      this.logger.debug(`Getting track metadata for ${spotifyUrl}`);
      const trackId = this.getTrackId(spotifyUrl);
      const accessToken = await this.getEmbedToken('track', trackId);

      const response = await fetch(
        `https://api.spotify.com/v1/tracks/${trackId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch track: ${response.status}`);
      }

      const data = await response.json();

      return {
        name: data.name,
        artist: data.artists.map((a) => a.name).join(', '),
        image: data.album.images[0]?.url || '',
      };
    } catch (error) {
      this.logger.error(`Failed to get track metadata: ${error.message}`);
      throw error;
    }
  }

  async getPlaylistMetadata(
    spotifyUrl: string,
  ): Promise<{ name: string; image: string }> {
    try {
      this.logger.debug(`Getting playlist metadata for ${spotifyUrl}`);
      const playlistId = this.getPlaylistId(spotifyUrl);
      const accessToken = await this.getEmbedToken('playlist', playlistId);
      const response = await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}?fields=name,images`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (response.ok) {
        const data = await response.json();
        return {
          name: data.name,
          image: data.images?.[0]?.url || '',
        };
      }
      this.logger.warn(
        `Playlist API metadata ${response.status}, falling back to embed details`,
      );
      const detail = await getDetails(spotifyUrl);
      return {
        name: detail.preview.title,
        image: detail.preview.image,
      };
    } catch (error) {
      this.logger.error(`Failed to get playlist metadata: ${error.message}`);
      throw error;
    }
  }

  private async getEmbedToken(
    type: string = 'track',
    id: string = '4uLU6hMCjMI75M1A2tKUQC',
  ): Promise<string> {
    try {
      const sessionToken = await this.session.getAccessToken();
      if (sessionToken) return sessionToken;
    } catch (e) {
      this.logger.debug(
        `No Chrome session token: ${e instanceof Error ? e.message : e}`,
      );
    }
    const userToken = loadUserAccessToken();
    if (userToken) {
      this.logger.debug(
        'Using user Spotify access token for private playlist access',
      );
      return userToken;
    }
    if (this.embedToken && Date.now() < this.embedTokenExpiry) {
      return this.embedToken;
    }

    this.logger.debug('Getting anonymous embed token from Spotify');
    const embedRes = await fetch(
      `https://open.spotify.com/embed/${type}/${id}`,
    );
    if (!embedRes.ok) {
      throw new Error(`Failed to fetch embed page: ${embedRes.status}`);
    }
    const html = await embedRes.text();
    const scriptMatch = html.match(
      /<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s,
    );
    if (!scriptMatch) {
      throw new Error('Could not find __NEXT_DATA__ in embed page');
    }
    const nextData = JSON.parse(scriptMatch[1]);
    const session = nextData?.props?.pageProps?.state?.settings?.session;
    if (!session?.accessToken) {
      throw new Error('No access token in embed page data');
    }
    this.embedToken = session.accessToken;
    this.embedTokenExpiry = session.accessTokenExpirationTimestampMs - 60000;
    this.logger.debug('Successfully obtained embed token');
    return this.embedToken;
  }

  private extractEmbedTracks(html: string): any[] {
    const scriptMatch = html.match(
      /<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s,
    );
    if (!scriptMatch) return [];
    const nextData = JSON.parse(scriptMatch[1]);
    const trackList =
      nextData?.props?.pageProps?.state?.data?.entity?.trackList;
    if (!Array.isArray(trackList)) return [];
    return trackList
      .map((t: any) => {
        if (!t.uri) return null;
        const idMatch = t.uri.match(/spotify:track:(.+)/);
        return {
          id: idMatch ? idMatch[1] : t.uid,
          name: t.title,
          artist: t.subtitle,
          previewUrl: null,
          coverUrl: null,
        };
      })
      .filter((t) => t !== null);
  }

  async getAllPlaylistTracks(
    spotifyUrl: string,
    known?: Map<
      string,
      { name?: string; artist?: string; coverUrl?: string | null; durationMs?: number }
    >,
  ): Promise<SpotifyTrackList> {
    const playlistId = this.getPlaylistId(spotifyUrl);
    // The authenticated session collector is authoritative, including a
    // validated empty playlist. Never replace it with anonymous embed data.
    const live = await this.session.getPlaylistTracks(playlistId, known);
    const tracks = live.tracks.map((t) => ({
      id: t.id,
      name: t.name,
      artist: t.artist,
      previewUrl: null,
      coverUrl: t.coverUrl || null,
      href: t.href,
      n: t.n,
      durationMs: t.durationMs,
    })) as SpotifyTrackList;
    tracks.truncated = live.truncated;
    tracks.membership = live.membership;
    return tracks;
  }
}
