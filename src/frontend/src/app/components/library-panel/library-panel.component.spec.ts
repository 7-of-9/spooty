import {
  ComponentFixture,
  TestBed,
  discardPeriodicTasks,
  fakeAsync,
  tick,
} from '@angular/core/testing';
import { BehaviorSubject, EMPTY, NEVER, of, Subject, throwError } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { DOWNLOAD_REQUEST_STORAGE } from '../../models/download-request';

import {
  LibraryDetail,
  LibraryListResponse,
  LibraryPlaylist,
} from '../../models/library-playlist';
import { Playlist } from '../../models/playlist';
import { Track, TrackStatusEnum } from '../../models/track';
import {
  LibraryService,
  YoutubePaceSnapshot,
} from '../../services/library.service';
import {
  PlaylistService,
  PlaylistStatusEnum,
  PlaylistUi,
} from '../../services/playlist.service';
import { TrackService } from '../../services/track.service';
import { LibraryPanelComponent } from './library-panel.component';
import { SpotifySyncStatus } from './spotify-sync-state';

function completedPlaylistSync(result: { id: string; name: string; before: number; after: number }): SpotifySyncStatus {
  return { running: false, scope: 'playlist', operationId: 'fixture-operation', playlistId: result.id, playlistName: result.name,
    done: 1, total: 1, discovered: 0, changed: 1, errors: [], current: '', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), result };
}

type QueuePlaylist = Playlist & PlaylistUi;

