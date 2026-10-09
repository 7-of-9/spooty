import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { byteRange } from './worker.mjs';

test('byte ranges support player seeks and suffix requests without overruns', () => {
  assert.deepEqual(byteRange('bytes=3-7', 10), { offset: 3, length: 5 });
  assert.deepEqual(byteRange('bytes=3-', 10), { offset: 3, length: 7 });
  assert.deepEqual(byteRange('bytes=-3', 10), { offset: 7, length: 3 });
  assert.deepEqual(byteRange('bytes=0-99', 10), { offset: 0, length: 10 });
  for (const range of ['bytes=10-', 'bytes=7-3', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-4', 'bytes=9007199254740992-']) assert.equal(byteRange(range, 10), false);
});

test('every administrative write requires the secret even when storage is absent', async () => {
  for (const path of ['object', 'uploads/create', 'uploads/part', 'uploads/complete', 'uploads/abort']) {
    const r = await worker.fetch(new Request('https://dj.test/admin/' + path, { method: 'PUT', body: 'x' }), {});
    assert.equal(r.status, 401);
  }
});

function bucket(filename = 'A song.mp3') {
  const data = new TextEncoder().encode('0123456789');
  const info = { size: 10, httpEtag: '"fixture"', customMetadata: { filename, sha256: 'fixture-hash' }, writeHttpMetadata(h) { h.set('Content-Type', 'audio/mpeg'); } };
  return { head: async () => info, get: async (key, options) => ({ ...info, body: options?.range ? data.slice(options.range.offset, options.range.offset + options.range.length) : data }) };
}

test('public audio serves ranged bytes, correct headers, and full download', async () => {
  const env = { BUCKET: bucket() };
  const r = await worker.fetch(new Request('https://dj.test/media/audio%2Fsong.mp3', { headers: { Range: 'bytes=3-6' } }), env);
  assert.equal(r.status, 206); assert.equal(await r.text(), '3456');
  assert.equal(r.headers.get('content-range'), 'bytes 3-6/10');
  assert.equal(r.headers.get('content-length'), '4');
  assert.equal(r.headers.get('content-type'), 'audio/mpeg');
  assert.equal(r.headers.get('x-file-sha256'), 'fixture-hash');
  const full = await worker.fetch(new Request('https://dj.test/media/audio%2Fsong.mp3?download=1'), env);
  assert.equal(await full.text(), '0123456789');
  assert.match(full.headers.get('content-disposition'), /attachment.*A%20song.mp3/);
});

test('download filenames preserve punctuation through standards-compliant encoding', async () => {
  const filename = "The O'Jays - It's Love (Trippin')!.mp3";
  const r = await worker.fetch(new Request('https://dj.test/media/audio%2Fsong.mp3?download=1'), { BUCKET: bucket(filename) });
  const encoded = r.headers.get('content-disposition').split("UTF-8''")[1];
  assert.equal(decodeURIComponent(encoded), filename);
  assert.doesNotMatch(encoded, /[!'()*]/);
});

test('handoff metadata stays fresh when pending renders become ready', async () => {
  for (const key of ['catalog/mixes.json', 'mixes/a.json', 'mixes/a.cue', 'mixes/a-order.csv', 'exports/tracks.csv', 'exports/playlist.m3u8']) {
    const r = await worker.fetch(new Request('https://dj.test/media/' + encodeURIComponent(key), { method: 'HEAD' }), { BUCKET: bucket() });
    assert.equal(r.headers.get('cache-control'), 'no-store', key);
  }
  for (const key of ['audio/a.mp3', 'mixes/a.mp3', 'exports/playlist.zip']) {
    const r = await worker.fetch(new Request('https://dj.test/media/' + encodeURIComponent(key), { method: 'HEAD' }), { BUCKET: bucket() });
    assert.equal(r.headers.get('cache-control'), 'public, max-age=3600', key);
  }
});

test('HEAD, stale If-Range, not-modified and unsatisfiable ranges behave correctly', async () => {
  const url = 'https://dj.test/media/audio%2Fsong.mp3', env = { BUCKET: bucket() };
  const head = await worker.fetch(new Request(url, { method: 'HEAD' }), env);
  assert.equal(head.headers.get('content-length'), '10'); assert.equal(await head.text(), '');
  const stale = await worker.fetch(new Request(url, { headers: { Range: 'bytes=3-6', 'If-Range': '"old"' } }), env);
  assert.equal(stale.status, 200); assert.equal(await stale.text(), '0123456789');
  const cached = await worker.fetch(new Request(url, { headers: { 'If-None-Match': '"fixture"' } }), env);
  assert.equal(cached.status, 304);
  const bad = await worker.fetch(new Request(url, { headers: { Range: 'bytes=10-' } }), env);
  assert.equal(bad.status, 416); assert.equal(bad.headers.get('content-range'), 'bytes */10');
});

test('public requests cannot reach private paths or write objects', async () => {
  const env = { BUCKET: { head() { throw Error('Must not query storage'); } } };
  for (const key of ['private/token', 'audio/../secret', 'audio//secret', 'audio/line\nfeed']) {
    const r = await worker.fetch(new Request('https://dj.test/media/' + encodeURIComponent(key)), env);
    assert.equal(r.status, 404);
  }
  assert.equal((await worker.fetch(new Request('https://dj.test/media/audio%2Fx', { method: 'POST' }), env)).status, 405);
});

test('multipart completion preserves required ordered part evidence', async () => {
  let completed = false;
  const env = { UPLOAD_TOKEN: 'test-only', BUCKET: { resumeMultipartUpload() { return { complete() { completed = true; } }; } } };
  const r = await worker.fetch(new Request('https://dj.test/admin/uploads/complete', { method: 'POST', headers: { Authorization: 'Bearer test-only', 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'audio/x', uploadId: 'fixture', parts: [{ partNumber: 2, etag: 'wrong-order' }] }) }), env);
  assert.equal(r.status, 400); assert.equal(completed, false);
});

test('timeline catalogs use distinct storage keys without changing playlist 50', async () => {
  const seen=[];
  const store=bucket();
  const env={BUCKET:{...store,head:async key=>{seen.push(key);return store.head(key);}}};
  for(const path of ['/manifest.json','/mixes.json','/life-timeline-manifest.json','/life-timeline-mixes.json']) {
    const r=await worker.fetch(new Request('https://dj.test'+path),env);
    assert.equal(r.status,200);
    assert.equal(r.headers.get('cache-control'),'no-store');
  }
  assert.deepEqual(seen,['catalog/manifest.json','catalog/mixes.json','catalog/life-timeline-manifest.json','catalog/life-timeline-mixes.json']);
});
