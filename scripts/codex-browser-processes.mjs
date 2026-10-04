// Read-only process attribution. No browser access, signaling or full argv output.
// Covers direct Chrome MCP and stale browser-capable REPLs under Codex.
import { spawnSync } from 'node:child_process';

const directName = /(?:^|[\s/])chrome-devtools-mcp(?:@[^\s]+)?(?:\s|$)/;
const nodeName = /(?:^|\/)node(?:\d+(?:\.\d+)*)?$/;

// A known stale parent can be between child launches. An empty connector list
// must not clear that risk. Match start time as well as PID to avoid PID reuse.
export function knownStaleCodexSessions(snapshot, sessions) {
  if (!Array.isArray(sessions) || sessions.some(session =>
    !Number.isSafeInteger(session?.pid) || session.pid <= 0 ||
    typeof session.startedAtUtc !== 'string' ||
    !/^\w{3} \w{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/.test(session.startedAtUtc))) {
    throw new Error('Invalid stale browser-session record');
  }
  const found = [];
  for (const line of snapshot.split('\n').filter(line => line.trim())) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\w{3} \w{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4})\s+(.+)$/);
    if (!match) throw new Error('Read-only stale session identity inspection failed');
    const pid = Number(match[1]);
    if (/(?:^|\/)codex$/.test(match[4]) && sessions.some(session =>
      session.pid === pid && session.startedAtUtc === match[3])) {
      found.push({ pid, parentPid: Number(match[2]), startedAtUtc: match[3] });
    }
  }
  return found.sort((a, b) => a.pid - b.pid);
}

export function inspectKnownStaleCodexSessions(sessions, run = spawnSync) {
  knownStaleCodexSessions('', sessions); // Validate before constructing arguments.
  if (!sessions.length) return [];
  const result = run('/bin/ps', ['-p', sessions.map(session => session.pid).join(','),
    '-o', 'pid=,ppid=,lstart=,comm='], {
    encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024,
    env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' },
  });
  if (result.error || ![0, 1].includes(result.status) || result.stderr?.trim()) {
    throw new Error('Read-only stale session identity inspection failed');
  }
  return knownStaleCodexSessions(result.stdout, sessions);
}

function processesFrom(snapshot) {
  const processes = new Map();
  for (const line of snapshot.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (match) processes.set(Number(match[1]), {
      pid: Number(match[1]), ppid: Number(match[2]), name: match[3],
    });
  }
  return processes;
}

