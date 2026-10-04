import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { Cdp, handle } from './cdp-keepalive.mjs';

function fixture(timeout = 100) {
  const sockets = [];
  class FakeSocket extends EventEmitter {
    readyState = 0;
    terminated = false;
    sent = [];
    constructor() { super(); sockets.push(this); }
    terminate() { this.terminated = true; this.readyState = 3; }
    open() { this.readyState = 1; this.emit('open'); }
    send(raw) { this.sent.push(JSON.parse(raw)); }
  }
  let disconnected = 0;
  const cdp = new Cdp(() => disconnected++, {
    WebSocket: FakeSocket,
    readEndpoint: () => 'ws://test.invalid',
    connectTimeoutMs: timeout,
    log: () => {},
  });
  return { cdp, sockets, disconnected: () => disconnected };
}

test('concurrent callers share one pending and then one approved connection', async () => {
  const { cdp, sockets } = fixture();
  const first = cdp.connect();
  const second = cdp.connect();
  assert.equal(sockets.length, 1);
  sockets[0].open();
  await Promise.all([first, second]);
  await cdp.connect();
  assert.equal(sockets.length, 1);
});

test('timeout terminates the unapproved socket; no background reconnect', async () => {
  const { cdp, sockets } = fixture(10);
  await assert.rejects(cdp.connect(), /timed out/);
  assert.equal(sockets[0].terminated, true);
  assert.equal(cdp.ws, null);
  assert.equal(cdp.connecting, null);
  assert.equal(sockets.length, 1);
});

test('late approval of a timed-out socket cannot replace the current connection', async () => {
  const { cdp, sockets } = fixture(10);
  await assert.rejects(cdp.connect(), /timed out/);
  const next = cdp.connect();
  sockets[1].open();
  await next;
  sockets[0].open();
  assert.equal(cdp.ws, sockets[1]);
  assert.equal(sockets[0].terminated, true);
});

test('obsolete close does not reject a new connection response or clear its session', async () => {
  const { cdp, sockets, disconnected } = fixture(10);
  await assert.rejects(cdp.connect(), /timed out/);
  const next = cdp.connect();
  sockets[1].open();
  await next;
  const response = cdp.send('Browser.getVersion');
  sockets[0].emit('close', 1006);
  assert.equal(disconnected(), 0);
  const { id } = sockets[1].sent[0];
  sockets[1].emit('message', JSON.stringify({ id, result: { product: 'test' } }));
  assert.equal((await response).result.product, 'test');
});

test('early error and early close both terminate and clear pending connection', async () => {
  for (const event of ['error', 'close']) {
    const { cdp, sockets } = fixture();
    const pending = cdp.connect();
    sockets[0].emit(event, event === 'error' ? new Error('denied') : 1006);
    await assert.rejects(pending);
    assert.equal(sockets[0].terminated, true);
    assert.equal(cdp.ws, null);
    assert.equal(cdp.connecting, null);
  }
});

test('current disconnect clears active calls and does not reconnect', async () => {
  const { cdp, sockets, disconnected } = fixture();
  const pending = cdp.connect();
  sockets[0].open();
  await pending;
  const response = cdp.send('Browser.getVersion');
  sockets[0].emit('close', 1006);
  await assert.rejects(response, /closed/);
  assert.equal(disconnected(), 1);
  assert.equal(cdp.ws, null);
  assert.equal(cdp.connectedAt, null);
  assert.equal(sockets.length, 1);
});

test('health and ordinary proxy requests never create Chrome connections', async () => {
  const { cdp, sockets } = fixture();
  const server = http.createServer((req, res) => handle(cdp, req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(`${base}/health`).then(r => r.json());
    assert.equal(health.connected, false);
    assert.equal(health.connecting, false);
    assert.equal((await fetch(`${base}/targets`)).status, 503);
    assert.equal((await fetch(`${base}/connect`, { method: 'POST', body: '{}' })).status, 400);
    assert.equal(sockets.length, 0);
    const approved = fetch(`${base}/connect`, {
      method: 'POST', body: JSON.stringify({ confirm: 'allow-one-chrome-connection' }),
    });
    while (!sockets.length) await new Promise(resolve => setImmediate(resolve));
    sockets[0].open();
    assert.equal((await approved).status, 200);
    assert.equal(sockets.length, 1);
    sockets[0].emit('message', JSON.stringify({
      method: 'Runtime.executionContextCreated',
      params: { context: { id: 7, origin: 'https://example.test' } },
      sessionId: 's1',
    }));
    sockets[0].emit('message', JSON.stringify({
      method: 'Console.messageAdded',
      params: { text: 'private' },
    }));
    const events = await fetch(`${base}/events?after=0`).then(r => r.json());
    assert.equal(events.after, 1);
    assert.equal(events.events.length, 1);
    assert.equal(events.events[0].method, 'Runtime.executionContextCreated');
    assert.equal(events.events[0].params.context.id, 7);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('repeated status and work requests after a failed handshake cannot request approval again', async () => {
  const { cdp, sockets } = fixture(10);
  await assert.rejects(cdp.connect(), /timed out/);
  const server = http.createServer((req, res) => handle(cdp, req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (let poll = 0; poll < 20; poll++) {
      for (const path of ['/health', '/targets', '/tab', '/eval', '/cdp', '/events']) {
        const response = await fetch(`${base}${path}`, {
          method: ['/eval', '/cdp'].includes(path) ? 'POST' : 'GET',
        });
        assert.equal(response.status, path === '/health' ? 200 : 503);
        await response.arrayBuffer();
      }
    }
    assert.equal(sockets.length, 1, '100 polling/work requests must not create another socket');
    assert.equal(sockets[0].terminated, true);
    assert.equal(cdp.connecting, null);
    assert.equal(cdp.ws, null);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
