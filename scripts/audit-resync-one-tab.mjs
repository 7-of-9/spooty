#!/usr/bin/env node
/**
 * Reuse ONE Chrome tab (never a tab per playlist).
 * Pass 1: visit each dump playlist URL and read the Spotify "N songs" header.
 * Pass 2: for mismatches, stay in that same tab and scroll-collect tracks.
 *
 * Connects to the user's already-running Chrome via DevToolsActivePort.
 * Does not call Target.activateTarget (no focus steal).
 *
 * Usage:
 *   node scripts/audit-resync-one-tab.mjs
 *   node scripts/audit-resync-one-tab.mjs --counts-only
 *   node scripts/audit-resync-one-tab.mjs --resync-mismatches
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DUMP_DIR = path.join(ROOT, 'PLAYLISTS_2026-09-08/playlists');
const PROGRESS = path.join(ROOT, 'tmp-audit-resync-progress.json');
const PORT_FILE =
  process.env.HOME +
  '/Library/Application Support/Google/Chrome/DevToolsActivePort';

const COUNTS_ONLY = process.argv.includes('--counts-only');
const RESYNC = process.argv.includes('--resync-mismatches') || !COUNTS_ONLY;
const PROXY = process.env.CDP_PROXY_URL || 'http://127.0.0.1:17331';

function isExcludedName(name) {
  const n = (name || '').trim();
  if (/^daily mix(es)?\b/i.test(n)) return true;
  if (/^dj$/i.test(n)) return true;
  if (/^discover weekly$/i.test(n)) return true;
  if (/^release radar$/i.test(n)) return true;
  if (/^on repeat$/i.test(n)) return true;
  if (/^repeat rewind$/i.test(n)) return true;
  if (/^(your )?daily drive$/i.test(n)) return true;
  return false;
}

async function proxySend(method, params = {}, sessionId) {
  const res = await fetch(`${PROXY}/cdp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, params, sessionId }),
  });
  const msg = await res.json();
  if (!res.ok) throw new Error(msg?.error || `${method} failed`);
  if (msg.error && msg.error.message) throw new Error(msg.error.message);
  return msg.result ?? msg;
}

async function proxyEval(targetId, expression) {
  const res = await fetch(`${PROXY}/eval`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ targetId, expression }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || 'eval failed');
  return body.value;
}

async function proxyTab() {
  const res = await fetch(`${PROXY}/tab`);
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error || '/tab failed');
  return body;
}

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
      const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), 35000);
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

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function evaluate(sessionId, expression) {
  const result = await proxySend(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (result?.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'evaluate failed');
  }
  return result?.result?.value;
}

function loadDumpPlaylists() {
  const files = fs.readdirSync(DUMP_DIR).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const file of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(DUMP_DIR, file), 'utf8'));
    } catch {
      continue;
    }
    const name = raw.name || '';
    if (raw.skipped || isExcludedName(name)) continue;
    const id = raw.id || (raw.uri || '').split(':').pop();
    if (!id) continue;
    out.push({
      file,
      id,
      name,
      dumped: Array.isArray(raw.tracks) ? raw.tracks.length : 0,
      rank: raw.rank || 9999,
    });
  }
  out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  return out;
}

function loadProgress() {
  if (!fs.existsSync(PROGRESS)) {
    return { counts: {}, resynced: {}, startedAt: new Date().toISOString() };
  }
  try {
    return JSON.parse(fs.readFileSync(PROGRESS, 'utf8'));
  } catch {
    return { counts: {}, resynced: {}, startedAt: new Date().toISOString() };
  }
}

function saveProgress(p) {
  p.updatedAt = new Date().toISOString();
  fs.writeFileSync(PROGRESS, JSON.stringify(p, null, 2));
}

async function ensureOneTab() {
  const tab = await proxyTab();
  await proxySend('Page.enable', {}, tab.sessionId).catch(() => {});
  process.stderr.write(`using one tab ${tab.targetId} created=${!!tab.created}\n`);
  return tab;
}

async function gotoPlaylist(sessionId, id) {
  const url = `https://open.spotify.com/playlist/${id}?spooty-resync=1`;
  await proxySend('Page.navigate', { url }, sessionId);
  const start = Date.now();
  let last = null;
  while (Date.now() - start < 18000) {
    await wait(400);
    last = await evaluate(
      sessionId,
      `(() => {
        const pathId = (location.pathname.split('/playlist/')[1] || '').split('?')[0];
        const h1 =
          document.querySelector('[data-testid="entityTitle"]') ||
          document.querySelector('main h1') ||
          [...document.querySelectorAll('h1')].at(-1);
        const root = h1?.closest('section, [data-testid="playlist-page"], main') || h1?.parentElement;
        const text = (root && root.innerText) || '';
        const m = text.match(/([\\d,]+)\\s+songs?/i);
        const live = m ? Number(m[1].replace(/,/g, '')) : null;
        const blocked = /log in to spotify|sign up to/i.test(document.body.innerText.slice(0, 1200));
        return { pathId, h1: h1?.innerText || '', live, blocked, title: document.title };
      })()`,
    );
    if (last?.blocked) return last;
    if (last?.pathId === id && last.live != null) return last;
  }
  return last || { pathId: id, live: null, blocked: false, error: 'timeout' };
}

async function scrapeTracks(sessionId) {
  return evaluate(
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
      await new Promise((r) => setTimeout(r, 250));
      let stagnant = 0;
      let lastTop = -1;
      for (let i = 0; i < 260; i++) {
        const before = byId.size;
        for (const row of document.querySelectorAll('[data-testid="tracklist-row"]')) {
          const t = parseRow(row);
          if (t) byId.set(t.id, t);
        }
        const top = scroller.scrollTop;
        const want = Number(document.body.innerText.match(/([\\d,]+)\\s+songs?/i)?.[1]?.replace(/,/g, '') || 0);
        const numbered = [...byId.values()].filter((t) => t.n > 0).length;
        if (want && numbered >= want && stagnant >= 2) break;
        if (byId.size === before && top === lastTop) stagnant++;
        else stagnant = 0;
        lastTop = top;
        if (stagnant >= 22) break;
        const max = scroller.scrollHeight - scroller.clientHeight;
        const next = Math.min(max, scroller.scrollTop + Math.max(520, Math.floor(scroller.clientHeight * 0.9)));
        scroller.scrollTop = next <= scroller.scrollTop ? max : next;
        await new Promise((r) => setTimeout(r, 110));
      }
      const tracks = [...byId.values()].sort((a, b) => (a.n || 0) - (b.n || 0));
      const hint = Number(document.body.innerText.match(/([\\d,]+)\\s+songs?/i)?.[1]?.replace(/,/g, '') || 0);
      return { hint, count: tracks.length, tracks };
    })()`,
  );
}

function writeDump(file, scraped, hint) {
  const full = path.join(DUMP_DIR, file);
  const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
  const byN = new Map();
  for (const t of scraped.tracks || []) {
    if (Number.isFinite(t.n) && t.n > 0 && t.name && t.artist) byN.set(t.n, t);
  }
  const maxN = Math.max(hint || 0, ...byN.keys(), 0);
  const tracks = [];
  for (let i = 1; i <= maxN; i++) {
    const t = byN.get(i);
    if (!t) continue;
    tracks.push({
      n: i,
      name: t.name,
      artist: t.artist,
      href: t.href,
      id: t.id,
    });
  }
  if (!tracks.length) return { wrote: 0 };
  raw.tracks = tracks;
  raw.trackCount = tracks.length;
  raw.syncedAt = new Date().toISOString();
  raw.syncSource = 'spotify-playlist-page-scroll';
  fs.writeFileSync(full, JSON.stringify(raw, null, 2) + '\n');
  return { wrote: tracks.length, hint };
}

async function main() {
  const playlists = loadDumpPlaylists();
  const progress = loadProgress();
  progress.total = playlists.length;
  const health = await fetch(`${PROXY}/health`).then((r) => r.json()).catch(() => null);
  if (!health?.connected) {
    throw new Error(
      'CDP proxy is down. Start: node scripts/cdp-keepalive.mjs  (click Allow in Chrome ONCE)',
    );
  }
  process.stderr.write(`CDP proxy ok, ${playlists.length} playlists, one tab\n`);
  const { sessionId } = await ensureOneTab();

  let i = 0;
  for (const p of playlists) {
    i++;
    if (progress.counts[p.id]?.live != null && !process.argv.includes('--recount')) {
      continue;
    }
    try {
      const info = await gotoPlaylist(sessionId, p.id);
      const row = {
        id: p.id,
        name: p.name,
        file: p.file,
        dumped: p.dumped,
        live: info?.live ?? null,
        blocked: !!info?.blocked,
        h1: info?.h1 || '',
        checkedAt: new Date().toISOString(),
      };
      progress.counts[p.id] = row;
      const mark =
        row.live == null
          ? 'NOCOUNT'
          : row.live > p.dumped + 1
            ? `SHORT dump=${p.dumped} live=${row.live}`
            : row.live < p.dumped - 1
              ? `DUMPAHEAD dump=${p.dumped} live=${row.live}`
              : `OK ${row.live}`;
      process.stderr.write(`[${i}/${playlists.length}] ${p.name}: ${mark}\n`);
    } catch (err) {
      progress.counts[p.id] = {
        id: p.id,
        name: p.name,
        file: p.file,
        dumped: p.dumped,
        live: null,
        error: String(err.message || err),
        checkedAt: new Date().toISOString(),
      };
      process.stderr.write(`[${i}/${playlists.length}] ${p.name}: ERR ${err.message}\n`);
    }
    if (i % 5 === 0) saveProgress(progress);
    await wait(250);
  }
  saveProgress(progress);

  const mismatches = Object.values(progress.counts).filter(
    (r) => r.live != null && r.live > r.dumped + 1,
  );
  process.stderr.write(
    `counts done. mismatches live>dump: ${mismatches.length}\n`,
  );

  if (!RESYNC) {
    return;
  }

  let n = 0;
  for (const r of mismatches.sort((a, b) => (b.live - b.dumped) - (a.live - a.dumped))) {
    n++;
    if (progress.resynced[r.id]?.wrote >= r.live - 1) continue;
    process.stderr.write(
      `resync ${n}/${mismatches.length} ${r.name} dump=${r.dumped} live=${r.live}\n`,
    );
    try {
      await gotoPlaylist(sessionId, r.id);
      const scraped = await scrapeTracks(sessionId);
      const result = writeDump(r.file, scraped, r.live);
      progress.resynced[r.id] = {
        ...r,
        wrote: result.wrote,
        hint: result.hint || scraped?.hint,
        at: new Date().toISOString(),
      };
      process.stderr.write(
        `  wrote ${result.wrote} (hint ${scraped?.hint || r.live})\n`,
      );
    } catch (err) {
      progress.resynced[r.id] = {
        ...r,
        error: String(err.message || err),
        at: new Date().toISOString(),
      };
      process.stderr.write(`  FAIL ${err.message}\n`);
    }
    saveProgress(progress);
  }
  saveProgress(progress);
  process.stderr.write('done\n');
}

main().catch((err) => {
  process.stderr.write(String(err.stack || err) + '\n');
  process.exit(1);
});
