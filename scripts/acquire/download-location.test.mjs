import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import './client-policy.mjs';

const require = createRequire(import.meta.url);
const Redis = require('ioredis');
const { AcquisitionOwner } = require('../../src/backend/src/shared/acquisition-owner.ts');
const { downloadSettingsPath, resolveDownloadLocation, saveDownloadLocation } = require('../../src/backend/src/shared/acquisition/download-location.ts');

test('location maintenance lease protects both queues without consuming or resuming work', { timeout: 20000 }, async (t) => {
  const directory = mkdtempSync('/tmp/spooty-location-redis-');
  const socket = join(directory, 'redis.sock');
  const server = spawn('redis-server', ['--port', '0', '--unixsocket', socket, '--save', '', '--appendonly', 'no', '--dir', directory], { stdio: 'ignore' });
  const stopped = once(server, 'exit');
  const redis = new Redis({ path: socket, lazyConnect: true, retryStrategy: () => null, maxRetriesPerRequest: 0 });
  redis.on('error', () => {});
  const owner = new AcquisitionOwner({ get: () => undefined });
  owner.redis = redis;
  const dl = 'bull:track-download-processor', search = 'bull:track-search-processor';
  try {
    for (let i = 0; !existsSync(socket) && i < 100; i++) await new Promise(r => setTimeout(r, 25));
    await redis.connect();
    await t.test('unpaused but empty queues are safe', async () => {
      assert.equal(await owner.withIdleWebQueues(() => 'saved'), 'saved');
      assert.equal(await redis.exists('spooty:acquire:owner'), 0);
      assert.equal(await redis.hget(dl + ':meta', 'paused'), null);
    });
    await t.test('retained-profile activation still requires paused queues', async () => {
      await assert.rejects(owner.withPausedWebQueues(() => assert.fail('must not apply')), /Pause and drain/);
    });
    for (const prefix of [dl, search]) {
      for (const kind of ['active', 'wait', 'delayed', 'prioritized', 'waiting-children']) {
        await t.test(`refuses runnable ${prefix}/${kind}`, async () => {
          await redis.flushdb(); // This disposable Unix-socket Redis, never the live instance.
          if (['active', 'wait'].includes(kind)) await redis.rpush(`${prefix}:${kind}`, 'job');
          else await redis.zadd(`${prefix}:${kind}`, 1, 'job');
          await assert.rejects(owner.withIdleWebQueues(() => assert.fail('must not apply')), /not changed/);
          assert.equal(await redis.exists('spooty:acquire:owner'), 0);
        });
      }
    }
    await t.test('paused backlog is preserved and lease released on success or failure', async () => {
      await redis.flushdb();
      for (const prefix of [dl, search]) {
        await redis.hset(prefix + ':meta', 'paused', '1');
        await redis.rpush(prefix + ':paused', 'preserved-job');
        await redis.zadd(prefix + ':delayed', 1, 'delayed-job');
      }
      await owner.withIdleWebQueues(() => 'saved');
      await assert.rejects(owner.withIdleWebQueues(() => { throw new Error('disk error'); }), /disk error/);
      for (const prefix of [dl, search]) {
        assert.equal(await redis.hget(prefix + ':meta', 'paused'), '1');
        assert.deepEqual(await redis.lrange(prefix + ':paused', 0, -1), ['preserved-job']);
        assert.equal(await redis.zcard(prefix + ':delayed'), 1);
      }
      assert.equal(await redis.exists('spooty:acquire:owner'), 0);
    });
    await t.test('refuses another owner and does not replace or release its lease', async () => {
      await redis.set('spooty:acquire:owner', 'fixture-cli-owner');
      await assert.rejects(owner.withIdleWebQueues(() => assert.fail('must not apply')), /CLI owns/);
      assert.equal(await redis.get('spooty:acquire:owner'), 'fixture-cli-owner');
      await assert.rejects(owner.resumeWebQueues(), /CLI owns/);
      assert.equal(await redis.hget(dl + ':meta', 'paused'), '1');
      assert.equal(await redis.get('spooty:acquire:owner'), 'fixture-cli-owner');
    });
    await t.test('explicit resume preserves every job, active work and safety data, and is idempotent', async () => {
      await redis.del('spooty:acquire:owner'); // Disposable test Redis only.
      await redis.set('spooty:safety-fixture', 'cooldown-and-admissions');
      await redis.rpush(dl + ':active', 'draining-job');
      await owner.resumeWebQueues();
      for (const prefix of [dl, search]) {
        assert.equal(await redis.hget(prefix + ':meta', 'paused'), null);
        assert.deepEqual(await redis.lrange(prefix + ':wait', 0, -1), ['preserved-job']);
        assert.equal(await redis.zcard(prefix + ':delayed'), 1);
        assert.equal(await redis.zscore(prefix + ':marker', '0'), '0');
      }
      await owner.resumeWebQueues();
      assert.deepEqual(await redis.lrange(dl + ':active', 0, -1), ['draining-job']);
      assert.deepEqual(await redis.lrange(dl + ':wait', 0, -1), ['preserved-job']);
      assert.equal(await redis.get('spooty:safety-fixture'), 'cooldown-and-admissions');
    });
    await t.test('preflights both queues before a rename could overwrite work', async () => {
      for (const prefix of [dl, search]) await redis.hset(prefix + ':meta', 'paused', '1');
      await redis.rpush(dl + ':paused', 'conflicting-job');
      await assert.rejects(owner.resumeWebQueues(), /needs repair/);
      assert.equal(await redis.hget(search + ':meta', 'paused'), '1');
      assert.deepEqual(await redis.lrange(dl + ':paused', 0, -1), ['conflicting-job']);
      assert.deepEqual(await redis.lrange(dl + ':wait', 0, -1), ['preserved-job']);
    });
    await t.test('real Bull workers wake on explicit resume and complete preserved jobs', { timeout: 8000 }, async () => {
      await redis.flushdb(); // Disposable Unix-socket Redis, never live.
      const { Queue, Worker } = require('bullmq');
      const connection = { path: socket, maxRetriesPerRequest: null };
      const queues = [new Queue('track-search-processor', { connection }), new Queue('track-download-processor', { connection })];
      const workers = [];
      try {
        for (const queue of queues) {
          await queue.pause();
          await queue.add('fixture', { track: 'no network or media' });
        }
        const completions = queues.map(queue => {
          const worker = new Worker(queue.name, async () => 'verified-fixture', { connection });
          workers.push(worker);
          return once(worker, 'completed');
        });
        await Promise.all(workers.map(worker => worker.waitUntilReady()));
        assert.equal((await owner.webQueueSnapshot()).search.paused, true);
        await owner.resumeWebQueues();
        await Promise.all(completions);
        for (const queue of queues) assert.equal(await queue.getCompletedCount(), 1);
      } finally {
        await Promise.all(workers.map(worker => worker.close()));
        await Promise.all(queues.map(queue => queue.close()));
      }
    });
  } finally {
    redis.disconnect();
    server.kill('SIGTERM');
    await stopped;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('first-class CLI reads the same saved folder as the website without mutating media', { timeout: 15000 }, async () => {
  const directory = mkdtempSync('/tmp/spooty-location-cli-');
  const dbPath = join(directory, 'state', 'spooty.sqlite');
  const moved = join(directory, 'moved');
  const old = join(directory, 'old');
  const playlists = join(directory, 'playlists');
  let db;
  try {
    for (const path of [moved, old, playlists, join(directory, 'state')]) mkdirSync(path);
    execFileSync('/opt/homebrew/bin/ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '1', join(moved, 'Artist - Song.mp3')]);
    writeFileSync(join(playlists, 'fixture.json'), JSON.stringify({ name: 'Fixture', tracks: [{ artist: 'Artist', name: 'Song', durationMs: 1000 }] }));
    const sqlite = require('sqlite3');
    db = await new Promise((yes, no) => { const value = new sqlite.Database(dbPath, e => e ? no(e) : yes(value)); });
    await new Promise((yes, no) => db.run('CREATE TABLE track_entity (id INTEGER, artist TEXT, name TEXT, youtubeUrl TEXT, error TEXT)', e => e ? no(e) : yes()));
    saveDownloadLocation(downloadSettingsPath(dbPath), moved);
    assert.equal(resolveDownloadLocation(old, downloadSettingsPath(dbPath)).path, moved);
    const child = spawn(process.execPath, ['bin/spooty.mjs', 'plan'], { env: { ...process.env, DB_PATH: dbPath, DOWNLOADS_PATH: old, STATIC_PLAYLISTS_PATH: playlists, ACQUIRE_STATE_PATH: join(directory, 'state', 'acquire') }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', b => out += b); child.stderr.on('data', b => err += b);
    const [code] = await once(child, 'exit');
    assert.equal(code, 0, err);
    assert.equal(JSON.parse(out).saved, 1);
  } finally {
    if (db) await new Promise((yes, no) => db.close(e => e ? no(e) : yes()));
    rmSync(directory, { recursive: true, force: true });
  }
});
