export type DurationMatch = { ok: boolean; reason: 'match' | 'mismatch' | 'missing-source' | 'missing-candidate'; toleranceSeconds: number | null };

export function durationMatch(expectedMs: number | undefined, actualSeconds: number | undefined): DurationMatch {
  if (typeof expectedMs !== 'number' || !Number.isFinite(expectedMs) || expectedMs <= 0) {
    return { ok: false, reason: 'missing-source', toleranceSeconds: null };
  }
  const sourceSeconds = expectedMs / 1000;
  const toleranceSeconds = Math.max(5, Math.min(20, sourceSeconds * 0.05));
  if (typeof actualSeconds !== 'number' || !Number.isFinite(actualSeconds) || actualSeconds <= 0) {
    return { ok: false, reason: 'missing-candidate', toleranceSeconds };
  }
  // Match the filter's six-decimal precision without floating-point exclusion
  // at an otherwise inclusive boundary (not a materially wider tolerance).
  const ok = Math.abs(sourceSeconds - actualSeconds) <= toleranceSeconds + 0.000001;
  return { ok, reason: ok ? 'match' : 'mismatch', toleranceSeconds };
}

/** yt-dlp ORs repeated filters; each clause binds its range to a validated ID.
 * No '?' comparisons: unknown extraction durations must not pass. */
export function youtubeDurationFilterArgs(items: Array<{ videoId: string; expectedMs: number }>): string[] {
  if (!items.length) throw new Error('Duration guard requires at least one source');
  const filters = new Set<string>();
  for (const item of items) {
    const match = durationMatch(item.expectedMs, undefined);
    if (!/^[A-Za-z0-9_-]{11}$/.test(item.videoId) || match.toleranceSeconds === null) {
      throw new Error('Duration guard requires a valid video ID and Spotify duration');
    }
    const seconds = item.expectedMs / 1000;
    const lower = Math.max(0, seconds - match.toleranceSeconds);
    const upper = seconds + match.toleranceSeconds;
    filters.add(`id = '${item.videoId}' & duration > 0 & duration >= ${lower.toFixed(6)} & duration <= ${upper.toFixed(6)}`);
  }
  return [...filters].flatMap((filter) => ['--match-filter', filter]);
}

export function durationFailure(message: string): Error {
  return new Error(`Temporary YouTube failure: duration check failed: ${message}`);
}

export function isDurationFailure(error: unknown): boolean {
  return error instanceof Error && error.message.includes('duration check failed:');
}

/** pre_process runs before match-filter (after_filter/before_dl do not).
 * Force-printing only this stage otherwise implies simulation. */
export function youtubeDurationEvidenceArgs(): string[] {
  return ['--no-simulate', '--print', 'pre_process:SPOOTY_CANDIDATE:%(.{id,duration})j'];
}

export function parseYoutubeDurationEvidence(stdout: string): Array<{ videoId: string; durationSeconds: number | null }> {
  const rows: Array<{ videoId: string; durationSeconds: number | null }> = [];
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('SPOOTY_CANDIDATE:')) continue;
    try {
      const value = JSON.parse(line.slice('SPOOTY_CANDIDATE:'.length));
      if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(value.id)) continue;
      rows.push({ videoId: value.id, durationSeconds: typeof value.duration === 'number' && Number.isFinite(value.duration) && value.duration > 0 ? value.duration : null });
    } catch { /* An invalid marker is no proof of a matching duration. */ }
  }
  return rows;
}
