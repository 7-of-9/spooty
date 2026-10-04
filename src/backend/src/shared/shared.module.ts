import { Module } from '@nestjs/common';
import { UtilsService } from './utils.service';
import { ConfigModule } from '@nestjs/config';
import { SpotifyService } from './spotify.service';
import { YoutubeService } from './youtube.service';
import { SpotifyApiService } from './spotify-api.service';
import { CdpProxyClient } from './cdp-proxy.client';
import { SpotifySessionService } from './spotify-session.service';
import { YoutubePaceController } from './youtube-pace.controller';
import { AcquisitionOwner } from './acquisition-owner';
import { SpotifyDurationService } from './spotify-duration.service';
import { DownloadLocationController } from './download-location.controller';

@Module({
  imports: [ConfigModule],
  providers: [
    SpotifyDurationService,
    AcquisitionOwner,
    UtilsService,
    SpotifyService,
    YoutubeService,
    SpotifyApiService,
    CdpProxyClient,
    SpotifySessionService,
  ],
  controllers: [YoutubePaceController, DownloadLocationController],
  exports: [
    SpotifyDurationService,
    AcquisitionOwner,
    UtilsService,
    SpotifyService,
    YoutubeService,
    SpotifyApiService,
    CdpProxyClient,
    SpotifySessionService,
  ],
})
export class SharedModule {}
