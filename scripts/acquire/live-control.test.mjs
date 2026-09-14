import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyLiveOwner, controlForOwner, controlMatchesRun } from './live-control.mjs';

test('control writes require a verified live owner and bind to that run, not a reused PID', () => {
  const status = { runId: 'current', pid: 123 };
  for (const owner of [{ ownerCheck: 'unavailable' }, { ownerCheck: 'verified', liveOwnerVerified: false }])
    assert.throws(() => controlForOwner(status, owner, { stop: true }), /control was not changed/);
  const control = controlForOwner(status, { ownerCheck: 'verified', liveOwnerVerified: true }, { pace: { downloadConc: 4 } },
    { targetRunId: 'current', stop: true, pace: { maxPerWindow: 240 } });
  assert.deepEqual(control, { targetRunId: 'current', targetPid: 123, stop: true, pace: { downloadConc: 4 } });
  assert.equal(controlMatchesRun(control, 'current', 123), true);
  assert.equal(controlMatchesRun(control, 'other', 123), false);
  assert.equal(controlMatchesRun(control, 'current', 124), false);
  const clean = controlForOwner(status, { ownerCheck: 'verified', liveOwnerVerified: true }, { inspectReviewAt: 1 }, { targetRunId: 'old', stop: true });
  assert.equal(clean.stop, undefined);
});

test('offline status fails closed without leaking tokens or leaving reconnect timers', async () => {
  let disconnected = false;
  class Offline { on() {} async get() { throw new Error('sensitive connection details'); } disconnect() { disconnected = true; } }
  const result = await verifyLiveOwner({ runId: 'x', pid: 123 }, { kill: () => {}, clientFactory: Offline });
  assert.deepEqual(result, { liveOwnerVerified: false, ownerCheck: 'unavailable', anotherOwnerPresent: null });
  assert.equal(disconnected, true);
  class Live { on() {} async get() { return '123-secret-owner-token'; } disconnect() {} }
  const live = await verifyLiveOwner({ runId: 'x', pid: 123 }, { kill: () => {}, clientFactory: Live });
  assert.equal(live.liveOwnerVerified, true);
  assert.equal(JSON.stringify(live).includes('secret'), false);
  assert.equal((await verifyLiveOwner({ runId: 'x', pid: 123 }, { kill: () => { throw new Error(); }, clientFactory: Live })).liveOwnerVerified, false);
});
