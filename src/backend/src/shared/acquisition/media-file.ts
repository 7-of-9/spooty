import { lstatSync } from 'node:fs';

export type MediaFingerprint = { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number };

/** Never follow a symlink as evidence for a published media file. */
export function mediaFingerprint(path: string): MediaFingerprint | null {
  try {
    const s = lstatSync(path);
    return s.isFile() && s.size > 0
      ? { dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs }
      : null;
  } catch { return null; }
}

export function mediaUnchanged(path: string, proof: MediaFingerprint | null | undefined): boolean {
  const now = mediaFingerprint(path);
  // Adding another playlist hardlink changes ctime without changing the audio.
  // Duration-cache keys still include ctime; handoff evidence uses file identity,
  // size and content modification time so our own copies do not invalidate it.
  return !!proof && !!now && ['dev', 'ino', 'size', 'mtimeMs'].every(key => now[key] === proof[key]);
}

export function mediaPathOccupied(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}
