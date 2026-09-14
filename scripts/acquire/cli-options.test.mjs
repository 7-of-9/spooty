import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { commands, optionDefinitions, parseCommandLine, helpText, UsageError } from './cli-options.mjs';

test('no command is a read-only plan; parsing supplies only options actually used by that command', () => {
  const parsed = parseCommandLine([]);
  assert.equal(parsed.command, 'plan');
  assert.equal(parsed.options['max-searches'], '10');
  assert.equal(parsed.options['retry-errors'], false);
  assert.equal(parsed.options['batch-size'], undefined);
  assert.equal(parseCommandLine(['run']).options['network-retries'], '5');
});

for (const [name, rule] of Object.entries(optionDefinitions)) {
  test(`--${name}: accepted only where consumed, with checked boundaries and help`, () => {
    assert.match(helpText(), new RegExp(`--${name}\\b`));
    if (!rule.commands) return;
    for (const command of Object.keys(commands)) {
      const args = [command, '--help', `--${name}`, ...(rule.type === 'string' ? [String(rule.min)] : [])];
      if (rule.commands.includes(command)) assert.doesNotThrow(() => parseCommandLine(args));
      else assert.throws(() => parseCommandLine(args), UsageError);
    }
    if (rule.min !== undefined) {
      const command = rule.commands[0];
      for (const value of [rule.min, rule.max]) assert.doesNotThrow(() => parseCommandLine([command, `--${name}`, String(value)]));
      for (const value of ['', ' ', 'NaN', '1.5', '1e2', '0x10', rule.min - 1, rule.max + 1]) {
        assert.throws(() => parseCommandLine([command, `--${name}`, String(value)]), UsageError);
      }
    }
  });
}

test('unknowns, extra positionals, duplicate flags and ineffective combinations are usage errors', () => {
  for (const args of [
    ['nonsense'], ['plan', 'extra'], ['run', '--typo'], ['run', '--max-searches'],
    ['run', '--max-searches', '10', '--max-searches', '5'], ['run', '--takeover', '--takeover'],
    ['pace'], ['run', '--version'], ['--version', '--help'], ['--help', '-h'],
    ['run', '--search-only', '--review-work'], ['run', '--search-only', '--inspect-review'],
    ['run', '--search-only', '--pot-recovery'],
  ]) assert.throws(() => parseCommandLine(args), UsageError, args.join(' '));
  assert.equal(parseCommandLine(['-h']).options.help, true);
  assert.equal(parseCommandLine(['-v']).options.version, true);
  assert.doesNotThrow(() => parseCommandLine(['pace', '--help']));
  assert.doesNotThrow(() => parseCommandLine(['run', '--authenticated', '--pot-recovery']));
});

test('installed and historical entry points expose identical help/version, without touching state', () => {
  const directory = mkdtempSync(join(tmpdir(), 'spooty-cli-contract-'));
  const env = { ...process.env, ACQUIRE_STATE_PATH: directory, DOWNLOADS_PATH: directory,
    STATIC_PLAYLISTS_PATH: join(directory, 'absent'), DB_PATH: join(directory, 'absent.sqlite') };
  const launch = (entry, args) => spawnSync(process.execPath, [resolve(entry), ...args], { env, encoding: 'utf8', timeout: 15000 });
  try {
    for (const args of [['--version'], ['run', '--help']]) {
      const installed = launch('bin/spooty.mjs', args);
      const legacy = launch('scripts/acquire.mjs', args);
      assert.equal(installed.status, 0, installed.stderr);
      assert.equal(legacy.status, 0, legacy.stderr);
      assert.equal(installed.stdout, legacy.stdout);
    }
    const invalid = launch('bin/spooty.mjs', ['status', '--max-searches', '10']);
    assert.equal(invalid.status, 2);
    assert.match(JSON.parse(invalid.stderr).error, /not used by status/);
    assert.deepEqual(readdirSync(directory), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
