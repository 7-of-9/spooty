import { UtilsService } from './utils.service';
import { EnvironmentEnum } from '../environmentEnum';

describe('UtilsService', () => {
  const root = '/tmp/spooty-downloads';
  const service = new UtilsService({
    get: (key: EnvironmentEnum) =>
      key === EnvironmentEnum.DOWNLOADS_PATH ? root : undefined,
  } as any);

  for (const name of ['', '.', '..', '../outside', '/outside']) {
    it(`keeps playlist folder ${JSON.stringify(name)} inside DOWNLOADS_PATH`, () => {
      expect(service.getPlaylistFolderPath(name).startsWith(`${root}/`)).toBe(
        true,
      );
    });
  }

  it('normalises illegal filename characters consistently', () => {
    expect(service.trackFileKey('A/B', 'C:D')).toBe('a-b - c-d');
  });

  it('keeps long Unicode MP3 filenames within 255 bytes with distinct stable suffixes', () => {
    const first = service.trackFileBase('ศิลปิน', 'เพลง'.repeat(40) + 'a');
    const second = service.trackFileBase('ศิลปิน', 'เพลง'.repeat(40) + 'b');
    expect(Buffer.byteLength(first + '.mp3', 'utf8')).toBeLessThanOrEqual(255);
    expect(first).not.toBe(second);
    expect(first).not.toContain('�');
    expect(first).toMatch(/-[a-f0-9]{12}$/);
  });
});
