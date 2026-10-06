import test from 'node:test';
import assert from 'node:assert/strict';
import { spotifyIsrc } from '../spotify-session.mjs';

test('accepts the public ISRC field without exposing unrelated external IDs', () => {
  assert.equal(spotifyIsrc({ external_id: [
    { type: 'ISRC', id: 'US-RC1-76-07839' }, { type: 'other', id: 'private-value' },
  ] }), 'USRC17607839');
});
test('missing, malformed and ambiguous recording identifiers stay unknown', () => {
  for (const value of [undefined, {}, { external_id: [{ type: 'ISRC', id: 'invalid' }] },
    { external_id: [{ type: 'ISRC', id: 'USRC17607839' }, { type: 'ISRC', id: 'GXFCP2500020' }] }])
    assert.equal(spotifyIsrc(value), null);
});
