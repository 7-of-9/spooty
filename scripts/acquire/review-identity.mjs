import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('ts-node').register({ transpileOnly: true, skipProject: true, compilerOptions: { module: 'commonjs', target: 'es2022', experimentalDecorators: true } });
export const { SourceReviewIndex, reviewSourceIds } = require('../../src/backend/src/shared/acquisition/review-identity.ts');
