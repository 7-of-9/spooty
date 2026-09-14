import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as tcpServer, connect } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { database } from './catalog.mjs';
const require = createRequire(import.meta.url);

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = tcpServer();
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
async function launch(args, env) {
  const child = spawn(process.execPath, [resolve('bin/spooty.mjs'), ...args], { env,
    stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
  const [code] = await once(child, 'close');
  clearTimeout(timer);
  return { code, stdout, stderr };
}

test('real CLI plan/run/control against isolated Redis+backend preserves queues and skips saved/exhausted tracks without YouTube',
  { timeout: 60000, skip: !existsSync('/opt/homebrew/bin/redis-server') }, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'spooty-cli-integration-'));
    const state = join(directory, 'state'), playlists = join(directory, 'playlists'), downloads = join(directory, 'downloads');
    for (const path of [state, playlists, downloads, join(downloads, 'Fixture')]) mkdirSync(path, { recursive: true });
    let redisChild, redis, server;
    t.after(async () => {
      redis?.disconnect();
      if (server?.listening) await new Promise(resolve => server.close(resolve));
      if (redisChild && redisChild.exitCode === null) {
        const closed = once(redisChild, 'close'); redisChild.kill('SIGTERM'); await closed;
      }
      rmSync(directory, { recursive: true, force: true });
    });
    const dbPath = join(directory, 'library.sqlite');
    const db = database(dbPath);
    await db.run('CREATE TABLE track_entity(id TEXT,artist TEXT,name TEXT,youtubeUrl TEXT,error TEXT,status INTEGER)');
    await db.run("INSERT INTO track_entity VALUES('saved','Test','Saved',NULL,NULL,4),('miss','Test','Missing',NULL,'No YouTube result',5),('none','Test','No candidate',NULL,NULL,6)");
    await db.close();
    writeFileSync(join(playlists, 'fixture.json'), JSON.stringify({ name: 'Fixture', tracks: ['Saved', 'Missing', 'No candidate'].map(name => ({ artist: 'Test', name })) }));
    // A saved-file sentinel tests existence-based reuse, not codec certification.
    writeFileSync(join(downloads, 'Fixture', 'Test - Saved.mp3'), 'saved-file-sentinel');
    const journal = database(join(state, 'work.sqlite'));
    await journal.run('CREATE TABLE work(key TEXT PRIMARY KEY,url TEXT,state TEXT,attempts INTEGER,retry_at INTEGER,error TEXT,network_attempts INTEGER,search_limit INTEGER)');
    await journal.run("INSERT INTO work VALUES('test - no candidate',NULL,'no-candidate',0,0,NULL,0,10)");
    await journal.close();
    const port = await freePort();
    redisChild = spawn('/opt/homebrew/bin/redis-server', ['--bind', '127.0.0.1', '--port', String(port), '--save', '', '--appendonly', 'no', '--dir', directory], { stdio: 'ignore' });
    const deadline = Date.now() + 5000;
    while (!(await reachable(port))) {
      if (Date.now() > deadline) throw new Error('Isolated Redis failed to start');
      await pause(25);
    }
    const Redis = require('ioredis');
    redis = new Redis({ host: '127.0.0.1', port, maxRetriesPerRequest: 0, retryStrategy: () => null });
    const { Queue } = require('bullmq');
    const queues = ['track-download-processor', 'track-search-processor'].map(name => new Queue(name, { connection: { host: '127.0.0.1', port } }));
    for (const q of queues) { await q.pause(); await q.add('preserved', { sentinel: true }); await q.close(); }
    let apiCalls = 0;
    server = createServer((req, res) => {
      apiCalls++;
      req.resume();
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ downloadConc: 1, searchConc: 1, maxPerWindow: 8, windowMs: 600000, downloadStarts: [], coolUntil: 0, lastBotAt: 0, autoStep: false }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const env = { ...process.env, ACQUIRE_STATE_PATH: state, STATIC_PLAYLISTS_PATH: playlists, DOWNLOADS_PATH: downloads,
      DB_PATH: dbPath, REDIS_HOST: '127.0.0.1', REDIS_PORT: String(port),
      ACQUIRE_API_URL: `http://127.0.0.1:${server.address().port}/pace`,
      SPOTIFY_TRACK_METADATA_PATH: join(directory, 'metadata'), COOKIES_PATH: join(directory, 'absent-cookies') };
    const plan = await launch(['plan'], env);
    assert.equal(plan.code, 0, plan.stderr);
    assert.deepEqual(JSON.parse(plan.stdout).resume, { saved: 1, missing: 1, noCandidate: 1, exhaustedErrors: 0, ready: 0, pending: 0, actionable: 0, fastSkipped: 3, notSaved: 2 });
    assert.equal(apiCalls, 0);
    const deeper = await launch(['plan', '--max-searches', '20'], env);
    assert.equal(JSON.parse(deeper.stdout).resume.actionable, 1);
    const run = await launch(['run', '--limit', '1', '--batch-size', '1', '--max-searches', '10', '--network-retries', '0'], env);
    assert.equal(run.code, 0, run.stderr);
    const reports = run.stdout.trim().split('\n').map(line => JSON.parse(line));
    const final = reports.at(-1);
    assert.equal(final.verifiedNewMp3, 0);
    assert.equal(final.actionableUnique, 0);
    assert.equal(final.phase, 'finished-with-exceptions');
    assert.equal(final.eta, null);
    assert.equal(final.totalUnique, 3);
    assert.equal(final.savedUnique, 1);
    assert.equal(final.confirmedMissing, 1);
    const events = readdirSync(state).filter(file => file.startsWith('events-')).flatMap(file => readFileSync(join(state, file), 'utf8').trim().split('\n').map(JSON.parse));
    assert.equal(events.filter(event => event.type === 'process_start').length, 0);
    assert.equal(await redis.exists('spooty:acquire:owner'), 0);
    for (const name of ['track-download-processor', 'track-search-processor']) {
      assert.equal(await redis.hget(`bull:${name}:meta`, 'paused'), '1');
      assert.equal(await redis.llen(`bull:${name}:paused`), 1);
      assert.equal(await redis.llen(`bull:${name}:active`), 0);
    }
    assert.equal(JSON.parse(readFileSync(join(state, 'handoff.json'), 'utf8')).phase, 'returned');
    assert.equal(readFileSync(join(downloads, 'Fixture', 'Test - Saved.mp3'), 'utf8'), 'saved-file-sentinel');
    const controlBefore = readFileSync(join(state, 'control.json'), 'utf8');
    for (const args of [['stop'], ['pace', '--window', '16'], ['inspect-review']]) {
      const result = await launch(args, env);
      assert.equal(result.code, 1, result.stderr);
      assert.match(JSON.parse(result.stderr).error, /No matching live CLI owner/);
      assert.equal(readFileSync(join(state, 'control.json'), 'utf8'), controlBefore);
    }
    const status = await launch(['status'], env);
    assert.equal(status.code, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).eta, null);
    assert.equal(JSON.parse(status.stdout).liveOwnerVerified, false);
    // A fake owner lease only in this isolated Redis exercises real control
    // serialization. No acquisition process or YouTube request is started.
    const live = { ...JSON.parse(status.stdout), pid: process.pid, runId: 'control-test' };
    writeFileSync(join(state, 'status.json'), JSON.stringify(live));
    await redis.set('spooty:acquire:owner', `${process.pid}-isolated-test-owner`, 'EX', 20);
    for (const value of [192, 216, 240]) {
      const pace = await launch(['pace', '--window', String(value)], env);
      assert.equal(pace.code, 0, pace.stderr);
      assert.deepEqual(JSON.parse(readFileSync(join(state, 'control.json'), 'utf8')).pace, { maxPerWindow: value });
    }
    assert.equal((await launch(['stop'], env)).code, 0);
    let control = JSON.parse(readFileSync(join(state, 'control.json'), 'utf8'));
    assert.equal(control.stop, true);
    assert.equal(control.pace, undefined);
    assert.equal(control.targetRunId, 'control-test');
    assert.equal((await launch(['inspect-review'], env)).code, 0);
    control = JSON.parse(readFileSync(join(state, 'control.json'), 'utf8'));
    assert.equal(control.stop, true);
    assert.equal(control.pace, undefined);
    assert.equal(control.updatedAt, undefined);
    assert.ok(control.inspectReviewAt > 0);
    writeFileSync(join(state, 'review-work.json'), '{"requests":[]}');
    assert.equal((await launch(['review-work'], env)).code, 0);
    control = JSON.parse(readFileSync(join(state, 'control.json'), 'utf8'));
    assert.equal(control.stop, true);
    assert.ok(control.reviewWorkAt > 0);
    await redis.del('spooty:acquire:owner');
  });
