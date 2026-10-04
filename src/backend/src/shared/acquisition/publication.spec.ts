import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { materialize, publishMp3, materializeForTrack, publishMp3ForTrack, unpublishPlaylistCopies } from './publication';
import { mediaFingerprint } from './media-file';
import { sourceFileBase } from './identity';

describe('publication never accepts an unrelated occupied path as success', () => {
  let root: string;
  let source: string;
  let target: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'spooty-publication-'));
    source = join(root, 'source.mp3');
    target = join(root, 'target.mp3');
    writeFileSync(source, 'intended audio');
  });
  afterEach(() => { jest.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

  it('does not silently accept an unrelated file during local reuse', () => {
    writeFileSync(target, 'different audio');
    expect(() => materialize(source, [target])).toThrow(/occupied/i);
    expect(readFileSync(target, 'utf8')).toBe('different audio');
  });

  it('does not silently accept an unrelated file during MP3 publication', () => {
    writeFileSync(target, 'different audio');
    expect(() => publishMp3(source, target, {}, () => true)).toThrow(/occupied/i);
    expect(readFileSync(target, 'utf8')).toBe('different audio');
  });

  it('checks a file arriving after tagging and cleans up only its own temporary file', () => {
    expect(() => publishMp3(source, target, {}, () => {
      writeFileSync(target, 'concurrent writer');
      return true;
    })).toThrow(/occupied/i);
    expect(readFileSync(target, 'utf8')).toBe('concurrent writer');
    expect(readdirSync(root).some(name => name.startsWith('.acquire-'))).toBe(false);
  });

  const track = { artist: 'Artist', name: 'Song', id: '1111111111111111111111' };
  const alternative = () => join(root, sourceFileBase(track, 2) + '.mp3');

  it('recovers occupied paths during reuse without changing the existing recording', () => {
    writeFileSync(target, 'old recording');
    const result = materializeForTrack(source, [target], track);
    expect(result).toEqual({ added: 1, destinations: [alternative()] });
    expect(readFileSync(target, 'utf8')).toBe('old recording');
    expect(readFileSync(alternative(), 'utf8')).toBe('intended audio');
    expect(materializeForTrack(source, [target], track)).toEqual({ added: 0, destinations: [alternative()] });
  });

  it('returns the actual source-specific path when another file arrives during tagging', () => {
    const result = publishMp3ForTrack(source, target, track, (tags, temp) => {
      expect(tags).toEqual({ title: 'Song', artist: 'Artist' });
      writeFileSync(temp, 'tagged intended audio');
      writeFileSync(target, 'concurrent writer');
      return true;
    });
    expect(result).toEqual({ path: alternative(), created: true });
    expect(readFileSync(result.path, 'utf8')).toBe('tagged intended audio');
    expect(readFileSync(target, 'utf8')).toBe('concurrent writer');
  });

  it('preserves empty files, directories and dangling symlinks as occupied', () => {
    writeFileSync(target, '');
    mkdirSync(alternative());
    symlinkSync(join(root, 'absent.mp3'), join(root, sourceFileBase(track, 3) + '.mp3'));
    const result = materializeForTrack(source, [target], track);
    expect(result.destinations).toEqual([join(root, sourceFileBase(track, 4) + '.mp3')]);
    expect(statSync(target).size).toBe(0);
    expect(statSync(alternative()).isDirectory()).toBe(true);
  });

  it('accepts separately encoded existing audio only with unchanged verification evidence', () => {
    writeFileSync(target, 'another encoding, independently duration-verified');
    const local = { [target]: mediaFingerprint(target) };
    expect(materializeForTrack(source, [target], track, { local })).toEqual({ added: 0, destinations: [target] });
    writeFileSync(target, 'replaced');
    expect(materializeForTrack(source, [target], track, { local }).destinations).toEqual([alternative()]);
    expect(readFileSync(target, 'utf8')).toBe('replaced');
  });

  it('rejects a source replaced after verification, before any copy or success', () => {
    const proof = mediaFingerprint(source);
    writeFileSync(source, 'changed source');
    expect(() => materializeForTrack(source, [target], track, { source: proof })).toThrow(/changed after verification/);
    expect(() => publishMp3ForTrack(source, target, track, () => true, proof)).toThrow(/changed after verification/);
    expect(readdirSync(root)).toEqual(['source.mp3']);
  });

  it('stages a cross-device copy before exposing its final MP3 name', () => {
    const realLink = fs.linkSync;
    const link = jest.spyOn(fs, 'linkSync').mockImplementation((from, to) => {
      if (from === source) throw Object.assign(new Error('Cross-device'), { code: 'EXDEV' });
      expect(String(from)).toContain('.acquire-');
      expect(readFileSync(from, 'utf8')).toBe('intended audio');
      expect(fs.existsSync(to)).toBe(false);
      realLink(from, to);
    });
    expect(materialize(source, [target])).toBe(1);
    expect(link).toHaveBeenCalledTimes(2);
    expect(readFileSync(target, 'utf8')).toBe('intended audio');
    expect(readdirSync(root).some(name => name.startsWith('.acquire-'))).toBe(false);
  });

  it('recovers an EEXIST race at the atomic link, not just at the precheck', () => {
    const realLink = fs.linkSync;
    jest.spyOn(fs, 'linkSync').mockImplementation((from, to) => {
      if (to === target && !fs.existsSync(to)) writeFileSync(to, 'race winner');
      realLink(from, to);
    });
    expect(materializeForTrack(source, [target], track).destinations).toEqual([alternative()]);
    expect(readFileSync(target, 'utf8')).toBe('race winner');
  });

  it('bounds collision recovery and keeps long Unicode versioned names within the filesystem limit', () => {
    const long = { ...track, name: 'เพลง'.repeat(100) };
    writeFileSync(target, 'occupied');
    const result = publishMp3ForTrack(source, target, long, () => true);
    expect(Buffer.byteLength(result.path.slice(root.length + 1))).toBeLessThanOrEqual(255);
    expect(readFileSync(result.path, 'utf8')).toBe('intended audio');
    jest.spyOn(fs, 'linkSync').mockImplementation(() => { throw Object.assign(new Error(), { code: 'EEXIST' }); });
    expect(() => materializeForTrack(source, [join(root, 'free.mp3')], { ...track, name: 'Other' })).toThrow(/Too many occupied/);
  });

  it('never deletes another writer\'s temporary file if exclusive allocation collides', () => {
    const id = '00000000-0000-0000-0000-000000000000';
    jest.spyOn(crypto, 'randomUUID').mockReturnValue(id);
    const other = join(root, `.acquire-${process.pid}-${id}.tmp`);
    writeFileSync(other, 'not ours');
    expect(() => publishMp3ForTrack(source, target, track, () => true)).toThrow();
    expect(readFileSync(other, 'utf8')).toBe('not ours');
    expect(fs.existsSync(target)).toBe(false);
  });
});

