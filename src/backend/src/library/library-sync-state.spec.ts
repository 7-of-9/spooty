import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { emptyLibrarySync, readLibrarySync, writeLibrarySync } from './library-sync-state';

describe('durable Spotify library sync status', () => {
  let root: string;
  let file: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'spooty-sync-status-')); file = join(root, 'sync.json'); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('starts idle when no persisted operation exists', () => {
    expect(readLibrarySync(file)).toEqual(emptyLibrarySync());
  });
  it('retains complete library identities across a restart during another sync', () => {
    for (const playlistIds of [[], ['aaaaaaaaaaaaaaaaaaaaaa']]) {
      const libraryObservation = { checkedAt: '2026-09-15T04:00:00Z', playlistIds };
      writeLibrarySync(file, { ...emptyLibrarySync(), running: true, libraryObservation });
      const restored = readLibrarySync(file);
      expect(restored.libraryObservation).toEqual(libraryObservation);
      expect(restored.failureKind).toBe('interrupted');
    }
  });
  it('rejects malformed library observations without inventing an empty discovery', () => {
    for (const libraryObservation of [
      {}, { checkedAt: 'bad-date', playlistIds: [] },
      { checkedAt: '2026-09-15T04:00:00Z', playlistIds: null },
      { checkedAt: '2026-09-15T04:00:00Z', playlistIds: ['bad-id'] },
      { checkedAt: '2026-09-15T04:00:00Z', playlistIds: ['aaaaaaaaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaaaaaaaa'] },
    ]) {
      const raw = JSON.stringify({ ...emptyLibrarySync(), libraryObservation });
      writeFileSync(file, raw);
      expect(() => readLibrarySync(file)).toThrow('Invalid saved Spotify library observation');
      expect(readFileSync(file, 'utf8')).toBe(raw);
    }
  });
  it('preserves a completed result including rate limiting across restarts', () => {
    const state = { ...emptyLibrarySync(), done: 3, total: 7, errors: ['Spotify request failed: 429'], finishedAt: new Date().toISOString() };
    writeLibrarySync(file, state);
    expect(readLibrarySync(file)).toEqual(state);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
  it('restores crashed work as interrupted without starting a new request', () => {
    writeLibrarySync(file, { ...emptyLibrarySync(), running: true, done: 2, total: 9, current: 'Playlist', startedAt: new Date().toISOString() });
    const restored = readLibrarySync(file);
    expect(restored.running).toBe(false);
    expect(restored.done).toBe(2);
    expect(restored.total).toBe(9);
    expect(restored.current).toBe('');
    expect(restored.errors.join(' ')).toMatch(/interrupted/);
    expect(restored.finishedAt).not.toBeNull();
  });
  it('rejects corrupt status without modifying the file', () => {
    for (const raw of ['broken json', JSON.stringify({ ...emptyLibrarySync(), done: -1 }), JSON.stringify({ ...emptyLibrarySync(), errors: [null] })]) {
      writeFileSync(file, raw);
      expect(() => readLibrarySync(file)).toThrow();
      expect(readFileSync(file, 'utf8')).toBe(raw);
    }
  });
  it('limits persisted error history and drops unknown fields on restore', () => {
    const state = { ...emptyLibrarySync(), errors: Array.from({ length: 50 }, (_, i) => `error ${i}`) };
    writeLibrarySync(file, state);
    expect(readLibrarySync(file).errors).toHaveLength(20);
    expect(readLibrarySync(file).errors[0]).toBe('error 30');
    writeFileSync(file, JSON.stringify({ ...emptyLibrarySync(), unknown: 'ignored' }));
    expect(readLibrarySync(file)).toEqual(emptyLibrarySync());
  });

  it('restores focused and bulk operations as interrupted with their original identity and scope', () => {
    for (const scope of ['playlist', 'saved-playlists'] as const) {
      writeLibrarySync(file, { ...emptyLibrarySync(), scope, operationId: 'fixture-operation', playlistId: scope === 'playlist' ? 'fixture-id' : null,
        playlistName: scope === 'playlist' ? 'Fixture playlist' : null, running: true, total: 8, done: 3, startedAt: new Date().toISOString() });
      const result = readLibrarySync(file);
      expect(result.operationId).toBe('fixture-operation');
      expect(result.scope).toBe(scope);
      expect(result.running).toBe(false);
      expect(result.failureKind).toBe('interrupted');
      expect(result.done).toBe(3);
      expect(result.result).toBeNull();
    }
  });

  it('reads old library-only status and rejects malformed operation metadata', () => {
    const legacy = { running: false, done: 0, total: 0, discovered: 0, changed: 0, errors: [], current: '', startedAt: null, finishedAt: null };
    writeFileSync(file, JSON.stringify(legacy));
    expect(readLibrarySync(file)).toEqual(emptyLibrarySync());
    for (const extra of [{ scope: 'unknown' }, { result: { id: 'x', name: 'X', before: -1, after: 0 } }, { result: { id: 'x', name: 'X', before: 1, after: 0, removedFiles: -1 } }, { failureKind: 'invented' }]) {
      writeFileSync(file, JSON.stringify({ ...legacy, ...extra }));
      expect(() => readLibrarySync(file)).toThrow();
    }
  });
});
