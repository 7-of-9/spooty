import { WebAdmissionState } from './web-admission-state';
import { describe, it, expect, jest } from '@jest/globals';

describe('HTTP-side playlist preparation state', () => {
  it('reports actual held work, refuses overlapping batches and clears after success', async () => {
    const state = new WebAdmissionState();
    let finish: () => void;
    const held = new Promise<void>(resolve => { finish = resolve; });
    const run = state.run(async () => { state.update({ total: 3, done: 1, phase: 'copying', name: 'Song' }); await held; return 7; });
    expect(state.snapshot()).toMatchObject({ running: true, total: 3, done: 1, phase: 'copying', name: 'Song' });
    const other = jest.fn(async () => 0);
    await expect(state.run(other)).rejects.toThrow('still preparing');
    expect(other).not.toHaveBeenCalled();
    const snapshot = state.snapshot();
    snapshot.done = 999;
    expect(state.snapshot().done).toBe(1);
    finish!();
    await expect(run).resolves.toBe(7);
    expect(state.snapshot()).toMatchObject({ running: false, total: null, name: '' });
  });

  it('clears on failure and does not accept progress from obsolete completed work', async () => {
    const state = new WebAdmissionState();
    await expect(state.run(async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    state.update({ done: 10 });
    expect(state.snapshot()).toMatchObject({ running: false, done: 0 });
    await expect(state.run(async () => 'next')).resolves.toBe('next');
  });
});
