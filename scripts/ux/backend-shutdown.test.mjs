import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, existsSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { io } = require('socket.io-client');
const Redis = require('ioredis');
const { Queue } = require('bullmq');
const { createProxyMiddleware } = require('http-proxy-middleware');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, ms, message) {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message());
    await pause(25);
  }
}
async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function reachable(port) {
  return new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
  });
}
async function stopOwned(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'close');
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
  child.kill('SIGTERM');
  try { await closed; } finally { clearTimeout(timer); }
}

function launchBackend(root, redisPort, extra = {}) {
  return spawn(process.execPath, [resolve('scripts/ux/backend-shutdown.fixture.cjs')], {
    cwd: root,
    env: {
      PATH: process.env.PATH, TMPDIR: root, SPOOTY_LIFECYCLE_ROOT: root,
      DOWNLOADS_PATH: join(root, 'downloads'), STATIC_PLAYLISTS_PATH: join(root, 'playlists'),
      FE_PATH: join(root, 'frontend'), DB_PATH: join(root, 'library.sqlite'),
      ACQUIRE_STATE_PATH: join(root, 'acquire'), COOKIES_PATH: join(root, 'absent-cookies'),
      YT_PACE_STATE_PATH: join(root, 'pace.json'), YT_PACE_EVENTS_PATH: join(root, 'events.jsonl'),
      REDIS_RUN: 'false', REDIS_HOST: '127.0.0.1', REDIS_PORT: String(redisPort),
      ...extra,
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
}

const cases = ['close', 'SIGTERM'].flatMap(shutdown => ['none', 'polling', 'websocket']
  .map(transport => ({ shutdown, transport, backlog: false, redisOutage: false })));
cases.push({ shutdown: 'SIGTERM', transport: 'websocket', backlog: true, redisOutage: false });
cases.push({ shutdown: 'SIGTERM', transport: 'websocket', backlog: false, redisOutage: true });
cases.push({ shutdown: 'SIGTERM', transport: 'websocket', backlog: true, redisOutage: true });
cases.push({ shutdown: 'SIGTERM', transport: 'websocket', backlog: false, redisOutage: false, active: true });
cases.push({ shutdown: 'SIGTERM', transport: 'websocket', backlog: false, redisOutage: false, recoveredRedis: true });
cases.push({ shutdown: 'SIGTERM', transport: 'websocket', backlog: true, redisOutage: false, recoveredRedis: true });
cases.push({ shutdown: 'SIGTERM', transport: 'websocket', backlog: false, redisOutage: false, recoveredRedis: true, active: true });
cases.push({ shutdown: 'SIGTERM', transport: 'websocket', backlog: false, redisOutage: false, finished: true });
for (const transport of ['proxy-polling', 'proxy-upgrade', 'partial-request']) {
  cases.push({ shutdown: 'SIGTERM', transport, backlog: false, redisOutage: false });
}
for (const { shutdown, transport, backlog, redisOutage, active, recoveredRedis, finished } of cases) {
  test(`real backend ${shutdown} exits with ${transport}${backlog ? ' and preserved queued work' : ''}${redisOutage ? ' and Redis outage' : ''}${active ? ' after an in-flight operation finishes' : ''}${recoveredRedis ? ' after Redis recovers' : ''}${finished ? ' after a completed batch becomes idle' : ''}`, {
    timeout: 30000,
    skip: !existsSync('/opt/homebrew/bin/redis-server'),
  }, async t => {
    const root = mkdtempSync(join(tmpdir(), 'spooty-lifecycle-'));
    for (const name of ['downloads', 'playlists', 'frontend', 'acquire']) mkdirSync(join(root, name));
    let redis, backend, client, proxyServer, partialSocket;
    const proxySockets = new Set();
    t.after(async () => {
      client?.disconnect();
      partialSocket?.destroy();
      for (const socket of proxySockets) socket.destroy();
      if (proxyServer) await new Promise(resolve => proxyServer.close(resolve));
      await stopOwned(backend);
      await stopOwned(redis);
      rmSync(root, { recursive: true, force: true });
    });
    const redisPort = await availablePort();
    redis = spawn('/opt/homebrew/bin/redis-server', [
      '--bind', '127.0.0.1', '--port', String(redisPort), '--save', '', '--appendonly', 'no', '--dir', root,
    ], { stdio: 'ignore' });
    const deadline = Date.now() + 5000;
    while (!(await reachable(redisPort))) {
      assert.ok(Date.now() < deadline && redis.exitCode === null, 'Isolated Redis must start');
      await pause(25);
    }
    const connection = { host: '127.0.0.1', port: redisPort };
    const names = ['track-search-processor', 'track-download-processor'];
    if (backlog) for (const name of names) {
      const queue = new Queue(name, { connection });
      try {
        await queue.pause();
        await queue.add('sentinel', { fixture: true }, { jobId: 'fixture-preserved' });
        await queue.add('later', { fixture: true }, { jobId: 'fixture-later', delay: 600000 });
      } finally { await queue.close(); }
    }
    if (active) {
      const queue = new Queue(names[0], { connection });
      try { await queue.add('held', { fixture: true }, { jobId: 'fixture-active', removeOnComplete: false }); }
      finally { await queue.close(); }
    }
    if (finished) {
      const queue = new Queue(names[0], { connection });
      try { await queue.addBulk(Array.from({ length: 32 }, (_, i) => ({ name: 'finished-fixture', data: { fixture: true }, opts: { jobId: `fixture-finished-${i}` } }))); }
      finally { await queue.close(); }
    }
    const events = [];
    let stderr = '', exited = false;
    backend = launchBackend(root, redisPort, { SPOOTY_LIFECYCLE_ACTIVE: active ? '1' : '0', SPOOTY_LIFECYCLE_FINISHED: finished ? '1' : '0' });
    backend.stderr.on('data', chunk => { stderr += chunk; });
    backend.on('message', event => events.push(event));
    backend.on('exit', () => { exited = true; });
    const diagnostic = () => {
      const directory = join(root, 'shutdown-traces');
      const shutdownTrace = existsSync(directory) ? readdirSync(directory).flatMap(file =>
        readFileSync(join(directory, file), 'utf8').trim().split('\n').slice(-4).filter(Boolean).map(line => JSON.parse(line))) : [];
      return JSON.stringify({ events: events.slice(-20), stderr, shutdownTrace });
    };
    await until(() => events.some(event => event.event === 'ready') || exited, 10000, diagnostic);
    const ready = events.find(event => event.event === 'ready');
    assert.ok(ready, diagnostic());
    const api = `http://127.0.0.1:${ready.port}/api`;
    for (const route of ['/library', '/youtube/pace']) {
      const response = await fetch(api + route, { signal: AbortSignal.timeout(4000) });
      assert.equal(response.status, 200);
      await response.json();
    }
    let endpoint = `http://127.0.0.1:${ready.port}`;
    if (transport.startsWith('proxy-')) {
      // Same middleware package as the dev server, but only this isolated
      // backend. No production :3000/:4200 or browser connection.
      const proxy = createProxyMiddleware({ target: endpoint, ws: true, changeOrigin: true });
      proxyServer = createHttpServer(proxy);
      proxyServer.on('connection', socket => { proxySockets.add(socket); socket.once('close', () => proxySockets.delete(socket)); });
      proxyServer.on('upgrade', proxy.upgrade);
      proxyServer.listen(0, '127.0.0.1'); await once(proxyServer, 'listening');
      endpoint = `http://127.0.0.1:${proxyServer.address().port}`;
    }
    if (transport === 'partial-request') {
      partialSocket = connect({ host: '127.0.0.1', port: ready.port });
      partialSocket.on('error', () => {});
      await once(partialSocket, 'connect');
      partialSocket.write('POST /api/library/download HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 99\r\n\r\n{');
      await pause(50);
    } else if (transport !== 'none') {
      const transports = transport === 'proxy-upgrade' ? ['polling', 'websocket']
        : transport === 'proxy-polling' ? ['polling'] : [transport];
      client = io(endpoint, { transports, reconnection: false });
      await until(() => client.connected, 4000, () => 'Isolated dashboard socket must connect');
      if (transport === 'proxy-upgrade') await until(() => client.io.engine.transport.name === 'websocket', 4000, () => 'Polling must actually upgrade');
      if (transport.startsWith('proxy-')) {
        // Exercise overlapping status requests and cancelled HTTP observations,
        // then cross an idle keep-alive/worker drain-delay interval.
        await Promise.all(Array.from({ length: 12 }, async (_, index) => {
          const controller = new AbortController();
          const request = fetch(endpoint + '/api/youtube/pace', { signal: controller.signal })
            .then(async response => { assert.equal(response.status, 200); await response.json(); })
            .catch(error => { if (!controller.signal.aborted) throw error; });
          if (index % 3 === 0) controller.abort();
          await request;
        }));
        await pause(5500);
      }
    }
    if (redisOutage) {
      if (backlog) {
        const saver = new Redis({ ...connection, maxRetriesPerRequest: 0, retryStrategy: () => null });
        try { await saver.save(); } finally { saver.disconnect(); }
      }
      await stopOwned(redis);
      await pause(100);
    }
    if (recoveredRedis) {
      const saver = new Redis({ ...connection, maxRetriesPerRequest: 0, retryStrategy: () => null });
      try { await saver.save(); } finally { saver.disconnect(); }
      await stopOwned(redis); await pause(250);
      redis = spawn('/opt/homebrew/bin/redis-server', [
        '--bind', '127.0.0.1', '--port', String(redisPort), '--save', '', '--appendonly', 'no', '--dir', root,
      ], { stdio: 'ignore' });
      const deadline = Date.now() + 5000;
      let ready = false;
      while (Date.now() < deadline && !ready) {
        backend.send('state'); await pause(100);
        const state = events.findLast(event => event.event === 'worker-state');
        ready = state?.workers.length === 2 && state.workers.every(worker => worker.main === 'ready' && worker.blocking === 'ready');
      }
      assert.ok(ready, diagnostic());
      await pause(5500); // Cross the first post-recovery idle blocking interval.
    }
    if (finished) {
      await until(() => events.filter(event => event.event === 'work-finished').length === 32, 5000, diagnostic);
      await pause(5500);
      const queue = new Queue(names[0], { connection });
      try { assert.equal(await queue.getActiveCount(), 0); assert.equal(await queue.getCompletedCount(), 32); }
      finally { await queue.close(); }
    }
    if (active) await until(() => events.some(event => event.event === 'work-started'), 4000, diagnostic);
    if (shutdown === 'close') backend.send('close');
    else backend.kill(shutdown);
    if (active) {
      await until(() => events.some(event => event.event === 'hook-start' && event.provider === 'BullExplorer'), 3000, diagnostic);
      // A blocking Redis timeout must never become a job execution deadline.
      // Keep the real worker handler alive beyond the configured 10s fallback.
      if (recoveredRedis) await pause(11000);
      assert.equal(exited, false, 'Shutdown must wait for the running handler');
      assert.equal(events.some(event => event.event === 'hook-start' && event.provider === 'WorkerShutdownService' && event.method === 'onApplicationShutdown'), false,
        'The diagnostic trace must remain live while Bull is still draining');
      assert.equal(events.some(event => event.event === 'work-finished'), false);
      assert.equal(events.some(event => event.event === 'queue-start' && event.method === 'close' && event.force), false);
      backend.send('release');
    }
    await until(() => exited, 5000, diagnostic);
    assert.equal(backend.exitCode, shutdown === 'close' ? 0 : null, diagnostic());
    assert.equal(backend.signalCode, shutdown === 'close' ? null : shutdown, diagnostic());
    assert.ok(events.some(event => event.event === 'phase-end' && event.method === 'callShutdownHook'), diagnostic());
    if (recoveredRedis) assert.equal(events.some(event => event.event === 'queue-start' && event.method === 'close' && event.force), false,
      'Recovered Redis must use graceful drain, not a forced worker close');
    if (backlog) {
      if (redisOutage) {
        redis = spawn('/opt/homebrew/bin/redis-server', [
          '--bind', '127.0.0.1', '--port', String(redisPort), '--save', '', '--appendonly', 'no', '--dir', root,
        ], { stdio: 'ignore' });
        const deadline = Date.now() + 5000;
        while (!(await reachable(redisPort))) {
          assert.ok(Date.now() < deadline && redis.exitCode === null, 'Isolated Redis must recover');
          await pause(25);
        }
      }
      const inspector = new Redis({ ...connection, maxRetriesPerRequest: 0, retryStrategy: () => null });
      try {
        for (const name of names) {
          assert.equal(await inspector.hget(`bull:${name}:meta`, 'paused'), '1');
          assert.deepEqual(await inspector.lrange(`bull:${name}:paused`, 0, -1), ['fixture-preserved']);
          assert.equal(await inspector.zcard(`bull:${name}:delayed`), 1);
          assert.equal(await inspector.llen(`bull:${name}:active`), 0);
        }
      } finally { inspector.disconnect(); }
    }
    if (active) {
      assert.equal(events.filter(event => event.event === 'work-finished').length, 1);
      const inspector = new Redis({ ...connection, maxRetriesPerRequest: 0, retryStrategy: () => null });
      try {
        assert.notEqual(await inspector.zscore(`bull:${names[0]}:completed`, 'fixture-active'), null);
        assert.equal(await inspector.llen(`bull:${names[0]}:active`), 0);
      } finally { inspector.disconnect(); }
    }
  });
}

for (const mode of ['selected', 'remaining', 'interrupted', 'failed']) {
  test(`real download submission receipt survives restart: ${mode}`, {
    timeout: 30000, skip: !existsSync('/opt/homebrew/bin/redis-server'),
  }, async t => {
    const root = mkdtempSync(join(tmpdir(), 'spooty-receipt-http-'));
    for (const name of ['downloads', 'playlists', 'frontend', 'acquire']) mkdirSync(join(root, name));
    let redis, backend;
    const queues = [];
    t.after(async () => {
      await stopOwned(backend);
      for (const queue of queues) await queue.close();
      await stopOwned(redis);
      rmSync(root, { recursive: true, force: true });
    });
    const redisPort = await availablePort();
    redis = spawn('/opt/homebrew/bin/redis-server', [
      '--bind', '127.0.0.1', '--port', String(redisPort), '--save', '', '--appendonly', 'no', '--dir', root,
    ], { stdio: 'ignore' });
    const deadline = Date.now() + 5000;
    while (!(await reachable(redisPort))) {
      assert.ok(Date.now() < deadline && redis.exitCode === null, 'Isolated Redis must start');
      await pause(25);
    }
    const connection = { host: '127.0.0.1', port: redisPort };
    for (const name of ['track-search-processor', 'track-download-processor']) {
      const queue = new Queue(name, { connection }); queues.push(queue); await queue.pause();
    }
    const playlistId = 'aaaaaaaaaaaaaaaaaaaaaa';
    const uri = `spotify:playlist:${playlistId}`;
    const metadata = JSON.stringify({ id: playlistId, uri, name: 'Receipt fixture', trackCount: 2,
      tracks: [1, 2].map(n => ({ n, id: String(n).repeat(22), artist: `Fixture artist ${n}`, name: `Fixture song ${n}`, durationMs: 180000 })) });
    const metadataFile = join(root, 'playlists', 'fixture.json');
    writeFileSync(metadataFile, metadata);
    let expectedMetadata = metadata;

    async function start(extra = {}) {
      backend = launchBackend(root, redisPort, extra);
      const events = []; let stderr = '';
      backend.on('message', event => events.push(event));
      backend.stderr.on('data', chunk => { stderr += chunk; });
      const diagnostic = () => JSON.stringify({ events, stderr });
      await until(() => events.some(e => e.event === 'ready') || backend.exitCode !== null, 10000, diagnostic);
      const ready = events.find(e => e.event === 'ready'); assert.ok(ready, diagnostic());
      return { api: `http://127.0.0.1:${ready.port}/api/library`, events, diagnostic };
    }
    let fixture = await start(mode === 'interrupted'
      ? { SPOOTY_LIFECYCLE_ADMISSION_MODE: 'hold-after-work' }
      : mode === 'failed' ? { SPOOTY_LIFECYCLE_ADMISSION_MODE: 'fail-after-work' } : {});
    const requestId = '11111111-2222-3333-4444-555555555555';
    const route = mode === 'remaining' ? '/download-remaining' : '/download';
    const body = { maxSearches: 10, networkRetries: 5, ...(mode === 'remaining' ? {} : { uris: [uri] }) };
    const post = (id = requestId, input = body) => fetch(fixture.api + route, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Spooty-Request-Id': id },
      body: JSON.stringify(input), signal: AbortSignal.timeout(10000),
    });
    const get = () => fetch(`${fixture.api}/download-requests/${requestId}`, { signal: AbortSignal.timeout(4000) });
    assert.equal((await post('not-a-valid-id')).status, 400);
    assert.equal((await get()).status, 404);
    assert.equal(await queues[0].count(), 0, 'Invalid requests cannot admit work');
    const first = post();
    if (mode === 'interrupted') {
      // Capture rejection before deliberately closing its HTTP connection.
      const lost = first.then(r => r.arrayBuffer(), () => null);
      await until(() => fixture.events.some(e => e.event === 'preparation-held'), 5000, fixture.diagnostic);
      const status = await (await get()).json();
      assert.equal(status.state, 'preparing'); assert.equal(status.receipt, null);
      assert.equal(await queues[0].count(), 2, 'Partial work really exists before interruption');
      await stopOwned(backend); await lost;
    } else {
      const response = await first;
      assert.equal(response.status, mode === 'failed' ? 500 : 201);
      const result = await response.json();
      if (mode !== 'failed') {
        assert.deepEqual(result, { queued: 2, skipped: 0 });
        assert.deepEqual(await (await post()).json(), result, 'Same ID returns original counts, not a new no-op result');
        assert.equal((await post(requestId, { ...body, maxSearches: 20 })).status, 409);
      }
      await stopOwned(backend);
    }
    if (mode === 'remaining') {
      const changed = JSON.parse(metadata);
      changed.trackCount = 3;
      changed.tracks.push({ n: 3, id: '3'.repeat(22), artist: 'Fixture artist 3', name: 'Fixture song 3', durationMs: 180000 });
      expectedMetadata = JSON.stringify(changed);
      writeFileSync(metadataFile, expectedMetadata);
    }
    fixture = await start();
    const statusResponse = await get(); assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.requestId, requestId);
    assert.equal(status.destination, join(root, 'downloads'));
    assert.equal(status.owner, undefined); assert.equal(status.fingerprint, undefined);
    assert.equal(status.state, mode === 'interrupted' ? 'interrupted' : mode === 'failed' ? 'failed' : 'completed');
    const repeated = await post();
    if (mode === 'interrupted' || mode === 'failed') {
      assert.equal(status.receipt, null);
      assert.equal(repeated.status, 409, 'A failed/interrupted request is never replayed');
    } else {
      assert.deepEqual(status.receipt, { queued: 2, skipped: 0 });
      assert.equal(repeated.status, 201);
      assert.deepEqual(await repeated.json(), status.receipt);
      assert.equal(await queues[0].count(), 2, 'An old ID must not apply to a newly expanded library');
      // A new explicit ID still uses existing queue membership and skips it.
      assert.deepEqual(await (await post('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).json(), { queued: mode === 'remaining' ? 1 : 0, skipped: 2 });
    }
    assert.equal(await queues[0].count(), mode === 'remaining' ? 3 : 2);
    assert.equal(await queues[1].count(), 0);
    for (const queue of queues) assert.equal(await queue.isPaused(), true);
    assert.equal(readFileSync(metadataFile, 'utf8'), expectedMetadata);
    assert.equal(readdirSync(join(root, 'downloads', 'Receipt fixture')).length, 0, 'Paused test work downloads no audio');
    const savedReceipt = readFileSync(join(root, 'download-requests', `${requestId}.json`), 'utf8');
    assert.doesNotMatch(savedReceipt, /Controlled fixture preparation failure/);
  });
}
