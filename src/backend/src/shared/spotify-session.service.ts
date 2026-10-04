import { Injectable, Logger } from '@nestjs/common';
import { completeSpotifyMembership, SpotifyMembership } from './spotify-membership';
import { CdpProxyClient } from './cdp-proxy.client';
import { collectSpotifyLibrary, SpotifyLibraryPlaylist } from './spotify-library-pages';
import {
  collectPlaylistV2TrackIds,
  PlaylistV2Page,
} from './spotify-playlist-v2';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const TOKEN_URL = 'https://open.spotify.com/?spooty-token=1';
const B62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const META_CONC = Math.max(1, Number(process.env.SPOTIFY_META_CONC || 2));
const META_GAP_MS = Math.max(0, Number(process.env.SPOTIFY_META_GAP_MS || 250));
const MAX_RETRY_AFTER_MS = 60_000;
const DEFAULT_HTTP_TIMEOUT_MS = 20_000;

function httpTimeoutMs(): number {
  const configured = Number(process.env.SPOTIFY_HTTP_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 100
    ? Math.floor(configured)
    : DEFAULT_HTTP_TIMEOUT_MS;
}

class RequestGate {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  private nextAt = 0;
  private pauseUntil = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly conc: number,
    private readonly gapMs: number,
  ) {}

  pause(ms: number) {
    this.pauseUntil = Math.max(this.pauseUntil, Date.now() + ms);
    this.kick();
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(() => {
        this.active++;
        this.nextAt = Date.now() + this.gapMs;
        fn()
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            this.kick();
          });
      });
      this.kick();
    });
  }

  private kick() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.active >= this.conc || !this.queue.length) return;
    const wait = Math.max(
      0,
      this.nextAt - Date.now(),
      this.pauseUntil - Date.now(),
    );
    if (wait > 0) {
      this.timer = setTimeout(() => this.kick(), wait);
      return;
    }
    const job = this.queue.shift();
    if (job) job();
    if (this.active < this.conc && this.queue.length) {
      this.timer = setTimeout(() => this.kick(), this.gapMs);
    }
  }
}

const HOOK = `(() => {
  if (window.__spootyHooked) return;
  window.__spootyHooked = true;
  window.__spootyAuth = null;
  const orig = window.fetch;
  window.fetch = function (input, init) {
    const url = String((input && input.url) || input || '');
    const p = orig.apply(this, arguments);
    if (/\\/api\\/token|get_access_token/i.test(url)) {
      p.then((r) =>
        r.clone().json().then((j) => {
          if (j && (j.accessToken || j.access_token)) {
            window.__spootyAuth = {
              token: j.accessToken || j.access_token,
              expires: j.accessTokenExpirationTimestampMs || null,
              isAnonymous: j.isAnonymous ?? null,
            };
          }
        }).catch(() => {}),
      ).catch(() => {});
    }
    return p;
  };
})();`;

export type SessionTrack = {
  id: string;
  name: string;
  artist: string;
  coverUrl?: string | null;
  href?: string;
  n?: number;
  durationMs?: number;
  album?: string;
};

export type KnownTrack = {
  name?: string;
  artist?: string;
  coverUrl?: string | null;
  durationMs?: number;
};

export type SessionPlaylist = SpotifyLibraryPlaylist;

@Injectable()
export class SpotifySessionService {
  private readonly logger = new Logger(SpotifySessionService.name);
  private cached: { token: string; expires: number } | null = null;
  private readonly gate = new RequestGate(META_CONC, META_GAP_MS);

