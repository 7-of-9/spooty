#!/usr/bin/env node
/**
 * Open a public Spotify playlist in a throwaway Chrome and scroll the
 * tracklist virtualizer until the header song count is collected.
 * Prints { totalHint, count, tracks } JSON to stdout.
 *
 * Usage: node scripts/resync-playlist-page.mjs <playlistId>
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const PLAYLIST_ID = process.argv[2];
if (!PLAYLIST_ID) {
  process.stderr.write('usage: resync-playlist-page.mjs <playlistId>\n');
  process.exit(2);
}

const CHROME =
  process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.SPOOTY_RESYNC_PORT || 9333);
const USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'spooty-resync-'));

class Cdp {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
  }
  connect() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('cdp connect timeout')), 20000);
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
        if (msg.id != null && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
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
      const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), 30000);
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

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'evaluate failed');
  }
  return result.result?.value;
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForPort(port, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch {}
    await wait(200);
  }
  throw new Error(`Chrome debug port ${port} did not come up`);
}

const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${USER_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--window-size=1280,900',
    '--window-position=-2400,-2400',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let cdp;
try {
  await waitForPort(PORT, 15000);
  const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const wsUrl = version.webSocketDebuggerUrl;
  cdp = new Cdp(wsUrl);
  await cdp.connect();
  const { targetId } = await cdp.send('Target.createTarget', {
    url: `https://open.spotify.com/playlist/${PLAYLIST_ID}`,
    newWindow: false,
  });
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  await cdp.send('Runtime.enable', {}, sessionId).catch(() => {});
  await cdp.send('Page.enable', {}, sessionId).catch(() => {});

  const started = Date.now();
  let header = { totalHint: null };
  while (Date.now() - started < 25000) {
    header = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const total = document.body.innerText.match(/(\\d[\\d,]*)\\s+songs?/i);
        const rows = document.querySelectorAll('[data-testid="tracklist-row"]').length;
        return {
          title: document.title,
          totalHint: total ? Number(total[1].replace(/,/g, '')) : null,
          rows,
        };
      })()`,
    );
    if (header.rows > 0 && header.totalHint) break;
    await wait(400);
  }
  process.stderr.write(`header ${JSON.stringify(header)}\n`);

  const collected = await evaluate(
    cdp,
    sessionId,
    `(async () => {
      const scroller = [...document.querySelectorAll('*')].find((el) => {
        const s = getComputedStyle(el);
        return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 400;
      });
      if (!scroller) return { error: 'no scroller', tracks: [] };
      const parseRow = (row) => {
        const trackA = row.querySelector('a[href*="/track/"]');
        if (!trackA) return null;
        const id = (trackA.getAttribute('href') || '').split('/track/')[1]?.split('?')[0];
        const name = (trackA.textContent || '').trim();
        const artist = [...row.querySelectorAll('a[href*="/artist/"]')]
          .map((a) => a.textContent.trim())
          .filter(Boolean)
          .join(', ');
        const nEl = row.querySelector('[aria-colindex="1"] span');
        const n = nEl ? parseInt(nEl.textContent.trim(), 10) : null;
        if (!id || !name || !artist) return null;
        return { n, id, name, artist, href: 'https://open.spotify.com/track/' + id };
      };
      const byId = new Map();
      scroller.scrollTop = 0;
      await new Promise((r) => setTimeout(r, 300));
      let stagnant = 0;
      let lastTop = -1;
      for (let i = 0; i < 250; i++) {
        const before = byId.size;
        for (const row of document.querySelectorAll('[data-testid="tracklist-row"]')) {
          const t = parseRow(row);
          if (t) byId.set(t.id, t);
        }
        const top = scroller.scrollTop;
        if (byId.size === before && top === lastTop) stagnant++;
        else stagnant = 0;
        lastTop = top;
        const want = Number(document.body.innerText.match(/(\\d[\\d,]*)\\s+songs?/i)?.[1]?.replace(/,/g, '') || 0);
        if (want && byId.size >= want && stagnant >= 2) break;
        if (stagnant >= 25) break;
        const max = scroller.scrollHeight - scroller.clientHeight;
        const next = Math.min(max, scroller.scrollTop + Math.max(500, Math.floor(scroller.clientHeight * 0.92)));
        scroller.scrollTop = next <= scroller.scrollTop ? max : next;
        await new Promise((r) => setTimeout(r, 120));
      }
      const tracks = [...byId.values()].sort((a, b) => (a.n || 0) - (b.n || 0));
      return { count: tracks.length, tracks };
    })()`,
  );

  const tracks = collected?.tracks || [];
  const numbered = tracks.filter((t) => Number.isFinite(t.n) && t.n > 0);
  const byN = new Map();
  for (const t of numbered) if (!byN.has(t.n)) byN.set(t.n, t);
  const hint = header.totalHint || byN.size;
  const ordered = [];
  const maxN = Math.max(hint, ...byN.keys(), 0);
  for (let i = 1; i <= maxN; i++) {
    const t = byN.get(i);
    if (t) ordered.push(t);
  }
  process.stderr.write(`collected ${tracks.length} unique, numbered ${ordered.length}, hint ${hint}\n`);
  process.stdout.write(
    JSON.stringify({
      totalHint: hint,
      count: ordered.length,
      tracks: ordered,
    }),
  );
} finally {
  try {
    cdp?.close();
  } catch {}
  try {
    chrome.kill('SIGKILL');
  } catch {}
  try {
    fs.rmSync(USER_DIR, { recursive: true, force: true });
  } catch {}
}
