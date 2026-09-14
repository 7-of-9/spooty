import { EventEmitter } from 'events';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import * as childProcess from 'node:child_process';
import { webAdapterFixture } from './acquisition/web-adapter.fixture';
import { Transport } from './acquisition/transport';
import { AcquisitionOwner } from './acquisition-owner';
import { CLI_PROVEN_PROFILE } from './youtube-ingest-profile';

describe('shared process and web ownership boundary (subprocesses default-denied)', () => {
  let f: ReturnType<typeof webAdapterFixture>;
  beforeEach(() => {
    f = webAdapterFixture();
  });
  afterEach(() => {
    f.close();
    jest.restoreAllMocks();
  });
  it('checks server-side owner immediately before a child can launch', async () => {
    jest
      .spyOn(AcquisitionOwner.prototype, 'assertWebAllowed')
      .mockRejectedValue(new Error('CLI owns acquisition'));
    f.transport.spawn = childProcess.spawn;
    await expect(
      Transport.prototype.process.call(f.transport, [], 'search', 1000),
    ).rejects.toThrow('CLI owns');
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });
  it('uses a private jar and cleans it after a child exits', async () => {
    const master = join(f.root, 'master.txt');
    writeFileSync(master, 'private fixture');
    const child = Object.assign(new EventEmitter(), {
      pid: 99999991,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: jest.fn(),
    });
    f.transport.spawn = jest.fn().mockReturnValue(child) as any;
    const running = Transport.prototype.process.call(
      f.transport,
      ['--cookies', master],
      'search',
      1000,
    );
    await Promise.resolve();
    await Promise.resolve();
    const args = (f.transport.spawn as jest.Mock).mock.calls[0][1];
    const privateJar = args[args.indexOf('--cookies') + 1];
    expect(privateJar).not.toBe(master);
    writeFileSync(privateJar, 'child rewrite');
    child.emit('close', 0);
    await running;
    expect(readFileSync(master, 'utf8')).toBe('private fixture');
    expect(existsSync(dirname(privateJar))).toBe(false);
  });
  it('preserves first-block safety floor and kills every owned child', () => {
    const kill = jest
      .spyOn(f.transport, 'killChildren')
      .mockImplementation(() => {});
    f.transport.trip('download');
    expect(f.pace.snapshot()).toMatchObject({
      downloadConc: 1,
      searchConc: 1,
      maxPerWindow: 8,
      autoStep: false,
    });
    expect(kill).toHaveBeenCalled();
  });
  it('explicit preset activation writes only measured settings, never resumes queues', async () => {
    jest
      .spyOn(AcquisitionOwner.prototype, 'withPausedWebQueues')
      .mockImplementation(async (apply) => apply());
    const apply = jest.spyOn(f.pace, 'applyState').mockImplementation(() => {});
    await f.service.selectProvenProfile();
    expect(apply).toHaveBeenCalledWith({
      downloadConc: 4,
      searchConc: 1,
      maxPerWindow: 240,
      autoStep: false,
      reason: 'Selected retained ' + CLI_PROVEN_PROFILE.id,
    });
  });
  it('a persisted safety floor cannot be reset by selecting a preset', async () => {
    jest
      .spyOn(AcquisitionOwner.prototype, 'withPausedWebQueues')
      .mockImplementation(async (apply) => apply());
    jest
      .spyOn(f.pace, 'snapshot')
      .mockReturnValue({
        active: 0,
        coolRemainingMs: 0,
        downloadConc: 1,
        searchConc: 1,
        maxPerWindow: 8,
      } as any);
    await expect(f.service.selectProvenProfile()).rejects.toThrow(
      'Safety floor',
    );
  });
});
import { expect } from '@jest/globals';
