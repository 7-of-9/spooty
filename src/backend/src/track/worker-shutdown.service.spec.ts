import { afterEach, describe, it, expect, jest } from '@jest/globals';
import { WorkerActivity } from './worker-activity';
import { WorkerShutdownService } from './worker-shutdown.service';

const fixtures: WorkerShutdownService[] = [];
function fixture(status = 'ready') {
  const workers = [0, 1].map(() => ({
    client: Promise.resolve({ status }),
    pause: jest.fn(async (_localOnly: boolean) => undefined),
    close: jest.fn(async (_force: boolean) => undefined),
  }));
  const queues = [0, 1].map(() => {
    const disconnect = jest.fn(() => undefined);
    return { client: Promise.resolve({ status, disconnect }), disconnect };
  });
  const processors = workers.map(worker => ({ worker, activity: new WorkerActivity() }));
  const service = new WorkerShutdownService(processors[0] as any, processors[1] as any, queues[0] as any, queues[1] as any);
  fixtures.push(service);
  return { service, workers, queues, processors };
}

describe('web worker shutdown', () => {
  afterEach(() => { for (const service of fixtures.splice(0)) service.onApplicationShutdown(); });
  it('leaves healthy workers to normal graceful shutdown', async () => {
    const f = fixture();
    await f.service.beforeApplicationShutdown();
    for (const worker of f.workers) { expect(worker.pause).not.toHaveBeenCalled(); expect(worker.close).not.toHaveBeenCalled(); }
    for (const queue of f.queues) expect(queue.disconnect).not.toHaveBeenCalled();
  });

  it('closes only idle local consumers and offline producers without a Redis command', async () => {
    const f = fixture('reconnecting');
    await f.service.beforeApplicationShutdown();
    for (const worker of f.workers) {
      expect(worker.pause).toHaveBeenCalledWith(true);
      expect(worker.close).toHaveBeenCalledWith(true);
    }
    for (const queue of f.queues) expect(queue.disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not force-close an active operation during a Redis outage', async () => {
    const f = fixture('reconnecting');
    let finish: () => void;
    const running = f.processors[0].activity.run(() => new Promise<void>(resolve => { finish = resolve; }));
    await f.service.beforeApplicationShutdown();
    expect(f.processors[0].activity.active).toBe(true);
    for (const worker of f.workers) expect(worker.close).not.toHaveBeenCalled();
    finish(); await running;
    expect(f.processors[0].activity.active).toBe(false);
  });

  it('rechecks execution after local admission stops', async () => {
    const f = fixture('reconnecting');
    let finish: () => void, running: Promise<void>;
    f.workers[0].pause.mockImplementation(async () => {
      running = f.processors[1].activity.run(() => new Promise<void>(resolve => { finish = resolve; }));
    });
    await f.service.beforeApplicationShutdown();
    for (const worker of f.workers) expect(worker.close).not.toHaveBeenCalled();
    for (const queue of f.queues) expect(queue.disconnect).not.toHaveBeenCalled();
    finish(); await running;
  });

  it('does not wait forever for an unavailable client promise', async () => {
    jest.useFakeTimers();
    try {
      const f = fixture('reconnecting');
      f.workers[0].client = new Promise(() => undefined);
      const closing = f.service.beforeApplicationShutdown();
      await jest.advanceTimersByTimeAsync(300);
      await closing;
      expect(f.workers[0].close).toHaveBeenCalledWith(true);
      f.service.onApplicationShutdown();
      expect(jest.getTimerCount()).toBe(0);
    } finally { jest.useRealTimers(); }
  });

  it('tracks concurrent handlers and clears activity after errors too', async () => {
    const activity = new WorkerActivity();
    let finish: () => void;
    const held = activity.run(() => new Promise<void>(resolve => { finish = resolve; }));
    await expect(activity.run(async () => { throw new Error('fixture'); })).rejects.toThrow('fixture');
    expect(activity.active).toBe(true);
    finish(); await held;
    expect(activity.active).toBe(false);
  });
});
