import { LibraryCoverageScan, CoveragePlaylist, LibraryViewTrack } from './library-coverage-scan';
import { expect } from '@jest/globals';

const tick = () => new Promise<void>(yes => setImmediate(yes));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function record(id: string, count = 1): CoveragePlaylist {
  const tracks: LibraryViewTrack[] = Array.from({ length: count }, (_, n) => ({ n, artist: 'Artist', name: `${id}-${n}`,
    sourceKey: `${id}-${n}`, spotifyUrl: null, durationMs: 1000,
    mediaVerification: 'checking', onDisk: false, available: false, filename: '' }));
  return { playlist: { id, uri: `spotify:playlist:${id}`, name: id, rank: 1, skipped: false,
    trackCount: count, onDisk: 0, available: 0, failed: 0, done: false,
    percentOnDisk: 0, percentAvailable: 0, file: id, spotifyUrl: id },
    tracks, resolve: tracks.map(track => async () => ({ ...track, mediaVerification: 'missing' })) };
}

describe('background saved-file scan', () => {
  it('rechecks only changed sources, keeps unrelated saved counts and rejects late old-generation evidence', async () => {
    const a = record('a', 3);
    a.resolve = a.tracks.map(t => jest.fn(async () => ({ ...t, onDisk: true, available: true, mediaVerification: 'duration-match' })));
    const old = new LibraryCoverageScan([a], '/media'); await old.finished;
    const gate = deferred<LibraryViewTrack>(); a.resolve[1] = jest.fn(() => gate.promise);
    const next = old.changes(new Set(['a-1']))!;
    expect(old.invalidated).toBe(true);
    expect(next.progress()).toMatchObject({ scope: 'changes', total: 1, checked: 0 });
    expect(next.snapshot().playlists[0]).toMatchObject({ onDisk: 2, coveragePending: 1, done: false });
    expect(next.detail('a')!.tracks[0].onDisk).toBe(true);
    gate.resolve({ ...a.tracks[1], onDisk: false, available: false, mediaVerification: 'missing' });
    await next.finished;
    expect(next.snapshot().playlists[0]).toMatchObject({ onDisk: 2, coveragePending: 0 });
    expect(a.resolve[0]).toHaveBeenCalledTimes(1); expect(a.resolve[2]).toHaveBeenCalledTimes(1);
    expect(next.changes(new Set(['unrelated']))).toBeNull();
  });

  it('reschedules unfinished rows and cannot resurrect old results after an incremental replacement', async () => {
    const a = record('a', 2), gate = deferred<LibraryViewTrack>();
    let call = 0;
    a.resolve[0] = async () => ++call === 1 ? gate.promise : { ...a.tracks[0], mediaVerification: 'missing' };
    const old = new LibraryCoverageScan([a], '/media'); await tick();
    const next = old.changes(new Set(['a-1']))!; await next.finished;
    gate.resolve({ ...a.tracks[0], onDisk: true, available: true, mediaVerification: 'duration-match' }); await old.finished;
    expect(next.progress()).toMatchObject({ state: 'complete', total: 2, checked: 2 });
    expect(next.snapshot().totals.onDisk).toBe(0);
  });

  it('updates workflow labels and permanent misses without performing a media check', async () => {
    const a = record('a'); a.resolve[0] = jest.fn(a.resolve[0]);
    const scan = new LibraryCoverageScan([a], '/media'); await scan.finished;
    scan.updateWorkflow(row => ({ ...row, acquisitionState: 'missing', missing: true }));
    expect(scan.snapshot().playlists[0]).toMatchObject({ failed: 1, onDisk: 0, done: true });
    expect(scan.detail('a')!.tracks[0].acquisitionState).toBe('missing');
    expect(a.resolve[0]).toHaveBeenCalledTimes(1);
  });

  it('exposes the full playlist scaffold immediately without inventing missing/saved results', async () => {
    const gate = deferred<LibraryViewTrack>();
    const a = record('a'); a.resolve[0] = () => gate.promise;
    const scan = new LibraryCoverageScan([a], '/media');
    const first = scan.snapshot();
    expect(first.playlists[0].coveragePending).toBe(1);
    expect(first.playlists[0].done).toBe(false);
    expect(first.coverage).toMatchObject({ state: 'checking', checked: 0, total: 1 });
    expect(scan.detail('a')!.tracks[0].mediaVerification).toBe('checking');
    gate.resolve({ ...a.tracks[0], onDisk: true, available: true, filename: 'real.mp3', mediaVerification: 'duration-match' });
    await scan.finished;
    expect(scan.snapshot().coverage).toMatchObject({ state: 'complete', checked: 1, errors: 0 });
    expect(scan.snapshot().playlists[0]).toMatchObject({ onDisk: 1, available: 1, coveragePending: 0, done: true });
    expect(first.playlists[0].onDisk).toBe(0); // Previously returned objects stay stable.
  });

  it('limits work to four records and prioritises a newly focused playlist', async () => {
    const a = record('a', 8), b = record('b', 2);
    const gates = Array.from({ length: 10 }, () => deferred<LibraryViewTrack>());
    const order: string[] = [];
    for (const [offset, entry] of [[0, a], [8, b]] as const) {
      entry.resolve = entry.tracks.map((t, i) => () => { order.push(t.name); return gates[offset + i].promise; });
    }
    const scan = new LibraryCoverageScan([a, b], '/media');
    await tick();
    expect(order).toEqual(['a-0', 'a-1', 'a-2', 'a-3']);
    scan.detail('b');
    gates[0].resolve({ ...a.tracks[0], mediaVerification: 'missing' });
    await tick();
    expect(order[4]).toBe('b-0');
    gates.forEach((g, i) => g.resolve({ ...(i < 8 ? a.tracks[i] : b.tracks[i - 8]), mediaVerification: 'missing' }));
    await scan.finished;
    expect(scan.progress().checked).toBe(10);
  });

  it('discloses observation failures without labelling a track absent or completing its playlist', async () => {
    const a = record('a'); a.resolve[0] = async () => { throw new Error('read failed'); };
    const scan = new LibraryCoverageScan([a], '/media'); await scan.finished;
    expect(scan.progress()).toMatchObject({ state: 'failed', errors: 1, checked: 1 });
    expect(scan.snapshot().playlists[0]).toMatchObject({ done: false, coveragePending: 1, onDisk: 0 });
    expect(scan.detail('a')!.tracks[0].mediaVerification).toBe('checking');
    expect(scan.detail('a')!.tracks[0].missing).toBeUndefined();
  });

  it('does not apply a late result after cancellation or start its remaining work', async () => {
    const a = record('a', 5), gates = a.tracks.map(() => deferred<LibraryViewTrack>());
    const called: number[] = [];
    a.resolve = a.tracks.map((t, i) => () => { called.push(i); return gates[i].promise; });
    const scan = new LibraryCoverageScan([a], '/old'); await tick(); scan.cancel();
    gates.forEach((g, i) => g.resolve({ ...a.tracks[i], onDisk: true })); await scan.finished;
    expect(called).toHaveLength(4);
    expect(scan.snapshot().totals.onDisk).toBe(0);
    expect(scan.progress().state).toBe('failed');
  });

  it('counts physical presence, reuse and permanent misses separately after checks', async () => {
    const a = record('a', 4);
    a.resolve = [
      async () => ({ ...a.tracks[0], onDisk: true, available: true, mediaVerification: 'duration-match' }),
      async () => ({ ...a.tracks[1], available: true, mediaVerification: 'duration-match' }),
      async () => ({ ...a.tracks[2], mediaVerification: 'mismatch' }),
      async () => ({ ...a.tracks[3], mediaVerification: 'missing', missing: true }),
    ];
    const scan = new LibraryCoverageScan([a], '/media'); await scan.finished;
    expect(scan.snapshot().playlists[0]).toMatchObject({ onDisk: 1, available: 2, failed: 1, done: false, coveragePending: 0 });
  });

  it('finishes empty libraries and does not create work when observing a completed scan', async () => {
    const scan = new LibraryCoverageScan([], '/media'); await scan.finished;
    const first = scan.snapshot();
    expect(first.coverage).toMatchObject({ state: 'complete', checked: 0, total: 0 });
    expect(scan.snapshot()).toEqual(first);
    expect(scan.detail('unknown')).toBeNull();
  });
});
