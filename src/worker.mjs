import HTML from './page.mjs';

const security = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...security, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const validKey = key => typeof key === 'string' && key.length < 900 && !/[\x00-\x1f\\]/.test(key) && !key.split('/').some(p => !p || p === '.' || p === '..') && /^(audio|mixes|exports|catalog)\//.test(key);
const metadata = body => ({ httpMetadata: { contentType: body.contentType || 'application/octet-stream' }, customMetadata: { sha256: String(body.sha256 || ''), filename: String(body.filename || '').replace(/[\r\n]/g, ''), bytes: String(body.bytes || '') } });

export function byteRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m || (!m[1] && !m[2])) return false;
  let start, end;
  if (!m[1]) { const count = Number(m[2]); if (!Number.isSafeInteger(count) || count <= 0) return false; start = Math.max(0, size - count); end = size - 1; }
  else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return false;
  return { offset: start, length: end - start + 1 };
}

async function media(request, env, key, download = false) {
  if (!validKey(key)) return json({ error: 'File not found' }, 404);
  const head = await env.BUCKET.head(key);
  if (!head) return json({ error: 'This file is not available yet.' }, 404);
  const headers = new Headers(security);
  head.writeHttpMetadata(headers);
  headers.set('ETag', head.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', key.startsWith('catalog/') ? 'no-store' : 'public, max-age=3600');
  if (head.customMetadata?.sha256) headers.set('X-File-SHA256', head.customMetadata.sha256);
  if (download) headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(head.customMetadata?.filename || key.split('/').pop())}`);
  if (request.headers.get('if-none-match') === head.httpEtag) return new Response(null, { status: 304, headers });
  const rangeHeader = request.headers.get('range');
  const ifRange = request.headers.get('if-range');
  const range = request.method === 'HEAD' || (ifRange && ifRange !== head.httpEtag) ? null : byteRange(rangeHeader, head.size);
  if (range === false) { headers.set('Content-Range', `bytes */${head.size}`); return new Response(null, { status: 416, headers }); }
  headers.set('Content-Length', String(range ? range.length : head.size));
  if (range) headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`);
  if (request.method === 'HEAD') return new Response(null, { headers });
  const object = await env.BUCKET.get(key, range ? { range } : undefined);
  if (!object) return json({ error: 'File unavailable; please reload.' }, 404);
  return new Response(object.body, { status: range ? 206 : 200, headers });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/admin/')) {
        if (!env.UPLOAD_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.UPLOAD_TOKEN}`) return json({ error: 'Unauthorized' }, 401);
        if (!env.BUCKET) return json({ error: 'Storage unavailable' }, 503);
        if (url.pathname === '/admin/object' && request.method === 'PUT') {
          const key = url.searchParams.get('key');
          if (!validKey(key)) return json({ error: 'Invalid key' }, 400);
          const length = Number(request.headers.get('content-length'));
          if (!length || length > 32 * 1024 * 1024) return json({ error: 'Use multipart for large objects' }, 413);
          await env.BUCKET.put(key, request.body, metadata({ contentType: request.headers.get('content-type'), sha256: request.headers.get('x-file-sha256'), filename: decodeURIComponent(request.headers.get('x-file-name') || ''), bytes: length }));
          return json({ ok: true, key });
        }
        if (url.pathname === '/admin/uploads/part' && request.method === 'PUT') {
          const key = url.searchParams.get('key'), id = url.searchParams.get('uploadId'), part = Number(url.searchParams.get('partNumber'));
          if (!validKey(key) || !id || !Number.isInteger(part) || part < 1 || part > 10000) return json({ error: 'Invalid part' }, 400);
          const result = await env.BUCKET.resumeMultipartUpload(key, id).uploadPart(part, request.body);
          return json(result);
        }
        if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
        const body = await request.json();
        if (!validKey(body.key)) return json({ error: 'Invalid key' }, 400);
        if (url.pathname === '/admin/uploads/create') {
          const result = await env.BUCKET.createMultipartUpload(body.key, metadata(body));
          return json({ key: result.key, uploadId: result.uploadId });
        }
        if (!body.uploadId) return json({ error: 'Upload ID required' }, 400);
        const upload = env.BUCKET.resumeMultipartUpload(body.key, body.uploadId);
        if (url.pathname === '/admin/uploads/complete') {
          if (!Array.isArray(body.parts) || !body.parts.length || body.parts.some((p, i) => p.partNumber !== i + 1 || typeof p.etag !== 'string')) return json({ error: 'Invalid ordered parts' }, 400);
          const result = await upload.complete(body.parts);
          return json({ ok: true, key: body.key, size: result.size, etag: result.httpEtag });
        }
        if (url.pathname === '/admin/uploads/abort') { await upload.abort(); return json({ ok: true }); }
        return json({ error: 'Not found' }, 404);
      }
      if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
      if (url.pathname === '/') return new Response(request.method === 'HEAD' ? null : HTML, { headers: { ...security, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'" } });
      if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: security });
      if (!env.BUCKET) return json({ error: 'The download library is temporarily unavailable.' }, 503);
      if (url.pathname === '/manifest.json') return media(request, env, 'catalog/manifest.json');
      if (url.pathname === '/mixes.json') return media(request, env, 'catalog/mixes.json');
      if (url.pathname.startsWith('/media/')) return media(request, env, decodeURIComponent(url.pathname.slice(7)), url.searchParams.get('download') === '1');
      return json({ error: 'Not found' }, 404);
    } catch (error) {
      console.error('DJ Room request failed:', error instanceof Error ? error.name : 'storage error');
      return json({ error: 'The library is temporarily unavailable. Please try again.' }, 503);
    }
  }
};
