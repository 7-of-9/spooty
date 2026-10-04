import { randomUUID } from 'crypto';
import type { LibraryPlaylist, LibraryListResponse } from './library.service';
import { songKey } from '../shared/acquisition/identity';

export interface CoverageProgress {
  id: string;
  state: 'checking' | 'complete' | 'failed';
  checked: number;
  total: number;
  errors: number;
  destination: string;
  current: string;
  scope?: 'library' | 'changes';
  updates?: 'live' | 'manual';
}

export interface LibraryViewTrack {
  n?: number;
  name: string;
  artist: string;
  sourceKey: string;
  spotifyUrl: string | null;
  durationMs: number | null;
  mediaVerification: string;
  onDisk: boolean;
  available: boolean;
  filename: string;
  error?: string;
  missing?: boolean;
  [key: string]: unknown;
}

export interface CoveragePlaylist {
  playlist: LibraryPlaylist;
  tracks: LibraryViewTrack[];
  resolve: Array<() => Promise<LibraryViewTrack>>;
}

/** One bounded local scan, independent of an HTTP request or browser lifetime.
 * Observation never starts another scan. Four records at a time keep focused
 * playlist prioritisation useful without flooding the shared ffprobe queue. */
export class LibraryCoverageScan {
  readonly id = randomUUID();
  readonly finished: Promise<void>;
  readonly entries: Map<string, CoveragePlaylist>;
  private queue: Array<{ entry: CoveragePlaylist; position: number }>;
  private active = new Map<number, string>();
  private checked = 0;
  private errors = 0;
  private cancelled = false;
  private complete = false;
  private total: number;
  private scope: 'library' | 'changes';
  updates: 'live' | 'manual' = 'manual';

  constructor(records: CoveragePlaylist[], readonly destination: string, changed?: Set<string>) {
    this.scope = changed ? 'changes' : 'library';
    this.entries = new Map(records.map(record => [record.playlist.id, record]));
    this.queue = [];
    for (const entry of records) {
      entry.tracks = entry.tracks.map((track, position) => {
        if (changed && track.mediaVerification !== 'checking' && !this.affected(track, changed)) return track;
        this.queue.push({ entry, position });
        return { ...track, mediaVerification: 'checking', onDisk: false, available: false, missing: undefined };
      });
      this.recount(entry);
    }
    this.total = this.queue.length;
    // Start after the caller can prioritise the focused playlist.
    this.finished = Promise.resolve().then(async () => {
      await Promise.all(Array.from({ length: 4 }, (_, worker) => this.work(worker)));
      this.complete = true;
    });
  }

  private affected(track: LibraryViewTrack, keys: Set<string>): boolean {
    return keys.has(track.sourceKey) || keys.has(songKey(track.artist, track.name));
  }

  private recount(entry: CoveragePlaylist): void {
    const p = entry.playlist;
    p.coveragePending = entry.tracks.filter(t => t.mediaVerification === 'checking').length;
    p.onDisk = entry.tracks.filter(t => t.onDisk && t.mediaVerification !== 'checking').length;
    p.available = entry.tracks.filter(t => t.available && t.mediaVerification !== 'checking').length;
    p.failed = entry.tracks.filter(t => !t.onDisk && t.missing && t.mediaVerification !== 'checking').length;
    p.percentOnDisk = p.trackCount ? Math.round(p.onDisk / p.trackCount * 100) : 0;
    p.percentAvailable = p.trackCount ? Math.round(p.available / p.trackCount * 100) : 0;
    p.done = !p.coveragePending && p.trackCount > 0 && p.onDisk + p.failed >= p.trackCount;
  }

  changes(keys: Set<string>): LibraryCoverageScan | null {
    if (![...this.entries.values()].some(e => e.tracks.some(t => this.affected(t, keys)))) return null;
    const records = [...this.entries.values()].map(entry => ({ ...entry, playlist: { ...entry.playlist }, tracks: entry.tracks.map(t => ({ ...t })) }));
    const next = new LibraryCoverageScan(records, this.destination, keys);
    next.updates = this.updates;
    this.cancel();
    return next;
  }

  updateWorkflow(project: (row: LibraryViewTrack) => LibraryViewTrack): void {
    for (const entry of this.entries.values()) {
      entry.tracks = entry.tracks.map(project);
      this.recount(entry);
    }
  }

  private async work(worker: number): Promise<void> {
    let batch = 0;
    while (!this.cancelled && this.queue.length) {
      const item = this.queue.shift()!;
      const { entry, position } = item;
      const before = entry.tracks[position];
      this.active.set(worker, `${before.artist} — ${before.name}`);
      try {
        const row = await entry.resolve[position]();
        if (this.cancelled) return;
        entry.tracks[position] = row;
        const p = entry.playlist;
        p.coveragePending!--;
        p.onDisk += Number(row.onDisk);
        p.available += Number(row.available);
        p.failed += Number(!row.onDisk && !!row.missing);
        p.percentOnDisk = p.trackCount ? Math.round(p.onDisk / p.trackCount * 100) : 0;
        p.percentAvailable = p.trackCount ? Math.round(p.available / p.trackCount * 100) : 0;
        p.done = !p.coveragePending && p.trackCount > 0 && p.onDisk + p.failed >= p.trackCount;
      } catch {
        if (this.cancelled) return;
        // A failed observation is not a missing MP3 or permission to download.
        this.errors++;
      } finally {
        this.active.delete(worker);
      }
      this.checked++;
      if (++batch % 64 === 0) await new Promise<void>(yes => setImmediate(yes));
    }
  }

  prioritize(id: string): void {
    this.queue = [...this.queue.filter(item => item.entry.playlist.id === id),
      ...this.queue.filter(item => item.entry.playlist.id !== id)];
  }

  cancel(): void { this.cancelled = true; }
  get invalidated(): boolean { return this.cancelled; }
  get running(): boolean { return !this.complete && !this.cancelled; }

  progress(): CoverageProgress {
    return { id: this.id, state: this.running ? 'checking' : this.errors || this.cancelled ? 'failed' : 'complete',
      checked: this.checked, total: this.total, errors: this.errors,
      scope: this.scope, updates: this.updates,
      destination: this.destination, current: this.active.values().next().value || '' };
  }

  snapshot(): LibraryListResponse {
    const playlists = [...this.entries.values()].map(entry => ({ ...entry.playlist }));
    const totals = playlists.reduce((acc, p) => ({ playlists: acc.playlists + 1,
      tracks: acc.tracks + p.trackCount, onDisk: acc.onDisk + p.onDisk,
      available: acc.available + p.available }), { playlists: 0, tracks: 0, onDisk: 0, available: 0 });
    return { playlists, totals, coverage: this.progress() };
  }

  detail(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return null;
    this.prioritize(id);
    return { playlist: { ...entry.playlist }, tracks: entry.tracks.map(track => ({ ...track })), coverage: this.progress() };
  }
}
