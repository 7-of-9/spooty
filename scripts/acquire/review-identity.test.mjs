import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceReviewIndex, reviewSourceIds } from './review-identity.mjs';

const a = 'aaaaaaaaaaaaaaaaaaaaaa', b = 'bbbbbbbbbbbbbbbbbbbbbb';
const track = id => ({ key: `spotify:${id}`, id, artist: 'Artist', name: 'Song' });

test('legacy review evidence binds to the exact source, not every same-named song', () => {
  const entry = { key: 'artist - song', status: 'needs-repair', catalogTrackId: a };
  const index = new SourceReviewIndex([entry]);
  assert.deepEqual(index.forTrack(track(a)), [entry]);
  assert.deepEqual(index.forTrack(track(b)), []);
  assert.equal(index.statusFor(track(a)), 'needs-repair');
  assert.equal(index.statusFor(track(b)), null);
  assert.equal(entry.key, 'artist - song');
});

test('source evidence can come from the audit or a Spotify reference', () => {
  for (const evidence of [{ reference: `https://open.spotify.com/track/${a}` },
    { durationAudit: { files: [{ spotifyId: a }] } }, { key: `spotify:${a}` }]) {
    const entry = { key: 'old name', status: 'needs-review', ...evidence };
    assert.deepEqual(new SourceReviewIndex([entry]).forTrack(track(a)), [entry]);
  }
});

test('name-only legacy reviews remain unbound to new sources instead of being guessed', () => {
  const entry = { key: 'artist - song', status: 'needs-review' };
  const index = new SourceReviewIndex([entry]);
  assert.deepEqual(index.forTrack(track(a)), []);
  assert.deepEqual(index.unbound, [entry]);
  assert.deepEqual(index.forTrack({ key: entry.key }), [entry]);
});

test('a group review informs both explicit sources while a conflicting exact-source row fails closed', () => {
  const entry = { key: 'old group', status: 'needs-repair', catalogTrackId: a, durationAudit: { files: [{ spotifyId: b }] } };
  assert.deepEqual(reviewSourceIds(entry), [a, b]);
  const index = new SourceReviewIndex([entry]);
  assert.deepEqual(index.forTrack(track(a)), [entry]); assert.deepEqual(index.forTrack(track(b)), [entry]);
  assert.throws(() => new SourceReviewIndex([{ ...entry, key: `spotify:${a}` }]), /Conflicting Spotify identities/);
});

test('latest same-key state wins without hiding an independent unresolved review for that source', () => {
  const old = { key: 'old group', status: 'needs-repair', catalogTrackId: a };
  const resolved = { ...old, status: 'resolved' };
  const separate = { key: `spotify:${a}`, status: 'needs-review' };
  const index = new SourceReviewIndex([old, resolved, separate]);
  assert.deepEqual(index.forTrack(track(a)), [resolved, separate]);
  assert.equal(index.statusFor(track(a)), 'needs-review');
  assert.equal(new SourceReviewIndex([old, resolved]).statusFor(track(a)), 'resolved');
  assert.throws(() => new SourceReviewIndex([{ key: 'bad', status: 'invented' }]), /Invalid source review ledger/);
  assert.throws(() => new SourceReviewIndex([{ ...old, durationAudit: { files: [null] } }]), /Invalid source review ledger/);
  assert.throws(() => index.forTrack({ ...track(a), key: `spotify:${b}` }), /Conflicting Spotify identities in review target/);
});

test('inspection planning deduplicates explicit sources and explains uninspectable or unbound reviews', () => {
  const index = new SourceReviewIndex([
    { key: 'old a', status: 'needs-review', catalogTrackId: a },
    { key: `spotify:${a}`, status: 'needs-repair' },
    { key: 'old b', status: 'needs-review', catalogTrackId: b },
    { key: 'unbound', status: 'needs-review' },
  ]);
  const ready = { ...track(a), url: 'https://www.youtube.com/watch?v=abcdefghijk', source: 'saved.mp3' };
  const plan = index.inspectionPlan([ready, ready, track(b)]);
  assert.deepEqual(plan, { songs: [ready], mappedSources: 2, unavailableSources: 1, unboundLegacyReviews: 1 });
});
