/**
 * Local-only Codex configuration check. No browser or native-app connection.
 * Unlike test:cdp, requires the owner's installed Codex/plugin configuration.
 * Never dump full configuration: other MCP servers may contain credentials.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { inspectCodexChromeConnectors, inspectCodexBrowserRuntimes, inspectKnownStaleCodexSessions } from './codex-browser-processes.mjs';

test('known stale parent sessions cannot pass between browser-tool launches', () => {
  let record;
  try {
    record = readFileSync(join(homedir(), '.codex', 'browser-session-quarantine.json'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return; // No recorded incident on this machine.
    assert.fail('Cannot read the stale browser-session record');
  }
  let parsed;
  try { parsed = JSON.parse(record); }
  catch { assert.fail('Invalid stale browser-session record'); }
  assert.equal(parsed?.version, 1, 'Unsupported stale browser-session record version');
  assert.deepEqual(inspectKnownStaleCodexSessions(parsed.sessions), [],
    'Known stale Codex parent is still alive. Child cleanup is not a fix: obtain an authorized restart or a verified configuration reload. Do not reconnect Chrome or silently clear this record.');
});

function codexJson(args) {
  const result = spawnSync('codex', args, {
    encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.status, 0, 'Codex configuration inspection must succeed');
  return JSON.parse(result.stdout);
}

function server(name) {
  return codexJson(['mcp', 'get', name, '--json']);
}

test('older live Codex sessions have not kept or relaunched direct Chrome connectors', () => {
  assert.deepEqual(inspectCodexChromeConnectors(), [],
    'Saved settings are not enough: a live Codex session still owns a direct Chrome MCP. Resolve the listed PIDs; never restart unrelated agents or request a Chrome connection.');
});

test('direct Chrome connector remains disabled and cannot launch', () => {
  const config = server('claude-in-chrome');
  assert.equal(config.enabled, false);
  assert.equal(config.transport.command, '/usr/bin/false');
  assert.deepEqual(config.transport.args, []);
});

test('older live Codex REPLs have no browser service loaded', () => {
  assert.deepEqual(inspectCodexBrowserRuntimes(), [],
    'A live Codex tool runtime still has browser access despite saved settings. Resolve only stale tool runtimes, preserving parent agents and applications. Browser capability is not proof of a specific prompt.');
});

test('Chrome and Browser plugins remain disabled for future sessions', () => {
  const plugins = codexJson(['plugin', 'list', '--json']).installed;
  assert.ok(Array.isArray(plugins));
  for (const id of ['chrome@openai-bundled', 'browser@openai-bundled']) {
    const plugin = plugins.find(item => item.pluginId === id);
    assert.ok(!plugin || plugin.enabled === false, `${id} must not be enabled`);
  }
});

test('generic Node REPL has no alternate browser service', () => {
  const config = server('node_repl');
  if (!config.enabled) return;
  const env = config.transport.env;
  assert.equal(env.BROWSER_USE_AVAILABLE_BACKENDS, '');
  const services = JSON.parse(env.NODE_REPL_TRUSTED_SERVICES);
  assert.equal(services.browser, undefined);
  assert.equal(services.sky, '@oai/sky/service', 'Preserve native app control');
});

test('unified runtime actually launches in native-only mode', () => {
  const config = server('cua_repl');
  assert.equal(config.enabled, true, 'Preserve native app control');
  const transport = config.transport;
  assert.equal(transport.env.CUA_REPL_ENABLED_SURFACES, 'computer');
  assert.equal(transport.env.BROWSER_USE_AVAILABLE_BACKENDS, '');
  // Exercise the installed launcher with /usr/bin/env as a harmless stand-in
  // for the native runtime. No MCP, browser, CDP or native service is started.
  const result = spawnSync(transport.command, transport.args, {
    env: {
      ...transport.env,
      PATH: process.env.PATH,
      CUA_REPL_NODE_REPL_PATH: '/usr/bin/env',
    },
    encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, 'Installed native-only launcher must work');
  const value = name => result.stdout.split('\n')
    .find(line => line.startsWith(`${name}=`))?.slice(name.length + 1);
  assert.deepEqual(JSON.parse(value('NODE_REPL_TRUSTED_SERVICES')), {
    sky: '@oai/sky/service',
  });
  const overrides = JSON.parse(value('NODE_REPL_TOOL_OVERRIDES'));
  assert.match(overrides.tools.js.description, /Browser APIs are disabled/);
  assert.doesNotMatch(overrides.tools.js.description, /Native computer APIs are disabled/);
});
