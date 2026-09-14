import { readFileSync } from 'fs';
import { join } from 'path';

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const phases = ['running', 'waiting-for-recovery', 'draining'] as const;
export type AcquisitionLeaseState = 'owned' | 'available' | 'unknown';

function readSnapshotFile(directory: string, name: string) {
  try {
    return JSON.parse(readFileSync(join(directory, name), 'utf8'));
  } catch {
    return null;
  }
}

/** Redis ownership is authoritative even when the last telemetry write is old. */
export function acquisitionOwnerSnapshot(
  directory: string | null,
  state: AcquisitionLeaseState,
  now = Date.now(),
) {
  return projectAcquisitionOwner(
    state,
    directory ? readSnapshotFile(directory, 'status.json') : null,
    directory ? readSnapshotFile(directory, 'handoff.json') : null,
    now,
  );
}

export function projectAcquisitionOwner(
  state: AcquisitionLeaseState,
  status: any,
  handoff: any,
  now: number,
) {
  const at = Date.parse(status?.at);
  const matches =
    typeof status?.runId === 'string' &&
    !!status.runId &&
    status.runId === handoff?.runId &&
    status.pid === handoff?.pid &&
    Number.isInteger(status.pid) &&
    status.pid > 0 &&
    handoff?.phase === 'owned';
  const fresh =
    matches && Number.isFinite(at) && now - at >= -5000 && now - at <= 90000;
  return {
    state,
    phase:
      state !== 'owned'
        ? null
        : fresh && phases.includes(status?.phase)
          ? (status.phase as (typeof phases)[number])
          : ('unknown' as const),
    telemetryFresh:
      state === 'owned' && fresh && phases.includes(status?.phase),
  };
}

/** Read-only, allowlisted telemetry. Never expose the journal, paths or cookies. */
export function acquisitionSnapshot(directory: string, now = Date.now()) {
  try {
    const status = JSON.parse(
      readFileSync(join(directory, 'status.json'), 'utf8'),
    );
    const handoff = JSON.parse(
      readFileSync(join(directory, 'handoff.json'), 'utf8'),
    );
    return projectAcquisitionSnapshot(status, handoff, now);
  } catch {
    return null;
  }
}

export function projectAcquisitionSnapshot(
  status: any,
  handoff: any,
  now: number,
  alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
) {
  const at = Date.parse(status?.at);
  if (
    !Number.isFinite(at) ||
    now - at < -5000 ||
    now - at > 90000 ||
    !phases.includes(status?.phase) ||
    handoff?.phase !== 'owned' ||
    typeof status.runId !== 'string' ||
    !status.runId ||
    status.runId !== handoff.runId ||
    status.pid !== handoff.pid ||
    !Number.isInteger(status.pid) ||
    status.pid <= 0 ||
    !alive(status.pid)
  )
    return null;
  if (
    ![
      status.verifiedNewMp3,
      status.remainingUnique,
      status.diskGB,
      status.mp3PerMinute,
      status.elapsedMinutes,
    ].every(finite)
  )
    return null;
  const pace = status.pace;
  const keys = [
    'downloadConc',
    'searchConc',
    'downloadActive',
    'searchActive',
    'maxPerWindow',
    'downloadsInWindow',
    'windowMs',
    'coolRemainingMs',
  ] as const;
  if (!pace || !keys.every((key) => finite(pace[key])) || !pace.windowMs)
    return null;
  const safeDate = (value: unknown) =>
    typeof value === 'string' && Number.isFinite(Date.parse(value))
      ? new Date(value).toISOString()
      : null;
  const count = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) =>
    finite(value) && Number.isInteger(value) && value >= min && value <= max
      ? value
      : null;
  return {
    at: new Date(at).toISOString(),
    phase: status.phase as (typeof phases)[number],
    verifiedNewMp3: status.verifiedNewMp3,
    remainingUnique: status.remainingUnique,
    diskGB: status.diskGB,
    mp3PerMinute: status.mp3PerMinute,
    baselineMultiple: status.mp3PerMinute / 3,
    currentProfileMp3PerMinute: finite(status.currentProfileMp3PerMinute)
      ? status.currentProfileMp3PerMinute
      : null,
    currentProfileBaselineMultiple: finite(status.currentProfileMp3PerMinute)
      ? status.currentProfileMp3PerMinute / 3
      : null,
    elapsedMinutes: status.elapsedMinutes,
    contentReviewPendingUnique: finite(status.contentReviewPendingUnique)
      ? status.contentReviewPendingUnique
      : null,
    maxSearches: count(status.maxSearches, 1, 50),
    networkRetryLimit: count(status.networkRetryLimit, 0, 20),
    networkRetries: count(status.networkRetries),
    operationRetries: count(status.operationRetries),
    candidateDisqualifications: count(status.candidateDisqualifications),
    noAcceptableCandidate: count(status.noAcceptableCandidate),
    held:
      status.phase === 'waiting-for-recovery' ||
      (status.recoveryWaitMs || 0) > 0 ||
      pace.coolRemainingMs > 0,
    eta: {
      continuous: safeDate(status.eta?.continuous),
      buffered25: safeDate(status.eta?.buffered25),
      rateUsedPerMinute: finite(status.eta?.rateUsedPerMinute)
        ? status.eta.rateUsedPerMinute
        : null,
      provisional:
        !Number.isFinite(Date.parse(status.currentProfileStartedAt)) ||
        now - Date.parse(status.currentProfileStartedAt) < 600000,
    },
    pace: Object.fromEntries(keys.map((key) => [key, pace[key]])),
  };
}
