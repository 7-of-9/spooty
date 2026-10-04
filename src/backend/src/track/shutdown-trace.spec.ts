import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ShutdownTrace } from './shutdown-trace';

describe('read-only shutdown trace', () => {
  afterEach(() => jest.useRealTimers());

  it('reports the waiting resource and handler state without taking any action', async () => {
    jest.useFakeTimers();
    let finish: () => void;
    const closing = new Promise<void>(resolve => { finish = resolve; });
    const log = jest.fn();
    const trace = new ShutdownTrace([
      { name: 'search', closing: () => closing, activity: () => true, running: () => true },
      { name: 'download', closing: () => undefined, activity: () => false, running: () => false },
    ], log);
    trace.start(); trace.start();
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(4999);
    expect(log).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(log).toHaveBeenLastCalledWith('Shutdown waiting 5s; search:closing,handler=active,loop=running; download:close-not-started,handler=idle,loop=stopped');
    finish!(); await Promise.resolve();
    expect(log).toHaveBeenLastCalledWith('Shutdown resource search: closed');
    trace.stop(); expect(jest.getTimerCount()).toBe(0);
  });

  it('limits repeated notices and never emits raw rejection details', async () => {
    jest.useFakeTimers();
    let fail: (error: Error) => void;
    const closing = new Promise<void>((_resolve, reject) => { fail = reject; });
    const log = jest.fn();
    const trace = new ShutdownTrace([{ name: 'producer', closing: () => closing }], log);
    trace.start(); await jest.advanceTimersByTimeAsync(1000);
    fail!(new Error('private-session-detail')); await Promise.resolve();
    await jest.advanceTimersByTimeAsync(34000);
    expect(log.mock.calls.filter(([message]) => String(message).startsWith('Shutdown waiting'))).toHaveLength(2);
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-session-detail');
    expect(JSON.stringify(log.mock.calls)).toContain('close-rejected');
    trace.stop();
  });

  it('cleans timers and ignores late closures after the final hook', async () => {
    jest.useFakeTimers();
    let finish: () => void;
    const closing = new Promise<void>(resolve => { finish = resolve; });
    const log = jest.fn();
    const trace = new ShutdownTrace([{ name: 'producer', closing: () => closing }], log);
    trace.start(); await jest.advanceTimersByTimeAsync(1000);
    trace.stop(); trace.stop(); trace.start();
    const count = log.mock.calls.length;
    finish!(); await Promise.resolve(); await jest.advanceTimersByTimeAsync(60000);
    expect(log).toHaveBeenCalledTimes(count);
    expect(jest.getTimerCount()).toBe(0);
  });
});
