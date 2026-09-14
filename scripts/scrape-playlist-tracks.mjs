#!/usr/bin/env node
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
const PLAYLIST_ID = '17FjOthbHvvqRlL9FbBrtP';
const OUT = path.join(ROOT, '.playlist_tracks.json');

function readEndpoint() {
  const raw = fs.readFileSync(PORT_FILE, 'utf8');
  const [port, pth] = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return `ws://127.0.0.1:${port}${pth}`;
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.eventHandlers = [];
  }
  connect() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('connect timeout')), 20000);
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
        () => reject(new Error(`timeout ${method}`)),
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

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  );
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'evaluate failed');
  }
  return result.result?.value;
}

async function main() {
  const cdp = new Cdp(readEndpoint());
  await cdp.connect();
  const { targetInfos } = await cdp.send('Target.getTargets');
  const page = targetInfos.find((t) =>
    (t.url || '').includes(`playlist/${PLAYLIST_ID}`),
  );
  if (!page) throw new Error('Playlist tab not found in main Chrome');
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId: page.targetId,
    flatten: true,
  });
  await cdp.send('Runtime.enable', {}, sessionId).catch(() => {});

  const header = await evaluate(
    cdp,
    sessionId,
    `(() => {
      const h1 = document.querySelector('h1');
      const total = document.body.innerText.match(/(\\d+)\\s+songs?/i);
      return {
        title: h1 ? h1.innerText : document.title,
        totalHint: total ? Number(total[1]) : null,
        href: location.href,
      };
    })()`,
  );
  process.stderr.write(`Playlist header: ${JSON.stringify(header)}\n`);

  await evaluate(
    cdp,
    sessionId,
    `(() => {
      const child = document.querySelector('.main-view-container__scroll-node-child');
      const scroller = child && child.parentElement;
      if (scroller) scroller.scrollTop = 0;
      return scroller ? scroller.scrollHeight : null;
    })()`,
  );
  await new Promise((r) => setTimeout(r, 500));

  const seen = new Map();
  let stagnant = 0;
  for (let i = 0; i < 120; i++) {
    const batch = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const rows = [...document.querySelectorAll('[data-testid="tracklist-row"]')];
        const items = rows.map((row) => {
          const titleEl = row.querySelector('a[data-testid="internal-track-link"], [data-testid="internal-track-link"]');
          const artists = [...row.querySelectorAll('a[href*="/artist/"]')]
            .map((a) => a.innerText.trim())
            .filter(Boolean);
          const title = titleEl ? titleEl.innerText.trim() : '';
          const href = titleEl && titleEl.href ? titleEl.href : '';
          return { title, artist: artists.join(', '), href };
        }).filter((t) => t.title && t.artist);
        const child = document.querySelector('.main-view-container__scroll-node-child');
        const scroller = child && child.parentElement;
        if (scroller) scroller.scrollTop += 700;
        else window.scrollBy(0, 700);
        return items;
      })()`,
    );
    let added = 0;
    for (const t of batch || []) {
      const key = `${t.artist}|||${t.title}`;
      if (!seen.has(key)) {
        seen.set(key, t);
        added++;
      }
    }
    process.stderr.write(
      `scroll ${i + 1}: batch=${(batch || []).length} added=${added} total=${seen.size}\n`,
    );
    if (added === 0) stagnant++;
    else stagnant = 0;
    if (stagnant >= 6) break;
    if (header.totalHint && seen.size >= header.totalHint) break;
    await new Promise((r) => setTimeout(r, 350));
  }

  const tracks = [...seen.values()];
  fs.writeFileSync(OUT, JSON.stringify({ header, count: tracks.length, tracks }, null, 2));
  process.stderr.write(`Wrote ${tracks.length} tracks to ${OUT}\n`);
  cdp.close();
}

main().catch((err) => {
  process.stderr.write(String(err.stack || err) + '\n');
  process.exit(1);
});
