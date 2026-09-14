import test from 'node:test';
import assert from 'node:assert/strict';
import { exactHistoryMatch } from './historical-duration-recover-identities.mjs';

const ID = '1234567890123456789012';
const unknown = new Map([['artist, second - track', [{ id: '1-2', paths: ['/d/Artist, Second - Track.mp3'] }]]]);

test('scoped history recovery accepts exact names with Unicode whitespace and valid Spotify URL only', () => {
  const match = exactHistoryMatch({ artist: 'Artist,\u00a0Second', name: 'Track', spotifyUrl: `https://open.spotify.com/track/${ID}`, durationMs: 200000 }, unknown);
  assert.deepEqual(match.spotifyIds, [ID]); assert.equal(match.files[0].id, '1-2');
  assert.equal(match.durationMs, 200000);
});

test('unrelated and fuzzy names never become historical identity bindings', () => {
  assert.equal(exactHistoryMatch({ artist: 'Artist, Second', name: 'Track live', spotifyId: ID }, unknown), null);
  assert.equal(exactHistoryMatch({ artist: 'Other', name: 'Track', spotifyId: ID }, unknown), null);
});

test('numeric Bull track IDs and YouTube URLs are not Spotify IDs', () => {
  const match = exactHistoryMatch({ artist: 'Artist, Second', name: 'Track', id: 12345,
    spotifyUrl: 'https://www.youtube.com/watch?v=abcdefghijk', durationMs: -1 }, unknown);
  assert.deepEqual(match.spotifyIds, []); assert.equal(match.durationMs, null);
});

test('publication source IDs can bind an exact known filename key without inventing artist/title fields', () => {
  const match = exactHistoryMatch({ key: 'artist, second - track', durationSpotifyId: ID, spotifyDurationMs: 200000 }, unknown);
  assert.deepEqual(match.spotifyIds, [ID]); assert.equal(match.artist, null); assert.equal(match.name, null);
});
