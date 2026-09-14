#!/usr/bin/env node
/**
 * Single long-lived CDP connection to main Chrome.
 * Subsequent commands go through http://127.0.0.1:17331 so Chrome
 * is not prompted again.
 */
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const PORT = Number(process.env.CDP_KEEPALIVE_PORT || 17331);
const PORT_FILE =
  process.env.HOME +
  '/Library/Application Support/Google/Chrome/DevToolsActivePort';
const PID_FILE = '/tmp/spooty-cdp-keepalive.pid';
const LOG_FILE = '/tmp/spooty-cdp-keepalive.log';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {}
  process.stderr.write(line);
}

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
  constructor(onDisconnect = () => {}) {
    this.id = 0;
    this.pending = new Map();
    this.ws = null;
    this.endpoint = null;
    this.connectedAt = null;
    this.connecting = null;
    this.onDisconnect = onDisconnect;
    this.lastReconnectError = '';
  }

  async connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.open().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  async open() {
    this.endpoint = readEndpoint();
    log(`Connecting once to ${this.endpoint}`);
    log('If Chrome shows Allow, click it ONCE. This process will stay open.');
    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(
        () => reject(new Error('connect timeout — click Allow in Chrome')),
        120000,
      );
      const socket = new WebSocket(this.endpoint, {
        perMessageDeflate: false,
      });
      this.ws = socket;
      socket.on('open', () => {
        settled = true;
        clearTimeout(timer);
        this.connectedAt = new Date().toISOString();
        this.lastReconnectError = '';
        log('CDP session alive');
        resolve();
      });
      socket.on('error', (err) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      socket.on('close', (code, reason) => {
        log(`WebSocket closed code=${code} reason=${reason}`);
        if (this.ws === socket) {
          this.ws = null;
          this.connectedAt = null;
        }
        for (const [, { reject: rej }] of this.pending) {
          rej(new Error('CDP socket closed'));
        }
        this.pending.clear();
        this.onDisconnect();
      });
      socket.on('message', (data) => {
        let msg;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (msg.id != null && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(JSON.stringify(msg.error)));
          else res(msg);
        }
      });
    });
  }
  send(method, params = {}, sessionId) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('CDP not connected'));
    }
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30000);
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
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

const sessions = new Map(); // targetId -> sessionId
let resyncTargetId = null;

async function attach(cdp, targetId) {
  if (sessions.has(targetId)) return sessions.get(targetId);
  const msg = await cdp.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  const sessionId = msg.result.sessionId;
  sessions.set(targetId, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId).catch(() => {});
  return sessionId;
}

async function handle(cdp, req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/health') {
    if (!(cdp.ws && cdp.ws.readyState === WebSocket.OPEN)) {
      cdp.connect().catch(() => {});
    }
    return json(res, 200, {
      ok: true,
      connected: !!(cdp.ws && cdp.ws.readyState === 1),
      endpoint: cdp.endpoint,
      connectedAt: cdp.connectedAt,
      pid: process.pid,
    });
  }
  await cdp.connect();
  if (req.method === 'GET' && url.pathname === '/tab') {
    const msg = await cdp.send('Target.getTargets');
    const pages = (msg.result.targetInfos || []).filter((t) => t.type === 'page');
    let target = pages.find(
      (t) =>
        t.targetId === resyncTargetId ||
        /spooty-resync=1/.test(t.url || ''),
    );
    if (!target) {
      const created = await cdp.send('Target.createTarget', {
        url: 'about:blank',
        background: true,
      });
      resyncTargetId = created.result.targetId;
      const sessionId = await attach(cdp, resyncTargetId);
      return json(res, 200, {
        targetId: resyncTargetId,
        sessionId,
        created: true,
      });
    }
    resyncTargetId = target.targetId;
    const sessionId = await attach(cdp, target.targetId);
    return json(res, 200, {
      targetId: target.targetId,
      sessionId,
      created: false,
      url: target.url,
    });
  }
  if (req.method === 'GET' && url.pathname === '/targets') {
    const msg = await cdp.send('Target.getTargets');
    const pages = (msg.result.targetInfos || [])
      .filter((t) => t.type === 'page')
      .map((t) => ({
        targetId: t.targetId,
        title: t.title,
        url: t.url,
      }));
    return json(res, 200, { pages });
  }
  if (req.method === 'POST' && url.pathname === '/eval') {
    const body = await readBody(req);
    if (!body.targetId || !body.expression) {
      return json(res, 400, { error: 'targetId and expression required' });
    }
    const sessionId = await attach(cdp, body.targetId);
    const msg = await cdp.send(
      'Runtime.evaluate',
      {
        expression: body.expression,
        returnByValue: true,
        awaitPromise: true,
      },
      sessionId,
    );
    if (msg.result.exceptionDetails) {
      return json(res, 500, {
        error: msg.result.exceptionDetails.text || 'evaluate failed',
        details: msg.result.exceptionDetails,
      });
    }
    return json(res, 200, { value: msg.result.result?.value });
  }
  if (req.method === 'POST' && url.pathname === '/cdp') {
    const body = await readBody(req);
    const msg = await cdp.send(body.method, body.params || {}, body.sessionId);
    return json(res, 200, msg);
  }
  json(res, 404, { error: 'not found' });
}

async function main() {
  if (fs.existsSync(PID_FILE)) {
    const old = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
    if (old && !Number.isNaN(old)) {
      try {
        process.kill(old, 0);
        log(`Already running pid=${old}`);
        process.exit(0);
      } catch {
        fs.unlinkSync(PID_FILE);
      }
    }
  }

  const cdp = new Cdp(() => {
    sessions.clear();
    resyncTargetId = null;
  });
  await cdp.connect();
  fs.writeFileSync(PID_FILE, String(process.pid));

  setInterval(async () => {
    try {
      await cdp.connect();
      await cdp.send('Browser.getVersion');
    } catch (error) {
      const message = String(error?.message || error);
      if (message !== cdp.lastReconnectError) {
        cdp.lastReconnectError = message;
        log(`reconnect: ${message}`);
      }
    }
  }, 15000);

  const server = http.createServer((req, res) => {
    handle(cdp, req, res).catch((err) => {
      log(`handler error: ${err.stack || err}`);
      if (!res.headersSent) json(res, 500, { error: String(err.message || err) });
    });
  });
  server.listen(PORT, '127.0.0.1', () => {
    log(`Keepalive HTTP on http://127.0.0.1:${PORT} pid=${process.pid}`);
  });

  const shutdown = () => {
    log('shutdown requested — ignoring so the Chrome session stays open');
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log(String(err.stack || err));
  process.exit(1);
});
