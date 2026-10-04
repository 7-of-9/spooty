import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { durationMatch } from '../youtube-duration';
import { cachedSourceDuration } from './spotify-duration';
import { fileBase, songKey, sourceFileBase, sourceKey, trackSourceId } from './identity';
import { mediaFingerprint as fingerprint, mediaPathOccupied, mediaUnchanged, MediaFingerprint } from './media-file';

export function probeLocalDuration(path: string): Promise<number | null> {
  return new Promise(yes => execFile(process.env.FFPROBE_PATH || '/opt/homebrew/bin/ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', path],
    { timeout: 15000, maxBuffer: 65536 }, (error, stdout) => {
      if (error) return yes(null);
      try {
        const row = JSON.parse(stdout);
        const seconds = Number(row.format?.duration);
        yes(row.streams?.some(stream => stream.codec_type === 'audio') && Number.isFinite(seconds) && seconds > 0 ? seconds : null);
      } catch { yes(null); }
    }));
}

/** Same fingerprinted evidence cache for web and CLI. File changes invalidate
 * evidence; hardlinks share one probe. No network, media writes or audit-file
 * dependency. Unknown/failed probes are not persisted as permanent failures. */
export class MediaDurationCache {
  private memory = new Map<string, number>();
  private pending = new Map<string, Promise<number | null>>();
  private active = 0;
  private waiting: Array<() => void> = [];
  constructor(private directory: string, private probe = probeLocalDuration) {}

  async duration(path: string): Promise<number | null> {
    const before = fingerprint(path);
    if (!before) return null;
    const identity = JSON.stringify(before);
    const key = createHash('sha256').update(identity).digest('hex');
    if (this.memory.has(key)) return this.memory.get(key);
    const cacheFile = join(this.directory, `${key}.json`);
    try {
      const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
      if (cached.version === 1 && JSON.stringify(cached.fingerprint) === identity && Number.isFinite(cached.seconds) && cached.seconds > 0) {
        this.memory.set(key, cached.seconds);
        return cached.seconds;
      }
    } catch { /* Missing/corrupt cache is re-probed, never accepted as audio. */ }
    if (this.pending.has(key)) return this.pending.get(key);
    const work = (async () => {
      if (this.active >= 4) await new Promise<void>(yes => this.waiting.push(yes));
      else this.active++;
      try {
        const seconds = await this.probe(path);
        if (!(typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) || JSON.stringify(fingerprint(path)) !== identity) return null;
        this.memory.set(key, seconds);
        try {
          mkdirSync(this.directory, { recursive: true, mode: 0o700 });
          const temp = `${cacheFile}.${process.pid}.${randomUUID()}.tmp`;
          writeFileSync(temp, JSON.stringify({ version: 1, fingerprint: before, seconds }), { mode: 0o600, flag: 'wx' });
          renameSync(temp, cacheFile);
        } catch { /* Cache failure does not invalidate the probe or touch media. */ }
        return seconds;
      } finally {
        const next = this.waiting.shift();
        if (next) next(); // Transfer the reserved slot; no admission race.
        else this.active--;
      }
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, work);
    return work;
  }
}

const caches = new Map<string, MediaDurationCache>();
export function mediaDurationCache(directory: string): MediaDurationCache {
  const key = resolve(directory);
  if (!caches.has(key)) caches.set(key, new MediaDurationCache(key));
  return caches.get(key);
}

export interface MediaResolution {
  local: string | null;
  source: string | null;
  destination: string;
  expectedMs: number | null;
  sourceFingerprint?: MediaFingerprint;
  localFingerprint?: MediaFingerprint;
  verification: 'duration-match' | 'unverified' | 'mismatch' | 'missing';
}

/** Filenames are lookup aliases, never work identity. Keep every candidate:
 * the first same-named file may be the wrong edit, another may be correct. */
export class LocalMediaIndex {
  readonly files = new Map<string, string[]>();
  private paths = new Map<string, { keys: string[]; inode: string }>();
  private walk(directory: string): void {
      let entries;
      try {
        if (!lstatSync(directory).isDirectory()) return;
        entries = readdirSync(directory, { withFileTypes: true });
      } catch { return; }
      for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.spooty-download-batch-') && !entry.name.startsWith('.acquire-')) this.walk(path);
        else if (entry.isFile()) this.add(path);
      }
  }

