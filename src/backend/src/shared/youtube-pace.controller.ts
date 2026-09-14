import { Body, Controller, Get, Post } from '@nestjs/common';
import { YoutubeService } from './youtube.service';
import type { PaceStateFile } from './youtube-pace';
import { ConfigService } from '@nestjs/config';
import { dirname, join, resolve } from 'path';
import {
  acquisitionOwnerSnapshot,
  acquisitionSnapshot,
} from './acquisition-snapshot';
import {
  CLI_PROVEN_PROFILE,
  usesCliProvenProfile,
} from './youtube-ingest-profile';

@Controller('youtube')
export class YoutubePaceController {
  constructor(
    private readonly youtube: YoutubeService,
    private readonly config: ConfigService,
  ) {}

  @Get('pace')
  async snapshot() {
    const dbPath = this.config.get<string>('DB_PATH');
    const directory = dbPath ? join(dirname(resolve(dbPath)), 'acquire') : null;
    const owner = await this.youtube.ownerSnapshot();
    // Keep the web-worker pace untouched: the CLI still uses this API for its
    // graceful handoff. Its own activity is an explicitly separate projection.
    return {
      ...this.youtube.paceSnapshot(),
      knownGoodProfile: CLI_PROVEN_PROFILE,
      webProfileMode: usesCliProvenProfile() ? 'cli-proven' : 'custom',
      acquisitionOwner: acquisitionOwnerSnapshot(directory, owner.state),
      acquisition:
        directory && owner.state === 'owned'
          ? acquisitionSnapshot(directory)
          : null,
    };
  }

  @Post('pace')
  set(@Body() body: PaceStateFile) {
    this.youtube.setPace(body || {});
    return this.youtube.paceSnapshot();
  }

  @Post('profile/cli-proven')
  selectProvenProfile() {
    return this.youtube.selectProvenProfile();
  }
}
