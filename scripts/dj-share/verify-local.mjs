#!/usr/bin/env node
// Reuse Spooty's source identity and duration guard before a public export.
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import { basename, resolve, join } from 'node:path';
const require = createRequire(import.meta.url);
require('ts-node').register({ transpileOnly: true, skipProject: true,
  compilerOptions: { module: 'commonjs', target: 'es2022', experimentalDecorators: true } });
const { LocalMediaIndex, mediaDurationCache } = require('../../src/backend/src/shared/acquisition/local-media.ts');
const [input, folderArg, metadata, cache] = process.argv.slice(2);
if (![input, folderArg, metadata, cache].every(Boolean)) throw new Error('Missing verification arguments');
const folder = resolve(folderArg);
const source = JSON.parse(readFileSync(input, 'utf8'));
const index = new LocalMediaIndex([folder], metadata, mediaDurationCache(cache));
const rows = [];
for (const track of source.tracks) {
  if (!track.onDisk || track.mediaVerification !== 'duration-match') throw new Error('Playlist is not fully verified');
  const id = track.sourceKey?.replace(/^spotify:/, '');
  if (!/^[A-Za-z0-9]{22}$/.test(id)) throw new Error('Missing source identity');
  const result = await index.resolve({ ...track, id }, folder);
  if (result.verification !== 'duration-match' || !result.local || basename(result.local) !== track.filename)
    throw new Error(`Source file verification failed for ${id}`);
  const actual = statSync(result.local), expected = statSync(join(folder, track.filename));
  if (actual.dev !== expected.dev || actual.ino !== expected.ino) throw new Error('Source file changed');
  rows.push({ spotifyId: id, filename: track.filename, verification: result.verification,
    expectedMs: result.expectedMs, bytes: actual.size });
}
console.log(JSON.stringify(rows));
