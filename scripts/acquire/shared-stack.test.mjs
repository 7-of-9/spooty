import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { Transport, verifyMp3 } from './transport.mjs';
import { DurationCandidates, assertDuration } from './duration-policy.mjs';
import { publishMp3, materialize, publishMp3ForTrack, materializeForTrack, unpublishPlaylistCopies } from './publication.mjs';
import { fileBase, songKey, database } from './catalog.mjs';
import { optionDefinitions, commands } from './cli-options.mjs';
const require = createRequire(import.meta.url);
const core = name => require(`../../src/backend/src/shared/acquisition/${name}.ts`);

test('CLI compatibility exports are the SAME shared implementations used by Nest, not copied functions', () => {
  for (const [actual, expected] of [
    [Transport, core('transport').Transport], [verifyMp3, core('transport').verifyMp3],
    [DurationCandidates, core('duration-policy').DurationCandidates], [assertDuration, core('duration-policy').assertDuration],
    [publishMp3, core('publication').publishMp3], [materialize, core('publication').materialize],
    [publishMp3ForTrack, core('publication').publishMp3ForTrack], [materializeForTrack, core('publication').materializeForTrack],
    [unpublishPlaylistCopies, core('publication').unpublishPlaylistCopies],
    [fileBase, core('identity').fileBase], [songKey, core('identity').songKey],
  ]) assert.equal(actual, expected);
});

test('first-class CLI README covers every registered command and flag', () => {
  const readme = readFileSync(new URL('./README.md', import.meta.url), 'utf8');
  for (const name of Object.keys(optionDefinitions)) assert.ok(readme.includes(`--${name}`), name);
  for (const name of Object.keys(commands)) assert.ok(readme.includes('`' + name + '`'), name);
});

test('missing read-only SQLite databases reject normally, without an uncaught Database error', async () => {
  const db = database('/definitely-absent-spooty-directory/library.sqlite', true);
  try { await assert.rejects(db.all('SELECT 1'), /SQLITE_CANTOPEN/); }
  finally { await db.close(); }
});
