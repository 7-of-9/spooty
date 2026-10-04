// Exercise the real Angular component's sync lifecycle in Node. This is not
// DOM/rendering, browser, Chrome or Spotify integration coverage.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import '@angular/compiler';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const generated = mkdtempSync(join(root, 'node_modules/.spooty-sync-test-'));
after(() => rmSync(generated, { recursive: true, force: true }));
await build({
  entryPoints: [join(root, 'src/frontend/src/app/components/library-panel/library-panel.component.ts')],
  outfile: join(generated, 'component.mjs'),
  bundle: true, platform: 'node', format: 'esm', packages: 'external',
  tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false, target: 'ES2022' } },
  logLevel: 'silent',
});
const { LibraryPanelComponent } = await import(pathToFileURL(join(generated, 'component.mjs')).href);

function status(overrides = {}) {
  return { running: false, done: 1, total: 1, discovered: 0, changed: 1, errors: [], current: '',
    operationId: 'current', scope: 'playlist', playlistId: 'one', playlistName: 'My playlist',
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    result: { id: 'one', name: 'My playlist', before: 10, after: 12 }, ...overrides };
}
function fixture(t) {
  const calls = { posts: 0, scopes: [], reads: 0, refresh: 0, playlists: 0, chrome: 0 };
  const response = { status: of(status()), post: of({ started: true, operationId: 'current' }) };
  const post = scope => () => { calls.posts++; calls.scopes.push(scope); return response.post; };
  const library = {
    syncPlaylist: post('playlist'), syncLibrary: post('library'), resyncAll: post('saved-playlists'),
    syncLibraryStatus: () => { calls.reads++; return response.status; },
    spotifyConnection: () => { calls.chrome++; return of({ state: 'disconnected', connectedAt: null }); },
    connectSpotifyChrome: () => { throw new Error('No Chrome connection is permitted in these tests'); },
  };
  const playlists = { all$: new BehaviorSubject([]), fetch: () => calls.playlists++ };
  const tracks = { all$: new BehaviorSubject([]), progress$: new BehaviorSubject({}) };
  const component = new LibraryPanelComponent(library, playlists, tracks, { run: fn => fn() });
  component.focused = { id: 'one', name: 'My playlist' };
  component.refresh = () => { calls.refresh++; };
  t.after(() => component.ngOnDestroy());
  return { component, response, calls };
}

test('real component follows an acknowledged focused sync to its receipt', t => {
  const { component, calls } = fixture(t);
  component.resyncFocused();
  assert.equal(calls.posts, 1);
  assert.equal(component.spotifySyncBusy, false);
  assert.match(component.activityReceipt.detail, /10 → 12 tracks/);
  assert.equal(calls.refresh, 1);
});

test('real component does not label an old completion as success after a lost POST', t => {
  const { component, response, calls } = fixture(t);
  response.post = throwError(() => ({ status: 0 }));
  response.status = of(status({ operationId: 'previous', startedAt: '2020-01-01T00:00:00Z' }));
  component.resyncFocused();
  assert.equal(component.spotifySyncBusy, false);
  assert.equal(component.activityReceipt, null);
  assert.match(component.error, /request was not confirmed/);
  assert.equal(calls.posts, 1);
  assert.equal(calls.refresh, 0);
});

test('real component verifies acknowledgement identity before displaying completion', t => {
  const { component, response } = fixture(t);
  response.status = of(status({ operationId: 'previous' }));
  component.resyncFocused();
  assert.equal(component.activityReceipt, null);
  assert.match(component.error, /request was not confirmed/);
});

test('real component observes running work after response loss without another POST', t => {
  const { component, response, calls } = fixture(t);
  response.post = throwError(() => ({ status: 0 }));
  response.status = of(status({ running: true, current: 'My playlist', finishedAt: null, result: null }));
  component.resyncFocused();
  component.resyncFocused();
  assert.equal(calls.posts, 1);
  assert.equal(component.resyncing, true);
  response.status = of(status());
  component.pollLibrarySync();
  assert.match(component.activityReceipt.detail, /10 → 12/);
  assert.equal(component.spotifySyncBusy, false);
});

