import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AcquisitionOwner } from './acquisition-owner';
import { ConflictException } from '@nestjs/common';
import { webAdmission } from './web-admission-state';
import { UtilsService } from './utils.service';
import { validateDownloadLocation } from './acquisition/download-location';

const isLoopback = (host: string) =>
  ['localhost', '127.0.0.1', '::1', '[::1]', '::ffff:127.0.0.1'].includes(host);

@Controller('settings/download-location')
export class DownloadLocationController {
  constructor(
    private readonly utils: UtilsService,
    private readonly owner: AcquisitionOwner,
  ) {}

  @Get()
  get() {
    return this.utils.getDownloadLocation();
  }

  @Post()
  async set(@Body() body: unknown, @Req() request: Request) {
    // This grants local filesystem access: refuse remote, cross-site and form posts.
    let local = false;
    try {
      const host = new URL(`http://${request.headers.host}`).hostname;
      const origin = request.headers.origin
        ? new URL(request.headers.origin)
        : null;
      local =
        isLoopback(request.socket.remoteAddress || '') &&
        isLoopback(host) &&
        (!origin ||
          (['http:', 'https:'].includes(origin.protocol) &&
            isLoopback(origin.hostname))) &&
        /^application\/json(?:;|$)/i.test(
          request.headers['content-type'] || '',
        );
    } catch {
      /* Rejected below. */
    }
    if (!local)
      throw new ForbiddenException(
        'Download location can only be changed from the local Spooty website',
      );
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !('path' in body)
    ) {
      throw new BadRequestException('Supply only the download folder path');
    }
    let path: string;
    try {
      path = validateDownloadLocation(body.path);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
    return this.owner.withIdleWebQueues(() => {
      if (webAdmission.snapshot().running) throw new ConflictException('A playlist request is still preparing tracks. Wait before changing the download folder.');
      return this.utils.setDownloadLocation(path);
    });
  }
}
