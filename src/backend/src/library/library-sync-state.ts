import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';

export type SpotifySyncScope = 'library' | 'playlist' | 'saved-playlists';
export type SpotifySyncFailure = 'connection' | 'rate-limit' | 'incomplete' | 'interrupted' | 'other';
export interface PlaylistSyncResult {
  id: string;
  name: string;
  before: number;
  after: number;
  removedFiles?: number;
}
/** Last complete library discovery, independent of individual track refreshes. */
export interface SpotifyLibraryObservation { checkedAt: string; playlistIds: string[] }

export function validLibraryObservation(value: unknown): value is SpotifyLibraryObservation {
  if (!value || typeof value !== 'object') return false;
  const row = value as SpotifyLibraryObservation;
  return typeof row.checkedAt === 'string' && Number.isFinite(Date.parse(row.checkedAt)) &&
    Array.isArray(row.playlistIds) && row.playlistIds.every(id => typeof id === 'string' && /^[A-Za-z0-9]{22}$/.test(id)) &&
    new Set(row.playlistIds).size === row.playlistIds.length;
}

export function spotifySyncFailure(error: string): SpotifySyncFailure {
  if (/CDP|Chrome (?:bridge|connection)|browser connection|session.*unavailable/i.test(error)) return 'connection';
  if (/\b429\b|too many requests|rate.?limit/i.test(error)) return 'rate-limit';
  if (/incomplete|membership|Refusing to shrink/i.test(error)) return 'incomplete';
  if (/interrupt|restart/i.test(error)) return 'interrupted';
  return 'other';
}

export interface LibrarySyncState {
  running: boolean;
  done: number;
  total: number;
  discovered: number;
  changed: number;
  errors: string[];
  current: string;
  startedAt: string | null;
  finishedAt: string | null;
  operationId?: string | null;
  scope?: SpotifySyncScope;
  playlistId?: string | null;
  playlistName?: string | null;
  result?: PlaylistSyncResult | null;
  failureKind?: SpotifySyncFailure | null;
  libraryObservation?: SpotifyLibraryObservation;
}

export function emptyLibrarySync(): LibrarySyncState {
  return { running: false, done: 0, total: 0, discovered: 0, changed: 0,
    errors: [], current: '', startedAt: null, finishedAt: null,
    operationId: null, scope: 'library', playlistId: null, playlistName: null, result: null, failureKind: null };
}

export function readLibrarySync(file: string | null): LibrarySyncState {
  const empty = emptyLibrarySync();
  if (!file || !existsSync(file)) return empty;
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof saved.running !== 'boolean' || !Array.isArray(saved.errors) ||
      !saved.errors.every((error: unknown) => typeof error === 'string') ||
      !['done', 'total', 'discovered', 'changed'].every(key =>
        Number.isSafeInteger(saved[key]) && saved[key] >= 0) ||
      typeof saved.current !== 'string' ||
      !['startedAt', 'finishedAt'].every(key => saved[key] === null ||
        (typeof saved[key] === 'string' && Number.isFinite(Date.parse(saved[key]))))) {
    throw new Error('Invalid saved Spotify sync status');
  }
  const state: LibrarySyncState = { ...empty };
  // Older library-only state remains readable; optional metadata is validated.
  if ((saved.scope !== undefined && !['library', 'playlist', 'saved-playlists'].includes(saved.scope)) ||
      ['operationId', 'playlistId', 'playlistName'].some(key => saved[key] != null && typeof saved[key] !== 'string') ||
      (saved.failureKind != null && !['connection', 'rate-limit', 'incomplete', 'interrupted', 'other'].includes(saved.failureKind)) ||
      (saved.result != null && (typeof saved.result.id !== 'string' || typeof saved.result.name !== 'string' ||
        !['before', 'after'].every(key => Number.isSafeInteger(saved.result[key]) && saved.result[key] >= 0) ||
        (saved.result.removedFiles != null && (!Number.isSafeInteger(saved.result.removedFiles) || saved.result.removedFiles < 0))))) {
    throw new Error('Invalid saved Spotify operation metadata');
  }
  for (const key of Object.keys(empty)) if (key in saved) state[key] = saved[key];
  if (saved.libraryObservation != null) {
    if (!validLibraryObservation(saved.libraryObservation)) throw new Error('Invalid saved Spotify library observation');
    state.libraryObservation = { checkedAt: saved.libraryObservation.checkedAt, playlistIds: [...saved.libraryObservation.playlistIds] };
  }
  state.errors = state.errors.slice(-20);
  if (state.running) {
    state.running = false;
    state.current = '';
    state.finishedAt = new Date().toISOString();
    state.errors.push('Spotify sync interrupted by server restart. Sync again to continue.');
    state.failureKind = 'interrupted';
    state.result = null;
  }
  return state;
}

export function writeLibrarySync(file: string | null, state: LibrarySyncState): void {
  if (!file) return;
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ ...state, errors: state.errors.slice(-20) }), { mode: 0o600 });
  renameSync(temporary, file);
}
