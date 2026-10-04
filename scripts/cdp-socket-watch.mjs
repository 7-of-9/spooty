#!/usr/bin/env node
// Passive OS socket diagnostics only. Never contacts Chrome or the proxy.
// Records process identifiers and loopback socket states, not command arguments,
// browsing data, protocol messages, cookies, tokens or endpoint identifiers.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function options(args) {
  const result = { port: 0, seconds: 120, intervalMs: 500 };
  const keys = { '--port': 'port', '--seconds': 'seconds', '--interval-ms': 'intervalMs' };
  for (let i = 0; i < args.length; i += 2) {
    if (!keys[args[i]] || !/^\d+$/.test(args[i + 1] || '')) throw new Error('Expected --port N [--seconds N] [--interval-ms N]');
    result[keys[args[i]]] = Number(args[i + 1]);
  }
  if (result.port < 1 || result.port > 65535 || result.seconds < 1 || result.seconds > 7200 ||
      result.intervalMs < 250 || result.intervalMs > 5000) throw new Error('Invalid port, duration (1–7200 seconds), or interval (250–5000 ms)');
  return result;
}

export function parseClients(raw, port) {
  const found = [];
  let process = {};
  let socket;
  const flush = () => {
    if (!socket || !process.pid) return;
    // Only the client direction is attribution evidence. The corresponding
    // Chrome server-side socket and its listener are not separate requesters.
    const peer = socket.name?.split('->')[1];
    if (peer === `127.0.0.1:${port}` || peer === `[::1]:${port}`) {
      found.push({ ...process, fd: socket.fd, state: socket.state || 'unknown' });
    }
  };
  for (const line of raw.split('\n')) {
    const value = line.slice(1);
    switch (line[0]) {
      case 'p': flush(); socket = undefined; process = { pid: Number(value) }; break;
      case 'R': process.ppid = Number(value); break;
      case 'c': process.command = value; break;
      case 'f': flush(); socket = { fd: value }; break;
      case 'n': if (socket) socket.name = value; break;
      case 'T': if (socket && value.startsWith('ST=')) socket.state = value.slice(3); break;
    }
  }
  flush();
  return found.sort((a, b) => a.pid - b.pid || a.fd.localeCompare(b.fd));
}

export async function watch(config, emit = event => console.log(JSON.stringify(event))) {
  const started = Date.now();
  let samples = 0;
  let clientSamples = 0;
  let previous;
  let heartbeat = started;
  let stopped = false;
  const stop = () => { stopped = true; };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  emit({ event: 'started', at: new Date(started).toISOString(), pid: process.pid, ...config });
  try {
    while (!stopped && Date.now() - started < config.seconds * 1000) {
      const sample = spawnSync('/usr/sbin/lsof', ['-nP', `-iTCP:${config.port}`, '-FpcRfnT'], {
        encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024,
      });
      if (sample.error || ![0, 1].includes(sample.status) || sample.stderr.trim()) {
        throw new Error('Socket inspection failed; no absence-of-connections conclusion is valid');
      }
      const clients = parseClients(sample.stdout, config.port);
      samples++;
      if (clients.length) clientSamples++;
      const encoded = JSON.stringify(clients);
      if (encoded !== previous) {
        emit({ event: 'clients', at: new Date().toISOString(), clients });
        previous = encoded;
      }
      if (Date.now() - heartbeat >= 60000) {
        emit({ event: 'heartbeat', at: new Date().toISOString(), samples, clientSamples });
        heartbeat = Date.now();
      }
      await new Promise(resolve => setTimeout(resolve, config.intervalMs));
    }
    emit({ event: 'finished', at: new Date().toISOString(), samples, clientSamples,
      elapsedSeconds: (Date.now() - started) / 1000, stopped });
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  watch(options(process.argv.slice(2))).catch(() => {
    console.error('Passive CDP socket watch failed; check local lsof access. No Chrome connection was requested.');
    process.exitCode = 1;
  });
}
