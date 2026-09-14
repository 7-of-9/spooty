import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve, sep } from 'path';
import { EnvironmentEnum } from '../environmentEnum';
import { safe, fileBase, songKey } from './acquisition/identity';

@Injectable()
export class UtilsService {
  constructor(private readonly configService: ConfigService) {}

  getRootDownloadsPath(): string {
    return resolve(
      __dirname,
      '..',
      this.configService.get<string>(EnvironmentEnum.DOWNLOADS_PATH),
    );
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
