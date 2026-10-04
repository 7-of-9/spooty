import { existsSync, lstatSync, watch, FSWatcher } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export interface LibraryChanges {
  media: string[];
  sources: string[];
  workflow: boolean;
  membership: boolean;
  failed: boolean;
}
export interface LibraryWatchPaths {
  media: string[];
  playlists: string;
  metadata: string;
  databases: string[];
  settings: string;
}

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
};

/** Passive local change notifications only. No browser, Spotify, database
 * writes or download actions. Coalesce noisy OS events, not entire media scans. */
export class LibraryChangeWatch {
  private watchers: FSWatcher[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private media = new Set<string>();
  private sources = new Set<string>();
  private workflow = false;
  private membership = false;
  private closed = false;
  live = true;

  constructor(private paths: LibraryWatchPaths, private notify: (changes: LibraryChanges) => void) {
    this.paths = paths = { media: paths.media.map(path => resolve(path)), playlists: resolve(paths.playlists),
      metadata: resolve(paths.metadata), databases: paths.databases.map(path => resolve(path)), settings: resolve(paths.settings) };
    const requested = [...paths.media, paths.playlists, paths.metadata, ...paths.databases.map(dirname), dirname(paths.settings)].map(path => resolve(path));
    const roots: string[] = [];
    for (let path of requested) {
      // Missing optional metadata/acquisition directories are covered by their
      // existing parent, so their later creation is observed too.
      while (!existsSync(path) && dirname(path) !== path) path = dirname(path);
      if (dirname(path) === path) { this.unavailable(); continue; }
      if (!roots.some(root => inside(root, path))) {
        for (let i = roots.length - 1; i >= 0; i--) if (inside(path, roots[i])) roots.splice(i, 1);
        roots.push(path);
      }
    }
    for (const root of roots) {
      try {
        const identity = lstatSync(root);
        const watcher = watch(root, { recursive: true, persistent: false }, (_event, filename) => {
          // fs.watch follows the original inode. Renaming/replacing the watched
          // root can otherwise leave a silently stale watcher reporting "live".
          let sameRoot = false;
          try { const now = lstatSync(root); sameRoot = now.dev === identity.dev && now.ino === identity.ino; } catch { /* Root was removed. */ }
          if (!sameRoot) { this.unavailable(); this.changed(root, null); return; }
          this.changed(root, filename === null ? null : String(filename));
        });
        watcher.on('error', () => this.unavailable());
        this.watchers.push(watcher);
      } catch { this.unavailable(); }
    }
  }

  private unavailable(): void {
    if (this.closed) return;
    this.live = false;
    this.schedule();
  }

  private changed(root: string, filename: string | null): void {
    if (this.closed) return;
    const path = filename === null ? root : resolve(root, filename);
    if (!inside(root, path)) return;
    for (const media of this.paths.media) {
      if (!inside(media, path) && !inside(path, media)) continue;
      const rel = relative(media, path);
      if (rel.split(sep).some(part => part.startsWith('.spooty-download-batch-') || part.startsWith('.acquire-'))) continue;
      // Directory names may contain dots; missing directories cannot be statted
      // to distinguish them from sidecars. The index ignores non-media files.
      this.media.add(inside(media, path) ? path : media);
    }
    if (inside(path, this.paths.playlists) ||
      (inside(this.paths.playlists, path) && (filename === null || /\.json$/.test(path)))) this.membership = true;
    if (inside(this.paths.metadata, path)) {
      const id = path.match(/(?:^|\/)([A-Za-z0-9]{22})\.json$/)?.[1];
      if (id) this.sources.add(`spotify:${id}`);
      else if (filename === null || path === this.paths.metadata) this.membership = true;
    }
    if (inside(path, this.paths.metadata)) this.membership = true;
    if (this.paths.databases.some(file => path === file || path === `${file}-wal`)) this.workflow = true;
    if (inside(path, this.paths.settings)) this.membership = true;
    if (filename === null) {
      if (inside(root, this.paths.playlists)) this.membership = true;
      if (this.paths.databases.some(file => inside(root, file))) this.workflow = true;
    }
    if (this.media.size || this.sources.size || this.workflow || this.membership) this.schedule();
  }

  private schedule(): void {
    if (this.timer || this.closed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.closed) return;
      const changes = { media: [...this.media], sources: [...this.sources], workflow: this.workflow,
        membership: this.membership, failed: !this.live };
      this.media.clear(); this.sources.clear(); this.workflow = false; this.membership = false;
      this.notify(changes);
    }, 350);
    this.timer.unref();
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
  }
}
