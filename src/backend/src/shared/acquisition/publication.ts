import {
  copyFileSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  constants,
  openSync, closeSync, readSync, fstatSync,
} from 'node:fs';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileBase, sourceFileBase, trackSourceId } from './identity';
import { mediaFingerprint, mediaPathOccupied, mediaUnchanged, MediaFingerprint } from './media-file';

export class MediaDestinationOccupied extends Error {
  constructor() { super('Audio destination is occupied by a different file'); }
}

/** Byte comparison is only needed for occupied destinations. Same-inode reuse
 * stays cheap; independent encodings need explicit source-duration evidence. */
function sameMedia(source: string, target: string): boolean {
  const a = mediaFingerprint(source), b = mediaFingerprint(target);
  if (!a || !b || a.size !== b.size) return false;
  if (a.dev === b.dev && a.ino === b.ino) return true;
  let left: number | undefined, right: number | undefined;
  try {
    left = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    right = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (fstatSync(left).ino !== a.ino || fstatSync(right).ino !== b.ino) return false;
    const x = Buffer.allocUnsafe(Math.min(a.size, 1024 * 1024));
    const y = Buffer.allocUnsafe(x.length);
    for (let at = 0; at < a.size; at += x.length) {
      const length = Math.min(x.length, a.size - at);
      if (readSync(left, x, 0, length, at) !== length || readSync(right, y, 0, length, at) !== length ||
          !x.subarray(0, length).equals(y.subarray(0, length))) return false;
    }
    return mediaUnchanged(source, a) && mediaUnchanged(target, b);
  } catch { return false; }
  finally { if (left !== undefined) closeSync(left); if (right !== undefined) closeSync(right); }
}

function temporary(target: string): string {
  return join(dirname(target), `.acquire-${process.pid}-${randomUUID()}.tmp`);
}

function place(source: string, target: string): boolean {
  if (!mediaFingerprint(source)) throw new Error('Local source is missing or empty');
  if (sameMedia(source, target)) return false;
  if (mediaPathOccupied(target)) throw new MediaDestinationOccupied();
  mkdirSync(dirname(target), { recursive: true });
  try { linkSync(source, target); }
  catch (error) {
    if (error.code === 'EEXIST') {
      if (sameMedia(source, target)) return false;
      throw new MediaDestinationOccupied();
    }
    if (!['EXDEV', 'EPERM', 'EACCES'].includes(error.code)) throw error;
    // Copy across devices into a private file first. The final MP3 name never
    // exposes partially copied bytes, and no rename can overwrite another file.
    const temp = temporary(target);
    let owned = false;
    try {
      const fd = openSync(temp, 'wx', 0o600);
      owned = true;
      closeSync(fd);
      copyFileSync(source, temp);
      if (!sameMedia(source, temp)) throw new Error('Local source changed while copying');
      try { linkSync(temp, target); }
      catch (copyError) {
        if (copyError.code !== 'EEXIST') throw copyError;
        if (sameMedia(source, target)) return false;
        throw new MediaDestinationOccupied();
      }
    } finally { if (owned) { try { unlinkSync(temp); } catch {} } }
  }
  if (!sameMedia(source, target)) throw new Error('Local media changed during publication');
  return true;
}

function placeForTrack(source: string, requested: string, track: any) {
  let target = requested;
  for (let version = 2; version <= 1001; version++) {
    try { return { path: target, created: place(source, target) }; }
    catch (error) {
      if (!(error instanceof MediaDestinationOccupied)) throw error;
      target = join(dirname(requested), sourceFileBase(track, version) + (extname(requested) || '.mp3'));
    }
  }
  throw new Error('Too many occupied destinations for this Spotify source');
}

/** Existing physical media reuse is separate from new verified publication. */
const PLAYLIST_SOURCE_ID = /\[sp-([A-Za-z0-9]{22})\](?:-\d+)?$/;

function insideFolder(folder: string, path: string): boolean {
  const root = resolve(folder);
  const full = resolve(path);
  return full === root || full.startsWith(root + sep);
}

/** Unlink this playlist folder's copies of tracks Spotify no longer lists.
 * Other playlist hardlinks and remaining tracks stay. Missing folders are a no-op. */
