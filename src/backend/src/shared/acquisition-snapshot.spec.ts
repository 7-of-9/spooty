import {
  projectAcquisitionOwner,
  projectAcquisitionSnapshot,
} from './acquisition-snapshot';

describe('CLI acquisition telemetry', () => {
  const now = Date.parse('2026-09-13T00:20:00Z');
  const status = {
    pid: 123,
    runId: 'run',
    at: new Date(now - 30000).toISOString(),
    phase: 'running',
    verifiedNewMp3: 100,
    remainingUnique: 13000,
    diskGB: 53.7,
    mp3PerMinute: 8,
    elapsedMinutes: 12.5,
    contentReviewPendingUnique: 7,
    pace: {
      downloadConc: 2,
      searchConc: 1,
      downloadActive: 1,
      searchActive: 0,
      maxPerWindow: 96,
      downloadsInWindow: 90,
      windowMs: 600000,
      coolRemainingMs: 0,
    },
    eta: {
      continuous: '2026-09-14T01:00:00Z',
      buffered25: '2026-09-14T08:00:00Z',
    },
    secret: 'must-not-project',
    eventFile: '/private/path',
  };
  const handoff = { pid: 123, runId: 'run', phase: 'owned' };
  const project = (s = status, h = handoff, alive = () => true) =>
    projectAcquisitionSnapshot(s, h, now, alive);

  it('projects fresh matching ownership with explicit units and no raw material', () => {
    const result = project();
    expect(result.mp3PerMinute).toBe(8);
    expect(result.baselineMultiple).toBe(8 / 3);
    expect(result.pace.maxPerWindow).toBe(96);
    expect(result.eta.continuous).toBe('2026-09-14T01:00:00.000Z');
    expect(JSON.stringify(result)).not.toMatch(
      /secret|private|eventFile|pid|runId/,
    );
  });
  it('rejects stale, stopped, dead and mismatched owners', () => {
    expect(
      project({ ...status, at: new Date(now - 91000).toISOString() }),
    ).toBeNull();
    expect(project({ ...status, phase: 'finished' })).toBeNull();
    expect(project(status, { ...handoff, phase: 'returned' })).toBeNull();
    expect(project(status, { ...handoff, pid: 124 })).toBeNull();
    expect(project(status, handoff, () => false)).toBeNull();
  });
  it('rejects malformed metrics and does not project arbitrary ETA strings', () => {
    expect(project({ ...status, diskGB: NaN })).toBeNull();
    expect(
      project({ ...status, pace: { ...status.pace, windowMs: 0 } }),
    ).toBeNull();
    expect(
      project({ ...status, eta: { ...status.eta, continuous: 'private text' } })
        .eta.continuous,
    ).toBeNull();
  });
  it('marks recovery/cooldown as held without leaking error details', () => {
    expect(
      project({ ...status, pace: { ...status.pace, coolRemainingMs: 60000 } })
        .held,
    ).toBe(true);
  });

  it('labels a short-profile ETA and projects its rate separately from the whole run', () => {
    const result = projectAcquisitionSnapshot(
      {
        ...status,
        currentProfileMp3PerMinute: 10.4,
        currentProfileStartedAt: new Date(now - 60000).toISOString(),
        eta: { ...status.eta, rateUsedPerMinute: 10.4 },
      },
      handoff,
      now,
      () => true,
    );
    expect(result.mp3PerMinute).toBe(8);
    expect(result.currentProfileMp3PerMinute).toBe(10.4);
    expect(result.currentProfileBaselineMultiple).toBe(10.4 / 3);
    expect(result.eta.rateUsedPerMinute).toBe(10.4);
    expect(result.eta.provisional).toBe(true);
  });

  it('does not invent a current-profile rate for older or malformed snapshots', () => {
    expect(project().currentProfileMp3PerMinute).toBeNull();
    for (const rate of [NaN, Infinity, -1, 'private text']) {
      const result = project({
        ...status,
        currentProfileMp3PerMinute: rate,
      } as typeof status);
      expect(result.currentProfileMp3PerMinute).toBeNull();
      expect(result.currentProfileBaselineMultiple).toBeNull();
    }
  });

  it('projects fresh recovery and draining telemetry without claiming active processing', () => {
    for (const phase of ['waiting-for-recovery', 'draining']) {
      const result = project({ ...status, phase });
      expect(result.phase).toBe(phase);
      expect(result.held).toBe(phase === 'waiting-for-recovery');
    }
  });

  it('keeps authoritative ownership when files are stale, missing, dead or mismatched', () => {
    for (const value of [
      null,
      { ...status, at: new Date(now - 90001).toISOString() },
      { ...status, runId: 'different' },
      { ...status, phase: 'private error' },
    ]) {
      const owner = projectAcquisitionOwner('owned', value, handoff, now);
      expect(owner).toEqual({
        state: 'owned',
        phase: 'unknown',
        telemetryFresh: false,
      });
      expect(JSON.stringify(owner)).not.toMatch(/private|pid|runId/);
    }
  });

  it('exposes fresh owned phases but never treats a Redis failure as available', () => {
    expect(
      projectAcquisitionOwner(
        'owned',
        { ...status, phase: 'draining' },
        handoff,
        now,
      ),
    ).toEqual({ state: 'owned', phase: 'draining', telemetryFresh: true });
    expect(projectAcquisitionOwner('unknown', status, handoff, now)).toEqual({
      state: 'unknown',
      phase: null,
      telemetryFresh: false,
    });
    expect(projectAcquisitionOwner('available', status, handoff, now)).toEqual({
      state: 'available',
      phase: null,
      telemetryFresh: false,
    });
  });

  it('allowlists candidate depth and separate outcome/retry counters', () => {
    const result = project({
      ...status,
      maxSearches: 10,
      networkRetryLimit: 5,
      networkRetries: 2,
      operationRetries: 3,
      candidateDisqualifications: 90,
      noAcceptableCandidate: 4,
      rejectedCandidates: [{ url: 'private' }],
    } as typeof status);
    expect(result.maxSearches).toBe(10);
    expect(result.networkRetryLimit).toBe(5);
    expect(result.networkRetries).toBe(2);
    expect(result.operationRetries).toBe(3);
    expect(result.candidateDisqualifications).toBe(90);
    expect(result.noAcceptableCandidate).toBe(4);
    expect(JSON.stringify(result)).not.toMatch(/rejectedCandidates|private/);
    for (const value of [-1, 2.5, Infinity, 'secret']) {
      const invalid = project({
        ...status,
        networkRetries: value,
        operationRetries: value,
        noAcceptableCandidate: value,
        candidateDisqualifications: value,
      } as typeof status);
      expect(invalid.networkRetries).toBeNull();
      expect(invalid.operationRetries).toBeNull();
      expect(invalid.noAcceptableCandidate).toBeNull();
      expect(invalid.candidateDisqualifications).toBeNull();
    }
    expect(
      project({
        ...status,
        maxSearches: 51,
        networkRetryLimit: 21,
      } as typeof status).maxSearches,
    ).toBeNull();
    expect(
      project({
        ...status,
        maxSearches: 0,
        networkRetryLimit: 21,
      } as typeof status).networkRetryLimit,
    ).toBeNull();
  });
});
