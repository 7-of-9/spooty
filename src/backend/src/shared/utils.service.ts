import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve, sep } from 'path';
import { EnvironmentEnum } from '../environmentEnum';
import { safe, fileBase, songKey } from './acquisition/identity';
import {
  DownloadLocation,
  downloadSettingsPath,
  resolveDownloadLocation,
  saveDownloadLocation,
} from './acquisition/download-location';

@Injectable()
export class UtilsService {
  private location: DownloadLocation;
  private readonly settingsFile?: string;

  constructor(private readonly configService: ConfigService) {
    const dbPath = configService.get<string>(EnvironmentEnum.DB_PATH);
    this.settingsFile = dbPath ? downloadSettingsPath(dbPath) : undefined;
    this.location = resolveDownloadLocation(
      resolve(
        __dirname,
        '..',
        configService.get<string>(EnvironmentEnum.DOWNLOADS_PATH) ||
          'downloads',
      ),
      this.settingsFile,
    );
  }

  getRootDownloadsPath(): string {
    return this.location.path;
  }

  getDownloadLocation(): DownloadLocation {
    return { ...this.location };
  }

  setDownloadLocation(path: string): DownloadLocation {
    if (!this.settingsFile)
      throw new Error(
        'DB_PATH must be configured to persist the download location',
      );
    this.location = saveDownloadLocation(this.settingsFile, path);
    return this.getDownloadLocation();
  }

  getPlaylistFolderPath(name: string): string {
    const root = this.getRootDownloadsPath();
    const cleaned = this.stripFileIllegalChars(name || '').trim();
    const segment =
      !cleaned || cleaned === '.' || cleaned === '..'
        ? 'unknown_playlist'
        : cleaned;
    const folder = resolve(root, segment);
    if (!folder.startsWith(root + sep)) {
      return resolve(root, 'unknown_playlist');
    }
    return folder;
  }

  stripFileIllegalChars(text: string): string {
    return safe(text);
  }

  trackFileBase(artist: string, name: string): string {
    return fileBase(artist, name);
  }

  trackFileKey(artist: string, name: string): string {
    return songKey(artist, name);
  }
}
