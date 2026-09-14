import { accessSync, constants, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectClientCompatibility, youtubePlayerClient } from './client-policy.mjs';

// Metadata-only checks for credential files; never inspect their contents.
export function localDoctor(paths, options = {}) {
  const checks = [];
  const check = (name, fn) => {
    try { checks.push({ name, ok: Boolean(fn()) }); }
    catch { checks.push({ name, ok: false }); }
  };
  check('applicationNode20.19.4', () => process.versions.node === '20.19.4');
  for (const [name, path] of [
    ['ffmpeg', '/opt/homebrew/bin/ffmpeg'], ['ffprobe', '/opt/homebrew/bin/ffprobe'],
    ['ytDlpJavaScriptRuntime', process.env.YT_JS_RUNTIME_PATH || '/Users/dom/.nvm/versions/node/v22.13.0/bin/node'],
  ]) check(name, () => { accessSync(path, constants.X_OK); return statSync(path).isFile(); });
  check('savedPlaylistDirectory', () => statSync(paths.playlists).isDirectory());
  check('durableLibraryDatabase', () => statSync(paths.dbPath).isFile() && statSync(paths.dbPath).size > 0);
  if (options.authenticated) check('nonemptyCookieExport', () => statSync(paths.cookies).isFile() && statSync(paths.cookies).size > 0);
  if (options['pot-recovery']) check('reviewedPotPlugin', () => createHash('sha256')
    .update(readFileSync(join(paths.root, 'data/yt-dlp-plugins/bgutil-ytdlp-pot-provider.zip'))).digest('hex') ===
    'bce874dfa25896c2798e0f4f8147b7b22e785479eb1e459ab232bf2506c95016');
  let compatibility;
  try {
    compatibility = inspectClientCompatibility(join(paths.root, 'node_modules/ytdlp-nodejs/bin/yt-dlp_macos'),
      youtubePlayerClient(Boolean(options.authenticated), Boolean(options['pot-recovery'])));
  } catch { compatibility = { ready: false, reason: 'Cannot read the installed yt-dlp binary.' }; }
  return { ready: compatibility.ready && checks.every(c => c.ok), checks, compatibility,
    networkRequests: 0, queueMutations: 0,
    notChecked: ['Redis and backend connectivity', 'Spotify session validity', 'YouTube authentication or media availability', 'POT provider health (checked before authenticated download)'] };
}