  private add(path: string): void {
    const proof = fingerprint(path);
    if (!proof || extname(path).toLowerCase() !== `.${this.format}`) return;
    const base = basename(path, extname(path));
    const id = base.match(/ \[sp-([A-Za-z0-9]{22})\](?:-\d+)?$/)?.[1];
    const keys = [base.toLowerCase(), ...(id ? [`spotify:${id}`] : [])];
    this.paths.set(path, { keys, inode: `${proof.dev}:${proof.ino}` });
    for (const key of keys) this.files.set(key, [...new Set([...(this.files.get(key) || []), path])]);
  }

  /** Update only an observed file/subtree, retaining unrelated media candidates.
   * Return aliases/source IDs affected by replacement, removal or hardlink edits. */
  refreshPath(changed: string): Set<string> {
    const path = resolve(changed), prefix = path + '/';
    const keys = new Set<string>(), inodes = new Set<string>();
    for (const [file, old] of this.paths) {
      if (file !== path && !file.startsWith(prefix)) continue;
      old.keys.forEach(key => keys.add(key)); inodes.add(old.inode);
      this.paths.delete(file);
      for (const key of old.keys) {
        const rest = this.files.get(key)!.filter(candidate => candidate !== file);
        rest.length ? this.files.set(key, rest) : this.files.delete(key);
      }
    }
    this.add(path); // Directory/symlink/non-media returns without accepting it.
    this.walk(path); // A directory rename can affect an entire subtree.
    for (const [file, info] of this.paths) {
      if (file === path || file.startsWith(prefix)) { info.keys.forEach(key => keys.add(key)); inodes.add(info.inode); }
    }
    for (const info of this.paths.values()) if (inodes.has(info.inode)) info.keys.forEach(key => keys.add(key));
    return keys;
  }

  constructor(roots: string[], private metadataPath: string, private cache: MediaDurationCache,
    private format = 'mp3') {
    for (const root of [...new Set(roots.map(root => resolve(root)))]) this.walk(root);
  }

  async resolve(track: any, folder: string): Promise<MediaResolution> {
    const expectedMs = cachedSourceDuration(this.metadataPath, trackSourceId(track), track);
    const targetBase = sourceFileBase(track);
    const canonical = join(folder, `${targetBase}.${this.format}`);
    const legacy = join(folder, `${fileBase(track.artist, track.name)}.${this.format}`);
    const aliases = [...new Set([canonical, legacy,
      ...(this.files.get(sourceKey(track)) || []), ...(this.files.get(songKey(track.artist, track.name)) || [])])]
      .filter(path => !!fingerprint(path));
    // Prefer a matching file already in this folder; then reuse elsewhere.
    aliases.sort((a, b) => Number(dirname(b) === folder) - Number(dirname(a) === folder));
    let source: string | null = null;
    let local: string | null = null;
    let unknown = false;
    let mismatch = false;
    let sourceFingerprint: MediaFingerprint | undefined;
    let localFingerprint: MediaFingerprint | undefined;
    for (const path of aliases) {
      const proof = fingerprint(path);
      if (!proof) continue;
      if (!expectedMs) {
        unknown = true;
        // Presence with unknown source evidence is not a known mismatch.
        // It cannot establish a safe cross-playlist copy.
        if (dirname(path) === folder && !local) { local = path; localFingerprint = proof; }
        continue;
      }
      const seconds = await this.cache.duration(path);
      if (!mediaUnchanged(path, proof)) { unknown = true; continue; }
      if (seconds === null) { unknown = true; continue; }
      if (!durationMatch(expectedMs, seconds).ok) { mismatch = true; continue; }
      source = path;
      sourceFingerprint = proof;
      if (dirname(path) === folder) { local = path; localFingerprint = proof; }
      break;
    }
    // Preserve even a mismatching source-specific file. New output gets the
    // first free version slot, and future scans recognise that same source ID.
    let destination = local || canonical;
    for (let version = 2; !local && mediaPathOccupied(destination); version++) {
      if (version > 1000) throw new Error('Too many existing files for this Spotify source');
      destination = join(folder, `${sourceFileBase(track, version)}.${this.format}`);
    }
    return { local, source: source || local, destination, expectedMs,
      sourceFingerprint: sourceFingerprint || localFingerprint, localFingerprint,
      verification: source ? 'duration-match' : unknown ? 'unverified' : mismatch ? 'mismatch' : 'missing' };
  }
}
