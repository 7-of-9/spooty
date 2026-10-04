import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DownloadRequestStore } from './download-request-store';

describe('durable download submission receipts', () => {
  let root: string, store: DownloadRequestStore;
  const id = 'aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb';
  const request = { scope: 'selected', uris: ['b', 'a'], options: { maxSearches: 10 }, destination: '/fixture/downloads' };
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'spooty-receipts-')); store = new DownloadRequestStore(root); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('persists before work and shares a pending ID without repeating any action', async () => {
    let finish: (value: any) => void;
    const work = jest.fn(() => new Promise<{ queued: number; skipped: number }>(resolve => { finish = resolve; }));
    const first = store.run(id, request, work);
    expect(store.get(id)).toMatchObject({ requestId: id, state: 'preparing', receipt: null });
    expect(JSON.parse(readFileSync(join(root, `${id}.json`), 'utf8')).state).toBe('preparing');
    expect(store.run(id, { ...request, uris: ['a', 'b', 'a'] }, work)).toBe(first);
    await Promise.resolve();
    expect(work).toHaveBeenCalledTimes(1);
    finish!({ queued: 3, skipped: 1 });
    await expect(first).resolves.toEqual({ queued: 3, skipped: 1 });
    expect(store.get(id)).toMatchObject({ state: 'completed', receipt: { queued: 3, skipped: 1 } });
    expect(readdirSync(root)).toEqual([`${id}.json`]);
  });

  it('returns the exact completed counts across restart without executing again', async () => {
    const result = { queued: 4, skipped: 8, reused: 3 };
    await store.run(id, request, async () => result);
    const restored = new DownloadRequestStore(root);
    const never = jest.fn(async () => ({ queued: 999, skipped: 0 }));
    await expect(restored.run(id, { ...request, destination: '/changed-folder' }, never)).resolves.toEqual(result);
    expect(never).not.toHaveBeenCalled();
    expect(restored.get(id).destination).toBe(request.destination);
    const returned = restored.get(id); returned.receipt!.queued = 999;
    expect(restored.get(id).receipt!.queued).toBe(4);
  });

  it('rejects a reused ID with a different selection, scope or candidate policy', async () => {
    await store.run(id, request, async () => ({ queued: 0, skipped: 2 }));
    for (const changed of [{ ...request, uris: ['other'] }, { ...request, scope: 'remaining' },
      { ...request, options: { maxSearches: 20 } }]) {
      const work = jest.fn(async () => ({ queued: 10, skipped: 0 }));
      expect(() => store.run(id, changed, work)).toThrow('different download submission');
      expect(work).not.toHaveBeenCalled();
    }
  });

  it('reports interrupted work on a new backend, never invents counts or resumes it', async () => {
    let finish: () => void;
    const first = store.run(id, request, () => new Promise(resolve => { finish = () => resolve({ queued: 1, skipped: 0 }); }));
    await Promise.resolve();
    const restored = new DownloadRequestStore(root);
    expect(restored.get(id)).toMatchObject({ state: 'interrupted', receipt: null });
    expect(() => restored.run(id, request, async () => ({ queued: 1, skipped: 0 }))).toThrow('did not finish');
    finish!(); await first;
  });

  it('keeps failures distinct from completed zero-count requests without storing raw errors', async () => {
    await expect(store.run(id, request, async () => { throw new Error('private-error-detail'); })).rejects.toThrow('private-error-detail');
    expect(store.get(id)).toMatchObject({ state: 'failed', receipt: null });
    expect(readFileSync(join(root, `${id}.json`), 'utf8')).not.toContain('private-error-detail');
    expect(() => store.run(id, request, async () => ({ queued: 0, skipped: 0 }))).toThrow('did not finish');
  });

  it('fails closed before any work when admission cannot be saved', () => {
    writeFileSync(join(root, 'not-directory'), 'sentinel');
    const blocked = new DownloadRequestStore(join(root, 'not-directory'));
    const work = jest.fn(async () => ({ queued: 1, skipped: 0 }));
    expect(() => blocked.run(id, request, work)).toThrow();
    expect(work).not.toHaveBeenCalled();
  });

  it('rejects corrupt receipts and invalid IDs rather than treating them as an absent request', () => {
    writeFileSync(join(root, `${id}.json`), '{}');
    const work = jest.fn(async () => ({ queued: 1, skipped: 0 }));
    expect(() => store.get(id)).toThrow('Invalid saved');
    expect(() => store.run(id, request, work)).toThrow('Invalid saved');
    for (const bad of ['../outside', '', 'a'.repeat(200), id + '/file']) expect(() => store.get(bad)).toThrow('Invalid download request ID');
    expect(work).not.toHaveBeenCalled();
  });

  it('rejects malformed completion counts instead of making a durable success', async () => {
    await expect(store.run(id, request, async () => ({ queued: 1, skipped: 0, reused: 1 }))).rejects.toThrow('Invalid download receipt');
    expect(store.get(id)).toMatchObject({ state: 'failed', receipt: null });
  });
});
