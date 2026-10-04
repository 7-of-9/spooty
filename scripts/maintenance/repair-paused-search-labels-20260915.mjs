// One-shot repair for the 21 browser-verification admissions made before the
// Waiting-status fix. It never adds/removes jobs, resumes queues, or touches media.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
if (!process.argv.includes('--apply')) {
  console.error('Historical one-shot repair. Review the pinned identities before using --apply.');
  process.exit(1);
}
const require = createRequire('/Users/dom/src/spooty/package.json');
const Redis = require('ioredis');
const sqlite = require('sqlite3');
const redis = new Redis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 0 });
const ids = [5560,5565,5572,5573,5575,5576,5578,5580,5581,5582,5583,5584,5585,5588,5589,5590,5591,5592,5594,5595,5596];
const token = `status-repair-${randomUUID()}`;
let db, owned = false, transaction = false;
const query = (sql, values=[]) => new Promise((ok, fail) => db.all(sql, values, (e, rows) => e ? fail(e) : ok(rows)));
try {
  owned = (await redis.set('spooty:acquire:owner', token, 'PX', 60000, 'NX')) === 'OK';
  if (!owned) throw Error('Acquisition owner present; no changes');
  for (const queue of ['track-search-processor', 'track-download-processor']) {
    if (await redis.hget(`bull:${queue}:meta`, 'paused') !== '1' || Number(await redis.llen(`bull:${queue}:active`)) !== 0)
      throw Error('Both queues must be paused and drained; no changes');
  }
  const admitted = await redis.lrange('bull:track-search-processor:paused', 0, 20);
  const queued = new Map();
  for (const job of admitted) {
    const item = JSON.parse(await redis.hget(`bull:track-search-processor:${job}`, 'data'));
    if (!ids.includes(item.id) || queued.has(item.id)) throw Error('Unexpected admission set; no changes');
    queued.set(item.id, item);
  }
  if (queued.size !== ids.length) throw Error('Admission coverage incomplete; no changes');
  db = await new Promise((ok, fail) => {
    const handle = new sqlite.Database('/Users/dom/src/spooty/data/spooty.sqlite', sqlite.OPEN_READWRITE,
      e => e ? fail(e) : ok(handle));
  });
  await query('BEGIN IMMEDIATE'); transaction = true;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await query(`SELECT t.id,t.artist,t.name,t.status,p.spotifyUrl FROM track_entity t JOIN playlist_entity p ON p.id=t.playlistId WHERE t.id IN (${placeholders})`, ids);
  if (rows.length !== ids.length || rows.some(r => r.status !== 0 || r.spotifyUrl !== 'https://open.spotify.com/playlist/04Mj5fSvHOHsO01sdTfDSd' || r.artist !== queued.get(r.id)?.artist || r.name !== queued.get(r.id)?.name))
    throw Error('Track identity/state changed; no changes');
  if (await redis.get('spooty:acquire:owner') !== token) throw Error('Maintenance lease lost; no changes');
  await query(`UPDATE track_entity SET status=2 WHERE status=0 AND id IN (${placeholders})`, ids);
  const result = await query('SELECT changes() AS changed');
  if (result[0].changed !== ids.length) throw Error('Unexpected update count; rolling back');
  await query('COMMIT'); transaction = false;
  console.log(JSON.stringify({ changed: ids.length, state: 'Waiting', jobsChanged: 0, queuesResumed: 0, mediaChanged: 0 }));
} finally {
  if (transaction) await query('ROLLBACK');
  if (db) await new Promise((ok, fail) => db.close(e => e ? fail(e) : ok()));
  if (owned) await redis.eval("if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0", 1, 'spooty:acquire:owner', token);
  redis.disconnect();
}
