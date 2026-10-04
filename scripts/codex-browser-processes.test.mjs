import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codexChromeConnectors, inspectCodexChromeConnectors, codexBrowserRuntimes, inspectCodexBrowserRuntimes, knownStaleCodexSessions, inspectKnownStaleCodexSessions } from './codex-browser-processes.mjs';

const stale = [{ pid: 100, startedAtUtc: 'Mon Sep 14 05:46:17 2026' }];

test('known stale parent remains flagged even when it has no browser children', () => {
  assert.deepEqual(knownStaleCodexSessions('100 1 Mon Sep 14 05:46:17 2026 codex', stale), [
    { pid: 100, parentPid: 1, startedAtUtc: stale[0].startedAtUtc },
  ]);
});

test('exited, replaced, or reused PIDs do not falsely flag a new session', () => {
  for (const snapshot of ['', '100 1 Tue Sep 15 05:46:17 2026 codex',
    '100 1 Mon Sep 14 05:46:17 2026 unrelated', '101 1 Mon Sep 14 05:46:17 2026 codex']) {
    assert.deepEqual(knownStaleCodexSessions(snapshot, stale), []);
  }
});

test('stale session inspection uses stable UTC identity and never requests arguments', () => {
  const result = inspectKnownStaleCodexSessions(stale, (command, args, options) => {
    assert.equal(command, '/bin/ps');
    assert.deepEqual(args, ['-p', '100', '-o', 'pid=,ppid=,lstart=,comm=']);
    assert.equal(options.env.TZ, 'UTC');
    assert.equal(options.env.LC_ALL, 'C');
    return { status: 0, stderr: '', stdout: '100 1 Mon Sep 14 05:46:17 2026 /private/application/codex' };
  });
  assert.deepEqual(result, [{ pid: 100, parentPid: 1, startedAtUtc: stale[0].startedAtUtc }]);
  assert.doesNotMatch(JSON.stringify(result), /private|application/);
});

test('stale session record and inspection failures fail closed without private output', () => {
  for (const invalid of [undefined, {}, [{ pid: '100', startedAtUtc: stale[0].startedAtUtc }],
    [{ pid: 100, startedAtUtc: 'private bad date' }]]) {
    assert.throws(() => inspectKnownStaleCodexSessions(invalid, () => assert.fail('must not inspect')),
      /^Error: Invalid stale browser-session record$/);
  }
  assert.throws(() => knownStaleCodexSessions('private unexpected output', stale),
    /^Error: Read-only stale session identity inspection failed$/);
  assert.throws(() => inspectKnownStaleCodexSessions(stale, () => ({ status: 2, stderr: 'private error' })),
    /^Error: Read-only stale session identity inspection failed$/);
});

test('stale session checks allow an empty registry or a process that has exited', () => {
  assert.deepEqual(inspectKnownStaleCodexSessions([], () => assert.fail('unnecessary inspection')), []);
  assert.deepEqual(inspectKnownStaleCodexSessions(stale, () => ({ status: 1, stdout: '', stderr: '' })), []);
});

test('finds stale direct Chrome connectors below a running Codex session', () => {
  assert.deepEqual(codexChromeConnectors(`
    100 1 /Applications/ChatGPT.app/Contents/Resources/codex
    101 100 npm exec chrome-devtools-mcp@latest --autoConnect
    102 101 chrome-devtools-mcp
    103 102 /usr/local/bin/node
  `), [
    { pid: 101, parentPid: 100, codexPid: 100 },
    { pid: 102, parentPid: 101, codexPid: 100 },
  ]);
});

test('walks intermediaries and does not expose process argument contents', () => {
  const result = codexChromeConnectors(`
    10 1 codex
    11 10 /bin/sh
    12 11 /cache/node_modules/.bin/chrome-devtools-mcp --private-example do-not-report
  `);
  assert.deepEqual(result, [{ pid: 12, parentPid: 11, codexPid: 10 }]);
  assert.doesNotMatch(JSON.stringify(result), /private|do-not-report/);
});

test('does not attribute unrelated agents, the singleton or native control to Codex Chrome', () => {
  assert.deepEqual(codexChromeConnectors(`
    10 1 codex
    11 10 /usr/local/bin/node
    12 10 /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl
    20 1 grok
    21 20 npm exec chrome-devtools-mcp@latest
    22 21 chrome-devtools-mcp
    30 1 /usr/local/bin/node
  `), []);
});

test('handles missing parents, malformed rows and ancestry cycles without guessing ownership', () => {
  assert.deepEqual(codexChromeConnectors(`
    not a process row
    10 99 chrome-devtools-mcp
    20 21 chrome-devtools-mcp
    21 20 /bin/sh
  `), []);
});

