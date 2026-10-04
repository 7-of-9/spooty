import { test } from 'node:test';
import assert from 'node:assert/strict';
import { options, parseClients } from './cdp-socket-watch.mjs';

test('passive watch requires a specific port and bounded polling', () => {
  assert.deepEqual(options(['--port', '64165']), { port: 64165, seconds: 120, intervalMs: 500 });
  for (const args of [[], ['--port', '0'], ['--port', '65536'], ['--port', 'x'],
    ['--port', '64165', '--seconds', '7201'], ['--port', '64165', '--interval-ms', '1'],
    ['--port', '64165', '--connect', '1']]) assert.throws(() => options(args));
});

test('attributes connecting and established sockets to clients, not Chrome', () => {
  const raw = 'p1337\nR1\ncGoogle Chrome\nf10\nn127.0.0.1:64165\nTST=LISTEN\n' +
    'f11\nn127.0.0.1:64165->127.0.0.1:50000\nTST=ESTABLISHED\n' +
    'p14004\nR1\ncnode\nf17\nn127.0.0.1:50000->127.0.0.1:64165\nTST=ESTABLISHED\n' +
    'f18\nn127.0.0.1:50001->127.0.0.1:64165\nTST=SYN_SENT\n';
  assert.deepEqual(parseClients(raw, 64165), [
    { pid: 14004, ppid: 1, command: 'node', fd: '17', state: 'ESTABLISHED' },
    { pid: 14004, ppid: 1, command: 'node', fd: '18', state: 'SYN_SENT' },
  ]);
});

test('ignores other destinations and handles IPv6 and an empty snapshot', () => {
  assert.deepEqual(parseClients('', 64165), []);
  assert.deepEqual(parseClients('p12\nR2\ncnode\nf1\nn127.0.0.1:3->127.0.0.1:17331\n' +
    'f2\nn[::1]:50000->[::1]:64165\nTST=ESTABLISHED\n', 64165),
    [{ pid: 12, ppid: 2, command: 'node', fd: '2', state: 'ESTABLISHED' }]);
});
