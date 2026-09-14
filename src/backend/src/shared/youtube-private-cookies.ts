import { chmodSync, copyFileSync, mkdtempSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/** yt-dlp writes its jar on exit. Never give it the shared master export. */
export function privateYoutubeCookieArgs(args: string[], tempRoot = tmpdir()) {
  const index = args.indexOf('--cookies');
  if (index < 0) return { args: [...args], cleanup: () => undefined };
  const master = args[index + 1];
  let directory: string | null = null;
  try {
    if (!master || !statSync(master).isFile() || statSync(master).size <= 0)
      throw new Error('missing');
    directory = mkdtempSync(join(tempRoot, 'spooty-web-cookies-'));
    chmodSync(directory, 0o700);
    const cookiePath = join(directory, 'cookies.txt');
    copyFileSync(master, cookiePath);
    chmodSync(cookiePath, 0o600);
    if (statSync(cookiePath).size <= 0) throw new Error('empty');
    const isolated = [...args];
    isolated[index + 1] = cookiePath;
    const ownedDirectory = directory;
    return {
      args: isolated,
      cleanup: () => rmSync(ownedDirectory, { recursive: true, force: true }),
    };
  } catch {
    if (directory) rmSync(directory, { recursive: true, force: true });
    throw new Error(
      'Temporary YouTube failure: private cookie jar unavailable',
    );
  }
}
