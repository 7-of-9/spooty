import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('ts-node').register({ transpileOnly: true, skipProject: true, compilerOptions: { module: 'commonjs', target: 'es2022', experimentalDecorators: true } });
const core = require('../../src/backend/src/shared/acquisition/candidate-policy.ts');
export const { candidateLimits, isCandidateOutcome, isNetworkFailure, candidateStateAfterRejection, recordCandidateOutcome, selectionStateOnResume, networkFailureState, isSearchedCandidate, preparedSearchBufferSize, readyDownloadCandidates } = core;