describe('LibraryPanelComponent', () => {
  let fixture: ComponentFixture<LibraryPanelComponent>;
  let component: LibraryPanelComponent;
  function navigationFixture(): LibraryPlaylist[] {
    const items = [playlist('a', 'Alpha'), playlist('b', 'Beta'), playlist('c', 'Bravo')];
    render({ playlists: items, totals: { playlists: 3, tracks: 30, onDisk: 0, available: 0 } });
    resetActionCalls();
    return items;
  }

  it('keeps the one library-sync control outside the collapsible playlist navigation', () => {
    navigationFixture();
    const toggle = fixture.nativeElement.querySelector('.mobile-library-toggle');
    const panel = fixture.nativeElement.querySelector('#playlist-navigation');
    expect(toggle.getAttribute('aria-controls')).toBe('playlist-navigation');
    expect(panel).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.sync-library').length).toBe(1);
    expect(fixture.nativeElement.querySelector('.sync-library').closest('#playlist-navigation, .sidebar-head')).toBeNull();
  });

  it('does not close playlist navigation or issue a remote action when arrow keys preview another playlist', fakeAsync(() => {
    navigationFixture(); component.mobileLibraryOpen = true; fixture.detectChanges();
    const list = fixture.nativeElement.querySelector('.sidebar-list'); list.focus();
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    tick(); fixture.detectChanges();
    expect(component.focused?.id).toBe('b');
    expect(component.mobileLibraryOpen).toBeTrue();
    expect(document.activeElement).toBe(list);
    expectNoRemoteActions(); discardPeriodicTasks();
  }));

  it('starts at the first filtered result instead of skipping it when the old focus is hidden', () => {
    navigationFixture(); component.filter = 'B'; fixture.detectChanges();
    expect(component.focusedOptionId).toBeNull();
    fixture.nativeElement.querySelector('.sidebar-list').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();
    expect(component.focused?.id).toBe('b'); expectNoRemoteActions();
  });

  it('does not let Space select the previous playlist when filters hide it', () => {
    navigationFixture(); component.filter = 'B'; fixture.detectChanges();
    fixture.nativeElement.querySelector('.sidebar-list').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(component.selected.size).toBe(0); expectNoRemoteActions();
  });

  it('opens the chooser at its filter and returns focus to its toggle on Escape', fakeAsync(() => {
    navigationFixture();
    const toggle = fixture.nativeElement.querySelector('.mobile-library-toggle');
    toggle.click(); tick(); fixture.detectChanges();
    const filter = fixture.nativeElement.querySelector('.sidebar-search');
    expect(document.activeElement).toBe(filter);
    filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    tick(); fixture.detectChanges();
    expect(component.mobileLibraryOpen).toBeFalse(); expect(document.activeElement).toBe(toggle);
    expectNoRemoteActions(); discardPeriodicTasks();
  }));

  it('accepts the previewed playlist with Enter and focuses its heading without syncing or downloading', fakeAsync(() => {
    navigationFixture(); component.mobileLibraryOpen = true; fixture.detectChanges();
    const list = fixture.nativeElement.querySelector('.sidebar-list'); list.focus();
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    tick(); fixture.detectChanges();
    expect(component.focused?.id).toBe('b'); expect(component.mobileLibraryOpen).toBeFalse();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.detail-title'));
    expectNoRemoteActions(); discardPeriodicTasks();
  }));

  it('moves from the playlist filter into the first or last matching result with arrow keys', () => {
    navigationFixture(); component.mobileLibraryOpen = true; component.filter = 'B'; fixture.detectChanges();
    const filter = fixture.nativeElement.querySelector('.sidebar-search'); filter.focus();
    filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    const list = fixture.nativeElement.querySelector('.sidebar-list');
    expect(component.focused?.id).toBe('b'); expect(document.activeElement).toBe(list);
    expect(component.mobileLibraryOpen).toBeTrue();
    filter.focus();
    filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(component.focused?.id).toBe('c'); expect(document.activeElement).toBe(list);
    expectNoRemoteActions();
  });

  it('closes a pointer-selected playlist chooser and places focus on its new heading', () => {
    navigationFixture(); component.mobileLibraryOpen = true;
    component.spotifyConnection = { state: 'disconnected', connectedAt: null }; fixture.detectChanges();
    fixture.nativeElement.querySelector('#pl-b').click(); fixture.detectChanges();
    expect(component.focused?.id).toBe('b'); expect(component.mobileLibraryOpen).toBeFalse();
    const title = fixture.nativeElement.querySelector('.detail-title');
    expect(title.textContent.trim()).toBe('Beta'); expect(document.activeElement).toBe(title);
    expect(title.getAttribute('tabindex')).toBe('-1'); expectNoRemoteActions();
  });

  it('does not accept a filtered-out playlist and can close an empty chooser with Escape', () => {
    navigationFixture(); component.mobileLibraryOpen = true; component.filter = 'B'; fixture.detectChanges();
    const list = fixture.nativeElement.querySelector('.sidebar-list'); list.focus();
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    list.dispatchEvent(enter); fixture.detectChanges();
    expect(enter.defaultPrevented).toBeFalse(); expect(component.mobileLibraryOpen).toBeTrue();
    expect(document.activeElement).toBe(list); expect(component.focused?.id).toBe('a');
    component.filter = 'no matching result'; fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.playlist-empty').closest('#playlist-navigation')).not.toBeNull();
    const filter = fixture.nativeElement.querySelector('.sidebar-search'); filter.focus();
    filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(component.mobileLibraryOpen).toBeFalse();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.mobile-library-toggle'));
    expectNoRemoteActions();
  });

  it('does not capture modified navigation or input-method composition keys', () => {
    navigationFixture(); component.mobileLibraryOpen = true; fixture.detectChanges();
    const list = fixture.nativeElement.querySelector('.sidebar-list');
    const filter = fixture.nativeElement.querySelector('.sidebar-search');
    for (const target of [list, filter]) {
      for (const modifiers of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { isComposing: true }]) {
        const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true, ...modifiers });
        target.dispatchEvent(event); expect(event.defaultPrevented).toBeFalse();
      }
    }
    const selectionKey = new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true });
    filter.dispatchEvent(selectionKey); expect(selectionKey.defaultPrevented).toBeFalse();
    expect(component.focused?.id).toBe('a'); expectNoRemoteActions();
  });

  it('uses the latest chooser focus request and never moves focus after teardown', () => {
    navigationFixture();
    component.toggleMobileLibrary(); component.closeMobileLibrary(); component.toggleMobileLibrary();
    fixture.detectChanges();
    const filter = fixture.nativeElement.querySelector('.sidebar-search');
    expect(component.mobileLibraryOpen).toBeTrue(); expect(document.activeElement).toBe(filter);
    component.closeMobileLibrary();
    const toggle = fixture.nativeElement.querySelector('.mobile-library-toggle');
    const focus = spyOn(toggle, 'focus');
    fixture.destroy(); component.ngAfterViewChecked();
    expect(focus).not.toHaveBeenCalled(); expectNoRemoteActions();
  });

  it('uses the clipped chooser viewport when keeping a keyboard-previewed row visible', fakeAsync(() => {
    navigationFixture(); component.mobileLibraryOpen = true; fixture.detectChanges(); tick();
    const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 200,
      width: 200, height: bottom - top, x: 0, y: top, toJSON() {} }) as DOMRect;
    const list = fixture.nativeElement.querySelector('.sidebar-list');
    const navigation = fixture.nativeElement.querySelector('#playlist-navigation');
    const nextRow = fixture.nativeElement.querySelector('#pl-b');
    spyOn(list, 'getBoundingClientRect').and.returnValue(rect(0, 1000));
    spyOn(navigation, 'getBoundingClientRect').and.returnValue(rect(0, 100));
    spyOn(nextRow, 'getBoundingClientRect').and.returnValue(rect(200, 240));
    const scroll = spyOn(nextRow, 'scrollIntoView');
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges(); tick();
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    expect(component.mobileLibraryOpen).toBeTrue(); expectNoRemoteActions(); discardPeriodicTasks();
  }));

  it('retains a single working whole-library sync action whether the chooser is open or closed', () => {
    navigationFixture();
    for (const open of [true, false]) {
      component.mobileLibraryOpen = open; fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('.sync-library').length).toBe(1);
      expect(fixture.nativeElement.querySelector('.sync-library').disabled).toBeFalse();
    }
    fixture.nativeElement.querySelector('.sync-library').click();
    expect(libraryService.syncLibrary).toHaveBeenCalledTimes(1);
    expect(libraryService.syncPlaylist).not.toHaveBeenCalled();
    expect(libraryService.connectSpotifyChrome).not.toHaveBeenCalled();
    expect(libraryService.download).not.toHaveBeenCalled();
    expect(libraryService.downloadRemaining).not.toHaveBeenCalled();
  });

  it('explains a retained playlist without hiding it or blocking focused sync', () => {
    const p = playlist('kept', 'Kept playlist', { libraryPresence: { state: 'not-returned', checkedAt: '2026-09-15T04:00:00Z' } });
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    resetActionCalls();
    const note = fixture.nativeElement.querySelector('.library-presence');
    expect(note.textContent).toContain('Kept locally');
    expect(note.textContent).toContain('Not in the Spotify library checked');
    expect(note.textContent).toContain('Saved files are unchanged');
    expect(note.querySelector('time').getAttribute('datetime')).toBe(p.libraryPresence!.checkedAt);
    expect(fixture.nativeElement.querySelector('.sync-playlist').disabled).toBeFalse();
    expectNoRemoteActions();
    fixture.nativeElement.querySelector('.sync-playlist').click();
    expect(libraryService.syncPlaylist).toHaveBeenCalledOnceWith(p.id);
    expect(libraryService.syncLibrary).not.toHaveBeenCalled();
    expect(libraryService.download).not.toHaveBeenCalled();
    expect(libraryService.connectSpotifyChrome).not.toHaveBeenCalled();
  });

  for (const libraryPresence of [undefined, { state: 'present' as const, checkedAt: '2026-09-15T04:00:00Z' },
    { state: 'not-returned' as const, checkedAt: 'bad-date' }]) {
    it(`does not infer a kept-local state from ${libraryPresence?.state || 'unknown'} / ${libraryPresence?.checkedAt || 'no check'}`, () => {
      const p = playlist('observed', 'Saved playlist', { libraryPresence });
      render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
      expect(fixture.nativeElement.querySelector('.library-presence')).toBeNull();
    });
  }

  it('removes the kept-local note when a new saved-library observation returns the playlist', fakeAsync(() => {
    const p = playlist('kept', 'Kept playlist', { libraryPresence: { state: 'not-returned', checkedAt: '2026-09-15T04:00:00Z' } });
    const data = { playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } };
    render(data); resetActionCalls();
    expect(fixture.nativeElement.querySelector('.library-presence')).not.toBeNull();
    libraryService.fetch.and.returnValue(of({ ...data, playlists: [{ ...p, libraryPresence: { state: 'present', checkedAt: '2026-09-15T05:00:00Z' } }] }));
    trackService.coverageChanges$.next(); tick(200); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.library-presence')).toBeNull();
    expectNoRemoteActions();
    discardPeriodicTasks();
  }));

  it('uses one saved-progress summary without duplicate completion banners or download claims', () => {
    const p = playlist('complete-header', 'Saved playlist', { trackCount: 10, onDisk: 10, available: 10, percentOnDisk: 100, percentAvailable: 100 });
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 10, available: 10 } });
    expect(fixture.nativeElement.querySelector('.detail-title').textContent.trim()).toBe(p.name);
    expect(fixture.nativeElement.querySelector('.done-banner')).toBeNull();
    expect(fixture.nativeElement.querySelector('.coverage-label').textContent).toContain('10 of 10 saved');
    expect(fixture.nativeElement.querySelector('.coverage-label').textContent).toContain('Complete');
    expect(fixture.nativeElement.textContent).not.toContain('All tracks downloaded');
  });

  for (const verified of [false, true]) it(`describes ${verified ? 'verified' : 'legacy'} playlist freshness honestly`, () => {
    const p = playlist('freshness', 'Saved playlist', { syncedAt: '2026-09-10T06:37:19Z', membershipVerified: verified });
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    const freshness = fixture.nativeElement.querySelector('.spotify-freshness');
    expect(freshness.textContent).toContain(verified ? 'Checked with Spotify' : 'Saved locally');
    expect(freshness.textContent).not.toContain('Tracks synced');
    expect(freshness.querySelector('time').getAttribute('datetime')).toBe(p.syncedAt);
    if (!verified) expect(freshness.getAttribute('title')).toContain('not yet verified');
  });

  it('does not render an invalid saved date or pretend it was a Spotify check', () => {
    const p = playlist('invalid-date', 'Saved playlist', { syncedAt: 'not-a-date', membershipVerified: false });
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    const freshness = fixture.nativeElement.querySelector('.spotify-freshness');
    expect(freshness.textContent).toContain('Saved locally');
    expect(freshness.textContent).toContain('date unavailable');
    expect(freshness.querySelector('time')).toBeNull();
  });

  it('explains Chrome approval rather than claiming a playlist sync is already running', () => {
    render({ playlists: [], totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 } });
    resetActionCalls();
    component.spotifyConnection = { state: 'connecting', connectedAt: null };
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('.sync-library');
    expect(button.disabled).toBeTrue();
    expect(button.title).toContain('Chrome');
    expect(button.title).not.toContain('Spotify sync is already in progress');
    expectNoRemoteActions();
  });

  it('labels selected downloads in playlist units', () => {
    const p = playlist('selected-unit', 'Selected playlist');
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    component.selected.add(p.uri); fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('.download-selected');
    expect(button.textContent.trim()).toBe('Download 1 playlist');
    component.selected.add('spotify:playlist:second'); fixture.detectChanges();
    expect(button.textContent.trim()).toBe('Download 2 playlists');
  });
  function scanningLibrary(state: 'checking' | 'complete' | 'failed' = 'checking'): LibraryListResponse {
    const p = playlist('scanning', 'Scanning playlist', { trackCount: 2, coveragePending: state === 'complete' ? 0 : 2 });
    return { playlists: [p], totals: { playlists: 1, tracks: 2, onDisk: 0, available: 0 },
      coverage: { id: 'scan-one', state, checked: state === 'checking' ? 0 : 2, total: 2,
        errors: state === 'failed' ? 2 : 0, destination: '/tmp/original-downloads', current: '' } };
  }

  function useCheckingDetail(data: LibraryListResponse): void {
    libraryService.detail.and.returnValue(of({ playlist: data.playlists[0], coverage: data.coverage,
      tracks: [1, 2].map(n => ({ n, artist: 'Artist', name: `Track ${n}`, onDisk: false,
        available: false, mediaVerification: 'checking' as const })) }));
  }

  it('shows one targeted saved-file progress indicator instead of duplicating the whole-library check', () => {
    const data = scanningLibrary(); data.coverage!.scope = 'changes'; data.coverage!.updates = 'live';
    useCheckingDetail(data); render(data);
    expect(component.activity.title).toBe('Updating saved files');
    expect(component.activity.progressText).toContain('0/2 affected playlist tracks checked');
    expect(fixture.nativeElement.querySelectorAll('.operator-status').length).toBe(1);
    expect(fixture.nativeElement.querySelector('.operator-status').textContent).not.toContain('Also checking saved files');
  });

  it('discloses unavailable automatic file updates and offers a manual read without starting downloads', () => {
    const data = scanningLibrary('complete'); data.coverage!.updates = 'manual';
    libraryService.detail.and.returnValue(of({ playlist: data.playlists[0], tracks: [], coverage: data.coverage }));
    render(data); resetActionCalls();
    expect(component.activity.title).toBe('Automatic file updates unavailable');
    expect(component.activity.busy).toBeFalse();
    expect(component.bulkActionsBlocked).toBeFalse();
    libraryService.fetch.calls.reset();
    const button = fixture.nativeElement.querySelector('.recheck-files'); expect(button.disabled).toBeFalse(); button.click();
    expect(libraryService.fetch).toHaveBeenCalledOnceWith(undefined, true);
    expectNoRemoteActions();
  });

  it('coalesces live saved-file notices into observation and stops listening after disposal', fakeAsync(() => {
    const data = scanningLibrary('complete'); data.coverage!.updates = 'live';
    libraryService.detail.and.returnValue(of({ playlist: data.playlists[0], tracks: [], coverage: data.coverage }));
    render(data); libraryService.fetch.calls.reset(); resetActionCalls();
    trackService.coverageChanges$.next(); trackService.coverageChanges$.next();
    tick(149); expect(libraryService.fetch).not.toHaveBeenCalled();
    tick(1); expect(libraryService.fetch).toHaveBeenCalledOnceWith(); expectNoRemoteActions();
    component.ngOnDestroy(); libraryService.fetch.calls.reset();
    trackService.coverageChanges$.next(); tick(1000); expect(libraryService.fetch).not.toHaveBeenCalled();
  }));

  it('does not turn a missing file into a saved playable track when an old Completed event arrives', () => {
    const data = scanningLibrary('complete'), p = data.playlists[0]; p.trackCount = 1;
    const row = { n: 1, artist: 'Artist', name: 'Deleted file', spotifyUrl: 'spotify:track:1111111111111111111111',
      onDisk: false, available: false, mediaVerification: 'missing' as const };
    libraryService.detail.and.returnValue(of({ playlist: p, tracks: [row], coverage: data.coverage }));
    render(data);
    trackService.all$.next([{ id: 1, playlistId: 99, artist: row.artist, name: row.name, spotifyUrl: row.spotifyUrl,
      youtubeUrl: '', status: TrackStatusEnum.Completed }]); fixture.detectChanges();
    expect(component.detail!.tracks[0].onDisk).toBeFalse();
    expect(component.statsOf(p).onDisk).toBe(0);
    expect(fixture.nativeElement.querySelector('.tracks .play-btn')).toBeNull();
    expect(fixture.nativeElement.querySelector('.tracks .pill.on')).toBeNull();
  });

  it('shows browsable playlists and one saved-file progress indicator without inventing needed downloads', () => {
    const data = scanningLibrary(); useCheckingDetail(data); render(data);
    expect(fixture.nativeElement.querySelectorAll('.operator-status').length).toBe(1);
    expect(component.activity.title).toBe('Checking saved files');
    expect(component.activity.percent).toBe(0);
    expect(component.activity.progressText).toContain('0/2 playlist tracks checked');
    expect(fixture.nativeElement.querySelector('.pl-name').textContent).toContain('Scanning playlist');
    expect(component.statsOf(data.playlists[0]).pending).toBe(0);
    expect(component.statsOf(data.playlists[0]).checking).toBe(2);
    expect(component.bulkActionsBlocked).toBeTrue();
    expect(fixture.nativeElement.querySelector('.detail-actions').textContent).not.toContain('Queue 2');
    expect(fixture.nativeElement.querySelector('.tracks .play-btn')).toBeNull();
    expect(fixture.nativeElement.querySelector('.tracks').textContent).toContain('Checking local file');
    expect(fixture.nativeElement.querySelector('.tracks').textContent).not.toContain('Pending');
    expect(libraryService.detail).toHaveBeenCalledWith('scanning', 'scan-one');
  });

  it('observes the same scan, enables downloads after completion and stops polling', fakeAsync(() => {
    const data = scanningLibrary(); useCheckingDetail(data); render(data);
    const done = scanningLibrary('complete');
    libraryService.fetch.and.returnValue(of(done));
    libraryService.detail.and.returnValue(of({ playlist: done.playlists[0], coverage: done.coverage, tracks: [1, 2].map(n => ({ n, artist: 'Artist', name: `Track ${n}`, onDisk: false, available: false, mediaVerification: 'missing' as const })) }));
    tick(2000); fixture.detectChanges();
    expect(libraryService.fetch).toHaveBeenCalledWith('scan-one');
    expect(component.coverageIncomplete).toBeFalse();
    expect(component.statsOf(done.playlists[0]).pending).toBe(2);
    expect(component.bulkActionsBlocked).toBeFalse();
    expect(fixture.nativeElement.querySelector('.detail-actions').textContent).toContain('Queue 2');
    const calls = libraryService.fetch.calls.count(); tick(10000);
    expect(libraryService.fetch.calls.count()).toBe(calls);
    expect(libraryService.download).not.toHaveBeenCalled();
    component.ngOnDestroy();
  }));

  it('stops scan animation on connection loss and only re-observes that scan', fakeAsync(() => {
    const data = scanningLibrary(); useCheckingDetail(data); render(data);
    libraryService.fetch.and.returnValue(throwError(() => ({ status: 0 })));
    tick(2000); fixture.detectChanges();
    expect(component.activity.busy).toBeFalse();
    expect(component.activity.title).toBe('Saved-file check needs attention');
    expect(component.activity.detail).toContain('server may still be checking');
    expect(fixture.nativeElement.querySelector('.recheck-files')).not.toBeNull();
    tick(5000);
    expect(libraryService.fetch.calls.mostRecent().args).toEqual(['scan-one']);
    expect(libraryService.download).not.toHaveBeenCalled();
    component.ngOnDestroy();
  }));

  it('recovers a replaced backend scan once through a fresh read and never repeats a download', fakeAsync(() => {
    const data = scanningLibrary(); useCheckingDetail(data); render(data);
    const next = scanningLibrary('complete'); next.coverage!.id = 'scan-two';
    libraryService.detail.and.returnValue(of({ playlist: next.playlists[0], tracks: [], coverage: next.coverage }));
    libraryService.fetch.and.callFake(id => id ? throwError(() => ({ status: 409 })) : of(next));
    tick(2000);
    expect(component.data!.coverage!.id).toBe('scan-two');
    expect(libraryService.fetch.calls.allArgs().slice(-2)).toEqual([['scan-one'], []]);
    expect(libraryService.download).not.toHaveBeenCalled();
    component.ngOnDestroy();
  }));

  it('keeps a failed observation distinct from absent files and provides an explicit recheck', () => {
    const data = scanningLibrary('failed'); useCheckingDetail(data); render(data);
    expect(component.activity.busy).toBeFalse();
    expect(component.activity.title).toBe('Saved-file check needs attention');
    expect(component.trackStatusLabel(component.detail!.tracks[0])).toBe('Not checked');
    expect(component.statsOf(data.playlists[0]).pending).toBe(0);
    libraryService.fetch.calls.reset();
    fixture.nativeElement.querySelector('.recheck-files').click();
    expect(libraryService.fetch).toHaveBeenCalledOnceWith(undefined, true);
    expect(libraryService.download).not.toHaveBeenCalled();
  });

  it('cancels scan polling and ignores late observations on component disposal', fakeAsync(() => {
    const data = scanningLibrary(); useCheckingDetail(data); render(data);
    const response = new Subject<LibraryListResponse>(); libraryService.fetch.and.returnValue(response);
    tick(2000); component.ngOnDestroy();
    response.next(scanningLibrary('complete')); tick(10000);
    expect(component.data!.coverage!.state).toBe('checking');
    expect(libraryService.fetch.calls.count()).toBe(2);
  }));

  it('does not accept a missing, malformed or unrelated scan receipt as completion', fakeAsync(() => {
    const data = scanningLibrary(); useCheckingDetail(data); render(data);
    const invalid = [
      { ...scanningLibrary('complete'), coverage: undefined },
      { ...scanningLibrary('complete'), coverage: { ...scanningLibrary('complete').coverage!, id: 'different-scan' } },
      { ...scanningLibrary('complete'), coverage: { ...scanningLibrary('complete').coverage!, checked: 0 } },
    ];
    for (let i = 0; i < invalid.length; i++) {
      libraryService.fetch.and.returnValue(of(invalid[i]));
      tick(i ? 5000 : 2000);
      expect(component.data!.coverage!.state).toBe('checking');
      expect(component.coverageObservationLost).toBeTrue();
      expect(component.bulkActionsBlocked).toBeTrue();
    }
    expect(libraryService.download).not.toHaveBeenCalled();
    component.ngOnDestroy();
  }));

  it('keeps actual download activity primary while exposing local checking in the same strip', () => {
    const data = scanningLibrary(); useCheckingDetail(data); render(data);
    component.youtubePace = { ...component.youtubePace!, downloadActive: 1, searchActive: 0,
      webActivity: { active: [{ id: 8, artist: 'Artist', name: 'Downloading song', phase: 'downloading', startedAt: 1, percent: 25 }],
        recent: [], totals: { downloaded: 0, reused: 0, checked: 0 }, nextRetryAt: null, since: 1 } };
    fixture.detectChanges();
    expect(component.activity.title).toBe('Downloading audio');
    expect(fixture.nativeElement.querySelector('.operator-status').textContent).toContain('Also checking saved files');
    expect(fixture.nativeElement.querySelectorAll('.operator-status').length).toBe(1);
  });

  it('drops the previous scan’s playable rows while a new scan’s focused detail is loading', () => {
    const old = scanningLibrary('complete'); old.playlists[0].onDisk = 2;
    libraryService.detail.and.returnValue(of({ playlist: old.playlists[0], coverage: old.coverage,
      tracks: [{ n: 1, artist: 'Artist', name: 'Previously saved', onDisk: true, available: true, filename: 'old.mp3' }] }));
    render(old);
    expect(fixture.nativeElement.querySelector('.tracks .play-btn')).not.toBeNull();
    const next = scanningLibrary(); next.coverage!.id = 'new-scan';
    libraryService.fetch.and.returnValue(of(next));
    libraryService.detail.and.returnValue(NEVER);
    component.refresh(); fixture.detectChanges();
    expect(component.detail).toBeNull();
    expect(component.statsOf(next.playlists[0]).checking).toBe(2);
    expect(component.playlistActionBlockedReason).toContain('Checking');
    expect(fixture.nativeElement.querySelector('.tracks .play-btn')).toBeNull();
  });

  it('keeps live state separate for same-named Spotify versions', () => {
    const a = '1234567890123456789012', b = '2234567890123456789012';
    const p = playlist('versions', 'Versions', { trackCount: 2 });
    const tracks = [a, b].map((id, i) => ({ n: i + 1, artist: 'Artist', name: 'Version',
      spotifyUrl: `https://open.spotify.com/track/${id}`, onDisk: false, available: false }));
    libraryService.detail.and.returnValue(of({ playlist: p, tracks }));
    trackService.all$.next([{ id: 1, playlistId: 99, artist: 'Artist', name: 'Version',
      spotifyUrl: `spotify:track:${a}`, youtubeUrl: '', status: TrackStatusEnum.Searching }]);
    render({ playlists: [p], totals: { playlists: 1, tracks: 2, onDisk: 0, available: 0 } });
    component.focus(p, false);
    fixture.detectChanges();
    expect(component.liveOf(tracks[0])?.status).toBe(TrackStatusEnum.Searching);
    expect(component.liveOf(tracks[1])).toBeUndefined();
    expect(component.statusKind(tracks[1])).toBe('miss');
  });

  it('shows Needs matching version and no Play even if a stale live row says completed', () => {
    const url = 'https://open.spotify.com/track/1234567890123456789012';
    const p = playlist('versions', 'Versions', { trackCount: 1 });
    const track = { n: 1, artist: 'Artist', name: 'Wrong-length version', spotifyUrl: url,
      onDisk: false, available: false, mediaVerification: 'mismatch' as const };
    playlistService.all$.next([{ id: 99, name: p.name, spotifyUrl: p.spotifyUrl,
      active: false, isTrack: false, createdAt: 1, collapsed: false }]);
    libraryService.detail.and.returnValue(of({ playlist: p, tracks: [track] }));
    trackService.all$.next([{ id: 1, playlistId: 99, artist: track.artist, name: track.name,
      spotifyUrl: url, youtubeUrl: '', status: TrackStatusEnum.Completed }]);
    render({ playlists: [p], totals: { playlists: 1, tracks: 1, onDisk: 0, available: 0 } });
    component.focus(p, false);
    fixture.detectChanges();
    const row = fixture.nativeElement.querySelector('table.tracks tbody tr');
    expect(row.textContent).toContain('Needs matching version');
    expect(row.querySelector('.play-btn')).toBeNull();
    expect(row.querySelector('.pill.on')).toBeNull();
    expect(component.statsOf(p).onDisk).toBe(0);
    expect(component.statsOf(p).pending).toBe(1);
  });

  it('requests search evidence for the selected Spotify source, not just its title', () => {
    const p = playlist('versions', 'Versions', { trackCount: 1 });
    render({ playlists: [p], totals: { playlists: 1, tracks: 1, onDisk: 0, available: 0 } });
    const track = { n: 1, artist: 'Artist', name: 'Version', onDisk: false, available: false,
      spotifyUrl: 'https://open.spotify.com/track/2234567890123456789012' };
    libraryService.searchEvidence.and.returnValue(of({ report: null }));
    const details = document.createElement('details');
    details.open = true;
    component.loadSearchEvidence({ target: details } as unknown as Event, track);
    expect(libraryService.searchEvidence).toHaveBeenCalledOnceWith(track.artist, track.name, track.spotifyUrl);
  });

  it('has one collapsed activity surface instead of sidebar messages and a queue overlay', () => {
    render({
      playlists: [playlist('saved', 'Saved')],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });
    component.activityDetailsOpen = false;
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelectorAll('.operator-status').length,
    ).toBe(1);
    expect(fixture.nativeElement.querySelector('.activity-details')).toBeNull();
    expect(
      fixture.nativeElement
        .querySelector('.activity-toggle')
        .getAttribute('aria-expanded'),
    ).toBe('false');
    for (const selector of [
      '.sidebar-live',
      '.sidebar-attention',
      '.status-msg',
      '.live-queue',
      '.ingest-profile',
      '.playlist-state',
    ])
      expect(fixture.nativeElement.querySelector(selector)).toBeNull();
    fixture.nativeElement.querySelector('.activity-toggle').click();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('.activity-details'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement
        .querySelector('.activity-toggle')
        .getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('keeps library sync visible outside collapsed tools and explains its scope', () => {
    render({ playlists: [playlist('one', 'One')], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    const button = fixture.nativeElement.querySelector('.sync-library');
    expect(button.textContent).toContain('Sync Spotify library');
    expect(button.closest('details')).toBeNull();
    expect(fixture.nativeElement.querySelector('#spotify-sync-help').textContent).toContain('Downloads are separate');
    expect(fixture.nativeElement.querySelector('.sync-playlist').textContent).toContain('Sync this playlist');
  });

  it('requires a separate explicit confirmation before requesting any Chrome connection', () => {
    render({ playlists: [playlist('one', 'One')], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    component.librarySyncDegraded = true;
    component.syncNotice = 'CDP proxy is down';
    component.spotifyConnection = { state: 'disconnected', connectedAt: null };
    libraryService.syncLibrary.calls.reset();
    component.requestChromeConnection();
    expect(libraryService.connectSpotifyChrome).not.toHaveBeenCalled();
    component.syncLibrary();
    fixture.detectChanges();
    expect(component.chromeConnectConfirm).toBe(true);
    expect(fixture.nativeElement.querySelector('.chrome-connect-confirm').textContent).toContain('one remote-debugging permission prompt');
    expect(libraryService.syncLibrary).not.toHaveBeenCalled();
    expect(libraryService.connectSpotifyChrome).not.toHaveBeenCalled();
    const cancel = [...fixture.nativeElement.querySelectorAll('.chrome-connect-confirm button')].find((b: any) => b.textContent.trim() === 'Cancel') as HTMLButtonElement;
    cancel.click();
    expect(component.chromeConnectConfirm).toBe(false);
    expect(libraryService.connectSpotifyChrome).not.toHaveBeenCalled();
  });

  it('requests one connection and never turns connection success into an implicit sync/download', () => {
    render({ playlists: [playlist('one', 'One')], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    component.librarySyncDegraded = true;
    component.syncNotice = 'CDP proxy is down';
    component.spotifyConnection = { state: 'disconnected', connectedAt: null };
    const response = new Subject<any>();
    libraryService.connectSpotifyChrome.and.returnValue(response);
    libraryService.syncLibrary.calls.reset();
    component.offerChromeConnection();
    component.requestChromeConnection();
    component.requestChromeConnection();
    expect(libraryService.connectSpotifyChrome).toHaveBeenCalledTimes(1);
    expect(component.chromeConnectionWaiting).toBe(true);
    expect(component.activity.title).toBe('Waiting for Chrome approval');
    response.next({ state: 'connected', connectedAt: new Date().toISOString() });
    response.complete();
    expect(component.chromeConnectionWaiting).toBe(false);
    expect(component.activityReceipt?.title).toBe('Chrome connected');
    expect(component.spotifySyncIssue).not.toContain('unavailable');
    expect(libraryService.syncLibrary).not.toHaveBeenCalled();
    expect(libraryService.download).not.toHaveBeenCalled();
  });

  it('restores a pending permission request without issuing another one', () => {
    libraryService.spotifyConnection.and.returnValue(of({ state: 'connecting', connectedAt: null }));
    render({ playlists: [playlist('one', 'One')], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    expect(component.chromeConnectionWaiting).toBe(true);
    expect(component.spotifySyncBusy).toBe(true);
    component.requestChromeConnection();
    component.syncLibrary();
    expect(libraryService.connectSpotifyChrome).not.toHaveBeenCalled();
  });

  function prepareChromeRecovery(): Subject<any> {
    render({ playlists: [playlist('one', 'One')], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    component.librarySyncDegraded = true;
    component.syncNotice = 'Chrome bridge disconnected';
    component.spotifyConnection = { state: 'disconnected', connectedAt: null };
    const connection = new Subject<any>();
    libraryService.connectSpotifyChrome.and.returnValue(connection);
    component.offerChromeConnection();
    return connection;
  }

  for (const duringRequest of [false, true]) {
    it(`ignores an old health ${duringRequest ? 'failure during' : 'response before'} an acknowledged connection`, () => {
      const connection = prepareChromeRecovery();
      const health = new Subject<any>();
      libraryService.spotifyConnection.and.returnValue(health);
      if (duringRequest) component.requestChromeConnection();
      component.checkSpotifyConnection();
      if (!duringRequest) component.requestChromeConnection();
      const connected = { state: 'connected' as const, connectedAt: new Date().toISOString() };
      connection.next(connected); connection.complete();
      if (duringRequest) health.error({ status: 0 });
      else { health.next({ state: 'disconnected', connectedAt: null }); health.complete(); }
      fixture.detectChanges();
      expect(component.spotifyConnection).toEqual(connected);
      expect(component.chromeConnectionWaiting).toBeFalse();
      expect(fixture.nativeElement.querySelector('.connect-chrome-offer')).toBeNull();
      expect(libraryService.connectSpotifyChrome).toHaveBeenCalledTimes(1);
      // A later, genuinely fresh observation can still detect disconnection.
      libraryService.spotifyConnection.and.returnValue(of({ state: 'disconnected', connectedAt: null }));
      component.checkSpotifyConnection();
      expect(component.spotifyConnection?.state).toBe('disconnected');
    });
  }

  it('uses a fresh status observation after a lost connection reply instead of an older in-flight check', () => {
    const connection = prepareChromeRecovery();
    component.requestChromeConnection();
    const olderHealth = new Subject<any>();
    libraryService.spotifyConnection.and.returnValue(olderHealth);
    component.checkSpotifyConnection();
    const currentHealth = new Subject<any>();
    libraryService.spotifyConnection.and.returnValue(currentHealth);
    const reads = libraryService.spotifyConnection.calls.count();
    connection.error({ status: 0 });
    expect(libraryService.spotifyConnection.calls.count()).toBe(reads + 1);
    expect(olderHealth.observed).toBeFalse();
    currentHealth.next({ state: 'connected', connectedAt: new Date().toISOString() });
    currentHealth.complete();
    olderHealth.next({ state: 'disconnected', connectedAt: null });
    expect(component.spotifyConnection?.state).toBe('connected');
    expect(component.chromeConnectionError).toBe('');
    expect(libraryService.connectSpotifyChrome).toHaveBeenCalledTimes(1);
  });

  it('does not use an old confirmation after a health check finds Chrome already connected', () => {
    prepareChromeRecovery();
    libraryService.spotifyConnection.and.returnValue(of({ state: 'connected', connectedAt: new Date().toISOString() }));
    component.checkSpotifyConnection();
    component.requestChromeConnection();
    expect(libraryService.connectSpotifyChrome).not.toHaveBeenCalled();
    expect(component.chromeConnectConfirm).toBeFalse();
  });

  for (const fails of [false, true]) {
    it(`disposes pending Chrome observations and ${fails ? 'failed' : 'successful'} connection callbacks on teardown`, () => {
      const connection = prepareChromeRecovery();
      component.requestChromeConnection();
      const health = new Subject<any>();
      libraryService.spotifyConnection.and.returnValue(health);
      component.checkSpotifyConnection();
      component.ngOnDestroy();
      expect(health.observed).toBeFalse();
      expect(connection.observed).toBeFalse();
      const reads = libraryService.spotifyConnection.calls.count();
      if (fails) connection.error({ status: 0 });
      else connection.next({ state: 'connected', connectedAt: new Date().toISOString() });
      health.next({ state: 'connected', connectedAt: new Date().toISOString() });
      component.checkSpotifyConnection();
      component.chromeConnectConfirm = true;
      component.requestChromeConnection();
      expect(libraryService.spotifyConnection.calls.count()).toBe(reads);
      expect(libraryService.connectSpotifyChrome).toHaveBeenCalledTimes(1);
      expect(component.activityReceipt?.title).not.toBe('Chrome connected');
    });
  }

  it('never retries a failed Chrome connection from timers or health checks', fakeAsync(() => {
    render({ playlists: [playlist('one', 'One')], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    component.librarySyncDegraded = true;
    component.syncNotice = 'CDP proxy is down';
    component.spotifyConnection = { state: 'disconnected', connectedAt: null };
    libraryService.spotifyConnection.and.returnValue(of({ state: 'disconnected', connectedAt: null }));
    libraryService.connectSpotifyChrome.and.returnValue(throwError(() => ({ status: 503 })));
    component.offerChromeConnection();
    component.requestChromeConnection();
    tick(35000);
    expect(libraryService.connectSpotifyChrome).toHaveBeenCalledTimes(1);
    expect(component.chromeConnectionError).toContain('No automatic retry');
    expect(component.chromeConnectionWaiting).toBe(false);
    component.ngOnDestroy();
  }));

  it('keeps observing an existing permission request through a health-check failure', () => {
    libraryService.spotifyConnection.and.returnValue(of({ state: 'connecting', connectedAt: null }));
    render({ playlists: [playlist('one', 'One')], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    libraryService.spotifyConnection.and.returnValue(throwError(() => ({ status: 0 })));
    component.checkSpotifyConnection();
    expect(component.chromeConnectionWaiting).toBe(true);
    expect(component.chromeWaitingGuidance).toContain('Rechecking status only');
    expect(libraryService.connectSpotifyChrome).not.toHaveBeenCalled();
    libraryService.spotifyConnection.and.returnValue(of({ state: 'disconnected', connectedAt: null }));
    component.checkSpotifyConnection();
    expect(component.chromeConnectionWaiting).toBe(false);
    expect(component.chromeConnectionError).toContain('No automatic retry');
  });

  it('does not submit a new sync when the initial status request fails', () => {
    libraryService.syncLibraryStatus.and.returnValue(throwError(() => ({ status: 0 })));
    render({ playlists: [playlist('one', 'One')], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    expect(libraryService.syncLibrary).not.toHaveBeenCalled();
    expect(component.librarySyncDegraded).toBe(true);
    expect(component.data?.playlists.length).toBe(1);
  });

  it('prevents overlapping library and focused sync requests', () => {
    render({ playlists: [playlist('one', 'One')], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    const response = new Subject<any>();
    libraryService.syncPlaylist.and.returnValue(response);
    libraryService.syncLibrary.calls.reset();
    component.resyncFocused();
    component.syncLibrary();
    component.resyncFocused();
    expect(libraryService.syncPlaylist).toHaveBeenCalledTimes(1);
    expect(libraryService.syncLibrary).not.toHaveBeenCalled();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.sync-library').disabled).toBe(true);
    libraryService.syncLibraryStatus.and.returnValue(of(completedPlaylistSync({ id: 'one', name: 'One', before: 10, after: 10 })));
    response.next({ started: true });
    response.complete();
  });

  it('restores an active focused sync on reload without submitting a library or playlist request', () => {
    const running = { ...completedPlaylistSync({ id: 'one', name: 'In-flight playlist', before: 10, after: 10 }), running: true, finishedAt: null, result: null, done: 0, current: 'In-flight playlist' };
    libraryService.syncLibraryStatus.and.returnValue(of(running));
    render({ playlists: [playlist('other', 'Other playlist')], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    expect(component.resyncing).toBe(true);
    expect(component.syncPlaylistId).toBe('one');
    expect(component.spotifyActivity).toContain('In-flight playlist');
    expect(libraryService.syncLibrary).not.toHaveBeenCalled();
    expect(libraryService.syncPlaylist).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.sync-playlist').textContent).toContain('Sync this playlist');
  });

  it('restores a recently completed focused result without immediately covering it with a new library sync', () => {
    libraryService.syncLibraryStatus.and.returnValue(of(completedPlaylistSync({ id: 'one', name: 'Finished playlist', before: 10, after: 12 })));
    render({ playlists: [playlist('one', 'Finished playlist')], totals: { playlists: 1, tracks: 12, onDisk: 0, available: 0 } });
    expect(component.spotifySyncBusy).toBe(false);
    expect(component.activityReceipt?.detail).toContain('10 → 12 tracks');
    expect(libraryService.syncLibrary).not.toHaveBeenCalled();
    expect(libraryService.syncPlaylist).not.toHaveBeenCalled();
  });

  it('observes a focused operation after a dropped submission response instead of posting it again', fakeAsync(() => {
    const saved = playlist('one', 'Focused playlist');
    render({ playlists: [saved], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    const done = completedPlaylistSync({ id: saved.id, name: saved.name, before: 10, after: 12 });
    libraryService.syncPlaylist.and.returnValue(throwError(() => ({ status: 0 })));
    libraryService.syncLibraryStatus.and.returnValue(of({ ...done, running: true, done: 0, result: null, finishedAt: null }));
    component.resyncFocused();
    expect(component.resyncing).toBe(true);
    component.resyncFocused();
    expect(libraryService.syncPlaylist).toHaveBeenCalledTimes(1);
    libraryService.syncLibraryStatus.and.returnValue(of(done));
    tick(2000);
    expect(component.spotifySyncBusy).toBe(false);
    expect(component.activityReceipt?.detail).toContain('10 → 12');
    component.ngOnDestroy();
  }));

  it('follows the actual existing sync scope when another tab already owns the operation', () => {
    const saved = playlist('one', 'Requested playlist');
    render({ playlists: [saved], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    libraryService.syncPlaylist.and.returnValue(of({ started: false, already: true }));
    libraryService.syncLibraryStatus.and.returnValue(of({ ...completedPlaylistSync({ id: 'other', name: 'Other playlist', before: 1, after: 1 }), scope: 'library', running: true, current: 'Current library item', done: 3, total: 20, finishedAt: null, result: null }));
    component.resyncFocused();
    expect(component.syncScope).toBe('library');
    expect(component.resyncing).toBe(false);
    expect(component.spotifyActivity).toContain('Current library item');
    expect(libraryService.syncLibrary).toHaveBeenCalledTimes(1); // Only the original quiet startup attempt.
    expect(libraryService.syncPlaylist).toHaveBeenCalledTimes(1);
  });

  it('stops sync animation on observation loss and resumes checking without another POST', fakeAsync(() => {
    render({ playlists: [playlist('one', 'One')], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    libraryService.syncLibrary.calls.reset();
    libraryService.syncLibrary.and.returnValue(of({ started: true }));
    libraryService.syncLibraryStatus.and.returnValue(throwError(() => ({ status: 0 })));
    component.syncLibrary();
    expect(component.librarySyncConnectionLost).toBe(true);
    expect(component.spotifyActivity).toBe('');
    expect(component.spotifySyncIssue).toContain('server may still be working');
    component.syncLibrary();
    expect(libraryService.syncLibrary).toHaveBeenCalledTimes(1);
    libraryService.syncLibraryStatus.and.returnValue(of({ running: false, done: 1, total: 1, discovered: 0, changed: 0, errors: [], current: '', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() }));
    tick(2000);
    expect(component.syncingLibrary).toBe(false);
    expect(component.librarySyncConnectionLost).toBe(false);
    expect(component.activityReceipt?.detail).toContain('MP3s unchanged');
    component.ngOnDestroy();
  }));

  it('reports a server restart instead of leaving sync permanently running', () => {
    render({ playlists: [playlist('one', 'One')], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    libraryService.syncLibrary.and.returnValue(of({ started: true }));
    component.syncLibrary();
    expect(component.syncingLibrary).toBe(false);
    expect(component.error).toContain('interrupted');
    expect(component.spotifySyncBusy).toBe(false);
  });

  it('reports Spotify resync in the activity strip and acknowledges completion there', () => {
    const response = new Subject<any>();
    const saved = playlist('saved', 'Target playlist');
    render({
      playlists: [saved],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });
    libraryService.syncPlaylist.and.returnValue(response);
    component.resyncFocused();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('.activity-copy').textContent,
    ).toContain('Updating from Spotify');
    expect(
      fixture.nativeElement.querySelector('.activity-copy').textContent,
    ).toContain('Target playlist');
    expect(
      fixture.nativeElement
        .querySelector('.activity-progress')
        .getAttribute('aria-valuenow'),
    ).toBeNull();
    libraryService.syncLibraryStatus.and.returnValue(of(completedPlaylistSync({ name: saved.name, id: saved.id, before: 10, after: 12 })));
    response.next({ started: true });
    response.complete();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('.activity-copy').textContent,
    ).toContain('Playlist updated from Spotify');
    expect(component.activityEvents[0].text).toContain('10 → 12');
  });

  it('does not hide an action failure while other workers are busy', () => {
    render({
      playlists: [playlist('saved', 'Saved')],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });
    component.activityDetailsOpen = false;
    component.youtubePace = { ...component.youtubePace!, searchActive: 1 };
    component.error = 'The playlist could not be refreshed';
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('.activity-copy [role="alert"]')
        .textContent,
    ).toContain('could not be refreshed');
  });

  it('explains a verified empty Spotify playlist without calling it an unloaded dump', () => {
    const saved = { ...playlist('empty', 'Empty playlist'), trackCount: 0, membershipVerified: true, excludedItems: 0 };
    render({ playlists: [saved], totals: { playlists: 1, tracks: 0, onDisk: 0, available: 0 } });
    component.detail = { playlist: saved, tracks: [] };
    component.detailLoading = false;
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('This Spotify playlist is empty');
    expect(fixture.nativeElement.textContent).not.toContain('No tracks in this dump');
  });

  it('keeps removal and preservation acknowledgement in the existing activity surface', () => {
    const saved = playlist('shorter', 'Shorter playlist');
    render({ playlists: [saved], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    libraryService.syncPlaylist.and.returnValue(of({ started: true }));
    libraryService.syncLibraryStatus.and.returnValue(of(completedPlaylistSync({ id: saved.id, name: saved.name, before: 10, after: 8 })));
    component.resyncFocused();
    fixture.detectChanges();
    const activity = fixture.nativeElement.querySelector('.activity-copy').textContent;
    expect(activity).toContain('10 → 8 tracks');
    expect(activity).toContain('This playlist folder now follows Spotify');
    expect(libraryService.download).not.toHaveBeenCalled();
  });

  it('offers explicit Chrome recovery after a focused sync failure without requesting permission', () => {
    const saved = playlist('offline', 'Offline playlist');
    render({ playlists: [saved], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    libraryService.spotifyConnection.and.returnValue(of({ state: 'disconnected', connectedAt: null }));
    libraryService.syncPlaylist.and.returnValue(of({ started: true }));
    libraryService.syncLibraryStatus.and.returnValue(of({ ...completedPlaylistSync({ id: saved.id, name: saved.name, before: 10, after: 10 }),
      result: null, done: 0, errors: ['The Chrome connection for Spotify is unavailable. Saved membership kept.'], failureKind: 'connection' }));
    component.resyncFocused();
    expect(component.resyncing).toBe(false);
    expect(component.canOfferChromeConnection).toBe(true);
    expect(component.error).toContain('no new Chrome permission request');
    expect(libraryService.connectSpotifyChrome).not.toHaveBeenCalled();
  });

  it('separates the retained guarded CLI evidence from a live trial and disables profile activation', () => {
    render({
      playlists: [],
      totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 },
    });
    component.youtubePace = {
      downloadConc: 4,
      searchConc: 1,
      downloadActive: 0,
      searchActive: 0,
      maxPerWindow: 240,
      downloadsInWindow: 240,
      windowMs: 600000,
      coolRemainingMs: 0,
      autoStep: false,
      reason: null,
      webProfileMode: 'cli-proven',
      knownGoodProfile: {
        id: 'fixture',
        downloadConc: 4,
        searchConc: 1,
        maxPerWindow: 240,
        batchSize: 8,
        searchBuffer: 192,
        maxSearches: 10,
        networkRetries: 5,
        windowMs: 600000,
        downloadClient: 'mweb',
        searchClient: 'web_creator',
        measuredMp3PerMinute: 9.437068403019246,
        baselineMp3PerMinute: 3,
        measuredWindowMinutes: 941.07615,
        measuredAt: '2026-09-13T23:48:37.095Z',
        evidence:
          'Completed duration-guarded CLI run; whole-run throughput including cached URLs and exception recovery, not full recording-identity proof',
        webBenchmark: 'not yet run',
      },
      acquisition: {
        at: '2026-09-13T01:04:00Z',
        verifiedNewMp3: 400,
        remainingUnique: 12000,
        diskGB: 57,
        mp3PerMinute: 10,
        baselineMultiple: 10 / 3,
        elapsedMinutes: 40,
        currentProfileMp3PerMinute: 18,
        currentProfileBaselineMultiple: 6,
        contentReviewPendingUnique: 0,
        held: false,
        maxSearches: 10,
        networkRetryLimit: 5,
        networkRetries: 2,
        operationRetries: 3,
        candidateDisqualifications: 90,
        noAcceptableCandidate: 4,
        eta: {
          continuous: '2026-09-13T13:00:00Z',
          buffered25: '2026-09-13T16:00:00Z',
          provisional: true,
        },
        pace: {
          downloadConc: 4,
          searchConc: 1,
          downloadActive: 4,
          searchActive: 0,
          maxPerWindow: 240,
          downloadsInWindow: 240,
          windowMs: 600000,
          coolRemainingMs: 0,
        },
      },
    };
    fixture.detectChanges();
    component.activityDetailsOpen = true;
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('.technical-details');
    expect(panel.textContent).toContain('9.44 MP3/min');
    expect(panel.textContent).toContain('3.15× the 3/min baseline');
    expect(panel.textContent).toContain('not the current web rate');
    expect(
      fixture.nativeElement.querySelector('.activity-copy h2').textContent,
    ).toContain('CLI is downloading');
    expect(panel.textContent).toContain('57.00 GB');
    expect(panel.querySelector('button').disabled).toBeTrue();
    expect(component.canSelectProvenProfile).toBeFalse();
  });
  let libraryService: jasmine.SpyObj<LibraryService>;
  let playlistService: jasmine.SpyObj<PlaylistService> & {
    all$: BehaviorSubject<QueuePlaylist[]>;
  };
  let trackService: {
    all$: BehaviorSubject<Track[]>;
    coverageChanges$: Subject<void>;
    progress$: BehaviorSubject<Record<number, number>>;
    activeReady$: BehaviorSubject<boolean>;
    rememberError: jasmine.Spy;
    hydrateErrors: jasmine.Spy;
    ingestLibraryErrors: jasmine.Spy;
    fetchActive: jasmine.Spy;
  };

  const playlist = (
    id: string,
    name: string,
    values: Partial<LibraryPlaylist> = {},
  ): LibraryPlaylist => ({
    uri: `spotify:playlist:${id}`,
    id,
    name,
    rank: 1,
    skipped: false,
    trackCount: 10,
    onDisk: 0,
    available: 0,
    percentOnDisk: 0,
    percentAvailable: 0,
    file: `${name}.json`,
    spotifyUrl: `https://open.spotify.com/playlist/${id}`,
    failed: 0,
    ...values,
  });

  const detail = (item: LibraryPlaylist): LibraryDetail => ({
    playlist: item,
    tracks:
      item.id === 'processing'
        ? [
            {
              n: 1,
              artist: 'Artist',
              name: 'Retrying track',
              onDisk: false,
              available: false,
              error: 'Temporary YouTube failure: socket timed out',
              missing: false,
            },
          ]
        : item.id === 'searching'
          ? [
              {
                n: 1,
                artist: 'Search Artist',
                name: 'Search track',
                onDisk: false,
                available: false,
              },
            ]
          : item.id === 'mixed'
            ? [
                {
                  n: 1,
                  artist: 'Saved',
                  name: 'On disk one',
                  onDisk: true,
                  available: true,
                  filename: 'Saved - On disk one.mp3',
                },
                {
                  n: 2,
                  artist: 'Saved',
                  name: 'On disk two',
                  onDisk: true,
                  available: true,
                  filename: 'Saved - On disk two.mp3',
                },
                {
                  n: 3,
                  artist: 'Search Artist',
                  name: 'Search track',
                  onDisk: false,
                  available: false,
                },
              ]
            : item.id === 'mozart-a'
              ? [
                  {
                    n: 66,
                    artist:
                      'Wolfgang Amadeus Mozart, Andrew Smith, Joshua Pierce',
                    name: 'Sonata for Violin and Piano in E-Flat Major, K. 380: III. Rondeau',
                    onDisk: false,
                    available: false,
                  },
                ]
              : item.id === 'mozart-b'
                ? [
                    {
                      n: 1,
                      artist:
                        'Wolfgang Amadeus Mozart, Andrew Smith, Joshua Pierce',
                      name: 'Sonata for Violin and Piano in E-Flat Major, K. 380: III. Rondeau',
                      onDisk: true,
                      available: true,
                      filename:
                        'Wolfgang Amadeus Mozart, Andrew Smith, Joshua Pierce - Sonata.mp3',
                    },
                  ]
                : item.id === 'queued'
                  ? [
                      {
                        n: 1,
                        artist: 'Artist',
                        name: 'Queued track',
                        onDisk: false,
                        available: false,
                      },
                    ]
                  : item.id === 'evidence'
                    ? [
                        {
                          n: 1,
                          artist: 'Saved',
                          name: 'On disk song',
                          onDisk: true,
                          available: true,
                          filename: 'Saved - On disk song.mp3',
                        },
                        {
                          n: 2,
                          artist: 'Pending',
                          name: 'Not yet',
                          onDisk: false,
                          available: false,
                          filename: 'Pending - Not yet.mp3',
                        },
                        {
                          n: 3,
                          artist: 'Copy',
                          name: 'Elsewhere',
                          onDisk: false,
                          available: true,
                          filename: 'Copy - Elsewhere.mp3',
                        },
                      ]
                    : [],
  });

  beforeEach(async () => {
    libraryService = jasmine.createSpyObj<LibraryService>('LibraryService', [
      'fetch',
      'download',
      'downloadRequestStatus',
      'detail',
      'resync',
      'syncPlaylist',
      'resyncAll',
      'resyncAllStatus',
      'downloadRemaining',
      'syncLibrary',
      'syncLibraryStatus',
      'spotifyConnection',
      'connectSpotifyChrome',
      'youtubePace',
      'downloadLocation',
      'saveDownloadLocation',
      'searchEvidence',
      'resumeWebQueues',
      'selectProvenProfile',
    ]);

    libraryService.searchEvidence.and.returnValue(of({ report: null }));
    window.sessionStorage.removeItem(DOWNLOAD_REQUEST_STORAGE);
    libraryService.downloadRequestStatus.and.returnValue(throwError(() => ({ status: 404 })));

    const playlistSpies = jasmine.createSpyObj<PlaylistService>(
      'PlaylistService',
      [
        'fetch',
        'getTrackCount',
        'getCompletedTrackCount',
        'getStatus$',
        'toggleCollapsed',
        'delete',
        'retryFailed',
        'setActive',
      ],
    );
    playlistService = Object.assign(playlistSpies, {
      all$: new BehaviorSubject<QueuePlaylist[]>([]),
    });
    playlistService.getTrackCount.and.returnValue(of(1));
    playlistService.getCompletedTrackCount.and.returnValue(of(0));
    playlistService.getStatus$.and.returnValue(
      of(PlaylistStatusEnum.InProgress),
    );

    trackService = {
      all$: new BehaviorSubject<Track[]>([]),
      coverageChanges$: new Subject<void>(),
      progress$: new BehaviorSubject<Record<number, number>>({}),
      activeReady$: new BehaviorSubject(true),
      rememberError: jasmine.createSpy('rememberError'),
      hydrateErrors: jasmine.createSpy('hydrateErrors'),
      ingestLibraryErrors: jasmine.createSpy('ingestLibraryErrors'),
      fetchActive: jasmine.createSpy('fetchActive'),
    };

    libraryService.downloadLocation.and.returnValue(
      of({ path: '/tmp/original-downloads', source: 'environment' }),
    );
    libraryService.saveDownloadLocation.and.returnValue(
      of({ path: '/tmp/moved-downloads', source: 'saved' }),
    );
    libraryService.syncLibrary.and.returnValue(
      throwError(() => new Error('Spotify unavailable')),
    );
    libraryService.syncPlaylist.and.returnValue(of({ started: true }));
    libraryService.spotifyConnection.and.returnValue(of({ state: 'connected', connectedAt: null }));
    libraryService.connectSpotifyChrome.and.returnValue(of({ state: 'connected', connectedAt: null }));
    libraryService.syncLibraryStatus.and.returnValue(
      of({
        running: false,
        done: 0,
        total: 0,
        discovered: 0,
        changed: 0,
        errors: [],
        current: '',
        startedAt: null,
        finishedAt: null,
      }),
    );
    libraryService.youtubePace.and.returnValue(
      of({
        searchConc: 1,
        downloadConc: 1,
        searchActive: 0,
        downloadActive: 0,
        maxPerWindow: 8,
        downloadsInWindow: 0,
        windowMs: 600000,
        coolRemainingMs: 0,
        autoStep: false,
        reason: null,
        acquisitionOwner: {
          state: 'available',
          phase: null,
          telemetryFresh: false,
        },
      }),
    );
    libraryService.detail.and.callFake((id) => {
      const item = component.data?.playlists.find((p) => p.id === id);
      return of(detail(item!));
    });

    await TestBed.configureTestingModule({
      imports: [LibraryPanelComponent],
      providers: [
        { provide: LibraryService, useValue: libraryService },
        { provide: PlaylistService, useValue: playlistService },
        { provide: TrackService, useValue: trackService },
      ],
    }).compileComponents();
  });

  afterEach(() => { component?.ngOnDestroy(); window.sessionStorage.removeItem(DOWNLOAD_REQUEST_STORAGE); });

  function render(data: LibraryListResponse): void {
    libraryService.fetch.and.returnValue(of(data));
    fixture = TestBed.createComponent(LibraryPanelComponent);
    component = fixture.componentInstance;
    // Expanded explicitly to exercise diagnostics; separate tests cover collapsed defaults.
    component.activityDetailsOpen = true;
    fixture.detectChanges();
  }

  function resetActionCalls(): void {
    for (const spy of [libraryService.syncLibrary, libraryService.syncPlaylist,
      libraryService.connectSpotifyChrome, libraryService.download, libraryService.downloadRemaining]) spy.calls.reset();
  }

  function expectNoRemoteActions(): void {
    for (const spy of [libraryService.syncLibrary, libraryService.syncPlaylist,
      libraryService.connectSpotifyChrome, libraryService.download, libraryService.downloadRemaining]) expect(spy).not.toHaveBeenCalled();
  }

  function createWithPendingLibrary(): void {
    fixture = TestBed.createComponent(LibraryPanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  function renderDownloadLimits(): YoutubePaceSnapshot {
    render({ playlists: [], totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 } });
    const snapshot: YoutubePaceSnapshot = {
      ...component.youtubePace!, downloadConc: 3, searchConc: 1, maxPerWindow: 216,
      webProfileMode: 'cli-proven',
      knownGoodProfile: { id: 'tested', downloadConc: 4, searchConc: 1, maxPerWindow: 240,
        windowMs: 600000, batchSize: 8, searchBuffer: 192, downloadClient: 'mweb', searchClient: 'web_creator',
        measuredMp3PerMinute: 9.44, baselineMp3PerMinute: 3, measuredWindowMinutes: 941,
        measuredAt: '2026-09-13T23:48:37Z', evidence: 'fixture', webBenchmark: 'Not measured' },
      webQueues: { search: { paused: true, active: 0, queued: 30 }, download: { paused: true, active: 0, queued: 4 } },
    };
    component.youtubePace = snapshot;
    libraryService.youtubePace.and.returnValue(of(snapshot));
    resetActionCalls();
    fixture.detectChanges();
    return snapshot;
  }

  for (const [name, change, reason] of [
    ['custom server', (p: YoutubePaceSnapshot) => p.webProfileMode = 'custom', 'custom settings'],
    ['unknown queues', (p: YoutubePaceSnapshot) => p.webQueues = null, 'Queue status is unavailable'],
    ['unpaused queue', (p: YoutubePaceSnapshot) => p.webQueues!.search.paused = false, 'Both web queues must be paused'],
    ['other unpaused queue', (p: YoutubePaceSnapshot) => p.webQueues!.download.paused = false, 'Both web queues must be paused'],
    ['active worker', (p: YoutubePaceSnapshot) => p.webQueues!.search.active = 1, 'active web work'],
    ['active process', (p: YoutubePaceSnapshot) => p.downloadActive = 1, 'active web work'],
    ['cooldown', (p: YoutubePaceSnapshot) => p.coolRemainingMs = 10000, 'cooldown'],
    ['safety limit', (p: YoutubePaceSnapshot) => { p.downloadConc = 1; p.searchConc = 1; p.maxPerWindow = 8; }, 'safety limit'],
    ['CLI ownership', (p: YoutubePaceSnapshot) => p.acquisitionOwner!.state = 'owned', 'CLI owns YouTube'],
    ['unknown ownership', (p: YoutubePaceSnapshot) => p.acquisitionOwner!.state = 'unknown', 'Checking YouTube ownership'],
    ['server preparation', (p: YoutubePaceSnapshot) => p.webAdmission = { running: true, startedAt: Date.now(), done: 0, total: 1, phase: 'checking', playlist: '', artist: '', name: '' }, 'preparation'],
    ['local preparation', () => component.enqueueing = true, 'preparation'],
    ['folder save', () => component.savingDownloadLocation = true, 'folder'],
    ['queue resume', () => component.resumingQueues = true, 'resume request'],
    ['missing tested values', (p: YoutubePaceSnapshot) => p.knownGoodProfile = undefined, 'not available'],
    ['different interval', (p: YoutubePaceSnapshot) => p.windowMs = 300000, 'different download-start interval'],
  ] as Array<[string, (snapshot: YoutubePaceSnapshot) => unknown, string]>) {
    it(`explains and blocks download-limit restoration during ${name}`, () => {
      const snapshot = renderDownloadLimits();
      change(snapshot);
      fixture.detectChanges();
      const action = fixture.nativeElement.querySelector('.restore-download-limits');
      expect(action.disabled).toBeTrue();
      expect(action.getAttribute('aria-describedby')).toBe('download-limits-help');
      expect(fixture.nativeElement.querySelector('#download-limits-help').textContent).toContain(reason);
      action.click();
      component.selectProvenProfile();
      expect(libraryService.selectProvenProfile).not.toHaveBeenCalled();
      expectNoRemoteActions();
    });
  }

  it('restores only limits with paused backlog, shows progress and confirms the real response', () => {
    const snapshot = renderDownloadLimits();
    const reply = new Subject<YoutubePaceSnapshot>();
    const refreshed = new Subject<YoutubePaceSnapshot>();
    libraryService.selectProvenProfile.and.returnValue(reply);
    libraryService.youtubePace.and.returnValue(refreshed);
    fixture.nativeElement.querySelector('.restore-download-limits').click();
    fixture.detectChanges();
    expect(component.activity.title).toBe('Updating download limits');
    expect(component.activity.busy).toBeTrue();
    expect(component.activity.percent).toBeNull();
    expect(component.resumeBlocked).toBeTrue();
    expect(component.locationChangeBlocked).toBeTrue();
    expect(component.playlistActionBlockedReason).toContain('download-settings');
    component.selectProvenProfile();
    expect(libraryService.selectProvenProfile).toHaveBeenCalledTimes(1);
    // Actual POST returns pace only, not the extra GET telemetry.
    reply.next({ ...snapshot, downloadConc: 4, maxPerWindow: 240, webQueues: undefined, knownGoodProfile: undefined });
    fixture.detectChanges();
    expect(component.youtubePace!.webQueues).toBe(snapshot.webQueues);
    expect(component.youtubePace!.knownGoodProfile).toBe(snapshot.knownGoodProfile);
    expect(component.selectingProvenProfile).toBeFalse();
    expect(fixture.nativeElement.querySelector('.operator-status').textContent).toContain('Download limits saved');
    expect(fixture.nativeElement.querySelector('.operator-status').textContent).toContain('did not resume');
    expect(fixture.nativeElement.querySelector('.restore-download-limits')).toBeNull();
    expectNoRemoteActions();
    expect(libraryService.resumeWebQueues).not.toHaveBeenCalled();
  });

  it('uses plain already-selected text, not a disabled status button or irrelevant pause instruction', () => {
    const snapshot = renderDownloadLimits();
    snapshot.downloadConc = 4; snapshot.maxPerWindow = 240;
    snapshot.webQueues!.search.paused = false;
    snapshot.webQueues!.download.paused = false;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.restore-download-limits')).toBeNull();
    expect(fixture.nativeElement.querySelector('.download-limits-selected').textContent).toContain('already selected');
    expect(fixture.nativeElement.querySelector('#download-limits-help').textContent).toContain('No change needed');
    component.selectProvenProfile();
    expect(libraryService.selectProvenProfile).not.toHaveBeenCalled();
  });

  it('shows a server race rejection in Current activity without clearing unrelated errors', () => {
    renderDownloadLimits();
    component.error = 'Unrelated saved-library problem';
    libraryService.selectProvenProfile.and.returnValue(throwError(() => ({ status: 409, error: { message: 'CLI owns YouTube acquisition' } })));
    fixture.nativeElement.querySelector('.restore-download-limits').click();
    fixture.detectChanges();
    expect(component.error).toBe('Unrelated saved-library problem');
    expect(component.selectingProvenProfile).toBeFalse();
    expect(component.profileChangeBusy).toBeFalse();
    expect(fixture.nativeElement.querySelector('.operator-status').textContent).toContain('Settings were not changed: CLI owns');
    expect(component.activityReceipt?.title).not.toBe('Download limits saved');
  });

  it('does not reconcile a lost settings reply using a GET that started before the change', () => {
    const snapshot = renderDownloadLimits();
    const oldRead = new Subject<YoutubePaceSnapshot>();
    const freshRead = new Subject<YoutubePaceSnapshot>();
    libraryService.youtubePace.and.returnValues(oldRead, freshRead);
    (component as any).pollYoutubePace();
    libraryService.selectProvenProfile.and.returnValue(throwError(() => ({ status: 0 })));
    component.selectProvenProfile();
    const matched = { ...snapshot, downloadConc: 4, maxPerWindow: 240 };
    oldRead.next(matched);
    expect(component.profileChangeBusy).toBeTrue();
    expect(component.profileActionError).toContain('not received');
    (component as any).pollYoutubePace();
    freshRead.next(matched);
    fixture.detectChanges();
    expect(component.profileChangeBusy).toBeFalse();
    expect(component.profileActionError).toBe('');
    expect(fixture.nativeElement.querySelector('.operator-status').textContent).toContain('Current download limits confirmed');
    expect(libraryService.selectProvenProfile).toHaveBeenCalledTimes(1);
    expectNoRemoteActions();
  });

  it('reports observed different limits after a lost reply without automatically changing them again', () => {
    renderDownloadLimits();
    libraryService.selectProvenProfile.and.returnValue(throwError(() => ({ status: 500 })));
    component.selectProvenProfile();
    fixture.detectChanges();
    expect(component.profileActionError).toContain('do not match');
    expect(component.profileActionError).toContain('216 download starts per 10 min');
    expect(component.profileChangeBusy).toBeFalse();
    expect(component.activityReceipt?.title).not.toBe('Download limits saved');
    expect(libraryService.selectProvenProfile).toHaveBeenCalledTimes(1);
  });

  it('cannot overwrite an acknowledged limits change with an older status response', () => {
    const snapshot = renderDownloadLimits();
    const oldRead = new Subject<YoutubePaceSnapshot>();
    const freshRead = new Subject<YoutubePaceSnapshot>();
    const reply = new Subject<YoutubePaceSnapshot>();
    libraryService.youtubePace.and.returnValues(oldRead, freshRead);
    libraryService.selectProvenProfile.and.returnValue(reply);
    (component as any).pollYoutubePace();
    component.selectProvenProfile();
    reply.next({ ...snapshot, downloadConc: 4, maxPerWindow: 240 });
    expect(component.testedLimitsSelected).toBeTrue();
    oldRead.next(snapshot);
    expect(component.testedLimitsSelected).toBeTrue();
    expect(component.youtubePace!.maxPerWindow).toBe(240);
    expect(freshRead.observed).toBeTrue();
    freshRead.next({ ...snapshot, downloadConc: 4, maxPerWindow: 240 });
    component.selectProvenProfile();
    expect(libraryService.selectProvenProfile).toHaveBeenCalledTimes(1);
  });

  it('re-enables the restore control when a partial pause becomes fully paused', () => {
    const snapshot = renderDownloadLimits();
    snapshot.webQueues!.download.paused = false;
    fixture.detectChanges();
    const action = fixture.nativeElement.querySelector('.restore-download-limits');
    expect(action.disabled).toBeTrue();
    snapshot.webQueues!.download.paused = true;
    libraryService.selectProvenProfile.and.returnValue(NEVER);
    fixture.detectChanges();
    expect(action.disabled).toBeFalse();
    action.click();
    expect(libraryService.selectProvenProfile).toHaveBeenCalledTimes(1);
    expect(libraryService.resumeWebQueues).not.toHaveBeenCalled();
  });

  it('does not let an older failed status read erase the post-change ownership observation', () => {
    const snapshot = renderDownloadLimits();
    const oldRead = new Subject<YoutubePaceSnapshot>();
    const freshRead = new Subject<YoutubePaceSnapshot>();
    libraryService.youtubePace.and.returnValues(oldRead, freshRead);
    (component as any).pollYoutubePace();
    libraryService.selectProvenProfile.and.returnValue(of({ ...snapshot, downloadConc: 4, maxPerWindow: 240 }));
    component.selectProvenProfile();
    oldRead.error({ status: 0 });
    expect(component.youtubePace!.acquisitionOwner!.state).toBe('available');
    expect(component.youtubePace!.maxPerWindow).toBe(240);
    expect(freshRead.observed).toBeTrue();
    freshRead.next({ ...snapshot, downloadConc: 4, maxPerWindow: 240 });
    expect(component.testedLimitsSelected).toBeTrue();
  });

  for (const [name, response] of [['invalid', of({})], ['empty', EMPTY]] as const) {
    it(`does not claim success after an ${name} settings acknowledgement`, () => {
      renderDownloadLimits();
      libraryService.selectProvenProfile.and.returnValue(response as any);
      component.selectProvenProfile();
      expect(component.selectingProvenProfile).toBeFalse();
      expect(component.profileActionError).toContain('do not match');
      expect(component.activityReceipt?.title).not.toBe('Download limits saved');
    });
  }

  it('bounds a hung settings change and stops animation while observation is unavailable', fakeAsync(() => {
    renderDownloadLimits();
    libraryService.selectProvenProfile.and.returnValue(NEVER);
    libraryService.youtubePace.and.returnValue(throwError(() => ({ status: 0 })));
    component.selectProvenProfile();
    tick(20001);
    expect(component.selectingProvenProfile).toBeFalse();
    expect(component.profileChangeBusy).toBeTrue();
    expect(component.activity.busy).toBeFalse();
    expect(component.profileActionError).toContain('Checking current server settings');
    component.selectProvenProfile();
    expect(libraryService.selectProvenProfile).toHaveBeenCalledTimes(1);
    component.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('preserves a newer user acknowledgement when late settings observation succeeds', () => {
    const snapshot = renderDownloadLimits();
    const read = new Subject<YoutubePaceSnapshot>();
    libraryService.youtubePace.and.returnValue(read);
    libraryService.selectProvenProfile.and.returnValue(throwError(() => ({ status: 0 })));
    component.selectProvenProfile();
    const later = { at: Date.now() + 100, title: 'Newer action receipt', detail: 'Keep this visible' };
    component.activityReceipt = later;
    read.next({ ...snapshot, downloadConc: 4, maxPerWindow: 240 });
    expect(component.activityReceipt).toBe(later);
    expect(component.profileActionError).toBe('');
    expect(component.recentActivity.some(item => item.text.includes('server now reports the tested limits'))).toBeTrue();
  });

  it('cancels a settings request on disposal and ignores any late acknowledgement', () => {
    const snapshot = renderDownloadLimits();
    const reply = new Subject<YoutubePaceSnapshot>();
    libraryService.selectProvenProfile.and.returnValue(reply);
    component.selectProvenProfile();
    component.ngOnDestroy();
    expect(reply.observed).toBeFalse();
    libraryService.youtubePace.calls.reset();
    reply.next({ ...snapshot, downloadConc: 4, maxPerWindow: 240 });
    component.selectProvenProfile();
    expect(libraryService.youtubePace).not.toHaveBeenCalled();
    expect(libraryService.selectProvenProfile).toHaveBeenCalledTimes(1);
  });

  it('distinguishes an actually empty saved library from a filter with no matches', () => {
    render({ playlists: [], totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 } });
    expect(fixture.nativeElement.querySelector('.playlist-empty').textContent).toContain('No saved playlists yet');
    expect(fixture.nativeElement.textContent).not.toContain('No playlists match');
    expect(fixture.nativeElement.querySelector('.playlist-empty button')).toBeNull();
    expect(fixture.nativeElement.querySelector('.empty-library button').textContent).toContain('Sync Spotify library');
  });

  it('clears an unmatched filter through a real button without syncing or downloading', () => {
    const p = playlist('local', 'Saved local playlist');
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    resetActionCalls();
    component.filter = 'no such name';
    fixture.detectChanges();
    const list = fixture.nativeElement.querySelector('[role="listbox"]');
    expect(list.querySelectorAll('[role="option"]').length).toBe(0);
    expect(list.getAttribute('aria-activedescendant')).toBeNull();
    const recovery = fixture.nativeElement.querySelector('.playlist-empty button');
    expect(recovery.textContent).toContain('Clear filters');
    expect(recovery.closest('[role="listbox"]')).toBeNull();
    recovery.click();
    fixture.detectChanges();
    expect(list.querySelectorAll('[role="option"]').length).toBe(1);
    expect(list.getAttribute('aria-activedescendant')).toBe('pl-local');
    expect(component.focused?.id).toBe(p.id);
    expectNoRemoteActions();
  });

  it('explains hidden finished playlists and restores them without changing selection', () => {
    const p = playlist('finished-local', 'Finished', { onDisk: 10, available: 10, percentOnDisk: 100, percentAvailable: 100 });
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 10, available: 10 } });
    resetActionCalls();
    component.selected.add(p.id);
    component.hideComplete = true;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.playlist-empty').textContent).toContain('Finished playlists are hidden');
    fixture.nativeElement.querySelector('.playlist-empty button').click();
    fixture.detectChanges();
    expect(component.hideComplete).toBeFalse();
    expect(component.selected.has(p.id)).toBeTrue();
    expect(fixture.nativeElement.querySelectorAll('[role="option"]').length).toBe(1);
    expectNoRemoteActions();
  });

  it('shows initial loading instead of an empty-library or filter failure', () => {
    libraryService.fetch.and.returnValue(NEVER);
    createWithPendingLibrary();
    expect(fixture.nativeElement.querySelector('.main').textContent).toContain('Loading saved playlists');
    expect(fixture.nativeElement.querySelector('.empty-library')).toBeNull();
    expect(fixture.nativeElement.querySelector('.playlist-empty')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Retry loading saved playlists');
  });

  it('shows a scoped saved-library recovery action after initial failure and uses only a local read', () => {
    libraryService.fetch.and.returnValue(throwError(() => new Error('internal connection detail')));
    createWithPendingLibrary();
    resetActionCalls();
    expect(component.loading).toBeFalse();
    expect(fixture.nativeElement.querySelector('.operator-status h2').textContent).toBe('Saved library unavailable');
    expect(fixture.nativeElement.querySelector('.operator-status-main').textContent).not.toContain('internal connection detail');
    expect(fixture.nativeElement.querySelector('.empty-library')).toBeNull();
    expect(fixture.nativeElement.querySelector('.main').textContent).not.toContain('Choose a playlist');
    const recovered = { playlists: [playlist('recovered', 'Recovered')], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } };
    libraryService.fetch.and.returnValue(of(recovered));
    fixture.nativeElement.querySelector('.retry-library-load').click();
    fixture.detectChanges();
    expect(component.data).toBe(recovered);
    expect(component.libraryLoadError).toBe('');
    expect(fixture.nativeElement.querySelector('.retry-library-load')).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="option"]').textContent).toContain('Recovered');
    expectNoRemoteActions();
  });

  it('preserves cached playlists and tracks on a failed saved-library refresh', () => {
    const p = playlist('cached', 'Cached playlist');
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    const cached = component.data;
    const tracks = component.detail;
    libraryService.fetch.and.returnValue(throwError(() => new Error('offline')));
    resetActionCalls();
    component.refresh();
    fixture.detectChanges();
    expect(component.data).toBe(cached);
    expect(component.detail).toBe(tracks);
    expect(component.libraryLoadError).toContain('Showing the last loaded library');
    expect(fixture.nativeElement.querySelector('[role="option"]').textContent).toContain('Cached playlist');
    expect(fixture.nativeElement.querySelector('.retry-library-load').disabled).toBeFalse();
    expectNoRemoteActions();
  });

  it('finishes a visible library load when a newer quiet refresh supersedes it', () => {
    const old = new Subject<LibraryListResponse>();
    libraryService.fetch.and.returnValue(old);
    createWithPendingLibrary();
    const fresh = { playlists: [playlist('fresh', 'Fresh')], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } };
    libraryService.fetch.and.returnValue(of(fresh));
    component.refresh(true);
    old.next({ playlists: [], totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 } });
    old.complete();
    fixture.detectChanges();
    expect(component.loading).toBeFalse();
    expect(component.data).toBe(fresh);
    expect(fixture.nativeElement.querySelector('.main').textContent).not.toContain('Loading saved playlists');
  });

  it('ends a half-open library read after 30 seconds and enables recovery', fakeAsync(() => {
    libraryService.fetch.and.returnValue(NEVER);
    libraryService.spotifyConnection.and.returnValue(of({ state: 'disconnected', connectedAt: null }));
    createWithPendingLibrary();
    resetActionCalls();
    tick(29999);
    expect(component.loading).toBeTrue();
    tick(1);
    fixture.detectChanges();
    expect(component.loading).toBeFalse();
    expect(fixture.nativeElement.querySelector('.retry-library-load').disabled).toBeFalse();
    expectNoRemoteActions();
    component.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('stops pending library reads when disposed and ignores later refreshes', () => {
    const pending = new Subject<LibraryListResponse>();
    libraryService.fetch.and.returnValue(pending);
    createWithPendingLibrary();
    const calls = libraryService.fetch.calls.count();
    component.ngOnDestroy();
    expect(pending.observed).toBeFalse();
    pending.next({ playlists: [], totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 } });
    component.refresh();
    expect(component.data).toBeNull();
    expect(libraryService.fetch.calls.count()).toBe(calls);
  });

  it('does not clear an unrelated action error when a saved-library retry succeeds', () => {
    render({ playlists: [], totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 } });
    libraryService.fetch.and.returnValue(throwError(() => new Error('offline')));
    component.refresh();
    component.error = 'Download request was rejected';
    libraryService.fetch.and.returnValue(of({ playlists: [], totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 } }));
    component.refresh();
    expect(component.libraryLoadError).toBe('');
    expect(component.error).toBe('Download request was rejected');
  });

  it('explains a failed track-list load in Current activity and retries only that saved playlist', () => {
    const p = playlist('tracks-offline', 'Offline tracks');
    libraryService.detail.and.returnValue(throwError(() => new Error('HTTP failure')));
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    resetActionCalls();
    libraryService.fetch.calls.reset();
    expect(fixture.nativeElement.querySelector('.operator-status h2').textContent).toBe('Playlist tracks unavailable');
    expect(fixture.nativeElement.querySelector('.operator-status-main').textContent).toContain('Offline tracks');
    expect(component.detailLoading).toBeFalse();
    const recovered = detail(p);
    libraryService.detail.and.returnValue(of(recovered));
    fixture.nativeElement.querySelector('.retry-track-load').click();
    fixture.detectChanges();
    expect(component.detail).toBe(recovered);
    expect(component.detailLoadError).toBe('');
    expect(fixture.nativeElement.querySelector('.retry-track-load')).toBeNull();
    expect(libraryService.fetch).not.toHaveBeenCalled();
    expectNoRemoteActions();
  });

  it('keeps the last loaded tracks when refreshing their saved view fails', () => {
    const p = playlist('kept-tracks', 'Keep these tracks');
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    const saved = component.detail;
    libraryService.detail.and.returnValue(throwError(() => new Error('offline')));
    component.loadDetail(p);
    fixture.detectChanges();
    expect(component.detail).toBe(saved);
    expect(component.detailLoadError).toContain('Showing the last loaded track list');
    expect(fixture.nativeElement.querySelector('.retry-track-load')).not.toBeNull();
  });

  it('ends a half-open track-list read and shows a recoverable error', fakeAsync(() => {
    const p = playlist('slow-tracks', 'Slow tracks');
    libraryService.detail.and.returnValue(NEVER);
    libraryService.spotifyConnection.and.returnValue(of({ state: 'disconnected', connectedAt: null }));
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    expect(component.activity.title).toBe('Loading saved tracks');
    expect(component.activity.busy).toBeTrue();
    tick(30000);
    fixture.detectChanges();
    expect(component.detailLoading).toBeFalse();
    expect(component.activity.busy).toBeFalse();
    expect(fixture.nativeElement.querySelector('.retry-track-load')).not.toBeNull();
    component.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('ignores stale same-playlist track responses after a newer quiet read', () => {
    const p = playlist('same-tracks', 'Same playlist');
    const old = new Subject<LibraryDetail>();
    libraryService.detail.and.returnValue(old);
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    const newest = { playlist: p, tracks: [{ n: 1, artist: 'Correct', name: 'Newest', onDisk: false, available: false }] };
    libraryService.detail.and.returnValue(of(newest));
    component.loadDetail(p, true);
    old.next(detail(p));
    old.complete();
    expect(component.detail).toBe(newest);
    expect(component.detailLoading).toBeFalse();
  });

  it('clears an obsolete track-list failure when another playlist is opened', () => {
    const p = playlist('unavailable-tracks', 'Unavailable');
    const next = playlist('available-tracks', 'Available');
    libraryService.detail.and.returnValue(throwError(() => new Error('offline')));
    render({ playlists: [p, next], totals: { playlists: 2, tracks: 20, onDisk: 0, available: 0 } });
    component.focus(p, false);
    libraryService.detail.and.returnValue(of(detail(next)));
    component.focus(next, false);
    fixture.detectChanges();
    expect(component.detailLoadError).toBe('');
    expect(component.error).toBe('');
    expect(fixture.nativeElement.querySelector('.retry-track-load')).toBeNull();
  });

  it('cancels a disposed track-list read and cannot focus or load again', () => {
    const p = playlist('disposed-tracks', 'Disposed');
    const pending = new Subject<LibraryDetail>();
    libraryService.detail.and.returnValue(pending);
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    const calls = libraryService.detail.calls.count();
    component.ngOnDestroy();
    expect(pending.observed).toBeFalse();
    pending.next(detail(p));
    component.focus(p);
    component.loadDetail(p);
    expect(component.detail).toBeNull();
    expect(libraryService.detail.calls.count()).toBe(calls);
  });

  it('loads candidate diagnostics only on demand and explains missing historical evidence', () => {
    const p = playlist('evidence', 'Evidence playlist');
    render({
      playlists: [p],
      totals: { playlists: 1, tracks: 1, onDisk: 0, available: 0 },
    });
    const track: any = {
      n: 1,
      name: 'The Setup',
      artist: 'K Scope',
      onDisk: false,
      available: false,
      searchLimit: 10,
    };
    component.focused = p;
    component.detail = { playlist: p, tracks: [track] };
    fixture.detectChanges();
    expect(libraryService.searchEvidence).not.toHaveBeenCalled();
    const disclosure = fixture.nativeElement.querySelector(
      '.search-evidence',
    ) as HTMLDetailsElement;
    disclosure.open = true;
    disclosure.dispatchEvent(new Event('toggle'));
    fixture.detectChanges();
    expect(libraryService.searchEvidence).toHaveBeenCalledOnceWith(
      'K Scope',
      'The Setup',
      undefined,
    );
    expect(disclosure.textContent).toContain(
      'No per-candidate evidence was saved',
    );
    disclosure.dispatchEvent(new Event('toggle'));
    expect(libraryService.searchEvidence).toHaveBeenCalledTimes(1);
    expect(libraryService.download).not.toHaveBeenCalled();
  });

  it('renders query, candidate link, duration and reason from durable evidence', () => {
    const p = playlist('evidence', 'Evidence playlist');
    libraryService.searchEvidence.and.returnValue(
      of({
        report: {
          policy: 'identity-variants-v1',
          finishedAt: '2026-09-15T01:00:00Z',
          expectedSeconds: 250.5,
          toleranceSeconds: 12.525,
          outcome: 'no-candidate',
          uniqueCandidates: 1,
          queries: [
            {
              query: 'K Scope The Setup',
              candidates: [
                {
                  videoId: 'abcdefghijk',
                  title: 'K Scope The Setup',
                  url: 'https://www.youtube.com/watch?v=abcdefghijk',
                  durationSeconds: 338,
                  reason: 'mismatch',
                  duplicate: false,
                },
              ],
            },
          ],
        },
      }),
    );
    render({
      playlists: [p],
      totals: { playlists: 1, tracks: 1, onDisk: 0, available: 0 },
    });
    const track: any = {
      name: 'The Setup',
      artist: 'K Scope',
      onDisk: false,
      available: false,
      searchLimit: 10,
    };
    component.focused = p;
    component.detail = { playlist: p, tracks: [track] };
    component.loadSearchEvidence({ target: { open: true } } as any, track);
    fixture.detectChanges();
    const disclosure = fixture.nativeElement.querySelector('.search-evidence');
    expect(disclosure.textContent).toContain('250.5s');
    expect(disclosure.textContent).toContain('338s · wrong length');
    expect(disclosure.textContent).toContain('No candidate passed all checks');
    expect(disclosure.querySelector('a').href).toBe(
      'https://www.youtube.com/watch?v=abcdefghijk',
    );
    track.searchEvidence.outcome = 'selected';
    track.searchEvidence.selectedUrl =
      'https://www.youtube.com/watch?v=abcdefghijk';
    fixture.detectChanges();
    expect(disclosure.textContent).toContain('not proof of a downloaded MP3');
    expect(disclosure.querySelector('strong').textContent).toContain(
      'selected',
    );
  });

  it('manual refresh reloads CLI-written track state as well as disk coverage', () => {
    render({
      playlists: [],
      totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 },
    });
    trackService.fetchActive.calls.reset();
    component.refresh();
    expect(trackService.fetchActive).toHaveBeenCalledTimes(1);
    component.refresh(true);
    expect(trackService.fetchActive).toHaveBeenCalledTimes(1);
  });

  it('allows another evidence read after a temporary error without claiming exhaustion', () => {
    render({
      playlists: [],
      totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 },
    });
    libraryService.searchEvidence.and.returnValue(
      throwError(() => new Error('offline')),
    );
    const track: any = { name: 'Song', artist: 'Artist' };
    const event: any = { target: { open: true } };
    component.loadSearchEvidence(event, track);
    expect(track.searchEvidenceLoaded).not.toBeTrue();
    expect(track.searchEvidenceError).toContain('Could not load');
    libraryService.searchEvidence.and.returnValue(of({ report: null }));
    component.loadSearchEvidence(event, track);
    expect(track.searchEvidenceLoaded).toBeTrue();
  });

  it('loads the server folder and saves it before rescanning without starting downloads or Spotify resync', () => {
    const p = playlist('location', 'Moved library');
    render({
      playlists: [p],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });
    const syncCalls = libraryService.syncLibrary.calls.count();
    const fetchCalls = libraryService.fetch.calls.count();
    expect(component.downloadPathDraft).toBe('/tmp/original-downloads');
    const pending = new Subject<{ path: string; source: 'saved' }>();
    libraryService.saveDownloadLocation.and.returnValue(pending);
    component.audioUrl = '/api/library/audio/old/1';
    component.downloadPathDraft = ' /tmp/moved-downloads ';
    component.saveDownloadLocation();
    expect(component.savingDownloadLocation).toBeTrue();
    expect(component.bulkActionsBlocked).toBeTrue();
    component.downloadUris([p.uri]);
    expect(libraryService.download).not.toHaveBeenCalled();
    expect(libraryService.fetch.calls.count()).toBe(fetchCalls);
    pending.next({ path: '/tmp/moved-downloads', source: 'saved' });
    pending.complete();
    fixture.detectChanges();
    expect(libraryService.saveDownloadLocation).toHaveBeenCalledOnceWith(
      '/tmp/moved-downloads',
    );
    expect(component.downloadLocation?.path).toBe('/tmp/moved-downloads');
    expect(component.audioUrl).toBe('');
    expect(component.savingDownloadLocation).toBeFalse();
    expect(libraryService.fetch.calls.count()).toBe(fetchCalls + 1);
    expect(libraryService.download).not.toHaveBeenCalled();
    expect(libraryService.syncPlaylist).not.toHaveBeenCalled();
    expect(libraryService.syncLibrary.calls.count()).toBe(syncCalls);
    expect(
      fixture.nativeElement.querySelector(
        '.download-location-settings [role="status"]',
      ).textContent,
    ).toContain('No files moved or deleted');
  });

  it('keeps the active folder and saved counts on an invalid or busy-location response', () => {
    render({
      playlists: [],
      totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 },
    });
    const fetchCalls = libraryService.fetch.calls.count();
    libraryService.saveDownloadLocation.and.returnValue(
      throwError(() => ({ error: { message: 'Folder does not exist' } })),
    );
    component.downloadPathDraft = '/absent';
    component.saveDownloadLocation();
    fixture.detectChanges();
    expect(component.downloadLocation?.path).toBe('/tmp/original-downloads');
    expect(component.locationError).toBe('Folder does not exist');
    expect(component.savingDownloadLocation).toBeFalse();
    expect(libraryService.fetch.calls.count()).toBe(fetchCalls);
  });

  it('does not change download location while a CLI owns acquisition or web processes are active', () => {
    render({
      playlists: [],
      totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 },
    });
    component.downloadPathDraft = '/tmp/moved-downloads';
    component.youtubePace = {
      ...component.youtubePace!,
      acquisitionOwner: {
        state: 'owned',
        phase: 'running',
        telemetryFresh: true,
      },
    };
    component.saveDownloadLocation();
    component.youtubePace = {
      ...component.youtubePace!,
      acquisitionOwner: {
        state: 'available',
        phase: null,
        telemetryFresh: false,
      },
      downloadActive: 1,
    };
    component.saveDownloadLocation();
    expect(libraryService.saveDownloadLocation).not.toHaveBeenCalled();
  });

  it('ignores coverage responses issued before changing the download folder', () => {
    render({
      playlists: [],
      totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 },
    });
    const stale = new Subject<LibraryListResponse>();
    libraryService.fetch.and.returnValue(stale);
    component.refresh();
    const fresh: LibraryListResponse = {
      playlists: [],
      totals: { playlists: 0, tracks: 10, onDisk: 10, available: 10 },
    };
    libraryService.fetch.and.returnValue(of(fresh));
    component.downloadPathDraft = '/tmp/moved-downloads';
    component.saveDownloadLocation();
    stale.next({
      playlists: [],
      totals: { playlists: 0, tracks: 10, onDisk: 0, available: 0 },
    });
    stale.complete();
    expect(component.data).toBe(fresh);
  });

  it('shows the playlist owner in the list and detail with a reusable Spotify profile link', () => {
    const p = playlist('owner', 'Owned playlist', {
      owner: {
        id: 'curator',
        displayName: 'Curator <name>',
        spotifyUrl: 'https://open.spotify.com/user/curator',
        source: 'spotify-api',
      },
    });
    render({
      playlists: [p],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });
    component.focus(p, false);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('.pl-owner').textContent,
    ).toContain('Owner: Curator <name>');
    const attribution = fixture.nativeElement.querySelector(
      '.playlist-attribution',
    );
    expect(attribution.textContent).toContain('Curator <name>');
    expect(attribution.querySelector('name')).toBeNull();
    expect(attribution.querySelector('a').getAttribute('href')).toBe(
      'https://open.spotify.com/user/curator',
    );
    expect(attribution.querySelector('a').getAttribute('target')).toBe(
      'spooty-spotify',
    );
    expect(component.playlistOptionLabel(p)).toContain('Owner: Curator <name>');
    expect(libraryService.syncPlaylist).not.toHaveBeenCalled();
    expect(libraryService.download).not.toHaveBeenCalled();
  });

  it('shows legacy attribution without inventing a profile link', () => {
    const p = playlist('legacy-owner', 'Cached playlist', {
      owner: {
        id: null,
        displayName: 'Saved Curator',
        spotifyUrl: null,
        source: 'saved-subtitle',
      },
    });
    render({
      playlists: [p],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });
    component.focus(p, false);
    fixture.detectChanges();
    const attribution = fixture.nativeElement.querySelector(
      '.playlist-attribution',
    );
    expect(attribution.textContent).toContain('Saved Curator');
    expect(attribution.querySelector('a')).toBeNull();
    expect(attribution.querySelector('[title]').title).toContain(
      'saved Spotify library subtitle',
    );
  });

  it('keeps personalization distinct from missing owner metadata', () => {
    const p = playlist('personalized', 'Personalized playlist', {
      owner: null,
      personalizedFor: 'Listener',
    });
    render({
      playlists: [p],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });
    component.focus(p, false);
    fixture.detectChanges();
    const attribution = fixture.nativeElement.querySelector(
      '.playlist-attribution',
    );
    expect(attribution.textContent).toContain('Owner not available');
    expect(attribution.textContent).toContain('Made for Listener');
    expect(attribution.textContent).not.toContain('Owner: Listener');
    expect(
      fixture.nativeElement.querySelector('.pl-owner').textContent,
    ).toContain('Made for Listener');
    component.focused = { ...p, personalizedFor: null };
    fixture.detectChanges();
    expect(attribution.textContent.trim()).toBe('Owner not available');
  });

  it('retains ownership and holds all acquisition actions with stale CLI telemetry', () => {
    const p = playlist('held', 'Held work', { failed: 1 });
    libraryService.detail.and.returnValue(
      of({
        playlist: p,
        tracks: [
          {
            name: 'Missing track',
            artist: 'Artist',
            onDisk: false,
            available: false,
            acquisitionState: 'missing',
            missing: true,
            error: 'No YouTube result',
          },
        ],
      }),
    );
    render({
      playlists: [p],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });
    component.focus(p, false);
    component.youtubePace = {
      ...component.youtubePace!,
      acquisition: null,
      acquisitionOwner: {
        state: 'owned',
        phase: 'unknown',
        telemetryFresh: false,
      },
    };
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('.operator-status').textContent,
    ).toContain('CLI is managing downloads');
    expect(component.bulkActionsBlocked).toBeTrue();
    expect(component.canSelectProvenProfile).toBeFalse();
    const retry = fixture.nativeElement.querySelector(
      '.retry-outcomes',
    ) as HTMLButtonElement;
    expect(retry.disabled).toBeTrue();
    component.downloadFocused();
    component.retryFocusedOutcomes();
    component.downloadRemaining();
    expect(libraryService.download).not.toHaveBeenCalled();
    expect(libraryService.downloadRemaining).not.toHaveBeenCalled();
    expect(component.paceLine()).not.toContain('YouTube 1+1');
  });

  it('distinguishes recovery, draining, and unknown ownership without starting work', () => {
    render({
      playlists: [],
      totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 },
    });
    for (const phase of ['waiting-for-recovery', 'draining'] as const) {
      component.youtubePace = {
        ...component.youtubePace!,
        acquisitionOwner: { state: 'owned', phase, telemetryFresh: true },
      };
      expect(component.ownerBlocksAcquisition).toBeTrue();
      expect(component.acquisitionOwnerLabel).toContain(
        phase === 'draining' ? 'draining current work' : 'waiting for recovery',
      );
    }
    component.youtubePace = {
      ...component.youtubePace!,
      acquisitionOwner: {
        state: 'unknown',
        phase: null,
        telemetryFresh: false,
      },
    };
    expect(component.bulkActionsBlocked).toBeTrue();
    expect(component.acquisitionGuardText).toContain('ownership');
  });

  it('shows exhausted candidates as needs-action without inventing a scheduled retry', () => {
    const p = playlist('exhausted', 'Exhausted search', { trackCount: 1 });
    playlistService.all$.next([
      {
        id: 991,
        name: p.name,
        spotifyUrl: p.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 881,
        name: 'Version',
        artist: 'Artist',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.RetryWaiting,
        playlistId: 991,
        error:
          'No acceptable duration-matched YouTube candidate in the configured search results',
        searchLimit: 10,
        networkAttempts: 0,
        operationAttempts: 0,
      },
    ]);
    libraryService.detail.and.returnValue(
      of({
        playlist: p,
        tracks: [
          {
            n: 0,
            name: 'Version',
            artist: 'Artist',
            onDisk: false,
            available: false,
          },
        ],
      }),
    );
    render({
      playlists: [p],
      totals: { playlists: 1, tracks: 1, onDisk: 0, available: 0 },
    });
    component.focus(p, false);
    fixture.detectChanges();
    const t = component.detail!.tracks[0];
    expect(component.trackStatusLabel(t)).toBe('No acceptable candidate');
    expect(component.liveRetrying).toBe(0);
    expect(component.hasQueuedWork).toBeFalse();
    expect(component.statsOf(p).needsRetry).toBe(1);
    expect(component.statsOf(p).done).toBeFalse();
    expect(
      fixture.nativeElement.querySelector('.tracks').textContent,
    ).not.toContain('Retry scheduled');
    expect(component.candidateEvidence(t)).toContain(
      'Search finished without a match',
    );
    expect(
      fixture.nativeElement.querySelector('.retry-outcomes').textContent,
    ).toContain('1 without a match');
  });

  it('requires a retry deadline for typed retry state and respects physical success', () => {
    render({
      playlists: [],
      totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 },
    });
    const track = {
      name: 'A',
      artist: 'B',
      onDisk: false,
      available: false,
      acquisitionState: 'retry' as const,
      retryAt: null as number | null,
    };
    expect(component.statusKind(track)).toBe('retry');
    track.retryAt = Date.now() + 60000;
    expect(component.statusKind(track)).toBe('scheduled');
    track.retryAt = Date.now() - 1000;
    expect(component.statusKind(track)).toBe('queue');
    expect(
      component.statusKind({
        ...track,
        acquisitionState: 'no-candidate',
        onDisk: true,
      }),
    ).toBe('disk');
  });

  it('keeps CLI journal evidence visible over a legacy idle websocket row', () => {
    render({
      playlists: [],
      totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 },
    });
    spyOn(component, 'liveOf').and.returnValue({
      id: 1,
      name: 'Version',
      artist: 'Artist',
      spotifyUrl: '',
      youtubeUrl: '',
      status: TrackStatusEnum.Error,
      percent: 0,
      searchLimit: 0,
    });
    expect(
      component.candidateEvidence({
        name: 'Version',
        artist: 'Artist',
        onDisk: false,
        available: false,
        acquisitionState: 'no-candidate',
        searchLimit: 10,
        networkAttempts: 0,
        operationAttempts: 0,
      }),
    ).toContain('Search finished without a match');
  });

  it('shows a successful queue acknowledgement without opening Activity details', () => {
    const p = playlist('queue-receipt', 'Queue receipt');
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    component.activityDetailsOpen = false;
    libraryService.download.and.returnValue(of({ queued: 2, skipped: 8 }));
    component.downloadFocused();
    fixture.detectChanges();
    const activity = fixture.nativeElement.querySelector('.operator-status-main');
    expect(activity.textContent).toContain('2 tracks added to the queue');
    expect(activity.textContent).toContain('8 unchanged');
    expect(fixture.nativeElement.querySelector('.activity-details')).toBeNull();
    expect(activity.textContent).not.toContain('MP3 downloaded');
  });

  it('explains a no-op queue request without claiming that anything downloaded', () => {
    const p = playlist('queue-noop', 'No-op');
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    libraryService.download.and.returnValue(of({ queued: 0, skipped: 10 }));
    component.downloadFocused();
    expect(component.activityReceipt?.title).toBe('No new downloads queued');
    expect(component.activityReceipt?.detail).toContain('10 unchanged');
  });

  it('distinguishes added local MP3s from unchanged entries and new downloads', () => {
    const p = playlist('queue-reuse', 'Local reuse');
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    libraryService.download.and.returnValue(of({ queued: 0, skipped: 10, reused: 4 }));
    component.downloadFocused();
    fixture.detectChanges();
    const receipt = fixture.nativeElement.querySelector('.operator-status-main').textContent;
    expect(receipt).toContain('Existing MP3s added');
    expect(receipt).toContain('Added 4 existing MP3s (no download)');
    expect(receipt).toContain('6 unchanged');
    expect(receipt).not.toContain('10 unchanged');
  });

  it('does not clear a newer selection when an earlier selection finishes queueing', () => {
    const one = playlist('selection-one', 'One');
    const two = playlist('selection-two', 'Two');
    render({ playlists: [one, two], totals: { playlists: 2, tracks: 20, onDisk: 0, available: 0 } });
    const pending = new Subject<{ queued: number; skipped: number }>();
    libraryService.download.and.returnValue(pending);
    component.selected = new Set([one.uri]);
    component.downloadSelected();
    component.selected.add(two.uri);
    pending.next({ queued: 1, skipped: 9 });
    expect([...component.selected]).toEqual([two.uri]);
  });

  it('ends a half-open queue request without claiming failure or automatically submitting again', fakeAsync(() => {
    const p = playlist('queue-timeout', 'Slow acknowledgement');
    libraryService.spotifyConnection.and.returnValue(of({ state: 'disconnected', connectedAt: null }));
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    libraryService.download.and.returnValue(NEVER);
    component.downloadFocused();
    tick(119999);
    expect(component.enqueueing).toBeTrue();
    tick(1);
    fixture.detectChanges();
    expect(component.enqueueing).toBeFalse();
    expect(component.error).toContain('Could not confirm');
    expect(component.error).toContain('server may still be working');
    expect(component.error).not.toContain('Download failed');
    expect(component.activityReceipt).toBeNull();
    expect(libraryService.download).toHaveBeenCalledTimes(1);
    expect(trackService.fetchActive).toHaveBeenCalled();
    component.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('treats malformed queue acknowledgements as unknown, never invented success', () => {
    const p = playlist('invalid-ack', 'Invalid reply');
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    libraryService.download.and.returnValue(of({ queued: 0, skipped: 1, reused: 10 }));
    component.downloadFocused();
    expect(component.error).toContain('Could not confirm');
    expect(component.enqueueing).toBeFalse();
    expect(component.activityReceipt).toBeNull();
    expect(libraryService.download).toHaveBeenCalledTimes(1);
  });

  it('distinguishes server rejection and clears only its own error on a later successful action', () => {
    const p = playlist('rejected-ack', 'Rejected');
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    libraryService.download.and.returnValue(throwError(() => ({ status: 409, error: { message: 'CLI owns acquisition' } })));
    component.downloadFocused();
    expect(component.error).toContain('was rejected');
    expect(component.error).toContain('CLI owns acquisition');
    libraryService.download.and.returnValue(of({ queued: 0, skipped: 10 }));
    component.downloadFocused();
    expect(component.error).toBe('');
    component.error = 'Unrelated action needs attention';
    component.downloadFocused();
    expect(component.error).toBe('Unrelated action needs attention');
  });

  it('applies the same finite acknowledgement behavior to whole-library requests', fakeAsync(() => {
    render({ playlists: [], totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 } });
    libraryService.downloadRemaining.and.returnValue(NEVER);
    component.downloadRemaining();
    tick(120000);
    expect(component.enqueueing).toBeFalse();
    expect(component.error).toContain('Could not confirm');
    expect(libraryService.downloadRemaining).toHaveBeenCalledTimes(1);
    component.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('cancels disposed queue requests and never fetches state or submits from a late reply', () => {
    const p = playlist('disposed-queue', 'Disposed request');
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    const pending = new Subject<{ queued: number; skipped: number }>();
    libraryService.download.and.returnValue(pending);
    component.downloadFocused();
    component.ngOnDestroy();
    libraryService.fetch.calls.reset();
    pending.next({ queued: 1, skipped: 9 });
    component.downloadFocused();
    component.downloadRemaining();
    expect(pending.observed).toBeFalse();
    expect(libraryService.download).toHaveBeenCalledTimes(1);
    expect(libraryService.downloadRemaining).not.toHaveBeenCalled();
    expect(libraryService.fetch).not.toHaveBeenCalled();
  });

  it('never overlaps queue-state polls and recovers after a stalled read times out', fakeAsync(() => {
    const stalled = new Subject<YoutubePaceSnapshot>();
    libraryService.youtubePace.calls.reset();
    libraryService.youtubePace.and.returnValue(stalled);
    render({ playlists: [], totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 } });
    tick(9999);
    expect(libraryService.youtubePace).toHaveBeenCalledTimes(1);
    const recovered: YoutubePaceSnapshot = { searchConc: 1, downloadConc: 1, searchActive: 0, downloadActive: 0,
      maxPerWindow: 8, downloadsInWindow: 0, windowMs: 600000, coolRemainingMs: 0, autoStep: false, reason: null,
      acquisitionOwner: { state: 'available', phase: null, telemetryFresh: false } };
    libraryService.youtubePace.and.returnValue(of(recovered));
    tick(1);
    expect(libraryService.youtubePace).toHaveBeenCalledTimes(2);
    expect(component.youtubePace).toBe(recovered);
    expect(stalled.observed).toBeFalse();
    stalled.next({ ...recovered, searchActive: 8 });
    expect(component.youtubePace?.searchActive).toBe(0);
    component.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('ignores queue telemetry after disposal instead of restarting UI work', () => {
    const pending = new Subject<YoutubePaceSnapshot>();
    libraryService.youtubePace.and.returnValue(pending);
    render({ playlists: [], totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 } });
    component.ngOnDestroy();
    expect(pending.observed).toBeFalse();
    const before = libraryService.youtubePace.calls.count();
    (component as any).pollYoutubePace();
    expect(libraryService.youtubePace.calls.count()).toBe(before);
  });

  it('recovers a lost resume reply from observed queue state without repeating the POST', fakeAsync(() => {
    render({ playlists: [], totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 } });
    const paused = { ...component.youtubePace!, webQueues: {
      search: { paused: true, active: 0, queued: 1 }, download: { paused: true, active: 0, queued: 0 } } };
    component.youtubePace = paused;
    libraryService.youtubePace.and.returnValue(of(paused));
    libraryService.resumeWebQueues.and.returnValue(NEVER);
    component.resumeConfirm = true;
    component.resumeWebQueues();
    tick(20000);
    expect(component.resumingQueues).toBeFalse();
    expect(component.resumeError).toContain('Could not confirm');
    expect(libraryService.resumeWebQueues).toHaveBeenCalledTimes(1);
    libraryService.youtubePace.and.returnValue(of({ ...paused, webQueues: {
      search: { paused: false, active: 0, queued: 1 }, download: { paused: false, active: 0, queued: 0 } } }));
    tick(2000);
    fixture.detectChanges();
    expect(component.resumeConfirm).toBeFalse();
    expect(component.resumeError).toBe('');
    expect(component.activityReceipt?.title).toBe('Web queue state confirmed');
    expect(fixture.nativeElement.querySelector('.operator-status-main').textContent).toContain('No repeat resume request was sent');
    expect(libraryService.resumeWebQueues).toHaveBeenCalledTimes(1);
    component.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('does not claim resume success for a malformed acknowledgement', () => {
    render({ playlists: [], totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 } });
    const paused = { ...component.youtubePace!, webQueues: {
      search: { paused: true, active: 0 }, download: { paused: true, active: 0 } } };
    component.youtubePace = paused;
    libraryService.youtubePace.and.returnValue(of(paused));
    libraryService.resumeWebQueues.and.returnValue(of({} as YoutubePaceSnapshot));
    component.resumeConfirm = true;
    component.resumeWebQueues();
    expect(component.webQueuesPaused).toBeTrue();
    expect(component.resumeError).toContain('Could not confirm');
    expect(component.activityReceipt?.title).not.toBe('Web downloads resumed');
  });

  it('ignores a resume reply after the component is disposed', () => {
    render({ playlists: [], totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 } });
    const paused = { ...component.youtubePace!, webQueues: {
      search: { paused: true, active: 0 }, download: { paused: true, active: 0 } } };
    component.youtubePace = paused;
    const pending = new Subject<YoutubePaceSnapshot>();
    libraryService.resumeWebQueues.and.returnValue(pending);
    component.resumeConfirm = true;
    component.resumeWebQueues();
    component.ngOnDestroy();
    trackService.fetchActive.calls.reset();
    pending.next({ ...paused, webQueues: {
      search: { paused: false, active: 0 }, download: { paused: false, active: 0 } } });
    component.resumeWebQueues();
    expect(pending.observed).toBeFalse();
    expect(component.webQueuesPaused).toBeTrue();
    expect(trackService.fetchActive).not.toHaveBeenCalled();
    expect(libraryService.resumeWebQueues).toHaveBeenCalledTimes(1);
  });

  it('shows actual server preparation even without a pending browser request or Bull job', () => {
    const p = playlist('admission-progress', 'Preparation');
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    component.enqueueing = false;
    component.youtubePace = { ...component.youtubePace!, webAdmission: {
      running: true, startedAt: 1, done: 2, total: 10, phase: 'verifying',
      playlist: p.name, artist: 'Artist', name: 'Existing track' } };
    fixture.detectChanges();
    const current = fixture.nativeElement.querySelector('.operator-status-main').textContent;
    expect(current).toContain('Checking an existing MP3');
    expect(current).toContain('Artist — Existing track');
    expect(current).toContain('2/10 playlist tracks checked');
    expect(component.activity.percent).toBe(20);
    expect(component.activity.busy).toBeTrue();
  });

  const priorRequestId = '11111111-2222-3333-4444-555555555555';
  function submissionStatus(id = priorRequestId, state: 'preparing' | 'completed' | 'interrupted' | 'failed' = 'completed') {
    return { requestId: id, state, startedAt: 1, finishedAt: state === 'completed' || state === 'failed' ? 2 : null,
      destination: '/tmp/original-downloads', receipt: state === 'completed' ? { queued: 2, skipped: 5, reused: 1 } : null };
  }

  it('recovers a saved completed submission on reload without posting download or resume again', () => {
    window.sessionStorage.setItem(DOWNLOAD_REQUEST_STORAGE, priorRequestId);
    libraryService.downloadRequestStatus.and.returnValue(of(submissionStatus()));
    render({ playlists: [], totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 } });
    expect(component.activityReceipt?.title).toContain('2 tracks added');
    expect(component.message).toContain('Recovered your earlier submission');
    expect(component.loading).toBeFalse();
    expect(component.data?.totals.playlists).toBe(0);
    expect(component.message).toContain('Queued 2 · 4 unchanged');
    expect(window.sessionStorage.getItem(DOWNLOAD_REQUEST_STORAGE)).toBeNull();
    expect(libraryService.downloadRequestStatus).toHaveBeenCalledOnceWith(priorRequestId);
    expect(libraryService.download).not.toHaveBeenCalled();
    expect(libraryService.downloadRemaining).not.toHaveBeenCalled();
    expect(libraryService.resumeWebQueues).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.operator-status-main').textContent).toContain('Recovered your earlier submission');
  });

  for (const failure of [false, true]) {
    it(`keeps a download receipt when quiet Spotify sync ${failure ? 'fails' : 'finishes'}`, () => {
      render({ playlists: [], totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 } });
      component.activityReceipt = { at: Date.now(), title: '2 tracks added to the queue', detail: 'Queued 2' };
      component.message = 'Queued 2';
      (component as any).librarySyncQuiet = true;
      (component as any).finishSpotifySync({ running: false, scope: 'library', discovered: 3, changed: 1,
        done: 4, total: 4, current: '', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
        errors: failure ? ['Spotify unavailable'] : [] });
      expect(component.activityReceipt?.title).toBe('2 tracks added to the queue');
      expect(component.message).toBe('Queued 2');
    });
  }

  it('recovery preserves an unrelated error and reports the original destination', () => {
    const p = playlist('old-folder-receipt', 'Original folder');
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    libraryService.download.and.returnValue(throwError(() => ({ status: 0 })));
    component.downloadFocused();
    const id = libraryService.download.calls.mostRecent().args[2]!;
    component.error = 'Unrelated playback problem';
    component.downloadLocation = { path: '/tmp/new-folder', source: 'saved' };
    libraryService.downloadRequestStatus.and.returnValue(of(submissionStatus(id)));
    component.checkDownloadSubmission();
    expect(component.error).toBe('Unrelated playback problem');
    expect(component.message).toContain('Applied to /tmp/original-downloads');
  });

  it('a newer explicit submission cancels an old receipt read and rejects its late result', () => {
    const p = playlist('new-request', 'New request');
    window.sessionStorage.setItem(DOWNLOAD_REQUEST_STORAGE, priorRequestId);
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    const oldRead = new Subject<any>();
    libraryService.downloadRequestStatus.and.returnValue(oldRead);
    component.checkDownloadSubmission();
    const newPost = new Subject<any>();
    libraryService.download.and.returnValue(newPost);
    component.downloadFocused();
    const id = libraryService.download.calls.mostRecent().args[2]!;
    expect(id).not.toBe(priorRequestId);
    expect(oldRead.observed).toBeFalse();
    oldRead.next(submissionStatus());
    expect(window.sessionStorage.getItem(DOWNLOAD_REQUEST_STORAGE)).toBe(id);
    expect(component.activityReceipt).toBeNull();
    newPost.next({ queued: 1, skipped: 0 });
    expect(component.activityReceipt?.title).toBe('1 track added to the queue');
  });

  it('warns when storage is blocked but still handles the in-memory submission once', () => {
    const p = playlist('storage-blocked', 'Storage blocked');
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    spyOn(Object.getPrototypeOf(window.sessionStorage), 'setItem').and.throwError('unavailable');
    const post = new Subject<any>();
    libraryService.download.and.returnValue(post);
    component.downloadFocused(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('cannot remember this submission after a reload');
    post.next({ queued: 1, skipped: 0 });
    expect(component.activityReceipt?.title).toBe('1 track added to the queue');
    expect(component.downloadReceiptStorageWarning).toBe('');
    expect(libraryService.download).toHaveBeenCalledTimes(1);
  });

  it('recovers the exact result after a lost POST response and clears only that request error', () => {
    const p = playlist('lost-receipt', 'Lost reply');
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    libraryService.download.and.returnValue(throwError(() => ({ status: 0 })));
    libraryService.downloadRequestStatus.and.callFake(id => of(submissionStatus(id)));
    component.downloadFocused();
    expect(component.error).toBe('');
    expect(component.activityReceipt?.title).toContain('2 tracks added');
    expect(libraryService.download).toHaveBeenCalledTimes(1);
    expect(libraryService.downloadRequestStatus.calls.mostRecent().args[0]).toBe(libraryService.download.calls.mostRecent().args[2]!);
  });

  it('lets a correlated receipt finish a hung POST once and ignores its late response', () => {
    const p = playlist('hung-receipt', 'Hung reply');
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    const post = new Subject<{ queued: number; skipped: number }>();
    libraryService.download.and.returnValue(post);
    component.downloadFocused();
    const id = libraryService.download.calls.mostRecent().args[2]!;
    expect(window.sessionStorage.getItem(DOWNLOAD_REQUEST_STORAGE)).toBe(id);
    libraryService.downloadRequestStatus.and.returnValue(of(submissionStatus(id)));
    component.checkDownloadSubmission();
    expect(component.enqueueing).toBeFalse();
    expect(post.observed).toBeFalse();
    post.next({ queued: 999, skipped: 0 });
    expect(component.activityReceipt?.title).toContain('2 tracks added');
    expect(component.activityReceipt?.title).not.toContain('999');
  });

  it('follows a recorded in-progress submission after reload and blocks duplicate preparation', () => {
    window.sessionStorage.setItem(DOWNLOAD_REQUEST_STORAGE, priorRequestId);
    libraryService.downloadRequestStatus.and.returnValue(of(submissionStatus(priorRequestId, 'preparing')));
    render({ playlists: [], totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 } });
    expect(component.activity.busy).toBeTrue();
    expect(component.bulkActionsBlocked).toBeTrue();
    expect(component.locationChangeBlocked).toBeTrue();
    component.downloadRemaining();
    expect(libraryService.downloadRemaining).not.toHaveBeenCalled();
  });

  for (const state of ['interrupted', 'failed'] as const) {
    it(`reports a ${state} submission without invented counts or automatic work replay`, () => {
      window.sessionStorage.setItem(DOWNLOAD_REQUEST_STORAGE, priorRequestId);
      libraryService.downloadRequestStatus.and.returnValue(of(submissionStatus(priorRequestId, state)));
      render({ playlists: [], totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 } });
      expect(component.activityReceipt).toBeNull();
      expect(component.error).toContain('Some');
      expect(component.error).toContain('Existing files and queued work are kept');
      expect(component.activity.title).toBe('Download submission needs attention');
      expect(component.error).not.toContain('Queued 0');
      expect(window.sessionStorage.getItem(DOWNLOAD_REQUEST_STORAGE)).toBeNull();
      expect(libraryService.download).not.toHaveBeenCalled();
      expect(libraryService.downloadRemaining).not.toHaveBeenCalled();
    });
  }

  it('never accepts another request ID or malformed counts as this submission receipt', () => {
    window.sessionStorage.setItem(DOWNLOAD_REQUEST_STORAGE, priorRequestId);
    libraryService.downloadRequestStatus.and.returnValue(of(submissionStatus('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')));
    render({ playlists: [], totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 } });
    expect(component.activityReceipt).toBeNull();
    expect(component.error).toContain('Could not confirm');
    expect(window.sessionStorage.getItem(DOWNLOAD_REQUEST_STORAGE)).toBe(priorRequestId);
    libraryService.downloadRequestStatus.and.returnValue(of({ ...submissionStatus(), receipt: { queued: 1, skipped: -1 } }));
    component.checkDownloadSubmission();
    expect(component.activityReceipt).toBeNull();
    expect(libraryService.download).not.toHaveBeenCalled();
  });

  it('offers a read-only Check submission action when the saved receipt is unavailable', () => {
    window.sessionStorage.setItem(DOWNLOAD_REQUEST_STORAGE, priorRequestId);
    render({ playlists: [], totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 } });
    expect(component.activity.busy).toBeFalse();
    const button = fixture.nativeElement.querySelector('.check-download-submission');
    expect(button.textContent.trim()).toBe('Check submission');
    libraryService.downloadRequestStatus.and.returnValue(of(submissionStatus()));
    button.click(); fixture.detectChanges();
    expect(component.activityReceipt?.title).toContain('2 tracks added');
    expect(libraryService.download).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.check-download-submission')).toBeNull();
  });

  it('times out receipt observation, backs off reads and never overlaps or posts again', fakeAsync(() => {
    window.sessionStorage.setItem(DOWNLOAD_REQUEST_STORAGE, priorRequestId);
    const held = new Subject<any>();
    libraryService.downloadRequestStatus.and.returnValue(held);
    render({ playlists: [], totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 } });
    tick(9999);
    expect(libraryService.downloadRequestStatus).toHaveBeenCalledTimes(1);
    tick(1);
    expect(held.observed).toBeFalse();
    tick(2000);
    expect(libraryService.downloadRequestStatus).toHaveBeenCalledTimes(1);
    libraryService.downloadRequestStatus.and.returnValue(of(submissionStatus()));
    tick(2000);
    expect(component.activityReceipt?.title).toContain('2 tracks added');
    expect(libraryService.download).not.toHaveBeenCalled();
    component.ngOnDestroy(); discardPeriodicTasks();
  }));

  it('cancels receipt reads on disposal but retains the marker for the next page load', () => {
    window.sessionStorage.setItem(DOWNLOAD_REQUEST_STORAGE, priorRequestId);
    const held = new Subject<any>();
    libraryService.downloadRequestStatus.and.returnValue(held);
    render({ playlists: [], totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 } });
    component.ngOnDestroy();
    expect(held.observed).toBeFalse();
    expect(window.sessionStorage.getItem(DOWNLOAD_REQUEST_STORAGE)).toBe(priorRequestId);
    held.next(submissionStatus());
    component.checkDownloadSubmission();
    expect(component.activityReceipt).toBeNull();
    expect(libraryService.downloadRequestStatus).toHaveBeenCalledTimes(1);
  });

  it('blocks overlapping actions and folder changes while the server is still preparing a batch', () => {
    const p = playlist('held-admission', 'Held preparation');
    render({ playlists: [p], totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 } });
    component.youtubePace = { ...component.youtubePace!, webAdmission: {
      running: true, startedAt: 1, done: 0, total: null, phase: 'checking', playlist: '', artist: '', name: '' } };
    resetActionCalls();
    expect(component.locationChangeBlocked).toBeTrue();
    expect(component.bulkActionsBlocked).toBeTrue();
    expect(component.playlistActionBlockedReason).toContain('preparing tracks');
    component.downloadFocused();
    component.downloadRemaining();
    expectNoRemoteActions();
    expect(component.activity.percent).toBeNull();
    expect(component.activity.progressText).toContain('Counting playlist tracks');
  });

  it('stops displaying stale server preparation when the status read fails', () => {
    render({ playlists: [], totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 } });
    component.youtubePace = { ...component.youtubePace!, webAdmission: {
      running: true, startedAt: 1, done: 2, total: 10, phase: 'copying', playlist: 'PL', artist: 'Artist', name: 'Old track' } };
    libraryService.youtubePace.and.returnValue(throwError(() => new Error('offline')));
    (component as any).pollYoutubePace();
    fixture.detectChanges();
    expect(component.activity.busy).toBeFalse();
    expect(component.activity.title).toBe('Connecting to Spooty');
    expect(fixture.nativeElement.querySelector('.operator-status-main').textContent).not.toContain('Old track');
    expect(component.bulkActionsBlocked).toBeTrue();
  });

  for (const blockedBy of ['server preparation', 'restored preparation', 'submitting', 'saving folder', 'unknown owner', 'unknown queue', 'invalid options']) {
    it(`keeps every focused acquisition button consistent with its handler during ${blockedBy}`, () => {
      const p = playlist('guarded-actions', 'Guarded actions', { trackCount: 3 });
      libraryService.detail.and.returnValue(of({ playlist: p, tracks: [
        { n: 1, name: 'Pending', artist: 'Artist', onDisk: false, available: false },
        { n: 2, name: 'Failed', artist: 'Artist', onDisk: false, available: false, acquisitionState: 'failed', error: 'Network retries exhausted', missing: false },
        { n: 3, name: 'Unmatched', artist: 'Artist', onDisk: false, available: false, acquisitionState: 'no-candidate', missing: false },
      ] }));
      if (blockedBy === 'restored preparation') {
        window.sessionStorage.setItem(DOWNLOAD_REQUEST_STORAGE, priorRequestId);
        libraryService.downloadRequestStatus.and.returnValue(of(submissionStatus(priorRequestId, 'preparing')));
      }
      render({ playlists: [p], totals: { playlists: 1, tracks: 3, onDisk: 0, available: 0 } });
      if (blockedBy === 'server preparation') component.youtubePace = { ...component.youtubePace!, webAdmission: {
        running: true, startedAt: 1, done: 0, total: 3, phase: 'checking', playlist: p.name, artist: '', name: '' } };
      if (blockedBy === 'submitting') component.enqueueing = true;
      if (blockedBy === 'saving folder') component.savingDownloadLocation = true;
      if (blockedBy === 'unknown owner') component.youtubePace = { ...component.youtubePace!, acquisitionOwner: { state: 'unknown', phase: null, telemetryFresh: false } };
      if (blockedBy === 'unknown queue') component.liveQueueKnown = false;
      if (blockedBy === 'invalid options') component.maxSearches = 0;
      fixture.detectChanges();
      const buttons: HTMLButtonElement[] = [...fixture.nativeElement.querySelectorAll('.detail-actions button:not(.sync-playlist)')];
      expect(buttons.length).toBe(3);
      const reason = component.playlistActionBlockedReason;
      expect(reason).not.toBe('');
      expect(fixture.nativeElement.querySelector('#playlist-action-help').textContent.trim()).toBe(reason);
      for (const button of buttons) {
        expect(button.disabled).toBeTrue();
        expect(button.title).toBe(reason);
        expect(button.getAttribute('aria-describedby')).toBe('playlist-action-help');
        button.click();
      }
      component.downloadFocused(); component.retryFocusedErrors(); component.retryFocusedOutcomes();
      expect(libraryService.download).not.toHaveBeenCalled();
      if (blockedBy === 'restored preparation') {
        expect(fixture.nativeElement.textContent).toContain('folder can be changed when preparation finishes');
      }
    });
  }

  it('re-enables focused actions when preparation ends without another page reload', () => {
    const p = playlist('finished-preparation', 'Ready to queue', { trackCount: 1 });
    render({ playlists: [p], totals: { playlists: 1, tracks: 1, onDisk: 0, available: 0 } });
    component.youtubePace = { ...component.youtubePace!, webAdmission: {
      running: true, startedAt: 1, done: 0, total: 1, phase: 'checking', playlist: '', artist: '', name: '' } };
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('.detail-actions .btn-primary') as HTMLButtonElement;
    expect(button.disabled).toBeTrue();
    component.youtubePace = { ...component.youtubePace!, webAdmission: { ...component.youtubePace!.webAdmission!, running: false } };
    libraryService.download.and.returnValue(of({ queued: 1, skipped: 0 }));
    fixture.detectChanges();
    expect(button.disabled).toBeFalse();
    expect(button.getAttribute('aria-describedby')).toBeNull();
    expect(fixture.nativeElement.querySelector('#playlist-action-help')).toBeNull();
    button.click();
    expect(libraryService.download).toHaveBeenCalledOnceWith([p.uri], { maxSearches: 10, networkRetries: 5 }, jasmine.any(String));
  });

  it('keeps saved-library download usable while Spotify discovery runs in the background', () => {
    const p = playlist('saved-metadata', 'Saved metadata', { trackCount: 1 });
    libraryService.download.and.returnValue(of({ queued: 0, skipped: 1 }));
    render({
      playlists: [p],
      totals: { playlists: 1, tracks: 1, onDisk: 0, available: 0 },
    });
    component.syncingLibrary = true;
    component.selected = new Set([p.uri]);
    fixture.detectChanges();
    expect(component.bulkActionsBlocked).toBeFalse();
    component.downloadSelected();
    expect(libraryService.download).toHaveBeenCalledWith([p.uri], {
      maxSearches: 10,
      networkRetries: 5,
    }, jasmine.any(String));
    expect(component.message).toContain('Queued 0 · 1 unchanged');
  });

  it('sends explicit retry flags only from the retry action and keeps depth separate', () => {
    const p = playlist('retry', 'Retry work', { trackCount: 1, failed: 1 });
    libraryService.download.and.returnValue(of({ queued: 1, skipped: 0 }));
    render({
      playlists: [p],
      totals: { playlists: 1, tracks: 1, onDisk: 0, available: 0 },
    });
    component.focus(p, false);
    component.maxSearches = 20;
    component.networkRetries = 2;
    component.downloadFocused();
    expect(libraryService.download).toHaveBeenCalledWith([p.uri], {
      maxSearches: 20,
      networkRetries: 2,
    }, jasmine.any(String));
    component.retryFocusedOutcomes();
    expect(libraryService.download).toHaveBeenCalledWith([p.uri], {
      maxSearches: 20,
      networkRetries: 2,
      retryMissing: true,
      retryNoCandidate: true,
    }, jasmine.any(String));
  });

  for (const status of [TrackStatusEnum.Queued, TrackStatusEnum.RetryWaiting]) {
    it(`keeps Retry 20 available beside waiting/scheduled work (${status}), including paused queues`, () => {
      const p = playlist('earth-retry', 'LTJ Bukem Presents Earth 1-7', {
        trackCount: 22,
      });
      playlistService.all$.next([
        {
          id: 901,
          name: p.name,
          spotifyUrl: p.spotifyUrl,
          active: false,
          isTrack: false,
          createdAt: 1,
          collapsed: false,
        },
      ]);
      trackService.all$.next(
        [1, 2].map((id) => ({
          id,
          artist: 'Artist',
          name: `Waiting ${id}`,
          spotifyUrl: '',
          youtubeUrl: '',
          status,
          playlistId: 901,
        })),
      );
      const tracks: LibraryDetail['tracks'] = [
        ...Array.from({ length: 20 }, (_, n) => ({
          n,
          name: `Exhausted ${n}`,
          artist: 'Artist',
          onDisk: false,
          available: false,
          acquisitionState: 'no-candidate' as const,
          missing: false,
          error:
            'No acceptable duration-matched YouTube candidate in the configured search results',
        })),
        ...[1, 2].map((id) => ({
          n: 20 + id,
          name: `Waiting ${id}`,
          artist: 'Artist',
          onDisk: false,
          available: false,
        })),
      ];
      libraryService.detail.and.returnValue(of({ playlist: p, tracks }));
      libraryService.download.and.returnValue(of({ queued: 20, skipped: 2 }));
      render({
        playlists: [p],
        totals: { playlists: 1, tracks: 22, onDisk: 0, available: 0 },
      });
      component.youtubePace = {
        ...component.youtubePace!,
        webQueues: {
          search: { paused: true, active: 0 },
          download: { paused: true, active: 0 },
        },
      };
      component.focus(p, false);
      fixture.detectChanges();
      const button = fixture.nativeElement.querySelector(
        '.retry-outcomes',
      ) as HTMLButtonElement;
      expect(button).not.toBeNull();
      expect(button.textContent).toContain('20 without a match');
      expect(button.disabled).toBeFalse();
      expect(component.runningNow(p)).toBeFalse();
      expect(component.workQueueTitle).toBe('Work queue — paused');
      expect(component.liveQueueMeta(1)).toBe(
        'Playlists: 0 processing · 1 waiting',
      );
      button.click();
      expect(libraryService.download).toHaveBeenCalledOnceWith([p.uri], {
        maxSearches: 10,
        networkRetries: 5,
        retryMissing: true,
        retryNoCandidate: true,
      }, jasmine.any(String));
      expect(component.message).toContain(
        'will not start until the queues are resumed',
      );
      libraryService.download.calls.reset();
      component.youtubePace = {
        ...component.youtubePace!,
        acquisitionOwner: {
          state: 'owned',
          phase: 'running',
          telemetryFresh: true,
        },
      };
      fixture.detectChanges();
      expect(button.disabled).toBeTrue();
      component.retryFocusedOutcomes();
      expect(libraryService.download).not.toHaveBeenCalled();
    });
  }

  it('does not invent queued work for unrelated pending playlists while queues are paused', () => {
    const p = playlist('pending-only', 'Never queued', { trackCount: 1 });
    const queued = playlist('queued', 'Queued lots');
    playlistService.all$.next([
      {
        id: 2,
        name: queued.name,
        spotifyUrl: queued.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);
    render({
      playlists: [p, queued],
      totals: { playlists: 2, tracks: 11, onDisk: 0, available: 0 },
    });
    component.youtubePace = {
      ...component.youtubePace!,
      webQueues: {
        search: { paused: true, active: 0 },
        download: { paused: true, active: 0 },
      },
    };
    component.focus(p, false);
    fixture.detectChanges();
    expect(component.impliedWaitingPlaylistCount).toBe(0);
    expect(component.remainingLabel(p)).toBe('1 needed');
    expect(component.statsOf(p).ripping).toBeFalse();
    expect(component.acquisitionGuardText).toContain('Web queues are paused');
    component.youtubePace = {
      ...component.youtubePace!,
      webQueues: {
        search: { paused: false, active: 0 },
        download: { paused: true, active: 0 },
      },
    };
    expect(component.workQueueTitle).toBe('Work queue — partially paused');
    expect(component.webQueuePauseMessage).toContain(
      'Download queue is paused',
    );
  });

  it('keeps the 20-track action enabled beside 2 queued tracks and separates status from buttons', () => {
    const p = playlist('earth-action', 'EARTH Series', {
      trackCount: 78,
      onDisk: 54,
      available: 56,
    });
    playlistService.all$.next([
      {
        id: 901,
        name: p.name,
        spotifyUrl: p.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next(
      [1, 2].map((id) => ({
        id,
        artist: 'Artist',
        name: `Queued ${id}`,
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 901,
      })),
    );
    const tracks = [
      ...Array.from({ length: 54 }, (_, n) => ({
        n,
        artist: 'Artist',
        name: `Saved ${n}`,
        onDisk: true,
        available: true,
      })),
      ...Array.from({ length: 20 }, (_, n) => ({
        n: n + 54,
        artist: 'Artist',
        name: `Pending ${n}`,
        onDisk: false,
        available: false,
      })),
      ...[1, 2].map((id) => ({
        n: id + 74,
        artist: 'Artist',
        name: `Queued ${id}`,
        onDisk: false,
        available: false,
      })),
      ...[1, 2].map((id) => ({
        n: id + 76,
        artist: 'Artist',
        name: `Copy ${id}`,
        onDisk: false,
        available: true,
      })),
    ];
    libraryService.detail.and.returnValue(of({ playlist: p, tracks }));
    libraryService.download.and.returnValue(NEVER);
    render({
      playlists: [p],
      totals: { playlists: 1, tracks: 78, onDisk: 54, available: 56 },
    });
    component.focus(p, false);
    component.youtubePace = {
      ...component.youtubePace!,
      webQueues: {
        search: { paused: true, active: 0 },
        download: { paused: true, active: 0 },
      },
    };
    fixture.detectChanges();
    expect(component.statsOf(p)).toEqual(
      jasmine.objectContaining({
        pending: 20,
        queued: 2,
        copyable: 2,
        onDisk: 54,
      }),
    );
    const action = fixture.nativeElement.querySelector(
      '.detail-actions .btn-primary',
    ) as HTMLButtonElement;
    expect(action.disabled).toBeFalse();
    expect(action.textContent).toContain('Queue 20 for search & download');
    const state = fixture.nativeElement.querySelector('.coverage');
    expect(state.textContent).toContain('20 not queued');
    expect(state.textContent).toContain('2 queued');
    expect(state.querySelector('button')).toBeNull();
    expect(component.trackStatusLabel(tracks[74])).toBe('Queued — paused');
    component.youtubePace.webQueues!.search.paused = false;
    component.youtubePace.webQueues!.download.paused = false;
    fixture.detectChanges();
    expect(component.statsOf(p).pending).toBe(20);
    expect(action.disabled).toBeFalse();
    action.click();
    action.click();
    expect(libraryService.download).toHaveBeenCalledOnceWith([p.uri], {
      maxSearches: 10,
      networkRetries: 5,
    }, jasmine.any(String));
    expect(libraryService.resumeWebQueues).not.toHaveBeenCalled();
  });

  it('requires a separate whole-queue confirmation and rechecks ownership before resume', () => {
    render({
      playlists: [],
      totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 },
    });
    const paused = {
      ...component.youtubePace!,
      webQueues: {
        search: { paused: true, active: 0, queued: 30 },
        download: { paused: true, active: 0, queued: 4 },
      },
    };
    component.youtubePace = paused;
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.resume-offer').click();
    fixture.detectChanges();
    expect(libraryService.resumeWebQueues).not.toHaveBeenCalled();
    expect(
      fixture.nativeElement.querySelector('.resume-confirm').textContent,
    ).toContain('not just this playlist');
    expect(
      fixture.nativeElement.querySelector('.resume-confirm').textContent,
    ).toContain('34 queue jobs');
    component.youtubePace = {
      ...paused,
      acquisitionOwner: {
        state: 'owned',
        phase: 'running',
        telemetryFresh: true,
      },
    };
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('.resume-apply').disabled,
    ).toBeTrue();
    component.resumeWebQueues();
    expect(libraryService.resumeWebQueues).not.toHaveBeenCalled();
    component.youtubePace = paused;
    const result = new Subject<YoutubePaceSnapshot>();
    libraryService.resumeWebQueues.and.returnValue(result);
    component.resumeWebQueues();
    component.resumeWebQueues();
    expect(libraryService.resumeWebQueues).toHaveBeenCalledTimes(1);
    result.next({
      ...paused,
      webQueues: {
        search: { paused: false, active: 0 },
        download: { paused: false, active: 0 },
      },
    });
    expect(component.webQueuesPaused).toBeFalse();
    expect(component.resumeConfirm).toBeFalse();
    expect(trackService.fetchActive).toHaveBeenCalled();
  });

  it('never paints saved tracks or zero failure counters as errors', () => {
    render({
      playlists: [],
      totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 },
    });
    expect(
      component.candidateEvidence({
        name: 'Saved',
        artist: 'A',
        onDisk: true,
        available: true,
        networkAttempts: 3,
        searchLimit: 10,
      }),
    ).toBe('');
    expect(
      component.candidateEvidence({
        name: 'Pending',
        artist: 'A',
        onDisk: false,
        available: false,
        networkAttempts: 0,
        operationAttempts: 0,
        searchLimit: 10,
      }),
    ).toBe('');
  });

  it('retries operational failures explicitly without reopening Missing or exhausted searches', () => {
    const p = playlist('failures', 'Failed work', { trackCount: 3, failed: 1 });
    libraryService.detail.and.returnValue(
      of({
        playlist: p,
        tracks: [
          {
            n: 0,
            name: 'Failed',
            artist: 'Artist',
            onDisk: false,
            available: false,
            acquisitionState: 'failed',
            error: 'Network retries exhausted',
            missing: false,
          },
          {
            n: 1,
            name: 'Exhausted',
            artist: 'Artist',
            onDisk: false,
            available: false,
            acquisitionState: 'no-candidate',
            missing: false,
          },
          {
            n: 2,
            name: 'Missing',
            artist: 'Artist',
            onDisk: false,
            available: false,
            acquisitionState: 'missing',
            missing: true,
          },
        ],
      }),
    );
    libraryService.download.and.returnValue(of({ queued: 1, skipped: 2 }));
    render({
      playlists: [p],
      totals: { playlists: 1, tracks: 3, onDisk: 0, available: 0 },
    });
    component.focus(p, false);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector(
      '.retry-errors',
    ) as HTMLButtonElement;
    expect(button.textContent).toContain('Retry 1 failed');
    expect(
      fixture.nativeElement.querySelector('.retry-outcomes').textContent,
    ).toContain('1 without a match');
    button.click();
    expect(libraryService.download).toHaveBeenCalledWith([p.uri], {
      maxSearches: 10,
      networkRetries: 5,
      retryErrors: true,
    }, jasmine.any(String));
    const options = libraryService.download.calls.mostRecent().args[1]!;
    expect(options.retryMissing).toBeUndefined();
    expect(options.retryNoCandidate).toBeUndefined();
    component.youtubePace = {
      ...component.youtubePace!,
      acquisitionOwner: {
        state: 'owned',
        phase: 'draining',
        telemetryFresh: false,
      },
    };
    fixture.detectChanges();
    expect(
      (
        fixture.nativeElement.querySelector(
          '.retry-errors',
        ) as HTMLButtonElement
      ).disabled,
    ).toBeTrue();
    component.retryFocusedErrors();
    expect(libraryService.download).toHaveBeenCalledTimes(1);
  });

  it('blocks malformed candidate and network retry settings before any request', () => {
    render({
      playlists: [],
      totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 },
    });
    for (const [depth, retries] of [
      [0, 5],
      [51, 5],
      [1.5, 5],
      [10, -1],
      [10, 21],
      [10, NaN],
    ]) {
      component.maxSearches = depth;
      component.networkRetries = retries;
      component.downloadUris(['spotify:playlist:test']);
      component.downloadRemaining();
      expect(component.acquisitionOptionsValid).toBeFalse();
    }
    expect(libraryService.download).not.toHaveBeenCalled();
    expect(libraryService.downloadRemaining).not.toHaveBeenCalled();
  });

  it('fails closed after an ownership refresh fails instead of retaining permission to enqueue', () => {
    render({
      playlists: [],
      totals: { playlists: 0, tracks: 0, onDisk: 0, available: 0 },
    });
    expect(component.ownerBlocksAcquisition).toBeFalse();
    libraryService.youtubePace.and.returnValue(
      throwError(() => new Error('unavailable')),
    );
    (component as any).pollYoutubePace();
    expect(component.youtubePace?.acquisitionOwner?.state).toBe('unknown');
    expect(component.ownerBlocksAcquisition).toBeTrue();
    component.downloadUris(['spotify:playlist:test']);
    expect(libraryService.download).not.toHaveBeenCalled();
  });

  it('preserves explicit retry intent in the actual HTTP request body', () => {
    const http = jasmine.createSpyObj<HttpClient>('HttpClient', ['post']);
    const service = new LibraryService(http);
    service.download(['spotify:playlist:a']);
    expect(http.post).toHaveBeenCalledWith('/api/library/download', {
      uris: ['spotify:playlist:a'],
    });
    service.download(['spotify:playlist:a'], {
      retryMissing: true,
      retryNoCandidate: true,
      maxSearches: 30,
      networkRetries: 0,
    });
    expect(http.post).toHaveBeenCalledWith('/api/library/download', {
      uris: ['spotify:playlist:a'],
      retryMissing: true,
      retryNoCandidate: true,
      maxSearches: 30,
      networkRetries: 0,
    });
    service.downloadRemaining({ maxSearches: 20, networkRetries: 5 });
    expect(http.post).toHaveBeenCalledWith('/api/library/download-remaining', {
      maxSearches: 20,
      networkRetries: 5,
    });
    service.download(['spotify:playlist:a'], { retryErrors: true });
    expect(http.post).toHaveBeenCalledWith('/api/library/download', {
      uris: ['spotify:playlist:a'],
      retryErrors: true,
    });
  });

  it('sends request identity separately from acquisition options and reads its exact receipt', () => {
    const http = jasmine.createSpyObj<HttpClient>('HttpClient', ['post', 'get']);
    const service = new LibraryService(http);
    service.download(['spotify:playlist:a'], { maxSearches: 10 }, priorRequestId);
    expect(http.post).toHaveBeenCalledWith('/api/library/download', {
      uris: ['spotify:playlist:a'], maxSearches: 10,
    }, { headers: { 'X-Spooty-Request-Id': priorRequestId } });
    service.downloadRemaining({ networkRetries: 5 }, priorRequestId);
    expect(http.post).toHaveBeenCalledWith('/api/library/download-remaining', { networkRetries: 5 },
      { headers: { 'X-Spooty-Request-Id': priorRequestId } });
    service.downloadRequestStatus(priorRequestId);
    expect(http.get).toHaveBeenCalledOnceWith(`/api/library/download-requests/${priorRequestId}`);
  });

  it('sorts processing, partial, untouched, then completed by default', () => {
    const processing = playlist('processing', 'Processing', {
      onDisk: 9,
      available: 9,
      percentOnDisk: 90,
      percentAvailable: 90,
      failed: 1,
    });
    const partial = playlist('partial', 'Partial', {
      onDisk: 4,
      available: 4,
      percentOnDisk: 40,
      percentAvailable: 40,
    });
    const untouched = playlist('untouched', 'Untouched');
    const completed = playlist('completed', 'Completed', {
      onDisk: 10,
      available: 10,
      percentOnDisk: 100,
      percentAvailable: 100,
    });

    playlistService.all$.next([
      {
        id: 101,
        name: processing.name,
        spotifyUrl: processing.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 501,
        artist: 'Artist',
        name: 'Retrying track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Downloading,
        playlistId: 101,
      },
    ]);

    render({
      playlists: [completed, untouched, processing, partial],
      totals: { playlists: 4, tracks: 40, onDisk: 23, available: 23 },
    });

    expect(component.visiblePlaylists.map((p) => p.name)).toEqual([
      'Processing',
      'Partial',
      'Untouched',
      'Completed',
    ]);
  });

  it('sorts partial before untouched when no live search or download queue is present', () => {
    const partial = playlist('partial', 'Partial', {
      onDisk: 4,
      available: 4,
      percentOnDisk: 40,
      percentAvailable: 40,
    });
    const untouched = playlist('untouched', 'Untouched');
    const completed = playlist('completed', 'Completed', {
      onDisk: 10,
      available: 10,
      percentOnDisk: 100,
      percentAvailable: 100,
    });

    render({
      playlists: [completed, untouched, partial],
      totals: { playlists: 3, tracks: 30, onDisk: 14, available: 14 },
    });

    expect(component.visiblePlaylists.map((p) => p.name)).toEqual([
      'Partial',
      'Untouched',
      'Completed',
    ]);
    expect(
      fixture.nativeElement.querySelector('.state-pill.is-needs')?.textContent,
    ).toContain('needed');
  });

  it('shows live retry work instead of the historical finished state', () => {
    const processing = playlist('processing', 'Processing', {
      onDisk: 9,
      available: 9,
      percentOnDisk: 90,
      percentAvailable: 90,
      failed: 1,
    });

    playlistService.all$.next([
      {
        id: 101,
        name: processing.name,
        spotifyUrl: processing.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 501,
        artist: 'Artist',
        name: 'Retrying track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Downloading,
        playlistId: 101,
      },
    ]);

    render({
      playlists: [processing],
      totals: { playlists: 1, tracks: 10, onDisk: 9, available: 9 },
    });

    const row = fixture.nativeElement.querySelector('.pl-row') as HTMLElement;
    expect(row.classList).toContain('is-ripping');
    expect(row.classList).not.toContain('is-done');
    expect(row.querySelector('.state-pill.is-rip')?.textContent).toContain(
      'Downloading',
    );
    expect(row.querySelector('.state-pill.is-done')).toBeNull();

    const detail = fixture.nativeElement.querySelector(
      '.detail-head',
    ) as HTMLElement;
    expect(
      fixture.nativeElement.querySelector('.activity-copy').textContent,
    ).toContain('Downloading audio');
    expect(detail.querySelector('.done-banner')).toBeNull();
    expect(detail.textContent).not.toContain('Retry 1 missing');
  });

  it('moves the initial detail focus to the first live playlist', () => {
    const staticFirst = playlist('static-first', 'Static first', {
      onDisk: 1,
      available: 1,
      percentOnDisk: 10,
      percentAvailable: 10,
    });
    const processing = playlist('processing', 'Processing', {
      onDisk: 9,
      available: 9,
      percentOnDisk: 90,
      percentAvailable: 90,
    });

    render({
      playlists: [staticFirst, processing],
      totals: { playlists: 2, tracks: 20, onDisk: 10, available: 10 },
    });
    expect(component.focused?.id).toBe('static-first');

    playlistService.all$.next([
      {
        id: 101,
        name: processing.name,
        spotifyUrl: processing.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 501,
        artist: 'Artist',
        name: 'Retrying track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 101,
      },
    ]);
    fixture.detectChanges();

    expect(component.focused?.id).toBe('processing');
    expect(component.visiblePlaylists[0].id).toBe('processing');
  });

  it('labels an operational failure as retryable rather than missing', () => {
    const processing = playlist('processing', 'Processing');

    render({
      playlists: [processing],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    const track = component.detail!.tracks[0];
    expect(component.statusKind(track)).toBe('retry');
    expect(component.trackStatusLabel(track)).toBe('Needs retry');
    expect(
      fixture.nativeElement.querySelector('.pill.retry')?.textContent,
    ).toContain('Needs retry');
    expect(fixture.nativeElement.querySelector('.pill.miss')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.track-err')?.textContent,
    ).toContain('Temporary YouTube failure');
    expect(
      fixture.nativeElement.querySelector('.track-err')?.textContent,
    ).not.toContain('Not found on YouTube');
    expect(component.statsOf(processing).needsRetry).toBe(1);
    expect(component.statsOf(processing).pending).toBe(9);
    expect(
      (
        fixture.nativeElement
          .querySelector('.pl-row .pl-sub')
          ?.getAttribute('title') || ''
      ).replace(/\s+/g, ' '),
    ).toContain('1 needs retry');
    expect(
      (
        fixture.nativeElement
          .querySelector('.pl-row .pl-sub')
          ?.getAttribute('title') || ''
      ).replace(/\s+/g, ' '),
    ).not.toContain('1 pending');
  });

  it('presents a delayed search retry as scheduled live work', () => {
    const processing = playlist('processing', 'Processing');
    playlistService.all$.next([
      {
        id: 101,
        name: processing.name,
        spotifyUrl: processing.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 501,
        artist: 'Artist',
        name: 'Retrying track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.RetryWaiting,
        playlistId: 101,
        error: 'Temporary YouTube failure; search retry 1/3 in 15m',
      },
    ]);

    render({
      playlists: [processing],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    const stats = component.statsOf(processing);
    expect(stats.active).toBe(1);
    expect(stats.retrying).toBe(1);
    expect(stats.ripping).toBe(true);
    expect(component.hasQueuedWork).toBe(true);
    expect(component.activityLabel(processing)).toBe('Retry scheduled');
    expect(component.globalActivitySummary()).toBe('9 pending · 1 retry');

    const track = component.detail!.tracks[0];
    expect(component.statusKind(track)).toBe('scheduled');
    expect(component.trackStatusLabel(track)).toBe('Retry scheduled');
    expect(
      fixture.nativeElement.querySelector('.pill.retry')?.textContent,
    ).toContain('Retry scheduled');
    expect(
      fixture.nativeElement.querySelector('.technical-summary')?.textContent,
    ).toContain('1 retry');
    expect(fixture.nativeElement.querySelector('tr.is-wip')).toBeNull();
  });

  it('guards selected bulk work while a queue is live and reports skipped work truthfully', () => {
    const processing = playlist('processing', 'Processing');
    playlistService.all$.next([
      {
        id: 101,
        name: processing.name,
        spotifyUrl: processing.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 501,
        artist: 'Artist',
        name: 'Retrying track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 101,
      },
    ]);
    libraryService.download.and.returnValue(of({ queued: 1, skipped: 2 }));

    render({
      playlists: [processing],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });
    component.selected = new Set([processing.uri]);
    fixture.detectChanges();

    const selectedDownload = [
      ...fixture.nativeElement.querySelectorAll('.sidebar-actions .btn'),
    ].find((button: HTMLButtonElement) =>
      button.textContent?.trim().startsWith('Download'),
    ) as HTMLButtonElement;
    const bulkDownload = fixture.nativeElement.querySelector(
      '.sidebar-actions .btn-primary',
    ) as HTMLButtonElement;
    expect(selectedDownload.disabled).toBe(true);
    expect(bulkDownload.disabled).toBe(true);
    expect(
      fixture.nativeElement.querySelector('.queue-guard')?.textContent,
    ).toContain('Work already queued');
    expect(fixture.nativeElement.querySelector('#queue-guard')).not.toBeNull();
    expect(selectedDownload.getAttribute('aria-describedby')).toBe(
      'operator-current',
    );
    expect(bulkDownload.getAttribute('aria-describedby')).toBe(
      'operator-current',
    );

    trackService.all$.next([]);
    fixture.detectChanges();
    expect(selectedDownload.disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('.queue-guard')).toBeNull();
    expect(selectedDownload.getAttribute('aria-describedby')).toBeNull();
    expect(bulkDownload.getAttribute('aria-describedby')).toBeNull();
    const actionLabels = [
      ...fixture.nativeElement.querySelectorAll('.sidebar-actions button'),
    ].map((button: HTMLButtonElement) => button.textContent?.trim());
    expect(actionLabels[0]).toBe('Search & download needed');
    expect(actionLabels.indexOf('Search & download needed')).toBeLessThan(
      actionLabels.findIndex((label) => label?.startsWith('Download')),
    );
    component.downloadUris([processing.uri]);

    expect(component.message).toBe(
      'Queued 1 · 2 unchanged (already saved, queued, or parked)',
    );
    expect(component.message).not.toContain('skipped 2 already on disk');
  });

  it('does not enable bulk search/download until the live queue has been fetched', () => {
    trackService.activeReady$.next(false);
    const open = playlist('open', 'Open work');
    render({
      playlists: [open],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    const bulk = fixture.nativeElement.querySelector(
      '.sidebar-actions .btn-primary',
    ) as HTMLButtonElement;
    expect(component.hasQueuedWork).toBe(false);
    expect(component.liveQueueKnown).toBe(false);
    expect(component.bulkActionsBlocked).toBe(true);
    expect(bulk.disabled).toBe(true);
    expect(
      fixture.nativeElement.querySelector('.queue-guard')?.textContent,
    ).toContain('Checking live queue');
    expect(bulk.getAttribute('aria-describedby')).toBe('operator-current');

    trackService.activeReady$.next(true);
    fixture.detectChanges();
    expect(component.liveQueueKnown).toBe(true);
    expect(component.bulkActionsBlocked).toBe(false);
    expect(bulk.disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('.queue-guard')).toBeNull();
  });

  it('shows a truthful loading phase before Spotify returns the playlist total', () => {
    libraryService.syncLibrary.and.returnValue(of({ started: true }));
    libraryService.syncLibraryStatus.and.returnValue(
      of({
        running: true,
        done: 0,
        total: 0,
        discovered: 0,
        changed: 0,
        errors: [],
        current: '',
        startedAt: '2026-09-11T00:00:00.000Z',
        finishedAt: null,
      }),
    );

    render({
      playlists: [playlist('saved', 'Saved playlist')],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    expect(component.librarySyncLabel).toBe('Getting your playlist library from Spotify…');
  });

  it('orders live searching ahead of queued and retry-only playlists', () => {
    const retryOnly = playlist('retry-only', 'Retry only', {
      rank: 1,
      onDisk: 47,
      available: 47,
      percentOnDisk: 94,
      percentAvailable: 94,
    });
    const queuedLots = playlist('queued-lots', 'Queued lots', {
      rank: 2,
      trackCount: 131,
      onDisk: 0,
      available: 0,
    });
    const searching = playlist('searching', 'Searching now', {
      rank: 3,
      onDisk: 1,
      available: 1,
      percentOnDisk: 2,
      percentAvailable: 2,
    });
    const partial = playlist('partial', 'Partial', {
      rank: 4,
      onDisk: 4,
      available: 4,
      percentOnDisk: 40,
      percentAvailable: 40,
    });

    playlistService.all$.next([
      {
        id: 1,
        name: retryOnly.name,
        spotifyUrl: retryOnly.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
      {
        id: 2,
        name: queuedLots.name,
        spotifyUrl: queuedLots.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
      {
        id: 3,
        name: searching.name,
        spotifyUrl: searching.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 11,
        artist: 'Artist',
        name: 'Retry track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.RetryWaiting,
        playlistId: 1,
      },
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
      {
        id: 13,
        artist: 'Artist',
        name: 'Search track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
    ]);

    render({
      playlists: [retryOnly, queuedLots, searching, partial],
      totals: { playlists: 4, tracks: 201, onDisk: 52, available: 52 },
    });

    expect(component.visiblePlaylists.map((p) => p.name)).toEqual([
      'Searching now',
      'Queued lots',
      'Retry only',
      'Partial',
    ]);
    expect(component.focused?.name).toBe('Searching now');
  });

  it('labels retry-scheduled playlist work instead of calling it downloading', () => {
    const processing = playlist('processing', 'Processing', {
      trackCount: 50,
      onDisk: 47,
      available: 47,
      percentOnDisk: 94,
      percentAvailable: 94,
    });
    playlistService.all$.next([
      {
        id: 101,
        name: processing.name,
        spotifyUrl: processing.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 501,
        artist: 'Artist',
        name: 'Retrying track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.RetryWaiting,
        playlistId: 101,
        error: 'Temporary YouTube failure; search retry 1/3 in 15m',
      },
    ]);

    render({
      playlists: [processing],
      totals: { playlists: 1, tracks: 10, onDisk: 9, available: 9 },
    });

    const state = fixture.nativeElement.querySelector('.coverage');
    expect(state.textContent).toContain('1 queued');
    expect(state.textContent).toContain('not queued');
    expect(state.textContent).toContain('47 of 50 saved');
    expect(state.querySelector('button')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.detail-actions .btn-primary')
        .disabled,
    ).toBeFalse();
    expect(component.activityLabel(processing)).toBe('Retry scheduled');
  });

  it('does not scan coverage every few seconds while work is only queued', () => {
    const processing = playlist('processing', 'Processing');
    const queuePlaylist = {
      id: 101,
      name: processing.name,
      spotifyUrl: processing.spotifyUrl,
      active: false,
      isTrack: false,
      createdAt: 1,
      collapsed: false,
    };
    playlistService.all$.next([queuePlaylist]);
    trackService.all$.next([
      {
        id: 501,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 101,
      },
    ]);

    render({
      playlists: [processing],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });
    expect(
      (
        component as unknown as {
          coverageInterval: ReturnType<typeof setInterval> | null;
        }
      ).coverageInterval,
    ).toBeNull();

    trackService.all$.next([
      {
        id: 501,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 101,
      },
    ]);
    fixture.detectChanges();
    expect(
      (
        component as unknown as {
          coverageInterval: ReturnType<typeof setInterval> | null;
        }
      ).coverageInterval,
    ).not.toBeNull();

    trackService.all$.next([
      {
        id: 501,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 101,
      },
    ]);
    fixture.detectChanges();
    expect(
      (
        component as unknown as {
          coverageInterval: ReturnType<typeof setInterval> | null;
        }
      ).coverageInterval,
    ).toBeNull();
  });

  it('refreshes coverage when a running download leaves the live set', fakeAsync(() => {
    const processing = playlist('processing', 'Processing');
    playlistService.all$.next([
      {
        id: 101,
        name: processing.name,
        spotifyUrl: processing.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 501,
        artist: 'Artist',
        name: 'Downloading track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Downloading,
        playlistId: 101,
      },
    ]);

    render({
      playlists: [processing],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });
    const fetches = libraryService.fetch.calls.count();

    trackService.all$.next([]);
    fixture.detectChanges();
    tick(500);
    expect(libraryService.fetch.calls.count()).toBeGreaterThan(fetches);
    discardPeriodicTasks();
  }));

  it('lists only running search/download processes in the in-progress banner', () => {
    const searching = playlist('searching', 'Searching now');
    const retryOnly = playlist('retry-only', 'Retry only');
    playlistService.all$.next([
      {
        id: 3,
        name: searching.name,
        spotifyUrl: searching.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
      {
        id: 1,
        name: retryOnly.name,
        spotifyUrl: retryOnly.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 11,
        artist: 'Retry Artist',
        name: 'Retry track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.RetryWaiting,
        playlistId: 1,
        error: 'Temporary YouTube failure; search retry 1/3 in 15m',
      },
      {
        id: 12,
        artist: 'Queued Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 3,
      },
      {
        id: 13,
        artist: 'Search Artist',
        name: 'Search track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
    ]);

    render({
      playlists: [retryOnly, searching],
      totals: { playlists: 2, tracks: 20, onDisk: 0, available: 0 },
    });

    const banner = fixture.nativeElement.querySelector(
      '.operator-status',
    ) as HTMLElement;
    expect(banner).not.toBeNull();
    const title = fixture.nativeElement.querySelector(
      '.detail-title',
    ) as HTMLElement;
    expect(
      banner.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(banner.textContent).toContain('Search track');
    expect(banner.textContent).not.toContain('Retry track');
    expect(banner.textContent).not.toContain('Queued track');
    expect(banner.textContent).toContain('1 searching');
    expect(banner.querySelector('h2')?.textContent).toBe('Searching YouTube');
    expect(banner.textContent).not.toMatch(/\bfinding\b/);
    expect(banner.querySelector('.activity-copy')?.textContent).not.toContain(
      'waiting',
    );
    expect(banner.querySelector('.activity-copy')?.textContent).not.toContain(
      'retry',
    );
    expect(component.activeRips.map((track) => track.name)).toEqual([
      'Search track',
    ]);
    expect(component.globalActivitySummary()).toBe(
      '17 pending · 1 search · 1 waiting · 1 retry',
    );
    expect(component.runningActivitySummary()).toBe('1 searching');
    const wip = fixture.nativeElement.querySelector('tr.is-wip') as HTMLElement;
    expect(wip?.textContent).toContain('Search track');
    expect(wip?.textContent).not.toContain('Retry track');

    const searchingRow = [
      ...fixture.nativeElement.querySelectorAll('.pl-row'),
    ].find((row: HTMLElement) => row.textContent?.includes('Searching now')) as
      | HTMLElement
      | undefined;
    const retryRow = [
      ...fixture.nativeElement.querySelectorAll('.pl-row'),
    ].find((row: HTMLElement) => row.textContent?.includes('Retry only')) as
      | HTMLElement
      | undefined;
    expect(searchingRow?.querySelector('.state-pill.is-rip')).not.toBeNull();
    expect(searchingRow?.querySelector('.wip-spin')).not.toBeNull();
    expect(retryRow?.querySelector('.state-pill.is-wait')).not.toBeNull();
    expect(retryRow?.querySelector('.wip-spin')).toBeNull();
    expect(banner.textContent).toContain('Searching now');
    expect(banner.querySelector('button.rip-row')).not.toBeNull();
  });

  it('caps extra Searching rows to the live pace so stale searches are not in-progress processes', () => {
    const searching = playlist('searching', 'Searching now');
    playlistService.all$.next([
      {
        id: 3,
        name: searching.name,
        spotifyUrl: searching.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 11,
        artist: 'Cam Cole',
        name: 'Desire',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
      {
        id: 12,
        artist: 'Queensryche',
        name: 'Silent Lucidity',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
      {
        id: 13,
        artist: 'Billy Idol',
        name: 'Rebel Yell',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
    ]);

    render({
      playlists: [searching],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    expect(component.liveSearching).toBe(1);
    expect(component.liveQueued).toBe(2);
    expect(component.runningActivitySummary()).toBe('1 searching');
    expect(component.globalActivitySummary()).toContain('1 search');
    expect(component.globalActivitySummary()).not.toContain('3 search');
    expect(component.activityLabel(searching)).toBe('Searching');
    const banner = fixture.nativeElement.querySelector(
      '.operator-status',
    ) as HTMLElement;
    expect(banner.textContent).toContain('1 searching');
    expect(banner.textContent).toContain('Rebel Yell');
    expect(banner.textContent).not.toContain('Desire');
    expect(banner.textContent).not.toContain('Silent Lucidity');
    expect(component.activeRips.map((track) => track.name)).toEqual([
      'Rebel Yell',
    ]);
    expect(trackService.fetchActive).toHaveBeenCalled();
  });

  it('does not treat leftover Searching rows as in-progress during a safety-floor cooldown', () => {
    const searching = playlist('searching', 'Searching now');
    libraryService.youtubePace.and.returnValue(
      of({
        searchConc: 1,
        downloadConc: 1,
        searchActive: 0,
        downloadActive: 0,
        maxPerWindow: 8,
        downloadsInWindow: 1,
        windowMs: 600000,
        coolRemainingMs: 18 * 60 * 1000,
        autoStep: false,
        reason: 'FLOOR COOLDOWN downloadConc ERROR: bot-check',
        acquisitionOwner: {
          state: 'available',
          phase: null,
          telemetryFresh: false,
        },
      }),
    );
    playlistService.all$.next([
      {
        id: 3,
        name: searching.name,
        spotifyUrl: searching.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 13,
        artist: 'Artist',
        name: 'Search track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
    ]);

    render({
      playlists: [searching],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    expect(component.liveSearching).toBe(0);
    expect(component.runningActivitySummary()).toBe('');
    expect(component.activityLabel(searching)).not.toBe('Searching');
    expect(component.activityLabel(searching).toLowerCase()).toContain(
      'waiting',
    );
    expect(fixture.nativeElement.querySelector('.rip-banner')).toBeNull();
    expect(fixture.nativeElement.querySelector('.sidebar-running')).toBeNull();
  });

  it('refetches active tracks when YouTube pace is running work the live store lacks', () => {
    const queued = playlist('queued', 'Waiting leftovers');
    libraryService.youtubePace.and.returnValue(
      of({
        searchConc: 1,
        downloadConc: 3,
        searchActive: 1,
        downloadActive: 2,
        maxPerWindow: 48,
        downloadsInWindow: 16,
        windowMs: 600000,
        coolRemainingMs: 0,
        autoStep: false,
        reason: 'manual recover lastGood 3+1/48',
        acquisitionOwner: {
          state: 'available',
          phase: null,
          telemetryFresh: false,
        },
      }),
    );
    playlistService.all$.next([
      {
        id: 4,
        name: queued.name,
        spotifyUrl: queued.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 21,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 4,
      },
    ]);

    render({
      playlists: [queued],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    expect(component.liveDownloading).toBe(0);
    expect(component.liveSearching).toBe(0);
    expect(component.runningActivitySummary()).toBe('');
    expect(fixture.nativeElement.querySelector('.rip-banner')).toBeNull();
    expect(trackService.fetchActive).toHaveBeenCalled();
  });

  it('names waiting leftover on the focused ripping action, not only Searching', () => {
    const searching = playlist('searching', 'Searching now');
    playlistService.all$.next([
      {
        id: 3,
        name: searching.name,
        spotifyUrl: searching.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 13,
        artist: 'Artist',
        name: 'Search track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
    ]);

    render({
      playlists: [searching],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    const action = (
      fixture.nativeElement.querySelector('.detail-actions .btn-lg')
        ?.textContent || ''
    ).replace(/\s+/g, ' ');
    expect(action).toContain('Queue 9 for search & download');
    const state = fixture.nativeElement.querySelector('.coverage').textContent;
    expect(state).toContain('processing');
    expect(state).toContain('not queued');
    expect(state).toContain('0 of 10 saved');
    expect(component.activityLabel(searching)).toBe('Searching');
    const option = fixture.nativeElement.querySelector(
      '.pl-row',
    ) as HTMLElement;
    expect(option.getAttribute('aria-label')).toContain('Searching now');
    expect(option.getAttribute('aria-label')).toContain('9 pending');
  });

  it('opens the running playlist from the in-progress banner', () => {
    const searching = playlist('searching', 'Searching now');
    const queued = playlist('queued', 'Queued lots');
    playlistService.all$.next([
      {
        id: 3,
        name: searching.name,
        spotifyUrl: searching.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
      {
        id: 2,
        name: queued.name,
        spotifyUrl: queued.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 13,
        artist: 'Search Artist',
        name: 'Search track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
      {
        id: 12,
        artist: 'Queued Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [queued, searching],
      totals: { playlists: 2, tracks: 20, onDisk: 0, available: 0 },
    });

    component.focus(queued, false);
    fixture.detectChanges();
    expect(component.focused?.name).toBe('Queued lots');

    const row = fixture.nativeElement.querySelector(
      'button.rip-row',
    ) as HTMLButtonElement;
    expect(row).not.toBeNull();
    expect(row.getAttribute('aria-label')).toContain('Searching now');
    expect(row.textContent).toContain('Search track');
    expect(row.textContent).toContain('Searching now');
    row.click();
    fixture.detectChanges();
    expect(component.focused?.name).toBe('Searching now');
    expect(libraryService.syncPlaylist).not.toHaveBeenCalled();
  });

  it('does not treat queued-only work as an in-progress process', () => {
    const queued = playlist('queued', 'Queued lots');
    playlistService.all$.next([
      {
        id: 2,
        name: queued.name,
        spotifyUrl: queued.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [queued],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    expect(fixture.nativeElement.querySelector('.rip-banner')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.sidebar-activity .wip-spin'),
    ).toBeNull();
    expect(fixture.nativeElement.querySelector('.pl-row .wip-spin')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.state-pill.is-wait')?.textContent,
    ).toMatch(/waiting/i);
    expect(
      fixture.nativeElement.querySelector('.state-pill.is-wait')?.textContent,
    ).not.toContain('Queued');
    expect(
      fixture.nativeElement.querySelector('.state-pill.is-rip'),
    ).toBeNull();
    expect(component.hasQueuedWork).toBe(true);
    expect(component.runningNow(queued)).toBe(false);
  });

  it('does not apply live-queue drawer styles to Waiting track pills', () => {
    const queued = playlist('queued', 'Queued lots');
    playlistService.all$.next([
      {
        id: 2,
        name: queued.name,
        spotifyUrl: queued.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [queued],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });
    fixture.detectChanges();

    const pill = fixture.nativeElement.querySelector(
      '.pill.waiting',
    ) as HTMLElement;
    expect(pill).not.toBeNull();
    expect(pill.textContent).toContain('Waiting');
    expect(pill.classList.contains('queue')).toBe(false);
    expect(getComputedStyle(pill).flexDirection).not.toBe('column');
    const style = getComputedStyle(pill);
    // A missing/default border is also invisible; DOM-only hosts do not
    // always resolve the browser's default border width to the string 0px.
    expect(['', 'none', 'hidden'].includes(style.borderTopStyle) || style.borderTopWidth === '0px').toBeTrue();

    expect(fixture.nativeElement.querySelector('.live-queue')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.operator-status'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.pill.queue').length).toBe(
      0,
    );
  });

  it('compacts ripping playlist remaining-work counts and keeps the full text in the title', () => {
    const ripping = playlist('searching', 'Searching now', {
      trackCount: 79,
      onDisk: 16,
      available: 16,
      percentOnDisk: 20,
      percentAvailable: 20,
    });
    playlistService.all$.next([
      {
        id: 3,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 13,
        artist: 'Search Artist',
        name: 'Search track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
      {
        id: 14,
        artist: 'Queued Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 3,
      },
      {
        id: 15,
        artist: 'Queued Artist',
        name: 'Another queued',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 3,
      },
    ]);

    render({
      playlists: [ripping],
      totals: { playlists: 1, tracks: 79, onDisk: 16, available: 16 },
    });

    const sub = fixture.nativeElement.querySelector(
      '.pl-row .pl-sub',
    ) as HTMLElement;
    expect(sub.textContent?.trim()).toMatch(/^\d+\/\d+ saved$/);
    const subText = (sub.getAttribute('title') || '').replace(/\s+/g, ' ');
    expect(subText).toContain('16/79');
    expect(subText).toContain('1 search');
    expect(subText).toContain('2 waiting');
    expect(subText).toContain('searching');
    expect(subText).toContain('60 pending');
    expect(subText.indexOf('1 search')).toBeLessThan(
      subText.indexOf('2 waiting'),
    );
    expect(sub.getAttribute('title')).toContain(
      '16/79 · 60 pending · 1 searching · 2 waiting',
    );
  });

  it('includes confirmed misses on ripping remaining-work lines so counts reconcile', () => {
    const ripping = playlist('searching', 'Luk Isaan', {
      trackCount: 307,
      onDisk: 2,
      available: 2,
      failed: 7,
      percentOnDisk: 1,
      percentAvailable: 1,
    });
    playlistService.all$.next([
      {
        id: 3,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next(
      Array.from({ length: 294 }, (_, index) => ({
        id: 1000 + index,
        artist: 'Queued Artist',
        name: `Queued ${index}`,
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 3,
      })),
    );

    render({
      playlists: [ripping],
      totals: { playlists: 1, tracks: 307, onDisk: 2, available: 2 },
    });

    const stats = component.statsOf(ripping);
    expect(stats.onDisk + stats.failed + stats.pending + stats.queued).toBe(
      307,
    );
    const sub = fixture.nativeElement.querySelector(
      '.pl-row .pl-sub',
    ) as HTMLElement;
    expect(sub.textContent?.trim()).toMatch(/^\d+\/\d+ saved$/);
    const subText = (sub.getAttribute('title') || '').replace(/\s+/g, ' ');
    expect(subText).toContain('2/307');
    expect(subText).toContain('7 missing');
    expect(subText).toContain('294 waiting');
    expect(subText).toContain('4 pending');
    expect(subText.indexOf('7 missing')).toBeLessThan(
      subText.indexOf('294 waiting'),
    );
    expect(sub.getAttribute('title')).toContain(
      '2/307 · 7 missing · 4 pending · 294 waiting',
    );
    const row = fixture.nativeElement.querySelector('.pl-row') as HTMLElement;
    expect(row.querySelector('.state-pill.is-done')).toBeNull();
    expect(row.querySelector('.state-pill.is-wait')?.textContent).toContain(
      '294 waiting',
    );
  });

  it('labels a finished playlist with misses as Finished, not Done', () => {
    const finished = playlist('ravel', 'This Is Ravel', {
      trackCount: 69,
      onDisk: 65,
      available: 65,
      failed: 4,
      percentOnDisk: 94,
      percentAvailable: 94,
    });
    const complete = playlist('complete', 'All saved', {
      trackCount: 10,
      onDisk: 10,
      available: 10,
      percentOnDisk: 100,
      percentAvailable: 100,
    });

    render({
      playlists: [finished, complete],
      totals: { playlists: 2, tracks: 79, onDisk: 75, available: 75 },
    });

    const rows = [
      ...fixture.nativeElement.querySelectorAll('.pl-row'),
    ] as HTMLElement[];
    const ravel = rows.find((row) =>
      row.textContent?.includes('This Is Ravel'),
    ) as HTMLElement;
    const saved = rows.find((row) =>
      row.textContent?.includes('All saved'),
    ) as HTMLElement;

    expect(component.statsOf(finished).done).toBe(true);
    expect(ravel.classList).toContain('is-partial');
    expect(ravel.classList).not.toContain('is-done');
    expect(
      ravel.querySelector('.state-pill.is-partial')?.textContent,
    ).toContain('Finished');
    expect(ravel.querySelector('.state-pill.is-done')).toBeNull();
    expect(
      (ravel.querySelector('.pl-sub')?.getAttribute('title') || '').replace(
        /\s+/g,
        ' ',
      ),
    ).toContain('65/69 · 4 missing');
    expect(ravel.querySelector('.pl-sub')?.getAttribute('title')).not.toContain(
      'saved',
    );

    expect(saved.classList).toContain('is-done');
    expect(saved.querySelector('.state-pill.is-done')?.textContent).toContain(
      'Done',
    );
    expect(saved.querySelector('.state-pill.is-partial')).toBeNull();
    expect(saved.querySelector('.pl-sub')?.getAttribute('title')).toContain(
      '10/10 saved',
    );

    component.hideComplete = true;
    fixture.detectChanges();
    expect(component.visiblePlaylists.map((p) => p.name)).toEqual([
      'This Is Ravel',
    ]);
  });

  it('shows missing on incomplete playlists that are not ripping', () => {
    const partial = playlist('massage', 'Massage', {
      trackCount: 293,
      onDisk: 1,
      available: 1,
      failed: 2,
      percentOnDisk: 0,
      percentAvailable: 0,
    });

    render({
      playlists: [partial],
      totals: { playlists: 1, tracks: 293, onDisk: 1, available: 1 },
    });

    const row = fixture.nativeElement.querySelector('.pl-row') as HTMLElement;
    expect(
      (row.querySelector('.pl-sub')?.getAttribute('title') || '').replace(
        /\s+/g,
        ' ',
      ),
    ).toContain('1/293 on disk · 2 missing');
    expect(row.querySelector('.state-pill.is-needs')?.textContent).toContain(
      '290 needed',
    );
  });

  it('shows copyable remainder instead of treating those tracks as YouTube work', () => {
    const partial = playlist('surrender', 'State Of Surrender Radio', {
      trackCount: 50,
      onDisk: 23,
      available: 30,
      failed: 0,
      percentOnDisk: 46,
      percentAvailable: 60,
    });

    render({
      playlists: [partial],
      totals: { playlists: 1, tracks: 50, onDisk: 23, available: 30 },
    });

    const stats = component.statsOf(partial);
    expect(stats.copyable).toBe(7);
    expect(stats.pending).toBe(20);
    expect(stats.onDisk + stats.copyable + stats.pending).toBe(50);

    const row = fixture.nativeElement.querySelector('.pl-row') as HTMLElement;
    const subText = (
      row.querySelector('.pl-sub')?.getAttribute('title') || ''
    ).replace(/\s+/g, ' ');
    expect(subText).toContain('23/50 on disk');
    expect(subText).toContain('7 copyable');
    expect(row.querySelector('.state-pill.is-needs')?.textContent).toContain(
      '20 needed',
    );
    expect(row.querySelector('.pl-sub')?.getAttribute('title')).toContain(
      '23/50 on disk · 7 copyable',
    );
    expect(
      fixture.nativeElement.querySelector('.coverage')?.textContent,
    ).toContain('7 available in another folder');
  });

  it('keeps copyable out of ripping remainder when those songs are already waiting', () => {
    const ripping = playlist('surrender', 'State Of Surrender Radio', {
      trackCount: 50,
      onDisk: 23,
      available: 30,
      percentOnDisk: 46,
      percentAvailable: 60,
    });
    playlistService.all$.next([
      {
        id: 8,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next(
      Array.from({ length: 27 }, (_, index) => ({
        id: 3000 + index,
        artist: 'Queued Artist',
        name: `Queued ${index}`,
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 8,
      })),
    );

    render({
      playlists: [ripping],
      totals: { playlists: 1, tracks: 50, onDisk: 23, available: 30 },
    });

    const stats = component.statsOf(ripping);
    expect(stats.queued).toBe(27);
    expect(stats.copyable).toBe(0);
    expect(stats.pending).toBe(0);
    const subText = (
      fixture.nativeElement
        .querySelector('.pl-row .pl-sub')
        ?.getAttribute('title') || ''
    ).replace(/\s+/g, ' ');
    expect(subText).toContain('23/50');
    expect(subText).toContain('27 waiting');
    expect(subText).not.toContain('copyable');
  });

  it('lists idle copyable tracks on a ripping playlist before pending work', () => {
    const ripping = playlist('surrender', 'State Of Surrender Radio', {
      trackCount: 50,
      onDisk: 23,
      available: 30,
      percentOnDisk: 46,
      percentAvailable: 60,
    });
    playlistService.all$.next([
      {
        id: 8,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 88,
        artist: 'Search Artist',
        name: 'Search track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 8,
      },
    ]);

    render({
      playlists: [ripping],
      totals: { playlists: 1, tracks: 50, onDisk: 23, available: 30 },
    });

    const stats = component.statsOf(ripping);
    expect(stats.copyable).toBe(7);
    expect(stats.pending).toBe(19);
    expect(stats.searching).toBe(1);
    expect(
      stats.onDisk + stats.copyable + stats.pending + stats.searching,
    ).toBe(50);
    const sub = fixture.nativeElement.querySelector(
      '.pl-row .pl-sub',
    ) as HTMLElement;
    expect(sub.textContent?.trim()).toMatch(/^\d+\/\d+ saved$/);
    const subText = (sub.getAttribute('title') || '').replace(/\s+/g, ' ');
    expect(subText).toContain('23/50');
    expect(subText).toContain('7 copyable');
    expect(subText).toContain('19 pending');
    expect(subText).toContain('1 search');
    expect(subText.indexOf('7 copyable')).toBeLessThan(
      subText.indexOf('1 search'),
    );
    expect(sub.getAttribute('title')).toContain(
      '23/50 · 7 copyable · 19 pending · 1 searching',
    );
  });

  it('does not paint the previous playlist tracks onto a newly focused playlist', () => {
    const ripping = playlist('searching', 'Luk Isaan', {
      trackCount: 307,
      onDisk: 2,
      available: 2,
      failed: 7,
      percentOnDisk: 1,
      percentAvailable: 1,
    });
    const finished = playlist('ravel', 'This Is Ravel', {
      trackCount: 69,
      onDisk: 65,
      available: 65,
      failed: 4,
      percentOnDisk: 94,
      percentAvailable: 94,
    });
    playlistService.all$.next([
      {
        id: 3,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next(
      Array.from({ length: 40 }, (_, index) => ({
        id: 2000 + index,
        artist: 'Queued Artist',
        name: `Queued ${index}`,
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 3,
      })),
    );

    render({
      playlists: [ripping, finished],
      totals: { playlists: 2, tracks: 376, onDisk: 67, available: 67 },
    });
    component.focus(ripping, false);
    fixture.detectChanges();
    expect(component.detail?.playlist.id).toBe(ripping.id);
    expect(component.statsOf(ripping).queued).toBe(40);

    libraryService.detail.and.callFake((id) =>
      id === finished.id ? NEVER : of(detail(ripping)),
    );
    component.focus(finished, false);
    fixture.detectChanges();

    expect(component.focused?.id).toBe(finished.id);
    expect(component.detail).toBeNull();
    expect(component.statsOf(finished).queued).toBe(0);
    expect(component.statsOf(finished).ripping).toBe(false);
    const ravel = [...fixture.nativeElement.querySelectorAll('.pl-row')].find(
      (row: HTMLElement) => row.textContent?.includes('This Is Ravel'),
    ) as HTMLElement;
    expect(
      ravel.querySelector('.state-pill.is-partial')?.textContent,
    ).toContain('Finished');
    expect(ravel.textContent).not.toContain('Downloading');
    expect(ravel.textContent).not.toContain('waiting');
    expect(
      fixture.nativeElement.querySelector('.detail-title')?.textContent.trim(),
    ).toBe(finished.name);
    expect(fixture.nativeElement.querySelector('.coverage-label')?.textContent).toContain('need review');
    expect(fixture.nativeElement.querySelector('table.tracks')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.track-wrap')?.textContent,
    ).toContain('Loading tracks');
  });

  it('scrolls the track table to running work after the rows render', fakeAsync(() => {
    const mixed = playlist('mixed', 'Mixed coverage', {
      trackCount: 3,
      onDisk: 2,
      available: 2,
      percentOnDisk: 67,
      percentAvailable: 67,
    });
    playlistService.all$.next([
      {
        id: 9,
        name: mixed.name,
        spotifyUrl: mixed.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 90,
        artist: 'Search Artist',
        name: 'Search track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 9,
      },
    ]);

    render({
      playlists: [mixed],
      totals: { playlists: 1, tracks: 3, onDisk: 2, available: 2 },
    });
    tick(50);
    fixture.detectChanges();

    const wrap = fixture.nativeElement.querySelector(
      '.track-wrap',
    ) as HTMLElement;
    const wip = wrap.querySelector('tr.is-wip') as HTMLElement | null;
    expect(wip?.textContent).toContain('Search track');
    expect(wip?.textContent).toContain('Finding on YouTube');
    expect(wrap.querySelector('tr.is-playable')?.textContent).toContain(
      'On disk one',
    );
    discardPeriodicTasks();
  }));

  it('shows a running download on an on-disk track instead of hiding it as saved', () => {
    const mixed = playlist('mixed', 'Mixed coverage', {
      trackCount: 3,
      onDisk: 2,
      available: 2,
      percentOnDisk: 67,
      percentAvailable: 67,
    });
    playlistService.all$.next([
      {
        id: 9,
        name: mixed.name,
        spotifyUrl: mixed.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 91,
        artist: 'Saved',
        name: 'On disk one',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Downloading,
        playlistId: 9,
      },
    ]);

    render({
      playlists: [mixed],
      totals: { playlists: 1, tracks: 3, onDisk: 2, available: 2 },
    });

    const wip = fixture.nativeElement.querySelector(
      'tr.is-wip',
    ) as HTMLElement | null;
    expect(wip?.textContent).toContain('On disk one');
    expect(wip?.textContent).toContain('Downloading');
    expect(wip?.classList.contains('is-playable')).toBe(true);
    expect(wip?.querySelector('.play-btn')).not.toBeNull();
    expect(wip?.querySelector('.track-file.is-ready')?.textContent).toContain(
      'Saved - On disk one.mp3',
    );
    expect(component.statusKind(component.detail!.tracks[0])).toBe('rip');
  });

  it('keeps the focused playlist occurrence downloading when another copy is only waiting', () => {
    const ripping = playlist('mozart-a', 'Mozart A');
    const other = playlist('mozart-b', 'Mozart B');
    playlistService.all$.next([
      {
        id: 21,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
      {
        id: 22,
        name: other.name,
        spotifyUrl: other.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 210,
        artist: 'Wolfgang Amadeus Mozart, Andrew Smith, Joshua Pierce',
        name: 'Sonata for Violin and Piano in E-Flat Major, K. 380: III. Rondeau',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Downloading,
        playlistId: 21,
      },
      {
        id: 220,
        artist: 'Wolfgang Amadeus Mozart, Andrew Smith, Joshua Pierce',
        name: 'Sonata for Violin and Piano in E-Flat Major, K. 380: III. Rondeau',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 22,
      },
    ]);

    render({
      playlists: [ripping, other],
      totals: { playlists: 2, tracks: 2, onDisk: 0, available: 0 },
    });
    component.focus(ripping, false);
    fixture.detectChanges();

    const wip = fixture.nativeElement.querySelector(
      'tr.is-wip',
    ) as HTMLElement | null;
    expect(wip?.textContent).toContain('K. 380: III. Rondeau');
    expect(wip?.textContent).toContain('Downloading');
    expect(component.statusKind(component.detail!.tracks[0])).toBe('rip');
  });

  it('does not paint another playlist running job onto a focused occurrence with no live row', () => {
    const saved = playlist('mozart-b', 'Mozart B', {
      trackCount: 1,
      onDisk: 1,
      available: 1,
      percentOnDisk: 100,
      percentAvailable: 100,
    });
    const ripping = playlist('mozart-a', 'Mozart A');
    playlistService.all$.next([
      {
        id: 21,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
      {
        id: 22,
        name: saved.name,
        spotifyUrl: saved.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 210,
        artist: 'Wolfgang Amadeus Mozart, Andrew Smith, Joshua Pierce',
        name: 'Sonata for Violin and Piano in E-Flat Major, K. 380: III. Rondeau',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Downloading,
        playlistId: 21,
      },
    ]);

    render({
      playlists: [saved, ripping],
      totals: { playlists: 2, tracks: 2, onDisk: 1, available: 1 },
    });
    component.focus(saved, false);
    fixture.detectChanges();

    expect(component.statusKind(component.detail!.tracks[0])).toBe('disk');
    expect(fixture.nativeElement.querySelector('tr.is-wip')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.pill.on')?.textContent,
    ).toContain('on disk');
    expect(fixture.nativeElement.querySelector('.pill.dl')).toBeNull();
  });

  it('does not steal the playlist list from running work to chase a waiting focused row', fakeAsync(() => {
    const waiting = playlist('queued', 'Waiting lots', {
      trackCount: 80,
      onDisk: 0,
      available: 0,
    });
    const searching = playlist('searching', 'Searching now', {
      trackCount: 10,
      onDisk: 0,
      available: 0,
    });
    playlistService.all$.next([
      {
        id: 2,
        name: waiting.name,
        spotifyUrl: waiting.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [waiting, searching],
      totals: { playlists: 2, tracks: 90, onDisk: 0, available: 0 },
    });
    component.focus(waiting, false);
    fixture.detectChanges();
    tick();

    const box = {
      left: 0,
      right: 200,
      width: 200,
      x: 0,
      y: 0,
      toJSON() {},
    };
    spyOn(HTMLElement.prototype, 'getBoundingClientRect').and.callFake(
      function (this: HTMLElement) {
        if (this.classList.contains('is-focused')) {
          return { top: 400, bottom: 440, height: 40, ...box } as DOMRect;
        }
        if (this.classList.contains('sidebar-list')) {
          return { top: 0, bottom: 80, height: 80, ...box } as DOMRect;
        }
        return { top: 0, bottom: 40, height: 40, ...box } as DOMRect;
      },
    );
    const scroll = spyOn(HTMLElement.prototype, 'scrollIntoView');

    playlistService.all$.next([
      {
        id: 2,
        name: waiting.name,
        spotifyUrl: waiting.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
      {
        id: 3,
        name: searching.name,
        spotifyUrl: searching.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
      {
        id: 13,
        artist: 'Search Artist',
        name: 'Search track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
    ]);
    fixture.detectChanges();
    tick();

    expect(component.visiblePlaylists[0].id).toBe('searching');
    expect(component.focused?.id).toBe('queued');
    expect(component.runningPlaylists.map((p) => p.name)).toEqual([
      'Searching now',
    ]);
    expect(
      fixture.nativeElement.querySelector('button.rip-row')?.textContent,
    ).toContain('Searching now');
    expect(scroll).not.toHaveBeenCalled();
    discardPeriodicTasks();
  }));

  it('keeps a running focused playlist in view when live work reorders the list', fakeAsync(() => {
    // Model row movement explicitly instead of depending on the test host's
    // layout engine. The production behavior still uses real element offsets.
    spyOnProperty(HTMLElement.prototype, 'offsetTop', 'get').and.callFake(
      function (this: HTMLElement) {
        return this.parentElement ? Array.from(this.parentElement.children).indexOf(this) * 40 : 0;
      },
    );
    const searching = playlist('searching', 'Searching now', {
      trackCount: 10,
      onDisk: 0,
      available: 0,
    });
    const downloading = playlist('ripping', 'Ripping now', {
      trackCount: 12,
      onDisk: 0,
      available: 0,
    });
    playlistService.all$.next([
      {
        id: 3,
        name: searching.name,
        spotifyUrl: searching.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 13,
        artist: 'Search Artist',
        name: 'Search track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
    ]);

    render({
      playlists: [searching, downloading],
      totals: { playlists: 2, tracks: 22, onDisk: 0, available: 0 },
    });
    component.focus(searching, false);
    component.mobileLibraryOpen = true;
    fixture.detectChanges();
    tick();

    const box = {
      left: 0,
      right: 200,
      width: 200,
      x: 0,
      y: 0,
      toJSON() {},
    };
    spyOn(HTMLElement.prototype, 'getBoundingClientRect').and.callFake(
      function (this: HTMLElement) {
        if (this.classList.contains('is-focused')) {
          return { top: 400, bottom: 440, height: 40, ...box } as DOMRect;
        }
        if (this.classList.contains('sidebar-list')) {
          return { top: 0, bottom: 80, height: 80, ...box } as DOMRect;
        }
        return { top: 0, bottom: 40, height: 40, ...box } as DOMRect;
      },
    );
    const scroll = spyOn(HTMLElement.prototype, 'scrollIntoView');

    playlistService.all$.next([
      {
        id: 3,
        name: searching.name,
        spotifyUrl: searching.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
      {
        id: 4,
        name: downloading.name,
        spotifyUrl: downloading.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 13,
        artist: 'Search Artist',
        name: 'Search track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
      {
        id: 14,
        artist: 'Rip Artist',
        name: 'Rip track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Downloading,
        playlistId: 4,
      },
    ]);
    fixture.detectChanges();
    tick();

    expect(component.visiblePlaylists[0].id).toBe('ripping');
    expect(component.focused?.id).toBe('searching');
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    expect(component.runningPlaylists.map((p) => p.name)).toEqual([
      'Ripping now',
      'Searching now',
    ]);
    expect(fixture.nativeElement.querySelector('.sidebar-running')).toBeNull();
    discardPeriodicTasks();
  }));

  it('opens a running playlist from the sidebar live block without a Spotify resync', () => {
    const searching = playlist('searching', 'Searching now');
    const waiting = playlist('queued', 'Waiting lots', {
      trackCount: 80,
      onDisk: 0,
    });
    libraryService.syncPlaylist.and.returnValue(
      of({ started: true }),
    );
    playlistService.all$.next([
      {
        id: 3,
        name: searching.name,
        spotifyUrl: searching.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 13,
        artist: 'Search Artist',
        name: 'Search track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Searching,
        playlistId: 3,
      },
    ]);

    render({
      playlists: [waiting, searching],
      totals: { playlists: 2, tracks: 90, onDisk: 0, available: 0 },
    });
    component.focus(waiting, false);
    fixture.detectChanges();
    expect(component.focused?.id).toBe('queued');

    const now = fixture.nativeElement.querySelector(
      'button.rip-row',
    ) as HTMLButtonElement;
    expect(now.textContent).toContain('Searching now');
    now.click();
    fixture.detectChanges();
    expect(component.focused?.id).toBe('searching');
    expect(libraryService.syncPlaylist).not.toHaveBeenCalled();
  });

  it('shows CLI throughput, disk and ETA separately from paused web-worker activity', () => {
    const pace = {
      searchConc: 1,
      downloadConc: 2,
      searchActive: 0,
      downloadActive: 2,
      maxPerWindow: 96,
      downloadsInWindow: 88,
      windowMs: 600000,
      coolRemainingMs: 0,
    };
    libraryService.youtubePace.and.returnValue(
      of({
        ...pace,
        searchActive: 0,
        downloadActive: 0,
        autoStep: false,
        reason: null,
        acquisition: {
          at: new Date().toISOString(),
          verifiedNewMp3: 110,
          remainingUnique: 13361,
          diskGB: 53.824,
          mp3PerMinute: 8,
          baselineMultiple: 8 / 3,
          elapsedMinutes: 13.75,
          held: false,
          contentReviewPendingUnique: 7,
          eta: {
            continuous: '2026-09-14T01:00:00Z',
            buffered25: '2026-09-14T08:00:00Z',
          },
          pace,
        },
      }),
    );
    render({
      playlists: [playlist('saved', 'Saved library')],
      totals: { playlists: 1, tracks: 90, onDisk: 0, available: 0 },
    });
    const banner = fixture.nativeElement.querySelector(
      '.operator-status',
    ) as HTMLElement;
    expect(banner.textContent).toContain('8.00 MP3/min');
    expect(banner.textContent).toContain('CLI is downloading');
    expect(banner.textContent).toContain('13,361 songs remaining');
    expect(banner.textContent).toContain('53.82 GB');
    expect(banner.textContent).toContain('with buffer:');
    expect(component.ownerBlocksAcquisition).toBeTrue();
    expect(component.paceLine()).toContain('CLI 2+1');
    expect(component.showYoutubePace).toBeTrue();
    expect(component.bulkActionsBlocked).toBeTrue();
    component.downloadRemaining();
    expect(libraryService.downloadRemaining).not.toHaveBeenCalled();
  });

  it('exposes the YouTube safety floor and window without leaking the raw reason', () => {
    const queued = playlist('queued', 'Queued lots');
    const floor: YoutubePaceSnapshot = {
      searchConc: 1,
      downloadConc: 1,
      searchActive: 1,
      downloadActive: 0,
      maxPerWindow: 8,
      downloadsInWindow: 8,
      windowMs: 600000,
      coolRemainingMs: 0,
      autoStep: false,
      reason:
        'FLOOR COOLDOWN downloadConc ERROR: Sign in to confirm you are not a bot',
    };
    libraryService.youtubePace.and.returnValue(of(floor));
    playlistService.all$.next([
      {
        id: 2,
        name: queued.name,
        spotifyUrl: queued.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [queued],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    const pace = fixture.nativeElement.querySelector(
      '.technical-pace',
    ) as HTMLElement;
    expect(pace?.textContent).toContain('YouTube 1+1 · 8/8 this 10m');
    expect(pace?.querySelector('.technical-pace-note')?.textContent).toContain(
      'Safety floor — downloads held',
    );
    expect(pace?.textContent).not.toContain('next window');
    expect(pace?.getAttribute('title')).toContain('YouTube 1+1 · 8/8 this 10m');
    expect(
      [
        ...fixture.nativeElement.querySelectorAll(
          '.library-sync-actions button',
        ),
      ].map((button: HTMLButtonElement) => button.textContent?.trim()),
    ).toEqual(['Rescan saved files']);
    expect(fixture.nativeElement.querySelector('.sync-library').textContent).toContain('Sync Spotify library');
    expect(
      fixture.nativeElement.querySelector('.sidebar-filters')?.textContent,
    ).not.toContain('Sync library');
    expect(fixture.nativeElement.textContent).not.toContain('FLOOR COOLDOWN');
    expect(component.isSafetyFloor()).toBe(true);
    expect(component.showYoutubePace).toBe(true);
  });

  it('names an active cooldown instead of calling it a running process', () => {
    const queued = playlist('queued', 'Queued lots');
    libraryService.youtubePace.and.returnValue(
      of({
        searchConc: 1,
        downloadConc: 1,
        searchActive: 0,
        downloadActive: 0,
        maxPerWindow: 8,
        downloadsInWindow: 3,
        windowMs: 600000,
        coolRemainingMs: 12 * 60 * 1000,
        autoStep: false,
        reason: 'FLOOR COOLDOWN',
        acquisitionOwner: {
          state: 'available',
          phase: null,
          telemetryFresh: false,
        },
      }),
    );
    playlistService.all$.next([
      {
        id: 2,
        name: queued.name,
        spotifyUrl: queued.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [queued],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    expect(
      fixture.nativeElement.querySelector('.technical-pace-note')?.textContent,
    ).toContain('Safety floor — cooldown 12m');
    expect(
      fixture.nativeElement.querySelector('.sidebar-activity .wip-spin'),
    ).toBeNull();
  });

  it('does not say downloads are held while a floor download is running', () => {
    const ripping = playlist('ripping', 'Ripping now');
    libraryService.youtubePace.and.returnValue(
      of({
        searchConc: 1,
        downloadConc: 1,
        searchActive: 0,
        downloadActive: 1,
        maxPerWindow: 8,
        downloadsInWindow: 8,
        windowMs: 600000,
        coolRemainingMs: 0,
        autoStep: false,
        reason: 'FLOOR COOLDOWN',
      }),
    );
    playlistService.all$.next([
      {
        id: 4,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 40,
        artist: 'Artist',
        name: 'Downloading track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Downloading,
        playlistId: 4,
      },
    ]);

    render({
      playlists: [ripping],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    expect(
      fixture.nativeElement.querySelector('.technical-pace-note')?.textContent,
    ).toContain('Safety floor — window full');
    expect(fixture.nativeElement.textContent).not.toContain('downloads held');
    expect(fixture.nativeElement.textContent).not.toContain('FLOOR COOLDOWN');
  });

  it('shows a read-only live queue without delete or retry controls', () => {
    const queued = playlist('queued', 'Queued lots');
    playlistService.all$.next([
      {
        id: 2,
        name: queued.name,
        spotifyUrl: queued.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [queued],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });
    component.queueOpen = true;
    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector(
      '.queue-pl',
    ) as HTMLButtonElement;
    expect(row).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('.queued-playlists summary')
        ?.textContent,
    ).toContain('1 playlists with queued work');
    expect(fixture.nativeElement.querySelector('.live-queue')).toBeNull();
    expect(row.textContent).toContain('Queued lots');
    expect(row.textContent).toContain('9 pending · 1 waiting');
    expect(fixture.nativeElement.querySelector('app-playlist-box')).toBeNull();
    expect(fixture.nativeElement.querySelector('.fa-xmark')).toBeNull();
    expect(fixture.nativeElement.querySelector('.fa-repeat')).toBeNull();
    expect(playlistService.delete).not.toHaveBeenCalled();
    expect(playlistService.retryFailed).not.toHaveBeenCalled();

    expect(component.activityDetailsOpen).toBeTrue();
    expect(fixture.nativeElement.querySelector('.track-wrap')).not.toBeNull();

    row.click();
    fixture.detectChanges();
    expect(component.focused?.name).toBe('Queued lots');
    expect(component.queueOpen).toBe(false);
    expect(component.activityDetailsOpen).toBeFalse();
  });

  it('closes the live-queue overlay when a playlist is chosen from the list', () => {
    const queued = playlist('queued', 'Queued lots');
    render({
      playlists: [queued],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });
    component.queueOpen = true;
    fixture.detectChanges();
    expect(component.queueOpen).toBe(true);

    const row = fixture.nativeElement.querySelector('.pl-row') as HTMLElement;
    row.click();
    fixture.detectChanges();
    expect(component.queueOpen).toBe(false);
  });

  it('shows needs retry from live Error jobs even when the dump leftover would look queued', () => {
    const ripping = playlist('queued', 'Queued lots', {
      trackCount: 10,
      onDisk: 0,
      available: 0,
    });
    playlistService.all$.next([
      {
        id: 2,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
      {
        id: 13,
        artist: 'Artist',
        name: 'Failed track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Error,
        error: 'Temporary YouTube failure: socket timed out',
        playlistId: 2,
      },
    ]);

    render({
      playlists: [ripping],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    const stats = component.statsOf(ripping);
    expect(stats.needsRetry).toBe(1);
    expect(stats.queued).toBe(1);
    const subText = (
      fixture.nativeElement
        .querySelector('.pl-row .pl-sub')
        ?.getAttribute('title') || ''
    ).replace(/\s+/g, ' ');
    expect(subText).toContain('1 needs retry');
    expect(subText).toContain('8 pending');
  });

  it('does not let Hide finished conceal live queue work', () => {
    const liveDone = playlist('live-done', 'Live done', {
      onDisk: 10,
      available: 10,
      percentOnDisk: 100,
      percentAvailable: 100,
    });
    const completed = playlist('completed', 'Completed', {
      onDisk: 10,
      available: 10,
      percentOnDisk: 100,
      percentAvailable: 100,
    });
    playlistService.all$.next([
      {
        id: 7,
        name: liveDone.name,
        spotifyUrl: liveDone.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 70,
        artist: 'Artist',
        name: 'Retrying track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 7,
      },
    ]);

    render({
      playlists: [liveDone, completed],
      totals: { playlists: 2, tracks: 20, onDisk: 20, available: 20 },
    });
    expect(component.statsOf(liveDone).done).toBe(true);
    expect(component.statsOf(liveDone).ripping).toBe(true);

    component.hideComplete = true;
    fixture.detectChanges();

    expect(component.visiblePlaylists.map((p) => p.name)).toEqual([
      'Live done',
    ]);
    expect(
      fixture.nativeElement.querySelector('.pl-row')?.textContent,
    ).toContain('Live done');
    expect(component.attentionPlaylists).toBe(1);
    expect(
      fixture.nativeElement.querySelector('.sidebar-attention'),
    ).toBeNull();
    component.selectIncomplete();
    expect(component.selected.has(liveDone.uri)).toBe(true);
    expect(component.selected.has(completed.uri)).toBe(false);
  });

  it('does not auto-resync a playlist while live Spotify sync is degraded', () => {
    const first = playlist('saved', 'Saved playlist');
    const second = playlist('other', 'Other playlist');
    libraryService.syncPlaylist.and.returnValue(
      of({ started: true }),
    );

    render({
      playlists: [first, second],
      totals: { playlists: 2, tracks: 20, onDisk: 0, available: 0 },
    });

    expect(component.syncNotice).toContain('showing saved library');
    expect(component.librarySyncDegraded).toBe(true);

    component.focus(second);
    expect(libraryService.syncPlaylist).not.toHaveBeenCalled();
    expect(component.focused?.name).toBe('Other playlist');
  });

  it('still allows an explicit playlist resync after a degraded library sync', () => {
    const saved = playlist('saved', 'Saved playlist');
    libraryService.syncPlaylist.and.returnValue(
      of({ started: true }),
    );

    render({
      playlists: [saved],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });
    expect(component.librarySyncDegraded).toBe(true);

    component.resyncFocused();
    expect(libraryService.syncPlaylist).toHaveBeenCalled();
  });

  it('labels library-wide counts as playlist occurrences, not unique songs', () => {
    const partial = playlist('partial', 'Partial', {
      trackCount: 10,
      onDisk: 4,
      available: 4,
      percentOnDisk: 40,
      percentAvailable: 40,
    });

    render({
      playlists: [partial],
      totals: { playlists: 1, tracks: 10, onDisk: 4, available: 4 },
    });

    const meta = fixture.nativeElement.querySelector(
      '.sidebar-meta',
    ) as HTMLElement;

    const metaText = (meta.textContent || '').replace(/\s+/g, ' ');
    expect(metaText).toContain('4/10 occurrences on disk');
    expect(metaText).not.toContain('4 saved');
    expect(metaText).not.toContain('10 tracks');
    expect(metaText).not.toMatch(/\b4 on disk\b/);
    expect(
      fixture.nativeElement.querySelector('.sidebar-attention'),
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.coverage-label').textContent,
    ).toContain('4 of 10 saved');
  });

  it('packs stats, live activity, and the queue guard into a compact sidebar head', () => {
    const queued = playlist('queued', 'Queued lots', {
      onDisk: 4,
      available: 4,
      percentOnDisk: 40,
      percentAvailable: 40,
    });
    libraryService.syncLibraryStatus.and.returnValue(
      of({
        running: false,
        done: 0,
        total: 0,
        discovered: 0,
        changed: 0,
        errors: ['Spotify library request failed: 429'],
        current: '',
        startedAt: '2026-09-11T13:19:21.637Z',
        finishedAt: new Date().toISOString(),
      }),
    );
    libraryService.youtubePace.and.returnValue(
      of({
        searchConc: 1,
        downloadConc: 1,
        searchActive: 1,
        downloadActive: 0,
        maxPerWindow: 8,
        downloadsInWindow: 8,
        windowMs: 600000,
        coolRemainingMs: 0,
        autoStep: false,
        reason: 'FLOOR COOLDOWN',
        acquisitionOwner: {
          state: 'available',
          phase: null,
          telemetryFresh: false,
        },
      }),
    );
    playlistService.all$.next([
      {
        id: 2,
        name: queued.name,
        spotifyUrl: queued.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [queued],
      totals: { playlists: 1, tracks: 10, onDisk: 4, available: 4 },
    });

    const head = fixture.nativeElement.querySelector(
      '.sidebar-head',
    ) as HTMLElement;
    expect(head.querySelector('.sidebar-stats')?.textContent).toContain(
      '4/10 occurrences on disk',
    );
    expect(head.querySelector('.sidebar-live')).toBeNull();
    expect(head.querySelector('.sync-notice')).toBeNull();
    expect(
      fixture.nativeElement.querySelectorAll('.operator-status').length,
    ).toBe(1);
    expect(
      fixture.nativeElement.querySelector('.technical-summary').textContent,
    ).toContain('1 waiting');
    expect(
      fixture.nativeElement.querySelector('.technical-pace').textContent,
    ).toContain('YouTube 1+1');
  });

  it('keeps playlist listbox selection on the checkboxes, with keyboard support', () => {
    const first = playlist('alpha', 'Alpha list', { rank: 1 });
    const second = playlist('beta', 'Beta list', { rank: 2 });
    const third = playlist('gamma', 'Gamma list', { rank: 3 });

    render({
      playlists: [first, second, third],
      totals: { playlists: 3, tracks: 30, onDisk: 0, available: 0 },
    });

    const list = fixture.nativeElement.querySelector(
      '.sidebar-list',
    ) as HTMLElement;
    expect(list.getAttribute('role')).toBe('listbox');
    expect(list.getAttribute('aria-multiselectable')).toBe('true');
    expect(list.getAttribute('aria-activedescendant')).toBe('pl-alpha');

    let options = [
      ...fixture.nativeElement.querySelectorAll('.pl-row'),
    ] as HTMLElement[];
    expect(options[0].id).toBe('pl-alpha');
    expect(options[0].classList).toContain('is-focused');
    expect(options[0].getAttribute('aria-selected')).toBe('false');
    expect(
      options.every(
        (row) =>
          row
            .querySelector('input[type="checkbox"]')
            ?.getAttribute('tabindex') === '-1',
      ),
    ).toBe(true);
    expect(
      options.every(
        (row) =>
          row
            .querySelector('input[type="checkbox"]')
            ?.getAttribute('aria-hidden') === 'true',
      ),
    ).toBe(true);
    expect(options[0].getAttribute('aria-label')).toContain('Alpha list');
    expect(options[0].getAttribute('aria-label')).toContain('0/10');
    expect(options[0].querySelector('.sr-only')?.textContent).toContain(
      'Alpha list',
    );
    expect(options[0].querySelector('.sr-only')?.textContent).toContain('0/10');

    component.onListKey(
      new KeyboardEvent('keydown', { key: ' ', cancelable: true }),
    );
    fixture.detectChanges();
    options = [
      ...fixture.nativeElement.querySelectorAll('.pl-row'),
    ] as HTMLElement[];
    expect(component.selected.has(first.uri)).toBe(true);
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(options[0].classList).toContain('is-checked');

    component.onListKey(
      new KeyboardEvent('keydown', { key: 'End', cancelable: true }),
    );
    fixture.detectChanges();
    expect(component.focused?.id).toBe('gamma');
    expect(list.getAttribute('aria-activedescendant')).toBe('pl-gamma');
    options = [
      ...fixture.nativeElement.querySelectorAll('.pl-row'),
    ] as HTMLElement[];
    expect(options[2].classList).toContain('is-focused');
    expect(options[2].getAttribute('aria-selected')).toBe('false');

    component.onListKey(
      new KeyboardEvent('keydown', { key: 'Home', cancelable: true }),
    );
    fixture.detectChanges();
    expect(component.focused?.id).toBe('alpha');
    expect(component.selected.has(first.uri)).toBe(true);
  });

  it('shows MP3 filenames only for files that exist on disk', () => {
    const evidence = playlist('evidence', 'Evidence', {
      trackCount: 3,
      onDisk: 1,
      available: 2,
      percentOnDisk: 33,
      percentAvailable: 67,
    });

    render({
      playlists: [evidence],
      totals: { playlists: 1, tracks: 3, onDisk: 1, available: 2 },
    });

    const rows = [
      ...fixture.nativeElement.querySelectorAll('table.tracks tbody tr'),
    ] as HTMLElement[];
    expect(rows.length).toBe(3);

    const disk = rows.find((row) =>
      row.textContent?.includes('On disk song'),
    ) as HTMLElement;
    const pending = rows.find((row) =>
      row.textContent?.includes('Not yet'),
    ) as HTMLElement;
    const copyable = rows.find((row) =>
      row.textContent?.includes('Elsewhere'),
    ) as HTMLElement;

    expect(disk.querySelector('.track-file')?.textContent).toContain(
      'Saved - On disk song.mp3',
    );
    expect(disk.querySelector('.col-file')?.textContent).toContain(
      'Saved - On disk song.mp3',
    );
    expect(disk.querySelector('.col-file')?.textContent).not.toContain('Play');
    expect(disk.querySelector('.col-play .play-btn')).not.toBeNull();
    expect(disk.querySelector('.play-btn')).not.toBeNull();
    expect(disk.getAttribute('tabindex')).toBe('0');
    expect(pending.getAttribute('tabindex')).toBeNull();
    expect(pending.querySelector('.track-file')).toBeNull();
    expect(pending.textContent).not.toContain('Pending - Not yet.mp3');
    expect(pending.querySelector('.play-btn')).toBeNull();
    expect(copyable.querySelector('.track-file')).toBeNull();
    expect(copyable.textContent).not.toContain('Copy - Elsewhere.mp3');
    expect(copyable.querySelector('.pill.copy')?.textContent).toContain(
      'copyable',
    );
  });

  it('shows Play again when the browser blocks the first local playback', async () => {
    const evidence = playlist('evidence', 'Evidence', {
      trackCount: 3,
      onDisk: 1,
      available: 2,
      percentOnDisk: 33,
      percentAvailable: 67,
    });
    render({
      playlists: [evidence],
      totals: { playlists: 1, tracks: 3, onDisk: 1, available: 2 },
    });
    const audio = {
      paused: true,
      load: jasmine.createSpy('load'),
      play: jasmine
        .createSpy('play')
        .and.returnValue(Promise.reject(new Error('NotAllowedError'))),
      pause: jasmine.createSpy('pause'),
    };
    component['player'] = {
      nativeElement: audio,
    } as unknown as LibraryPanelComponent['player'];
    const track = component.detail?.tracks.find((row) => row.onDisk);
    expect(track).toBeTruthy();
    component.playTrack(track!);
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
    expect(component.paused).toBe(true);
    expect(component.playbackPaused()).toBe(true);
    expect(
      fixture.nativeElement.querySelector('.play-btn')?.textContent,
    ).toContain('Play');
  });

  it('shows Play when the audio element is paused after a play request', () => {
    const evidence = playlist('evidence', 'Evidence', {
      trackCount: 3,
      onDisk: 1,
      available: 2,
      percentOnDisk: 33,
      percentAvailable: 67,
    });
    render({
      playlists: [evidence],
      totals: { playlists: 1, tracks: 3, onDisk: 1, available: 2 },
    });
    const audio = {
      paused: true,
      load: jasmine.createSpy('load'),
      play: jasmine.createSpy('play').and.returnValue(Promise.resolve()),
      pause: jasmine.createSpy('pause'),
    };
    component['player'] = {
      nativeElement: audio,
    } as unknown as LibraryPanelComponent['player'];
    const track = component.detail?.tracks.find((row) => row.onDisk);
    expect(track).toBeTruthy();
    component.playTrack(track!);
    fixture.detectChanges();
    expect(component.playbackPaused()).toBe(true);
    expect(
      fixture.nativeElement.querySelector('.play-btn')?.textContent?.trim(),
    ).toBe('Play');
    expect(
      fixture.nativeElement
        .querySelector('.play-btn')
        ?.getAttribute('aria-label'),
    ).toContain('Play');
  });

  it('hides the player bar when playback ends or is closed', () => {
    const evidence = playlist('evidence', 'Evidence', {
      trackCount: 3,
      onDisk: 1,
      available: 2,
      percentOnDisk: 33,
      percentAvailable: 67,
    });
    render({
      playlists: [evidence],
      totals: { playlists: 1, tracks: 3, onDisk: 1, available: 2 },
    });
    const track = component.detail?.tracks.find((row) => row.onDisk);
    expect(track).toBeTruthy();
    component.playTrack(track!);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.player-bar')).not.toBeNull();
    expect(
      fixture.nativeElement
        .querySelector('.player-close')
        ?.getAttribute('aria-label'),
    ).toBe('Close player');

    (
      fixture.nativeElement.querySelector('.player-close') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.player-bar')).toBeNull();
    expect(component.audioUrl).toBe('');

    component.playTrack(track!);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.player-bar')).not.toBeNull();
    component.onAudioEnded();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.player-bar')).toBeNull();
    expect(component.playingN).toBeNull();
  });

  it('does not start a quiet library sync when the last Spotify attempt recently failed', () => {
    libraryService.syncLibraryStatus.and.returnValue(
      of({
        running: false,
        done: 0,
        total: 0,
        discovered: 0,
        changed: 0,
        errors: ['Spotify library request failed: 429'],
        current: '',
        startedAt: '2026-09-11T13:19:21.637Z',
        finishedAt: new Date().toISOString(),
      }),
    );

    render({
      playlists: [playlist('saved', 'Saved playlist')],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    expect(libraryService.syncLibrary).not.toHaveBeenCalled();
    expect(component.librarySyncDegraded).toBe(true);
    expect(component.syncNotice).toContain('429');
    expect(component.syncNotice).toContain('showing saved library');
    expect(component.syncNotice).toContain('use Sync library to retry');
  });

  it('still starts an explicit library sync after a recent quiet failure', () => {
    libraryService.syncLibraryStatus.and.returnValue(
      of({
        running: false,
        done: 0,
        total: 0,
        discovered: 0,
        changed: 0,
        errors: ['Spotify library request failed: 429'],
        current: '',
        startedAt: '2026-09-11T13:19:21.637Z',
        finishedAt: new Date().toISOString(),
      }),
    );
    libraryService.syncLibrary.and.returnValue(of({ started: true }));

    render({
      playlists: [playlist('saved', 'Saved playlist')],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });
    expect(libraryService.syncLibrary).not.toHaveBeenCalled();

    component.syncLibrary();
    expect(libraryService.syncLibrary).toHaveBeenCalled();
  });

  it('keeps skipping quiet library sync after a Spotify 429 until explicit retry', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    libraryService.syncLibraryStatus.and.returnValue(
      of({
        running: false,
        done: 0,
        total: 0,
        discovered: 0,
        changed: 0,
        errors: ['Spotify library request failed: 429'],
        current: '',
        startedAt: '2026-09-11T13:19:21.637Z',
        finishedAt: twoHoursAgo,
      }),
    );

    render({
      playlists: [playlist('saved', 'Saved playlist')],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    expect(libraryService.syncLibrary).not.toHaveBeenCalled();
    expect(component.librarySyncDegraded).toBe(true);
    expect(component.syncNotice).toContain('429');
    expect(component.syncNotice).toContain('use Sync library to retry');
  });

  it('retries a non-429 quiet sync failure after 15 minutes', () => {
    const twentyMinutesAgo = new Date(
      Date.now() - 20 * 60 * 1000,
    ).toISOString();
    libraryService.syncLibraryStatus.and.returnValue(
      of({
        running: false,
        done: 0,
        total: 0,
        discovered: 0,
        changed: 0,
        errors: ['Spotify unavailable'],
        current: '',
        startedAt: '2026-09-11T13:19:21.637Z',
        finishedAt: twentyMinutesAgo,
      }),
    );

    render({
      playlists: [playlist('saved', 'Saved playlist')],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    expect(libraryService.syncLibrary).toHaveBeenCalled();
  });

  it('labels in-progress banner downloads with Downloading, not a bare percent', () => {
    const ripping = playlist('mixed', 'Mixed coverage', {
      trackCount: 3,
      onDisk: 2,
      available: 2,
      percentOnDisk: 67,
      percentAvailable: 67,
    });
    playlistService.all$.next([
      {
        id: 9,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 91,
        artist: 'Saved',
        name: 'On disk one',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Downloading,
        playlistId: 9,
      },
    ]);
    trackService.progress$.next({ 91: 42 });

    render({
      playlists: [ripping],
      totals: { playlists: 1, tracks: 3, onDisk: 2, available: 2 },
    });

    const meta = fixture.nativeElement.querySelector(
      '.rip-meta',
    ) as HTMLElement | null;
    expect(meta?.textContent?.trim()).toBe('Downloading 42%');
    expect(meta?.getAttribute('title')).toBe('Downloading 42%');
    expect(meta?.textContent).not.toMatch(/^\s*(\d+%|downloading)\s*$/i);
  });

  it('names the focused playlist in Resync copy instead of calling every dump Recents', () => {
    const luk = playlist('luk-isaan', 'Luk Isaan', {
      rank: 199,
      trackCount: 307,
      onDisk: 145,
      available: 145,
      percentOnDisk: 47,
      percentAvailable: 47,
      failed: 7,
    });

    render({
      playlists: [luk],
      totals: { playlists: 1, tracks: 307, onDisk: 145, available: 145 },
    });

    const resync = [...fixture.nativeElement.querySelectorAll('button')].find(
      (button: HTMLButtonElement) =>
        (button.textContent || '').includes('Sync this playlist'),
    ) as HTMLButtonElement | undefined;
    expect(resync?.getAttribute('title')).toBe(
      'Update the track list for Luk Isaan from Spotify. Tracks removed on Spotify are removed from this playlist folder.',
    );
    expect(resync?.getAttribute('title')).not.toContain('Recents dump');
    expect(
      fixture.nativeElement.querySelector('.detail-title')?.textContent,
    ).toContain('Luk Isaan');
    expect(
      fixture.nativeElement.querySelector('.detail-sub')?.textContent,
    ).not.toContain('Recents #');
  });

  it('names operational failures as needs retry on ripping remainder lines, not pending', () => {
    const ripping = playlist('processing', 'Luk Isaan', {
      rank: 199,
      trackCount: 10,
      onDisk: 0,
      available: 0,
      failed: 0,
      percentOnDisk: 0,
      percentAvailable: 0,
    });
    playlistService.all$.next([
      {
        id: 101,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next(
      Array.from({ length: 9 }, (_, index) => ({
        id: 2000 + index,
        artist: 'Queued Artist',
        name: `Queued ${index}`,
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 101,
      })),
    );

    render({
      playlists: [ripping],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    const stats = component.statsOf(ripping);
    expect(stats.needsRetry).toBe(1);
    expect(stats.pending).toBe(0);
    expect(stats.queued).toBe(9);
    expect(
      stats.onDisk +
        stats.failed +
        stats.needsRetry +
        stats.pending +
        stats.queued,
    ).toBe(10);
    const subText = (
      fixture.nativeElement
        .querySelector('.pl-row .pl-sub')
        ?.getAttribute('title') || ''
    ).replace(/\s+/g, ' ');
    expect(subText).toContain('1 needs retry');
    expect(subText).toContain('9 waiting');
    expect(subText).not.toContain('pending');
    expect(
      fixture.nativeElement.querySelector('.coverage-label')?.textContent,
    ).toContain('1 need review');
    expect(
      fixture.nativeElement.querySelector('.pill.retry')?.textContent,
    ).toContain('Needs retry');
  });

  it('includes dump leftover pending in the sidebar live activity line', () => {
    const ripping = playlist('queued', 'Queued lots', {
      trackCount: 50,
      onDisk: 0,
      available: 0,
      percentOnDisk: 0,
      percentAvailable: 0,
    });
    playlistService.all$.next([
      {
        id: 2,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next(
      Array.from({ length: 10 }, (_, index) => ({
        id: 12 + index,
        artist: 'Artist',
        name: `Queued ${index}`,
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      })),
    );

    render({
      playlists: [ripping],
      totals: { playlists: 1, tracks: 50, onDisk: 0, available: 0 },
    });

    expect(component.dumpPendingTotal).toBe(40);
    expect(component.globalActivitySummary()).toBe('40 pending · 10 waiting');
    expect(
      fixture.nativeElement.querySelector('.technical-summary')?.textContent,
    ).toContain('10 waiting');
    expect(
      fixture.nativeElement.querySelector('.technical-summary')?.textContent,
    ).toContain('40 pending');
    expect(
      fixture.nativeElement
        .querySelector('.technical-summary')
        ?.getAttribute('title'),
    ).toContain('40 pending · 10 waiting');
  });

  it('labels leftover dump tracks as Waiting while a search/download pipeline is live', () => {
    const ripping = playlist('evidence', 'Evidence', {
      trackCount: 3,
      onDisk: 1,
      available: 1,
      percentOnDisk: 33,
      percentAvailable: 33,
    });
    playlistService.all$.next([
      {
        id: 2,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [ripping],
      totals: { playlists: 1, tracks: 3, onDisk: 1, available: 1 },
    });

    const leftover = component.detail!.tracks.find(
      (track) => track.name === 'Not yet',
    );
    expect(leftover).toBeTruthy();
    expect(component.statusKind(leftover!)).toBe('miss');
    expect(component.trackStatusLabel(leftover!)).toBe('Pending');
    const pendingPill = [
      ...fixture.nativeElement.querySelectorAll('.tracks .pill'),
    ].find((el: HTMLElement) => (el.textContent || '').includes('Pending'));
    expect(pendingPill).toBeDefined();
    const subText = (
      fixture.nativeElement
        .querySelector('.pl-row .pl-sub')
        ?.getAttribute('title') || ''
    ).replace(/\s+/g, ' ');
    expect(subText).toContain('1 waiting');
    expect(subText).toContain('1 pending');
  });

  it('records dump operational failures into the live store after a playlist is opened', () => {
    const processing = playlist('processing', 'Processing');
    playlistService.all$.next([
      {
        id: 101,
        name: processing.name,
        spotifyUrl: processing.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);

    render({
      playlists: [processing],
      totals: { playlists: 1, tracks: 10, onDisk: 0, available: 0 },
    });

    expect(trackService.rememberError).toHaveBeenCalledWith(
      jasmine.objectContaining({
        playlistId: 101,
        artist: 'Artist',
        name: 'Retrying track',
        error: 'Temporary YouTube failure: socket timed out',
      }),
    );
  });

  it('dismisses a paused leftover player when switching playlists', () => {
    const first = playlist('evidence', 'Evidence', {
      trackCount: 3,
      onDisk: 1,
      available: 1,
      percentOnDisk: 33,
      percentAvailable: 33,
    });
    const second = playlist('queued', 'Queued lots');

    render({
      playlists: [first, second],
      totals: { playlists: 2, tracks: 13, onDisk: 1, available: 1 },
    });
    component.audioUrl = '/api/library/audio/evidence/1';
    component.paused = true;
    component.playingLabel = 'Evidence track';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.player-bar')).not.toBeNull();

    component.focus(second, false);
    fixture.detectChanges();
    expect(component.audioUrl).toBe('');
    expect(fixture.nativeElement.querySelector('.player-bar')).toBeNull();
  });

  it('hydrates SQLite Error rows for live playlists so needs-retry is visible without opening the dump', () => {
    const ripping = playlist('queued', 'This D.J. Radio', {
      trackCount: 50,
      onDisk: 28,
      available: 28,
      percentOnDisk: 56,
      percentAvailable: 56,
    });
    playlistService.all$.next([
      {
        id: 45,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 45,
      },
      {
        id: 2,
        artist: 'Failed',
        name: 'Needs retry song',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Error,
        error: 'yt-dlp exited 1',
        playlistId: 45,
      },
    ]);

    render({
      playlists: [ripping],
      totals: { playlists: 1, tracks: 50, onDisk: 28, available: 28 },
    });

    expect(trackService.hydrateErrors).toHaveBeenCalledWith(45);
    const stats = component.statsOf(ripping);
    expect(stats.needsRetry).toBe(1);
    const subText = (
      fixture.nativeElement
        .querySelector('.pl-row .pl-sub')
        ?.getAttribute('title') || ''
    ).replace(/\s+/g, ' ');
    expect(subText).toContain('needs retry');
  });

  it('counts duplicate live Error rows for the same song as one needs-retry', () => {
    const ripping = playlist('queued', 'Luk Isaan', {
      trackCount: 10,
      onDisk: 6,
      available: 6,
      failed: 1,
      percentOnDisk: 60,
      percentAvailable: 60,
    });
    playlistService.all$.next([
      {
        id: 2,
        name: ripping.name,
        spotifyUrl: ripping.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: -11,
        artist: 'Artist',
        name: 'Failed track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Error,
        error: 'Temporary YouTube failure: socket timed out',
        playlistId: 2,
      },
      {
        id: 13,
        artist: 'Artist',
        name: 'Failed track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Error,
        error: 'Temporary YouTube failure: socket timed out',
        playlistId: 2,
      },
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [ripping],
      totals: { playlists: 1, tracks: 10, onDisk: 6, available: 6 },
    });

    const stats = component.statsOf(ripping);
    expect(stats.needsRetry).toBe(1);
    expect(
      stats.onDisk +
        stats.failed +
        stats.needsRetry +
        stats.queued +
        stats.pending,
    ).toBe(10);
    const subText = (
      fixture.nativeElement
        .querySelector('.pl-row .pl-sub')
        ?.getAttribute('title') || ''
    ).replace(/\s+/g, ' ');
    expect(subText).toContain('1 needs retry');
    expect(subText).not.toContain('2 needs retry');
  });

  it('hydrates Error rows for stalled mostly-done playlists and names them needs retry, not leftover needed', () => {
    const dj = playlist('dj-radio', 'This D.J. Radio', {
      trackCount: 50,
      onDisk: 28,
      available: 28,
      percentOnDisk: 56,
      percentAvailable: 56,
    });
    playlistService.all$.next([
      {
        id: 45,
        name: dj.name,
        spotifyUrl: dj.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next(
      Array.from({ length: 15 }, (_, index) => ({
        id: 200 + index,
        artist: 'Failed',
        name: `Needs retry ${index}`,
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Error,
        error: 'yt-dlp exited 1',
        playlistId: 45,
      })),
    );

    render({
      playlists: [dj],
      totals: { playlists: 1, tracks: 50, onDisk: 28, available: 28 },
    });

    expect(trackService.hydrateErrors).toHaveBeenCalledWith(45);
    const stats = component.statsOf(dj);
    expect(stats.ripping).toBe(false);
    expect(stats.needsRetry).toBe(15);
    expect(component.remainingLabel(dj)).toBe('7 needed');
    const subText = (
      fixture.nativeElement
        .querySelector('.pl-row .pl-sub')
        ?.getAttribute('title') || ''
    ).replace(/\s+/g, ' ');
    expect(subText).toContain('15 needs retry');
    expect(
      fixture.nativeElement.querySelector('.state-pill.is-needs')?.textContent,
    ).toContain('7 needed');
  });

  it('does not show 0 needed when the leftover is only needs-retry', () => {
    const radio = playlist('relax-radio', 'Relax Radio', {
      trackCount: 50,
      onDisk: 49,
      available: 49,
      percentOnDisk: 98,
      percentAvailable: 98,
    });
    playlistService.all$.next([
      {
        id: 77,
        name: radio.name,
        spotifyUrl: radio.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 901,
        artist: 'Failed',
        name: 'Needs retry song',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Error,
        error: 'yt-dlp exited 1',
        playlistId: 77,
      },
    ]);

    render({
      playlists: [radio],
      totals: { playlists: 1, tracks: 50, onDisk: 49, available: 49 },
    });

    const stats = component.statsOf(radio);
    expect(stats.ripping).toBe(false);
    expect(stats.needsRetry).toBe(1);
    expect(stats.pending).toBe(0);
    expect(component.remainingLabel(radio)).toBe('Needs retry');
    const pill = fixture.nativeElement.querySelector(
      '.state-pill.is-needs',
    ) as HTMLElement | null;
    expect(pill?.textContent).toContain('Needs retry');
    expect(pill?.textContent).not.toContain('0 needed');
    const subText = (
      fixture.nativeElement
        .querySelector('.pl-row .pl-sub')
        ?.getAttribute('title') || ''
    ).replace(/\s+/g, ' ');
    expect(subText).toContain('1 needs retry');
    expect(
      fixture.nativeElement.querySelector('.coverage-label')?.textContent,
    ).toContain('1 need review');
    const action = fixture.nativeElement.querySelector(
      '.detail-actions .btn-primary',
    ) as HTMLElement | null;
    expect(action?.textContent).toContain('Retry 1 failed');
    expect(action?.textContent).not.toContain('Download this playlist');
  });

  it('names copyable leftover instead of 0 needed when nothing remains for YouTube', () => {
    const partial = playlist('copy-only', 'Copy only radio', {
      trackCount: 10,
      onDisk: 7,
      available: 10,
      percentOnDisk: 70,
      percentAvailable: 100,
    });

    render({
      playlists: [partial],
      totals: { playlists: 1, tracks: 10, onDisk: 7, available: 10 },
    });

    const stats = component.statsOf(partial);
    expect(stats.copyable).toBe(3);
    expect(stats.pending).toBe(0);
    expect(component.remainingLabel(partial)).toBe('3 copyable');
    const pill = fixture.nativeElement.querySelector(
      '.state-pill.is-needs',
    ) as HTMLElement | null;
    expect(pill?.textContent).toContain('3 copyable');
    expect(pill?.textContent).not.toContain('0 needed');
    const action = fixture.nativeElement.querySelector(
      '.detail-actions .btn-primary',
    ) as HTMLElement | null;
    expect(action?.textContent).toContain('Add 3 existing MP3s to this folder');
    expect(action?.textContent).not.toContain('Download this playlist');
  });

  it('keeps Download this playlist when YouTube work remains', () => {
    const partial = playlist('massage', 'Massage', {
      trackCount: 293,
      onDisk: 1,
      available: 1,
      failed: 2,
      percentOnDisk: 0,
      percentAvailable: 0,
    });

    render({
      playlists: [partial],
      totals: { playlists: 1, tracks: 293, onDisk: 1, available: 1 },
    });

    expect(component.focusedActionLabel(partial)).toBe(
      'Queue 290 for search & download',
    );
    expect(
      fixture.nativeElement.querySelector('.detail-actions .btn-primary')
        ?.textContent,
    ).toContain('Queue 290 for search & download');
  });

  it('labels dump leftover as waiting while the library queue is live, even without local live rows', () => {
    const leftover = playlist('evidence', 'Ambient leftover', {
      trackCount: 3,
      onDisk: 1,
      available: 1,
      percentOnDisk: 33,
      percentAvailable: 33,
    });
    const queued = playlist('queued', 'Queued lots');
    playlistService.all$.next([
      {
        id: 2,
        name: queued.name,
        spotifyUrl: queued.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [leftover, queued],
      totals: { playlists: 2, tracks: 13, onDisk: 1, available: 1 },
    });

    const leftoverStats = component.statsOf(leftover);
    expect(leftoverStats.ripping).toBe(false);
    expect(leftoverStats.queued).toBe(0);
    expect(leftoverStats.pending).toBe(2);
    expect(component.remainingLabel(leftover)).toBe('2 needed');
    expect(component.visiblePlaylists.map((item) => item.name)).toEqual([
      'Queued lots',
      'Ambient leftover',
    ]);

    const leftoverRow = [
      ...fixture.nativeElement.querySelectorAll('.pl-row'),
    ].find((row: HTMLElement) =>
      (row.querySelector('.pl-name')?.textContent || '').includes(
        'Ambient leftover',
      ),
    ) as HTMLElement;
    expect(leftoverRow.classList).not.toContain('is-ripping');
    expect(
      leftoverRow.querySelector('.state-pill.is-needs')?.textContent,
    ).toContain('2 needed');
    expect(leftoverRow.querySelector('.state-pill.is-wait')).toBeNull();

    component.focus(leftover, false);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('.detail-actions .btn-primary'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('.detail-actions .btn-primary')
        .disabled,
    ).toBeFalse();
    const leftoverTrack = component.detail!.tracks.find(
      (track) => track.name === 'Not yet',
    );
    expect(leftoverTrack).toBeTruthy();
    expect(component.statusKind(leftoverTrack!)).toBe('miss');
    expect(component.trackStatusLabel(leftoverTrack!)).toBe('Pending');
  });

  it('still hydrates stalled errors on leftover playlists while the library queue is live', () => {
    const dj = playlist('dj-radio', 'This D.J. Radio', {
      trackCount: 50,
      onDisk: 28,
      available: 28,
      percentOnDisk: 56,
      percentAvailable: 56,
    });
    const queued = playlist('queued', 'Queued lots');
    playlistService.all$.next([
      {
        id: 45,
        name: dj.name,
        spotifyUrl: dj.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
      {
        id: 2,
        name: queued.name,
        spotifyUrl: queued.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [dj, queued],
      totals: { playlists: 2, tracks: 60, onDisk: 28, available: 28 },
    });

    expect(trackService.hydrateErrors).toHaveBeenCalledWith(45);
    expect(component.statsOf(dj).ripping).toBe(false);
    expect(component.statsOf(dj).queued).toBe(0);
    expect(component.remainingLabel(dj)).toBe('22 needed');
  });

  it('names implied-waiting leftover playlists on the live-queue toggle instead of undercounting', () => {
    const leftover = playlist('ambient', 'Ambient leftover', {
      trackCount: 20,
      onDisk: 5,
      available: 5,
      percentOnDisk: 25,
      percentAvailable: 25,
    });
    const queued = playlist('queued', 'Queued lots');
    playlistService.all$.next([
      {
        id: 2,
        name: queued.name,
        spotifyUrl: queued.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [leftover, queued],
      totals: { playlists: 2, tracks: 30, onDisk: 5, available: 5 },
    });
    component.queueOpen = true;
    fixture.detectChanges();

    const toggle = (
      fixture.nativeElement.querySelector('.queued-playlists summary')
        ?.textContent || ''
    ).replace(/\s+/g, ' ');
    expect(toggle).toContain('1 playlists with queued work');
    expect(toggle).not.toContain('1 playlist in queue');
    expect(component.impliedWaitingPlaylistCount).toBe(0);
    expect(fixture.nativeElement.querySelectorAll('.queue-pl').length).toBe(1);
    expect(
      fixture.nativeElement.querySelector('.queue-body .legend')?.textContent,
    ).not.toContain('Other waiting leftovers stay in the playlist list');
  });

  it('does not let extra live Error rows push a focused playlist remainder past its track count', () => {
    const dj = playlist('dj-overflow', 'This D.J. Radio', {
      trackCount: 10,
      onDisk: 6,
      available: 6,
      percentOnDisk: 60,
      percentAvailable: 60,
    });
    libraryService.detail.and.callFake(() =>
      of({
        playlist: dj,
        tracks: [
          ...Array.from({ length: 6 }, (_, index) => ({
            n: index + 1,
            artist: 'Saved',
            name: `Disk ${index}`,
            onDisk: true,
            available: true,
            filename: `Saved - Disk ${index}.mp3`,
          })),
          ...Array.from({ length: 2 }, (_, index) => ({
            n: 7 + index,
            artist: 'Failed',
            name: `Retry ${index}`,
            onDisk: false,
            available: false,
            error: 'yt-dlp exited 1',
            missing: false,
          })),
          ...Array.from({ length: 2 }, (_, index) => ({
            n: 9 + index,
            artist: 'Left',
            name: `Left ${index}`,
            onDisk: false,
            available: false,
          })),
        ],
      }),
    );
    playlistService.all$.next([
      {
        id: 45,
        name: dj.name,
        spotifyUrl: dj.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Left',
        name: 'Left 0',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 45,
      },
      ...Array.from({ length: 2 }, (_, index) => ({
        id: 20 + index,
        artist: 'Saved',
        name: `Disk ${index}`,
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Error,
        error: 'yt-dlp exited 1',
        playlistId: 45,
      })),
      ...Array.from({ length: 2 }, (_, index) => ({
        id: 30 + index,
        artist: 'Failed',
        name: `Retry ${index}`,
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Error,
        error: 'yt-dlp exited 1',
        playlistId: 45,
      })),
    ]);

    render({
      playlists: [dj],
      totals: { playlists: 1, tracks: 10, onDisk: 6, available: 6 },
    });

    const stats = component.statsOf(dj);
    expect(stats.needsRetry).toBe(2);
    expect(stats.queued + stats.pending).toBe(2);
    expect(
      stats.onDisk +
        stats.failed +
        stats.needsRetry +
        stats.queued +
        stats.pending,
    ).toBe(10);
    const subText = (
      fixture.nativeElement
        .querySelector('.pl-row .pl-sub')
        ?.getAttribute('title') || ''
    ).replace(/\s+/g, ' ');
    expect(subText).toContain('2 needs retry');
    expect(subText).toContain('1 pending · 1 waiting');
    expect(subText).not.toContain('4 needs retry');
    expect(
      fixture.nativeElement.querySelectorAll('.tracks .pill.retry').length,
    ).toBe(2);
    expect(
      fixture.nativeElement.querySelectorAll('.tracks .pill.waiting').length,
    ).toBe(1);
  });

  it('names implied-waiting leftover playlists on the live-queue toggle instead of undercounting', () => {
    const leftover = playlist('ambient', 'Ambient leftover', {
      trackCount: 20,
      onDisk: 5,
      available: 5,
      percentOnDisk: 25,
      percentAvailable: 25,
    });
    const queued = playlist('queued', 'Queued lots');
    playlistService.all$.next([
      {
        id: 2,
        name: queued.name,
        spotifyUrl: queued.spotifyUrl,
        active: false,
        isTrack: false,
        createdAt: 1,
        collapsed: false,
      },
    ]);
    trackService.all$.next([
      {
        id: 12,
        artist: 'Artist',
        name: 'Queued track',
        spotifyUrl: '',
        youtubeUrl: '',
        status: TrackStatusEnum.Queued,
        playlistId: 2,
      },
    ]);

    render({
      playlists: [leftover, queued],
      totals: { playlists: 2, tracks: 30, onDisk: 5, available: 5 },
    });
    component.queueOpen = true;
    fixture.detectChanges();

    const toggle = (
      fixture.nativeElement.querySelector('.queued-playlists summary')
        ?.textContent || ''
    ).replace(/\s+/g, ' ');
    expect(toggle).toContain('1 playlists with queued work');
    expect(toggle).not.toContain('1 playlist in queue');
    expect(component.impliedWaitingPlaylistCount).toBe(0);
    expect(fixture.nativeElement.querySelectorAll('.queue-pl').length).toBe(1);
    expect(
      fixture.nativeElement.querySelector('.queue-body .legend')?.textContent,
    ).not.toContain('Other waiting leftovers stay in the playlist list');
  });
});
