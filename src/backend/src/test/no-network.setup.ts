// Execution tests must never fall through to a real media process. Mock the
// module itself, not merely a temporary spy over a live spawn implementation.
jest.mock('node:child_process', () => {
  const actual = jest.requireActual('node:child_process');
  const deny = () => {
    throw new Error(
      'Unmocked subprocess forbidden in offline acquisition tests',
    );
  };
  return {
    ...actual,
    spawn: jest.fn(deny),
    spawnSync: jest.fn(deny),
    exec: jest.fn(deny),
    execSync: jest.fn(deny),
    execFile: jest.fn(deny),
    execFileSync: jest.fn(deny),
    fork: jest.fn(deny),
  };
});
jest.mock('child_process', () => require('node:child_process'));
global.fetch = jest.fn(async () => {
  throw new Error('Unmocked network forbidden in offline acquisition tests');
}) as any;
