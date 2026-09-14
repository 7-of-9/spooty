#!/usr/bin/env node
/**
 * Attach to the already-running main Chrome (remote-debugging port from
 * DevToolsActivePort) and pull Spotify access + YouTube cookies.
 * Does not launch a new browser.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT_FILE =
  process.env.HOME +
  '/Library/Application Support/Google/Chrome/DevToolsActivePort';
const PLAYLIST_URL =
  process.env.SPOTIFY_PLAYLIST_URL ||
  'https://open.spotify.com/playlist/17FjOthbHvvqRlL9FbBrtP';
const OUT_COOKIES = path.join(ROOT, 'cookies.txt');
const OUT_TOKEN = path.join(ROOT, '.spotify_token');
const OUT_META = path.join(ROOT, '.spotify_session.json');

function readEndpoint() {
  const raw = fs.readFileSync(PORT_FILE, 'utf8');
  const [port, pth] = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!port || !pth) throw new Error('Invalid DevToolsActivePort');
  return `ws://127.0.0.1:${port}${pth}`;
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.sessions = new Map();
    this.eventHandlers = [];
  }
  connect() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('WebSocket connect timeout — click Allow in Chrome if prompted')),
        25000,
      );
      this.ws = new WebSocket(this.url, { perMessageDeflate: false });
      this.ws.on('open', () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.method) {
          for (const h of this.eventHandlers) h(msg);
        }
        const id = msg.id;
        if (id != null && this.pending.has(id)) {
          const { resolve: res, reject: rej } = this.pending.get(id);
          this.pending.delete(id);
          if (msg.error) rej(new Error(JSON.stringify(msg.error)));
          else res(msg.result);
        }
      });
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`CDP timeout: ${method}`)),
        20000,
      );
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify(payload));
    });
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

function netscapeCookies(cookies) {
  const lines = [
    '# Netscape HTTP Cookie File',
    '# Generated from main Chrome session. Do not commit.',
  ];
  for (const c of cookies) {
    const domain = c.domain || '';
    const includeSub = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const cookiePath = c.path || '/';
    const secure = c.secure ? 'TRUE' : 'FALSE';
    const expiry =
      c.expires && c.expires > 0 ? Math.floor(c.expires) : 0;
    const name = c.name || '';
    const value = c.value || '';
    if (!name) continue;
    lines.push(
      [domain, includeSub, cookiePath, secure, expiry, name, value].join('\t'),
    );
  }
  return lines.join('\n') + '\n';
}

async function attachPage(cdp, targetId) {
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  return sessionId;
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send(
    'Runtime.evaluate',
    {
      expression,
      returnByValue: true,
      awaitPromise: true,
    },
    sessionId,
  );
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.text || 'Runtime.evaluate failed',
    );
  }
  return result.result?.value;
}

async function waitFor(fn, { timeout = 20000, interval = 400 } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  return last;
}

async function main() {
  const endpoint = readEndpoint();
  process.stderr.write(`Connecting to ${endpoint}\n`);
  process.stderr.write(
    'If Chrome shows a remote-debugging Allow dialog, click Allow.\n',
  );
  const cdp = new Cdp(endpoint);
  await cdp.connect();
  process.stderr.write('Connected to main Chrome.\n');

  const ver = await cdp.send('Browser.getVersion');
  process.stderr.write(`Browser: ${ver.product} ${ver.userAgent?.slice(0, 80)}\n`);

  const { targetInfos } = await cdp.send('Target.getTargets');
  const pages = targetInfos.filter(
    (t) => t.type === 'page' && !t.url.startsWith('devtools://'),
  );
  process.stderr.write(`Open pages: ${pages.length}\n`);
  for (const p of pages) {
    process.stderr.write(`  - ${(p.title || '').slice(0, 60)} | ${p.url.slice(0, 100)}\n`);
  }

  let spotifyTarget =
    pages.find((p) =>
      /open\.spotify\.com\/playlist\/17FjOthbHvvqRlL9FbBrtP/i.test(p.url),
    ) ||
    pages.find((p) =>
      /open\.spotify\.com\/(playlist|track|album|user|search|collection)/i.test(
        p.url,
      ),
    );
  let sessionId;
  let createdTarget = false;

  if (spotifyTarget) {
    process.stderr.write('Using existing Spotify tab.\n');
    sessionId = await attachPage(cdp, spotifyTarget.targetId);
  } else {
    process.stderr.write('Opening playlist in a new tab (background).\n');
    const created = await cdp.send('Target.createTarget', {
      url: PLAYLIST_URL,
      newWindow: false,
    });
    createdTarget = true;
    sessionId = await attachPage(cdp, created.targetId);
    await waitFor(async () => {
      const url = await evaluate(cdp, sessionId, 'location.href').catch(
        () => '',
      );
      return url && url.includes('spotify.com');
    });
  }

  await cdp.send('Page.enable', {}, sessionId).catch(() => {});
  await cdp.send('Runtime.enable', {}, sessionId).catch(() => {});
  await cdp.send('Network.enable', {}, sessionId).catch(() => {});

  const currentUrl = await evaluate(cdp, sessionId, 'location.href').catch(
    () => '',
  );
  process.stderr.write(`Spotify tab url: ${currentUrl}\n`);

  if (!/open\.spotify\.com\/playlist\/17FjOthbHvvqRlL9FbBrtP/.test(currentUrl)) {
    process.stderr.write('Navigating existing tab to private 2024 playlist.\n');
    await cdp.send(
      'Page.navigate',
      { url: PLAYLIST_URL },
      sessionId,
    );
    await waitFor(async () => {
      const url = await evaluate(cdp, sessionId, 'location.href').catch(
        () => '',
      );
      return url && url.includes('17FjOthbHvvqRlL9FbBrtP');
    }, { timeout: 25000 });
  }

  const captured = { token: null, url: null };
  const onEvent = (msg) => {
    if (msg.sessionId && msg.sessionId !== sessionId) return;
    if (
      msg.method !== 'Network.requestWillBeSent' &&
      msg.method !== 'Network.requestWillBeSentExtraInfo'
    ) {
      return;
    }
    const headers =
      msg.params?.request?.headers || msg.params?.headers || {};
    const auth =
      headers.Authorization ||
      headers.authorization ||
      headers['Authorization'] ||
      headers['authorization'];
    const url = msg.params?.request?.url || captured.url || '';
    if (auth && /^Bearer\s+\S+/i.test(String(auth))) {
      captured.token = String(auth).replace(/^Bearer\s+/i, '');
      captured.url = url;
    }
  };
  cdp.eventHandlers.push(onEvent);

  process.stderr.write('Reloading playlist tab to capture Authorization header.\n');
  await cdp.send('Page.reload', { ignoreCache: false }, sessionId).catch(() => {});
  await waitFor(() => captured.token, { timeout: 20000, interval: 250 });

  let tokenInfo = captured.token
    ? {
        method: 'network-bearer',
        token: captured.token,
        fromUrl: captured.url,
      }
    : {};

  if (!tokenInfo.token) {
    try {
      tokenInfo = {
        ...tokenInfo,
        ...(await evaluate(
          cdp,
          sessionId,
          ` (async () => {
        const out = { method: null, token: null, expires: null, lsKeys: [], fetchStatus: null, fetchSnippet: null };
        try {
          const r = await fetch('https://open.spotify.com/api/token', { method: 'POST', credentials: 'include' });
          out.fetchStatus = r.status;
          const text = await r.text();
          out.fetchSnippet = text.slice(0, 180);
          try {
            const j = JSON.parse(text);
            const t = j.accessToken || j.access_token;
            if (t) { out.method = 'api/token'; out.token = t; out.expires = j.accessTokenExpirationTimestampMs || null; }
          } catch {}
        } catch (e) { out.fetchError = String(e); }
        try {
          out.lsKeys = Object.keys(localStorage).slice(0, 40);
          out.ssKeys = Object.keys(sessionStorage).slice(0, 40);
          for (const store of [localStorage, sessionStorage]) {
            for (const k of Object.keys(store)) {
              const v = store.getItem(k) || '';
              const m = v.match(/"accessToken"\\s*:\\s*"([^"]+)"/) || v.match(/"access_token"\\s*:\\s*"([^"]+)"/);
              if (m) { out.method = 'storage:' + k; out.token = m[1]; break; }
            }
            if (out.token) break;
          }
        } catch (e) { out.storageError = String(e); }
        try {
          out.title = document.title;
          out.href = location.href;
          out.hasLoginButton = !!document.body.innerText.match(/Log in|Sign up/i);
        } catch {}
        return out;
      })()
    `,
        )),
      };
    } catch (e) {
      process.stderr.write(`Token evaluate failed: ${e}\n`);
      tokenInfo.evalError = String(e);
    }
  } else {
    tokenInfo.title = await evaluate(cdp, sessionId, 'document.title').catch(
      () => '',
    );
    tokenInfo.href = await evaluate(cdp, sessionId, 'location.href').catch(
      () => '',
    );
  }

  if (!tokenInfo?.token) {
    process.stderr.write(
      `Token extract result: ${JSON.stringify({
        method: tokenInfo?.method,
        isAnonymous: tokenInfo?.isAnonymous,
        title: tokenInfo?.title,
        href: tokenInfo?.href,
        fetchError: tokenInfo?.fetchError,
        hasLoginButton: tokenInfo?.hasLoginButton,
        evalError: tokenInfo?.evalError,
        hasToken: !!tokenInfo?.token,
      })}\n`,
    );
    throw new Error(
      'Could not extract Spotify access token from main Chrome. Are you logged into Spotify in this profile?',
    );
  }
  process.stderr.write(
    `Spotify token via ${tokenInfo.method}; anonymous=${tokenInfo.isAnonymous}; title=${tokenInfo.title}\n`,
  );

  fs.writeFileSync(OUT_TOKEN, tokenInfo.token, { mode: 0o600 });
  fs.writeFileSync(
    OUT_META,
    JSON.stringify(
      {
        method: tokenInfo.method,
        expires: tokenInfo.expires,
        isAnonymous: tokenInfo.isAnonymous,
        title: tokenInfo.title,
        href: tokenInfo.href,
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  // Verify playlist is readable with this token (do not print track names to keep logs short)
  const playlistCheck = await evaluate(
    cdp,
    sessionId,
    ` (async () => {
        const token = ${JSON.stringify(tokenInfo.token)};
        const id = '17FjOthbHvvqRlL9FbBrtP';
        const r = await fetch('https://api.spotify.com/v1/playlists/' + id + '?fields=name,owner.display_name,tracks.total,public,collaborative', {
          headers: { Authorization: 'Bearer ' + token }
        });
        const text = await r.text();
        let json = null;
        try { json = JSON.parse(text); } catch {}
        return { status: r.status, body: json || text.slice(0, 300) };
      })()
    `,
  );
  process.stderr.write(
    `Playlist API status ${playlistCheck.status}: ${JSON.stringify(playlistCheck.body).slice(0, 240)}\n`,
  );
  fs.writeFileSync(
    path.join(ROOT, '.spotify_playlist_meta.json'),
    JSON.stringify(playlistCheck, null, 2),
  );

  // Cookies from this browser (HttpOnly included)
  let cookies = [];
  try {
    const all = await cdp.send('Storage.getCookies', {});
    cookies = all.cookies || [];
  } catch {
    const all = await cdp.send('Network.getAllCookies', {}, sessionId);
    cookies = all.cookies || [];
  }

  const ytCookies = cookies.filter((c) =>
    /(^|\.)youtube\.com$|(^|\.)google\.com$|(^|\.)youtube-nocookie\.com$|(^|\.)googlevideo\.com$/i.test(
      c.domain.replace(/^\./, '') ? c.domain : c.domain,
    ) ||
    /youtube\.com|google\.com|youtu\.be|googlevideo\.com/.test(c.domain),
  );
  const spotifyCookies = cookies.filter((c) => /spotify/i.test(c.domain));
  process.stderr.write(
    `Cookies: total=${cookies.length} youtube/google=${ytCookies.length} spotify=${spotifyCookies.length}\n`,
  );

  // yt-dlp wants youtube + google cookies. Write the youtube-related set,
  // plus a full dump next to it for debugging if needed.
  const dump = ytCookies.length ? ytCookies : cookies;
  fs.writeFileSync(OUT_COOKIES, netscapeCookies(dump), { mode: 0o600 });
  process.stderr.write(`Wrote ${dump.length} cookies to cookies.txt\n`);

  if (createdTarget) {
    // leave the tab; user asked to use main session, a playlist tab is useful
  }

  cdp.close();
  process.stderr.write('Done.\n');
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + '\n');
  process.exit(1);
});