test('real component notices another tab starting a sync, without submitting one', t => {
  const { component, response, calls } = fixture(t);
  response.status = of(status({ running: true, current: 'Other playlist', playlistId: 'other', playlistName: 'Other playlist', result: null, finishedAt: null }));
  component.observeExternalSpotifySync();
  assert.equal(component.syncPlaylistId, 'other');
  assert.match(component.spotifyActivity, /Other playlist/);
  assert.equal(calls.posts, 0);
  const reads = calls.reads;
  component.observeExternalSpotifySync();
  assert.equal(calls.reads, reads, 'idle observer must not overlap active polling');
});

test('real component catches a sync completed between observations exactly once', t => {
  const { component, calls } = fixture(t);
  component.observeExternalSpotifySync();
  assert.match(component.activityReceipt.detail, /10 → 12/);
  component.observeExternalSpotifySync();
  assert.equal(calls.posts, 0);
  assert.equal(calls.refresh, 1);
  assert.equal(calls.playlists, 1);
});

test('real component keeps observations non-overlapping and ignores responses after disposal', t => {
  const { component, response, calls } = fixture(t);
  const pending = new Subject();
  response.status = pending;
  component.observeExternalSpotifySync();
  component.observeExternalSpotifySync();
  assert.equal(calls.reads, 1);
  component.ngOnDestroy();
  pending.next(status({ running: true, finishedAt: null }));
  pending.complete();
  assert.equal(component.librarySyncPoll, null);
  assert.equal(component.spotifySyncBusy, false);
});

test('real component ignores submission acknowledgement after disposal', t => {
  const { component, response, calls } = fixture(t);
  const pending = new Subject();
  response.post = pending;
  component.resyncFocused();
  component.ngOnDestroy();
  pending.next({ started: true, operationId: 'current' });
  pending.complete();
  assert.equal(calls.reads, 0);
  assert.equal(component.librarySyncPoll, null);
});

test('disposed components cannot submit any kind of Spotify sync', t => {
  const { component, calls } = fixture(t);
  component.ngOnDestroy();
  component.resyncFocused();
  component.syncLibrary();
  component.resyncAll();
  assert.equal(calls.posts, 0);
});

test('real component restores recent completed sync instead of posting on reload', t => {
  const { component, calls } = fixture(t);
  component.restoreOrStartLibrarySync();
  assert.equal(calls.posts, 0);
  assert.match(component.activityReceipt.detail, /10 → 12/);
});

test('background library refresh discovers new playlists even after a recent focused sync', t => {
  const { component, calls } = fixture(t);
  component.restoreOrStartLibrarySync(true);
  assert.deepEqual(calls.scopes, ['library']);
});

test('background library refresh reuses a recent whole-library check', t => {
  const { component, response, calls } = fixture(t);
  response.status = of(status({ scope: 'library', result: null }));
  component.restoreOrStartLibrarySync(true);
  assert.equal(calls.posts, 0);
});

test('background library refresh respects active work, rate limiting and observation failures', t => {
  const { component, response, calls } = fixture(t);
  component.syncingLibrary = true;
  component.restoreOrStartLibrarySync(true);
  assert.equal(calls.reads, 0);
  component.syncingLibrary = false;
  response.status = of(status({ errors: ['Spotify library request failed: 429'] }));
  component.restoreOrStartLibrarySync(true);
  assert.equal(calls.posts, 0);
  response.status = throwError(() => ({ status: 0 }));
  component.restoreOrStartLibrarySync(true);
  assert.equal(calls.posts, 0);
});

test('background maintenance never submits metadata work while Chrome is known unavailable', t => {
  const { component, calls } = fixture(t);
  for (const state of ['disconnected', 'unavailable', 'connecting']) {
    component.spotifyConnection = { state, connectedAt: null };
    component.restoreOrStartLibrarySync(true);
    component.syncLibrary(true);
    component.resyncFocused(true);
  }
  assert.equal(calls.posts, 0);
  assert.equal(calls.reads, 0);
  assert.equal(calls.chrome, 0);
  assert.equal(component.chromeConnectConfirm, false);
});

test('first explicit Sync click explains a known disconnection without first submitting doomed work', t => {
  const { component, calls } = fixture(t);
  component.spotifyConnection = { state: 'disconnected', connectedAt: null };
  assert.equal(component.librarySyncDegraded, false);
  component.syncLibrary();
  assert.equal(component.chromeConnectConfirm, true);
  assert.equal(calls.posts, 0);
  assert.equal(calls.chrome, 0);
  assert.match(component.spotifySyncIssue, /shared Chrome connection/);
});