  constructor(private readonly cdp: CdpProxyClient) {}

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const limit = httpTimeoutMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limit);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Spotify request timed out after ${limit}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async sessionFetch(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    let last: Response | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await this.gate.run(() => this.fetchWithTimeout(url, init));
      last = res;
      if (res.status !== 429 && res.status < 500) return res;
      const raw = Number(res.headers.get('retry-after') || 2 * (attempt + 1));
      const waitMs = Math.min(
        Number.isFinite(raw) ? raw * 1000 : 2000 * (attempt + 1),
        MAX_RETRY_AFTER_MS,
      );
      this.logger.warn(
        `Spotify ${res.status} ${new URL(url).pathname} — pause ${Math.round(waitMs / 1000)}s`,
      );
      this.gate.pause(waitMs);
    }
    return last as Response;
  }

  private headers(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      'User-Agent': UA,
      accept: 'application/json',
      origin: 'https://open.spotify.com',
      referer: 'https://open.spotify.com/',
    };
  }

  private idToGid(id: string): string {
    let n = 0n;
    for (const c of id) {
      const i = B62.indexOf(c);
      if (i < 0) throw new Error('bad spotify id');
      n = n * 62n + BigInt(i);
    }
    return n.toString(16).padStart(32, '0');
  }

  async getAccessToken(): Promise<string> {
    if (this.cached && Date.now() < this.cached.expires - 60_000) {
      return this.cached.token;
    }
    if (!(await this.cdp.healthy())) {
      throw new Error('CDP proxy is down');
    }

    const { sessionId } = await this.cdp.tab();
    await this.cdp.send('Runtime.enable', {}, sessionId).catch(() => undefined);
    const live = await this.cdp
      .send(
        'Runtime.evaluate',
        {
          expression: `window.__spootyAuth && window.__spootyAuth.isAnonymous === false && window.__spootyAuth.token && (window.__spootyAuth.expires || 0) > Date.now() + 60000 ? window.__spootyAuth : null`,
          returnByValue: true,
          awaitPromise: true,
        },
        sessionId,
      )
      .catch(() => null);
    const current = live?.result?.value;
    if (current?.token) {
      this.cached = {
        token: current.token,
        expires: current.expires || Date.now() + 50 * 60_000,
      };
      return this.cached.token;
    }

    await this.cdp.send('Page.enable', {}, sessionId).catch(() => undefined);
    await this.cdp.send(
      'Page.addScriptToEvaluateOnNewDocument',
      { source: HOOK },
      sessionId,
    );
    await this.cdp.send('Page.navigate', { url: TOKEN_URL }, sessionId);

    let auth: {
      token: string;
      expires?: number;
      isAnonymous?: boolean;
    } | null = null;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const ev = await this.cdp
        .send(
          'Runtime.evaluate',
          {
            expression: `window.__spootyAuth && window.__spootyAuth.token ? window.__spootyAuth : null`,
            returnByValue: true,
            awaitPromise: true,
          },
          sessionId,
        )
        .catch(() => null);
      const value = ev?.result?.value;
      if (value?.token && value.isAnonymous !== true) {
        auth = value;
        break;
      }
    }
    if (!auth?.token) {
      throw new Error(
        'Could not mint a logged-in Spotify token from Chrome. Start cdp-keepalive.mjs once and stay logged into Spotify.',
      );
    }
    this.cached = {
      token: auth.token,
      expires: auth.expires || Date.now() + 50 * 60_000,
    };
    this.logger.debug(
      `Minted Spotify web-player token (expires in ${Math.round((this.cached.expires - Date.now()) / 60000)}m)`,
    );
    return this.cached.token;
  }

  private artistNames(meta: any): string {
    const a = meta?.artist || meta?.artists || [];
    const list = Array.isArray(a) ? a : [a];
    return list
      .map((x) => x?.name)
      .filter(Boolean)
      .join(', ');
  }

  private coverUrl(meta: any): string | null {
    const images =
      meta?.album?.cover_group?.image || meta?.album?.cover?.image || [];
    const img = [...images].sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    const fileId = img?.file_id || img?.fileId;
    if (!fileId || typeof fileId !== 'string') return null;
    return `https://i.scdn.co/image/${fileId}`;
  }

  async getLibraryPlaylists(): Promise<SessionPlaylist[]> {
    const token = await this.getAccessToken();
    return collectSpotifyLibrary(async url => {
      const res = await this.sessionFetch(url, {
        headers: this.headers(token),
      });
      if (!res.ok) {
        throw new Error(`Spotify library request failed: ${res.status}`);
      }
      return res.json();
    });
  }

  private async hydrateOne(
    token: string,
    trackId: string,
  ): Promise<SessionTrack | null> {
    const gid = this.idToGid(trackId);
    const res = await this.sessionFetch(
      `https://spclient.wg.spotify.com/metadata/4/track/${gid}?market=from_token`,
      { headers: this.headers(token) },
    );
    if (!res.ok) return null;
    const meta = await res.json();
    const name = meta?.name;
    const artist = this.artistNames(meta);
    if (!name || !artist) return null;
    return {
      id: trackId,
      name,
      artist,
      coverUrl: this.coverUrl(meta),
      href: `https://open.spotify.com/track/${trackId}`,
      ...(Number.isInteger(meta.duration) && meta.duration > 0 ? { durationMs: meta.duration } : {}),
      ...(typeof meta.album?.name === 'string' ? { album: meta.album.name } : {}),
    };
  }

  /** Exact-ID duration lookup through the existing logged-in, rate-limited gate. */
  async getTrackDurationMetadata(trackId: string): Promise<SessionTrack & { durationMs: number }> {
    if (!/^[A-Za-z0-9]{22}$/.test(trackId)) throw new Error('Invalid Spotify track ID');
    const row = await this.hydrateOne(await this.getAccessToken(), trackId);
    if (!row || !Number.isInteger(row.durationMs) || row.durationMs! <= 0) {
      throw new Error('Spotify source duration is unavailable');
    }
    return row as SessionTrack & { durationMs: number };
  }

  private async mapPool<T, R>(
    items: T[],
    limit: number,
    fn: (item: T, i: number) => Promise<R>,
  ): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let i = 0;
    const worker = async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, () => worker()),
    );
    return out;
  }

  async getPlaylistTracks(
    playlistId: string,
    known?: Map<string, KnownTrack>,
  ): Promise<{
    name: string;
    length: number;
    truncated: boolean;
    tracks: SessionTrack[];
    membership?: SpotifyMembership;
  }> {
    const token = await this.getAccessToken();
    const collected = await collectPlaylistV2TrackIds(async (from) => {
      const urls =
        from > 0
          ? [
              `https://spclient.wg.spotify.com/playlist/v2/playlist/${playlistId}?from=${from}`,
              `https://spclient.wg.spotify.com/playlist/v2/playlist/${playlistId}?offset=${from}`,
              `https://spclient.wg.spotify.com/playlist/v2/playlist/${playlistId}/contents?offset=${from}&limit=100`,
            ]
          : [
              `https://spclient.wg.spotify.com/playlist/v2/playlist/${playlistId}`,
            ];
      let last: PlaylistV2Page | null = null;
      for (const url of urls) {
        const res = await this.sessionFetch(url, {
          headers: this.headers(token),
        });
        if (!res.ok) continue;
        last = (await res.json()) as PlaylistV2Page;
        const n = last.contents?.items?.length || 0;
        if (from === 0 || n > 0) return last;
      }
      if (!last) throw new Error('Spotify did not return a successful playlist response');
      return last;
    });
    const trackIds = collected.trackIds;
    const missing = [
      ...new Set(
        trackIds.filter((id) => {
          const prev = known?.get(id);
          return !(prev?.name && prev?.artist);
        }),
      ),
    ];
    const fresh = new Map<string, SessionTrack>();
    if (missing.length) {
      const hydrated = await this.mapPool(missing, META_CONC, (id) =>
        this.hydrateOne(token, id),
      );
      hydrated.forEach((t) => {
        if (t) fresh.set(t.id, t);
      });
    }
    const tracks: SessionTrack[] = [];
    trackIds.forEach((id, i) => {
      const hit = fresh.get(id);
      const prev = known?.get(id);
      const name = hit?.name || prev?.name;
      const artist = hit?.artist || prev?.artist;
      if (!name || !artist) return;
      tracks.push({
        id,
        name,
        artist,
        coverUrl: hit?.coverUrl || prev?.coverUrl || null,
        href: `https://open.spotify.com/track/${id}`,
        n: i + 1,
        ...(hit?.durationMs || prev?.durationMs ? { durationMs: hit?.durationMs || prev?.durationMs } : {}),
      });
    });
    this.logger.debug(
      `Session API ${playlistId}: ${tracks.length}/${collected.length || trackIds.length} tracks (hydrated ${missing.length})`,
    );
    return {
      name: collected.name || playlistId,
      length: collected.length || trackIds.length,
      truncated: collected.truncated || tracks.length < trackIds.length,
      tracks,
      ...(!collected.truncated && tracks.length === trackIds.length
        ? { membership: completeSpotifyMembership(playlistId, collected.length, trackIds) }
        : {}),
    };
  }
}
