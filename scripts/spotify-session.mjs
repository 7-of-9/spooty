#!/usr/bin/env node
/**
 * Logged-in Spotify Web Player session → playlist APIs.
 *
 * Cookie replay from Node is blocked (WAF 403 / "Unauthorized request").
 * Mint a Bearer by hooking fetch in a background Chrome tab (CDP proxy),
 * then call spclient playlist/v2 + metadata/4. Never logs cookies/tokens.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PROXY = process.env.CDP_PROXY_URL || 'http://127.0.0.1:17331';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const TOKEN_URL = 'https://open.spotify.com/?spooty-token=1';
const B62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const META_CONC = Math.max(1, Number(process.env.SPOTIFY_META_CONC || 2));
const META_GAP_MS = Math.max(0, Number(process.env.SPOTIFY_META_GAP_MS || 250));
const MAX_RETRY_AFTER_MS = 60_000;

class RequestGate {
  constructor(conc, gapMs) {
    this.conc = conc;
    this.gapMs = gapMs;
    this.active = 0;
    this.queue = [];
    this.nextAt = 0;
    this.pauseUntil = 0;
    this.timer = null;
  }
  pause(ms) {
    this.pauseUntil = Math.max(this.pauseUntil, Date.now() + ms);
    this.kick();
  }
  run(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push(() => {
        this.active++;
        this.nextAt = Date.now() + this.gapMs;
        fn().then(resolve, reject).finally(() => {
          this.active--;
          this.kick();
        });
      });
      this.kick();
    });
  }
  kick() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.active >= this.conc || !this.queue.length) return;
    const wait = Math.max(0, this.nextAt - Date.now(), this.pauseUntil - Date.now());
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

const gate = new RequestGate(META_CONC, META_GAP_MS);

async function sessionFetch(url, init) {
  let last = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await gate.run(() => fetch(url, init));
    last = res;
    if (res.status !== 429 && res.status < 500) return res;
    const raw = Number(res.headers.get('retry-after') || 2 * (attempt + 1));
    const waitMs = Math.min(
      Number.isFinite(raw) ? raw * 1000 : 2000 * (attempt + 1),
      MAX_RETRY_AFTER_MS,
    );
    gate.pause(waitMs);
  }
  return last;
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

let cached = { token: null, expires: 0 };
let tokenRequest = null;

async function cdp(method, params = {}, sessionId, timeoutMs = 20000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(PROXY + '/cdp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, params, sessionId }),
      signal: ac.signal,
    });
    const msg = await res.json();
    if (!res.ok) throw new Error(msg?.error || `CDP ${method} failed`);
    if (msg.error) throw new Error(JSON.stringify(msg.error));
    return msg.result ?? msg;
  } finally {
    clearTimeout(t);
  }
}

async function evaluate(sessionId, expression, timeoutMs = 15000) {
  const ev = await cdp(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
    timeoutMs,
  );
  if (ev.exceptionDetails) {
    throw new Error(ev.exceptionDetails.text || 'evaluate failed');
  }
  return ev.result?.value;
}

function idToGid(id) {
  let n = 0n;
  for (const c of id) {
    const i = B62.indexOf(c);
    if (i < 0) throw new Error('bad spotify id');
    n = n * 62n + BigInt(i);
  }
  return n.toString(16).padStart(32, '0');
}

function sessionHeaders(token) {
  return {
    Authorization: 'Bearer ' + token,
    'User-Agent': UA,
    accept: 'application/json',
    origin: 'https://open.spotify.com',
    referer: 'https://open.spotify.com/',
  };
}

async function findTokenTab() {
  const res = await fetch(PROXY + '/targets', { signal: AbortSignal.timeout(20000) });
  const body = await res.json();
  return (body.pages || []).find((p) => /spooty-token=1/.test(p.url || ''));
}

async function attach(targetId) {
  const att = await cdp('Target.attachToTarget', { targetId, flatten: true });
  const sessionId = att.sessionId;
  await cdp('Runtime.enable', {}, sessionId).catch(() => undefined);
  await cdp('Page.enable', {}, sessionId).catch(() => undefined);
  return sessionId;
}

export async function getAccessToken() {
  if (!tokenRequest) tokenRequest = mintAccessToken().finally(() => { tokenRequest = null; });
  return tokenRequest;
}

async function mintAccessToken() {
  if (cached.token && Date.now() < cached.expires - 60_000) return cached.token;

  let tab = await findTokenTab();
  let sessionId;
  let targetId;
  if (tab) {
    targetId = tab.targetId;
    sessionId = await attach(targetId);
    const existing = await evaluate(
      sessionId,
      `window.__spootyAuth && window.__spootyAuth.isAnonymous === false && window.__spootyAuth.token && (window.__spootyAuth.expires || 0) > Date.now() + 60000
        ? window.__spootyAuth
        : null`,
      8000,
    ).catch(() => null);
    if (existing?.token) {
      cached = { token: existing.token, expires: existing.expires || Date.now() + 50 * 60_000 };
      return cached.token;
    }
  } else {
    // Reuse the bridge-owned background tab; never open a new CDP connection.
    const response = await fetch(PROXY + '/tab', { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('Spotify background tab unavailable');
    const created = await response.json();
    targetId = created.targetId;
    sessionId = created.sessionId || await attach(targetId);
  }

  await cdp(
    'Page.addScriptToEvaluateOnNewDocument',
    { source: HOOK },
    sessionId,
  );
  await cdp('Page.navigate', { url: TOKEN_URL }, sessionId);

  let auth = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    auth = await evaluate(
      sessionId,
      `window.__spootyAuth && window.__spootyAuth.token ? window.__spootyAuth : null`,
      8000,
    ).catch(() => null);
    if (auth?.token && auth.isAnonymous !== true) break;
    auth = null;
  }
  if (!auth?.token || auth.isAnonymous === true) {
    throw new Error(
      'Could not mint a logged-in Spotify token from Chrome. Is Spotify open and logged in on this profile?',
    );
  }
  cached = {
    token: auth.token,
    expires: auth.expires || Date.now() + 50 * 60_000,
  };
  return cached.token;
}

function artistNames(meta) {
  const a = meta?.artist || meta?.artists || [];
  const list = Array.isArray(a) ? a : [a];
  return list
    .map((x) => x?.name)
    .filter(Boolean)
    .join(', ');
}

function coverUrl(meta) {
  const images = meta?.album?.cover_group?.image || meta?.album?.cover?.image || [];
  const img = [...images].sort((a, b) => (b.width || 0) - (a.width || 0))[0];
  const fileId = img?.file_id || img?.fileId;
  if (!fileId) return null;
  const hex = typeof fileId === 'string' && /^[0-9a-f]+$/i.test(fileId)
    ? fileId
    : Buffer.from(fileId, 'base64').toString('hex');
  return hex ? `https://i.scdn.co/image/${hex}` : null;
}

async function hydrateOne(token, trackId) {
  const gid = idToGid(trackId);
  const res = await sessionFetch(
    `https://spclient.wg.spotify.com/metadata/4/track/${gid}?market=from_token`,
    { headers: sessionHeaders(token), signal: AbortSignal.timeout(30000) },
  );
  if (!res.ok) return null;
  const meta = await res.json();
  const name = meta?.name;
  const artist = artistNames(meta);
  if (!name || !artist) return null;
  return {
    id: trackId,
    name,
    artist,
    durationMs: Number.isInteger(meta.duration) && meta.duration > 0 ? meta.duration : undefined,
    album: typeof meta.album?.name === 'string' ? meta.album.name : undefined,
    coverUrl: coverUrl(meta),
    href: `https://open.spotify.com/track/${trackId}`,
  };
}

// Public metadata only. Reuses the logged-in session request gate and never
// exposes credentials or raw response bodies to callers/logs.
export async function getTrackDurationMetadata(trackId) {
  if (!/^[A-Za-z0-9]{22}$/.test(trackId || '')) throw new Error('Invalid Spotify track ID');
  const track = await hydrateOne(await getAccessToken(), trackId);
  if (!track?.durationMs) throw new Error('Spotify source duration unavailable');
  return { version: 1, spotifyId: trackId, name: track.name, artist: track.artist,
    durationMs: track.durationMs, album: track.album, fetchedAt: new Date().toISOString() };
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function getPlaylistTracks(playlistId, known) {
  const token = await getAccessToken();
  const seen = new Set();
  const trackIds = [];
  let length = 0;
  let plName = playlistId;
  let from = 0;
  for (let pageNo = 0; pageNo < 80; pageNo++) {
    const url =
      from > 0
        ? `https://spclient.wg.spotify.com/playlist/v2/playlist/${playlistId}?from=${from}`
        : `https://spclient.wg.spotify.com/playlist/v2/playlist/${playlistId}`;
    const res = await sessionFetch(url, { headers: sessionHeaders(token) });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`spclient playlist ${res.status} ${text.slice(0, 120)}`);
    }
    const data = await res.json();
    if (typeof data.length === 'number') length = data.length;
    if (data?.attributes?.name) plName = data.attributes.name;
    const items = data?.contents?.items || [];
    const before = trackIds.length;
    for (const it of items) {
      const uri = it?.uri || '';
      if (!uri.startsWith('spotify:track:')) continue;
      const id = uri.slice('spotify:track:'.length);
      if (seen.has(id)) continue;
      seen.add(id);
      trackIds.push(id);
    }
    const truncated = !!data?.contents?.truncated;
    if (length > 0 && trackIds.length >= length) break;
    if (!truncated && !(length > 0 && trackIds.length < length)) break;
    if (trackIds.length === before) break;
    from = trackIds.length;
  }
  if (length > 0 && trackIds.length < length) {
    throw new Error(
      `session playlist ${playlistId} short ${trackIds.length}/${length}`,
    );
  }
  const missing = trackIds.filter((id) => {
    const prev = known?.get(id);
    return !(prev?.name && prev?.artist);
  });
  const fresh = new Map();
  if (missing.length) {
    const hydrated = await mapPool(missing, META_CONC, (id) => hydrateOne(token, id));
    hydrated.forEach((t) => {
      if (t) fresh.set(t.id, t);
    });
  }
  const tracks = [];
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
      durationMs: hit?.durationMs || prev?.durationMs || prev?.duration_ms || undefined,
      coverUrl: hit?.coverUrl || prev?.coverUrl || null,
      href: `https://open.spotify.com/track/${id}`,
      n: i + 1,
    });
  });
  return {
    id: playlistId,
    name: plName,
    owner: null,
    length: length || trackIds.length,
    truncated: !!(length && tracks.length < length),
    hydrated: missing.length,
    tracks,
  };
}

function dumpDir() {
  return (
    process.env.STATIC_PLAYLISTS_PATH ||
    join(process.cwd(), 'PLAYLISTS_2026-09-08/playlists')
  );
}

function playlistIdFromFile(raw, file) {
  if (raw?.id) return raw.id;
  if (raw?.uri?.startsWith('spotify:playlist:')) return raw.uri.split(':')[2];
  const m = String(file).match(/([A-Za-z0-9]{22})/);
  return m ? m[1] : null;
}

export async function resyncDump(playlistId) {
  const dir = dumpDir();
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const full = join(dir, file);
    let raw;
    try {
      raw = JSON.parse(readFileSync(full, 'utf8'));
    } catch {
      continue;
    }
    const pid = playlistIdFromFile(raw, file);
    if (pid !== playlistId) continue;
    const known = new Map(
      (raw.tracks || [])
        .filter((t) => t?.id && t?.name && t?.artist)
        .map((t) => [t.id, t]),
    );
    const live = await getPlaylistTracks(pid, known);
    const byId = new Map(
      (raw.tracks || []).filter((t) => t?.id).map((t) => [t.id, t]),
    );
    const tracks = live.tracks.map((t, i) => {
      const prev = byId.get(t.id) || {};
      return {
        n: i + 1,
        id: t.id,
        name: t.name || prev.name,
        artist: t.artist || prev.artist,
        durationMs: t.durationMs || prev.durationMs || prev.duration_ms || undefined,
        href: t.href || prev.href || `https://open.spotify.com/track/${t.id}`,
        coverUrl: t.coverUrl || prev.coverUrl || undefined,
      };
    });
    const next = {
      ...raw,
      name: live.name || raw.name,
      id: pid,
      uri: `spotify:playlist:${pid}`,
      trackCount: tracks.length,
      tracks,
      syncedAt: new Date().toISOString(),
    };
    writeFileSync(full, JSON.stringify(next, null, 2));
    return {
      file,
      name: next.name,
      before: (raw.tracks || []).length,
      after: tracks.length,
      truncated: live.truncated,
    };
  }
  throw new Error(`dump not found for ${playlistId}`);
}

const cmd = process.argv[2];
const arg = process.argv[3];
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('spotify-session.mjs')) {
  if (cmd === 'playlist' && arg) {
    const pl = await getPlaylistTracks(arg);
    const missing = pl.length - pl.tracks.length;
    console.log(
      JSON.stringify(
        {
          id: pl.id,
          name: pl.name,
          owner: pl.owner,
          length: pl.length,
          hydrated: pl.hydrated,
          missing,
          truncated: pl.truncated,
          sample: pl.tracks.slice(0, 2).map((t) => ({ n: t.n, name: t.name, artist: t.artist })),
        },
        null,
        2,
      ),
    );
  } else if (cmd === 'resync' && arg) {
    console.log(JSON.stringify(await resyncDump(arg), null, 2));
  } else if (cmd === 'token-check') {
    const t = await getAccessToken();
    console.log(JSON.stringify({ ok: true, tokenLen: t.length, expiresInMin: Math.round((cached.expires - Date.now()) / 60000) }));
  } else {
    console.error('usage: spotify-session.mjs playlist <id> | resync <id> | token-check');
    process.exit(2);
  }
}
