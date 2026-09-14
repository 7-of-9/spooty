import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('ts-node').register({ transpileOnly: true, skipProject: true, compilerOptions: { module: 'commonjs', target: 'es2022', experimentalDecorators: true } });
const core = require('../../src/backend/src/shared/acquisition/spotify-duration.ts');
import { getTrackDurationMetadata } from '../spotify-session.mjs';
export const { positiveDurationMs, validSourceMetadata } = core;
export function createDurationResolver(cachePath, fetchMetadata = getTrackDurationMetadata) {
  return core.createDurationResolver(cachePath, fetchMetadata);
}