test('finds direct Node entry points whose process name hides the connector', () => {
  const snapshot = `10 1 codex\n11 10 /usr/local/bin/node\n12 10 /path with spaces/node`;
  const args = new Map([
    [11, 'node /cache/node_modules/chrome-devtools-mcp/build/src/index.js --private do-not-report'],
    [12, '"/path with spaces/node" --no-warnings "/cache with spaces/node_modules/chrome-devtools-mcp/dist/index.mjs"'],
  ]);
  const result = codexChromeConnectors(snapshot, args);
  assert.deepEqual(result, [
    { pid: 11, parentPid: 10, codexPid: 10 },
    { pid: 12, parentPid: 10, codexPid: 10 },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /private|cache|do-not-report/);
});

test('does not mistake diagnostic shell/eval text or unrelated Node scripts for live connectors', () => {
  const snapshot = `10 1 codex\n11 10 /bin/zsh\n12 10 /usr/local/bin/node\n13 10 /usr/local/bin/node\n14 10 /usr/local/bin/node`;
  assert.deepEqual(codexChromeConnectors(snapshot, new Map([
    [11, 'zsh -c "node /cache/chrome-devtools-mcp/build/src/index.js"'],
    [12, 'node -e "const example=\'/cache/chrome-devtools-mcp/build/src/index.js\'"'],
    [13, 'node /repo/tests.js /cache/chrome-devtools-mcp/build/src/index.js'],
    [14, 'node /cache/not-chrome-devtools-mcp/build/src/index.js'],
  ])), []);
});

test('live inspector collects only Node arguments and emits only identities', () => {
  const calls = [];
  const result = inspectCodexChromeConnectors((command, args) => {
    calls.push({ command, args });
    return { status: 0, stderr: '', stdout: calls.length === 1
      ? '10 1 codex\n11 10 /usr/local/bin/node\n12 10 /bin/zsh\n13 10 /usr/local/bin/node'
      : '11 10 node /cache/chrome-devtools-mcp/build/src/index.js --secret hidden\n13 99 node /cache/chrome-devtools-mcp/build/src/index.js' };
  });
  assert.deepEqual(calls[1].args, ['-p', '11,13', '-o', 'pid=,ppid=,args=']);
  assert.deepEqual(result, [{ pid: 11, parentPid: 10, codexPid: 10 }]);
  assert.doesNotMatch(JSON.stringify(result), /secret|hidden|cache/);
});

test('live inspection failures never produce a false clean result or leak raw errors', () => {
  assert.throws(() => inspectCodexChromeConnectors(() => ({ status: 2, stderr: 'private error' })),
    /^Error: Read-only process inspection failed$/);
  let calls = 0;
  assert.throws(() => inspectCodexChromeConnectors(() => ++calls === 1
    ? { status: 0, stdout: '10 1 codex\n11 10 node', stderr: '' }
    : { status: 2, stdout: '', stderr: 'private error' }),
  /^Error: Read-only Node process inspection failed$/);
});

test('finds stale generic and unified browser REPLs without leaking environment values', () => {
  const snapshot = '10 1 codex\n11 10 /bin/node_repl\n12 10 /bin/node\n13 12 /bin/node_repl';
  const result = codexBrowserRuntimes(snapshot, new Map([
    [11, 'node_repl NODE_REPL_TRUSTED_SERVICES={"browser":"private-module","sky":"native"} TOKEN=secret'],
    [13, 'node_repl CUA_REPL_ENABLED_SURFACES=browser,computer NODE_REPL_TRUSTED_SERVICES={"sky": "native", "browser": "private-module"}'],
  ]));
  assert.deepEqual(result, [
    { pid: 11, parentPid: 10, codexPid: 10 },
    { pid: 13, parentPid: 12, codexPid: 10 },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /private|TOKEN|secret|native/);
});

test('preserves native-only runtimes, unrelated agents and non-runtime processes', () => {
  const snapshot = '10 1 codex\n11 10 /bin/node_repl\n12 10 /bin/node\n20 1 other-agent\n21 20 /bin/node_repl';
  assert.deepEqual(codexBrowserRuntimes(snapshot, new Map([
    [11, 'node_repl NODE_REPL_TRUSTED_SERVICES={"sky":"native"}'],
    [12, 'node NODE_REPL_TRUSTED_SERVICES={"browser":"module"}'],
    [21, 'node_repl NODE_REPL_TRUSTED_SERVICES={"browser":"module"}'],
  ])), []);
});

test('missing or malformed runtime environment never produces a false clean result', () => {
  for (const raw of ['node_repl', 'node_repl NODE_REPL_TRUSTED_SERVICES={bad} TOKEN=secret']) {
    assert.throws(() => codexBrowserRuntimes('10 1 codex\n11 10 node_repl', new Map([[11, raw]])),
      /^Error: Live REPL browser configuration could not be inspected$/);
  }
});

test('live runtime inspection reads environments only for Codex REPLs and rejects changed parents', () => {
  const calls = [];
  const result = inspectCodexBrowserRuntimes((command, args) => {
    calls.push({ command, args });
    return { status: 0, stderr: '', stdout: calls.length === 1
      ? '10 1 codex\n11 10 /bin/node_repl\n12 10 /bin/node_repl\n20 1 other\n21 20 node_repl'
      : '11 10 node_repl NODE_REPL_TRUSTED_SERVICES={"browser":"module"} SECRET=hidden\n12 99 node_repl NODE_REPL_TRUSTED_SERVICES={"browser":"module"}' };
  });
  assert.deepEqual(calls[1].args, ['eww', '-p', '11,12', '-o', 'pid=,ppid=,args=']);
  assert.deepEqual(result, [{ pid: 11, parentPid: 10, codexPid: 10 }]);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|hidden/);
});

test('runtime inspection errors are redacted and an empty or exited runtime set is safe', () => {
  assert.throws(() => inspectCodexBrowserRuntimes(() => ({ status: 1, stderr: 'secret' })),
    /^Error: Read-only process inspection failed$/);
  let calls = 0;
  assert.throws(() => inspectCodexBrowserRuntimes(() => ++calls === 1
    ? { status: 0, stdout: '10 1 codex\n11 10 node_repl', stderr: '' }
    : { status: 2, stderr: 'secret' }), /^Error: Read-only REPL configuration inspection failed$/);
  assert.deepEqual(inspectCodexBrowserRuntimes(() => ({ status: 0, stdout: '10 1 codex', stderr: '' })), []);
  calls = 0;
  assert.deepEqual(inspectCodexBrowserRuntimes(() => ++calls === 1
    ? { status: 0, stdout: '10 1 codex\n11 10 node_repl', stderr: '' }
    : { status: 1, stdout: '', stderr: '' }), []);
});
