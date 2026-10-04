import {
  accessSync,
  constants,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { dirname, isAbsolute, join, parse, resolve } from 'path';
import { randomUUID } from 'crypto';

export interface DownloadLocation {
  path: string;
  source: 'saved' | 'environment';
}

export function downloadSettingsPath(dbPath: string): string {
  return join(dirname(resolve(dbPath)), 'settings.json');
}

function readSettings(file: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error('Cannot read download-location settings');
  }
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new Error(
      'Invalid download-location settings; repair settings.json before continuing',
    );
  }
}

export function resolveDownloadLocation(
  fallback: string,
  settingsFile?: string,
): DownloadLocation {
  const saved = settingsFile
    ? readSettings(settingsFile).downloadsPath
    : undefined;
  if (saved === undefined)
    return { path: resolve(fallback), source: 'environment' };
  if (
    typeof saved !== 'string' ||
    !isAbsolute(saved) ||
    /[\x00-\x1f]/.test(saved)
  ) {
    throw new Error(
      'Invalid saved download location; repair settings.json before continuing',
    );
  }
  return { path: resolve(saved), source: 'saved' };
}

export function validateDownloadLocation(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 4096 ||
    /[\x00-\x1f]/.test(value) ||
    !isAbsolute(value.trim())
  ) {
    throw new Error('Enter an absolute path to an existing download folder');
  }
  let path: string;
  try {
    path = realpathSync(value.trim());
    if (!statSync(path).isDirectory()) throw new Error();
    accessSync(path, constants.R_OK | constants.W_OK | constants.X_OK);
  } catch {
    throw new Error(
      'Download folder must exist and be readable and writable by Spooty',
    );
  }
  if (path === parse(path).root)
    throw new Error('Choose a download folder, not the filesystem root');
  return path;
}

/** Atomic settings-only write. Never creates, moves or deletes media/folders. */
export function saveDownloadLocation(
  file: string,
  path: string,
): DownloadLocation {
  const settings = { ...readSettings(file), downloadsPath: path };
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(settings, null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
    renameSync(temporary, file);
  } finally {
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return { path, source: 'saved' };
}
