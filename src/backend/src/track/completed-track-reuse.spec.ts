import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  isNonEmptyFile,
  reuseCompletedTrackFile,
} from './completed-track-reuse';

describe('completed track file reuse', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'spooty-reuse-'));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('hardlinks a non-empty source into a playlist folder', () => {
    const source = join(root, 'source.mp3');
    const destination = join(root, 'playlist', 'track.mp3');
    writeFileSync(source, 'audio');

    expect(reuseCompletedTrackFile(source, destination, root)).toBe(true);
    expect(readFileSync(destination, 'utf8')).toBe('audio');
    expect(statSync(destination).ino).toBe(statSync(source).ino);
  });

  it('accepts an existing non-empty destination', () => {
    const destination = join(root, 'track.mp3');
    writeFileSync(destination, 'already here');
    expect(
      reuseCompletedTrackFile(join(root, 'missing.mp3'), destination, root),
    ).toBe(true);
  });

  it('falls through when the source is missing or empty', () => {
    const empty = join(root, 'empty.mp3');
    writeFileSync(empty, '');
    expect(isNonEmptyFile(empty)).toBe(false);
    expect(reuseCompletedTrackFile(empty, join(root, 'dest.mp3'), root)).toBe(
      false,
    );
  });

  it('rejects paths outside the downloads root', () => {
    expect(() =>
      reuseCompletedTrackFile('/tmp/source.mp3', join(root, 'dest.mp3'), root),
    ).toThrow('outside downloads root');
  });
});
