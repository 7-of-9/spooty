import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
} from '@nestjs/common';
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
import { webAdmission } from './web-admission-state';

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
      webQueues: await this.youtube.webQueueSnapshot(),
      webActivity: await this.youtube.webActivitySnapshot(),
      webAdmission: webAdmission.snapshot(),
      configurationError: this.youtube.configurationError(),
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

  @Post('queues/resume')
  async resumeQueues(@Body() body: { scope?: string }) {
    if (body?.scope !== 'all-web-queues')
      throw new BadRequestException('Confirm scope: all-web-queues');
    await this.youtube.resumeWebQueues();
    return this.snapshot();
  }

  @Post('profile/cli-proven')
  selectProvenProfile() {
    return this.youtube.selectProvenProfile();
  }
}