export function unpublishPlaylistCopies(
  folder: string,
  removed: Array<{ id?: string; artist?: string; name?: string; href?: string; spotifyUrl?: string }>,
  remaining: Array<{ id?: string; artist?: string; name?: string; href?: string; spotifyUrl?: string }>,
): { removedPaths: string[] } {
  const root = resolve(folder);
  const remainingIds = new Set(remaining.map(track => trackSourceId(track)).filter((id): id is string => !!id));
  const removedIds = new Set(removed.map(track => trackSourceId(track)).filter((id): id is string => !!id && !remainingIds.has(id)));
  const remainingLegacy = new Set(remaining.map(track => fileBase(track.artist || '', track.name || '')));
  const removedLegacy = new Set(
    removed.map(track => fileBase(track.artist || '', track.name || '')).filter(name => !remainingLegacy.has(name)),
  );
  let names: string[] = [];
  try { names = readdirSync(root); } catch { return { removedPaths: [] }; }
  const removedPaths: string[] = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.mp3') || name.startsWith('.acquire-') || name.startsWith('.spooty-download-batch-')) continue;
    const full = resolve(root, name);
    if (!insideFolder(root, full)) continue;
    try {
      const st = lstatSync(full);
      if (!st.isFile() && !st.isSymbolicLink()) continue;
    } catch { continue; }
    const stem = basename(name, extname(name));
    const id = stem.match(PLAYLIST_SOURCE_ID)?.[1];
    const drop = id ? removedIds.has(id) : removedLegacy.has(stem);
    if (!drop) continue;
    try { unlinkSync(full); removedPaths.push(full); } catch { /* Membership still follows Spotify. */ }
  }
  return { removedPaths };
}

export function materialize(source: string, destinations: string[]): number {
  let added = 0;
  if (!mediaFingerprint(source)) throw new Error('Local source is missing or empty');
  for (const target of destinations) added += Number(place(source, target));
  return added;
}

export function materializeForTrack(source: string, destinations: string[], track: any,
  evidence: { source?: MediaFingerprint; local?: Record<string, MediaFingerprint> } = {}) {
  if (evidence.source && !mediaUnchanged(source, evidence.source))
    throw new Error('Local source changed after verification; check saved files again');
  let added = 0;
  const paths = destinations.map(target => {
    if (mediaUnchanged(target, evidence.local?.[target])) return target;
    const result = placeForTrack(source, target, track);
    added += Number(result.created);
    return result.path;
  });
  return { added, destinations: paths };
}

// Keep the temporary segment short even when a valid target is near the
// filesystem's filename limit. Publish atomically without replacing a file.
export function publishMp3(source, target, tags, writeTags) {
  if (mediaPathOccupied(target)) {
    if (sameMedia(source, target)) return false;
    throw new MediaDestinationOccupied();
  }
  return taggedPublication(source, target, tags, writeTags, temp => place(temp, target));
}

export interface PublishedMedia { path: string; created: boolean }

export function publishMp3ForTrack(source: string, target: string, track: any, writeTags,
  proof?: MediaFingerprint): PublishedMedia {
  if (proof && !mediaUnchanged(source, proof)) throw new Error('Local source changed after verification; check saved files again');
  return taggedPublication(source, target, { title: track.name, artist: track.artist }, writeTags,
    temp => placeForTrack(temp, target, track));
}

function taggedPublication<T>(source, target, tags, writeTags, publish: (path: string) => T): T {
  if (!mediaFingerprint(source)) throw new Error('Local source is missing or empty');
  mkdirSync(dirname(target), { recursive: true });
  const temp = temporary(target);
  let owned = false;
  try {
    const fd = openSync(temp, 'wx', 0o600);
    owned = true;
    closeSync(fd);
    copyFileSync(source, temp);
    if (!sameMedia(source, temp)) throw new Error('Local source changed while copying');
    if (!writeTags(tags, temp))
      throw new Error('MP3 tags could not be written');
    return publish(temp);
  } finally {
    if (owned) { try { unlinkSync(temp); } catch {} }
  }
}

// Acquisition remains independent of a temporary Nest outage while the
// Redis ownership and paused-queue guard still hold. Final handback MUST
// use the throwing sync function directly before web workers can resume.
export function bestEffortPaceMirror(sync, emit) {
  let unavailable = false;
  return async () => {
    try {
      await sync();
      if (unavailable) emit('pace_mirror_restored');
      unavailable = false;
      return true;
    } catch {
      if (!unavailable)
        emit('pace_mirror_unavailable', {
          error:
            'Backend pace mirror unavailable; CLI retains ownership and local admission history',
        });
      unavailable = true;
      return false;
    }
  };
}
