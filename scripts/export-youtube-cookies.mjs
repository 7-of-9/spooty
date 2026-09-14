#!/usr/bin/env node
// User-authorized, YouTube-only export through the already-open Chrome bridge.
// Never print a CDP response, cookie name/value, or raw upstream error.
import { chmodSync, existsSync, lstatSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'cookies.txt');
const temporary = join(root, 'data/acquire', `youtube-cookies-${randomUUID()}.tmp`);

async function bridge(route, body) {
  const response = await fetch(`http://127.0.0.1:17331${route}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(35000),
  });
  if (!response.ok) throw new Error('bridge');
  const value = await response.json();
  if (value.error) throw new Error('bridge');
  return value;
}

try {
  const health = await bridge('/health');
  if (!health.connected) throw new Error('bridge');
  const tab = await bridge('/tab');
  if (!tab.sessionId) throw new Error('session');
  const response = await bridge('/cdp', {
    method: 'Network.getCookies',
    params: { urls: ['https://www.youtube.com/', 'https://youtube.com/', 'https://music.youtube.com/'] },
    sessionId: tab.sessionId,
  });
  const now = Date.now() / 1000;
  const cookies = (response.result?.cookies || []).filter((cookie) =>
    /(^|\.)youtube\.com$/i.test(cookie.domain || '') &&
    !cookie.partitionKey &&
    (cookie.session || !(cookie.expires > 0) || cookie.expires > now),
  );
  const hasAuth = cookies.some((cookie) =>
    /^(?:SID|SAPISID|__Secure-[13]PSID|__Secure-[13]PAPISID)$/.test(cookie.name) && cookie.value,
  );
  if (!cookies.length || !hasAuth) throw new Error('no-auth');
  const rows = cookies.map((cookie) => {
    const fields = [
      `${cookie.httpOnly ? '#HttpOnly_' : ''}${cookie.domain}`,
      cookie.domain.startsWith('.') ? 'TRUE' : 'FALSE',
      cookie.path || '/', cookie.secure ? 'TRUE' : 'FALSE',
      String(!cookie.session && cookie.expires > 0 ? Math.floor(cookie.expires) : 0),
      cookie.name, cookie.value,
    ];
    if (fields.some((field) => typeof field !== 'string' || /[\t\r\n]/.test(field)))
      throw new Error('invalid-cookie');
    return fields.join('\t');
  });
  // The verified configured file was empty. Do not overwrite a new user file
  // or redirect this credential export through an unexpected symbolic link.
  if (existsSync(target)) {
    const previous = lstatSync(target);
    if (!previous.isFile() || previous.size !== 0) throw new Error('target-changed');
  }
  writeFileSync(temporary, '# Netscape HTTP Cookie File\n# YouTube-only local export\n' + rows.join('\n') + '\n', { mode: 0o600, flag: 'wx' });
  chmodSync(temporary, 0o600);
  renameSync(temporary, target);
  const saved = statSync(target);
  console.log(JSON.stringify({ exported: true, cookieCount: cookies.length, youtubeOnly: true, authCookiesPresent: true, bytes: saved.size, mode: (saved.mode & 0o777).toString(8), path: target, valuesPrinted: false }));
} catch (error) {
  if (existsSync(temporary)) unlinkSync(temporary);
  const known = ['bridge', 'session', 'no-auth', 'invalid-cookie', 'target-changed'];
  console.error(JSON.stringify({ exported: false, reason: known.includes(error.message) ? error.message : 'local-export-failed', valuesPrinted: false }));
  process.exitCode = 1;
}
