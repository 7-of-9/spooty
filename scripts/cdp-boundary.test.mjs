import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', 'dist', '.angular'].includes(entry.name)) return [];
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(mjs|cjs|js|ts)$/.test(entry.name) && !/\.(spec|test)\./.test(entry.name) ? [full] : [];
  });
}

test('the singleton is the only application code allowed to open Chrome CDP', () => {
  const direct = /DevToolsActivePort|new\s+(?:[\w$.]*\.)?WebSocket\s*\(|connectOverCDP\s*\(|webSocketDebuggerUrl|browserWSEndpoint|--remote-debugging-(?:port|pipe)|--autoConnect|(?:from\s*|require\s*\(\s*)['"](?:ws|chrome-remote-interface|puppeteer(?:-core)?|playwright(?:-core)?)(?:\/[^'"]*)?['"]/;
  const violations = ['scripts', 'src/backend/src', 'src/frontend/src', 'bin'].flatMap(dir => sources(join(root, dir)))
    .filter(file => relative(root, file) !== 'scripts/cdp-keepalive.mjs')
    .filter(file => direct.test(readFileSync(file, 'utf8')))
    .map(file => relative(root, file));
  assert.deepEqual(violations, [], 'Route browser work through the existing HTTP bridge; never open another CDP connection');
});

for (const name of ['find-scroll', 'scrape-playlist-tracks', 'resync-playlist-page', 'audit-resync-one-tab', 'attach-main-chrome']) {
  test(`${name} cannot revive a legacy Chrome connection`, () => {
    const file = join(root, 'scripts', `${name}.mjs`);
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /\b(?:import|require|fetch|eval)\b\s*(?:\(|[{*'"])/);
    assert.doesNotMatch(source, /(?:https?|wss?):\/\//);
    const result = spawnSync(process.execPath, [file, 'fixture-playlist'], {
      cwd: root, encoding: 'utf8', timeout: 3000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /retired/);
    assert.match(result.stderr, /No Chrome connection was requested/);
  });
}
