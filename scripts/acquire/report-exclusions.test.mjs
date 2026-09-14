import test from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkPhases } from './report.mjs';

test('known interference excludes the overlapping benchmark without erasing real output', () => {
  const t = Date.parse('2026-09-13T00:00:00Z');
  const profile = { downloadConc: 2, searchConc: 1, maxPerWindow: 144 };
  const events = [
    { type: 'start', t, profile },
    { type: 'mp3_verified', t: t + 1000, duration: 120 },
    { type: 'pace_change', t: t + 600000, pace: { ...profile, maxPerWindow: 168 } },
    { type: 'mp3_verified', t: t + 601000, duration: 120 },
  ];
  const notes = [{ startedAt: new Date(t + 700000).toISOString(),
    endedAt: new Date(t + 716000).toISOString(), reason: 'Test child interference' }];
  const phases = benchmarkPhases(events, t + 1200000, notes);
  assert.equal(phases[0].firstFull10.excludedFromSoleOwnerBenchmark, false);
  assert.equal(phases[1].verifiedNewMp3, 1);
  assert.equal(phases[1].firstFull10.excludedFromSoleOwnerBenchmark, true);
  assert.equal(phases[1].lastFull10.excludedFromSoleOwnerBenchmark, true);
  assert.equal(phases[1].benchmarkExclusions.length, 1);
  // A later rolling observation is not permanently disqualified by old notes.
  assert.equal(benchmarkPhases(events, t + 2600000, notes)[1]
    .lastFull30.excludedFromSoleOwnerBenchmark, false);
  const cleanWindow = benchmarkPhases(events, t + 1400000, notes)[1].lastFull10;
  assert.equal(cleanWindow.excludedFromSoleOwnerBenchmark, false);
  assert.equal(cleanWindow.verifiedNewMp3, 0);
  assert.equal(cleanWindow.startedAt, new Date(t + 800000).toISOString());
  assert.equal(cleanWindow.endedAt, new Date(t + 1400000).toISOString());
});
