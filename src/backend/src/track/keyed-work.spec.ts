import { KeyedWork } from './keyed-work';

describe('KeyedWork', () => {
  it('serialises the same key', async () => {
    const keyed = new KeyedWork();
    const events: string[] = [];
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });

    const first = keyed.run('song', async () => {
      events.push('first-start');
      markFirstStarted();
      await firstGate;
      events.push('first-end');
    });
    const second = keyed.run('song', async () => {
      events.push('second-start');
      events.push('second-end');
    });
    await firstStarted;
    expect(events).toEqual(['first-start']);

    releaseFirst();
    await Promise.all([first, second]);

    expect(events).toEqual([
      'first-start',
      'first-end',
      'second-start',
      'second-end',
    ]);
    expect(keyed.size).toBe(0);
  });

  it('allows different keys to overlap and releases after an error', async () => {
    const keyed = new KeyedWork();
    const active = new Set<string>();
    let overlapped = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let rejected = false;
    const first = keyed
      .run('a', async () => {
        active.add('a');
        await gate;
        active.delete('a');
        throw new Error('expected');
      })
      .catch(() => {
        rejected = true;
      });
    const second = keyed.run('b', async () => {
      active.add('b');
      overlapped = active.has('a');
      active.delete('b');
    });
    await second;
    release();
    await first;

    expect(rejected).toBe(true);
    expect(overlapped).toBe(true);
    await keyed.run('a', async () => undefined);
    expect(keyed.size).toBe(0);
  });
});
