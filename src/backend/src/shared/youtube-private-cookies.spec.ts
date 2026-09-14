import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { privateYoutubeCookieArgs } from './youtube-private-cookies';

describe('private per-process cookie jars', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'private-cookie-test-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });
  it('isolates concurrent writes from each other and master, with private modes and exact cleanup', () => {
    const master = join(root, 'master.txt');
    writeFileSync(master, 'fixture');
    const first = privateYoutubeCookieArgs(
      ['--cookies', master, '--', 'url'],
      root,
    );
    const second = privateYoutubeCookieArgs(
      ['--cookies', master, '--', 'url'],
      root,
    );
    expect(first.args[1]).not.toBe(second.args[1]);
    expect(statSync(first.args[1]).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(first.args[1])).mode & 0o777).toBe(0o700);
    writeFileSync(first.args[1], '');
    expect(readFileSync(master, 'utf8')).toBe('fixture');
    expect(readFileSync(second.args[1], 'utf8')).toBe('fixture');
    first.cleanup();
    second.cleanup();
    expect(existsSync(first.args[1])).toBe(false);
    expect(existsSync(second.args[1])).toBe(false);
    expect(existsSync(master)).toBe(true);
  });
  it('rejects absent and empty jars without leaking paths or data', () => {
    const master = join(root, 'empty');
    writeFileSync(master, '');
    expect(() => privateYoutubeCookieArgs(['--cookies', master], root)).toThrow(
      'private cookie jar unavailable',
    );
    expect(() =>
      privateYoutubeCookieArgs(['--cookies', join(root, 'absent')], root),
    ).toThrow('private cookie jar unavailable');
  });
  it('does not create a cookie jar for anonymous work', () => {
    const result = privateYoutubeCookieArgs(['--', 'url'], root);
    expect(result.args).toEqual(['--', 'url']);
    result.cleanup();
  });
});
