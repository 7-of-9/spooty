import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('ts-node').register({ transpileOnly: true, skipProject: true, compilerOptions: { module: 'commonjs', target: 'es2022', experimentalDecorators: true } });
const core = require('../../src/backend/src/shared/acquisition/client-policy.ts');
export const { YOUTUBE_PLAYER_CLIENT, YOUTUBE_AUTH_CLIENT, YOUTUBE_POT_CLIENT, youtubePlayerClient, REVIEWED_YTDLP_SHA256, clientCompatibilityForDigest, inspectClientCompatibility, assertClientCompatibility } = core;
