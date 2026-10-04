import {
  Controller,
  Delete,
  Get,
  Param,
  Res,
  StreamableFile,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { TrackService } from './track.service';
import { createReadStream } from 'fs';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { TrackEntity } from './track.entity';
import { spotifySourceId } from '../shared/acquisition/source-id';

@Controller('track')
export class TrackController {
  constructor(
    private readonly service: TrackService,
    private readonly configService: ConfigService,
  ) {}

  @Get('active')
  getActive(): Promise<TrackEntity[]> {
    return this.service.getActive();
  }

  @Get('search-evidence')
  searchEvidence(@Query('artist') artist: string, @Query('name') name: string, @Query('spotifyUrl') spotifyUrl?: string) {
    if ([artist, name].some(value => typeof value !== 'string' || !value.trim() || value.length > 500))
      throw new BadRequestException('artist and name must be nonempty strings of at most 500 characters');
    if (spotifyUrl !== undefined && !spotifySourceId(spotifyUrl)) throw new BadRequestException('Invalid Spotify track URL');
    return { report: this.service.searchEvidence(artist, name, spotifyUrl) };
  }

  @Get('playlist/:id')
  getAllByPlaylist(@Param('id') playlistId: number): Promise<TrackEntity[]> {
    return this.service.getAllByPlaylist(playlistId);
  }

  @Get('download/:id')
  async getFile(
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: number,
  ): Promise<StreamableFile> {
    const track = await this.service.get(id);
    const media = await this.service.localMedia(track);
    if (!media.local) throw new BadRequestException('No matching local audio for this Spotify track');
    const fileName = media.local.split('/').pop();
    const readStream = createReadStream(media.local);
    res.set({
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}`,
    });
    return new StreamableFile(readStream);
  }

  @Delete(':id')
  remove(@Param('id') id: number): Promise<void> {
    return this.service.remove(id);
  }

  @Get('retry/:id')
  retry(@Param('id') id: number): Promise<boolean> {
    return this.service.retry(id);
  }
}
