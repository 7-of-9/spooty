import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('ts-node').register({ transpileOnly: true, skipProject: true, compilerOptions: { module: 'commonjs', target: 'es2022', experimentalDecorators: true } });
const core = require('../../src/backend/src/shared/acquisition/duration-policy.ts');
export const { durationMatch, youtubeDurationFilterArgs, youtubeDurationEvidenceArgs, parseYoutubeDurationEvidence, DURATION_REJECTED, DURATION_NO_CANDIDATE, DURATION_SOURCE_MISSING, assertDuration, DurationCandidates } = core;
