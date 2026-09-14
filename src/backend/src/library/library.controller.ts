import {
  Body,
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { existsSync } from 'fs';
import type { Response } from 'express';
import { LibraryListResponse, LibraryService } from './library.service';
import { AcquisitionOptions } from '../track/track.service';
import { candidateLimits } from '../shared/acquisition/candidate-policy';

@Controller('library')
export class LibraryController {
  constructor(private readonly service: LibraryService) {}

  @Get()
  list(): Promise<LibraryListResponse> {
    return this.service.list();
  }

  @Get('detail/:id')
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Get('audio/:playlistId/:n')
  audio(
    @Res() res: Response,
    @Param('playlistId') playlistId: string,
    @Param('n') n: string,
  ): void {
    const file = this.service.resolveAudioPath(playlistId, Number(n));
    if (!existsSync(file.path)) {
      throw new NotFoundException('Audio file missing');
    }
    // Express handles byte ranges, Content-Length, conditional requests and
    // stream errors. Advertising ranges while always returning the full stream
    // prevents reliable browser seeking and wastes bandwidth on each retry.
    res.sendFile(file.path, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': `inline; filename="${encodeURIComponent(file.filename)}"`,
      },
    });
  }

  @Post('download')
  download(
    @Body() body: { uris?: string[] } & AcquisitionOptions,
  ): Promise<{ queued: number; skipped: number }> {
    this.validateAcquisitionOptions(body, true);
    return this.service.download(body?.uris || [], {
      maxSearches: body?.maxSearches,
      networkRetries: body?.networkRetries,
      retryMissing: body?.retryMissing === true,
      retryNoCandidate: body?.retryNoCandidate === true,
      retryErrors: body?.retryErrors === true,
    });
  }

  @Post('download-remaining')
  downloadRemaining(
    @Body() body?: AcquisitionOptions,
  ): Promise<{ queued: number; skipped: number }> {
    this.validateAcquisitionOptions(body);
    return this.service.downloadRemaining(body || {});
  }

  private validateAcquisitionOptions(body: unknown, urisAllowed = false): void {
    if (body === undefined || body === null) return;
    if (typeof body !== 'object' || Array.isArray(body))
      throw new BadRequestException('Acquisition options must be an object');
    const numbers = ['maxSearches', 'networkRetries'];
    const booleans = ['retryMissing', 'retryNoCandidate', 'retryErrors'];
    for (const [key, value] of Object.entries(body)) {
      if (urisAllowed && key === 'uris') {
        if (
          !Array.isArray(value) ||
          value.some((uri) => typeof uri !== 'string')
        )
          throw new BadRequestException('uris must be a string array');
      } else if (numbers.includes(key)) {
        if (typeof value !== 'number' || !Number.isInteger(value))
          throw new BadRequestException(key + ' must be an integer');
      } else if (booleans.includes(key)) {
        if (typeof value !== 'boolean')
          throw new BadRequestException(key + ' must be boolean');
      } else
        throw new BadRequestException('Unknown acquisition option: ' + key);
    }
    try {
      candidateLimits({
        'max-searches': (body as AcquisitionOptions).maxSearches,
        'network-retries': (body as AcquisitionOptions).networkRetries,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  @Post('sync')
  syncLibrary() {
    return this.service.startLibrarySync();
  }

  @Get('sync')
  syncLibraryStatus() {
    return this.service.librarySyncStatus();
  }

  @Post('resync-all')
  resyncAll() {
    return this.service.startResyncAll();
  }

  @Get('resync-all')
  resyncAllStatus() {
    return this.service.resyncAllStatus();
  }

  @Post('resync/:id')
  resync(@Param('id') id: string) {
    return this.service.resync(id);
  }
}
