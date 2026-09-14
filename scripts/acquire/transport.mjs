import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('ts-node').register({ transpileOnly: true, skipProject: true, compilerOptions: { module: 'commonjs', target: 'es2022', experimentalDecorators: true } });
const core = require('../../src/backend/src/shared/acquisition/transport.ts');
export const { classify, recoveryCookiesAvailable, isolateCookieFile, canLaunchYoutubeWork, Transport, verifyMp3 } = core;