function isNodeConnector(name, args) {
  if (!nodeName.test(name) || typeof args !== 'string') return false;
  // A Node worker's `comm` may be just /path/to/node: inspect its executable
  // script, never arbitrary command text embedded in a shell or an eval string.
  // Quoted paths are accepted, including application/cache paths with spaces.
  const tokens = args.match(/"[^"\n]*"|'[^'\n]*'|[^\s]+/g) || [];
  const unquote = value => value.replace(/^(['"])(.*)\1$/, '$2');
  if (!nodeName.test(unquote(tokens.shift() || ''))) return false;
  while (tokens[0]?.startsWith('--')) {
    if (!/^--(?:no-warnings|enable-source-maps|experimental-strip-types)$/.test(tokens[0])) return false;
    tokens.shift();
  }
  const script = unquote(tokens[0] || '');
  return /(?:^|\/)chrome-devtools-mcp\/(?:build|dist)\/.+\.[cm]?js$/.test(script) ||
    /(?:^|\/)\.bin\/chrome-devtools-mcp$/.test(script);
}

function codexAncestor(process, processes) {
  const visited = new Set([process.pid]);
  let ancestor = processes.get(process.ppid);
  while (ancestor && !visited.has(ancestor.pid)) {
    visited.add(ancestor.pid);
    if (/(?:^|\/)codex$/.test(ancestor.name)) return ancestor.pid;
    ancestor = processes.get(ancestor.ppid);
  }
}

// Environment output stays private. Return only whether this loaded runtime
// still offers a browser service, never its arguments or environment.
function hasBrowserService(raw) {
  const services = raw?.match(/(?:^| )NODE_REPL_TRUSTED_SERVICES=(\{[^\n]*?\})(?:\s+[A-Za-z_][A-Za-z0-9_]*=|$)/)?.[1];
  if (!services) throw new Error('Live REPL browser configuration could not be inspected');
  try { return Object.hasOwn(JSON.parse(services), 'browser'); }
  catch { throw new Error('Live REPL browser configuration could not be inspected'); }
}

export function codexBrowserRuntimes(snapshot, runtimeEnvironments = new Map()) {
  const processes = processesFrom(snapshot);
  const found = [];
  for (const process of processes.values()) {
    if (!/(?:^|\/)node_repl$/.test(process.name)) continue;
    const codexPid = codexAncestor(process, processes);
    if (!codexPid || !runtimeEnvironments.has(process.pid)) continue;
    if (hasBrowserService(runtimeEnvironments.get(process.pid))) {
      found.push({ pid: process.pid, parentPid: process.ppid, codexPid });
    }
  }
  return found.sort((a, b) => a.pid - b.pid);
}

export function inspectCodexBrowserRuntimes(run = spawnSync) {
  const options = { encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024 };
  const snapshot = run('/bin/ps', ['-axo', 'pid=,ppid=,comm='], options);
  if (snapshot.error || snapshot.status !== 0) throw new Error('Read-only process inspection failed');
  const processes = processesFrom(snapshot.stdout);
  const runtimes = [...processes.values()].filter(p =>
    /(?:^|\/)node_repl$/.test(p.name) && codexAncestor(p, processes));
  if (!runtimes.length) return [];
  const result = run('/bin/ps', ['eww', '-p', runtimes.map(p => p.pid).join(','), '-o', 'pid=,ppid=,args='], options);
  if (result.error || ![0, 1].includes(result.status) || result.stderr?.trim()) {
    throw new Error('Read-only REPL configuration inspection failed');
  }
  const environments = new Map();
  for (const row of processesFrom(result.stdout).values()) {
    if (runtimes.some(p => p.pid === row.pid && p.ppid === row.ppid)) environments.set(row.pid, row.name);
  }
  return codexBrowserRuntimes(snapshot.stdout, environments);
}

export function codexChromeConnectors(snapshot, nodeArguments = new Map()) {
  const processes = processesFrom(snapshot);
  const found = [];
  for (const process of processes.values()) {
    if (!directName.test(process.name) && !isNodeConnector(process.name, nodeArguments.get(process.pid))) continue;
    const visited = new Set([process.pid]);
    let ancestor = processes.get(process.ppid);
    while (ancestor && !visited.has(ancestor.pid)) {
      visited.add(ancestor.pid);
      if (/(?:^|\/)codex$/.test(ancestor.name)) {
        found.push({ pid: process.pid, parentPid: process.ppid, codexPid: ancestor.pid });
        break;
      }
      ancestor = processes.get(ancestor.ppid);
    }
  }
  return found.sort((a, b) => a.pid - b.pid);
}

export function inspectCodexChromeConnectors(run = spawnSync) {
  const snapshot = run('/bin/ps', ['-axo', 'pid=,ppid=,comm='], {
    encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024,
  });
  if (snapshot.error || snapshot.status !== 0) throw new Error('Read-only process inspection failed');
  const nodes = [...processesFrom(snapshot.stdout).values()].filter(p => nodeName.test(p.name));
  const nodeArguments = new Map();
  if (nodes.length) {
    // Keep argument text private and request it only for Node executables.
    // `ps` can return 1 when all selected short-lived processes have exited.
    const result = run('/bin/ps', ['-p', nodes.map(p => p.pid).join(','), '-o', 'pid=,ppid=,args='], {
      encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error || ![0, 1].includes(result.status) || result.stderr?.trim()) {
      throw new Error('Read-only Node process inspection failed');
    }
    for (const row of processesFrom(result.stdout).values()) {
      // Reject a PID whose parent changed between snapshots.
      if (nodes.some(p => p.pid === row.pid && p.ppid === row.ppid)) nodeArguments.set(row.pid, row.name);
    }
  }
  return codexChromeConnectors(snapshot.stdout, nodeArguments);
}
