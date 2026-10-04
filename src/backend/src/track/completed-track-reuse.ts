import { existsSync, statSync } from 'fs';
import { isAbsolute, relative, resolve } from 'path';
import { materialize, materializeForTrack } from '../shared/acquisition/publication';
import { MediaResolution } from '../shared/acquisition/local-media';

function inside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function isNonEmptyFile(path: string): boolean {
  try {
    return (
      existsSync(path) && statSync(path).isFile() && statSync(path).size > 0
    );
  } catch {
    return false;
  }
}

/**
 * Reuse an existing library asset without another YouTube request.
 * Returns false when the source is unusable; throws for unsafe paths or an
 * unexpected filesystem error so the caller never records a phantom success.
 */
export function reuseCompletedTrackFile(
  source: string,
  destination: string,
  downloadsRoot: string,
): boolean {
  if (!inside(downloadsRoot, source) || !inside(downloadsRoot, destination)) {
    throw new Error('Refusing to reuse audio outside downloads root');
  }
  if (!isNonEmptyFile(source)) return false;

  materialize(source, [destination]);
  return isNonEmptyFile(destination);
}

export function reuseCompletedTrackMedia(track: any, media: MediaResolution, downloadsRoot: string): string | null {
  if (!media.source) return null;
  if (!inside(downloadsRoot, media.source) || !inside(downloadsRoot, media.destination))
    throw new Error('Refusing to reuse audio outside downloads root');
  return materializeForTrack(media.source, [media.destination], track, {
    source: media.sourceFingerprint,
    local: media.local ? { [media.local]: media.localFingerprint } : {},
  }).destinations[0];
}
