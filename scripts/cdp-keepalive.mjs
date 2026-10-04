#!/usr/bin/env node
/**
 * Single long-lived CDP connection to main Chrome.
 * All commands go through http://127.0.0.1:17331. Startup and health checks
 * never request Chrome permission. Explicit --connect or POST /connect is the
 * only way to initiate one connection; no automatic reconnect after failure.
 */
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

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

export class Cdp {
  constructor(onDisconnect = () => {}, options = {}) {
    this.id = 0;
    this.pending = new Map();
    this.ws = null;
    this.endpoint = null;
    this.connectedAt = null;
    this.connecting = null;
    this.onDisconnect = onDisconnect;
    this.lastReconnectError = '';
    this.WebSocket = options.WebSocket || WebSocket;
    this.readEndpoint = options.readEndpoint || readEndpoint;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 120000;
    this.log = options.log || log;
    this.eventLog = [];
    this.eventSeq = 0;
  }

  recordEvent(msg) {
    if (!msg?.method || !FORWARDED_EVENTS.has(msg.method)) return;
    this.eventSeq += 1;
    this.eventLog.push({
      seq: this.eventSeq,
      method: msg.method,
      params: msg.params,
      sessionId: msg.sessionId,
    });
    if (this.eventLog.length > 2000) this.eventLog.splice(0, this.eventLog.length - 2000);
  }

  clearEvents() {
    this.eventLog = [];
    this.eventSeq = 0;
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
    this.endpoint = this.readEndpoint();
    this.log('Opening one requested Chrome connection. No automatic reconnects.');
    await new Promise((resolve, reject) => {
      let settled = false;
      const socket = new this.WebSocket(this.endpoint, {
        perMessageDeflate: false,
      });
      this.ws = socket;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.ws === socket) {
          this.ws = null;
          this.connectedAt = null;
        }
        // A timed-out handshake is still a live socket unless explicitly closed.
        // Leaving it behind causes repeated Chrome prompts and late-open races.
        socket.terminate();
        reject(error);
      };
      const timer = setTimeout(
        () => fail(new Error('Chrome connection timed out; reconnect explicitly')),
        this.connectTimeoutMs,
      );
      socket.on('open', () => {
        if (settled || this.ws !== socket) {
          socket.terminate();
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.connectedAt = new Date().toISOString();
        this.lastReconnectError = '';
        this.clearEvents();
        this.log('CDP session alive');
        resolve();
      });
      socket.on('error', (err) => {
        fail(err);
      });
      socket.on('close', (code, reason) => {
        if (!settled) fail(new Error('Chrome closed the connection before approval'));
        // An obsolete socket must not clear a newer connection's pending calls.
        if (this.ws !== socket) return;
        this.log(`WebSocket closed code=${code}`);
        if (this.ws === socket) {
          this.ws = null;
          this.connectedAt = null;
          this.clearEvents();
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
        } else this.recordEvent(msg);
      });
    });
  }
  send(method, params = {}, sessionId, timeoutMs = 30000) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('CDP not connected'));
    }
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeout);
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
const FORWARDED_EVENTS = new Set([
  'Runtime.executionContextCreated',
  'Runtime.executionContextDestroyed',
  'Runtime.executionContextsCleared',
  'Target.attachedToTarget',
  'Target.detachedFromTarget',
  'Target.targetCreated',
  'Target.targetDestroyed',
  'Target.targetInfoChanged',
]);

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

export async function handle(cdp, req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, {
      ok: true,
      connected: !!(cdp.ws && cdp.ws.readyState === 1),
      connecting: !!cdp.connecting,
      connectedAt: cdp.connectedAt,
      pid: process.pid,
    });
  }
  if (req.method === 'POST' && url.pathname === '/connect') {
    const body = await readBody(req);
    if (body.confirm !== 'allow-one-chrome-connection') {
      return json(res, 400, { error: 'Explicit single-connection confirmation required' });
    }
    await cdp.connect();
    return json(res, 200, { connected: true });
  }
  if (!(cdp.ws && cdp.ws.readyState === WebSocket.OPEN)) {
    return json(res, 503, {
      error: 'Chrome bridge disconnected. Reconnect explicitly; automatic permission requests are disabled.',
    });
  }
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
  if (req.method === 'GET' && url.pathname === '/events') {
    const after = Number(url.searchParams.get('after') || 0);
    const events = cdp.eventLog.filter((event) => event.seq > after);
    return json(res, 200, { after: cdp.eventSeq, events });
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
    if (body.method === 'Target.activateTarget') {
      return json(res, 403, { error: 'Foreground activation is disabled; use the shared background tab' });
    }
    const msg = await cdp.send(
      body.method,
      body.params || {},
      body.sessionId,
      body.timeoutMs,
    );
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
  const heartbeat = setInterval(async () => {
    if (!(cdp.ws && cdp.ws.readyState === WebSocket.OPEN)) return;
    try {
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
    // Own the singleton HTTP port before opening any Chrome connection.
    fs.writeFileSync(PID_FILE, String(process.pid));
    log(`Keepalive HTTP on http://127.0.0.1:${PORT} pid=${process.pid}`);
    if (process.argv.includes('--connect')) {
      cdp.connect().catch((error) => log(error.message));
    }
  });
  server.on('error', (error) => {
    clearInterval(heartbeat);
    log(`HTTP listener failed: ${error.message}`);
    process.exitCode = 1;
  });

  const shutdown = () => {
    clearInterval(heartbeat);
    cdp.ws?.terminate();
    server.close();
    if (fs.existsSync(PID_FILE) && fs.readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) {
      fs.unlinkSync(PID_FILE);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    log(String(err.stack || err));
    process.exit(1);
  });
}