test('unavailable or already-connecting Chrome explains the wait without offering another request', t => {
  const { component, calls } = fixture(t);
  for (const state of ['unavailable', 'connecting']) {
    component.spotifyConnection = { state, connectedAt: null };
    component.syncLibrary();
    component.resyncFocused();
    component.resyncAll();
    assert.equal(component.chromeConnectConfirm, false);
    assert.equal(component.syncingLibrary, false);
    assert.equal(component.spotifyActivity, '');
    assert.notEqual(component.spotifySyncIssue, '');
  }
  assert.equal(calls.posts, 0);
  assert.equal(calls.chrome, 0);
});

test('the 15-minute lifecycle timer checks the library even with no selected playlist', t => {
  const { component, response, calls } = fixture(t);
  const intervals = [];
  t.mock.method(globalThis, 'setInterval', (callback, delay) => { intervals.push({ callback, delay }); return 123; });
  t.mock.method(globalThis, 'clearInterval', () => {});
  component.focused = null;
  component.loadDownloadLocation = () => {};
  component.checkSpotifyConnection = () => {};
  component.startPacePolling = () => {};
  component.ngOnInit();
  response.status = of(status({ scope: 'library', finishedAt: new Date(Date.now() - 16 * 60000).toISOString() }));
  intervals.find(item => item.delay === 15 * 60000).callback();
  assert.deepEqual(calls.scopes, ['library']);
  component.ngOnDestroy();
  intervals.find(item => item.delay === 15 * 60000).callback();
  assert.equal(calls.posts, 1);
});

test('background discovery observations do not overlap or overwrite newer manual work', t => {
  const { component, response, calls } = fixture(t);
  const pending = new Subject();
  response.status = pending;
  component.restoreOrStartLibrarySync(true);
  component.restoreOrStartLibrarySync(true);
  component.observeExternalSpotifySync();
  assert.equal(calls.reads, 1);
  response.status = of(status());
  component.resyncFocused();
  pending.next(status({ operationId: 'old' }));
  pending.complete();
  assert.deepEqual(calls.scopes, ['playlist']);
  assert.match(component.activityReceipt.detail, /10 → 12/);
});

test('a late initial observation cannot overwrite a manual sync or start another one', t => {
  const { component, response, calls } = fixture(t);
  const initial = new Subject();
  response.status = initial;
  component.restoreOrStartLibrarySync();
  response.status = of(status());
  component.resyncFocused();
  initial.next(status({ operationId: 'old', result: { id: 'old', name: 'Old playlist', before: 1, after: 2 } }));
  initial.complete();
  assert.match(component.activityReceipt.detail, /My playlist/);
  assert.equal(calls.posts, 1);
});

test('a late idle observation cannot replace the receipt from a newer manual action', t => {
  const { component, response } = fixture(t);
  const oldRead = new Subject();
  response.status = oldRead;
  component.observeExternalSpotifySync();
  response.status = of(status());
  component.resyncFocused();
  // The pending old read is ignored, then the active poll follows the new sync.
  oldRead.next(status({ operationId: 'old' }));
  oldRead.complete();
  component.pollLibrarySync();
  assert.match(component.activityReceipt.detail, /My playlist/);
  assert.equal(component.error, '');
});

test('real component stops animation during observation loss and recovers without resubmitting', t => {
  const { component, response, calls } = fixture(t);
  response.status = throwError(() => ({ status: 0 }));
  component.resyncFocused();
  assert.equal(component.librarySyncConnectionLost, true);
  assert.equal(component.spotifyActivity, '');
  component.resyncFocused();
  assert.equal(calls.posts, 1);
  response.status = of(status());
  component.pollLibrarySync();
  assert.equal(component.librarySyncConnectionLost, false);
  assert.equal(component.spotifySyncBusy, false);
  assert.match(component.activityReceipt.detail, /10 → 12/);
});

test('real component clears its recovered sync error without erasing another action error', t => {
  const { component, response } = fixture(t);
  response.status = of(status({ errors: ['incomplete response'] }));
  component.resyncFocused();
  assert.match(component.error, /complete track list/);
  response.status = of(status({ operationId: 'recovered' }));
  component.observeExternalSpotifySync();
  assert.equal(component.error, '');
  component.error = 'Download folder could not be saved';
  response.status = of(status({ operationId: 'another' }));
  component.observeExternalSpotifySync();
  assert.equal(component.error, 'Download folder could not be saved');
});
