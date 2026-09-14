import {
  copyFileSync,
  linkSync,
  mkdirSync,
  unlinkSync,
  constants,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isNonEmptyBatchFile as nonempty } from '../youtube-download-batch';

/** Existing physical media reuse is separate from new verified publication. */
export function materialize(source: string, destinations: string[]): void {
  if (!nonempty(source)) throw new Error('Local source is missing or empty');
  for (const target of destinations) {
    if (target === source || nonempty(target)) continue;
    mkdirSync(dirname(target), { recursive: true });
    try {
      linkSync(source, target);
    } catch (error) {
      if (error.code === 'EEXIST' && nonempty(target)) continue;
      if (!['EXDEV', 'EPERM', 'EACCES'].includes(error.code)) throw error;
      try {
        copyFileSync(source, target, constants.COPYFILE_EXCL);
      } catch (copyError) {
        if (copyError.code !== 'EEXIST' || !nonempty(target)) throw copyError;
      }
    }
  }
}

// Keep the temporary segment short even when a valid target is near the
// filesystem's filename limit. Publish atomically without replacing a file.
export function publishMp3(source, target, tags, writeTags) {
  if (nonempty(target)) return false;
  mkdirSync(dirname(target), { recursive: true });
  const temp = join(
    dirname(target),
    `.acquire-${process.pid}-${randomUUID()}.tmp`,
  );
  try {
    copyFileSync(source, temp);
    if (!writeTags(tags, temp))
      throw new Error('MP3 tags could not be written');
    try {
      linkSync(temp, target);
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST' || !nonempty(target)) throw e;
      return false;
    }
  } finally {
    try {
      unlinkSync(temp);
    } catch {}
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
