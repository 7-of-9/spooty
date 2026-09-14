import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  statSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { durationMatch } from '../youtube-duration';
import { youtubeVideoId } from '../youtube-download-batch';
export {
  durationMatch,
  youtubeDurationFilterArgs,
  youtubeDurationEvidenceArgs,
  parseYoutubeDurationEvidence,
} from '../youtube-duration';

export const DURATION_REJECTED =
  'YouTube candidate failed Spotify duration check';
export const DURATION_NO_CANDIDATE =
  'No acceptable duration-matched YouTube candidate in the configured search results';
export const DURATION_SOURCE_MISSING = 'Spotify source duration unavailable';

export function assertDuration(expectedMs, actualSeconds) {
  const result = durationMatch(expectedMs, actualSeconds);
  if (!result.ok)
    throw new Error(
      result.reason === 'missing-source'
        ? DURATION_SOURCE_MISSING
        : DURATION_REJECTED,
    );
  return result;
}

// Rejections survive a restart so an old cached URL cannot become trusted again.
// No media, credentials or raw extractor output is persisted here.
export class DurationCandidates {
  path: string;
  state: {
    version: number;
    rejected: Record<
      string,
      Array<{
        url: string;
        expectedMs: number;
        actualSeconds: number | null;
        at: string;
      }>
    >;
  };
  private fingerprint: string | null = null;
  constructor(path) {
    this.path = path;
    this.reload();
  }
  private reload() {
    try {
      const stat = statSync(this.path);
      const fingerprint = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
      if (fingerprint === this.fingerprint) return;
      this.state = JSON.parse(readFileSync(this.path, 'utf8'));
      if (
        this.state?.version !== 1 ||
        !this.state.rejected ||
        typeof this.state.rejected !== 'object' ||
        Array.isArray(this.state.rejected)
      )
        throw new Error('Duration rejection ledger invalid');
      this.fingerprint = fingerprint;
    } catch (e) {
      if (e.code !== 'ENOENT')
        throw new Error('Duration rejection ledger unreadable');
    }
    this.state ||= { version: 1, rejected: {} };
    if (
      this.state.version !== 1 ||
      !this.state.rejected ||
      typeof this.state.rejected !== 'object'
    )
      throw new Error('Duration rejection ledger invalid');
  }
  rejected(song) {
    this.reload();
    return this.state.rejected[song.key] || [];
  }
  choose(song, candidates) {
    const rejected = this.rejected(song);
    return (
      candidates.find(
        (c) =>
          youtubeVideoId(c.url) &&
          !rejected.some(
            (r) =>
              youtubeVideoId(r.url) === youtubeVideoId(c.url) &&
              r.expectedMs === song.durationMs,
          ) &&
          durationMatch(song.durationMs, c.durationSeconds).ok,
      ) || null
    );
  }
  reject(song, actualSeconds = null) {
    if (!song.url) return;
    const entries = this.rejected(song).filter(
      (r) => youtubeVideoId(r.url) !== youtubeVideoId(song.url),
    );
    entries.push({
      url: song.url,
      expectedMs: song.durationMs,
      actualSeconds,
      at: new Date().toISOString(),
    });
    this.state.rejected[song.key] = entries.slice(-128);
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(this.state) + '\n', { mode: 0o600 });
    renameSync(temp, this.path);
  }
  advance(song) {
    this.reject(song);
    const next = this.choose(song, song.durationCandidates || []);
    song.url = next?.url || null;
    return next;
  }
}
