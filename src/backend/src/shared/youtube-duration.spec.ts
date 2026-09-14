import { durationMatch, youtubeDurationFilterArgs, youtubeDurationEvidenceArgs, parseYoutubeDurationEvidence } from './youtube-duration';

describe('shared Spotify-to-YouTube duration policy', () => {
  it('uses the inclusive five-second minimum, five percent band and twenty-second maximum', () => {
    expect(durationMatch(20_000, 25)).toEqual({ ok: true, reason: 'match', toleranceSeconds: 5 });
    expect(durationMatch(180_000, 189).ok).toBe(true);
    expect(durationMatch(180_000, 189.001).reason).toBe('mismatch');
    expect(durationMatch(1000_000, 1020).toleranceSeconds).toBe(20);
    expect(durationMatch(180_000, 3600).reason).toBe('mismatch');
    const seconds = 378117 / 1000;
    expect(durationMatch(378117, seconds + seconds * 0.05).ok).toBe(true);
    expect(durationMatch(378117, seconds - seconds * 0.05).ok).toBe(true);
    expect(durationMatch(378117, seconds + seconds * 0.05 + 0.001).ok).toBe(false);
  });
  it('captures per-ID extraction duration before filter rejection, including unknown values', () => {
    expect(youtubeDurationEvidenceArgs()).toEqual(['--no-simulate', '--print', 'pre_process:SPOOTY_CANDIDATE:%(.{id,duration})j']);
    expect(parseYoutubeDurationEvidence('ordinary text\nSPOOTY_CANDIDATE:{"id":"dQw4w9WgXcQ","duration":3600}\nSPOOTY_CANDIDATE:{"id":"aqz-KE-bpKQ"}\nSPOOTY_CANDIDATE:{"id":12345678901,"duration":180}\nSPOOTY_CANDIDATE:not-json')).toEqual([
      { videoId: 'dQw4w9WgXcQ', durationSeconds: 3600 },
      { videoId: 'aqz-KE-bpKQ', durationSeconds: null },
    ]);
  });
  it('never allows missing, zero, NaN or infinite source/candidate values', () => {
    for (const value of [undefined, 0, -1, NaN, Infinity]) {
      expect(durationMatch(value, 180).reason).toBe('missing-source');
      expect(durationMatch(180_000, value).reason).toBe('missing-candidate');
    }
  });
  it('binds each range to its own valid video ID, rejects missing inputs and never includes unknown values', () => {
    expect(youtubeDurationFilterArgs([{ videoId: 'dQw4w9WgXcQ', expectedMs: 180_000 }, { videoId: 'aqz-KE-bpKQ', expectedMs: 60_000 }])).toEqual([
      '--match-filter', "id = 'dQw4w9WgXcQ' & duration > 0 & duration >= 171.000000 & duration <= 189.000000",
      '--match-filter', "id = 'aqz-KE-bpKQ' & duration > 0 & duration >= 55.000000 & duration <= 65.000000",
    ]);
    expect(() => youtubeDurationFilterArgs([])).toThrow();
    expect(() => youtubeDurationFilterArgs([{ videoId: "id'", expectedMs: 180_000 }])).toThrow();
    expect(() => youtubeDurationFilterArgs([{ videoId: 'dQw4w9WgXcQ', expectedMs: NaN }])).toThrow();
  });
});