describe('unpublishPlaylistCopies follows Spotify membership for one playlist folder', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'spooty-unpublish-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  const gone = { id: '2222222222222222222222', artist: 'JENNIE', name: 'FALLEN ANGEL' };
  const kept = { id: '1111111111111111111111', artist: 'Artist One', name: 'Song One' };

  it('unlinks this playlist copy and leaves other playlist hardlinks', () => {
    const folder = join(root, '50');
    const other = join(root, 'Other');
    mkdirSync(folder); mkdirSync(other);
    const local = join(folder, 'JENNIE - FALLEN ANGEL.mp3');
    const shared = join(folder, sourceFileBase(gone) + '.mp3');
    const sibling = join(other, sourceFileBase(gone) + '.mp3');
    const stay = join(folder, sourceFileBase(kept) + '.mp3');
    writeFileSync(local, 'legacy playlist copy');
    writeFileSync(shared, 'source-specific copy');
    fs.linkSync(shared, sibling);
    writeFileSync(stay, 'still on spotify');
    const inode = statSync(shared).ino;

    expect(unpublishPlaylistCopies(folder, [gone], [kept]).removedPaths.sort()).toEqual([local, shared].sort());
    expect(fs.existsSync(local)).toBe(false);
    expect(fs.existsSync(shared)).toBe(false);
    expect(statSync(sibling).ino).toBe(inode);
    expect(readFileSync(sibling, 'utf8')).toBe('source-specific copy');
    expect(readFileSync(stay, 'utf8')).toBe('still on spotify');
  });

  it('keeps a legacy filename still used by a remaining track', () => {
    const folder = join(root, '50');
    mkdirSync(folder);
    const path = join(folder, 'Artist - Song.mp3');
    writeFileSync(path, 'ambiguous name');
    unpublishPlaylistCopies(folder,
      [{ id: '2222222222222222222222', artist: 'Artist', name: 'Song' }],
      [{ id: '1111111111111111111111', artist: 'Artist', name: 'Song' }]);
    expect(readFileSync(path, 'utf8')).toBe('ambiguous name');
  });

  it('removes a symlink in the playlist folder without touching its target', () => {
    const folder = join(root, '50');
    mkdirSync(folder);
    const outside = join(root, 'canonical.mp3');
    writeFileSync(outside, 'canonical audio');
    const link = join(folder, 'JENNIE - FALLEN ANGEL.mp3');
    symlinkSync(outside, link);
    unpublishPlaylistCopies(folder, [gone], [kept]);
    expect(fs.existsSync(link)).toBe(false);
    expect(readFileSync(outside, 'utf8')).toBe('canonical audio');
  });

  it('is a no-op when the playlist folder is missing', () => {
    expect(unpublishPlaylistCopies(join(root, 'absent'), [gone], [kept])).toEqual({ removedPaths: [] });
  });
});
