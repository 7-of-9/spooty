import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// The user explicitly authorized autonomous recovery on 13 September.
// Select a supported client, never an obsolete alias or implicit defaults.
export const YOUTUBE_PLAYER_CLIENT = 'visionos';
export const YOUTUBE_AUTH_CLIENT = 'web_creator';
export const YOUTUBE_POT_CLIENT = 'mweb';
export function youtubePlayerClient(cookies, pot = false) {
  return cookies
    ? pot
      ? YOUTUBE_POT_CLIENT
      : YOUTUBE_AUTH_CLIENT
    : YOUTUBE_PLAYER_CLIENT;
}
export const REVIEWED_YTDLP_SHA256 =
  '0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202';
// Exact-release compatibility evidence; remote success still requires a canary.
// https://github.com/yt-dlp/yt-dlp/blob/2026.08.19/yt_dlp/extractor/youtube/_base.py
const REVIEWED_SUPPORTED_CLIENTS = new Set([
  'visionos',
  'web',
  'web_embedded',
  'web_creator',
  'mweb',
  'tv_downgraded',
]);

export function clientCompatibilityForDigest(
  sha256,
  client = YOUTUBE_PLAYER_CLIENT,
) {
  const reviewed = sha256 === REVIEWED_YTDLP_SHA256;
  const unsupported = reviewed && client === 'android_sdkless';
  const supported = reviewed && REVIEWED_SUPPORTED_CLIENTS.has(client);
  return {
    sha256,
    version: reviewed ? '2026.08.19' : null,
    requestedClient: client,
    compatibility: supported
      ? 'supported'
      : unsupported
        ? 'unsupported'
        : 'unverified',
    ready: supported,
    reason: unsupported
      ? 'The installed yt-dlp release skips android_sdkless and substitutes default clients. Select a supported client before benchmarking.'
      : supported
        ? 'This release recognizes the client. Authentication, format availability and sustainable throughput still require a controlled test.'
        : 'This binary/client pairing has not been verified; inspect its exact release before benchmarking.',
  };
}

// Entirely local: no child executable, network, cookies, Redis or queue writes.
export function inspectClientCompatibility(
  binary,
  client = YOUTUBE_PLAYER_CLIENT,
) {
  const digest = createHash('sha256')
    .update(readFileSync(binary))
    .digest('hex');
  return clientCompatibilityForDigest(digest, client);
}

export function assertClientCompatibility(
  binary,
  client = YOUTUBE_PLAYER_CLIENT,
) {
  const check = inspectClientCompatibility(binary, client);
  if (!check.ready) throw new Error(check.reason);
  return check;
}
